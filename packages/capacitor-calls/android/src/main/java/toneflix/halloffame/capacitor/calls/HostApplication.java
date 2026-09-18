package toneflix.halloffame.capacitor.calls;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;

/** Host-specific values are discovered at runtime so this library carries no reseller identity. */
final class HostApplication {
    private HostApplication() {}

    static String label(Context context) {
        ApplicationInfo info = context.getApplicationInfo();
        CharSequence label = context.getPackageManager().getApplicationLabel(info);
        return label == null ? context.getPackageName() : label.toString();
    }

    static int icon(Context context) {
        return context.getApplicationInfo().icon;
    }

    static boolean isForeground(Context context) {
        ActivityManager.RunningAppProcessInfo state = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(state);
        return state.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            || state.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    }

    static String settledAction(Context context) {
        return context.getPackageName() + ".HALL_OF_FAME_CALL_SETTLED";
    }

    static Intent callAction(Context context, String callId, String action) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(Intent.ACTION_MAIN).setPackage(context.getPackageName());

        return launch
            .setAction(Intent.ACTION_VIEW)
            .setData(
                new Uri.Builder()
                    .scheme(context.getPackageName())
                    .authority("call")
                    .appendPath(callId)
                    .appendQueryParameter("action", action)
                    .build()
            )
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    }
}
