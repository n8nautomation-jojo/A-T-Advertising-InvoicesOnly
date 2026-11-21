package com.futureprint.calculator.backup;

import android.content.Context;
import android.database.Cursor;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/**
 * Reads the live application database and produces a verified, self-contained
 * SQLite snapshot.
 *
 * CRITICAL INVARIANT:
 *  - Every operation on `databaseFile()` goes through `SqlCipherBridge`
 *    (`libsqlcipher.so`) — NEVER `android.database.sqlite.SQLiteDatabase`.
 *  - When CapacitorSQLite already has `ta_invoicing_db` open in this process,
 *    `borrowLiveOrOpenSqlCipher` borrows that exact open handle instead of
 *    opening/closing a competing file descriptor (which on Linux drops all
 *    POSIX fcntl() locks for the open WAL database and causes code 11 corruption).
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

    public static final class HealthResult {

        public boolean ok;
        public String status;
        public int salvagedRecords;
        public int salvagedInvoices;
        public int salvagedCustomers;
        public String errorCode;
        public String message;
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

    /** Cheap status for the dashboard (borrows open SQLCipher handle when active). */
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
            try (SqlCipherBridge.DbSession db = SqlCipherBridge.borrowLiveOrOpenSqlCipher(f, true)) {
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
                String quick = queryString(db, "PRAGMA quick_check(1)");
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
        try (SqlCipherBridge.DbSession db = SqlCipherBridge.borrowLiveOrOpenSqlCipher(databaseFile(), false)) {
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

    private int readLogicalSchemaVersion(SqlCipherBridge.DbSession db) {
        String logical = null;
        try {
            if (tableExists(db, "db_meta")) {
                try (Cursor c = db.rawQuery("SELECT value FROM db_meta WHERE key = 'schema_version' LIMIT 1", null)) {
                    if (c.moveToFirst()) logical = c.getString(0);
                }
            }
        } catch (Exception ignored) {
            // fallback to 1
        }
        try {
            return logical == null ? 1 : Math.max(1, Integer.parseInt(logical.trim()));
        } catch (NumberFormatException ignored) {
            return 1;
        }
    }

    /** Reads schema version using the borrowed SQLCipher connection if open. */
    int currentSchemaVersion() {
        try {
            if (!exists()) return 1;
            try (SqlCipherBridge.DbSession db = SqlCipherBridge.borrowLiveOrOpenSqlCipher(databaseFile(), true)) {
                int version = db.getVersion();
                return version > 0 ? version : readLogicalSchemaVersion(db);
            }
        } catch (Exception e) {
            return 1;
        }
    }

    private static void applyBusyTimeout(SqlCipherBridge.DbSession db) {
        try {
            queryString(db, "PRAGMA busy_timeout = 5000");
        } catch (Exception ignored) {
            // best effort
        }
    }

    private static void waitWhileInTransaction(SqlCipherBridge.DbSession db) {
        for (int i = 0; i < 40; i++) {
            if (!db.inTransaction()) return;
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void checkpointWalPassive(SqlCipherBridge.DbSession db) {
        try (Cursor c = db.rawQuery("PRAGMA wal_checkpoint(PASSIVE)", null)) {
            if (c != null) c.moveToFirst();
        } catch (Exception e) {
            Log.w(TAG, "wal_checkpoint(PASSIVE) failed: " + e.getMessage());
        }
    }

    /**
     * Only invoked when NO WebView connection is open (e.g. background worker
     * or cold startup). Never called on a borrowed live handle.
     */
    private void checkpointWalOffline(SqlCipherBridge.DbSession db) {
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
    private static Set<String> tableNames(SqlCipherBridge.DbSession db) throws Exception {
        Set<String> names = new HashSet<>();
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
     * Runs `VACUUM INTO '<cacheTmp>'` on SQLCipher (`libsqlcipher.so`), borrowing
     * the live CapacitorSQLite handle when open so ZERO second fd is opened or
     * closed and ZERO POSIX locks are ever dropped.
     */
    Snapshot capture() throws SnapshotException {
        if (!exists()) {
            throw new SnapshotException("DATABASE_UNREADABLE", "قاعدة البيانات غير موجودة بعد.");
        }
        File tmp = null;
        try (SqlCipherBridge.DbSession live = SqlCipherBridge.borrowLiveOrOpenSqlCipher(databaseFile(), false)) {
            Set<String> liveTables = tableNames(live);
            Set<String> expected = new HashSet<>();
            for (String table : TABLES) {
                if (liveTables.contains(table)) expected.add(table);
            }
            if (expected.isEmpty()) {
                throw new SnapshotException(
                    "INTEGRITY_FAILED",
                    "قاعدة البيانات الحالية لا تحتوي جداول التطبيق بعد. افتح التطبيق وانتظر ثانية ثم أعد المحاولة."
                );
            }

            if (live.isLiveBorrowed()) {
                waitWhileInTransaction(live);
                checkpointWalPassive(live);
            } else {
                applyBusyTimeout(live);
                checkpointWalOffline(live);
            }

            tmp = File.createTempFile("snapshot", ".db", context.getCacheDir());
            //noinspection ResultOfMethodCallIgnored
            tmp.delete(); // VACUUM INTO refuses to overwrite an existing file

            String strategy;
            Set<String> snapshotTables = new HashSet<>();
            try {
                live.execSQL("VACUUM INTO ?", new Object[] { tmp.getAbsolutePath() });
                strategy = "vacuum-into";
                Set<String> found = readTableNames(tmp);
                snapshotTables.addAll(found);
            } catch (Exception e) {
                Log.w(TAG, "VACUUM INTO failed, using schema-preserving copy: " + e.getMessage());
                strategy = copyTablesPreservingSchema(live, tmp);
                snapshotTables.addAll(readTableNames(tmp));
            }

            Set<String> missing = new HashSet<>(expected);
            missing.removeAll(snapshotTables);
            if (!missing.isEmpty()) {
                Log.w(TAG, "snapshot missing tables " + missing + "; retrying with schema-preserving copy");
                strategy = copyTablesPreservingSchema(live, tmp);
                snapshotTables.clear();
                snapshotTables.addAll(readTableNames(tmp));
                missing = new HashSet<>(expected);
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
            try (SqlCipherBridge.DbSession check = SqlCipherBridge.openStandaloneSqlCipher(tmp, false, true)) {
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

    /** Table names from a standalone temp database file (never the live DB). */
    private static Set<String> readTableNames(File file) {
        Set<String> names = new HashSet<>();
        if (!file.exists() || file.length() == 0) return names;
        try (SqlCipherBridge.DbSession db = SqlCipherBridge.openStandaloneSqlCipher(file, false, true)) {
            names.addAll(tableNames(db));
            return names;
        } catch (Exception e) {
            Log.w(TAG, "could not list tables of " + file.getName() + ": " + e.getMessage());
        }
        return names;
    }

    /**
     * Fallback snapshot copy via ATTACH when VACUUM INTO is unavailable, keeping
     * exact DDL constraints while reading through SQLCipher.
     */
    private String copyTablesPreservingSchema(SqlCipherBridge.DbSession live, File target) throws Exception {
        //noinspection ResultOfMethodCallIgnored
        target.delete();
        deleteSidecars(target);
        try (SqlCipherBridge.DbSession dst = SqlCipherBridge.openStandaloneSqlCipher(target, true, false)) {
            int version = 1;
            try {
                version = live.getVersion();
            } catch (Exception ignored) {
                // default below
            }
            applyBusyTimeout(dst);
            try {
                queryString(dst, "PRAGMA journal_mode=DELETE");
            } catch (Exception ignored) {
                // ignore
            }
            List<String> tableDdl = new ArrayList<>();
            List<String> indexDdl = new ArrayList<>();
            try (Cursor c = live.rawQuery(
                "SELECT type, name, sql FROM sqlite_master " +
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
                dst.setTransactionSuccessful();
            } finally {
                dst.endTransaction();
            }

            for (String ddl : tableDdl) {
                String table = tableNameFromDdl(ddl);
                if (table == null) continue;
                copyTableRowsViaCursor(live, dst, table);
            }
            dst.setVersion(Math.max(1, version));
        }
        return "schema-copy";
    }

    /**
     * Streams rows cleanly from `src` into `dst` inside transactions, using
     * typed cursor extraction and bind arguments (SQL-injection safe).
     */
    private static int copyTableRowsViaCursor(
        SqlCipherBridge.DbSession src,
        SqlCipherBridge.DbSession dst,
        String table
    ) {
        int copied = 0;
        String safeTable = table.replace("\"", "\"\"");
        try (Cursor c = src.rawQuery("SELECT * FROM \"" + safeTable + "\"", null)) {
            int colCount = c.getColumnCount();
            if (colCount <= 0) return 0;
            String insertSql = buildInsertSql(safeTable, c);
            dst.beginTransaction();
            try {
                while (safeMoveToNext(c)) {
                    Object[] vals = extractRow(c, colCount);
                    dst.execSQL(insertSql, vals);
                    copied++;
                }
                dst.setTransactionSuccessful();
            } finally {
                dst.endTransaction();
            }
            return copied;
        } catch (Exception e) {
            Log.w(TAG, "full scan failed for table " + table + ", attempting rowid salvage: " + e.getMessage());
        }

        // Rowid-stepping salvage if a corrupt B-tree page interrupted full scan
        long lastRowId = Long.MIN_VALUE;
        for (int guard = 0; guard < 100000; guard++) {
            try (Cursor c = src.rawQuery(
                "SELECT rowid AS _salvage_rid, * FROM \"" + safeTable + "\" WHERE rowid > " + lastRowId + " ORDER BY rowid ASC LIMIT 1",
                null
            )) {
                if (!c.moveToFirst()) break;
                lastRowId = c.getLong(0);
                int colCount = c.getColumnCount();
                if (colCount <= 1) continue;
                StringBuilder cols = new StringBuilder();
                StringBuilder qmarks = new StringBuilder();
                Object[] vals = new Object[colCount - 1];
                for (int i = 1; i < colCount; i++) {
                    if (i > 1) {
                        cols.append(',');
                        qmarks.append(',');
                    }
                    cols.append('"').append(c.getColumnName(i).replace("\"", "\"\"")).append('"');
                    qmarks.append('?');
                    vals[i - 1] = readColumnValue(c, i);
                }
                dst.execSQL(
                    "INSERT OR IGNORE INTO \"" + safeTable + "\" (" + cols + ") VALUES (" + qmarks + ")",
                    vals
                );
                copied++;
            } catch (Exception stepErr) {
                if (lastRowId == Long.MIN_VALUE) lastRowId = 0;
                else lastRowId++;
                // Stop if we can no longer advance cleanly past a header/schema fault
                if (guard > 50 && copied == 0) break;
            }
        }
        return copied;
    }

    private static boolean safeMoveToNext(Cursor c) {
        try {
            return c.moveToNext();
        } catch (Exception e) {
            return false;
        }
    }

    private static String buildInsertSql(String safeTable, Cursor c) {
        int colCount = c.getColumnCount();
        StringBuilder cols = new StringBuilder();
        StringBuilder qmarks = new StringBuilder();
        for (int i = 0; i < colCount; i++) {
            if (i > 0) {
                cols.append(',');
                qmarks.append(',');
            }
            cols.append('"').append(c.getColumnName(i).replace("\"", "\"\"")).append('"');
            qmarks.append('?');
        }
        return "INSERT OR IGNORE INTO \"" + safeTable + "\" (" + cols + ") VALUES (" + qmarks + ")";
    }

    private static Object[] extractRow(Cursor c, int colCount) {
        Object[] vals = new Object[colCount];
        for (int i = 0; i < colCount; i++) {
            vals[i] = readColumnValue(c, i);
        }
        return vals;
    }

    private static Object readColumnValue(Cursor c, int index) {
        switch (c.getType(index)) {
            case Cursor.FIELD_TYPE_NULL:
                return null;
            case Cursor.FIELD_TYPE_INTEGER:
                return c.getLong(index);
            case Cursor.FIELD_TYPE_FLOAT:
                return c.getDouble(index);
            case Cursor.FIELD_TYPE_BLOB:
                return c.getBlob(index);
            case Cursor.FIELD_TYPE_STRING:
            default:
                return c.getString(index);
        }
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
            try (SqlCipherBridge.DbSession db = SqlCipherBridge.openStandaloneSqlCipher(tmp, false, true)) {
                try {
                    queryString(db, "PRAGMA trusted_schema = OFF");
                } catch (Exception ignored) {
                    // ignore
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
    private static void validateUntrustedSchema(SqlCipherBridge.DbSession db) throws SnapshotException {
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
        } catch (SnapshotException e) {
            throw e;
        } catch (Exception e) {
            throw new SnapshotException("CORRUPT_ARCHIVE", "تعذّر فحص بنية قاعدة البيانات: " + e.getMessage());
        }
    }

    /**
     * Checks live database integrity and automatically rebuilds a corrupt database
     * by extracting DDL + row-by-row salvage into a clean temporary SQLCipher image
     * and atomically swapping it into place.
     *
     * Precondition when repairing: caller holds BackupEngine.LOCK and no WebView
     * connection remains open once repair begins.
     */
    HealthResult checkAndRepairIfCorrupt(boolean forceRepair, File rescueDir) {
        HealthResult result = new HealthResult();
        File liveFile = databaseFile();
        if (!liveFile.exists() || liveFile.length() == 0) {
            result.ok = true;
            result.status = "missing";
            result.message = "لا توجد قاعدة بيانات محلية بعد.";
            return result;
        }

        if (!forceRepair) {
            try (SqlCipherBridge.DbSession db = SqlCipherBridge.borrowLiveOrOpenSqlCipher(liveFile, false)) {
                if (!db.isLiveBorrowed()) {
                    applyBusyTimeout(db);
                }
                String check = queryString(db, "PRAGMA integrity_check(1)");
                if ("ok".equalsIgnoreCase(check)) {
                    // Smoke-query critical business tables when present so subtle B-tree leaf faults are caught.
                    if (tableExists(db, "custom_invoices")) {
                        countRows(db, "custom_invoices");
                    }
                    if (tableExists(db, "customers")) {
                        countRows(db, "customers");
                    }
                    result.ok = true;
                    result.status = "healthy";
                    result.message = "قاعدة البيانات سليمة.";
                    return result;
                }
                Log.w(TAG, "integrity_check failed: " + check);
            } catch (Exception e) {
                Log.w(TAG, "health check detected database error, initiating repair: " + e.getMessage());
            }
        }

        // Ensure CapacitorSQLite closes its fd before any offline repair or file replacement.
        try {
            AppDatabaseCloser.closeConnection();
        } catch (Exception e) {
            Log.w(TAG, "closeConnection before repair returned warning: " + e.getMessage());
        }

        File rawCopy = saveRawCorruptCopy(rescueDir);
        File repairedTmp = null;
        try {
            repairedTmp = File.createTempFile("repaired", ".db", context.getCacheDir());
            //noinspection ResultOfMethodCallIgnored
            repairedTmp.delete();
            deleteSidecars(repairedTmp);

            int totalSalvaged = 0;
            int salvagedInvoices = 0;
            int salvagedCustomers = 0;
            int sourceTables = 0;

            try (
                SqlCipherBridge.DbSession src = openBestEffortForSalvage(liveFile);
                SqlCipherBridge.DbSession dst = SqlCipherBridge.openStandaloneSqlCipher(repairedTmp, true, false)
            ) {
                applyBusyTimeout(dst);
                try {
                    queryString(dst, "PRAGMA journal_mode=DELETE");
                } catch (Exception ignored) {
                    // ignore
                }

                int srcVersion = 1;
                try {
                    int v = src.getVersion();
                    srcVersion = v > 0 ? v : readLogicalSchemaVersion(src);
                } catch (Exception ignored) {
                    // keep default 1
                }

                List<String> tableDdl = new ArrayList<>();
                List<String> indexDdl = new ArrayList<>();
                try (
                    Cursor c = src.rawQuery(
                        "SELECT type, name, sql FROM sqlite_master " +
                        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> 'android_metadata' " +
                        "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
                        null
                    )
                ) {
                    while (c.moveToNext()) {
                        String type = c.getString(0);
                        String name = c.getString(1);
                        String sql = c.getString(2);
                        if (sql == null || sql.trim().isEmpty()) continue;
                        if ("table".equalsIgnoreCase(type)) {
                            if (name != null && ALLOWED_TABLES.contains(name)) {
                                tableDdl.add(sql);
                            }
                        } else if ("index".equalsIgnoreCase(type)) {
                            indexDdl.add(sql);
                        }
                    }
                }

                if (tableDdl.isEmpty()) {
                    throw new SnapshotException("UNRECOVERABLE_HEADER", "تعذّر قراءة تعريف الجداول من قاعدة البيانات التالفة.");
                }
                sourceTables = tableDdl.size();

                dst.execSQL("PRAGMA foreign_keys=OFF");
                dst.beginTransaction();
                try {
                    for (String ddl : tableDdl) {
                        dst.execSQL(ddl);
                    }
                    dst.setTransactionSuccessful();
                } finally {
                    dst.endTransaction();
                }

                for (String ddl : tableDdl) {
                    String table = tableNameFromDdl(ddl);
                    if (table == null || !ALLOWED_TABLES.contains(table)) continue;
                    int rows = copyTableRowsViaCursor(src, dst, table);
                    totalSalvaged += rows;
                    if (
                        "custom_invoices".equals(table) ||
                        "proforma_invoices".equals(table) ||
                        "print_invoices".equals(table)
                    ) {
                        salvagedInvoices += rows;
                    } else if ("customers".equals(table)) {
                        salvagedCustomers += rows;
                    }
                }

                for (String idxSql : indexDdl) {
                    try {
                        dst.execSQL(idxSql);
                    } catch (Exception idxErr) {
                        Log.w(TAG, "skipped index rebuild during salvage: " + idxErr.getMessage());
                    }
                }

                dst.setVersion(Math.max(1, srcVersion));
                String verified = queryString(dst, "PRAGMA integrity_check");
                if (!"ok".equalsIgnoreCase(verified)) {
                    throw new SnapshotException("REPAIR_VERIFY_FAILED", "القاعدة المُصلحة لم تجتز فحص السلامة: " + verified);
                }
            }

            if (sourceTables == 0) {
                throw new SnapshotException("UNRECOVERABLE_HEADER", "لا توجد جداول قابلة للاستنقاذ.");
            }

            byte[] cleanBytes = readFile(repairedTmp);
            replaceDatabase(cleanBytes);

            result.ok = true;
            result.status = "repaired";
            result.salvagedRecords = totalSalvaged;
            result.salvagedInvoices = salvagedInvoices;
            result.salvagedCustomers = salvagedCustomers;
            result.message = "تم اكتشاف تلف في قاعدة البيانات وإصلاحها واستعادة " + totalSalvaged + " سجل بنجاح.";
            Log.i(TAG, "Repaired corrupt DB cleanly: salvagedRecords=" + totalSalvaged + " invoices=" + salvagedInvoices + " customers=" + salvagedCustomers);
            return result;
        } catch (Exception repairErr) {
            Log.e(TAG, "Row-level repair failed; quarantining corrupt DB so app can recover cleanly", repairErr);
            // Quarantine/delete the broken live DB (+ sidecars) so CapacitorSQLite doesn't stay stuck on code 11.
            // The raw forensic copy was already written to `rescueDir`.
            try {
                File dir = liveFile.getParentFile();
                if (liveFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    liveFile.delete();
                }
                if (dir != null) {
                    deleteSidecars(dir, liveFile.getName());
                }
                result.ok = true;
                result.status = "quarantined_reset";
                result.errorCode = "QUARANTINED_CORRUPT_DB";
                result.message =
                    "تعذّر إنقاذ ملف قاعدة البيانات التالف مباشرة" +
                    (rawCopy != null ? " (تم حفظ نسخة للطوارئ)" : "") +
                    ". يمكنك استعادة آخر نسخة احتياطية الآن.";
                return result;
            } catch (Exception resetErr) {
                result.ok = false;
                result.status = "error";
                result.errorCode = "REPAIR_FAILED";
                result.message = String.valueOf(repairErr.getMessage());
                return result;
            }
        } finally {
            if (repairedTmp != null) {
                //noinspection ResultOfMethodCallIgnored
                repairedTmp.delete();
                deleteSidecars(repairedTmp);
            }
        }
    }

    private static SqlCipherBridge.DbSession openBestEffortForSalvage(File liveFile) throws Exception {
        try {
            return SqlCipherBridge.openStandaloneSqlCipher(liveFile, false, false);
        } catch (Exception rwErr) {
            Log.w(TAG, "read-write salvage open failed, retrying read-only: " + rwErr.getMessage());
            return SqlCipherBridge.openStandaloneSqlCipher(liveFile, false, true);
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
            try (SqlCipherBridge.DbSession verifyDb = SqlCipherBridge.openStandaloneSqlCipher(target, false, false)) {
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

    private static boolean tableExists(SqlCipherBridge.DbSession db, String table) throws Exception {
        return tableExists(db, "main", table);
    }

    private static boolean tableExists(SqlCipherBridge.DbSession db, String schema, String table) throws Exception {
        try (Cursor c = db.rawQuery("SELECT name FROM " + schema + ".sqlite_master WHERE type='table' AND name=? LIMIT 1", new String[] { table })) {
            return c.moveToFirst();
        }
    }

    private static int countRows(SqlCipherBridge.DbSession db, String table) throws Exception {
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

    private static int invoiceCount(SqlCipherBridge.DbSession db) throws Exception {
        int total = 0;
        for (String t : new String[] { "custom_invoices", "proforma_invoices", "print_invoices" }) {
            if (tableExists(db, t)) total += countRows(db, t);
        }
        return total;
    }

    private static int businessRecordCount(SqlCipherBridge.DbSession db) throws Exception {
        int total = 0;
        for (String t : BUSINESS_TABLES) {
            if (tableExists(db, t)) total += countRows(db, t);
        }
        return total;
    }

    private static String queryString(SqlCipherBridge.DbSession db, String sql) throws Exception {
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
