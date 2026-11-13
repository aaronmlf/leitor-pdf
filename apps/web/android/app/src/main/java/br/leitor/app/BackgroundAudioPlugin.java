package br.leitor.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Liga a sessão do leitor no WebView ao serviço de reprodução. */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PlaybackConnection connection;
    private PlaybackService.MediaState mediaState;
    private long timerDeadline;
    private boolean destroyed;

    @PluginMethod
    public void start(PluginCall call) {
        mainHandler.post(() -> {
            if (destroyed) {
                resolveStart(call, false);
                return;
            }
            if (connection != null) {
                connection.start(call);
                return;
            }

            PlaybackConnection next = new PlaybackConnection();
            connection = next;
            next.start(call);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        boolean keepSession = Boolean.TRUE.equals(call.getBoolean("keepSession", false));
        mainHandler.post(() -> {
            stopPlayback(keepSession);
            call.resolve();
        });
    }

    @PluginMethod
    public void updateState(PluginCall call) {
        PlaybackService.MediaState state = new PlaybackService.MediaState(
                call.getString("title", ""), call.getString("subtitle", ""),
                call.getString("status", "paused"), call.getString("artworkDataUrl"),
                Boolean.TRUE.equals(call.getBoolean("canGoPrevious", false)),
                Boolean.TRUE.equals(call.getBoolean("canGoNext", false)));
        mainHandler.post(() -> {
            if (!destroyed) {
                mediaState = state;
                if (connection != null && connection.service != null) connection.service.updateMedia(state);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        // Datas JS em milissegundos são lidas como Long pelo JSONObject.
        long deadline = call.getData().optLong("deadline", 0L);
        mainHandler.post(() -> {
            if (!destroyed) {
                timerDeadline = deadline;
                if (connection != null && connection.service != null) connection.service.setTimer(deadline);
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        mediaState = null;
        if (connection != null) {
            connection.completeStart(false);
            if (connection.service != null) connection.service.closePlayback();
            connection.disconnect();
        }
    }

    private void stopPlayback(boolean keepSession) {
        if (!keepSession) mediaState = null;
        if (connection == null) return;
        connection.stop(keepSession);
    }

    private static void resolveStart(PluginCall call, boolean started) {
        call.resolve(new JSObject().put("started", started));
    }

    private final class PlaybackConnection implements ServiceConnection, PlaybackService.Listener {
        private PlaybackService service;
        private PluginCall pendingStart;
        private boolean bound;
        private boolean keepWhenReady;

        private void start(PluginCall call) {
            if (pendingStart != null) {
                resolveStart(call, false);
                return;
            }
            pendingStart = call;
            keepWhenReady = false;
            if (service != null) {
                requestPlayback();
                return;
            }
            if (bound) return;

            Intent intent = new Intent(getContext(), PlaybackService.class);
            try {
                bound = getContext().bindService(intent, this, Context.BIND_AUTO_CREATE);
                if (!bound) {
                    completeStart(false);
                    disconnect();
                    return;
                }
                ContextCompat.startForegroundService(getContext(), intent);
            } catch (RuntimeException error) {
                pendingStart = null;
                disconnect();
                call.reject("Falha ao iniciar o serviço de áudio", error);
            }
        }

        private void stop(boolean keepSession) {
            completeStart(false);
            if (service == null) {
                // onStartCommand deve entrar em primeiro plano antes de encerrar uma partida cancelada.
                keepWhenReady = keepSession;
                return;
            }
            if (keepSession && mediaState != null) {
                service.pausePlayback();
            } else {
                service.closePlayback();
                disconnect();
            }
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            if (connection != this) return;
            service = ((PlaybackService.PlaybackBinder) binder).getService();
            service.setListener(this);
            service.updateMedia(mediaState);
            service.setTimer(timerDeadline);
            if (pendingStart != null) requestPlayback();
            else stop(keepWhenReady);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            if (connection != this) return;
            completeStart(false);
            disconnect();
            publishInterruption("focus", 0L);
        }

        @Override
        public void onNullBinding(ComponentName name) {
            onServiceDisconnected(name);
        }

        @Override
        public void onBindingDied(ComponentName name) {
            onServiceDisconnected(name);
        }

        @Override
        public void onAction(String action) {
            execute(() -> notifyListeners("audioAction", new JSObject().put("action", action)));
        }

        @Override
        public void onInterruption(String reason, long deadline) {
            if (deadline != 0 && timerDeadline == deadline) timerDeadline = 0L;
            publishInterruption(reason, deadline);
        }

        private void publishInterruption(String reason, long deadline) {
            JSObject event = new JSObject().put("reason", reason);
            if (deadline != 0) event.put("deadline", deadline);
            execute(() -> notifyListeners("audioFocusLost", event));
        }

        private void completeStart(boolean granted) {
            PluginCall call = pendingStart;
            pendingStart = null;
            if (call != null) resolveStart(call, granted);
        }

        private void requestPlayback() {
            boolean granted = service.requestPlayback();
            completeStart(granted);
            if (granted && mediaState == null) ((MainActivity) getActivity()).requestPlaybackNotifications();
        }

        private void disconnect() {
            if (connection != this) return;
            connection = null;
            if (service != null) service.setListener(null);
            service = null;
            if (bound) {
                bound = false;
                getContext().unbindService(this);
            }
        }
    }
}
