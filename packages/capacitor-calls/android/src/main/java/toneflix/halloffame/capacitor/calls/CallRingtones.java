package toneflix.halloffame.capacitor.calls;

import android.content.Context;
import android.net.Uri;

/**
 * The tones this library packages, and the device-local choice shared with the web settings screen.
 *
 * A tone is named by its position, never by the word a reseller prints beside it: the catalogue of
 * names belongs to the application, and the same five files are shipped here so a closed app can
 * ring with the one that was chosen. A reseller replaces the sound by declaring `hof_ring_<n>` in
 * its own `res/raw`, which ordinary resource merging prefers over the copy below.
 */
final class CallRingtones {
    static final int DEFAULT = 1;
    private static final int[] TONES = {
        R.raw.hof_ring_1, R.raw.hof_ring_2, R.raw.hof_ring_3, R.raw.hof_ring_4, R.raw.hof_ring_5
    };
    private static final String PREFERENCES = "halloffame.calls";
    private static final String KEY = "ringtone";

    private CallRingtones() {}

    /** How many tones are packaged, so the application can tell which of its own have one. */
    static int count() { return TONES.length; }

    static void save(Context context, int tone) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit().putInt(KEY, known(tone) ? tone : DEFAULT).apply();
    }

    static Tone selected(Context context) {
        int tone = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getInt(KEY, DEFAULT);
        if (!known(tone)) tone = DEFAULT;

        return new Tone("tone-" + tone, TONES[tone - 1]);
    }

    static Uri uri(Context context, Tone tone) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + tone.resource);
    }

    private static boolean known(int tone) { return tone >= 1 && tone <= TONES.length; }

    static final class Tone {
        final String key;
        final int resource;
        Tone(String key, int resource) { this.key = key; this.resource = resource; }
    }
}
