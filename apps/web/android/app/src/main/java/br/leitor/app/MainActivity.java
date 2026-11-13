package br.leitor.app;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String NOTIFICATIONS_REQUESTED = "playbackNotificationsRequested";
    private final ActivityResultLauncher<String> notificationPermission =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {});

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(BackupFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }

    void requestPlaybackNotifications() {
        if (Build.VERSION.SDK_INT < 33 || !getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            return;
        }
        String permission = Manifest.permission.POST_NOTIFICATIONS;
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) return;

        SharedPreferences preferences = getPreferences(MODE_PRIVATE);
        if (preferences.getBoolean(NOTIFICATIONS_REQUESTED, false)) return;

        preferences.edit().putBoolean(NOTIFICATIONS_REQUESTED, true).apply();
        notificationPermission.launch(permission);
    }
}
