package uk.co.prophesyscouting.epinoia;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.app.NotificationManagerCompat;

/**
 * THE APP'S OWN NOTIFICATION SETTINGS SCREEN.
 *
 * The website cannot read or change Android settings, so its "Open notification settings" button
 * opens this screen with
 * intent://notification-settings#Intent;scheme=epinoia;package=uk.co.prophesyscouting.epinoia;end
 *
 * It shows the four things that decide whether a Game alert pops up (app notifications, the
 * channel's importance, Do Not Disturb, battery restrictions) and has one button into each of the
 * matching Android settings pages. Everything is re-read in onResume, so coming back from Android's
 * settings shows the new state at once.
 */
public class NotificationSettingsActivity extends Activity {

    private LinearLayout mRows;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Channels.ensure(this);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(getColor(R.color.epinoia_ground_light));
        scroll.setFitsSystemWindows(true);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        column.setPadding(pad, pad, pad, pad);
        scroll.addView(column, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = text(getString(R.string.settings_title), 24, R.color.epinoia_ink_light);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        column.addView(title);

        TextView intro = text(getString(R.string.settings_intro), 15, R.color.epinoia_ink2_light);
        column.addView(intro, topMargin(6));

        mRows = new LinearLayout(this);
        mRows.setOrientation(LinearLayout.VERTICAL);
        column.addView(mRows, topMargin(16));

        column.addView(button(R.string.settings_open_app, v -> openAppNotificationSettings()), topMargin(20));
        column.addView(button(R.string.settings_open_channel, v -> openChannelSettings()), topMargin(10));
        column.addView(button(R.string.settings_open_battery, v -> openBatterySettings()), topMargin(10));

        TextView testHint = text(getString(R.string.settings_test_hint), 15, R.color.epinoia_ink2_light);
        column.addView(testHint, topMargin(24));

        Button back = button(R.string.settings_back, v -> finish());
        back.setBackgroundColor(0x00000000);
        back.setTextColor(getColor(R.color.epinoia_lume_light));
        column.addView(back, topMargin(12));

        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderStatus();
    }

    // ---------------------------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------------------------

    private void renderStatus() {
        mRows.removeAllViews();

        boolean appOn = NotificationManagerCompat.from(this).areNotificationsEnabled();
        boolean permissionOk = Build.VERSION.SDK_INT < 33
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
        addRow(R.string.settings_row_app,
                appOn && permissionOk ? getString(R.string.settings_on) : getString(R.string.settings_off),
                appOn && permissionOk);

        int importance = Channels.importance(this);
        addRow(R.string.settings_row_channel, importanceLabel(importance),
                importance >= NotificationManagerCompat.IMPORTANCE_HIGH);

        NotificationManager manager = getSystemService(NotificationManager.class);
        int filter = manager == null
                ? NotificationManager.INTERRUPTION_FILTER_UNKNOWN
                : manager.getCurrentInterruptionFilter();
        boolean dndOff = filter == NotificationManager.INTERRUPTION_FILTER_ALL
                || filter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
        addRow(R.string.settings_row_dnd,
                dndOff ? getString(R.string.settings_dnd_off) : getString(R.string.settings_dnd_on),
                dndOff);

        addRow(R.string.settings_row_battery, batteryLabel(), !isBatteryRestricted());
    }

    private String importanceLabel(int importance) {
        switch (importance) {
            case NotificationManagerCompat.IMPORTANCE_HIGH:
            case NotificationManagerCompat.IMPORTANCE_MAX:
                return getString(R.string.settings_importance_high);
            case NotificationManagerCompat.IMPORTANCE_DEFAULT:
                return getString(R.string.settings_importance_default);
            case NotificationManagerCompat.IMPORTANCE_LOW:
            case NotificationManagerCompat.IMPORTANCE_MIN:
                return getString(R.string.settings_importance_low);
            case NotificationManagerCompat.IMPORTANCE_NONE:
                return getString(R.string.settings_importance_none);
            default:
                return getString(R.string.settings_importance_unknown);
        }
    }

    /**
     * BACKGROUND RESTRICTION (Android 9+, the "Restricted" battery setting) blocks delivery
     * outright; battery optimisation only delays it. "Unrestricted" on a Samsung is the app being
     * exempt from optimisation.
     */
    private boolean isBatteryRestricted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ActivityManager am = getSystemService(ActivityManager.class);
            if (am != null && am.isBackgroundRestricted()) return true;
        }
        return false;
    }

    private String batteryLabel() {
        if (isBatteryRestricted()) return getString(R.string.settings_battery_restricted);
        PowerManager pm = getSystemService(PowerManager.class);
        boolean unrestricted = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        return unrestricted
                ? getString(R.string.settings_battery_unrestricted)
                : getString(R.string.settings_battery_optimised);
    }

    // ---------------------------------------------------------------------------------------
    // Android settings
    // ---------------------------------------------------------------------------------------

    private void openAppNotificationSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            if (tryStart(intent)) return;
        }
        openAppDetails();
    }

    private void openChannelSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, Channels.ALERTS);
            if (tryStart(intent)) return;
        }
        openAppNotificationSettings();
    }

    /**
     * APP INFO, WHERE ONE UI KEEPS THE BATTERY SETTING. Falls back to Android's list of battery
     * optimisation exemptions. No REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: Play restricts it.
     */
    private void openBatterySettings() {
        if (openAppDetails()) return;
        tryStart(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    private boolean openAppDetails() {
        return tryStart(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getPackageName(), null)));
    }

    private boolean tryStart(Intent intent) {
        try {
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------

    private void addRow(int labelRes, String value, boolean good) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(14);
        row.setPadding(pad, dp(12), pad, dp(12));
        GradientDrawable card = new GradientDrawable();
        card.setColor(getColor(R.color.epinoia_panel_light));
        card.setCornerRadius(dp(12));
        card.setStroke(dp(1), getColor(good ? R.color.epinoia_good_light : R.color.epinoia_bad_light));
        row.setBackground(card);

        row.addView(text(getString(labelRes), 13, R.color.epinoia_ink2_light));
        TextView valueView = text(value, 17, good ? R.color.epinoia_ink_light : R.color.epinoia_bad_light);
        valueView.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(valueView, topMargin(2));

        mRows.addView(row, mRows.getChildCount() == 0 ? topMargin(0) : topMargin(10));
    }

    private TextView text(String value, int sp, int colorRes) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(getColor(colorRes));
        view.setLineSpacing(0f, 1.2f);
        return view;
    }

    private Button button(int labelRes, android.view.View.OnClickListener onClick) {
        Button button = new Button(this);
        button.setText(labelRes);
        button.setAllCaps(false);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        button.setTextColor(getColor(R.color.epinoia_on_accent_light));
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(getColor(R.color.epinoia_lume_light));
        pill.setCornerRadius(dp(24));
        button.setBackground(pill);
        button.setMinHeight(dp(48));
        button.setOnClickListener(onClick);
        return button;
    }

    private LinearLayout.LayoutParams topMargin(int dpValue) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(dpValue);
        return lp;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
