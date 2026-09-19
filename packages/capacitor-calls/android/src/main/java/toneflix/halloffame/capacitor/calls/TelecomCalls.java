package toneflix.halloffame.capacitor.calls;

import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.telecom.CallAudioState;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.util.Log;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Package-neutral registration and control of the host application's self-managed calls. */
final class TelecomCalls {
    private static final String TAG = "HallOfFameCalls";
    static final String EXTRA_CALL_ID = "toneflix.halloffame.calls.CALL_ID";
    static final String EXTRA_CALLER = "toneflix.halloffame.calls.CALLER";
    static final String EXTRA_VIDEO = "toneflix.halloffame.calls.VIDEO";
    private static final Map<String, CallConnection> live = new ConcurrentHashMap<>();
    /** One offer per call: the push and the web layer's signal describe the same ring. */
    private static final Set<String> offered = ConcurrentHashMap.newKeySet();
    private static Listener listener;

    interface Listener {
        void onAnswer(String callId);
        void onReject(String callId);
        void onDisconnect(String callId);
        void onAudioRoute(String route, List<String> available);
        void onShowIncoming(String callId, String caller, boolean video);
    }

    private TelecomCalls() {}
    static void listen(Listener value) { listener = value; }
    static Listener listener() { return listener; }

    static PhoneAccountHandle handle(Context context) {
        return new PhoneAccountHandle(new ComponentName(context, CallConnectionService.class),
            context.getPackageName() + ".halloffame-calls");
    }

    static boolean register(Context context) {
        TelecomManager telecom = context.getSystemService(TelecomManager.class);
        if (telecom == null) return false;
        PhoneAccount account = PhoneAccount.builder(handle(context), HostApplication.label(context))
            .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED | PhoneAccount.CAPABILITY_VIDEO_CALLING)
            .addSupportedUriScheme(PhoneAccount.SCHEME_SIP).build();
        try { telecom.registerPhoneAccount(account); return true; }
        catch (Exception refused) { Log.w(TAG, "Telecom registration refused", refused); return false; }
    }

    static boolean incoming(Context context, String callId, String caller, boolean video) {
        TelecomManager telecom = context.getSystemService(TelecomManager.class);
        if (telecom == null) return false;
        if (!offered.add(callId)) return true;
        register(context);
        Bundle extras = new Bundle();
        extras.putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,
            Uri.fromParts(PhoneAccount.SCHEME_SIP, address(context, callId), null));
        extras.putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, details(callId, caller, video));
        try { telecom.addNewIncomingCall(handle(context), extras); return true; }
        catch (Exception refused) {
            offered.remove(callId);
            Log.w(TAG, "Incoming call refused", refused);
            return false;
        }
    }

    static boolean outgoing(Context context, String callId, String callee, boolean video) {
        TelecomManager telecom = context.getSystemService(TelecomManager.class);
        if (telecom == null) return false;
        if (!offered.add(callId)) return true;
        register(context);
        Bundle extras = new Bundle();
        extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle(context));
        extras.putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, details(callId, callee, video));
        try {
            telecom.placeCall(Uri.fromParts(PhoneAccount.SCHEME_SIP, address(context, callId), null), extras);
            return true;
        } catch (Exception refused) {
            offered.remove(callId);
            Log.w(TAG, "Outgoing call refused", refused);
            return false;
        }
    }

    static void active(String callId) { CallConnection call = live.get(callId); if (call != null) call.setActive(); }
    static void end(String callId, boolean rejected) {
        offered.remove(callId);
        CallConnection call = live.remove(callId); if (call != null) call.close(rejected);
    }
    static void route(String callId, String route) {
        CallConnection call = live.get(callId);
        if (call == null) return;
        call.route("speaker".equals(route) ? CallAudioState.ROUTE_SPEAKER
            : "bluetooth".equals(route) ? CallAudioState.ROUTE_BLUETOOTH
            : "headset".equals(route) ? CallAudioState.ROUTE_WIRED_HEADSET
            : CallAudioState.ROUTE_EARPIECE);
    }
    static void hold(String id, CallConnection call) { live.put(id, call); }
    static void forget(String id) { live.remove(id); offered.remove(id); }

    private static Bundle details(String id, String person, boolean video) {
        Bundle extras = new Bundle();
        extras.putString(EXTRA_CALL_ID, id);
        extras.putString(EXTRA_CALLER, person == null ? "" : person);
        extras.putBoolean(EXTRA_VIDEO, video);
        return extras;
    }
    private static String address(Context context, String id) {
        return id + "@" + context.getPackageName();
    }
}
