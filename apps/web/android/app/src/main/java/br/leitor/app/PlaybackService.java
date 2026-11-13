package br.leitor.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.PowerManager;
import android.os.RemoteException;
import android.util.Log;
import androidx.core.content.IntentCompat;

/**
 * Mantém o app acordado e administra o foco enquanto o WebView reproduz a leitura.
 */
public class PlaybackService extends Service {

    private static final String CHANNEL_ID = "leitor-playback";
    private static final int NOTIFICATION_ID = 4711;
    static final String EXTRA_RECEIVER = "br.leitor.app.PLAYBACK_RECEIVER";
    static final int STARTED = 1;
    static final int START_FAILED = 2;
    static final int INTERRUPTED = 3;

    private final AudioManager.OnAudioFocusChangeListener focusListener = this::onAudioFocusChange;
    private PowerManager.WakeLock wakeLock;
    private AudioFocusRequest focusRequest;
    private AudioManager audioManager;
    private boolean hasAudioFocus;
    private Messenger receiver;

    @Override
    public void onCreate() {
        super.onCreate();
        audioManager = getSystemService(AudioManager.class);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        receiver = intent == null ? null : IntentCompat.getParcelableExtra(intent, EXTRA_RECEIVER, Messenger.class);
        try {
            runAsForeground();
            if (receiver != null && requestAudioFocus()) {
                acquireWakeLock();
                receiver.send(Message.obtain(null, STARTED));
                return START_NOT_STICKY;
            }
        } catch (RemoteException | RuntimeException error) {
            Log.w("LeitorPlayback", "Falha ao preparar a leitura em segundo plano", error);
        }

        finishPlayback(START_FAILED);
        return START_NOT_STICKY;
    }

    private void onAudioFocusChange(int change) {
        // Em leitura falada, uma perda transitória também pausa para evitar perder frases.
        if (hasAudioFocus && change < 0) {
            finishPlayback(INTERRUPTED);
        }
    }

    private void finishPlayback(int result) {
        try {
            releasePlayback(result);
        } finally {
            stopSelf();
        }
    }

    private void releasePlayback(int result) {
        releaseWakeLock();
        abandonAudioFocus();
        stopForeground(STOP_FOREGROUND_REMOVE);
        Messenger callback = receiver;
        receiver = null;
        if (callback == null) return;
        try {
            callback.send(Message.obtain(null, result));
        } catch (RemoteException error) {
            Log.w("LeitorPlayback", "Falha ao comunicar o fim da leitura", error);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releasePlayback(INTERRUPTED);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void runAsForeground() {
        Intent openApp = new Intent(this, MainActivity.class);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, openApp, pendingFlags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        Notification notification = builder
                .setContentTitle(getString(R.string.playback_notification_title))
                .setContentText(getString(R.string.playback_notification_text))
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(Notification.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.playback_channel_name),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.playback_channel_desc));
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power == null) return;
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "leitor:playback");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private boolean requestAudioFocus() {
        if (hasAudioFocus) return true;
        if (audioManager == null) return false;

        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build())
                    .setWillPauseWhenDucked(true)
                    .setOnAudioFocusChangeListener(focusListener, new Handler(Looper.getMainLooper()))
                    .build();
            result = audioManager.requestAudioFocus(request);
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) focusRequest = request;
        } else {
            result = audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return hasAudioFocus;
    }

    private void abandonAudioFocus() {
        if (!hasAudioFocus) return;
        hasAudioFocus = false;
        if (Build.VERSION.SDK_INT >= 26) {
            audioManager.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
    }
}
