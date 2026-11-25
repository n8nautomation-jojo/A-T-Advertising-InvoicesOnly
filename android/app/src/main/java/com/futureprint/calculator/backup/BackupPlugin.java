package com.futureprint.calculator.backup;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Bridge between the Arabic RTL web UI and the native backup engine.
 *
 * Every method that touches storage runs on a dedicated single-thread executor,
 * so the WebView thread is never blocked by a large snapshot or a slow SD card.
 * The URI-picker methods must run on the UI thread (SAF requires an Activity).
 */
@CapacitorPlugin(name = "TaBackup")
public class BackupPlugin extends Plugin {

    private static final String TAG = "BackupPlugin";
    private static final int REQUEST_PICK_FOLDER = 9001;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private volatile BackupEngine engine;

    /** Kept so the worker and engine can reach the bridge for connection closing. */
    @Override
    public void load() {
        BridgeAccess.set(getBridge());
        if (engine == null) engine = new BackupEngine(getContext());
        // Do NOT open the live SQLite database OPEN_READWRITE during load():
        // WebView/SQLCipher initializes the same database file concurrently.
        Log.i(TAG, "TaBackup plugin loaded");
    }

    private void background(PluginCall call, final CallTask task) {
        EXECUTOR.execute(() -> {
            try {
                JSObject result = task.run();
                call.resolve(result);
            } catch (BackupStorage.FolderUnavailableException e) {
                Log.e(TAG, "plugin task folder unavailable: " + e.code, e);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("errorCode", e.code);
                err.put("message", e.getMessage() == null ? "" : e.getMessage());
                call.resolve(err);
            } catch (Exception e) {
                Log.e(TAG, "plugin task failed", e);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("errorCode", "IO_FAILED");
                err.put("message", String.valueOf(e.getMessage()));
                call.resolve(err);
            }
        });
    }

    private interface CallTask {
        JSObject run() throws Exception;
    }

