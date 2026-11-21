package com.futureprint.calculator.backup;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;
import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Single-engine database access bridge for the backup/restore/repair layer.
 *
 * Ensures that ALL reads, checkpoints, VACUUM INTO snapshots, merges, and
 * corruption salvage operations on the application's database go through the
 * exact same `libsqlcipher.so` engine that CapacitorSQLite uses — and, when the
 * app's WebView connection is already open, reuses that open handle directly
 * without opening/closing any extra POSIX file descriptor.
 */
final class SqlCipherBridge {

    private static final String TAG = "SqlCipherBridge";
    private static final String SQLCIPHER_CLASS = "net.zetetic.database.sqlcipher.SQLiteDatabase";
    private static volatile boolean libraryLoaded = false;

    private SqlCipherBridge() {}

    static final class DbSession implements AutoCloseable {

        private final Object supportDb;
        private final SQLiteDatabase fallbackDb;
        private final boolean liveBorrowed;

        DbSession(Object supportDb, boolean liveBorrowed) {
            this.supportDb = supportDb;
            this.fallbackDb = null;
            this.liveBorrowed = liveBorrowed;
        }

        DbSession(SQLiteDatabase fallbackDb) {
            this.supportDb = null;
            this.fallbackDb = fallbackDb;
            this.liveBorrowed = false;
        }

        boolean isLiveBorrowed() {
            return liveBorrowed;
        }

        Cursor rawQuery(String sql, String[] stringArgs) throws Exception {
            if (fallbackDb != null) {
                return fallbackDb.rawQuery(sql, stringArgs);
            }
            if (stringArgs == null || stringArgs.length == 0) {
                return (Cursor) invokeSupport("query", new Class<?>[] { String.class }, sql);
            }
            Object[] objArgs = new Object[stringArgs.length];
            System.arraycopy(stringArgs, 0, objArgs, 0, stringArgs.length);
            return (Cursor) invokeSupport("query", new Class<?>[] { String.class, Object[].class }, sql, objArgs);
        }

        void execSQL(String sql) throws Exception {
            if (fallbackDb != null) {
                fallbackDb.execSQL(sql);
                return;
            }
            invokeSupport("execSQL", new Class<?>[] { String.class }, sql);
        }

        void execSQL(String sql, Object[] bindArgs) throws Exception {
            if (fallbackDb != null) {
                if (bindArgs == null) fallbackDb.execSQL(sql);
                else fallbackDb.execSQL(sql, bindArgs);
                return;
            }
            if (bindArgs == null) {
                invokeSupport("execSQL", new Class<?>[] { String.class }, sql);
            } else {
                invokeSupport("execSQL", new Class<?>[] { String.class, Object[].class }, sql, bindArgs);
            }
        }

        int getVersion() throws Exception {
            if (fallbackDb != null) {
                return fallbackDb.getVersion();
            }
            Object res = invokeSupport("getVersion", new Class<?>[0]);
            return res instanceof Number ? ((Number) res).intValue() : 0;
        }

        void setVersion(int version) throws Exception {
            if (fallbackDb != null) {
                fallbackDb.setVersion(version);
                return;
            }
            invokeSupport("setVersion", new Class<?>[] { int.class }, version);
        }

        boolean inTransaction() {
            try {
                if (fallbackDb != null) {
                    return fallbackDb.inTransaction();
                }
                Object res = invokeSupport("inTransaction", new Class<?>[0]);
                return res instanceof Boolean && ((Boolean) res);
            } catch (Exception e) {
                return false;
            }
        }

        void beginTransaction() throws Exception {
            if (fallbackDb != null) {
                fallbackDb.beginTransaction();
                return;
            }
            invokeSupport("beginTransaction", new Class<?>[0]);
        }

        void setTransactionSuccessful() throws Exception {
            if (fallbackDb != null) {
                fallbackDb.setTransactionSuccessful();
                return;
            }
            invokeSupport("setTransactionSuccessful", new Class<?>[0]);
        }

        void endTransaction() {
            try {
                if (fallbackDb != null) {
                    if (fallbackDb.inTransaction()) fallbackDb.endTransaction();
                    return;
                }
                if (inTransaction()) {
                    invokeSupport("endTransaction", new Class<?>[0]);
                }
            } catch (Exception e) {
                Log.w(TAG, "endTransaction warning: " + e.getMessage());
            }
        }

