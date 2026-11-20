package com.futureprint.calculator.backup;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * Retention policy — Java port of src/lib/backup/retention.ts.
 *
 * Same invariants:
 *  1. Daily / weekly / monthly backups follow the configured bucket limits.
 *  2. Transaction backups are capped at MAX_TRANSACTION_BACKUPS (10).
 *  3. Safety backups (`pre-restore`, `pre-update`) are each capped at
 *     MAX_SAFETY_BACKUPS (5) so they never accumulate unboundedly.
 *  4. Manual copies are ALWAYS protected and never pruned.
 *  5. Only VERIFIED backups are candidates; unreadable files are left alone.
 *  6. The newest `keepMinimum` files and `protectName` are always kept.
 *
 * Buckets use the device's local calendar (Java TimeZone offsetMinutes, positive east of UTC).
 */
final class RetentionPlanner {

    private static final Set<String> ALWAYS_KEEP_KINDS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("manual"))
    );
    private static final int MAX_TRANSACTION_BACKUPS = 10;
    private static final int MAX_SAFETY_BACKUPS = 5;

    private RetentionPlanner() {}

    static List<String> plan(List<BackupEngine.FileRecord> verified, JSONObject policy, int offsetMinutes, String protectName) {
        int dailyLimit = Math.max(0, policy.optInt("daily", 7));
        int weeklyLimit = Math.max(0, policy.optInt("weekly", 4));
        int monthlyLimit = Math.max(0, policy.optInt("monthly", 12));
        int keepMinimum = Math.max(0, policy.optInt("keepMinimum", 2));

        List<BackupEngine.FileRecord> sorted = new ArrayList<>();
        for (BackupEngine.FileRecord r : verified) if (r.manifest != null) sorted.add(r);
        Collections.sort(sorted, new Comparator<BackupEngine.FileRecord>() {
            @Override
            public int compare(BackupEngine.FileRecord a, BackupEngine.FileRecord b) {
                return Long.compare(createdAt(b), createdAt(a)); // newest first
            }
        });

        Map<String, List<BackupEngine.FileRecord>> daily = new LinkedHashMap<>();
        Map<String, List<BackupEngine.FileRecord>> weekly = new LinkedHashMap<>();
        Map<String, List<BackupEngine.FileRecord>> monthly = new LinkedHashMap<>();
        List<BackupEngine.FileRecord> transactions = new ArrayList<>();
        List<BackupEngine.FileRecord> preRestore = new ArrayList<>();
        List<BackupEngine.FileRecord> preUpdate = new ArrayList<>();

        for (BackupEngine.FileRecord r : sorted) {
            String kind = r.manifest.optString("kind", "");
            if (ALWAYS_KEEP_KINDS.contains(kind)) {
                continue;
            }
            String iso = r.manifest.optString("createdAt", "");
            if ("daily".equals(kind)) {
                add(daily, dailyKey(iso, offsetMinutes), r);
            } else if ("weekly".equals(kind)) {
                add(weekly, weeklyKey(iso, offsetMinutes), r);
            } else if ("monthly".equals(kind)) {
                add(monthly, monthlyKey(iso, offsetMinutes), r);
            } else if ("transaction".equals(kind)) {
                transactions.add(r);
            } else if ("pre-restore".equals(kind)) {
                preRestore.add(r);
            } else if ("pre-update".equals(kind)) {
                preUpdate.add(r);
            }
        }

        List<String> candidates = new ArrayList<>();
        collectExpired(daily, dailyLimit, candidates);
        collectExpired(weekly, weeklyLimit, candidates);
        collectExpired(monthly, monthlyLimit, candidates);
        // Keep newest MAX_TRANSACTION_BACKUPS transaction backups so they stay bounded.
        for (int i = MAX_TRANSACTION_BACKUPS; i < transactions.size(); i++) {
            candidates.add(transactions.get(i).fileName);
        }
        // Cap pre-restore and pre-update safety backups at MAX_SAFETY_BACKUPS each.
        for (int i = MAX_SAFETY_BACKUPS; i < preRestore.size(); i++) {
            candidates.add(preRestore.get(i).fileName);
        }
        for (int i = MAX_SAFETY_BACKUPS; i < preUpdate.size(); i++) {
            candidates.add(preUpdate.get(i).fileName);
        }

        Set<String> protectedNames = new HashSet<>();
        for (int i = 0; i < Math.min(keepMinimum, sorted.size()); i++) {
            protectedNames.add(sorted.get(i).fileName);
        }
        for (BackupEngine.FileRecord r : sorted) {
            String kind = r.manifest.optString("kind", "");
            if (ALWAYS_KEEP_KINDS.contains(kind)) {
                protectedNames.add(r.fileName);
            }
        }
        if (protectName != null) protectedNames.add(protectName);

        final Map<String, Long> createdIndex = new LinkedHashMap<>();
        for (BackupEngine.FileRecord r : sorted) createdIndex.put(r.fileName, createdAt(r));

        List<String> prune = new ArrayList<>();
        for (String name : candidates) {
            if (protectedNames.contains(name) || prune.contains(name)) continue;
            prune.add(name);
        }
        // Oldest first: an interruption leaves the newest files behind.
        Collections.sort(prune, new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                Long ta = createdIndex.get(a);
                Long tb = createdIndex.get(b);
                return Long.compare(ta == null ? 0 : ta, tb == null ? 0 : tb);
            }
        });
        return prune;
    }

    private static void collectExpired(
        Map<String, List<BackupEngine.FileRecord>> buckets,
        int limit,
        List<String> out
    ) {
        int effectiveLimit = Math.max(0, limit);
        List<String> keys = new ArrayList<>(buckets.keySet());
        Collections.sort(keys, Collections.<String>reverseOrder()); // newest period first
        for (int i = 0; i < keys.size(); i++) {
            List<BackupEngine.FileRecord> members = buckets.get(keys.get(i));
            if (members == null) continue;
            // Members are newest-first; keep only index 0 within kept periods, prune duplicates & expired buckets.
            for (int pos = 0; pos < members.size(); pos++) {
                BackupEngine.FileRecord r = members.get(pos);
                String kind = r.manifest == null ? "" : r.manifest.optString("kind", "");
                if (ALWAYS_KEEP_KINDS.contains(kind)) continue;
                if (pos > 0 || i >= effectiveLimit) {
                    out.add(r.fileName);
                }
            }
        }
    }

    private static void add(Map<String, List<BackupEngine.FileRecord>> map, String key, BackupEngine.FileRecord r) {
        List<BackupEngine.FileRecord> list = map.get(key);
        if (list == null) {
            list = new ArrayList<>();
            map.put(key, list);
        }
        list.add(r);
    }

    private static long createdAt(BackupEngine.FileRecord r) {
        return r.manifest == null ? 0 : parseIso(r.manifest.optString("createdAt", ""));
    }

    private static long parseIso(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        try {
            SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            return fmt.parse(iso).getTime();
        } catch (Exception e) {
            try {
                SimpleDateFormat fmtNoMs = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                fmtNoMs.setTimeZone(TimeZone.getTimeZone("UTC"));
                return fmtNoMs.parse(iso).getTime();
            } catch (Exception ignored) {
                return 0;
            }
        }
    }

    /**
     * Converts a UTC ISO timestamp to local calendar fields using Java's
     * TimeZone.getOffset(ms)/60000 convention (positive east of UTC, e.g. +120 for UTC+2).
     */
    private static Calendar localCalendar(String iso, int offsetMinutes) {
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.US);
        cal.setFirstDayOfWeek(Calendar.MONDAY);
        cal.setMinimalDaysInFirstWeek(4);
        cal.setTimeInMillis(parseIso(iso) + offsetMinutes * 60000L);
        return cal;
    }

    static String dailyKey(String iso, int offsetMinutes) {
        Calendar c = localCalendar(iso, offsetMinutes);
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static String monthlyKey(String iso, int offsetMinutes) {
        Calendar c = localCalendar(iso, offsetMinutes);
        return String.format(Locale.US, "%04d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1);
    }

    /** ISO week key (Monday-based, week 1 contains Jan 4) — "2026-W46". */
    static String weeklyKey(String iso, int offsetMinutes) {
        Calendar c = localCalendar(iso, offsetMinutes);
        // Match the TypeScript ISO-week computation: the ISO year of the week.
        int weekYear = c.get(Calendar.YEAR);
        int week = c.get(Calendar.WEEK_OF_YEAR);
        int month = c.get(Calendar.MONTH) + 1;
        if (month == 1 && week >= 52) weekYear = weekYear - 1;
        if (month == 12 && week == 1) weekYear = weekYear + 1;
        return String.format(Locale.US, "%04d-W%02d", weekYear, week);
    }

    /** True when no verified backup of `kind` exists yet for the current period. */
    static boolean shouldCreate(String kind, long nowMs, List<BackupEngine.FileRecord> records, int offsetMinutes) {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        String currentIso = fmt.format(new Date(nowMs));
        String currentKey = keyOf(kind, currentIso, offsetMinutes);
        for (BackupEngine.FileRecord r : records) {
            if (r.manifest == null) continue;
            if (!"verified".equals(r.status)) continue;
            if (!kind.equals(r.manifest.optString("kind", ""))) continue;
            String key = keyOf(kind, r.manifest.optString("createdAt", ""), offsetMinutes);
            if (currentKey.equals(key)) return false;
        }
        return true;
    }

    private static String keyOf(String kind, String iso, int offsetMinutes) {
        if ("daily".equals(kind)) return dailyKey(iso, offsetMinutes);
        if ("weekly".equals(kind)) return weeklyKey(iso, offsetMinutes);
        return monthlyKey(iso, offsetMinutes);
    }
}
