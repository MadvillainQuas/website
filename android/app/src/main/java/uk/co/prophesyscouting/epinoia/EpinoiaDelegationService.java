package uk.co.prophesyscouting.epinoia;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.trusted.TrustedWebActivityCallbackRemote;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.google.androidbrowserhelper.locationdelegation.LocationDelegationExtraCommandHandler;
import com.google.androidbrowserhelper.trusted.DelegationService;
import com.google.androidbrowserhelper.trusted.ExtraCommandHandler;
import com.google.androidbrowserhelper.trusted.PermissionStatus;

/**
 * CHROME'S NOTIFICATIONS, POSTED ON THE APP'S OWN "Game alerts" CHANNEL.
 *
 * How delegation works: Chrome receives the site's Web Push, builds the notification, and hands it
 * to this service over Binder, which posts it as the app. That keeps the whole Web Push stack
 * (notify, tags, topics, receipts, the 7-step check) and makes the app's Android settings govern
 * the notification instead of the browser's.
 *
 * Why this subclass exists: the stock path (androidx.browser 1.10.0,
 * TrustedWebActivityService#onNotifyNotificationWithChannel) copies the notification onto a
 * channel named after Chrome's channelName at IMPORTANCE_DEFAULT, and a DEFAULT channel never pops
 * up. Here it goes onto epinoia_alerts at IMPORTANCE_HIGH instead, rebuilt with the same public
 * API the library uses (Notification.Builder.recoverBuilder).
 *
 * Cancel and getActiveNotifications stay with the base class: they work by tag and id, which this
 * class keeps unchanged, so the 2-hour reminder still replaces the 2-day one.
 *
 * Tied to androidbrowserhelper 2.7.3 / androidx.browser 1.10.0. Re-run the Phase 7 checks on
 * every bump.
 */
public class EpinoiaDelegationService extends DelegationService {

    /** NotificationDelegationExtraCommandHandler's command name (package-private there). */
    private static final String COMMAND_CHECK_NOTIFICATION_PERMISSION = "checkNotificationPermission";
    /** NotificationPermissionRequestActivity.KEY_PERMISSION_STATUS (package-private there). */
    private static final String KEY_PERMISSION_STATUS = "permissionStatus";

    @Override
    public void onCreate() {
        super.onCreate();
        Channels.ensure(this);
        // EPINOIA GO: where the phone is, when a fan presses "find the game I'm at" or "stamp this
        // venue" (epinoia/go/). Chrome asks this service; the handler answers with the app's own
        // location permission, asking for it the first time. onExtraCommand below passes it on.
        registerExtraCommandHandler(new LocationDelegationExtraCommandHandler());
    }

    /**
     * RE-POSTS CHROME'S NOTIFICATION ON GAME ALERTS. Returns false when the notification could not
     * be shown (app notifications off, channel off, or no permission), which is what Chrome
     * expects so it can report the failure to the site.
     */
    @Override
    public boolean onNotifyNotificationWithChannel(String platformTag, int platformId,
            Notification notification, String channelName) {
        Channels.ensure(this);

        if (!canPost()) return false;

        Notification toPost;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // recoverBuilder keeps everything Chrome set: title, body, image, actions, tag
            // behaviour, the content intent that opens the right page inside the app.
            Notification.Builder builder = Notification.Builder.recoverBuilder(this, notification);
            builder.setChannelId(Channels.ALERTS);
            // THE ICON NAMES THIS APP'S PACKAGE EXPLICITLY. recoverBuilder rebuilds the builder
            // on Chrome's context (the notification's EXTRA_BUILDER_APPLICATION_INFO is Chrome's,
            // because Chrome built it), and setSmallIcon(int) stamps that context's package onto
            // the Icon. SystemUI would then look R.drawable.ic_stat_epinoia up in Chrome's
            // resources: a random Chrome drawable, or "Bad notification posted" and a crash.
            // Icon.createWithResource(String, int) exists from API 23, and this branch is 26+.
            builder.setSmallIcon(Icon.createWithResource(getPackageName(), R.drawable.ic_stat_epinoia));
            builder.setVisibility(Notification.VISIBILITY_PUBLIC);
            toPost = builder.build();
        } else {
            // NO CHANNELS BELOW ANDROID 8. Priority and vibration on the notification itself
            // are what make it a heads-up there.
            toPost = notification;
            toPost.priority = Notification.PRIORITY_HIGH;
            toPost.defaults |= Notification.DEFAULT_VIBRATE;
            toPost.visibility = Notification.VISIBILITY_PUBLIC;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return false;
        manager.notify(platformTag, platformId, toPost);
        return true;
    }

    /**
     * ANSWERS THE OLDER "MAY I NOTIFY?" CALL FROM GAME ALERTS, not from the channel Chrome named.
     * The channel Chrome asks about is never used, so its state would be the wrong answer.
     * Current Chrome asks through the checkNotificationPermission extra command instead, which
     * onExtraCommand below covers.
     */
    @Override
    public boolean onAreNotificationsEnabled(String channelName) {
        Channels.ensure(this);
        return canPost();
    }

    /**
     * GAME ALERTS OFF MEANS BLOCK, ON THE EXTRA-COMMAND PATH TOO.
     *
     * DelegationService registers NotificationDelegationExtraCommandHandler, which answers
     * checkNotificationPermission with NotificationUtils.areNotificationsEnabled(context,
     * channelName). That looks for Chrome's own "<name>_channel_id" channel, which this app never
     * creates, and treats a missing channel as enabled. So with app notifications on and Game
     * alerts switched off, the library would tell the site ALLOW while
     * onNotifyNotificationWithChannel silently drops every alert.
     *
     * Only that one case is changed. When app notifications are off (or the Android 13+
     * permission is missing) the library's own answer, BLOCK or ASK, is already right and is
     * kept, so Chrome can still offer the permission prompt. Every other command goes to the
     * library unchanged.
     */
    @Nullable
    @Override
    public Bundle onExtraCommand(@NonNull String commandName, @NonNull Bundle args,
            @Nullable TrustedWebActivityCallbackRemote callback) {
        if (COMMAND_CHECK_NOTIFICATION_PERMISSION.equals(commandName)
                && NotificationManagerCompat.from(this).areNotificationsEnabled()
                && !canPost()) {
            Channels.ensure(this);
            Bundle result = new Bundle();
            // Key strings from androidbrowserhelper 2.7.3: ExtraCommandHandler.EXTRA_COMMAND_SUCCESS
            // is public; NotificationPermissionRequestActivity.KEY_PERMISSION_STATUS is
            // package-private, hence the literal.
            result.putInt(KEY_PERMISSION_STATUS, PermissionStatus.BLOCK);
            result.putBoolean(ExtraCommandHandler.EXTRA_COMMAND_SUCCESS, true);
            return result;
        }
        return super.onExtraCommand(commandName, args, callback);
    }

    /** App-level switch, the Android 13+ permission, and the Game alerts channel, all together. */
    private boolean canPost() {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return Channels.isEnabled(this);
    }
}