        @Override
        public void close() {
            // CRITICAL: NEVER close CapacitorSQLite's borrowed live handle.
            if (liveBorrowed) return;
            try {
                if (fallbackDb != null) {
                    if (fallbackDb.isOpen()) fallbackDb.close();
                    return;
                }
                if (supportDb != null) {
                    Object open = invokeSupport("isOpen", new Class<?>[0]);
                    if (open instanceof Boolean && ((Boolean) open)) {
                        invokeSupport("close", new Class<?>[0]);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "close warning: " + e.getMessage());
            }
        }

        private Object invokeSupport(String name, Class<?>[] paramTypes, Object... args) throws Exception {
            try {
                Method m = supportDb.getClass().getMethod(name, paramTypes);
                return m.invoke(supportDb, args);
            } catch (InvocationTargetException ite) {
                Throwable cause = ite.getCause();
                if (cause instanceof Exception) throw (Exception) cause;
                if (cause instanceof Error) throw (Error) cause;
                throw ite;
            }
        }
    }

    /**
     * If CapacitorSQLite already has `ta_invoicing_db` open in this process,
     * borrows that exact live handle (zero new fd, zero POSIX lock drop).
     * Otherwise opens `dbFile` via SQLCipher directly.
     */
    static DbSession borrowLiveOrOpenSqlCipher(File dbFile, boolean readOnly) throws Exception {
        Object liveDb = AppDatabaseCloser.getLiveSupportDb();
        if (liveDb != null) {
            return new DbSession(liveDb, true);
        }
        return openStandaloneSqlCipher(dbFile, false, readOnly);
    }

    /**
     * Opens an unencrypted standalone SQLite database file using `libsqlcipher.so`
     * (never touching any open CapacitorSQLite handle). Falls back to platform
     * SQLiteDatabase only if SQLCipher is unavailable (e.g. non-APK unit tests).
     */
    static DbSession openStandaloneSqlCipher(File dbFile, boolean createIfNeeded, boolean readOnly) throws Exception {
        try {
            Class<?> cipherClass = loadSqlCipherClass();
            if (createIfNeeded) {
                Method openOrCreate = findOpenOrCreateMethod(cipherClass);
                if (openOrCreate != null) {
                    Object db = invokeStatic(openOrCreate, dbFile, "", null, null);
                    return new DbSession(db, false);
                }
            }
            int flag = cipherClass.getField(readOnly ? "OPEN_READONLY" : "OPEN_READWRITE").getInt(null);
            Method openDb = findOpenDatabaseMethod(cipherClass);
            if (openDb != null) {
                Object db = invokeStatic(openDb, dbFile.getAbsolutePath(), "", null, flag, null);
                return new DbSession(db, false);
            }
        } catch (ClassNotFoundException | UnsatisfiedLinkError e) {
            Log.w(TAG, "SQLCipher unavailable in this runtime, using platform SQLite fallback");
        }

        SQLiteDatabase fallback = createIfNeeded
            ? SQLiteDatabase.openOrCreateDatabase(dbFile, null)
            : SQLiteDatabase.openDatabase(
                dbFile.getAbsolutePath(),
                null,
                readOnly ? SQLiteDatabase.OPEN_READONLY : SQLiteDatabase.OPEN_READWRITE
            );
        return new DbSession(fallback);
    }

    private static Class<?> loadSqlCipherClass() throws ClassNotFoundException {
        if (!libraryLoaded) {
            synchronized (SqlCipherBridge.class) {
                if (!libraryLoaded) {
                    System.loadLibrary("sqlcipher");
                    libraryLoaded = true;
                }
            }
        }
        return Class.forName(SQLCIPHER_CLASS);
    }

    private static Method findOpenDatabaseMethod(Class<?> clazz) {
        for (Method m : clazz.getMethods()) {
            if (!"openDatabase".equals(m.getName())) continue;
            Class<?>[] p = m.getParameterTypes();
            if (p.length == 5 && p[0] == String.class && p[1] == String.class && p[3] == int.class) {
                return m;
            }
        }
        return null;
    }

    private static Method findOpenOrCreateMethod(Class<?> clazz) {
        for (Method m : clazz.getMethods()) {
            if (!"openOrCreateDatabase".equals(m.getName())) continue;
            Class<?>[] p = m.getParameterTypes();
            if (p.length == 4 && p[0] == File.class && p[1] == String.class) {
                return m;
            }
        }
        return null;
    }

    private static Object invokeStatic(Method m, Object... args) throws Exception {
        try {
            return m.invoke(null, args);
        } catch (InvocationTargetException ite) {
            Throwable cause = ite.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw ite;
        }
    }
}
