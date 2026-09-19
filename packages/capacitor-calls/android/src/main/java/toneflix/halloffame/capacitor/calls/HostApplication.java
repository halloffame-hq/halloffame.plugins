package toneflix.halloffame.capacitor.calls;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.concurrent.atomic.AtomicInteger;

/** Host-specific values are discovered at runtime so this library carries no reseller identity. */
final class HostApplication {
    /** Started host activities. Process importance cannot answer this: a push raises it. */
    private static final AtomicInteger started = new AtomicInteger();
    private static boolean watching;

    private HostApplication() {}

    /** Begins counting, once, from whichever component of the host loads the plugin. */
    static synchronized void watch(Context context) {
        if (watching) return;
        if (!(context.getApplicationContext() instanceof Application application)) return;

        watching = true;
        application.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(@NonNull Activity activity) {
                if (!ours(activity)) started.incrementAndGet();
            }
            @Override public void onActivityStopped(@NonNull Activity activity) {
                if (!ours(activity)) started.updateAndGet(count -> Math.max(0, count - 1));
            }
            @Override public void onActivityCreated(@NonNull Activity a, @Nullable Bundle s) {}
            @Override public void onActivityResumed(@NonNull Activity a) {}
            @Override public void onActivityPaused(@NonNull Activity a) {}
            @Override public void onActivitySaveInstanceState(@NonNull Activity a, @NonNull Bundle s) {}
            @Override public void onActivityDestroyed(@NonNull Activity a) {}
        });
    }

    /** Our own ring is not the host being in front of somebody. */
    private static boolean ours(Activity activity) {
        return activity instanceof IncomingCallActivity;
    }

    static String label(Context context) {
        ApplicationInfo info = context.getApplicationInfo();
        CharSequence label = context.getPackageManager().getApplicationLabel(info);
        return label == null ? context.getPackageName() : label.toString();
    }

    static int icon(Context context) {
        return context.getApplicationInfo().icon;
    }

    static boolean isForeground() {
        return started.get() > 0;
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
