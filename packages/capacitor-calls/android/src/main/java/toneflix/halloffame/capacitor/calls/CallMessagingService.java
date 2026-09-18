package toneflix.halloffame.capacitor.calls;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

/** Pulls high-priority call data messages out before forwarding every other push to Capacitor. */
public class CallMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String event = data.get("event");
        if ("call.ringing".equals(event)) {
            CallNotifications.ring(getApplicationContext(), payload(data));
            return;
        }
        if ("call.settled".equals(event)) {
            CallNotifications.stop(getApplicationContext());
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    private JSONObject payload(Map<String, String> data) {
        String held = data.get("payload");
        if (held == null) return new JSONObject();
        try { return new JSONObject(held); } catch (Exception malformed) { return new JSONObject(); }
    }
}
