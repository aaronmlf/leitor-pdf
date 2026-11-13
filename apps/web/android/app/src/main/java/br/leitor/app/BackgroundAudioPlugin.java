package br.leitor.app;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.Messenger;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Mantém o serviço e a reprodução no WebView em sincronia. */
@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PlaybackSession session;
    private boolean destroyed;

    @PluginMethod
    public void start(PluginCall call) {
        mainHandler.post(() -> {
            if (destroyed) {
                resolveStart(call, false);
                return;
            }
            if (session != null) {
                if (session.started || session.pendingStart != null) {
                    resolveStart(call, session.started);
                } else {
                    session.pendingStart = call;
                }
                return;
            }

            session = new PlaybackSession(call);
            Intent intent = new Intent(getContext(), PlaybackService.class)
                    .putExtra(PlaybackService.EXTRA_RECEIVER, session.receiver);
            try {
                ContextCompat.startForegroundService(getContext(), intent);
            } catch (RuntimeException error) {
                session = null;
                call.reject("Falha ao iniciar o serviço de áudio", error);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            stopPlayback();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        stopPlayback();
    }

    private void stopPlayback() {
        PlaybackSession current = session;
        if (current == null) return;

        current.completeStart(false);
        // Após startForegroundService, aguarde o serviço entrar em primeiro plano antes de pará-lo.
        if (current.started) {
            session = null;
            getContext().stopService(new Intent(getContext(), PlaybackService.class));
        }
    }

    private static void resolveStart(PluginCall call, boolean started) {
        call.resolve(new JSObject().put("started", started));
    }

    private final class PlaybackSession {
        private final Messenger receiver = new Messenger(new Handler(Looper.getMainLooper(), message -> {
            onPlaybackResult(message.what);
            return true;
        }));
        private PluginCall pendingStart;
        private boolean started;

        PlaybackSession(PluginCall call) {
            pendingStart = call;
        }

        private void onPlaybackResult(int resultCode) {
            if (session != this) return;

            if (resultCode == PlaybackService.STARTED) {
                started = true;
                if (pendingStart == null) {
                    stopPlayback();
                    return;
                }
                completeStart(true);
                ((MainActivity) getActivity()).requestPlaybackNotifications();
                return;
            }

            session = null;
            completeStart(false);
            if (resultCode == PlaybackService.INTERRUPTED) {
                execute(() -> notifyListeners("audioFocusLost", new JSObject()));
            }
        }

        private void completeStart(boolean granted) {
            PluginCall call = pendingStart;
            pendingStart = null;
            if (call != null) resolveStart(call, granted);
        }
    }
}
