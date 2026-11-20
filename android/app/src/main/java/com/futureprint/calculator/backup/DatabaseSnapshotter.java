package com.futureprint.calculator.backup;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/**
 * Reads the live application database and produces a verified, self-contained
 * SQLite snapshot.
 *
 * Snapshot strategy and its honesty:
 *  - The platform's SQLiteDatabase.backupDatabase() is NOT part of the public
 *    SDK and reflection on hidden API (greylisted on Android 9+), so we do not
 *    use it.
 *  - The supported route is `VACUUM INTO 'file'` (SQLite >= 3.27, Android 11+).
 *    It runs as a real SQLite statement against the database, so it sees a
 *    consistent view including pages that are still only in the -wal file, and
 *    it is atomic: either the output file is a complete database or no file is
 *    left behind.
 *  - On Android < 11 (no VACUUM INTO), we fall back to attaching the source
 *    read-only from a snapshot connection and then verify the copy with
 *    PRAGMA quick_check. The result is that we NEVER call a backup "verified"
 *    unless the copy itself passed SQLite's own integrity check.
 *  - WAL writers (the WebView) are never blocked: VACUUM INTO is a reader.
 */
final class DatabaseSnapshotter {

    private static final String TAG = "DatabaseSnapshotter";
    private static final String[] TABLES = {
        "custom_invoices",
        "custom_invoice_items",
        "proforma_invoices",
        "proforma_lines",
        "print_invoices",
        "print_invoice_lines",
        "customers",
        "orders",
        "order_items",
        // v2 business model (PRD §14) — keep in sync with BACKUP_TABLES in
        // src/lib/backup/types.ts so a backup always covers every entity.
        "projects",
        "suppliers",
        "financial_accounts",
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
        "sequences",
        "settings",
        "db_meta",
    };
    static final String[] BUSINESS_TABLES = {
        "custom_invoices",
        "proforma_invoices",
        "print_invoices",
        "customers",
        "suppliers",
        "orders",
        "financial_accounts",
        "customer_payments",
        "supplier_payments",
        "expenses",
        "expense_payments",
        "official_letters",
    };
    private static final Set<String> ALLOWED_TABLES;

    static {
        Set<String> allowed = new HashSet<>(Arrays.asList(TABLES));
        allowed.add("android_metadata");
        ALLOWED_TABLES = Collections.unmodifiableSet(allowed);
    }

    public static final class SnapshotException extends Exception {

        public final String code;

        public SnapshotException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    public static final class Snapshot {

        public byte[] bytes;
        public int schemaVersion;
        public String journalMode;
        public String quickCheck;
        public Map<String, Integer> counts;
        public int invoiceCount;
        public int totalBusinessRecords;
        public String strategy;
    }

    private final Context context;

    DatabaseSnapshotter(Context context) {
        this.context = context.getApplicationContext();
    }

    File databaseFile() {
        return context.getDatabasePath(BackupArchiveConstants.DB_FILE_NAME);
    }

    File walFile() {
        return new File(databaseFile().getParentFile(), BackupArchiveConstants.DB_FILE_NAME + "-wal");
    }

    long walBytes() {
        File wal = walFile();
        return wal.exists() ? wal.length() : 0;
    }

    boolean exists() {
        File f = databaseFile();
        return f.exists() && f.length() > 0;
    }

