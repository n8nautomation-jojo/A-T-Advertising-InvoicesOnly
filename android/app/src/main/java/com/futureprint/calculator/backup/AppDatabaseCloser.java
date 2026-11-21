package com.futureprint.calculator.backup;

import android.util.Log;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Dictionary;
import java.util.Enumeration;

/**
 * Coordinates cleanly with the Capacitor SQLite plugin connection.
 *
 * Why this exists:
 *  - Opening the same WAL database file with a second SQLite C library
 *    (android.database.sqlite vs libsqlcipher.so) drops Linux POSIX fcntl() locks
 *    when the extra handle closes and can desynchronize WAL/SHM state (code 11).
 *  - Therefore, when CapacitorSQLite already has the connection open, backup
 *    inspection and `VACUUM INTO` snapshots MUST borrow that open handle instead
 *    of opening/closing a competing descriptor, and restore/repair paths MUST
 *    close it cleanly first.
 */
final class AppDatabaseCloser {

    private static final String TAG = "AppDatabaseCloser";

    private AppDatabaseCloser() {}

    /**
     * Returns CapacitorSQLite's currently open SupportSQLiteDatabase (`_db`), or
     * null if no connection is open yet. Never opens or closes a connection.
     */
    static Object getLiveSupportDb() {
        try {
            Object implementation = getSqliteImplementation();
            if (implementation == null) return null;
            Field dictField = implementation.getClass().getDeclaredField("dbDict");
            dictField.setAccessible(true);
            Object rawDict = dictField.get(implementation);
            if (!(rawDict instanceof Dictionary)) return null;
            @SuppressWarnings("unchecked")
            Dictionary<Object, Object> dict = (Dictionary<Object, Object>) rawDict;

            String preferredKey = "RW_" + BackupArchiveConstants.DB_FILE_NAME;
            Object dbWrapper = dict.get(preferredKey);
            if (dbWrapper == null) {
                Enumeration<Object> keys = dict.keys();
                while (keys.hasMoreElements()) {
                    Object k = keys.nextElement();
                    String ks = String.valueOf(k);
                    if (ks.startsWith("RW_") && ks.contains(BackupArchiveConstants.DB_NAME)) {
                        dbWrapper = dict.get(k);
                        break;
                    }
                }
            }
            if (dbWrapper == null) return null;

            Method isOpenMethod = dbWrapper.getClass().getMethod("isOpen");
            Object openRes = isOpenMethod.invoke(dbWrapper);
            if (!(openRes instanceof Boolean) || !((Boolean) openRes)) return null;

            Method getDbMethod = dbWrapper.getClass().getMethod("getDb");
            Object supportDb = getDbMethod.invoke(dbWrapper);
            if (supportDb == null) return null;

            Method supportIsOpen = supportDb.getClass().getMethod("isOpen");
            Object supportOpenRes = supportIsOpen.invoke(supportDb);
            if (supportOpenRes instanceof Boolean && ((Boolean) supportOpenRes)) {
                return supportDb;
            }
        } catch (Throwable t) {
            Log.d(TAG, "live SQLite handle not active: " + t.getMessage());
        }
        return null;
    }

    static void closeConnection() throws Exception {
        try {
            Object implementation = getSqliteImplementation();
            if (implementation == null) {
                Log.i(TAG, "SQLite implementation not ready; no connection to close");
                return;
            }
            Method close = implementation
                .getClass()
                .getMethod("closeConnection", String.class, Boolean.class);
            close.invoke(implementation, BackupArchiveConstants.DB_NAME, Boolean.FALSE);
            Log.i(TAG, "closed SQLite connection for " + BackupArchiveConstants.DB_NAME);
        } catch (ClassNotFoundException e) {
            Log.w(TAG, "SQLite plugin not present; nothing to close");
        } catch (NoSuchFieldException | NoSuchMethodException e) {
            Log.w(TAG, "SQLite plugin internals changed; falling back to file swap", e);
            throw e;
        }
    }

    private static Object getSqliteImplementation() throws Exception {
        Class<?> pluginClass = Class.forName("com.getcapacitor.community.database.sqlite.CapacitorSQLitePlugin");
        com.getcapacitor.Bridge bridge = BridgeAccess.getBridge();
        if (bridge == null) {
            return null;
        }
        com.getcapacitor.PluginHandle handle = bridge.getPlugin("CapacitorSQLite");
        Object plugin = handle == null ? null : handle.getInstance();
        if (plugin == null) {
            return null;
        }
        Field implField = pluginClass.getDeclaredField("implementation");
        implField.setAccessible(true);
        return implField.get(plugin);
    }
}
