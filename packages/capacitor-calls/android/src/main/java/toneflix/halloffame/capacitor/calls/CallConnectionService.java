package toneflix.halloffame.capacitor.calls;

import android.os.Bundle;
import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.DisconnectCause;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;

/** Creates the self-managed Telecom connection declared by the plugin manifest. */
public class CallConnectionService extends ConnectionService {
    @Override public Connection onCreateIncomingConnection(PhoneAccountHandle handle, ConnectionRequest request) {
        return connection(request, true);
    }

    @Override public Connection onCreateOutgoingConnection(PhoneAccountHandle handle, ConnectionRequest request) {
        return connection(request, false);
    }

    @Override public void onCreateIncomingConnectionFailed(PhoneAccountHandle handle, ConnectionRequest request) {
        Bundle extras = request.getExtras() == null ? new Bundle() : request.getExtras();
        Bundle details = extras.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS);
        if (details == null) details = extras;
        String callId = details.getString(TelecomCalls.EXTRA_CALL_ID, "");
        if (!callId.isEmpty()) {
            CallNotifications.post(getApplicationContext(), callId,
                details.getString(TelecomCalls.EXTRA_CALLER, ""),
                details.getBoolean(TelecomCalls.EXTRA_VIDEO, false));
        }
    }

    private Connection connection(ConnectionRequest request, boolean incoming) {
        Bundle extras = request.getExtras() == null ? new Bundle() : request.getExtras();
        Bundle details = extras.getBundle(incoming
            ? TelecomManager.EXTRA_INCOMING_CALL_EXTRAS
            : TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS);
        if (details == null) details = extras;
        String callId = details.getString(TelecomCalls.EXTRA_CALL_ID, "");
        if (callId.isEmpty()) {
            return Connection.createFailedConnection(new DisconnectCause(
                DisconnectCause.ERROR, "A call with no id is not ours."));
        }
        CallConnection connection = new CallConnection(getApplicationContext(), callId,
            details.getString(TelecomCalls.EXTRA_CALLER, ""),
            details.getBoolean(TelecomCalls.EXTRA_VIDEO, false));
        connection.setAddress(request.getAddress(), TelecomManager.PRESENTATION_ALLOWED);
        connection.setCallerDisplayName(details.getString(TelecomCalls.EXTRA_CALLER, ""),
            TelecomManager.PRESENTATION_ALLOWED);
        if (incoming) connection.setRinging(); else connection.setDialing();
        TelecomCalls.hold(callId, connection);
        return connection;
    }
}