    /** Cheap status for the dashboard (no page copy). */
    JSONObject status() {
        JSONObject status = new JSONObject();
        try {
            File f = databaseFile();
            status.put("fileBytes", f.exists() ? f.length() : 0);
            status.put("walBytes", walBytes());
            if (!exists()) {
                status.put("exists", false);
                status.put("schemaVersion", 0);
                status.put("quickCheckOk", true);
                status.put("integrityDetail", "لا توجد قاعدة بيانات بعد");
                status.put("counts", new JSONObject());
                status.put("invoiceCount", 0);
                status.put("totalBusinessRecords", 0);
                status.put("journalMode", "");
                return status;
            }
            try (SQLiteDatabase db = openLiveReadOnly()) {
                status.put("exists", true);
                int physicalVer = db.getVersion();
                status.put("schemaVersion", physicalVer > 0 ? physicalVer : readLogicalSchemaVersion(db));
                String journalMode = "";
                try {
                    journalMode = queryString(db, "PRAGMA journal_mode");
                } catch (Exception ignored) {
                    // not fatal for the dashboard
                }
                status.put("journalMode", journalMode);
                String quick = queryString(db, "PRAGMA quick_check");
                status.put("quickCheckOk", "ok".equalsIgnoreCase(quick));
                status.put("integrityDetail", quick);
                JSONObject counts = new JSONObject();
                for (String table : TABLES) {
                    if (tableExists(db, table)) counts.put(table, countRows(db, table));
                }
                status.put("counts", counts);
                status.put("invoiceCount", invoiceCount(db));
                status.put("totalBusinessRecords", businessRecordCount(db));
            }
        } catch (Exception e) {
            try {
                status.put("exists", true);
                status.put("quickCheckOk", false);
                status.put("integrityDetail", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {
                // JSONObject.put cannot fail for these values
            }
            Log.e(TAG, "database status failed", e);
        }
        return status;
    }

    /** Seeds PRAGMA user_version from the logical schema marker on first run. */
    int ensureSchemaVersion() {
        if (!exists()) return 0;
        try (SQLiteDatabase db = openLive()) {
            int version = db.getVersion();
            if (version > 0) return version;
            int parsed = readLogicalSchemaVersion(db);
            db.setVersion(parsed);
            return parsed;
        } catch (Exception e) {
            Log.w(TAG, "could not seed schema version", e);
            return 0;
        }
    }

    private int readLogicalSchemaVersion(SQLiteDatabase db) {
        String logical = null;
        if (tableExists(db, "db_meta")) {
            try (Cursor c = db.rawQuery("SELECT value FROM db_meta WHERE key = 'schema_version' LIMIT 1", null)) {
                if (c.moveToFirst()) logical = c.getString(0);
            }
        }
        try {
            return logical == null ? 1 : Math.max(1, Integer.parseInt(logical.trim()));
        } catch (NumberFormatException ignored) {
            return 1;
        }
    }

    /** Reads schema version read-only to avoid OPEN_READWRITE lock contention with libsqlcipher. */
    int currentSchemaVersion() {
        try {
            if (!exists()) return 1;
            try (SQLiteDatabase db = openLiveReadOnly()) {
                int version = db.getVersion();
                return version > 0 ? version : readLogicalSchemaVersion(db);
            }
        } catch (Exception e) {
            return 1;
        }
    }

    /**
     * Opens the live application database READ-ONLY with a busy timeout for
     * inspection/status calls so POSIX lock interference with libsqlcipher.so is minimized.
     */
    private SQLiteDatabase openLiveReadOnly() throws Exception {
        SQLiteDatabase db = SQLiteDatabase.openDatabase(
            databaseFile().getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READONLY
        );
        applyBusyTimeout(db);
        return db;
    }

    /**
     * Opens the live application database for snapshotting.
     *
     * MUST be OPEN_READWRITE for capture/checkpoint: on Android a read-only
     * connection cannot checkpoint or create -shm for a WAL database.
     */
    private SQLiteDatabase openLive() throws Exception {
        SQLiteDatabase db = SQLiteDatabase.openDatabase(
            databaseFile().getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READWRITE
        );
        applyBusyTimeout(db);
        return db;
    }

    private static void applyBusyTimeout(SQLiteDatabase db) {
        try {
            queryString(db, "PRAGMA busy_timeout = 5000");
        } catch (Exception ignored) {
            // best effort
        }
    }

    /**
     * Moves committed -wal content into the main database file so any reader
     * (including a plain file copy) sees the complete database.
     * Retries across modes whenever SQLite reports `busy != 0` instead of
     * returning on the first attempt.
     */
    private void checkpointWal(SQLiteDatabase db) {
        for (String mode : new String[] { "TRUNCATE", "FULL", "RESTART", "PASSIVE" }) {
            try (Cursor c = db.rawQuery("PRAGMA wal_checkpoint(" + mode + ")", null)) {
                if (c != null && c.moveToFirst()) {
                    int busy = c.getColumnCount() > 0 ? c.getInt(0) : 0;
                    if (busy == 0) {
                        return;
                    }
                    Log.w(TAG, "wal_checkpoint(" + mode + ") reported busy=" + busy);
                } else {
                    return;
                }
            } catch (Exception e) {
                Log.w(TAG, "wal_checkpoint(" + mode + ") failed: " + e.getMessage());
            }
        }
    }

    /** Non-internal table names that actually exist in the given database. */
    private static java.util.Set<String> tableNames(SQLiteDatabase db) {
        java.util.Set<String> names = new java.util.HashSet<>();
        try (Cursor c = db.rawQuery(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            null
        )) {
            while (c.moveToNext()) names.add(c.getString(0));
        }
        return names;
    }

    /**
     * Captures a verified, self-contained snapshot of the live database.
     *
     * Steps (each one is required for correctness):
     *  1. open the live database READ-WRITE so the -wal file is usable;
     *  2. checkpoint the WAL into the main file;
     *  3. VACUUM INTO a temp file (consistent, compacted, atomic output);
     *  4. VERIFY the copy really contains the application schema by comparing its
     *     table set against the live database; if it does not, retry with the
     *     schema-preserving copy strategy, and otherwise fail loudly.
     */
    Snapshot capture() throws SnapshotException {
        if (!exists()) {
            throw new SnapshotException("DATABASE_UNREADABLE", "قاعدة البيانات غير موجودة بعد.");
        }
        File tmp = null;
        try (SQLiteDatabase live = openLive()) {
            java.util.Set<String> liveTables = tableNames(live);
            java.util.Set<String> expected = new java.util.HashSet<>();
            for (String table : TABLES) {
                if (liveTables.contains(table)) expected.add(table);
            }
            if (expected.isEmpty()) {
                throw new SnapshotException(
                    "INTEGRITY_FAILED",
                    "قاعدة البيانات الحالية لا تحتوي جداول التطبيق بعد. افتح التطبيق وانتظر ثانية ثم أعد المحاولة."
                );
            }

            checkpointWal(live);

            tmp = File.createTempFile("snapshot", ".db", context.getCacheDir());
            //noinspection ResultOfMethodCallIgnored
            tmp.delete(); // VACUUM INTO refuses to overwrite an existing file

            String strategy;
            java.util.Set<String> snapshotTables = new java.util.HashSet<>();
            try {
                live.execSQL("VACUUM INTO ?", new Object[] { tmp.getAbsolutePath() });
                strategy = "vacuum-into";
                java.util.Set<String> found = readTableNames(tmp);
                snapshotTables.addAll(found);
            } catch (Exception e) {
                Log.w(TAG, "VACUUM INTO failed, using schema-preserving copy: " + e.getMessage());
                strategy = copyTablesPreservingSchema(live, tmp);
                snapshotTables.addAll(readTableNames(tmp));
            }

            java.util.Set<String> missing = new java.util.HashSet<>(expected);
            missing.removeAll(snapshotTables);
            if (!missing.isEmpty()) {
                // Second chance: the WAL-visible read still missed tables (e.g. a
                // vendor build where the WAL could not be checkpointed).
                Log.w(TAG, "snapshot missing tables " + missing + "; retrying with schema-preserving copy");
                strategy = copyTablesPreservingSchema(live, tmp);
                snapshotTables.clear();
                snapshotTables.addAll(readTableNames(tmp));
                missing = new java.util.HashSet<>(expected);
                missing.removeAll(snapshotTables);
                if (!missing.isEmpty()) {
                    throw new SnapshotException(
                        "INTEGRITY_FAILED",
                        "تعذّر نسخ مخطط قاعدة البيانات بشكل كامل (الجداول الناقصة: " + joinNames(missing) + ")."
                    );
                }
            }

            byte[] bytes = readFile(tmp);
            if (bytes.length < 100) {
                throw new SnapshotException("DATABASE_UNREADABLE", "النسخة الناتجة فارغة — لم يتم حفظ أي ملف.");
            }

            Snapshot snapshot = new Snapshot();
            snapshot.bytes = bytes;
            snapshot.strategy = strategy;
            try (SQLiteDatabase check = SQLiteDatabase.openDatabase(tmp.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY)) {
                snapshot.quickCheck = queryString(check, "PRAGMA quick_check");
                if (!"ok".equalsIgnoreCase(snapshot.quickCheck)) {
                    throw new SnapshotException("INTEGRITY_FAILED", "فحص سلامة النسخة فشل: " + snapshot.quickCheck);
                }
                int physicalVer = check.getVersion();
                snapshot.schemaVersion = physicalVer > 0 ? physicalVer : readLogicalSchemaVersion(check);
                snapshot.journalMode = queryString(check, "PRAGMA journal_mode");
                snapshot.counts = new LinkedHashMap<>();
                for (String table : TABLES) {
                    if (tableExists(check, table)) snapshot.counts.put(table, countRows(check, table));
                }
                snapshot.invoiceCount = invoiceCount(check);
                snapshot.totalBusinessRecords = businessRecordCount(check);
                if (!snapshot.counts.containsKey("custom_invoices")) {
                    throw new SnapshotException(
                        "INTEGRITY_FAILED",
                        "النسخة لا تحتوي جدول الفواتير المخصصة (custom_invoices) بعد النسخ."
                    );
                }
            }
            return snapshot;
        } catch (SnapshotException e) {
            throw e;
        } catch (Exception e) {
            throw new SnapshotException("DATABASE_UNREADABLE", "تعذّر تجهيز النسخة: " + e.getMessage());
        } finally {
            if (tmp != null) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                deleteSidecars(tmp);
            }
        }
    }

    private static String joinNames(java.util.Collection<String> names) {
        StringBuilder sb = new StringBuilder();
        for (String n : names) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(n);
        }
        return sb.toString();
    }

