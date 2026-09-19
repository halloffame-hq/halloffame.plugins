package toneflix.halloffame.capacitor.calls;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles an action that must not bring the reseller application's UI forward. */
public class CallActionReceiver extends BroadcastReceiver {
    private static final String ACTION_DECLINE = ".HALL_OF_FAME_CALL_DECLINE";
    private static final String EXTRA_CALL_ID = "callId";

    static Intent decline(Context context, String callId) {
        return new Intent(context, CallActionReceiver.class)
            .setAction(context.getPackageName() + ACTION_DECLINE)
            .putExtra(EXTRA_CALL_ID, callId);
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (!((context.getPackageName() + ACTION_DECLINE).equals(intent.getAction()))) return;

        String callId = intent.getStringExtra(EXTRA_CALL_ID);
        if (callId != null && !callId.isEmpty()) TelecomCalls.end(callId, true);
        CallNotifications.stop(context);
    }
}
