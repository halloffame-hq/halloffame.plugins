package toneflix.halloffame.capacitor.calls;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Native ring surface used before the host application's WebView exists. */
final class CallNotifications {
    private static final String TAG = "HallOfFameCalls";
    private static final String CHANNEL_ID = "halloffame.calls";
    private static final int NOTIFICATION_ID = 8801;
    private static final long DEFAULT_RING_MILLIS = 45_000L;
    /** The API sends an ISO instant; another transport may carry a coarser one. */
    private static final String[] ISO_8601 = {
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX"
    };
    private static final Map<String, Long> expirations = new ConcurrentHashMap<>();

    private CallNotifications() {}

    static void ring(Context context, JSONObject payload) {
        JSONObject call = payload.optJSONObject("meta");
        if (call == null) return;
        String callId = call.optString("callId", "");
        if (callId.isEmpty()) return;
        String caller = call.optString("callerName", "");
        boolean video = "video".equals(call.optString("mediaMode", ""));
        long expiresAt = expiry(call.optString("ringExpiresAt", ""));
        // A window that has already closed names a call nobody can answer.
        if (expiresAt <= System.currentTimeMillis()) {
            Log.w(TAG, "A call arrived after its ring had expired.");
            return;
        }
        expirations.put(callId, expiresAt);

        if (HostApplication.isForeground()) {
            TelecomCalls.incoming(context, callId, caller, video);
            return;
        }
        post(context, callId, caller, video);
        if (Settings.canDrawOverlays(context)) {
            IncomingCallActivity.show(context, callId, caller, video);
        }
        TelecomCalls.incoming(context, callId, caller, video);
    }

    static Notification build(Context context, String callId, String name, boolean video) {
        String channel = ensureChannel(context);
        CallRingtones.Tone tone = CallRingtones.selected(context);
        String caller = name == null || name.isEmpty()
            ? context.getString(R.string.hof_call_unknown_caller) : name;
        PendingIntent ring = fullScreen(context, callId, caller, video);
        PendingIntent answer = open(context, callId, "answer");
        PendingIntent decline = PendingIntent.getActivity(context, 1,
            HostApplication.callAction(context, callId, "decline"),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(HostApplication.icon(context))
            .setContentTitle(caller)
            .setContentText(context.getString(video
                ? R.string.hof_call_incoming_video : R.string.hof_call_incoming_voice))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true).setAutoCancel(false)
            .setSound(CallRingtones.uri(context, tone))
            .setContentIntent(ring).setTimeoutAfter(remaining(callId))
            .setFullScreenIntent(ring, true);
        Person person = new Person.Builder().setName(caller).setImportant(true).build();
        builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer));
        if (!NotificationManagerCompat.from(context).canUseFullScreenIntent()) {
            Log.w(TAG, "Full-screen call intents are not permitted.");
        }
        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT;
        return notification;
    }

    static void post(Context context, String callId, String name, boolean video) {
        if (HostApplication.isForeground()) return;
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID,
                build(context, callId, name, video));
        } catch (SecurityException refused) {
            Log.w(TAG, "Notification permission was not granted.");
        }
    }

    static void stop(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        expirations.clear();
        context.sendBroadcast(new Intent(HostApplication.settledAction(context))
            .setPackage(context.getPackageName()));
    }

    static Intent callAction(Context context, String callId, String action) {
        return HostApplication.callAction(context, callId, action);
    }

    private static PendingIntent fullScreen(Context context, String id, String caller, boolean video) {
        Intent intent = new Intent(context, IncomingCallActivity.class)
            .putExtra(IncomingCallActivity.EXTRA_CALL_ID, id)
            .putExtra(IncomingCallActivity.EXTRA_CALLER, caller)
            .putExtra(IncomingCallActivity.EXTRA_VIDEO, video)
            .putExtra(IncomingCallActivity.EXTRA_EXPIRES_AT, deadline(id))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 2, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent open(Context context, String id, String action) {
        return PendingIntent.getActivity(context, 0, HostApplication.callAction(context, id, action),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static long deadline(String id) {
        return expirations.computeIfAbsent(id,
            ignored -> System.currentTimeMillis() + DEFAULT_RING_MILLIS);
    }
    private static long remaining(String id) {
        return Math.max(1L, deadline(id) - System.currentTimeMillis());
    }
    /** The instant the ring is over, never clamped forward. No expiry means the default window. */
    private static long expiry(String value) {
        if (value != null && !value.isEmpty()) {
            for (String pattern : ISO_8601) {
                try {
                    Date parsed = new SimpleDateFormat(pattern, Locale.US).parse(value);
                    if (parsed != null) return parsed.getTime();
                } catch (Exception ignored) {}
            }
            Log.w(TAG, "A call named a ring expiry that could not be read.");
        }
        return System.currentTimeMillis() + DEFAULT_RING_MILLIS;
    }

    private static String ensureChannel(Context context) {
        CallRingtones.Tone tone = CallRingtones.selected(context);
        String id = CHANNEL_ID + "." + tone.key;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return id;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(id) != null) return id;
        NotificationChannel channel = new NotificationChannel(id,
            context.getString(R.string.hof_call_channel_name), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(context.getString(R.string.hof_call_channel_description));
        channel.setShowBadge(false);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 700, 600, 700, 600 });
        Uri ringtone = CallRingtones.uri(context, tone);
        channel.setSound(ringtone, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        manager.createNotificationChannel(channel);
        return id;
    }
}
