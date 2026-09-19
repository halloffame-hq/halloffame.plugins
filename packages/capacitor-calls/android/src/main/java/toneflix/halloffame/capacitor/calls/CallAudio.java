package toneflix.halloffame.capacitor.calls;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

/**
 * Holds a ring on the loudspeaker. WebView audio otherwise follows whatever output is
 * already in use, so a call after one taken on the earpiece rings into somebody's ear.
 */
final class CallAudio {
    private static final String TAG = "HallOfFameCalls";
    private static boolean holding;
    private static boolean wasSpeakerphoneOn;

    private CallAudio() {}

    static synchronized void ringOnSpeaker(Context context, boolean active) {
        AudioManager audio = context.getSystemService(AudioManager.class);
        if (audio == null || active == holding) return;

        try {
            if (active) {
                wasSpeakerphoneOn = audio.isSpeakerphoneOn();
                holding = speaker(audio);
                return;
            }
            release(audio);
            holding = false;
        } catch (Exception refused) {
            Log.w(TAG, "The ring could not be moved to the loudspeaker", refused);
            holding = false;
        }
    }

    private static boolean speaker(AudioManager audio) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo device : audio.getAvailableCommunicationDevices()) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    return audio.setCommunicationDevice(device);
                }
            }
            return false;
        }
        audio.setSpeakerphoneOn(true);
        return true;
    }

    private static void release(AudioManager audio) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // The call that follows picks its own device.
            audio.clearCommunicationDevice();
            return;
        }
        audio.setSpeakerphoneOn(wasSpeakerphoneOn);
    }
}
