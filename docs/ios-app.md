# EPINOIΛ for iPhone: from nothing to the App Store

The iPhone app is the Android app's twin. It opens the live site full screen, so a website change
never needs a new app. It adds what a website cannot do on an iPhone:

- its own icon and launch screen
- game alerts through Apple Push Notification service. Inside an app, a web page gets no Web
  Push at all, so the app registers with Apple itself.
- universal links, so an email's link, a shared game or a notification opens in the app
- native dialogs, downloads and the camera

**Everything is done from Windows.** Nobody needs a Mac: GitHub's Mac computers build, sign and
upload the app. You do the Apple account and a few one-off keys, all in a browser and Command
Prompt. The code is in `ios/` ([ios/README.md](../ios/README.md)). The server side is
`supabase/functions/_shared/apns.js` and migration `0130_push_apns.sql`.

**Contents**

- [What the app does differently from the website](#what-the-app-does-differently-from-the-website)
- [Before you start](#before-you-start)
- [Step 1: Join the Apple Developer Program](#step-1-join-the-apple-developer-program)
- [Step 2: Note your Team ID](#step-2-note-your-team-id)
- [Step 3: Register the app's identifier](#step-3-register-the-apps-identifier)
- [Step 4: The notification key (APNs)](#step-4-the-notification-key-apns)
- [Step 5: The upload key (App Store Connect API)](#step-5-the-upload-key-app-store-connect-api)
- [Step 6: The distribution certificate](#step-6-the-distribution-certificate)
- [Step 7: The provisioning profile](#step-7-the-provisioning-profile)
- [Step 8: Give GitHub the seven secrets](#step-8-give-github-the-seven-secrets)
- [Step 9: Create the app in App Store Connect](#step-9-create-the-app-in-app-store-connect)
- [Step 10: Universal links (the Team ID on the website)](#step-10-universal-links-the-team-id-on-the-website)
- [Step 11: The first build](#step-11-the-first-build)
- [Step 12: Test it on your iPhone with TestFlight](#step-12-test-it-on-your-iphone-with-testflight)
- [Step 13: The App Store listing and review](#step-13-the-app-store-listing-and-review)
- [Step 14: Once Apple approves it](#step-14-once-apple-approves-it)
- [Shipping a new version later](#shipping-a-new-version-later)
- [Why Apple might push back, and the answers](#why-apple-might-push-back-and-the-answers)
- [Where everything lives](#where-everything-lives)

---

## What the app does differently from the website

| | Website on an iPhone | EPINOIΛ for iPhone |
|---|---|---|
| Alerts | Only from the Home Screen copy, iOS 16.4+ | Native, through Apple, from any iPhone on iOS 16+ |
| Sign-in | Email link or Google | **Email code only.** Google blocks sign-in inside apps, and the App Store would also want Sign in with Apple beside it. |
| Memberships | Plans and checkout | **Not sold in the app.** Apple only allows in-app purchase for digital access. |
| Links | Stay in Safari | EPINOIΛ pages stay in the app; everything else opens in Safari |

On the website, an iPhone is now always pointed at the iPhone app, never the Android one:

- The banner, the menu row, the page strip, HOME's card and the notification sheets all point
  iPhones at `/epinoia/ios/`.
- `/epinoia/android/` opens `/epinoia/ios/` on an iPhone.

Until `epinoia/ios/version.json` says `"released": true`, those places keep the Home Screen steps,
so nothing points at an app that isn't out yet.

---

## Before you start

- **An iPhone** to test on with TestFlight. Not strictly required, but don't send an app to Apple
  that you haven't held.
- **An Apple ID with two-factor authentication**, which Apple requires for developer accounts.
- **£79 / US$99 a year** for the Apple Developer Program.
- **Email sign-in by code must be switched on first.** In the app, the email link would finish in
  Safari, not the app. The step is already written up in
  [epinoia-home-and-app-roadmap.md §6, "Before R3: the sign-in code"](epinoia-home-and-app-roadmap.md):
  - Put the code (`{{ .Token }}`) in the Magic Link email.
  - Then `emailOtp: true` goes in `epinoia/config.js`.

  Without it, nobody can sign in inside the iPhone app.
- Keep every key file in one folder **outside the repository**. The commands below use
  `C:\Users\Admin\Documents\epinoia-ios-keys`, next to the Android keystore's folder. Several of
  these files can only be downloaded once, so back the folder up.

Create the folder now:

```bat
mkdir C:\Users\Admin\Documents\epinoia-ios-keys
```

---

## Step 1: Join the Apple Developer Program

1. Go to **developer.apple.com/programs/enroll** and tap **Start your enrollment**. The Apple
   Developer app on an iPhone is quicker, because it can verify your ID with the phone's camera.
2. Sign in with your Apple ID and choose **Individual / Sole Proprietor**.
   - The App Store then shows your legal name as the seller.
   - To show a company name, enrol as an **Organization**. That needs a D-U-N-S number, which is
     free but takes a few days.
3. Pay. Approval usually arrives by email within 48 hours.

You can't do the rest until the approval email arrives.

## Step 2: Note your Team ID

1. Go to **developer.apple.com/account** and scroll to **Membership details**.
2. Copy the **Team ID**: 10 capital letters and digits, for example `ABCDE12345`.

It isn't a secret: every app's Team ID is published in its universal-links file. You'll need it
in steps 4, 8 and 10.

## Step 3: Register the app's identifier

1. Open **developer.apple.com/account/resources/identifiers**, then click **+**.
2. Choose **App IDs**, then **App**.
3. Fill in the details:
   - **Description:** `Epinoia` (letters only here).
   - **Bundle ID:** **Explicit**, `uk.co.prophesyscouting.epinoia`. This is the same as the
     Android package, and it must match exactly.
4. Under **Capabilities**, tick **Associated Domains** and **Push Notifications**.
5. Click **Continue**, then **Register**.

## Step 4: The notification key (APNs)

The server needs this key to send alerts to iPhones. One key serves every app on your account and
never expires.

1. Open **developer.apple.com/account/resources/authkeys/list** and click **+**.
2. Set **Key Name** to `Epinoia push` and tick **Apple Push Notifications service (APNs)**.
3. If there is a **Configure** button:
   - Choose **Sandbox & Production**.
   - If it asks for a key restriction, choose **Team Scoped (All Topics)**.
   - Click **Save**.
4. Click **Continue**, then **Register**.
5. Click **Download**. This is the **only** chance to download it. Move `AuthKey_XXXXXXXXXX.p8`
   into `C:\Users\Admin\Documents\epinoia-ios-keys`.
6. Note the **Key ID**: the 10 characters after `AuthKey_`.

Give the key to the `notify` function as Supabase secrets.
- Replace `XXXXXXXXXX` with the Key ID and `ABCDE12345` with your Team ID.
- The key file goes in base64, so it fits on one command line.
- The temporary `apns.b64` file stays in the keys folder and is deleted at the end.

```bat
cd /d C:\Users\Admin\Documents\epinoia-ios-keys
```

```bat
node -e "process.stdout.write(require('fs').readFileSync('AuthKey_XXXXXXXXXX.p8').toString('base64'))" > apns.b64
```

```bat
set /p APNSKEY=<apns.b64
```

```bat
cd /d C:\Users\Admin\Documents\website_deploy
```

```bat
npx supabase@latest secrets set APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=ABCDE12345 APNS_KEY_P8=%APNSKEY%
```

```bat
del C:\Users\Admin\Documents\epinoia-ios-keys\apns.b64
```

Check the server can use the key. Look for `"apns":"ok (Apple accepted the key...` in the answer:

```bat
curl -s -X POST https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/notify -H "Content-Type: application/json" -d "{\"diag\":true}"
```

If it says `not configured`, the three secrets aren't all set. If it says `BROKEN: Apple 403
InvalidProviderToken`, the Key ID, the Team ID or the file don't match each other.

## Step 5: The upload key (App Store Connect API)

GitHub uses this key to upload each build to App Store Connect.

1. Go to **appstoreconnect.apple.com**, then **Users and Access**, then **Integrations**, then
   **App Store Connect API**. The first time, click **Request Access** and accept.
2. Under **Team Keys**, click **+**.
3. Set **Name** to `GitHub upload` and **Access** to **App Manager**, then click **Generate**.
4. Click **Download API Key**. This is also the only chance. Move `AuthKey_YYYYYYYYYY.p8` into the
   keys folder.
5. Note the key's **Key ID**, and the **Issuer ID** shown above the table (a long id with dashes).

## Step 6: The distribution certificate

This certificate signs the app as yours. Its private key is made on your computer and never goes
to Apple. OpenSSL comes with Git for Windows. Replace `YOUR_APPLE_ID_EMAIL`, and choose a password
in place of `CHOOSE_A_PASSWORD` (you'll need it again in step 8).

```bat
cd /d C:\Users\Admin\Documents\epinoia-ios-keys
```

```bat
"C:\Program Files\Git\usr\bin\openssl.exe" req -new -newkey rsa:2048 -nodes -keyout epinoia-dist.key -out epinoia-dist.csr -subj "/emailAddress=YOUR_APPLE_ID_EMAIL/CN=EPINOIA Distribution/C=GB"
```

1. Open **developer.apple.com/account/resources/certificates/list** and click **+**.
2. Choose **Apple Distribution**, then **Continue**.
3. Choose the file `epinoia-dist.csr`, then click **Continue**.
4. Click **Download** and move `distribution.cer` into the keys folder.

Turn the certificate and its key into one `.p12` file. The `-keypbe`, `-certpbe` and `-macalg`
options matter. Without them, OpenSSL 3 writes a format that a Mac's keychain can't open. The CI
workflow tests exactly these options on every run.

```bat
"C:\Program Files\Git\usr\bin\openssl.exe" x509 -inform DER -in distribution.cer -out distribution.pem
```

```bat
"C:\Program Files\Git\usr\bin\openssl.exe" pkcs12 -export -inkey epinoia-dist.key -in distribution.pem -out epinoia-dist.p12 -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout pass:CHOOSE_A_PASSWORD
```

The certificate lasts a year. When it expires, repeat this step and step 7, then update the three
signing secrets in step 8. Apps already on the App Store aren't affected.

## Step 7: The provisioning profile

The profile ties the app, the certificate and the App Store together.

1. Open **developer.apple.com/account/resources/profiles/list** and click **+**.
2. Under **Distribution**, choose **App Store Connect**, then **Continue**.
3. Choose the App ID `uk.co.prophesyscouting.epinoia`, then **Continue**.
4. Choose the certificate from step 6, then **Continue**.
5. Set **Provisioning Profile Name** to `Epinoia App Store`, then click **Generate**.
6. Click **Download** and move `Epinoia_App_Store.mobileprovision` into the keys folder.

## Step 8: Give GitHub the seven secrets

Your Command Prompt has a `GITHUB_TOKEN` for the scrapers, which can't set secrets. The first
command clears it for this window only.

Replace the placeholders:

- `ABCDE12345`: your Team ID
- `CHOOSE_A_PASSWORD`: the `.p12` password from step 6
- `YYYYYYYYYY`: the upload Key ID from step 5
- `THE-ISSUER-ID`: the Issuer ID from step 5

If you have never signed the GitHub CLI in, run `gh auth login` first.

```bat
cd /d C:\Users\Admin\Documents\epinoia-ios-keys
```

```bat
set GITHUB_TOKEN=
```

```bat
gh secret set IOS_TEAM_ID --repo MadvillainQuas/website --body ABCDE12345
```

```bat
node -e "process.stdout.write(require('fs').readFileSync('epinoia-dist.p12').toString('base64'))" | gh secret set IOS_DIST_CERT_P12_BASE64 --repo MadvillainQuas/website
```

```bat
gh secret set IOS_DIST_CERT_PASSWORD --repo MadvillainQuas/website --body CHOOSE_A_PASSWORD
```

```bat
node -e "process.stdout.write(require('fs').readFileSync('Epinoia_App_Store.mobileprovision').toString('base64'))" | gh secret set IOS_PROFILE_BASE64 --repo MadvillainQuas/website
```

```bat
gh secret set ASC_KEY_ID --repo MadvillainQuas/website --body YYYYYYYYYY
```

```bat
gh secret set ASC_ISSUER_ID --repo MadvillainQuas/website --body THE-ISSUER-ID
```

```bat
node -e "process.stdout.write(require('fs').readFileSync('AuthKey_YYYYYYYYYY.p8').toString('base64'))" | gh secret set ASC_KEY_P8_BASE64 --repo MadvillainQuas/website
```

Check that all seven are there. Only the names are shown:

```bat
gh secret list --repo MadvillainQuas/website
```

## Step 9: Create the app in App Store Connect

1. Go to **appstoreconnect.apple.com**, then **Apps**, then **+**, then **New App**.
2. Fill in the form:
   - **Platforms:** iOS.
   - **Name:** `EPINOIΛ`. It must be unique on the App Store; if it's taken, use
     `EPINOIΛ Basketball`.
   - **Primary Language:** English (U.K.).
   - **Bundle ID:** `uk.co.prophesyscouting.epinoia`.
   - **SKU:** `epinoia-ios`.
   - **User Access:** Full Access.
3. Click **Create**.
4. Open **App Information** and note the **Apple ID**: a number like `6712345678`. It is the app's
   App Store id, and step 14 needs it.

## Step 10: Universal links (the Team ID on the website)

Apple reads which links open the app from
`https://prophesyscouting.co.uk/.well-known/apple-app-site-association`. The file names the app by
Team ID. The embeds, the broadcast overlays and the API docs stay in the browser; every other
`/epinoia/` page opens the app.

**Easiest:** send the Team ID to Claude, which adds the file and pushes it. Or do it yourself:

```bat
cd /d C:\Users\Admin\Documents\website_deploy
```

```bat
git fetch origin
```

```bat
git checkout --detach origin/main
```

```bat
node tools\ios-team.mjs ABCDE12345
```

```bat
git add .well-known\apple-app-site-association
```

```bat
git commit -m "iPhone app: universal links for team ABCDE12345"
```

```bat
git push origin HEAD:main
```

Pages publishes it within a couple of minutes. Apple's servers pick it up when the app is
installed, and can take a day to refresh.

## Step 11: The first build

`.github/workflows/ios.yml` runs on every push that touches `ios/` or `epinoia/ios/version.json`.

- **Every run** builds the app for the iPhone Simulator, opens it on a simulated iPhone Pro Max
  and saves screenshots. Those are the App Store screenshots for step 13.
- **On main, with all seven secrets,** it also:
  - signs the app
  - uploads the build to App Store Connect
  - tags the commit `ios-v<build>`

  A build number that already has its tag is skipped, so each build uploads once.

The secrets went in after the code did, so start the first signed build by hand:

```bat
set GITHUB_TOKEN=
```

```bat
gh workflow run ios.yml --repo MadvillainQuas/website --ref main
```

Watch it. The whole run takes about 15 minutes:

```bat
gh run watch --repo MadvillainQuas/website
```

When it's green, the build shows in **App Store Connect → EPINOIΛ → TestFlight** after Apple
processes it, which takes 5 to 30 minutes. The app already declares that it only uses standard
encryption, so there's no export-compliance question to answer.

If the upload step fails, the log names the problem:

- **A certificate or profile doesn't match:** redo steps 6 and 7, then the three signing secrets
  in step 8.
- **An authentication error:** the upload key's secrets from step 5 are wrong.

## Step 12: Test it on your iPhone with TestFlight

1. In App Store Connect, go to **TestFlight**, then **Internal Testing**, then **+**.
2. Name the group `EPINOIΛ team`, add yourself, and tick the build.
3. On the iPhone, install **TestFlight** from the App Store. Open the invitation email on the
   phone, then tap **Install**.

Check each of these on the phone:

1. It opens on HOME, in the light mint colour, with no water splash.
2. **Sign in** with your email and the **code** from the email.
3. Follow a club, tap **Turn on notifications**, then **Allow**.
4. On **Profile**, tap **Send a test**. A banner appears while the app is open.
5. On **Profile**, tap **Check this phone**. Every line is green.
6. Lock the phone and wait for a real alert (a 2-hour reminder or lineups), then tap it. It opens
   that game in the app.
7. In Notes, write `https://prophesyscouting.co.uk/epinoia/home/` and tap it. It opens the app.
   This needs step 10 done before the app was installed; if it doesn't work, delete the app and
   reinstall.
8. Pull down on a page to refresh it. Turn on Airplane Mode and open a page: the "You're offline"
   screen has **Try again**.
9. A link to another website, such as a club's own site, opens in Safari.

## Step 13: The App Store listing and review

In App Store Connect, open **EPINOIΛ**, then the **1.0 Prepare for Submission** version.

- **Screenshots (6.9" display):**
  1. On GitHub, open **Actions**, then the green **ios** run, then **Artifacts**, then
     **ios-screenshots**. Unzip it.
  2. Drag in the PNGs. Apple needs at least one, and the simulator's are already the right size.
- **Promotional Text, Description, Keywords.** For example:
  - Description: "Live scores, fixtures, statistics and news from every league on EPINOIΛ, with
    game alerts for the clubs and players you follow: tip-off reminders, starting lineups,
    half-time and full-time scores."
  - Keywords: `basketball,scores,fixtures,stats,SLB,league,live`.
- **Support URL:** `https://prophesyscouting.co.uk/epinoia/contact/`
- **Marketing URL:** `https://prophesyscouting.co.uk/epinoia/home/`
- **Build:** click **+** and choose the TestFlight build.
- **App Information:**
  - **Category:** Sports.
  - **Privacy Policy URL:** `https://prophesyscouting.co.uk/epinoia/privacy/#iosSec`.
  - **Age Rating:** answer **None** or **No** throughout, including **Unrestricted Web Access:
    No**. The app only shows EPINOIΛ; every other site opens in Safari.
- **App Privacy.** Answer **Yes, we collect data**, then declare:
  - **Contact Info → Email Address:** App Functionality; linked to the user; not used for
    tracking.
  - **Contact Info → Name:** the same (a name is optional in the profile).
  - **Identifiers → User ID:** the same.
  - Nothing else. There are no analytics, no ads and no tracking.
- **App Review Information.**
  - **Sign-in required:** No. Scores, fixtures and statistics need no account.
  - **Notes:** "EPINOIΛ shows basketball leagues' live scores, fixtures, statistics and news.
    An account is optional and only needed to follow clubs and receive game alerts; sign-in is
    passwordless by email code. Native features: push notifications through APNs, universal
    links, native share and downloads."
  - Add a phone number and an email that you check.
- **Version Release:** **Manually release this version**, so step 14 happens in order.

Click **Add for Review**, then **Submit to App Review**. Review usually takes one to two days.

## Step 14: Once Apple approves it

1. Click **Release this version**.
2. Give the website the App Store id from step 9 and flip it to released. Send Claude the id, or
   edit `epinoia/ios/version.json`:

   ```json
   { "build": 1, "version": "1.0.0", "minShell": 1, "appStoreId": "6712345678", "released": true }
   ```

   Then commit and push it, as in step 10. From then on, every iPhone visitor is offered the app
   in the banner, the menu, HOME's card, the page strips and the notification sheets, and
   `/epinoia/ios/` shows **Get it on the App Store**.

---

## Shipping a new version later

A website change never needs this. A new app is only needed when something in `ios/` changes.

1. In `epinoia/ios/version.json`, raise `build` by one. Raise `version` too (for example
   `1.0.1`) when the change is visible to people.
2. Push. CI uploads the build to TestFlight.
3. In App Store Connect, create the new version with **+ Version**, choose the build and submit.
4. To make everyone update because the site now depends on the new app, set `minShell` to the new
   build once it's live. The site then shows **Update the EPINOIΛ app** in older copies.

## Why Apple might push back, and the answers

- **4.2 Minimum functionality ("just a website").** This is the most common rejection for apps
  like this.
  - The app is more than a wrapper: native push through APNs with its own settings link, universal
    links, native dialogs and downloads, an offline screen and pull-to-refresh.
  - Say so in the review notes. If Apple still objects, the usual answer is one more native
    feature, such as a native tab bar or widgets.
- **5.1.1(v) Account deletion.** **Profile → Delete my account** opens the erasure request on the
  privacy page, inside the app. If Apple wants deletion to happen immediately, the fix is a
  self-service deletion function.
- **3.1.1 In-app purchase.** Memberships aren't sold in the app, and the join page says so. While
  memberships are off, nothing more is needed.
  - Before switching memberships on, decide the iPhone route: Apple's in-app purchase, or Apple's
    US-only external purchase link entitlement.
  - A membership bought on the website but usable in the app is only allowed if it's also offered
    as an in-app purchase (3.1.3(b)).
- **4.8 Login services.** The app offers no Google sign-in, only EPINOIΛ's own email code, so Sign
  in with Apple isn't required.

## Where everything lives

| What | Where |
|---|---|
| The app's code, how it builds | `ios/`, `ios/README.md`, `.github/workflows/ios.yml` |
| Its version and release switch | `epinoia/ios/version.json` |
| The iPhone page | `epinoia/ios/` |
| APNs sending | `supabase/functions/_shared/apns.js`, `notify`, migration `0130_push_apns.sql` |
| The page ↔ app bridge | `window.EpinoiaNative` ([ios/README.md](../ios/README.md)), `epinoia/push.js` ("the iPhone app") |
| Universal links | `.well-known/apple-app-site-association`, written by `tools/ios-team.mjs` |
| Keys (never in the repo) | `C:\Users\Admin\Documents\epinoia-ios-keys` |
| Tests | `supabase/tests/apns.test.mjs`, `ios-web.test.mjs`, `push.test.mjs`, `app-shell.test.mjs` |
