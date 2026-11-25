package com.futureprint.calculator.backup;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.List;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * Runs scheduled backups with no WebView involved.
 *
 * Why native (and not the JS layer):
 *  - the user may never open the app for days; a JS-only scheduler cannot fire;
 *  - the snapshot and the SAF write are native operations anyway;
 *  - it keeps working after an app update because WorkManager persists the job.
 *
 * The worker is scheduled with an initial 15-minute delay from the web layer
 * (see src/lib/backup/autoBackup.ts) so WorkManager's own 10-20 minute timing
 * granularity is not a surprise.
 */
public class BackupWorker extends Worker {

    public static final String WORK_NAME = "ta_backup_daily";
    public static final String CATCHUP_WORK_NAME = "ta_backup_catchup";
    private static final String TAG = "BackupWorker";
    private static final String CHANNEL_ID = "ta_backup_alerts";
    private static final int NOTIFICATION_ID = 4711;

    public BackupWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        try {
            SharedPreferences prefs = BackupEngine.prefs(ctx);
            boolean autoDaily = prefs.getBoolean("auto_daily", true);
            boolean afterTransaction = prefs.getBoolean("after_transaction", true);
            if (!autoDaily && !afterTransaction) {
                return Result.success();
            }

            BackupEngine engine = new BackupEngine(ctx);
            JSONObject status = engine.status();
            JSONObject storage = status.optJSONObject("storage");
            String state = storage == null ? "unavailable" : storage.optString("state", "unavailable");

            if ("ok".equals(state) && storage != null) {
                int offset = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
                List<BackupEngine.FileRecord> records = engine.listRecords();
                String kind = autoDaily ? pickKind(records, offset) : "transaction";
                boolean encryptEnabled = prefs.getBoolean("encryption_enabled", false);
                JSONObject options = new JSONObject();
                options.put("kind", kind);
                options.put("skipIfUnchanged", !records.isEmpty());
                options.put("encrypt", encryptEnabled);
                JSONObject result = engine.createBackup(options);
                if (!result.optBoolean("ok", false)) {
                    notifyFailure(ctx, result.optString("message", "فشل النسخ الاحتياطي التلقائي."));
                    return Result.retry();
                }
                return Result.success();
            } else if ("permission-lost".equals(state) || "PERMISSION_LOST".equals(state)) {
                notifyPermissionLost(ctx);
            } else if ("folder-not-selected".equals(state) || "NO_FOLDER".equals(state)) {
                // Nothing to do until the user chooses a folder: success, not retry,
                // so WorkManager does not spin on a guarantee that cannot be met.
                return Result.success();
            }
            return Result.success();
        } catch (Throwable t) {
            Log.e(TAG, "scheduled backup crashed", t);
            notifyFailure(ctx, String.valueOf(t.getMessage()));
            return Result.retry();
        }
    }

    /** Chooses the highest-value period backup that is still missing. */
    private String pickKind(List<BackupEngine.FileRecord> records, int offsetMinutes) {
        long now = System.currentTimeMillis();
        if (RetentionPlanner.shouldCreate("monthly", now, records, offsetMinutes)) return "monthly";
        if (RetentionPlanner.shouldCreate("weekly", now, records, offsetMinutes)) return "weekly";
        return "daily";
    }

    private void notifyFailure(Context ctx, String message) {
        ensureChannel(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Intent intent = new Intent(ctx, com.futureprint.calculator.MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("https://localhost/#/settings"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            ctx,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, CHANNEL_ID)
            : new Notification.Builder(ctx);
        builder
            .setContentTitle("تعذّر إنشاء النسخة الاحتياطية")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setAutoCancel(true)
            .setContentIntent(pi);
        nm.notify(NOTIFICATION_ID, builder.build());
    }

    private void notifyPermissionLost(Context ctx) {
        notifyFailure(ctx, "أعد ربط مجلد النسخ الاحتياطي من صفحة الإعدادات.");
    }

    private void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "تنبيهات النسخ الاحتياطي", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("تنبيهات فشل أو تأخر النسخ الاحتياطي لبيانات الفواتير");
            nm.createNotificationChannel(channel);
        }
    }
}