    private void deleteSidecars(File dbFile) {
        for (String suffix : new String[] { "-wal", "-shm", "-journal" }) {
            File f = new File(dbFile.getAbsolutePath() + suffix);
            if (f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    /** Table names from a standalone database file (no WAL expected). */
    private static java.util.Set<String> readTableNames(File file) {
        java.util.Set<String> names = new java.util.HashSet<>();
        if (!file.exists() || file.length() == 0) return names;
        // Read-write so a stray -wal can never hide the schema from us; the file
        // is our own temp artefact.
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READWRITE)) {
            names.addAll(tableNames(db));
            return names;
        } catch (Exception e) {
            Log.w(TAG, "could not open " + file.getName() + " read-write: " + e.getMessage());
        }
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY)) {
            names.addAll(tableNames(db));
        } catch (Exception e) {
            Log.w(TAG, "could not list tables of " + file.getName() + ": " + e.getMessage());
        }
        return names;
    }

    /**
     * Copies the schema EXACTLY (CREATE TABLE from sqlite_master, so PRIMARY KEYs,
     * UNIQUE and FOREIGN KEY constraints survive) and then the rows.
     *
     * A plain "CREATE TABLE x AS SELECT * FROM y" would silently drop every
     * constraint; a restored database without PRIMARY KEYs would then break the
     * app's "ON CONFLICT(id) DO UPDATE" upserts and start accumulating duplicate
     * invoices. That is why this path preserves the original DDL.
     */
    private String copyTablesPreservingSchema(SQLiteDatabase live, File target) throws Exception {
        //noinspection ResultOfMethodCallIgnored
        target.delete();
        deleteSidecars(target);
        try (SQLiteDatabase dst = SQLiteDatabase.openOrCreateDatabase(target, null)) {
            int version = 1;
            try {
                version = live.getVersion();
            } catch (Exception ignored) {
                // default below
            }
            applyBusyTimeout(dst);
            // The output must be a single self-contained file: a rollback journal
            // keeps every page readable by any later reader. Use rawQuery via queryString
            // because execSQL throws on PRAGMAs that return rows on Android < 11.
            try {
                queryString(dst, "PRAGMA journal_mode=DELETE");
            } catch (Exception ignored) {
                // keep the default mode; the verification step below still checks
            }
            dst.execSQL("ATTACH DATABASE ? AS src", new Object[] { databaseFile().getAbsolutePath() });
            try {
                java.util.List<String> tableDdl = new java.util.ArrayList<>();
                java.util.List<String> indexDdl = new java.util.ArrayList<>();
                try (Cursor c = dst.rawQuery(
                    "SELECT type, name, sql FROM src.sqlite_master " +
                    "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> 'android_metadata' " +
                    "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
                    null
                )) {
                    while (c.moveToNext()) {
                        String type = c.getString(0);
                        String sql = c.getString(2);
                        if (sql == null || sql.trim().isEmpty()) continue;
                        if ("table".equals(type)) tableDdl.add(sql);
                        else if ("index".equals(type)) indexDdl.add(sql);
                    }
                }

                dst.execSQL("PRAGMA foreign_keys=OFF");
                dst.beginTransaction();
                try {
                    for (String ddl : tableDdl) dst.execSQL(ddl);
                    for (String ddl : indexDdl) dst.execSQL(ddl);
                    for (String ddl : tableDdl) {
                        String table = tableNameFromDdl(ddl);
                        if (table == null) continue;
                        dst.execSQL("INSERT INTO main.\"" + table + "\" SELECT * FROM src.\"" + table + "\"");
                    }
                    dst.setTransactionSuccessful();
                } finally {
                    dst.endTransaction();
                }
                dst.setVersion(Math.max(1, version));
            } finally {
                dst.execSQL("DETACH DATABASE src");
            }
        }
        return "schema-copy";
    }