    private BackupEngine engine() {
        if (engine == null) {
            synchronized (BackupPlugin.class) {
                if (engine == null) engine = new BackupEngine(getContext());
            }
        }
        return engine;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Folder selection
    // ═══════════════════════════════════════════════════════════════════════

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("errorCode", "IO_FAILED");
            err.put("message", "النشاط غير متاح.");
            call.resolve(err);
            return;
        }
        Intent intent = engine().storage().buildOpenDocumentTreeIntent();
        startActivityForResult(call, intent, "folderPicked");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void folderPicked(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("ok", false);
            cancelled.put("errorCode", "CANCELLED");
            cancelled.put("message", "لم يتم اختيار مجلد.");
            call.resolve(cancelled);
            return;
        }
        final Uri treeUri = result.getData().getData();
        final int intentFlags = result.getData().getFlags();
        background(call, () -> {
            BackupStorage storage = engine().storage();
            storage.persistFolder(treeUri, intentFlags);
            engine().rememberPreferredFolder(treeUri.toString());
            BackupEngine.prefs(getContext())
                .edit()
                .putString("folder_uri", treeUri.toString())
                .putString("folder_label", storage.getFolderLabel())
                .commit();
            engine().clearLastFailureState();
            scheduleWork();
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("folderUri", treeUri.toString());
            out.put("folderLabel", storage.getFolderLabel());
            return out;
        });
    }

    /** Re-binds a previously persisted folder (after reinstall the grant is gone). */
    @PluginMethod
    public void restoreFolderPermission(PluginCall call) {
        final String uriString = call.getString("treeUri", "");
        background(call, () -> {
            BackupStorage storage = engine().storage();
            storage.rememberFolderIfGranted(uriString);
            JSObject out = new JSObject();
            boolean granted = !storage.getFolderUri().isEmpty();
            out.put("ok", granted);
            out.put("folderUri", storage.getFolderUri());
            out.put("folderLabel", storage.getFolderLabel());
            return out;
        });
    }

    @PluginMethod
    public void getFolder(PluginCall call) {
        background(call, () -> {
            BackupStorage storage = engine().storage();
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("folderUri", storage.getFolderUri());
            out.put("folderLabel", storage.getFolderLabel());
            out.put("preferredFolderUri", engine().getPreferredFolder());
            return out;
        });
    }

    @PluginMethod
    public void forgetFolder(PluginCall call) {
        background(call, () -> {
            engine().storage().forget();
            BackupEngine.prefs(getContext()).edit().remove("folder_uri").remove("folder_label").commit();
            JSObject out = new JSObject();
            out.put("ok", true);
            return out;
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Status / backups
    // ═══════════════════════════════════════════════════════════════════════

    @PluginMethod
    public void getStatus(PluginCall call) {
        background(call, () -> new JSObject(engine().status().toString()));
    }

    @PluginMethod
    public void listBackups(PluginCall call) {
        background(call, () -> new JSObject(engine().listBackups().toString()));
    }

    @PluginMethod
    public void createBackup(PluginCall call) {
        final JSONObject options = optionsOf(call);
        background(call, () -> new JSObject(engine().createBackup(options).toString()));
    }

    @PluginMethod
    public void verifyBackup(PluginCall call) {
        final String fileName = call.getString("fileName", "");
        background(call, () -> new JSObject(engine().verifyBackup(fileName).toString()));
    }

    @PluginMethod
    public void restoreBackup(PluginCall call) {
        if (call == null) return;
        final JSONObject options = optionsOf(call);
        String fName = call.getString("fileName");
        if (fName == null || fName.trim().isEmpty()) {
            fName = call.getString("name");
        }
        if (fName == null || fName.trim().isEmpty()) {
            fName = options.optString("fileName", "");
        }
        if (fName == null || fName.trim().isEmpty()) {
            fName = options.optString("name", "");
        }
        if (fName == null || fName.trim().isEmpty()) {
            fName = options.optString("file", "");
        }
        try {
            if (fName != null && !fName.trim().isEmpty()) {
                options.put("fileName", fName.trim());
            }
        } catch (Exception ignored) {}

        String mode = call.getString("mode");
        if (mode == null || mode.trim().isEmpty()) {
            mode = options.optString("mode", "replace");
        }
        try {
            options.put("mode", mode);
        } catch (Exception ignored) {}

        final JSONObject finalOptions = options;
        background(call, () -> new JSObject(engine().restore(finalOptions).toString()));
    }

    @PluginMethod
    public void discoverBackups(PluginCall call) {
        background(call, () -> new JSObject(engine().discover().toString()));
    }

    @PluginMethod
    public void exportArchive(PluginCall call) {
        final String fileName = call.getString("fileName", "");
        background(call, () -> new JSObject(engine().exportArchive(fileName).toString()));
    }

    @PluginMethod
    public void importArchive(PluginCall call) {
        final String base64 = call.getString("base64", "");
        final String fileName = call.getString("fileName", "");
        background(call, () -> new JSObject(engine().importArchive(base64, fileName).toString()));
    }

    @PluginMethod
    public void getDbCounts(PluginCall call) {
        background(call, () -> {
            JSObject out = new JSObject();
            JSONObject status = engine().status();
            JSONObject database = status.optJSONObject("database");
            out.put("ok", true);
            out.put("counts", database == null ? new JSONObject() : database.optJSONObject("counts"));
            out.put("invoiceCount", database == null ? 0 : database.optInt("invoiceCount", 0));
            out.put("totalBusinessRecords", database == null ? 0 : database.optInt("totalBusinessRecords", 0));
            out.put("schemaVersion", database == null ? 0 : database.optInt("schemaVersion", 0));
            return out;
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Settings & scheduling
    // ═══════════════════════════════════════════════════════════════════════

    @PluginMethod
    public void saveSettings(PluginCall call) {
        final JSONObject settings = optionsOf(call);
        background(call, () -> {
            BackupEngine.prefs(getContext())
                .edit()
                .putBoolean("encryption_enabled", settings.optBoolean("encryptionEnabled", false))
                .putBoolean("auto_daily", settings.optBoolean("autoDaily", true))
                .putBoolean("after_transaction", settings.optBoolean("afterTransaction", true))
                .putInt("retention_daily", Math.max(0, settings.optInt("retentionDaily", 30)))
                .putInt("retention_weekly", Math.max(0, settings.optInt("retentionWeekly", 4)))
                .putInt("retention_monthly", Math.max(0, settings.optInt("retentionMonthly", 1)))
                .putInt("retention_max_age_days", Math.max(0, settings.optInt("retentionMaxAgeDays", 30)))
                .putInt("retention_min", Math.max(1, settings.optInt("retentionMinimum", 2)))
                .putInt("stale_after_hours", Math.max(1, settings.optInt("staleAfterHours", 48)))
                .putInt("transaction_throttle_minutes", Math.max(1, settings.optInt("transactionThrottleMinutes", 2)))
                .commit();
            if (settings.has("transactionThrottleMinutes")) {
                BackupEngine.prefs(getContext())
                    .edit()
                    .putLong(
                        "transaction_throttle_ms",
                        Math.max(1, settings.optInt("transactionThrottleMinutes", 2)) * 60000L
                    )
                    .commit();
            }
            scheduleForSettings(settings.optBoolean("autoDaily", true));
            JSObject out = new JSObject();
            out.put("ok", true);
            return out;
        });
    }

    @PluginMethod
    public void getEngineInfo(PluginCall call) {
        background(call, () -> {
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("engineVersion", BackupEngine.ENGINE_VERSION);
            out.put("appVersionCode", engine().appVersionCode());
            out.put("sdkInt", Build.VERSION.SDK_INT);
            out.put("model", Build.MANUFACTURER + " " + Build.MODEL);
            out.put("supported", true);
            out.put("scheduleSupported", true);
            return out;
        });
    }

    private void scheduleWork() {
        scheduleForSettings(BackupEngine.prefs(getContext()).getBoolean("auto_daily", true));
    }

    private void scheduleForSettings(boolean enabled) {
        try {
            WorkManager wm = WorkManager.getInstance(getContext());
            if (!enabled) {
                wm.cancelUniqueWork(BackupWorker.WORK_NAME);
                return;
            }
            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .build();
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                BackupWorker.class,
                12,
                TimeUnit.HOURS,
                2,
                TimeUnit.HOURS
            )
                .setConstraints(constraints)
                .addTag(BackupWorker.WORK_NAME)
                .build();
            wm.enqueueUniquePeriodicWork(BackupWorker.WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
        } catch (Throwable t) {
            Log.e(TAG, "could not schedule backups", t);
        }
    }

    @PluginMethod
    public void scheduleImmediateCatchUp(PluginCall call) {
        background(call, () -> {
            JSObject out = new JSObject();
            try {
                WorkManager wm = WorkManager.getInstance(getContext());
                Constraints constraints = new Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                    .build();
                OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(BackupWorker.class)
                    .setConstraints(constraints)
                    .addTag(BackupWorker.CATCHUP_WORK_NAME)
                    .build();
                wm.enqueueUniqueWork(BackupWorker.CATCHUP_WORK_NAME, ExistingWorkPolicy.KEEP, request);
                out.put("ok", true);
            } catch (Throwable t) {
                Log.e(TAG, "could not schedule catch-up backup", t);
                out.put("ok", false);
                out.put("errorCode", "IO_FAILED");
                out.put("message", String.valueOf(t.getMessage()));
            }
            return out;
        });
    }

    @PluginMethod
    public void pruneBackups(PluginCall call) {
        background(call, () -> new JSObject(engine().pruneBackups().toString()));
    }

    @PluginMethod
    public void setScheduledBackupEnabled(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", true);
        background(call, () -> {
            BackupEngine.prefs(getContext()).edit().putBoolean("auto_daily", enabled).commit();
            scheduleForSettings(enabled);
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("enabled", enabled);
            return out;
        });
    }

    @PluginMethod
    public void getBackupRecords(PluginCall call) {
        background(call, () -> {
            JSObject out = new JSObject();
            JSONObject listed = engine().listBackups();
            out.put("ok", listed.optBoolean("ok", false));
            out.put("backups", listed.optJSONArray("backups") == null ? new JSONArray() : listed.getJSONArray("backups"));
            if (!listed.optBoolean("ok", false)) {
                out.put("errorCode", listed.optString("errorCode", "IO_FAILED"));
                out.put("message", listed.optString("message", ""));
            }
            return out;
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Recovery Key & Pre-Update Backup
    // ═══════════════════════════════════════════════════════════════════════

    @PluginMethod
    public void exportRecoveryKey(PluginCall call) {
        background(call, () -> new JSObject(engine().exportRecoveryKey().toString()));
    }

    @PluginMethod
    public void importRecoveryKey(PluginCall call) {
        final JSONObject options = optionsOf(call);
        String code = call.getString("recoveryKey");
        if (code == null || code.trim().isEmpty()) code = call.getString("code");
        if (code == null || code.trim().isEmpty()) code = call.getString("key");
        if (code == null || code.trim().isEmpty()) code = options.optString("recoveryKey", "");
        if (code == null || code.trim().isEmpty()) code = options.optString("code", "");
        if (code == null || code.trim().isEmpty()) code = options.optString("key", "");
        final String finalCode = code == null ? "" : code.trim();
        background(call, () -> new JSObject(engine().importRecoveryKey(finalCode).toString()));
    }

    @PluginMethod
    public void getEncryptionInfo(PluginCall call) {
        background(call, () -> new JSObject(engine().getEncryptionInfo().toString()));
    }

    @PluginMethod
    public void preparePreUpdateBackup(PluginCall call) {
        final JSONObject options = optionsOf(call);
        String appVersion = call.getString("appVersion");
        if (appVersion == null || appVersion.trim().isEmpty()) {
            appVersion = options.optString("appVersion", "");
        }
        Integer targetSchemaObj = call.getInt("targetSchema");
        int targetSchema = targetSchemaObj != null ? targetSchemaObj : options.optInt("targetSchema", 0);
        final String finalAppVersion = appVersion;
        final int finalTargetSchema = targetSchema;
        background(call, () -> new JSObject(engine().preparePreUpdateBackup(finalAppVersion, finalTargetSchema).toString()));
    }

    @PluginMethod
    public void ensureDatabaseHealthy(PluginCall call) {
        final JSONObject options = optionsOf(call);
        boolean forceFlag = Boolean.TRUE.equals(call != null ? call.getBoolean("forceRepair", false) : Boolean.FALSE);
        final boolean forceRepair = forceFlag || options.optBoolean("forceRepair", false);
        background(call, () -> new JSObject(engine().ensureDatabaseHealthy(forceRepair).toString()));
    }

    private JSONObject optionsOf(PluginCall call) {
        if (call == null) return new JSONObject();
        try {
            JSONObject options = call.getObject("options");
            if (options != null && options.length() > 0) {
                return options;
            }
            JSObject data = call.getData();
            return data != null ? data : new JSONObject();
        } catch (Exception e) {
            JSObject data = call.getData();
            return data != null ? data : new JSONObject();
        }
    }
}
