package uk.co.prophesyscouting.epinoia;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.app.NotificationManagerCompat;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.SessionStore;
import com.google.androidbrowserhelper.trusted.SharedPreferencesTokenStore;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

import java.util.ArrayList;
import java.util.List;

/**
 * THE APP'S ENTRY POINT: CHROME, NOTIFICATIONS, THEN THE WEBSITE.
 *
 * It extends androidbrowserhelper 2.7.3's LauncherActivity, which does the real work (splash
 * hand-over, Digital Asset Links session, fallback). This class adds four things:
 *
 * 1. CHROME IS FORCED as the Trusted Web Activity provider whenever it is installed and enabled.
 *    The library's picker takes the phone's default browser first, and on a Samsung that is
 *    Samsung Internet, which has no TWA splash and no notification delegation: the very bug the
 *    app exists to fix. If Chrome is missing or disabled, a one-time dialog says so, then the
 *    library's default launch runs.
 * 2. ON THE FIRST LAUNCH ON ANDROID 13+, the launch is held for a one-screen pre-prompt in HOME's
 *    colour explaining Game alerts, then the native POST_NOTIFICATIONS request, then the launch.
 *    Asking natively matters: on One UI 8 the JavaScript request can report "granted" while
 *    Android blocks the app (android-browser-helper #563).
 * 3. EVERY LAUNCH URL CARRIES shell=, notif= and chan=, the native truth about this phone, which
 *    the website's appmode.js stores and push.js trusts over Notification.permission.
 * 4. The Game alerts channel is created before anything can be delegated to it.
 */
public class EpinoiaLauncherActivity extends LauncherActivity {

    private static final String CHROME = "com.android.chrome";

    private static final String PREFS = "epinoia_shell";
    private static final String KEY_CHROME_DIALOG_SHOWN = "chrome_dialog_shown";
    private static final String KEY_NOTIFICATION_PROMPT_SHOWN = "notification_prompt_shown";

    private static final int REQUEST_POST_NOTIFICATIONS = 4101;

    /** Query keys this launcher owns. Any copy already in the URL is replaced, never doubled. */
    private static final String[] SHELL_KEYS = {"shell", "notif", "chan"};

    /** True when shouldLaunchImmediately() held the launch for the dialog or the pre-prompt. */
    private boolean mHeld;

    /** Guards against two taps (or a tap and a dismiss) launching twice. */
    private boolean mLaunchRequested;

    /** Set when the Chrome dialog sends the user to the Play Store instead of continuing. */
    private boolean mLeavingForStore;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // THE CHANNEL FIRST. super.onCreate may launch Chrome straight away, and Chrome may
        // delegate a waiting notification the moment the session connects.
        Channels.ensure(this);

        super.onCreate(savedInstanceState);

        // The base class finishes early when a TWA is already running or it restarts itself in a
        // new task; in those cases there is nothing to hold for.
        if (mHeld && !isFinishing()) {
            proceed();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Launch sequence
    // ---------------------------------------------------------------------------------------

    /**
     * CALLED BY THE BASE onCreate TO DECIDE WHETHER TO LAUNCH NOW. Returning false hands the
     * launch to this class, which then calls launchTwa() itself once the dialog or the pre-prompt
     * is done.
     */
    @Override
    protected boolean shouldLaunchImmediately() {
        mHeld = needsChromeDialog() || needsNotificationPrompt();
        return !mHeld;
    }

    /** THE NEXT STEP, whichever it is. Each step marks itself done before showing, so this terminates. */
    private void proceed() {
        if (isFinishing() || mLaunchRequested) return;

        if (needsChromeDialog()) {
            showChromeDialog();
            return;
        }
        if (needsNotificationPrompt()) {
            showNotificationPrompt();
            return;
        }
        mLaunchRequested = true;
        launchTwa();
    }

    /**
     * FORCES CHROME AS THE PROVIDER when it is usable. This mirrors the base implementation in
     * 2.7.3 (same session id and token store) with the provider package filled in; the token store
     * then records Chrome as the only browser allowed to delegate notifications.
     */
    @Override
    protected TwaLauncher createTwaLauncher() {
        if (isChromeUsable(this)) {
            return new TwaLauncher(this, CHROME, SessionStore.makeSessionId(getTaskId()),
                    new SharedPreferencesTokenStore(this));
        }
        return super.createTwaLauncher();
    }

    /**
     * THE MANIFEST'S URL (or the App Link that opened the app) PLUS THE SHELL REPORT.
     * shell = this build's versionCode, so the site can ask for an update below minShell.
     * notif = 1 when Android lets the app post notifications at all.
     * chan  = Game alerts' importance (4 is HIGH), -1 if the channel is somehow missing.
     * The query is edited in its encoded form so the page's own parameters survive byte for byte.
     */
    @Override
    protected Uri getLaunchingUrl() {
        Uri base = super.getLaunchingUrl();
        if (base == null || !base.isHierarchical()) return base;

        List<String> kept = new ArrayList<>();
        String encodedQuery = base.getEncodedQuery();
        if (encodedQuery != null && !encodedQuery.isEmpty()) {
            for (String pair : encodedQuery.split("&")) {
                if (pair.isEmpty() || isShellKey(pair)) continue;
                kept.add(pair);
            }
        }

        boolean notificationsOn = NotificationManagerCompat.from(this).areNotificationsEnabled();
        kept.add("shell=" + BuildConfig.VERSION_CODE);
        kept.add("notif=" + (notificationsOn ? "1" : "0"));
        kept.add("chan=" + Channels.importance(this));

        return base.buildUpon().encodedQuery(join(kept)).build();
    }

    private static boolean isShellKey(String encodedPair) {
        int eq = encodedPair.indexOf('=');
        String key = eq < 0 ? encodedPair : encodedPair.substring(0, eq);
        for (String shellKey : SHELL_KEYS) {
            if (shellKey.equals(key)) return true;
        }
        return false;
    }

    private static String join(List<String> parts) {
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            if (out.length() > 0) out.append('&');
            out.append(part);
        }
        return out.toString();
    }

