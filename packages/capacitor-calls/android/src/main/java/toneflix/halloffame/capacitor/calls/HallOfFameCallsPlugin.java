package toneflix.halloffame.capacitor.calls;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/** The only public native bridge; manifest components remain implementation details. */
@CapacitorPlugin(name = "HallOfFameCalls")
public class HallOfFameCallsPlugin extends Plugin implements TelecomCalls.Listener {
    @Override public void load() {
        TelecomCalls.listen(this);
        TelecomCalls.register(getContext());
    }

    @Override protected void handleOnDestroy() {
        TelecomCalls.listen(null);
        super.handleOnDestroy();
    }

    @PluginMethod public void canRingFullScreen(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("granted", NotificationManagerCompat.from(getContext()).canUseFullScreenIntent());
        answer.put("askable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE);
        answer.put("overlay", Settings.canDrawOverlays(getContext()));
        call.resolve(answer);
    }

    @PluginMethod public void openOverlaySettings(PluginCall call) {
        openSetting(call, Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
    }

    @PluginMethod public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { call.resolve(); return; }
        openSetting(call, Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
    }

    private void openSetting(PluginCall call, String action) {
        Intent intent = new Intent(action, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(intent); call.resolve(); }
        catch (Exception unavailable) { call.reject("This phone has no screen for that setting."); }
    }

    @PluginMethod public void setRingtone(PluginCall call) {
        Integer tone = call.getInt("tone", CallRingtones.DEFAULT);
        CallRingtones.save(getContext(), tone == null ? CallRingtones.DEFAULT : tone);
        JSObject answer = new JSObject();
        answer.put("tones", CallRingtones.count());
        call.resolve(answer);
    }

    @PluginMethod public void incoming(PluginCall call) {
        String id = call.getString("callId", "");
        JSObject answer = new JSObject();
        answer.put("held", id != null && !id.isEmpty() && TelecomCalls.incoming(getContext(), id,
            call.getString("caller", ""), Boolean.TRUE.equals(call.getBoolean("video", false))));
        call.resolve(answer);
    }

    @PluginMethod public void outgoing(PluginCall call) {
        String id = call.getString("callId", "");
        JSObject answer = new JSObject();
        answer.put("held", id != null && !id.isEmpty() && TelecomCalls.outgoing(getContext(), id,
            call.getString("callee", ""), Boolean.TRUE.equals(call.getBoolean("video", false))));
        call.resolve(answer);
    }

    @PluginMethod public void active(PluginCall call) {
        TelecomCalls.active(call.getString("callId", "")); call.resolve();
    }
    @PluginMethod public void end(PluginCall call) {
        TelecomCalls.end(call.getString("callId", ""),
            Boolean.TRUE.equals(call.getBoolean("rejected", false))); call.resolve();
    }
    @PluginMethod public void route(PluginCall call) {
        TelecomCalls.route(call.getString("callId", ""), call.getString("route", "earpiece"));
        call.resolve();
    }

    @Override public void onAnswer(String id) { notifyListeners("answer", named(id)); }
    @Override public void onReject(String id) { notifyListeners("reject", named(id)); }
    @Override public void onDisconnect(String id) { notifyListeners("disconnect", named(id)); }
    @Override public void onAudioRoute(String route, List<String> available) {
        JSObject event = new JSObject();
        event.put("route", route);
        event.put("available", JSArray.from(available.toArray()));
        notifyListeners("audioRoute", event);
    }
    @Override public void onShowIncoming(String id, String caller, boolean video) {
        JSObject event = named(id);
        event.put("caller", caller); event.put("video", video);
        notifyListeners("showIncoming", event);
    }
    private JSObject named(String id) {
        JSObject event = new JSObject(); event.put("callId", id); return event;
    }
}
