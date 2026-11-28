package com.futureprint.calculator;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

/**
 * Native Android Notifications Plugin for T.A Advertising Solution.
 *
 * Delivers real system status-bar notifications (single alerts and expandable InboxStyle
 * digests) for overdue/unpaid invoices and expenses, handles Android 13+ POST_NOTIFICATIONS
 * runtime permissions, and clears only business-alert notifications ("ta_alert" tag)
 * when the user opens or acknowledges the in-app bell without touching backup alerts.
 */
@CapacitorPlugin(
    name = "TaNotifications",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class NativeNotificationsPlugin extends Plugin {

    public static final String EXTRA_NOTIFICATION_ROUTE = "ta_notification_route";
    private static final String TAG = "TaNotifications";
    private static final String CHANNEL_ID = "ta_business_alerts";
    private static final String ALERT_TAG = "ta_alert";
    private static final int DIGEST_NOTIFICATION_ID = 8800;

    @Override
    public void load() {
        ensureChannel(getContext());
    }

    private void ensureChannel(Context ctx) {
        if (ctx == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "تنبيهات الفواتير والأعمال",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("تنبيهات فورية للفواتير المتأخرة وغير المحصّلة والمصروفات غير المسددة");
            channel.enableVibration(true);
            channel.setShowBadge(true);
            nm.createNotificationChannel(channel);
        }
    }

    private boolean isNotificationAllowed(Context ctx) {
        if (ctx == null) return false;
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private String sanitizeRoute(String rawRoute) {
        if (rawRoute == null || rawRoute.trim().isEmpty()) {
            return "/finance";
        }
        String r = rawRoute.trim();
        if (!r.startsWith("/")) {
            r = "/" + r;
        }
        return r;
    }

    private PendingIntent buildLaunchIntent(Context ctx, String route, int requestCode) {
        String safeRoute = sanitizeRoute(route);
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("https://localhost/#" + safeRoute));
        intent.putExtra(EXTRA_NOTIFICATION_ROUTE, safeRoute);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, requestCode, intent, flags);
    }

    private int resolveSmallIcon(Context ctx) {
        int appIcon = ctx.getApplicationInfo().icon;
        return appIcon != 0 ? appIcon : android.R.drawable.ic_dialog_info;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        Context ctx = getContext();
        JSObject res = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            boolean enabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
            res.put("granted", enabled);
            res.put("state", enabled ? "granted" : "denied");
            call.resolve(res);
            return;
        }
        PermissionState state = getPermissionState("notifications");
        boolean granted = isNotificationAllowed(ctx);
        res.put("granted", granted);
        res.put("state", granted ? "granted" : (state != null ? state.toString() : "prompt"));
        call.resolve(res);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            boolean enabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
            JSObject res = new JSObject();
            res.put("granted", enabled);
            res.put("state", enabled ? "granted" : "denied");
            call.resolve(res);
            return;
        }
        if (isNotificationAllowed(ctx)) {
            JSObject res = new JSObject();
            res.put("granted", true);
            res.put("state", "granted");
            call.resolve(res);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsPermissionCallback");
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        boolean granted = isNotificationAllowed(getContext());
        JSObject res = new JSObject();
        res.put("granted", granted);
        res.put("state", granted ? "granted" : "denied");
        call.resolve(res);
    }

    @PluginMethod
    public void sendNotification(PluginCall call) {
        Context ctx = getContext();
        ensureChannel(ctx);
        if (!isNotificationAllowed(ctx)) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("permissionRequired", true);
            call.resolve(res);
            return;
        }

        String idKey = call.getString("id", "alert-default");
        String title = call.getString("title", "تنبيه من T.A Advertising");
        String body = call.getString("body", "");
        String route = call.getString("route", "/finance");
        boolean urgent = Boolean.TRUE.equals(call.getBoolean("urgent", false));

        int notifId = 8801 + Math.abs(idKey.hashCode() % 1000);
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                call.resolve(res);
                return;
            }
            NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(resolveSmallIcon(ctx))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(urgent ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(buildLaunchIntent(ctx, route, notifId));

            nm.notify(ALERT_TAG, notifId, builder.build());

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("id", notifId);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "sendNotification failed", e);
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("message", String.valueOf(e.getMessage()));
            call.resolve(res);
        }
    }

    @PluginMethod
    public void sendDigestNotification(PluginCall call) {
        Context ctx = getContext();
        ensureChannel(ctx);
        if (!isNotificationAllowed(ctx)) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("permissionRequired", true);
            call.resolve(res);
            return;
        }

        String title = call.getString("title", "تنبيهات الفواتير والأعمال");
        String body = call.getString("body", "لديك تنبيهات جديدة للمتابعة");
        String summary = call.getString("summary", "T.A Advertising Solution");
        String route = call.getString("route", "/finance");
        boolean urgent = Boolean.TRUE.equals(call.getBoolean("urgent", false));
        JSArray lines = call.getArray("lines");

        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                call.resolve(res);
                return;
            }

            NotificationCompat.InboxStyle inboxStyle = new NotificationCompat.InboxStyle()
                .setBigContentTitle(title)
                .setSummaryText(summary);
            if (lines != null) {
                JSONArray raw = lines;
                int max = Math.min(raw.length(), 6);
                for (int i = 0; i < max; i++) {
                    String line = raw.optString(i, "").trim();
                    if (!line.isEmpty()) {
                        inboxStyle.addLine(line);
                    }
                }
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(resolveSmallIcon(ctx))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(inboxStyle)
                .setPriority(urgent ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(buildLaunchIntent(ctx, route, DIGEST_NOTIFICATION_ID));

            nm.notify(ALERT_TAG, DIGEST_NOTIFICATION_ID, builder.build());

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("id", DIGEST_NOTIFICATION_ID);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "sendDigestNotification failed", e);
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("message", String.valueOf(e.getMessage()));
            call.resolve(res);
        }
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        Context ctx = getContext();
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(ALERT_TAG, DIGEST_NOTIFICATION_ID);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    StatusBarNotification[] active = nm.getActiveNotifications();
                    if (active != null) {
                        for (StatusBarNotification sbn : active) {
                            if (ALERT_TAG.equals(sbn.getTag())) {
                                nm.cancel(ALERT_TAG, sbn.getId());
                            }
                        }
                    }
                }
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "clearAll failed", e);
            JSObject res = new JSObject();
            res.put("ok", false);
            call.resolve(res);
        }
    }
}
