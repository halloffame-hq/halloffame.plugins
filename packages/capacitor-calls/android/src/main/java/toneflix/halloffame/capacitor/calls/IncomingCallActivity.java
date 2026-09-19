package toneflix.halloffame.capacitor.calls;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

/** Minimal branded-by-host call activity that may safely appear over the keyguard. */
public class IncomingCallActivity extends Activity {
    static final String EXTRA_CALL_ID = "callId";
    static final String EXTRA_CALLER = "callerName";
    static final String EXTRA_VIDEO = "video";
    static final String EXTRA_EXPIRES_AT = "expiresAt";
    private boolean answering;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable expire;

    static void show(Context context, String id, String caller, boolean video) {
        context.startActivity(new Intent(context, IncomingCallActivity.class)
            .putExtra(EXTRA_CALL_ID, id).putExtra(EXTRA_CALLER, caller)
            .putExtra(EXTRA_VIDEO, video).putExtra(EXTRA_EXPIRES_AT, CallNotifications.deadline(id))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP));
    }

    private final BroadcastReceiver settled = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!answering) finish();
        }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        showOverKeyguard();
        setContentView(R.layout.hof_activity_incoming_call);
        Intent intent = getIntent();
        String id = intent.getStringExtra(EXTRA_CALL_ID);
        String caller = intent.getStringExtra(EXTRA_CALLER);
        boolean video = intent.getBooleanExtra(EXTRA_VIDEO, false);
        long expires = intent.getLongExtra(EXTRA_EXPIRES_AT, System.currentTimeMillis() + 45_000L);
        if (id == null || id.isEmpty()) { finish(); return; }

        ((TextView) findViewById(R.id.hof_call_app_name)).setText(HostApplication.label(this));
        String shown = caller == null || caller.trim().isEmpty()
            ? getString(R.string.hof_call_unknown_caller) : caller.trim();
        ((TextView) findViewById(R.id.hof_call_caller)).setText(shown);
        ((TextView) findViewById(R.id.hof_call_caller_initial))
            .setText(shown.substring(0, 1).toUpperCase());
        ((TextView) findViewById(R.id.hof_call_subtitle)).setText(getString(video
            ? R.string.hof_call_incoming_video : R.string.hof_call_incoming_voice));
        ((ImageButton) findViewById(R.id.hof_call_answer)).setOnClickListener(view -> answer(id));
        ((ImageButton) findViewById(R.id.hof_call_decline)).setOnClickListener(view -> decline(id));
        ContextCompat.registerReceiver(this, settled,
            new IntentFilter(HostApplication.settledAction(this)), ContextCompat.RECEIVER_NOT_EXPORTED);
        expire = () -> { TelecomCalls.end(id, false); CallNotifications.stop(this); finish(); };
        handler.postDelayed(expire, Math.max(0L, expires - System.currentTimeMillis()));
    }

    @Override protected void onDestroy() {
        if (expire != null) handler.removeCallbacks(expire);
        unregisterReceiver(settled);
        super.onDestroy();
    }

    private void answer(String id) {
        answering = true;
        Intent open = CallNotifications.callAction(this, id, "answer");
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard != null && keyguard.isKeyguardLocked()) {
            keyguard.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { open(open); }
                @Override public void onDismissCancelled() { answering = false; }
                @Override public void onDismissError() { open(open); }
            });
            return;
        }
        open(open);
    }
    private void open(Intent intent) {
        startActivity(intent); CallNotifications.stop(this); finish();
    }
    private void decline(String id) {
        TelecomCalls.end(id, true);
        CallNotifications.stop(this); finish();
    }
    private void showOverKeyguard() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true); setTurnScreenOn(true); return;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
