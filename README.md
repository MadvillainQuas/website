# Prophesy Scouting

Static recruitment-intelligence site hosted on GitHub Pages at
**[prophesyscouting.co.uk](https://prophesyscouting.co.uk)**.

The site has two roles:

- **Admin** — manages users, publishes data, and controls per-player
  visibility. Lands on the **Admin Console** after sign-in.
- **User** — sees the apps with whatever data + players the admin has
  chosen for them. Lands on the standard two-app menu.

Two web apps sit behind the sign-in screen:

- **🏀 Lineup Analyzer** (`index_9.html`) — dominance + advanced games view
- **⭐ Prophesy Shortlist** (`basketball-analyzer-profiles_9.html`) — recruitment shortlist & player profiles

Visitors don't have to upload any data themselves — the apps fetch CSVs
from the [`/data/`](./data) folder of this repo on load. Per-user
folders override the shared default.

---

## Repository layout

```
/
├── index.html                              # sign-in + role-aware menu
├── admin.html                              # admin dashboard (users, links)
├── index_9.html                            # Lineup Analyzer app
├── basketball-analyzer-profiles_9.html     # Prophesy Shortlist app (admin mode via ?admin=1)
├── player_stats_viewer_pro.html            # (optional, secondary tool)
├── logo.jpg
├── config/
│   ├── users.json                          # who can sign in + their role + data folder
│   └── visibility.json                     # which players each user can see
├── data/
│   ├── README.md                           # filenames each app expects
│   ├── offense.csv (etc.)                  # shared default — falls back here
│   └── <username>/                         # optional per-user folder
│       └── offense.csv (etc.)
├── CNAME                                   # custom domain — prophesyscouting.co.uk
├── .nojekyll                               # tell GitHub Pages: don't run Jekyll
└── README.md                               # this file
```

---

## How auth and roles work

The user list is in [`config/users.json`](./config/users.json). Each
record has:

- `username` — case-sensitive
- `password` — plain text (this is a static site; see security note)
- `role` — `"admin"` or `"user"`
- `dataFolder` — *(optional)* path inside `data/` whose CSVs that user
  should see (e.g. `"coach1"` → CSVs under `data/coach1/`). When the
  field is missing or empty the app falls back to the shared `data/`
  folder.

On sign-in, [`index.html`](./index.html) fetches `config/users.json`,
validates the credentials, stores the session in `sessionStorage`, then
routes:

- `role === 'admin'` → admin menu (with a link to the dashboard and
  the admin Shortlist view)
- everything else → standard two-app menu

The session sticks until the user signs out or closes the browser tab.

---

## Security model

The site ships with three real protective layers, plus an honest
explanation of where they end.

### Layer 1 — URL invite gate (`gate.js`)

Loaded synchronously in `<head>` on every page. Until the visitor
either supplies a valid `?invite=<code>` in the URL or has unlocked
previously (kept in `localStorage` for 60 days), `<html>` stays
hidden and a generic "Not available" placeholder is shown. The
valid code's **SHA-256 hash** is hardcoded in `gate.js`; the cleartext
code never appears in the source.

The seed invite code is:

```
PROPHESY-2026-MdVilCxl-9kpTs0Q3J
```

Use it in the URL the first time you visit:
`https://prophesyscouting.co.uk/?invite=PROPHESY-2026-MdVilCxl-9kpTs0Q3J`

After that the browser remembers the unlock for 60 days. To rotate
the code (e.g. someone you sent it to leaks it), generate a new
code, hash it, and replace `INVITE_HASH_HEX` near the top of
`gate.js`:

```bash
echo -n "MY-NEW-CODE-HERE" | openssl dgst -sha256
```

Commit the change. Everyone's stale unlocks still work for up to 60
days; tighten `INVITE_VALID_DAYS` in `gate.js` if you want to force
re-prompting sooner.

### Layer 2 — PBKDF2-hashed passwords

User records support `passwordHash` (PBKDF2-SHA256, hex), `salt`
(hex, 16 bytes) and `iterations` (default 200,000) instead of plain
`password`. The login flow uses the WebCrypto API to derive the same
hash from whatever the user types and compares constant-time against
`passwordHash`. A legacy `password` field is still accepted for
backwards compatibility — exists only to keep the site usable
between first sign-in and migration.

The Admin dashboard surfaces a red **SECURITY** banner when any
account still has plaintext, and a one-click **🔒 Hash all
plaintext** migrator. Once you've hashed everything and downloaded
the new `users.json`, the file in the repo no longer contains any
recoverable passwords — only hashes that take ~100 ms each to
verify (and ~50 years to brute-force a 10-char password offline).

### Layer 3 — Brute-force lockout

Each browser tracks failed sign-ins in `localStorage`. After 5
failures the form locks for 60 seconds; the lockout doubles for
each subsequent burst, capped at 30 minutes. The countdown is
shown live in the form. Sign-in submissions are constant-time vs.
unknown usernames so the response doesn't leak which usernames
exist.

### What this does NOT protect

GitHub Pages serves your static files **publicly**. There is no
server, no edge auth. So:

- **The raw CSV files at `/data/...csv` are still publicly fetchable**
  by anyone who knows or guesses the URL. The URL gate hides the UI;
  it does not gate file URLs.
- **The page source is public.** The hashed `users.json` is fine
  exposed (hashing is the whole point), but visibility maps,
  filenames, and the structure of the site are visible.
- **Determined attackers can offline-brute-force hashes.** Use
  passwords of 10+ characters with a mix of cases, digits, and
  punctuation to keep PBKDF2-200k offline cracking infeasible.

For real protection of the data files themselves, you have two
solid upgrade paths — see "Real authentication" below.

### Seed credentials (rotate immediately)

| Username | Password | Role  |
| -------- | -------- | ----- |
| `admin`  | `prophesy` (plaintext)  | admin |

On first sign-in:

1. Open the Admin Dashboard.
2. Click **🔒 Hash all plaintext** in the red SECURITY banner.
3. Click **⬇ Download users.json** in the orange UNSAVED banner.
4. Commit the downloaded file to `config/users.json` on GitHub.

The plaintext password is gone within minutes of you picking up
the keys.

### Real authentication (recommended next step)

For actual edge-level auth that fronts the GitHub Pages site, deploy
**Cloudflare Access** (free for up to 50 users):

1. Sign up at [cloudflare.com](https://cloudflare.com), add
   `prophesyscouting.co.uk`, and follow the prompts to point your
   nameservers at Cloudflare. You'll keep the same A records on
   GitHub Pages — the proxy is what we want.
2. In the Cloudflare dashboard, go to **Zero Trust → Access →
   Applications → Add an application → Self-hosted**. Set the
   domain to `prophesyscouting.co.uk` and the path to `*`.
3. Add a policy: **Allow → Emails** with the addresses of every
   user who's allowed in. (Or "Email domain", or "Google login", or
   "One-time PIN sent to email" — whatever fits.)
4. Save. Cloudflare now intercepts every request and prompts users
   to authenticate via the chosen method **before** it forwards the
   request to GitHub Pages. Unauthorized requests never reach the
   site files.

With Access in front, the in-page sign-in becomes redundant; you
can simplify `index.html` to skip straight to the menu. The data
files become genuinely private. This is the closest thing to "real
auth" while staying on GitHub Pages, and it's free.

---

## First-time setup (one-off)

### 1. Push the folder to GitHub

The repo is wired up to push to
[github.com/MadvillainQuas/website](https://github.com/MadvillainQuas/website):

```bash
cd "drive-download-20260507T073810Z-3-001"
# (already initialised — local commit is in place)
git push -u origin main
```

The first push will prompt for credentials. Use a **Personal Access
Token** rather than your GitHub password:

1. github.com → click your avatar → **Settings → Developer settings**
2. **Personal access tokens → Tokens (classic) → Generate new token**.
3. Tick the **`repo`** scope, set a sensible expiration, **Generate**.
4. When the push prompts for username, enter your GitHub username; for
   password, paste the token. Git will cache it via Windows Credential
   Manager.

If you don't want to use git locally, you can instead create the repo
on github.com, then drag-and-drop every file in this folder onto the
"upload files" page.

### 2. Turn on GitHub Pages

On the repo: **Settings → Pages**.

- **Source**: Deploy from a branch
- **Branch**: `main`, folder `/ (root)`
- Click **Save**

GitHub will publish a build in about a minute. The first URL it gives
you will look like `https://<your-username>.github.io/<repo-name>/`.

### 3. Point the domain at GitHub Pages

You bought `prophesyscouting.co.uk` through names.co.uk. Log into the
domain control panel and add these DNS records on the apex domain:

| Type  | Host | Value                            |
| ----- | ---- | -------------------------------- |
| A     | @    | 185.199.108.153                  |
| A     | @    | 185.199.109.153                  |
| A     | @    | 185.199.110.153                  |
| A     | @    | 185.199.111.153                  |
| CNAME | www  | `<your-username>.github.io.`     |

(The trailing dot on the CNAME value is correct.)

DNS usually propagates within an hour but can take up to 24 hours.

Back on GitHub: **Settings → Pages → Custom domain** → paste
`prophesyscouting.co.uk` and click **Save**. Tick **Enforce HTTPS**
once GitHub has issued the certificate (usually within 10 minutes).

The repo includes a `CNAME` file with the domain, so this is mostly
already wired up — GitHub will accept it the moment DNS resolves.

### 4. Sign in for the first time

Open `prophesyscouting.co.uk` in a browser. The starter admin
credentials are in [`config/users.json`](./config/users.json):

- Username: `admin`
- Password: `prophesy`

**Change them immediately** via the admin dashboard (see below) or
by editing `config/users.json` directly.

---

## Day-to-day admin: managing users

Sign in as an admin → **Admin Dashboard** (or open `/admin.html`
directly).

The **Users** card has:

- A table of every user with **Edit** and **Remove** controls.
- An **Add a user** form at the bottom (username, password, role,
  optional data folder).

All edits live in your browser's `localStorage` — you'll see an orange
**UNSAVED** banner when there are pending changes. To publish:

1. Click **⬇ Download users.json**.
2. Go to your repo on github.com → `config/` folder.
3. Click `users.json` → pencil icon (edit) → paste in the new
   contents, OR delete the file and upload the downloaded one.
4. Commit. New sign-in list is live in ~30–90 seconds.

That's the loop: edit in browser → download → commit. There's no live
backend so there's no "save" button that pushes directly to GitHub —
this is the price of a fully static site, but the manual step is just
two clicks.

---

## Day-to-day admin: managing data

CSV data lives in `/data/`:

- **Shared default** — files at `data/<filename>.csv` are loaded for
  every user who doesn't have a more specific folder.
- **Per-user override** — files at `data/<dataFolder>/<filename>.csv`
  are loaded for the user whose `dataFolder` field matches. The shared
  default is fallback when a per-user file is missing.

To publish data for everyone: drop the CSVs in `data/` on the repo.

To publish data for a specific user: create `data/<that-user-folder>/`
and put their CSVs there. Set the user's `dataFolder` field in the
admin Users panel to that folder name.

The exact filenames each app expects are in
[`data/README.md`](./data/README.md).

---

## Day-to-day admin: per-player visibility

Open the admin Prophesy Shortlist:

- From the admin dashboard, click **⭐ Open Shortlist (Admin)** in the
  top bar
- Or navigate to `basketball-analyzer-profiles_9.html?admin=1`
- Or use the entry in the post-sign-in admin menu

In admin mode the page:

- Hides **Coach's Shortlist** and **Settings** tabs (only Prophesy
  Shortlist + Player Profile remain).
- Shows a **👁 All users ▾** pill on every player row. Click it to
  open a popover with one checkbox per regular user. Tick the users
  who should see this player. "All users" means no restriction.
- Shows an orange **unsaved** badge above the search bar whenever the
  visibility map differs from the published `config/visibility.json`.

To publish visibility changes:

1. Click **⬇ Export visibility.json** in the admin banner.
2. Commit the downloaded file to `config/visibility.json` on GitHub.
3. ~30–90 seconds later all users see the new restrictions.

A player with no visibility entry — or with an empty list — is
visible to **all users**. Admins always see everyone regardless of
the map.

---

## Local testing

Open `index.html` directly via `file://` to test sign-in, the menu, and
admin dashboard. The apps work, but YouTube embeds will show a
thumbnail fallback (clickable) because YouTube refuses null origins.

For a proper local preview that matches production, run a tiny static
server from this folder:

```bash
# Python (any version)
python -m http.server 8000

# or, if you have Node
npx serve .
```

Then open `http://localhost:8000/`. CSV auto-load from `/data/`,
YouTube embeds, and everything else will behave exactly as on the
live site.

---

## What lives where

- **Per-user state** (their shortlists, ratings, scout reports, depth
  chart, video uploads, etc.) is kept in each visitor's browser — in
  `localStorage` for small things and `IndexedDB` for uploaded video
  files. None of it leaves their machine.
- **Shared / authoritative data** (the season CSVs) lives in this
  repo's `/data/` folder. That's what the admin controls.
- **Sign-in & visibility configs** live in `/config/` (committed JSON
  files, edited via the admin UI).

So when you publish a new dataset or visibility map, every visitor
sees the change the next time they load the app — but their own scout
notes, shortlists, and ratings stay intact.

---

## Files you can ignore

- `landing.html` — older copy of the landing page; kept as a
  fallback. `index.html` is what GitHub Pages serves now.
- `player_stats_viewer_pro.html` — secondary stats viewer, not linked
  from the menu by default.
