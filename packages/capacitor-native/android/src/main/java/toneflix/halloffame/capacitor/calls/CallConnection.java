package toneflix.halloffame.capacitor.calls;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.telecom.CallAudioState;
import android.telecom.Connection;
import android.telecom.DisconnectCause;

import java.util.ArrayList;
import java.util.List;

/** One self-managed Android Telecom connection. */
final class CallConnection extends Connection {
    private final Context context;
    private final String callId;
    private final String caller;
    private final boolean video;

    CallConnection(Context context, String callId, String caller, boolean video) {
        this.context = context;
        this.callId = callId;
        this.caller = caller;
        this.video = video;
        setConnectionCapabilities(CAPABILITY_MUTE | CAPABILITY_SUPPORT_HOLD | CAPABILITY_HOLD);
        setAudioModeIsVoip(true);
    }

    @Override public void onShowIncomingCallUi() {
        CallNotifications.post(context, callId, caller, video);
        TelecomCalls.Listener listener = TelecomCalls.listener();
        if (listener != null) listener.onShowIncoming(callId, caller, video);
    }

    @Override public void onAnswer() {
        setActive();
        TelecomCalls.Listener listener = TelecomCalls.listener();
        if (listener != null) listener.onAnswer(callId);
    }

    @Override public void onAnswer(int videoState) { onAnswer(); }

    @Override public void onReject() {
        close(true);
        TelecomCalls.Listener listener = TelecomCalls.listener();
        if (listener != null) listener.onReject(callId);
    }

    @Override public void onDisconnect() {
        close(false);
        TelecomCalls.Listener listener = TelecomCalls.listener();
        if (listener != null) listener.onDisconnect(callId);
    }

    @Override public void onAbort() { onDisconnect(); }

    @Override public void onCallAudioStateChanged(CallAudioState state) {
        TelecomCalls.Listener listener = TelecomCalls.listener();
        if (listener != null && state != null) {
            listener.onAudioRoute(name(state.getRoute()), available(state.getSupportedRouteMask()));
        }
    }

    void close(boolean rejected) {
        setDisconnected(new DisconnectCause(rejected ? DisconnectCause.REJECTED : DisconnectCause.LOCAL));
        destroy();
        TelecomCalls.forget(callId);
    }

    void route(int route) {
        setAudioRoute(route);
        AudioManager audio = context.getSystemService(AudioManager.class);
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int wanted = route == CallAudioState.ROUTE_SPEAKER
                ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                : route == CallAudioState.ROUTE_BLUETOOTH
                    ? AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    : route == CallAudioState.ROUTE_WIRED_HEADSET
                        ? AudioDeviceInfo.TYPE_WIRED_HEADSET
                        : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                if (device.getType() == wanted) {
                    audio.setCommunicationDevice(device);
                    return;
                }
            }
        }
        audio.setSpeakerphoneOn(route == CallAudioState.ROUTE_SPEAKER);
    }

    private static String name(int route) {
        if (route == CallAudioState.ROUTE_SPEAKER) return "speaker";
        if (route == CallAudioState.ROUTE_BLUETOOTH) return "bluetooth";
        if (route == CallAudioState.ROUTE_WIRED_HEADSET) return "headset";
        return "earpiece";
    }

    private static List<String> available(int mask) {
        List<String> routes = new ArrayList<>();
        if ((mask & CallAudioState.ROUTE_EARPIECE) != 0) routes.add("earpiece");
        if ((mask & CallAudioState.ROUTE_SPEAKER) != 0) routes.add("speaker");
        if ((mask & CallAudioState.ROUTE_WIRED_HEADSET) != 0) routes.add("headset");
        if ((mask & CallAudioState.ROUTE_BLUETOOTH) != 0) routes.add("bluetooth");
        return routes;
    }
}
