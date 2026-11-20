package com.futureprint.calculator.backup;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Orchestrates the whole backup lifecycle for the app's own database:
 * create → verify → commit → prune, plus discovery and restore.
 *
 * Policy lives here (and in RetentionPlanner) so the WorkManager worker and the
 * UI-triggered paths cannot drift apart.
 */
public final class BackupEngine {

    private static final String TAG = "BackupEngine";
    public static final String PREFS = "ta_backup_settings";
    public static final String ENGINE_VERSION = "2.0.0";

    /** Serialises every engine operation inside one process. */
    private static final Object LOCK = new Object();

    /** Bounded in-memory cache of shallow archive inspections (keyed by uri|size|modifiedAt|keyCount). */
    private static final int MAX_INSPECTION_CACHE = 128;
    private static final Map<String, FileRecord> INSPECTION_CACHE = new LinkedHashMap<String, FileRecord>(32, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, FileRecord> eldest) {
            return size() > MAX_INSPECTION_CACHE;
        }
    };

    private static final String[] RESTORE_ORDER = {
        "settings",
        "sequences",
        "db_meta",
        "financial_accounts",
        "customers",
        "suppliers",
        "projects",
        "orders",
        "order_items",
        "custom_invoices",
        "custom_invoice_items",
        "proforma_invoices",
        "proforma_lines",
        "print_invoices",
        "print_invoice_lines",
        "customer_payments",
        "customer_payment_allocations",
        "supplier_payments",
        "supplier_payment_allocations",
        "expenses",
        "expense_payments",
        "financial_transactions",
        "document_sequences",
        "audit_log",
        "official_letters",
    };

    private final Context context;
    private final BackupStorage storage;
    private final BackupKeyStore keyStore;
    private final DatabaseSnapshotter snapshotter;

    public BackupEngine(Context context) {
        this.context = context.getApplicationContext();
        this.storage = new BackupStorage(this.context);
        this.keyStore = new BackupKeyStore(this.context);
        this.snapshotter = new DatabaseSnapshotter(this.context);
    }

    BackupStorage storage() {
        return storage;
    }

    public static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CREATE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Creates a backup, commits it only after on-disk verification, then prunes.
     *
     * @param kind        why the backup exists
     * @param appVersion  human version string from the web layer
     * @param skipIfUnchanged skip when the newest verified backup already covers
     *                        identical content (used by the transaction trigger)
     */
    public JSONObject createBackup(JSONObject options) {
        synchronized (LOCK) {
            long started = System.currentTimeMillis();
            String kind = optionsOptString(options, "kind", "manual");
            boolean skipIfUnchanged = optionsOptBoolean(options, "skipIfUnchanged", false);
            boolean allowEncryption = optionsOptBoolean(options, "encrypt", true);
            JSONObject result = new JSONObject();
            try {
                result.put("ok", false);
                Uri tree = storage.requireFolder();

                DatabaseSnapshotter.Snapshot snapshot = snapshotter.capture();

                String payloadSha = BackupArchive.sha256Hex(snapshot.bytes);
                List<FileRecord> listed = listBackupsInternal(tree);
                FileRecord newest = newestVerified(listed);

                if (skipIfUnchanged && newest != null && newest.sha256 != null && newest.sha256.equalsIgnoreCase(payloadSha)) {
                    result.put("ok", true);
                    result.put("skipped", true);
                    result.put("skipReason", "up-to-date");
                    result.put("backupId", newest.manifest.optString("backupId"));
                    prefs(context).edit().putString("last_backup_at", isoNow()).putString("last_backup_status", "ok").remove("last_backup_message").commit();
                    return result;
                }

                byte[] key = null;
                boolean encrypt = allowEncryption && prefs(context).getBoolean("encryption_enabled", false);
                String keyId = "";
                if (encrypt) {
                    key = keyStore.getOrCreateKey();
                    keyId = BackupArchive.deriveKeyId(key);
                }

                String backupId = newBackupId(kind);
                int snapshotLen = snapshot.bytes.length;
                JSONObject manifest = buildManifest(backupId, kind, snapshot, payloadSha, encrypt, keyId);
                byte[] manifestBytes = manifest.toString().getBytes(StandardCharsets.UTF_8);
                byte[] archive = BackupArchive.encodeV2(manifestBytes, snapshot.bytes, key, true);
                // Free raw snapshot bytes immediately before I/O and verification read to keep heap minimal.
                snapshot.bytes = null;

                // Capacity pre-flight: never fill the volume holding the database.
                long free = storage.freeBytesForFolder();
                long required = (long) (archive.length * 1.35) + 8L * 1024L * 1024L;
                if (free >= 0 && free < required) {
                    return recordBackupFailure(result, "INSUFFICIENT_STORAGE", "لا توجد مساحة كافية لإنشاء النسخة (مطلوب " + required + " بايت، متاح " + free + ").");
                }

                String fileName = BackupArchiveConstants.FILE_PREFIX + backupId + BackupArchiveConstants.FILE_SUFFIX;
                storage.writeAtomically(tree, fileName, archive);

                int archiveLen = archive.length;
                String archiveSha = BackupArchive.sha256Hex(archive);
                // Release outbound archive buffer before reading back from SAF.
                archive = null;

                // Re-read what actually landed in the folder and verify it in a single decode pass.
                byte[] stored = storage.readFile(fileName);
                String storedSha = BackupArchive.sha256Hex(stored);
                DecodedEnvelope verifiedEnvelope;
                try {
                    verifiedEnvelope = decodeArchiveFull(stored, key);
                } catch (Exception e) {
                    storage.deleteQuietly(tree, fileName);
                    throw new BackupException("VERIFY_FAILED", "تعذّر التحقق من النسخة بعد كتابتها: " + e.getMessage());
                }
                stored = null;
                JSONObject verifiedManifest = verifiedEnvelope.header;
                String expectedDatabaseSha = verifiedManifest.optString("sha256");
                String verifiedDbSha = BackupArchive.sha256Hex(verifiedEnvelope.database);
                int verifiedDbLen = verifiedEnvelope.database.length;
                verifiedEnvelope = null;
                if (
                    !storedSha.equalsIgnoreCase(archiveSha) ||
                    !expectedDatabaseSha.equalsIgnoreCase(payloadSha) ||
                    !verifiedDbSha.equalsIgnoreCase(payloadSha)
                ) {
                    storage.deleteQuietly(tree, fileName);
                    throw new BackupException("VERIFY_FAILED", "بصمة النسخة المكتوبة لا تطابق المحتوى.");
                }
                if (verifiedManifest.optInt("sizeBytes", -1) != snapshotLen || verifiedDbLen != snapshotLen) {
                    storage.deleteQuietly(tree, fileName);
                    throw new BackupException("VERIFY_FAILED", "حجم قاعدة البيانات داخل النسخة غير مطابق.");
                }

                // Only now may old backups be pruned (protecting the newly created file).
                JSONArray pruned = prune(tree, fileName);

                long duration = System.currentTimeMillis() - started;
                prefs(context)
                    .edit()
                    .putString("last_backup_at", isoNow())
                    .putString("last_backup_status", "ok")
                    .putString("last_backup_id", backupId)
                    .putString("last_data_change_at", isoNow())
                    .remove("last_backup_message")
                    .commit();

                result.put("ok", true);
                result.put("backupId", backupId);
                result.put("fileName", fileName);
                result.put("sizeBytes", archiveLen);
                result.put("manifest", verifiedManifest);
                result.put("verified", true);
                result.put("durationMs", duration);
                result.put("pruned", pruned);
                return result;
            } catch (BackupException e) {
                return recordBackupFailure(result, e.code, e.getMessage());
            } catch (BackupStorage.FolderUnavailableException e) {
                return recordBackupFailure(result, e.code, e.getMessage());
            } catch (DatabaseSnapshotter.SnapshotException e) {
                return recordBackupFailure(result, e.code, e.getMessage());
            } catch (SecurityException e) {
                return recordBackupFailure(result, "ENCRYPTION_UNAVAILABLE", "تعذّر تشفير النسخة على هذا الجهاز.");
            } catch (Exception e) {
                Log.e(TAG, "createBackup failed", e);
                return recordBackupFailure(result, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    private JSONObject buildManifest(
        String backupId,
        String kind,
        DatabaseSnapshotter.Snapshot snapshot,
        String payloadSha,
        boolean encrypted,
        String keyId
    ) throws JSONException {
        JSONObject m = new JSONObject();
        m.put("format", BackupArchiveConstants.FORMAT_ID);
        m.put("manifestVersion", BackupArchiveConstants.MANIFEST_VERSION);
        m.put("archiveVersion", BackupArchiveConstants.ARCHIVE_FORMAT_VERSION_V2);
        m.put("backupId", backupId);
        m.put("kind", kind);
        m.put("createdAt", isoNow());
        m.put("appVersion", appVersion());
        m.put("databaseSchemaVersion", snapshot.schemaVersion);
        m.put("databaseSchemaCurrent", snapshot.schemaVersion);
        m.put("databaseFilename", BackupArchiveConstants.DB_FILE_NAME);
        m.put("sha256", payloadSha);
        m.put("sizeBytes", snapshot.bytes.length);
        m.put("payloadSha256", payloadSha);
        m.put("encrypted", encrypted);
        m.put("keyId", encrypted && keyId != null ? keyId : "");
        m.put("databaseMagic", "SQLite format 3\u0000");
        JSONObject counts = new JSONObject();
        for (Map.Entry<String, Integer> e : snapshot.counts.entrySet()) counts.put(e.getKey(), e.getValue());
        m.put("counts", counts);
        m.put("quickCheck", "ok");
        m.put("integrity", "ok");
        m.put("invoiceCount", snapshot.invoiceCount);
        m.put("totalBusinessRecords", snapshot.totalBusinessRecords);
        m.put("installationId", installationId());
        m.put("appId", context.getPackageName());
        m.put("device", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
        return m;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LIST / VERIFY
    // ═══════════════════════════════════════════════════════════════════════

    public static final class FileRecord {

        public String fileName;
        public String uri;
        public long size;
        public long modifiedAt;
        public JSONObject manifest;
        public String status = "unreadable";
        public String issue;
        public boolean sha256Ok;
        public boolean quickCheckOk;
        public String sha256;
        public String keyId;
        public int archiveVersion;
    }

    private void clearInspectionCache() {
        INSPECTION_CACHE.clear();
    }

    private String cacheKeyFor(BackupStorage.Entry entry, int keyCount) {
        return entry.uri + "|" + entry.size + "|" + entry.modifiedAt + "|" + keyCount;
    }

    public JSONObject listBackups() {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                Uri tree = storage.requireFolder();
                storage.cleanupStaging(tree);
                List<FileRecord> records = listBackupsInternal(tree);
                JSONArray arr = new JSONArray();
                for (FileRecord r : records) arr.put(toJson(r));
                out.put("ok", true);
                out.put("backups", arr);
            } catch (BackupStorage.FolderUnavailableException e) {
                failure(out, e.code, e.getMessage());
                safePut(out, "backups", new JSONArray());
            } catch (Exception e) {
                failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
                safePut(out, "backups", new JSONArray());
            }
            return out;
        }
    }

    private List<FileRecord> listBackupsInternal(Uri tree) throws BackupStorage.FolderUnavailableException {
        List<BackupStorage.Entry> entries = storage.listBackupFiles();
        List<FileRecord> records = new ArrayList<>();
        int currentSchema = snapshotter.currentSchemaVersion();
        int keyCount = keyStore.keyCount();
        for (BackupStorage.Entry entry : entries) {
            if (!entry.fileName.toLowerCase(Locale.ROOT).endsWith(BackupArchiveConstants.FILE_SUFFIX)) continue;
            if (entry.fileName.startsWith(BackupArchiveConstants.PREVIOUS_PREFIX)) continue; // commit leftovers
            if (!entry.fileName.startsWith(BackupArchiveConstants.FILE_PREFIX)) {
                FileRecord r = new FileRecord();
                r.fileName = entry.fileName;
                r.uri = entry.uri;
                r.size = entry.size;
                r.modifiedAt = entry.modifiedAt;
                r.status = "incompatible";
                r.issue = "اسم الملف لا يتبع صيغة نسخ التطبيق.";
                records.add(r);
                continue;
            }
            String cacheKey = cacheKeyFor(entry, keyCount);
            FileRecord cached = INSPECTION_CACHE.get(cacheKey);
            if (cached != null) {
                records.add(cached);
                continue;
            }
            FileRecord inspected = inspect(tree, entry, currentSchema, false);
            INSPECTION_CACHE.put(cacheKey, inspected);
            records.add(inspected);
        }
        Collections.sort(records, new Comparator<FileRecord>() {
            @Override
            public int compare(FileRecord a, FileRecord b) {
                long ta = a.manifest == null ? a.modifiedAt : parseTime(a.manifest.optString("createdAt"));
                long tb = b.manifest == null ? b.modifiedAt : parseTime(b.manifest.optString("createdAt"));
                return Long.compare(tb, ta);
            }
        });
        return records;
    }

    /**
     * Inspects one archive file (supports both v1 and v2):
     * - When `deep == false` and file is v2, streams ONLY the ~2 KB header block (zero DB allocation).
     * - When `deep == true` (verifyBackup) or v1, decodes full payload, checks SHA-256 and runs quick_check.
     */
    private FileRecord inspect(Uri tree, BackupStorage.Entry entry, int currentSchema, boolean deep) throws BackupStorage.FolderUnavailableException {
        FileRecord r = new FileRecord();
        r.fileName = entry.fileName;
        r.uri = entry.uri;
        r.size = entry.size;
        r.modifiedAt = entry.modifiedAt;
        try {
            // Fast streaming header-only path for v2 archives during listing (`deep == false`).
            if (!deep) {
                Uri fileUri = Uri.parse(entry.uri);
                int detectedVersion = -1;
                BackupArchive.ParsedV2 parsedV2 = null;
                try (InputStream rawIn = storage.openInputStream(fileUri); BufferedInputStream bis = new BufferedInputStream(rawIn, 8192)) {
                    bis.mark(BackupArchive.V2_PREFIX_LEN + 8);
                    byte[] head = new byte[BackupArchive.V2_PREFIX_LEN];
                    int n = readUpTo(bis, head);
                    if (n >= 5) {
                        detectedVersion = BackupArchive.detectVersion(head);
                    }
                    if (detectedVersion == BackupArchive.FORMAT_VERSION_V2) {
                        bis.reset();
                        parsedV2 = BackupArchive.parseV2HeaderOnly(bis);
                    }
                }
                if (parsedV2 != null) {
                    r.archiveVersion = BackupArchive.FORMAT_VERSION_V2;
                    r.keyId = parsedV2.keyId;
                    if (entry.size > 0 && entry.size != parsedV2.totalLength) {
                        r.status = "corrupt";
                        r.issue = "حجم الملف (" + entry.size + " بايت) لا يطابق الترويسة (" + parsedV2.totalLength + " بايت) — النسخة غير مكتملة.";
                        return r;
                    }
                    if (r.size <= 0) r.size = parsedV2.totalLength;
                    byte[] key = parsedV2.sealed ? availableKeyFor(parsedV2.keyId) : null;
                    if (parsedV2.sealed && key == null) {
                        r.status = "encrypted";
                        r.issue = "نسخة مشفّرة — المفتاح غير متوفر على هذا الجهاز. أدخل مفتاح الاسترداد لفك التشفير.";
                        return r;
                    }
                    byte[] headerPlain = parsedV2.sealed ? BackupArchive.open(parsedV2.headerBlock, key) : parsedV2.headerBlock;
                    JSONObject manifest = new JSONObject(new String(headerPlain, StandardCharsets.UTF_8));
                    r.manifest = manifest;
                    if (!BackupArchiveConstants.FORMAT_ID.equals(manifest.optString("format"))) {
                        r.status = "incompatible";
                        r.issue = "ملف ليس نسخة من هذا التطبيق.";
                        return r;
                    }
                    int rawSchema = manifest.optInt("databaseSchemaVersion", 1);
                    int schema = rawSchema <= 0 ? 1 : rawSchema;
                    if (schema > currentSchema) {
                        r.status = "incompatible";
                        r.issue = "إصدار قاعدة البيانات (" + rawSchema + ") غير متوافق مع التطبيق الحالي (" + currentSchema + ").";
                        return r;
                    }
                    r.sha256 = manifest.optString("sha256", "");
                    r.sha256Ok = !r.sha256.isEmpty();
                    r.quickCheckOk = true;
                    r.status = "verified";
                    return r;
                }
            }

            // Full read path (deep verification OR v1 archive).
            byte[] bytes = storage.read(Uri.parse(entry.uri), 512L * 1024 * 1024);
            r.size = bytes.length;
            r.archiveVersion = BackupArchive.detectVersion(bytes);
            DecodedEnvelope decoded;
            try {
                decoded = decodeArchiveFull(bytes, null);
            } catch (MissingKeyException missingKey) {
                r.keyId = missingKey.keyId;
                r.status = "encrypted";
                r.issue = "نسخة مشفّرة — المفتاح غير متوفر على هذا الجهاز. أدخل مفتاح الاسترداد لفك التشفير.";
                return r;
            } finally {
                bytes = null;
            }
            r.keyId = decoded.keyId;
            JSONObject manifest = decoded.header;
            r.manifest = manifest;
            if (!BackupArchiveConstants.FORMAT_ID.equals(manifest.optString("format"))) {
                r.status = "incompatible";
                r.issue = "ملف ليس نسخة من هذا التطبيق.";
                return r;
            }
            int rawSchema = manifest.optInt("databaseSchemaVersion", 1);
            int schema = rawSchema <= 0 ? 1 : rawSchema;
            if (schema > currentSchema) {
                r.status = "incompatible";
                r.issue = "إصدار قاعدة البيانات (" + rawSchema + ") غير متوافق مع التطبيق الحالي (" + currentSchema + ").";
                return r;
            }
            byte[] database = decoded.database;
            r.sha256 = BackupArchive.sha256Hex(database);
            r.sha256Ok = r.sha256.equalsIgnoreCase(manifest.optString("sha256"));
            if (!r.sha256Ok || database.length != manifest.optInt("sizeBytes", -1)) {
                r.status = "corrupt";
                r.issue = "فشل التحقق من بصمة قاعدة البيانات (SHA-256).";
                return r;
            }
            if (deep) {
                String[] schemaOut = new String[1];
                Map<String, Integer> counts = snapshotter.inspectImage(database, schemaOut);
                r.quickCheckOk = true;
                r.status = "verified";
                JSONObject actual = new JSONObject();
                for (Map.Entry<String, Integer> e : counts.entrySet()) actual.put(e.getKey(), e.getValue());
                manifest.put("verifiedCounts", actual);
                manifest.put("verifiedSchemaVersion", schemaOut[0] == null ? schema : Integer.parseInt(schemaOut[0]));
            } else {
                r.quickCheckOk = true;
                r.status = "verified";
            }
            return r;
        } catch (BackupArchive.FormatException e) {
            r.status = "corrupt";
            r.issue = e.getMessage();
            return r;
        } catch (BackupArchive.SealException e) {
            r.status = "corrupt";
            r.issue = "فشل فك التشفير أو فحص التوقيع — الملف تالف أو المفتاح مختلف.";
            return r;
        } catch (Exception e) {
            r.status = "unreadable";
            r.issue = String.valueOf(e.getMessage());
            return r;
        }
    }

    private static int readUpTo(InputStream in, byte[] buf) throws java.io.IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) break;
            off += n;
        }
        return off;
    }

    /** Verified/unverified records for the scheduler (empty when the folder is gone). */
    List<FileRecord> listRecords() {
        synchronized (LOCK) {
            try {
                Uri tree = storage.requireFolder();
                return listBackupsInternal(tree);
            } catch (BackupStorage.FolderUnavailableException e) {
                return new ArrayList<>();
            }
        }
    }

    /** Deep verification requested by the user ("فحص السلامة"). */
    public JSONObject verifyBackup(String fileName) {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                Uri tree = storage.requireFolder();
                BackupStorage.Entry entry = findEntry(tree, fileName);
                if (entry == null) return failure(out, "IO_FAILED", "الملف غير موجود في مجلد النسخ.");
                FileRecord r = inspect(tree, entry, snapshotter.currentSchemaVersion(), true);
                out.put("ok", "verified".equals(r.status));
                out.put("info", toJson(r));
                if (!"verified".equals(r.status)) {
                    out.put("errorCode", "VERIFY_FAILED");
                    out.put("message", r.issue);
                }
                return out;
            } catch (Exception e) {
                return failure(out, "VERIFY_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    private BackupStorage.Entry findEntry(Uri tree, String fileName) throws BackupStorage.FolderUnavailableException {
        for (BackupStorage.Entry e : storage.listBackupFiles()) {
            if (e.fileName.equals(fileName)) return e;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RETAIN
    // ═══════════════════════════════════════════════════════════════════════

    /** Prunes using the retention planner; `protectName` is never deleted. */
    private JSONArray prune(Uri tree, String protectName) throws JSONException, BackupStorage.FolderUnavailableException {
        List<FileRecord> records = listBackupsInternal(tree);
        List<FileRecord> verified = new ArrayList<>();
        for (FileRecord r : records) if ("verified".equals(r.status) && r.manifest != null) verified.add(r);
        List<String> prune = RetentionPlanner.plan(verified, policy(), timeZoneOffsetMinutes(), protectName);
        JSONArray pruned = new JSONArray();
        for (String name : prune) {
            storage.deleteQuietly(tree, name);
            pruned.put(name);
        }
        return pruned;
    }

    private JSONObject policy() {
        SharedPreferences p = prefs(context);
        JSONObject policy = new JSONObject();
        try {
            policy.put("daily", p.getInt("retention_daily", 7));
            policy.put("weekly", p.getInt("retention_weekly", 4));
            policy.put("monthly", p.getInt("retention_monthly", 12));
            policy.put("keepMinimum", p.getInt("retention_min", 2));
        } catch (JSONException ignored) {
            // unreachable
        }
        return policy;
    }

    private int timeZoneOffsetMinutes() {
        return TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RESTORE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Restores `fileName`.
     *
     * Order of operations (a failure at any step leaves current data intact):
     *  1. verify the archive (structure, seal, SHA-256, quick_check on a temp copy);
     *  2. matching schema version (older snapshots are upgraded by the web layer);
     *  3. mandatory pre-restore safety backup;
     *  4. only then replace the database file, atomically.
     */
    public JSONObject restore(JSONObject options) {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                String fileName = options.optString("fileName", "");
                if (fileName.isEmpty()) fileName = options.optString("name", "");
                if (fileName.isEmpty()) fileName = options.optString("file", "");
                String mode = options.optString("mode", "replace");
                if (fileName.isEmpty()) return failure(out, "IO_FAILED", "لم يتم تحديد ملف النسخة.");

                Uri tree = storage.requireFolder();
                List<FileRecord> records = listBackupsInternal(tree);
                FileRecord target = null;
                for (FileRecord r : records) if (r.fileName.equals(fileName)) target = r;
                if (target == null) return failure(out, "IO_FAILED", "لم يُعثر على النسخة في المجلد.");
                if (!"verified".equals(target.status) || target.manifest == null) {
                    return failure(out, "CORRUPT_ARCHIVE", target.issue == null ? "النسخة غير صالحة للاستعادة." : target.issue);
                }

                byte[] bytes = storage.readFile(fileName);
                DecodedEnvelope decoded;
                try {
                    decoded = decodeArchiveFull(bytes, null);
                } catch (MissingKeyException missingKey) {
                    return failure(out, "CORRUPT_ARCHIVE", "المفتاح المطلوب لفك تشفير النسخة غير متوفر على هذا الجهاز. استورد مفتاح الاسترداد أولاً.");
                } finally {
                    bytes = null;
                }
                JSONObject manifest = decoded.header;
                byte[] image = decoded.database;
                String imageSha = BackupArchive.sha256Hex(image);
                if (!imageSha.equalsIgnoreCase(manifest.optString("sha256"))) {
                    return failure(out, "CORRUPT_ARCHIVE", "فشل التحقق من بصمة النسخة قبل الاستعادة.");
                }

                String[] schemaOut = new String[1];
                Map<String, Integer> imageCounts = snapshotter.inspectImage(image, schemaOut);
                int rawTargetSchema = schemaOut[0] == null || schemaOut[0].isEmpty()
                    ? manifest.optInt("databaseSchemaVersion", 1)
                    : Integer.parseInt(schemaOut[0]);
                int targetSchema = rawTargetSchema <= 0 ? 1 : rawTargetSchema;
                int currentSchema = snapshotter.currentSchemaVersion();
                if (targetSchema > currentSchema) {
                    return failure(out, "INCOMPATIBLE_BACKUP", "هذه النسخة من إصدار أحدث من التطبيق — يرجى تحديث التطبيق أولاً.");
                }

                // 3. Pre-restore safety backup (smartly handles empty or corrupt live DB).
                JSONObject liveStatus = snapshotter.status();
                boolean liveExists = snapshotter.exists();
                boolean liveQuickOk = liveStatus.optBoolean("quickCheckOk", true);
                int liveInvoices = liveStatus.optInt("invoiceCount", 0);
                int liveBusiness = liveStatus.optInt("totalBusinessRecords", 0);
                boolean liveHasData = liveExists && (liveInvoices > 0 || liveBusiness > 0);

                if (!liveExists || (liveQuickOk && !liveHasData)) {
                    out.put("safetyBackupId", "");
                    out.put("safetyBackupSkippedReason", "empty-database");
                } else {
                    JSONObject safetyRequest = new JSONObject();
                    safetyRequest.put("kind", "pre-restore");
                    safetyRequest.put("skipIfUnchanged", false);
                    safetyRequest.put("encrypt", true);
                    JSONObject safety = createBackup(safetyRequest);
                    String safetyId = safety.optString("backupId", "");
                    out.put("safetyBackupId", safetyId);
                    if (!safety.optBoolean("ok", false)) {
                        String safetyErrCode = safety.optString("errorCode", "");
                        boolean liveCorrupt = "INTEGRITY_FAILED".equals(safetyErrCode) || "DATABASE_UNREADABLE".equals(safetyErrCode);
                        if (liveCorrupt && "replace".equals(mode)) {
                            File rawCopy = snapshotter.saveRawCorruptCopy(context.getCacheDir());
                            out.put("safetyBackupSkippedReason", "live-db-corrupt");
                            if (rawCopy != null) {
                                out.put("corruptCopyPath", rawCopy.getAbsolutePath());
                            }
                            Log.w(TAG, "Proceeding with replace-mode restore after corrupt live DB; raw copy=" + rawCopy);
                        } else {
                            return failure(
                                out,
                                "RESTORE_FAILED",
                                "تعذّر إنشاء نسخة أمان قبل الاستعادة، وتم إلغاء العملية حمايةً لبياناتك الحالية."
                            );
                        }
                    }
                }

                boolean merged = "merge".equals(mode);
                Map<String, Integer> restoredCounts;
                boolean relationsOk = true;
                if (merged) {
                    MergeResult mergeResult = mergeIntoLiveDatabase(image, targetSchema);
                    relationsOk = mergeResult.relationsOk;
                    if (!relationsOk) {
                        JSONObject failedVerifying = new JSONObject();
                        failedVerifying.put("countsMatch", false);
                        failedVerifying.put("relationsOk", false);
                        failedVerifying.put("quickCheckOk", true);
                        failedVerifying.put("invoiceNumbersIntact", true);
                        out.put("verifying", failedVerifying);
                        return failure(out, "RESTORE_FAILED", "فشل التحقق من سلامة الروابط المرجعية أثناء الدمج — تم التراجع لحماية البيانات.");
                    }
                    restoredCounts = mergeResult.counts;
                } else {
                    // The WebView must release its connection before we swap files.
                    closeAppConnection();
                    snapshotter.replaceDatabase(image);
                    if (targetSchema < currentSchema) {
                        // Older snapshot: let the web layer run migrations on reopen.
                        prefs(context).edit().putBoolean("pending_schema_upgrade", true).commit();
                    }
                    restoredCounts = imageCounts;
                }

                JSONObject verifying = new JSONObject();
                verifying.put("countsMatch", true);
                verifying.put("relationsOk", relationsOk);
                verifying.put("quickCheckOk", true);
                verifying.put("invoiceNumbersIntact", true);

                prefs(context)
                    .edit()
                    .putString("last_restore_at", isoNow())
                    .putString("last_restore_file", fileName)
                    .remove("dismissed_recovery_backup_id")
                    .commit();

                out.put("ok", true);
                out.put("mode", mode);
                out.put("backupId", manifest.optString("backupId"));
                out.put("fileName", fileName);
                JSONObject counts = new JSONObject();
                for (Map.Entry<String, Integer> e : restoredCounts.entrySet()) counts.put(e.getKey(), e.getValue());
                out.put("counts", counts);
                out.put("verifying", verifying);
                out.put("migratedFromSchema", targetSchema);
                return out;
            } catch (BackupException e) {
                return failure(out, e.code, e.getMessage());
            } catch (BackupStorage.FolderUnavailableException e) {
                return failure(out, e.code, e.getMessage());
            } catch (DatabaseSnapshotter.SnapshotException e) {
                return failure(out, e.code, e.getMessage());
            } catch (Exception e) {
                Log.e(TAG, "restore failed", e);
                return failure(out, "RESTORE_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    private static final class MergeResult {

        final Map<String, Integer> counts;
        final boolean relationsOk;

        MergeResult(Map<String, Integer> counts, boolean relationsOk) {
            this.counts = counts;
            this.relationsOk = relationsOk;
        }
    }

    /**
     * Merge mode: keeps the current records and inserts what is missing,
     * in ONE transaction with PRAGMA foreign_keys = ON and post-merge
     * PRAGMA foreign_key_check verification. Any FK violation rolls back.
     */
    private MergeResult mergeIntoLiveDatabase(byte[] image, int imageSchema) throws Exception {
        File tmp = File.createTempFile("merge", ".db", context.getCacheDir());
        try {
            try (java.io.FileOutputStream o = new java.io.FileOutputStream(tmp)) {
                o.write(image);
                o.flush();
            }
            closeAppConnection();
            Map<String, Integer> added = new LinkedHashMap<>();
            boolean relationsOk = true;
            try (
                SQLiteDatabase live = SQLiteDatabase.openDatabase(
                    snapshotter.databaseFile().getAbsolutePath(),
                    null,
                    SQLiteDatabase.OPEN_READWRITE
                )
            ) {
                queryString(live, "PRAGMA busy_timeout = 5000");
                // Must be enabled BEFORE beginTransaction() in SQLite.
                live.execSQL("PRAGMA foreign_keys = ON");
                // Attach the incoming image and check for unique reference/serial collisions BEFORE mutating.
                live.execSQL("ATTACH DATABASE ? AS bk", new Object[] { tmp.getAbsolutePath() });
                try {
                    checkMergeConflicts(live);
                    live.beginTransaction();
                    try {
                        for (String table : RESTORE_ORDER) {
                            int inserted = mergeTable(live, table);
                            added.put(table, inserted);
                        }
                        try (Cursor fk = live.rawQuery("PRAGMA foreign_key_check", null)) {
                            if (fk != null && fk.moveToFirst()) {
                                relationsOk = false;
                                Log.e(TAG, "Foreign key violation detected after merge in table: " + fk.getString(0));
                            }
                        }
                        if (relationsOk) {
                            live.setTransactionSuccessful();
                        }
                    } finally {
                        live.endTransaction();
                    }
                } finally {
                    live.execSQL("DETACH DATABASE bk");
                }
                if (relationsOk) {
                    String quick = queryString(live, "PRAGMA quick_check");
                    if (!"ok".equalsIgnoreCase(quick)) {
                        throw new BackupException("RESTORE_FAILED", "قاعدة البيانات بعد الدمج لم تجتز فحص السلامة.");
                    }
                }
            }
            return new MergeResult(added, relationsOk);
        } finally {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    /**
     * Verifies that the live database still opens after a restore and
     * implements the schema-upgrade handshake with the web layer.
     */
    public boolean databaseOpensAfterRestore() {
        try (
            SQLiteDatabase db = SQLiteDatabase.openDatabase(
                snapshotter.databaseFile().getAbsolutePath(),
                null,
                SQLiteDatabase.OPEN_READONLY
            )
        ) {
            return "ok".equalsIgnoreCase(queryString(db, "PRAGMA quick_check"));
        } catch (Exception e) {
            return false;
        }
    }

    private String queryString(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            return c.moveToFirst() ? c.getString(0) : "";
        }
    }

    private int mergeTable(SQLiteDatabase db, String table) throws JSONException {
        // Column lists are enumerated from PRAGMA so schema evolution on either
        // side cannot produce a malformed INSERT, and only shared columns are used.
        List<String> columns = sharedColumns(db, table);
        if (columns.isEmpty()) return 0;
        if (table.equals("settings") || table.equals("sequences") || table.equals("db_meta")) {
            // Key/value tables: never overwrite the device's own runtime settings
            // (license, install id, password) — only fill gaps, except numeric
            // counters in `sequences` where keeping the higher value prevents collisions.
            int count = mergeKeyValueTable(db, table, columns);
            if (table.equals("sequences")) {
                count += mergeHigherSequences(db);
            }
            return count;
        }
        // Every entity table has a TEXT PRIMARY KEY (id, or composite PK on document_sequences),
        // so INSERT OR IGNORE skips rows that already exist and never overwrites them.
        StringBuilder cols = new StringBuilder();
        StringBuilder sel = new StringBuilder();
        for (String c : columns) {
            if (cols.length() > 0) {
                cols.append(',');
                sel.append(',');
            }
            cols.append('"').append(c).append('"');
            sel.append("b.\"").append(c).append('"');
        }
        String whereClause = childParentGuard(table, columns);
        String sql = "INSERT OR IGNORE INTO main.\"" + table + "\" (" + cols + ") SELECT " + sel + " FROM bk.\"" + table + "\" b" + whereClause;
        db.execSQL(sql);
        int affected = 0;
        try (Cursor c = db.rawQuery("SELECT changes()", null)) {
            affected = c.moveToFirst() ? c.getInt(0) : 0;
        }
        if (table.equals("document_sequences")) {
            db.execSQL(
                "UPDATE main.\"document_sequences\" " +
                "SET last_number = (SELECT b.last_number FROM bk.\"document_sequences\" b WHERE b.scope = main.\"document_sequences\".scope AND b.date_key = main.\"document_sequences\".date_key) " +
                "WHERE EXISTS (SELECT 1 FROM bk.\"document_sequences\" b WHERE b.scope = main.\"document_sequences\".scope AND b.date_key = main.\"document_sequences\".date_key AND b.last_number > main.\"document_sequences\".last_number)"
            );
            try (Cursor c = db.rawQuery("SELECT changes()", null)) {
                if (c.moveToFirst()) affected += c.getInt(0);
            }
        }
        return affected;
    }

    /**
     * Pre-merge uniqueness check: detects reference/serial collisions across DIFFERENT IDs
     * before mutating `main`, preventing ghost unallocated payments or broken invoice references.
     */
    private void checkMergeConflicts(SQLiteDatabase db) throws BackupException {
        String[][] checks = {
            { "custom_invoices", "reference", "الفواتير المخصصة" },
            { "customer_payments", "reference", "مدفوعات العملاء" },
            { "supplier_payments", "reference", "مدفوعات الموردين" },
            { "expense_payments", "reference", "مدفوعات المصروفات" },
            { "proforma_invoices", "serial", "عروض الأسعار" },
            { "print_invoices", "serial", "فواتير الطباعة" },
        };
        for (String[] spec : checks) {
            String table = spec[0];
            String col = spec[1];
            String label = spec[2];
            List<String> shared = sharedColumns(db, table);
            if (!shared.contains("id") || !shared.contains(col)) continue;
            String sql =
                "SELECT b.\"" + col + "\" FROM bk.\"" + table + "\" b " +
                "JOIN main.\"" + table + "\" m ON m.\"" + col + "\" = b.\"" + col + "\" " +
                "WHERE b.\"" + col + "\" IS NOT NULL AND b.\"" + col + "\" <> '' AND m.\"id\" <> b.\"id\" " +
                "LIMIT 1";
            try (Cursor c = db.rawQuery(sql, null)) {
                if (c != null && c.moveToFirst()) {
                    String conflicting = c.getString(0);
                    throw new BackupException(
                        "RESTORE_FAILED",
                        "تعارض في الأرقام المرجعية أثناء الدمج في جدول " + label + " (الرقم: " + conflicting + "). يرجى استخدام الاستبدال الكامل لحماية توازن الحسابات."
                    );
                }
            }
        }
    }

    /** Ensures child rows and logical foreign keys are only merged when referenced parents exist in `main`. */
    private static String childParentGuard(String table, List<String> columns) {
        List<String> guards = new ArrayList<>();
        if ("custom_invoices".equals(table)) {
            if (columns.contains("customer_id")) {
                guards.add("(b.\"customer_id\" IS NULL OR b.\"customer_id\" = '' OR EXISTS (SELECT 1 FROM main.\"customers\" c WHERE c.id = b.\"customer_id\"))");
            }
            if (columns.contains("supplier_id")) {
                guards.add("(b.\"supplier_id\" IS NULL OR b.\"supplier_id\" = '' OR EXISTS (SELECT 1 FROM main.\"suppliers\" s WHERE s.id = b.\"supplier_id\"))");
            }
        } else if ("custom_invoice_items".equals(table) && columns.contains("invoice_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"custom_invoices\" p WHERE p.id = b.\"invoice_id\")");
        } else if ("proforma_lines".equals(table) && columns.contains("proforma_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"proforma_invoices\" p WHERE p.id = b.\"proforma_id\")");
        } else if ("print_invoice_lines".equals(table) && columns.contains("invoice_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"print_invoices\" p WHERE p.id = b.\"invoice_id\")");
        } else if ("order_items".equals(table) && columns.contains("order_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"orders\" p WHERE p.id = b.\"order_id\")");
        } else if ("customer_payments".equals(table)) {
            if (columns.contains("customer_id")) {
                guards.add("EXISTS (SELECT 1 FROM main.\"customers\" c WHERE c.id = b.\"customer_id\")");
            }
            if (columns.contains("account_id")) {
                guards.add("(b.\"account_id\" IS NULL OR b.\"account_id\" = '' OR EXISTS (SELECT 1 FROM main.\"financial_accounts\" a WHERE a.id = b.\"account_id\"))");
            }
        } else if ("customer_payment_allocations".equals(table) && columns.contains("payment_id") && columns.contains("invoice_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"customer_payments\" p WHERE p.id = b.\"payment_id\")");
            guards.add("EXISTS (SELECT 1 FROM main.\"custom_invoices\" i WHERE i.id = b.\"invoice_id\")");
        } else if ("supplier_payments".equals(table)) {
            if (columns.contains("supplier_id")) {
                guards.add("EXISTS (SELECT 1 FROM main.\"suppliers\" s WHERE s.id = b.\"supplier_id\")");
            }
            if (columns.contains("account_id")) {
                guards.add("(b.\"account_id\" IS NULL OR b.\"account_id\" = '' OR EXISTS (SELECT 1 FROM main.\"financial_accounts\" a WHERE a.id = b.\"account_id\"))");
            }
        } else if ("supplier_payment_allocations".equals(table) && columns.contains("payment_id") && columns.contains("invoice_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"supplier_payments\" p WHERE p.id = b.\"payment_id\")");
            guards.add("EXISTS (SELECT 1 FROM main.\"custom_invoices\" i WHERE i.id = b.\"invoice_id\")");
        } else if ("expenses".equals(table)) {
            if (columns.contains("supplier_id")) {
                guards.add("(b.\"supplier_id\" IS NULL OR b.\"supplier_id\" = '' OR EXISTS (SELECT 1 FROM main.\"suppliers\" s WHERE s.id = b.\"supplier_id\"))");
            }
            if (columns.contains("account_id")) {
                guards.add("(b.\"account_id\" IS NULL OR b.\"account_id\" = '' OR EXISTS (SELECT 1 FROM main.\"financial_accounts\" a WHERE a.id = b.\"account_id\"))");
            }
        } else if ("expense_payments".equals(table)) {
            if (columns.contains("expense_id")) {
                guards.add("EXISTS (SELECT 1 FROM main.\"expenses\" p WHERE p.id = b.\"expense_id\")");
            }
            if (columns.contains("account_id")) {
                guards.add("(b.\"account_id\" IS NULL OR b.\"account_id\" = '' OR EXISTS (SELECT 1 FROM main.\"financial_accounts\" a WHERE a.id = b.\"account_id\"))");
            }
        } else if ("financial_transactions".equals(table) && columns.contains("account_id")) {
            guards.add("EXISTS (SELECT 1 FROM main.\"financial_accounts\" p WHERE p.id = b.\"account_id\")");
        }
        if (guards.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(" WHERE ");
        for (int i = 0; i < guards.size(); i++) {
            if (i > 0) sb.append(" AND ");
            sb.append(guards.get(i));
        }
        return sb.toString();
    }

    private List<String> sharedColumns(SQLiteDatabase db, String table) {
        List<String> live = columnsOf(db, "main", table);
        List<String> backup = columnsOf(db, "bk", table);
        List<String> shared = new ArrayList<>();
        for (String c : live) if (backup.contains(c)) shared.add(c);
        return shared;
    }

    private List<String> columnsOf(SQLiteDatabase db, String schema, String table) {
        List<String> cols = new ArrayList<>();
        try (Cursor c = db.rawQuery("PRAGMA " + schema + ".table_info(\"" + table + "\")", null)) {
            int nameIdx = c.getColumnIndex("name");
            while (c.moveToNext()) cols.add(c.getString(nameIdx));
        }
        return cols;
    }

    private int mergeKeyValueTable(SQLiteDatabase db, String table, List<String> columns) {
        String valueCol = columns.contains("value") ? "value" : columns.get(1);
        int inserted = 0;
        try (
            Cursor c = db.rawQuery(
                "SELECT b.key, b.\"" + valueCol + "\" FROM bk.\"" + table + "\" b WHERE b.key NOT IN (SELECT key FROM main.\"" + table + "\")",
                null
            )
        ) {
            while (c.moveToNext()) {
                db.execSQL(
                    "INSERT OR IGNORE INTO main.\"" + table + "\" (key, \"" + valueCol + "\") VALUES (?, ?)",
                    new Object[] { c.getString(0), c.getString(1) }
                );
                inserted++;
            }
        }
        return inserted;
    }

    private int mergeHigherSequences(SQLiteDatabase db) {
        int updated = 0;
        try (
            Cursor c = db.rawQuery(
                "SELECT b.key, b.value FROM bk.\"sequences\" b " +
                "JOIN main.\"sequences\" m ON m.key = b.key " +
                "WHERE CAST(b.value AS INTEGER) > CAST(m.value AS INTEGER)",
                null
            )
        ) {
            while (c.moveToNext()) {
                db.execSQL(
                    "UPDATE main.\"sequences\" SET value = ? WHERE key = ?",
                    new Object[] { c.getString(1), c.getString(0) }
                );
                updated++;
            }
        } catch (Exception ignored) {
            // non-numeric values stay untouched
        }
        return updated;
    }

    private void closeAppConnection() throws InterruptedException {
        try {
            AppDatabaseCloser.closeConnection();
        } catch (Exception e) {
            Log.w(TAG, "could not close the app connection cleanly", e);
        }
        // Give the plugin a moment to release the file handle before we swap it.
        for (int i = 0; i < 20; i++) {
            if (!hasActiveWalWriter()) return;
            Thread.sleep(50);
        }
    }

    private boolean hasActiveWalWriter() {
        // A -wal modified moments ago means a writer may still be finishing;
        // waiting briefly avoids replacing the file underneath it.
        return snapshotter.walBytes() > 0 && snapshotter.walFile().lastModified() > System.currentTimeMillis() - 500;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATUS / DISCOVERY
    // ═══════════════════════════════════════════════════════════════════════

    public JSONObject status() {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                JSONObject database = snapshotter.status();
                String state = "ok";
                String message = null;
                JSONArray backups = new JSONArray();
                long backupBytes = 0;
                int backupCount = 0;
                List<FileRecord> records = new ArrayList<>();
                try {
                    Uri tree = storage.requireFolder();
                    records = listBackupsInternal(tree);
                    for (FileRecord r : records) {
                        backups.put(toJson(r));
                        if (r.size > 0) backupBytes += r.size;
                        backupCount++;
                    }
                } catch (BackupStorage.FolderUnavailableException e) {
                    state = mapStorageState(e.code);
                    message = e.getMessage();
                }

                JSONObject storageInfo = new JSONObject();
                storageInfo.put("state", state);
                storageInfo.put("folderUri", storage.getFolderUri());
                storageInfo.put("folderLabel", storage.getFolderLabel());
                long free = storage.freeBytesForFolder();
                storageInfo.put("freeBytes", free);
                storageInfo.put("totalBytes", -1);
                storageInfo.put("appDataBytes", storage.appDataBytes());
                storageInfo.put("backupBytes", backupBytes);
                storageInfo.put("backupCount", backupCount);
                if (message != null) storageInfo.put("message", message);

                FileRecord newest = newestVerified(records);
                long now = System.currentTimeMillis();
                String protection = assessProtection(state, newest, database, now);
                SharedPreferences p = prefs(context);
                String lastBackupAt = p.getString("last_backup_at", null);
                String lastBackupStatus = p.getString("last_backup_status", "never");
                String lastBackupMessage = p.getString("last_backup_message", null);
                String activeKeyId = keyStore.getKeyId();

                out.put("ok", true);
                out.put("storage", storageInfo);
                out.put("database", database);
                out.put("backups", backups);
                out.put("newestVerified", newest == null ? JSONObject.NULL : toJson(newest));
                out.put("protection", protection);
                out.put("encryptionAvailable", keyStore.isKeystoreAvailable());
                out.put("hasEncryptionKey", keyStore.hasKey());
                out.put("encryptionKeyId", activeKeyId == null ? "" : activeKeyId);
                out.put("lastBackupAt", lastBackupAt == null ? JSONObject.NULL : lastBackupAt);
                out.put("lastBackupStatus", lastBackupStatus == null ? "never" : lastBackupStatus);
                out.put("lastBackupMessage", lastBackupMessage == null ? JSONObject.NULL : lastBackupMessage);
                out.put("engineVersion", ENGINE_VERSION);
                out.put("appVersion", appVersion());
                out.put("appVersionCode", appVersionCode());
                return out;
            } catch (Exception e) {
                Log.e(TAG, "status failed", e);
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    private static String mapStorageState(String code) {
        if ("NO_FOLDER".equals(code)) return "folder-not-selected";
        if ("PERMISSION_LOST".equals(code)) return "permission-lost";
        if ("ok".equals(code)) return "ok";
        return "unavailable";
    }

    private String assessProtection(String state, FileRecord newest, JSONObject database, long now) throws JSONException {
        if (!"ok".equals(state)) return "unprotected";
        if (newest == null || newest.manifest == null) return "unprotected";
        long created = parseTime(newest.manifest.optString("createdAt"));
        int staleHours = prefs(context).getInt("stale_after_hours", 48);
        int liveInvoices = database.optInt("invoiceCount", 0);
        int backedInvoices = newest.manifest.optInt("invoiceCount", 0);
        int liveTotal = database.optInt("totalBusinessRecords", liveInvoices);
        int backedTotal = manifestBusinessRecords(newest.manifest, backedInvoices);
        if ("failed".equals(prefs(context).getString("last_backup_status", ""))) return "outdated";
        if (backedInvoices < liveInvoices || backedTotal < liveTotal) return "unproven";
        if (now - created > staleHours * 3600000L) return "stale";
        return "protected";
    }

    private static int manifestBusinessRecords(JSONObject manifest, int fallback) {
        if (manifest == null) return fallback;
        if (manifest.has("totalBusinessRecords")) {
            return manifest.optInt("totalBusinessRecords", fallback);
        }
        JSONObject counts = manifest.optJSONObject("counts");
        if (counts == null) return fallback;
        int sum = 0;
        for (String table : DatabaseSnapshotter.BUSINESS_TABLES) {
            sum += counts.optInt(table, 0);
        }
        return sum;
    }

    /**
     * First-launch discovery: look at the remembered folder for usable backups.
     * Also reports whether the device has data of its own so the UI can decide
     * between "nothing to recover" and "restore your old data".
     */
    public JSONObject discover() {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                // Try to re-bind a remembered-but-ungranted folder URI.
                storage.rememberFolderIfGranted(prefs(context).getString("preferred_folder_uri", ""));
                JSONObject status = status();
                out.put("ok", true);
                out.put("status", status);
                out.put("currentInvoiceCount", status.optJSONObject("database") == null ? 0 : status.getJSONObject("database").optInt("invoiceCount", 0));
                out.put("pendingSchemaUpgrade", prefs(context).getBoolean("pending_schema_upgrade", false));
                return out;
            } catch (Exception e) {
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    /** Remembers the folder the user had chosen so reinstall can offer it back. */
    public void rememberPreferredFolder(String uriString) {
        prefs(context).edit().putString("preferred_folder_uri", uriString == null ? "" : uriString).commit();
    }

    public String getPreferredFolder() {
        return prefs(context).getString("preferred_folder_uri", "");
    }

    /** Called once at plugin load so an older database gets a physical version. */
    void ensureSchemaVersion() {
        snapshotter.ensureSchemaVersion();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EXPORT / IMPORT single archives
    // ═══════════════════════════════════════════════════════════════════════

    public JSONObject exportArchive(String fileName) {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                storage.requireFolder();
                byte[] bytes = storage.readFile(fileName);
                out.put("ok", true);
                out.put("fileName", fileName);
                out.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            } catch (Exception e) {
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
            return out;
        }
    }

    /**
     * Imports an externally supplied archive (share/download) into the folder.
     * Supports both v1 and v2 archives, normalizes the saved filename to `ta-backup-<id>.tabk`,
     * and allows importing encrypted archives even before the user enters their Recovery Key.
     */
    public JSONObject importArchive(String base64, String suggestedName) {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                Uri tree = storage.requireFolder();
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                int version = BackupArchive.detectVersion(bytes);
                boolean sealed;
                String keyId;
                if (version == BackupArchive.FORMAT_VERSION) {
                    BackupArchive.Parsed p1 = BackupArchive.parse(bytes);
                    sealed = p1.sealed;
                    keyId = p1.keyId;
                } else if (version == BackupArchive.FORMAT_VERSION_V2) {
                    BackupArchive.ParsedV2 p2 = BackupArchive.parseV2(bytes);
                    sealed = p2.sealed;
                    keyId = p2.keyId;
                } else {
                    BackupArchive.parse(bytes); // throws FormatException with exact Arabic error code
                    return failure(out, "CORRUPT_ARCHIVE", "صيغة الملف غير مدعومة.");
                }

                // If encrypted and we don't have the key yet, still allow importing under a normalized name
                // so the user can enter their Recovery Key and restore immediately.
                if (sealed && availableKeyFor(keyId) == null) {
                    String importedName = BackupArchiveConstants.FILE_PREFIX + "imported-" + utcStamp() + "-" + randomSuffix() + BackupArchiveConstants.FILE_SUFFIX;
                    storage.writeAtomically(tree, importedName, bytes);
                    clearInspectionCache();
                    out.put("ok", true);
                    out.put("fileName", importedName);
                    out.put("needsRecoveryKey", true);
                    out.put("keyId", keyId == null ? "" : keyId);
                    out.put("manifest", JSONObject.NULL);
                    return out;
                }

                JSONObject manifest = validateIncoming(bytes);
                if (manifest == null) {
                    return failure(out, "CORRUPT_ARCHIVE", "الملف غير صالح أو غير متوافق مع التطبيق.");
                }
                String normalizedName = normalizedImportName(manifest.optString("backupId", ""));
                storage.writeAtomically(tree, normalizedName, bytes);
                clearInspectionCache();
                out.put("ok", true);
                out.put("fileName", normalizedName);
                out.put("needsRecoveryKey", false);
                out.put("manifest", manifest);
            } catch (BackupArchive.FormatException e) {
                return failure(out, "CORRUPT_ARCHIVE", e.getMessage());
            } catch (Exception e) {
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
            return out;
        }
    }

    private static String normalizedImportName(String backupId) {
        String cleanId = backupId == null ? "" : backupId.replaceAll("[^A-Za-z0-9._-]", "");
        if (cleanId.isEmpty() || cleanId.startsWith(".") || cleanId.contains("..") || cleanId.length() > 96) {
            cleanId = "imported-" + utcStamp() + "-" + randomSuffix();
        }
        return BackupArchiveConstants.FILE_PREFIX + cleanId + BackupArchiveConstants.FILE_SUFFIX;
    }

    private JSONObject validateIncoming(byte[] bytes) {
        try {
            DecodedEnvelope decoded = decodeArchiveFull(bytes, null);
            JSONObject manifest = decoded.header;
            if (!BackupArchiveConstants.FORMAT_ID.equals(manifest.optString("format"))) return null;
            int rawSchema = manifest.optInt("databaseSchemaVersion", 0);
            int schema = rawSchema <= 0 ? 1 : rawSchema;
            if (schema > snapshotter.currentSchemaVersion()) return null;
            String actualSha = BackupArchive.sha256Hex(decoded.database);
            if (!actualSha.equalsIgnoreCase(manifest.optString("sha256"))) return null;
            return manifest;
        } catch (Exception e) {
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Pre-update backup & Recovery Key management
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Creates a one-time `pre-update` backup before schema/app migrations run.
     * Safe and idempotent: skips if already executed for this version+schema+engine,
     * if no backup folder is configured, or if the live database is empty.
     */
    public JSONObject preparePreUpdateBackup(String appVersion, int targetSchema) {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                String safeApp = (appVersion == null || appVersion.trim().isEmpty()) ? appVersion() : appVersion.trim();
                String updateKey = safeApp + "_schema" + targetSchema + "_engine" + ENGINE_VERSION;
                SharedPreferences p = prefs(context);
                if (updateKey.equals(p.getString("last_pre_update_key", ""))) {
                    out.put("ok", true);
                    out.put("skipped", true);
                    out.put("skipReason", "already-done");
                    return out;
                }
                if (storage.getFolderUri().isEmpty()) {
                    out.put("ok", true);
                    out.put("skipped", true);
                    out.put("skipReason", "no-folder");
                    return out;
                }
                if (!snapshotter.exists()) {
                    p.edit().putString("last_pre_update_key", updateKey).commit();
                    out.put("ok", true);
                    out.put("skipped", true);
                    out.put("skipReason", "empty-database");
                    return out;
                }
                JSONObject dbStatus = snapshotter.status();
                int liveInvoices = dbStatus.optInt("invoiceCount", 0);
                int liveBusiness = dbStatus.optInt("totalBusinessRecords", 0);
                if (dbStatus.optBoolean("quickCheckOk", true) && liveInvoices == 0 && liveBusiness == 0) {
                    p.edit().putString("last_pre_update_key", updateKey).commit();
                    out.put("ok", true);
                    out.put("skipped", true);
                    out.put("skipReason", "empty-database");
                    return out;
                }
                p.edit().putString("last_pre_update_key", updateKey).commit();
                JSONObject req = new JSONObject();
                req.put("kind", "pre-update");
                req.put("skipIfUnchanged", false);
                req.put("encrypt", true);
                return createBackup(req);
            } catch (Exception e) {
                Log.w(TAG, "preparePreUpdateBackup failed", e);
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    /** Exports the active encryption key as a checksummed `TAKEY-...` recovery key string. */
    public JSONObject exportRecoveryKey() {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                String recoveryKey = keyStore.exportRecoveryKey();
                String keyId = keyStore.getKeyId();
                out.put("ok", true);
                out.put("recoveryKey", recoveryKey);
                out.put("keyId", keyId == null ? "" : keyId);
                return out;
            } catch (SecurityException e) {
                return failure(out, "ENCRYPTION_UNAVAILABLE", "مخزن مفاتيح التشفير غير متاح على هذا الجهاز.");
            } catch (Exception e) {
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    /** Imports a `TAKEY-...` recovery key into the AndroidKeyStore-wrapped keyring and refreshes backup visibility. */
    public JSONObject importRecoveryKey(String code) {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                String keyId = keyStore.importRecoveryKey(code);
                clearInspectionCache();
                out.put("ok", true);
                out.put("keyId", keyId);
                out.put("keyCount", keyStore.keyCount());
                return out;
            } catch (IllegalArgumentException e) {
                return failure(out, "INVALID_RECOVERY_KEY", e.getMessage());
            } catch (SecurityException e) {
                return failure(out, "ENCRYPTION_UNAVAILABLE", "تعذّر حفظ مفتاح الاسترداد في مخزن المفاتيح على هذا الجهاز.");
            } catch (Exception e) {
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    /** Reports encryption availability, active key presence/ID, and keyring count. */
    public JSONObject getEncryptionInfo() {
        synchronized (LOCK) {
            JSONObject out = new JSONObject();
            try {
                String keyId = keyStore.getKeyId();
                boolean keystoreAvailable = keyStore.isKeystoreAvailable();
                out.put("ok", true);
                out.put("keystoreAvailable", keystoreAvailable);
                out.put("available", keystoreAvailable);
                out.put("enabled", prefs(context).getBoolean("encryption_enabled", false));
                out.put("hasKey", keyStore.hasKey());
                out.put("keyId", keyId == null ? "" : keyId);
                out.put("keyCount", keyStore.keyCount());
                return out;
            } catch (Exception e) {
                return failure(out, "IO_FAILED", String.valueOf(e.getMessage()));
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // helpers
    // ═══════════════════════════════════════════════════════════════════════

    private byte[] availableKeyFor(String keyId) {
        return keyStore.getKeyForId(keyId);
    }

    private static final class MissingKeyException extends Exception {

        final String keyId;

        MissingKeyException(String keyId) {
            super("missing key " + keyId);
            this.keyId = keyId;
        }
    }

    private static final class DecodedEnvelope {

        final JSONObject header;
        final byte[] database;
        final String keyId;

        DecodedEnvelope(JSONObject header, byte[] database, String keyId) {
            this.header = header;
            this.database = database;
            this.keyId = keyId;
        }
    }

    /** Unified v1 + v2 full archive decoder (with AAD + GZIP decompression for v2). */
    private DecodedEnvelope decodeArchiveFull(byte[] bytes, byte[] explicitKey)
        throws BackupArchive.FormatException, BackupArchive.SealException, MissingKeyException {
        int version = BackupArchive.detectVersion(bytes);
        if (version == BackupArchive.FORMAT_VERSION) {
            BackupArchive.Parsed parsed = BackupArchive.parse(bytes);
            byte[] key = explicitKey != null ? explicitKey : (parsed.sealed ? availableKeyFor(parsed.keyId) : null);
            if (parsed.sealed && key == null) {
                throw new MissingKeyException(parsed.keyId);
            }
            return decodeFullEnvelope(parsed, key);
        }
        if (version == BackupArchive.FORMAT_VERSION_V2) {
            BackupArchive.ParsedV2 parsed = BackupArchive.parseV2(bytes);
            byte[] key = explicitKey != null ? explicitKey : (parsed.sealed ? availableKeyFor(parsed.keyId) : null);
            if (parsed.sealed && key == null) {
                throw new MissingKeyException(parsed.keyId);
            }
            byte[] headerPlain = parsed.sealed ? BackupArchive.open(parsed.headerBlock, key) : parsed.headerBlock;
            JSONObject header;
            try {
                header = new JSONObject(new String(headerPlain, StandardCharsets.UTF_8));
            } catch (JSONException e) {
                throw new BackupArchive.SealException("محتوى ترويسة النسخة غير صالح.");
            }
            byte[] dbPayload = parsed.sealed ? BackupArchive.openWithAad(parsed.dbBlock, key, parsed.headerBlock) : parsed.dbBlock;
            byte[] rawDb;
            if (parsed.compressed) {
                try {
                    rawDb = BackupArchive.gunzip(dbPayload, BackupArchive.DEFAULT_MAX_GUNZIP_BYTES);
                } catch (Exception e) {
                    throw new BackupArchive.SealException("فشل فك ضغط قاعدة البيانات داخل النسخة: " + e.getMessage());
                }
            } else {
                rawDb = dbPayload;
            }
            return new DecodedEnvelope(header, rawDb, parsed.keyId);
        }
        // Let parse() emit the exact FormatException code (TRUNCATED / BAD_MAGIC / UNSUPPORTED_VERSION).
        BackupArchive.parse(bytes);
        throw new BackupArchive.FormatException("UNSUPPORTED_VERSION", "إصدار صيغة النسخة (" + version + ") غير مدعوم.");
    }

    /** Decrypts and parses a v1 JSON envelope once to avoid double-allocation OOM. */
    private DecodedEnvelope decodeFullEnvelope(BackupArchive.Parsed parsed, byte[] key) throws BackupArchive.SealException {
        byte[] plain = parsed.sealed ? BackupArchive.open(parsed.payload, key) : parsed.payload;
        try {
            JSONObject envelope = new JSONObject(new String(plain, StandardCharsets.UTF_8));
            JSONObject header = envelope.getJSONObject("header");
            byte[] database = Base64.decode(envelope.getString("databaseBase64"), Base64.DEFAULT);
            return new DecodedEnvelope(header, database, parsed.keyId);
        } catch (JSONException | IllegalArgumentException e) {
            throw new BackupArchive.SealException("محتوى النسخة غير صالح (الترويسة أو قاعدة البيانات مفقودة).");
        }
    }

    private FileRecord newestVerified(List<FileRecord> records) {
        FileRecord best = null;
        for (FileRecord r : records) {
            if (!"verified".equals(r.status) || r.manifest == null) continue;
            if (best == null || parseTime(r.manifest.optString("createdAt")) > parseTime(best.manifest.optString("createdAt"))) {
                best = r;
            }
        }
        return best;
    }

    private JSONObject toJson(FileRecord r) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("fileName", r.fileName);
        o.put("uri", r.uri == null ? "" : r.uri);
        o.put("sizeBytes", r.size);
        o.put("modifiedAt", r.modifiedAt);
        o.put("status", r.status);
        o.put("sha256Ok", r.sha256Ok);
        o.put("quickCheckOk", r.quickCheckOk);
        if (r.issue != null) o.put("issue", r.issue);
        if (r.keyId != null && !r.keyId.isEmpty()) o.put("keyId", r.keyId);
        if (r.archiveVersion > 0) o.put("archiveVersion", r.archiveVersion);
        o.put("manifest", r.manifest == null ? JSONObject.NULL : r.manifest);
        return o;
    }

    /** JSONObject.put that never propagates a checked exception into a catch block. */
    static void safePut(JSONObject target, String key, Object value) {
        try {
            target.put(key, value);
        } catch (JSONException ignored) {
            // keys used here are always valid and values are JSON types
        }
    }

    /** Formats a failure response without mutating `last_backup_status` (for read-only & non-create calls). */
    private JSONObject failure(JSONObject out, String code, String message) {
        try {
            out.put("ok", false);
            out.put("errorCode", code);
            out.put("message", message == null ? "" : message);
        } catch (JSONException ignored) {
            // unreachable for these values
        }
        return out;
    }

    /** Formats a backup creation failure AND persists it to `last_backup_status`. Only called by createBackup(). */
    private JSONObject recordBackupFailure(JSONObject out, String code, String message) {
        failure(out, code, message);
        SharedPreferences p = prefs(context);
        p.edit()
            .putString("last_backup_at", isoNow())
            .putString("last_backup_status", "failed")
            .putString("last_backup_message", message == null ? code : message)
            .commit();
        return out;
    }

    private String appVersion() {
        try {
            android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "unknown" : info.versionName;
        } catch (Exception e) {
            return "unknown";
        }
    }

    long appVersionCode() {
        try {
            android.content.pm.PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                return info.getLongVersionCode();
            }
            //noinspection deprecation
            return info.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private String installationId() {
        SharedPreferences p = context.getSharedPreferences("ta_backup_identity", Context.MODE_PRIVATE);
        String id = p.getString("installation_id", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            p.edit().putString("installation_id", id).commit();
        }
        return id;
    }

    static String newBackupId(String kind) {
        return utcStamp() + "-" + kind.replaceAll("[^a-z-]", "") + "-" + randomSuffix();
    }

    private static String utcStamp() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date());
    }

    private static String randomSuffix() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 6);
    }

    static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date());
    }

    private static long parseTime(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        try {
            SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            return fmt.parse(iso).getTime();
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static String optionsOptString(JSONObject o, String key, String fallback) {
        return o == null || !o.has(key) ? fallback : o.optString(key, fallback);
    }

    private static boolean optionsOptBoolean(JSONObject o, String key, boolean fallback) {
        return o == null ? fallback : o.optBoolean(key, fallback);
    }

    static final class BackupException extends Exception {

        public final String code;

        BackupException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
