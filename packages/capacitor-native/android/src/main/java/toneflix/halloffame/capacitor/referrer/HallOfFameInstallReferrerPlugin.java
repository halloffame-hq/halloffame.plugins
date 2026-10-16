package toneflix.halloffame.capacitor.referrer;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/** Reads the Play Store referrer the installed build was downloaded with. */
@CapacitorPlugin(name = "HallOfFameInstallReferrer")
public class HallOfFameInstallReferrerPlugin extends Plugin {
    @PluginMethod public void get(PluginCall call) {
        InstallReferrerClient client = InstallReferrerClient.newBuilder(getContext()).build();
        AtomicBoolean settled = new AtomicBoolean(false);

        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override public void onInstallReferrerSetupFinished(int responseCode) {
                    if (!settled.compareAndSet(false, true)) return;

                    try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            call.resolve(details(client.getInstallReferrer()));
                        } else {
                            call.resolve(empty());
                        }
                    } catch (Exception error) {
                        call.resolve(empty());
                    } finally {
                        client.endConnection();
                    }
                }

                @Override public void onInstallReferrerServiceDisconnected() {
                    if (settled.compareAndSet(false, true)) call.resolve(empty());
                }
            });
        } catch (Exception error) {
            if (settled.compareAndSet(false, true)) call.resolve(empty());
        }
    }

    private JSObject details(ReferrerDetails details) {
        JSObject result = new JSObject();
        String referrer = details.getInstallReferrer();
        result.put("referrer", referrer == null || referrer.isEmpty() ? JSObject.NULL : referrer);
        result.put("clickedAt", details.getReferrerClickTimestampSeconds() * 1000);
        result.put("installedAt", details.getInstallBeginTimestampSeconds() * 1000);

        return result;
    }

    private JSObject empty() {
        JSObject result = new JSObject();
        result.put("referrer", JSObject.NULL);
        result.put("clickedAt", JSObject.NULL);
        result.put("installedAt", JSObject.NULL);

        return result;
    }
}
