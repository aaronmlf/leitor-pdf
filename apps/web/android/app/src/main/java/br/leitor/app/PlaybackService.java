package br.leitor.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.ContextCompat;
import java.util.Objects;

/** O serviço publica a sessão de mídia enquanto o WebView sintetiza e reproduz a leitura. */
public class PlaybackService extends Service {
    private static final String TAG = "LeitorPlayback";
    private static final String CHANNEL_ID = "leitor-playback";
    private static final int NOTIFICATION_ID = 4711;
    private static final String ACTION_CONTROL = "br.leitor.app.PLAYBACK_CONTROL";
    private static final String EXTRA_COMMAND = "command";
    private static final long REMOTE_START_TIMEOUT_MS = 5_000L;

    interface Listener {
        void onAction(String action);
        void onInterruption(String reason, long deadline);
    }

    record MediaState(String title, String subtitle, String status, String artworkDataUrl,
                      boolean canGoPrevious, boolean canGoNext) {}

    final class PlaybackBinder extends Binder {
        PlaybackService getService() {
            return PlaybackService.this;
        }
    }

    private final PlaybackBinder binder = new PlaybackBinder();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    private final AudioManager.OnAudioFocusChangeListener focusListener = this::onAudioFocusChange;
    private final Runnable timer = this::checkTimer;
    private final Runnable remoteTimeout = this::onRemoteTimeout;
    private final BroadcastReceiver routeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) interrupt("route");
        }
    };

    private NotificationManager notifications;
    private AudioManager audioManager;
    private Listener listener;
    private MediaSession mediaSession;
    private MediaState mediaState;
    private PendingIntent openApp;
    private Bitmap artwork;
    private String artworkSource;
    private PowerManager.WakeLock wakeLock;
    private AudioFocusRequest focusRequest;
    private boolean hasAudioFocus;
    private boolean routeReceiverRegistered;
    private boolean foreground;
    private boolean initialStartReceived;
    private boolean initialForegroundRequired = true;
    private boolean playing;
    private boolean awaitingRemoteStart;
    private long deadline;
    private long timerUptime;

    @Override
    public void onCreate() {
        super.onCreate();
        audioManager = getSystemService(AudioManager.class);
        notifications = getSystemService(NotificationManager.class);
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openApp = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_CONTROL.equals(intent.getAction())) {
            if (listener != null) handleAction(intent.getStringExtra(EXTRA_COMMAND));
            else stopSelf();
        } else {
            initialStartReceived = true;
            try {
                if (initialForegroundRequired) enterForeground();
                if (!foreground || (listener != null && !playing)) pausePlayback();
            } catch (RuntimeException error) {
                Log.w(TAG, "Falha ao iniciar o serviço de leitura", error);
                closePlayback();
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    boolean requestPlayback() {
        if (expireTimer()) return false;
        if (!startPlayback()) return false;
        awaitingRemoteStart = false;
        handler.removeCallbacks(remoteTimeout);
        return true;
    }

    private boolean startPlayback() {
        if (playing) return true;
        try {
            enterForeground();
            if (requestAudioFocus()) {
                acquireWakeLock();
                ContextCompat.registerReceiver(this, routeReceiver,
                        new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                        ContextCompat.RECEIVER_NOT_EXPORTED);
                routeReceiverRegistered = true;
                playing = true;
                renderMedia();
                checkTimer();
                return playing;
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Falha ao preparar o áudio da leitura", error);
        }
        pausePlayback();
        return false;
    }

    void pausePlayback() {
        playing = false;
        awaitingRemoteStart = false;
        handler.removeCallbacks(remoteTimeout);
        handler.removeCallbacks(timer);
        releaseResources();
        if (foreground) {
            stopForeground(mediaState != null ? STOP_FOREGROUND_DETACH : STOP_FOREGROUND_REMOVE);
            foreground = false;
        }
        // Em uma partida cancelada antes de onStartCommand, deixe a promoção obrigatória chegar.
        if (initialStartReceived) stopSelf();
        renderMedia();
    }

    void closePlayback() {
        mediaState = null;
        deadline = 0L;
        timerUptime = 0L;
        pausePlayback();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Listener current = listener;
        closePlayback();
        if (current != null) current.onInterruption("focus", 0L);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        closePlayback();
        super.onDestroy();
    }

    void updateMedia(MediaState state) {
        if (Objects.equals(mediaState, state)) return;
        mediaState = state;
        renderMedia();
    }

    void setTimer(long deadline) {
        if (this.deadline != deadline) {
            this.deadline = deadline;
            timerUptime = deadline <= 0 ? 0 : SystemClock.uptimeMillis() + Math.max(0, deadline - System.currentTimeMillis());
        }
        checkTimer();
    }

    private void checkTimer() {
        handler.removeCallbacks(timer);
        if (playing && deadline > 0 && !expireTimer()) handler.postAtTime(timer, timerUptime);
    }

    private boolean expireTimer() {
        if (deadline <= 0 || (SystemClock.uptimeMillis() < timerUptime && System.currentTimeMillis() < deadline)) return false;
        long expired = deadline;
        deadline = 0L;
        timerUptime = 0L;
        pausePlayback();
        if (listener != null) listener.onInterruption("timer", expired);
        return true;
    }

    private void onAudioFocusChange(int change) {
        if (hasAudioFocus && change < 0) interrupt("focus");
    }

    private void interrupt(String reason) {
        if (!playing) return;
        pausePlayback();
        notifyInterruption(reason);
    }

    private void notifyInterruption(String reason) {
        if (listener != null) listener.onInterruption(reason, 0L);
    }

    private void handleAction(String action) {
        if (listener == null || mediaState == null || action == null) return;
        switch (action) {
            case "play" -> {
                if (playing || expireTimer()) return;
                if (!startPlayback()) {
                    notifyInterruption("focus");
                    return;
                }
                awaitingRemoteStart = true;
                handler.postDelayed(remoteTimeout, REMOTE_START_TIMEOUT_MS);
            }
            case "pause" -> {
                if (!playing) return;
                pausePlayback();
            }
            case "previous" -> {
                if (!mediaState.canGoPrevious()) return;
            }
            case "next" -> {
                if (!mediaState.canGoNext()) return;
            }
            default -> { return; }
        }
        listener.onAction(action);
    }

    private void onRemoteTimeout() {
        if (awaitingRemoteStart) pausePlayback();
    }

    private MediaSession createSession() {
        MediaSession session = new MediaSession(this, TAG);
        session.setSessionActivity(openApp);
        session.setPlaybackToLocal(audioAttributes);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { handleAction("play"); }
            @Override public void onPause() { handleAction("pause"); }
            @Override public void onStop() { handleAction("pause"); }
            @Override public void onSkipToPrevious() { handleAction("previous"); }
            @Override public void onSkipToNext() { handleAction("next"); }
        }, handler);
        return session;
    }

    private void renderMedia() {
        if (mediaState == null) {
            if (mediaSession != null) {
                mediaSession.release();
                mediaSession = null;
            }
            artwork = null;
            artworkSource = null;
        } else {
            if (mediaSession == null) mediaSession = createSession();
            updateArtwork();
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, mediaState.title())
                    .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, mediaState.title())
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, mediaState.subtitle())
                    .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, mediaState.subtitle());
            if (artwork != null) {
                metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork)
                        .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);
            }
            mediaSession.setMetadata(metadata.build());
            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP;
            if (mediaState.canGoPrevious()) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
            if (mediaState.canGoNext()) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
            int state = !playing ? PlaybackState.STATE_PAUSED
                    : "playing".equals(mediaState.status()) ? PlaybackState.STATE_PLAYING
                    : PlaybackState.STATE_BUFFERING;
            mediaSession.setPlaybackState(new PlaybackState.Builder().setActions(actions)
                    .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                            state == PlaybackState.STATE_PLAYING ? 1f : 0f).build());
            mediaSession.setActive(true);
        }
        if (notifications == null) return;
        if (mediaState != null || foreground) {
            notifications.notify(NOTIFICATION_ID, buildNotification());
        } else {
            notifications.cancel(NOTIFICATION_ID);
        }
    }

    private void updateArtwork() {
        String source = mediaState.artworkDataUrl();
        if (Objects.equals(source, artworkSource)) return;
        artworkSource = source;
        artwork = null;
        String prefix = "data:image/jpeg;base64,";
        if (source == null || source.length() > 256 * 1024 || !source.startsWith(prefix)) return;
        try {
            byte[] bytes = Base64.decode(source.substring(prefix.length()), Base64.DEFAULT);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth <= 256 && bounds.outHeight <= 256) {
                artwork = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            }
        } catch (IllegalArgumentException error) {
            Log.w(TAG, "Não foi possível mostrar a capa da leitura", error);
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(openApp)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_LOW);
        if (mediaState == null || mediaSession == null) {
            return builder.setContentTitle(getString(R.string.playback_notification_title))
                    .setContentText(getString(R.string.playback_notification_text)).build();
        }
        builder.setContentTitle(mediaState.title()).setContentText(mediaState.subtitle());
        if (artwork != null) builder.setLargeIcon(artwork);
        int count = 0;
        if (mediaState.canGoPrevious()) {
            builder.addAction(notificationAction("previous", android.R.drawable.ic_media_previous, R.string.playback_previous));
            count++;
        }
        builder.addAction(playing
                ? notificationAction("pause", android.R.drawable.ic_media_pause, R.string.playback_pause)
                : notificationAction("play", android.R.drawable.ic_media_play, R.string.playback_play));
        count++;
        if (mediaState.canGoNext()) {
            builder.addAction(notificationAction("next", android.R.drawable.ic_media_next, R.string.playback_next));
            count++;
        }
        int[] compactActions = new int[count];
        for (int index = 0; index < count; index++) compactActions[index] = index;
        return builder.setStyle(new Notification.MediaStyle().setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(compactActions)).build();
    }

    private Notification.Action notificationAction(String command, int icon, int label) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(ACTION_CONTROL)
                .putExtra(EXTRA_COMMAND, command);
        PendingIntent pending = PendingIntent.getService(this, label, intent, PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon),
                getString(label), pending).build();
    }

    private void enterForeground() {
        if (foreground) return;
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        foreground = true;
        initialForegroundRequired = false;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26 || notifications == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                getString(R.string.playback_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.playback_channel_desc));
        notifications.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        PowerManager power = getSystemService(PowerManager.class);
        if (power == null) return;
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "leitor:playback");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseResources() {
        if (routeReceiverRegistered) {
            unregisterReceiver(routeReceiver);
            routeReceiverRegistered = false;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        abandonAudioFocus();
    }

    private boolean requestAudioFocus() {
        if (audioManager == null) return false;
        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(audioAttributes)
                    .setWillPauseWhenDucked(true)
                    .setOnAudioFocusChangeListener(focusListener, handler)
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