    // ---------------------------------------------------------------------------------------
    // Chrome
    // ---------------------------------------------------------------------------------------

    /** Installed AND enabled. A disabled Chrome still resolves by name, so the flag is checked. */
    @SuppressWarnings("deprecation") // getApplicationInfo(String, int) is fine on every API level we run on.
    static boolean isChromeUsable(Context context) {
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(CHROME, 0);
            return info.enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private boolean needsChromeDialog() {
        return !isChromeUsable(this) && !prefs().getBoolean(KEY_CHROME_DIALOG_SHOWN, false);
    }

    /**
     * ONE DIALOG, ONCE EVER. "Get Chrome" opens Chrome's Play listing (where a disabled Chrome
     * shows Enable) and closes the app, so the next launch runs in Chrome. "Continue" and a
     * dismiss both go on to the default launch.
     */
    private void showChromeDialog() {
        prefs().edit().putBoolean(KEY_CHROME_DIALOG_SHOWN, true).apply();

        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
                .setTitle(R.string.chrome_dialog_title)
                .setMessage(R.string.chrome_dialog_message)
                .setPositiveButton(R.string.chrome_dialog_get, (dialog, which) -> {
                    mLeavingForStore = true;
                    openChromeListing();
                })
                .setNegativeButton(R.string.chrome_dialog_continue, null)
                .setOnDismissListener(dialog -> {
                    if (mLeavingForStore) {
                        finish();
                    } else {
                        proceed();
                    }
                })
                .show();
    }

    private void openChromeListing() {
        Intent market = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + CHROME));
        try {
            startActivity(market);
        } catch (ActivityNotFoundException noStore) {
            // No Play Store: the web listing still explains how to get Chrome.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=" + CHROME)));
            } catch (ActivityNotFoundException ignored) {
                mLeavingForStore = false; // Nowhere to go: carry on with the launch instead.
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Notification pre-prompt (Android 13+)
    // ---------------------------------------------------------------------------------------

    private boolean needsNotificationPrompt() {
        if (Build.VERSION.SDK_INT < 33) return false;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return !prefs().getBoolean(KEY_NOTIFICATION_PROMPT_SHOWN, false);
    }

    /**
     * ONE NATIVE SCREEN IN HOME'S COLOUR, then Android's own dialog. Built in code rather than a
     * layout file because it is the only view this activity ever shows before the TWA splash
     * replaces it with setContentView.
     */
    private void showNotificationPrompt() {
        prefs().edit().putBoolean(KEY_NOTIFICATION_PROMPT_SHOWN, true).apply();

        int ground = getColor(R.color.epinoia_ground_light);
        int ink = getColor(R.color.epinoia_ink_light);
        int ink2 = getColor(R.color.epinoia_ink2_light);
        int lume = getColor(R.color.epinoia_lume_light);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(ground);
        scroll.setFillViewport(true);
        // Edge-to-edge is on (the base class enables it): let the system bars pad the content.
        scroll.setFitsSystemWindows(true);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER);
        int pad = dp(28);
        column.setPadding(pad, pad, pad, pad);
        scroll.addView(column, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.splash);
        mark.setContentDescription(null);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        column.addView(mark, new LinearLayout.LayoutParams(dp(96), dp(96)));

        TextView title = new TextView(this);
        title.setText(R.string.prompt_title);
        title.setTextColor(ink);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleLp = wrap();
        titleLp.topMargin = dp(20);
        column.addView(title, titleLp);

        TextView body = new TextView(this);
        body.setText(R.string.prompt_body);
        body.setTextColor(ink2);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        body.setLineSpacing(0f, 1.25f);
        body.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams bodyLp = wrap();
        bodyLp.topMargin = dp(12);
        column.addView(body, bodyLp);

        Button allow = new Button(this);
        allow.setText(R.string.prompt_allow);
        allow.setAllCaps(false);
        allow.setTextColor(getColor(R.color.epinoia_on_accent_light));
        allow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        allow.setBackground(pill(lume));
        allow.setOnClickListener(v -> {
            v.setEnabled(false);
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS},
                    REQUEST_POST_NOTIFICATIONS);
        });
        LinearLayout.LayoutParams allowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        allowLp.topMargin = dp(28);
        column.addView(allow, allowLp);

        Button later = new Button(this);
        later.setText(R.string.prompt_later);
        later.setAllCaps(false);
        later.setTextColor(lume);
        later.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        later.setBackgroundColor(0x00000000);
        later.setOnClickListener(v -> proceed());
        LinearLayout.LayoutParams laterLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48));
        laterLp.topMargin = dp(8);
        column.addView(later, laterLp);

        setContentView(scroll);
    }

    /** Whatever the answer, the launch goes ahead: the settings screen and the site can fix it later. */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            proceed();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private static LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private GradientDrawable pill(int color) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(26));
        return shape;
    }
}