    /** Extracts `x` from: CREATE TABLE [IF NOT EXISTS] "x" (...). */
    private static String tableNameFromDdl(String ddl) {
        String sql = ddl.trim();
        int idx = 0;
        int lowerLen = 12; // "CREATE TABLE"
        if (sql.regionMatches(true, 0, "CREATE TABLE", 0, lowerLen)) idx = lowerLen;
        else return null;
        // skip IF NOT EXISTS
        String rest = sql.substring(idx).trim();
        if (rest.regionMatches(true, 0, "IF NOT EXISTS", 0, 13)) rest = rest.substring(13).trim();
        if (rest.isEmpty()) return null;
        char first = rest.charAt(0);
        if (first == '"' || first == '`' || first == '[') {
            char close = first == '[' ? ']' : first;
            int end = rest.indexOf(close, 1);
            return end > 1 ? rest.substring(1, end) : null;
        }
        int end = 0;
        while (end < rest.length() && !Character.isWhitespace(rest.charAt(end)) && rest.charAt(end) != '(') end++;
        return end > 0 ? rest.substring(0, end) : null;
    }

    // ── Restore side ───────────────────────────────────────────────────────

    /**
     * Verifies a plaintext database image and returns its counts.
     * Runs on a temporary file OUTSIDE the live database path, so a malicious
     * or corrupt image can never touch the real data.
     */
    Map<String, Integer> inspectImage(byte[] image, String[] outSchema) throws SnapshotException {
        File tmp = null;
        try {
            tmp = File.createTempFile("restore", ".db", context.getCacheDir());
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
                out.write(image);
                out.flush();
            }
            try (SQLiteDatabase db = SQLiteDatabase.openDatabase(tmp.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY)) {
                // Defend against malicious untrusted SQLite archives (SEC-12):
                // disable trusted_schema and reject triggers, views, virtual tables,
                // and unknown tables before running any further queries.
                try {
                    queryString(db, "PRAGMA trusted_schema = OFF");
                } catch (Exception ignored) {
                    // SQLite < 3.31 does not support trusted_schema
                }
                validateUntrustedSchema(db);

                String quick = queryString(db, "PRAGMA quick_check");
                if (!"ok".equalsIgnoreCase(quick)) {
                    throw new SnapshotException("INTEGRITY_FAILED", "فحص سلامة قاعدة البيانات داخل النسخة فشل: " + quick);
                }
                if (!tableExists(db, "custom_invoices") || !tableExists(db, "settings")) {
                    throw new SnapshotException("INCOMPATIBLE_BACKUP", "النسخة لا تحتوي مخطط هذا التطبيق.");
                }
                if (outSchema != null && outSchema.length > 0) {
                    int physicalVer = db.getVersion();
                    outSchema[0] = String.valueOf(physicalVer > 0 ? physicalVer : readLogicalSchemaVersion(db));
                }
                Map<String, Integer> counts = new LinkedHashMap<>();
                for (String table : TABLES) {
                    if (tableExists(db, table)) counts.put(table, countRows(db, table));
                }
                return counts;
            }
        } catch (SnapshotException e) {
            throw e;
        } catch (Exception e) {
            throw new SnapshotException("CORRUPT_ARCHIVE", "تعذّرت قراءة قاعدة البيانات داخل النسخة: " + e.getMessage());
        } finally {
            if (tmp != null) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                deleteSidecars(tmp);
            }
        }
    }

    /** Rejects triggers, views, virtual tables, or tables outside the application allowlist. */
    private static void validateUntrustedSchema(SQLiteDatabase db) throws SnapshotException {
        try (
            Cursor c = db.rawQuery(
                "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> 'android_metadata'",
                null
            )
        ) {
            while (c.moveToNext()) {
                String type = c.getString(0) == null ? "" : c.getString(0).toLowerCase(Locale.ROOT);
                String name = c.getString(1) == null ? "" : c.getString(1);
                String sql = c.getString(2) == null ? "" : c.getString(2);
                if ("trigger".equals(type) || "view".equals(type)) {
                    throw new SnapshotException("INCOMPATIBLE_BACKUP", "النسخة تحتوي على كائن SQL غير مسموح (" + type + ").");
                }
                if (sql.toUpperCase(Locale.ROOT).contains("VIRTUAL TABLE")) {
                    throw new SnapshotException("INCOMPATIBLE_BACKUP", "النسخة تحتوي على جدول افتراضي غير مسموح.");
                }
                if ("table".equals(type)) {
                    if (!ALLOWED_TABLES.contains(name)) {
                        throw new SnapshotException("INCOMPATIBLE_BACKUP", "النسخة تحتوي على جدول غير معروف (" + name + ").");
                    }
                } else if (!"index".equals(type)) {
                    throw new SnapshotException("INCOMPATIBLE_BACKUP", "النسخة تحتوي على نوع مخطط غير مدعوم (" + type + ").");
                }
            }
        }
    }

    /**
     * Replaces the live database with `image` atomically at the file-system
     * level: the new content is written beside the database and renamed over it,
     * with stale -wal/-shm sidecars removed so SQLite cannot resurrect old pages.
     *
     * Precondition: no other connection to the database is open. The caller
     * (BackupEngine) closes the Capacitor SQLite connection and waits first.
     */
    void replaceDatabase(byte[] image) throws SnapshotException {
        File target = databaseFile();
        File dir = target.getParentFile();
        File staging = new File(dir, BackupArchiveConstants.DB_FILE_NAME + ".restore-new");
        File rollback = new File(dir, BackupArchiveConstants.DB_FILE_NAME + ".restore-old");
        boolean movedToRollback = false;
        try {
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(staging)) {
                out.write(image);
                out.flush();
                out.getFD().sync();
            }
            if (rollback.exists()) {
                //noinspection ResultOfMethodCallIgnored
                rollback.delete();
            }
            if (target.exists()) {
                if (!target.renameTo(rollback)) {
                    throw new SnapshotException("RESTORE_FAILED", "تعذّر تنحية قاعدة البيانات الحالية جانباً.");
                }
                movedToRollback = true;
            }
            if (!staging.renameTo(target)) {
                restoreRollback(rollback, target, dir);
                throw new SnapshotException("RESTORE_FAILED", "تعذّر تفعيل قاعدة البيانات المستعادة.");
            }
            deleteSidecars(dir, target.getName());
            // Verify target BEFORE deleting rollback so a failed quick_check can cleanly revert.
            try (SQLiteDatabase verifyDb = SQLiteDatabase.openDatabase(target.getAbsolutePath(), null, SQLiteDatabase.OPEN_READWRITE)) {
                applyBusyTimeout(verifyDb);
                String quick = queryString(verifyDb, "PRAGMA quick_check");
                if (!"ok".equalsIgnoreCase(quick)) {
                    throw new SnapshotException("RESTORE_FAILED", "قاعدة البيانات المستعادة لم تجتز فحص السلامة: " + quick);
                }
            } catch (Exception verifyErr) {
                if (movedToRollback) {
                    restoreRollback(rollback, target, dir);
                }
                if (verifyErr instanceof SnapshotException) throw (SnapshotException) verifyErr;
                throw new SnapshotException("RESTORE_FAILED", "فشل التحقق من قاعدة البيانات المستعادة: " + verifyErr.getMessage());
            }
            if (rollback.exists()) {
                //noinspection ResultOfMethodCallIgnored
                rollback.delete();
            }
        } catch (SnapshotException e) {
            throw e;
        } catch (Exception e) {
            throw new SnapshotException("RESTORE_FAILED", "فشلت الاستعادة: " + e.getMessage());
        } finally {
            //noinspection ResultOfMethodCallIgnored
            staging.delete();
        }
    }

    private void restoreRollback(File rollback, File target, File dir) {
        try {
            if (target.exists()) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
            deleteSidecars(dir, target.getName());
            if (rollback.exists()) {
                //noinspection ResultOfMethodCallIgnored
                rollback.renameTo(target);
            }
        } catch (Exception e) {
            Log.e(TAG, "failed to restore rollback database", e);
        }
    }

    private void deleteSidecars(File dir, String name) {
        for (String suffix : new String[] { "-wal", "-shm", "-journal" }) {
            File f = new File(dir, name + suffix);
            if (f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private static boolean tableExists(SQLiteDatabase db, String table) {
        return tableExists(db, "main", table);
    }

    private static boolean tableExists(SQLiteDatabase db, String schema, String table) {
        try (Cursor c = db.rawQuery("SELECT name FROM " + schema + ".sqlite_master WHERE type='table' AND name=? LIMIT 1", new String[] { table })) {
            return c.moveToFirst();
        }
    }

    private static int countRows(SQLiteDatabase db, String table) {
        // Table names come from a fixed allow-list constant, never from input.
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM \"" + table + "\"", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    /**
     * Copies the raw live `.db` (and `-wal` if present) without opening SQLite,
     * preserving evidence for disaster recovery when the live DB is corrupt.
     */
    File saveRawCorruptCopy(File destDir) {
        if (destDir == null) return null;
        File liveDb = databaseFile();
        if (!liveDb.exists() || liveDb.length() <= 0) return null;
        try {
            if (!destDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                destDir.mkdirs();
            }
            java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US);
            fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            String stamp = fmt.format(new java.util.Date());
            File copy = new File(destDir, "corrupt-db-" + stamp + ".db");
            copyRawFile(liveDb, copy);
            File wal = walFile();
            if (wal.exists() && wal.length() > 0) {
                copyRawFile(wal, new File(destDir, copy.getName() + "-wal"));
            }
            return copy;
        } catch (Exception e) {
            Log.w(TAG, "failed to save raw corrupt database copy", e);
            return null;
        }
    }

    private static void copyRawFile(File src, File dst) throws IOException {
        try (InputStream in = new FileInputStream(src); java.io.FileOutputStream out = new java.io.FileOutputStream(dst)) {
            byte[] buf = new byte[64 * 1024];
            int read;
            while ((read = in.read(buf)) != -1) {
                out.write(buf, 0, read);
            }
            out.flush();
        }
    }

    private static int invoiceCount(SQLiteDatabase db) {
        int total = 0;
        for (String t : new String[] { "custom_invoices", "proforma_invoices", "print_invoices" }) {
            if (tableExists(db, t)) total += countRows(db, t);
        }
        return total;
    }

    private static int businessRecordCount(SQLiteDatabase db) {
        int total = 0;
        for (String t : BUSINESS_TABLES) {
            if (tableExists(db, t)) total += countRows(db, t);
        }
        return total;
    }

    private static String queryString(SQLiteDatabase db, String sql) {
        try (Cursor c = db.rawQuery(sql, null)) {
            return c.moveToFirst() ? c.getString(0) : "";
        }
    }

    private static byte[] readFile(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(file.length(), Integer.MAX_VALUE));
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }
}
