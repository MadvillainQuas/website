package uk.co.prophesyscouting.epinoia;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

/**
 * THE APP'S ONE NOTIFICATION CHANNEL, "Game alerts".
 *
 * Why the app has its own channel: androidx.browser copies each delegated notification onto a
 * channel it creates at IMPORTANCE_DEFAULT, which never pops up as a heads-up. Game alerts is
 * IMPORTANCE_HIGH, vibrates, and shows in full on the lock screen. Every delegated notification
 * is re-posted here by {@link EpinoiaDelegationService}.
 *
 * The id is a contract with the website (push.js reads chan= from the launch URL) and with the
 * owner's adb check (dumpsys should show mImportance=4). Never rename it: Android keeps the user's
 * choices per channel id, and a new id would silently reset them.
 */
final class Channels {

    /** The channel id. Shared contract: do not change. */
    static final String ALERTS = "epinoia_alerts";

    /** What the launcher reports as chan= when the channel does not exist (should never happen). */
    static final int IMPORTANCE_MISSING = -1;

    private Channels() {}

    /**
     * CREATES GAME ALERTS IF IT IS NOT THERE YET. Safe to call on every start: Android ignores
     * importance, vibration and visibility for an existing channel, so the user's own settings
     * always win after the first creation; only the name and description are refreshed.
     */
    static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                ALERTS,
                context.getString(R.string.channel_alerts_name),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(context.getString(R.string.channel_alerts_description));
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    /**
     * THE CHANNEL'S CURRENT IMPORTANCE, as Android's own integer (HIGH is 4, NONE is 0).
     * Below Android 8 there are no channels: the app posts at priority HIGH, so it reports 4 when
     * the app's notifications are on and 0 when they are off.
     */
    static int importance(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return NotificationManagerCompat.from(context).areNotificationsEnabled()
                    ? NotificationManagerCompat.IMPORTANCE_HIGH
                    : NotificationManagerCompat.IMPORTANCE_NONE;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return IMPORTANCE_MISSING;
        NotificationChannel channel = manager.getNotificationChannel(ALERTS);
        return channel == null ? IMPORTANCE_MISSING : channel.getImportance();
    }

    /** Whether the user has left Game alerts switched on (any importance above NONE). */
    static boolean isEnabled(Context context) {
        return importance(context) != NotificationManagerCompat.IMPORTANCE_NONE;
    }
}
