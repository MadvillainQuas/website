# Fans' pages and league Community pages

Migration **0197**. Two things:

- **A fan's page.** A profile a fan sets up from their social accounts, with their EPINOIΛ GO stamps on it.
- **A league's Community page.** Where the league's fans meet:
  - EPINOIA GO's Find a game, for the league's own games;
  - its **Forum**: the Discord servers the league attached. Any server can be attached: the league's own, a fans' community, a club's. Nothing creates a server;
  - its **Content creators**: the newest from the creators who cover it (0206, `docs/news-and-creators.md`);
  - the fans' stamps and photographs from its games;
  - who has travelled furthest to its arenas.

## Where things are

| Page | What it is |
| --- | --- |
| `fan/?u=<username>` | A fan's page, in the fan's own colour: their picture, name, line and accounts; their club; their GO passport (arenas, stamps, kilometres, their place on the board); their stamps and photographs; the leagues and clubs they follow. |
| `profile/` | **PROFILE**, from "your hub" on the rail (first row): the fan's **Username**, **Your public page** (whether `fan/?u=` shows, and the link to it) and **Your page**, where they edit theirs with a live preview (`me/fanprofile.js`). It was on `me/` (now PERSONALISATION) until 2026-09-30; `me/#fanprofile` and `me/#username` forward here. |
| `community/?l=<league>` | The league's Community page, in the league's colours. **Find a game**: GO's own module (`go/nearby/nearby.js`), for the league's games only. **Forum** (`#forum`): the Discord servers, one card each (see below). It was called Talk; an old link to `#talk`, or the console's old `#cmTalk`, still lands on it. **Content creators** (`#creators`): the newest from the creators the platform assigned to the league, its own creators and its creator outlets, on the feed's post card, nine at a time with **Show more** (`league_creator_feed`, 0206). **In the stands**: GO's feed of the league's games, stamps and photographs (`go_feed`). **Furthest travelled**: the league's GO board by distance (`go_leaderboard`), each fan to their page. A part with nothing to show (no servers, no creators' posts) stays away. |
| The rail | **community** on every league. Find a game is there whenever the league has games. |
| A league console, **Forum** | Attach, edit, reorder and take off servers. Pasting an invitation fills in the rest. |
| The GO leaderboard | Each name links to that fan's page. |

## A fan's page

- **Who has one.** Only a fan who is public on EPINOIΛ GO: they have a username, went public, and confirmed they are 18 or over. For anyone else, `fan_profile_public` answers nothing, just as it does for a name that does not exist. Going private takes the page down at once.
- **Starting from social accounts.** "From your accounts" fills the name and the picture from an account the fan signed in with (Google, Discord…). It uses what that provider handed over at sign-in, read from `auth.identities`. Nothing is copied until the fan presses it, and they can change everything after.
- **What they set** (`set_fan_profile`). Only the fields sent are changed. The database checks each one:
  - a name of up to 40 characters, and a line of up to 280;
  - both go through GO's word check;
  - an https picture;
  - a colour;
  - links to their accounts, cleaned like a creator's;
  - one club, from a league the fan can see;
  - whether to show what they follow;
  - whether to show their Discord.
- **What it shows of GO.** The same numbers as the leaderboard (`go_numbers`), their rank on it, and their stamps and photographs from GO's feed (`go_feed`) when the fan shows them.
- **Follows.** Shown only when the fan chooses. Even then, only public leagues and their clubs are listed.

## Discord

### Signing in and linking

- **The sign-in page** has a Discord button. It appears only once the provider is switched on (it reads `/auth/v1/settings`), and never in the iOS app.
- **The profile** has **Link Discord** for a fan who signed in another way. It uses Supabase's identity linking.
- **What is read.** `sync_fan_discord` reads the Discord id, name and picture from the linked identity. Nothing is typed in by hand, so a fan cannot claim someone else's Discord.
- **On the page.** It becomes a "Discord · name" link to their Discord profile, unless the fan turns it off.

### Switching it on (Supabase dashboard, once)

1. Create an application in the Discord developer portal (discord.com/developers/applications).
2. Under OAuth2, add this redirect:
   `https://hhvofgqqadtyvcjudhjx.supabase.co/auth/v1/callback`
3. Copy the application's client ID and client secret.
4. In Supabase, open Authentication → Sign In / Providers → Discord. Switch it on and paste the ID and secret.
5. On the same page, switch on **Allow manual linking**. Without it, Link Discord on the profile is refused.
6. Check that Authentication → URL Configuration → Redirect URLs covers `https://prophesyscouting.co.uk/epinoia/**`. It already should: the Google button needed it.

Until step 4, the Discord button stays hidden and the profile says Discord sign-in is not switched on yet.

### A league's Discord servers (Community page, Forum)

- **Any server, attached.** A league lists the servers where its fans talk: its own, a fans' community, a club's. It does not need to own them, and nothing here creates a server. Up to 12 a league, in the league's order (`league_discords`).
- **Attaching one** (the console's **Forum** panel):
  1. Paste the server's invitation (discord.gg/… or discord.com/invite/…).
  2. The console asks Discord for that invitation's public details (no sign-in). This fills in the server's id, name and picture, and shows its members and online counts.
  3. If the invitation expires, the console says so. Make one that never expires in Discord: Invite People, Edit invite link, Expire after: Never.
  4. Optionally add a line about the server, mark it as the league's official one, or as a club's.
  5. Save (`save_league_discord`, recorded in the audit log).

  A server can also be attached by its id alone (widget only), or by its invitation alone (no widget). The console can reorder servers and take them off (`move_league_discord`, `remove_league_discord`). Taking a server off never touches the server itself.
- **The widget.** Discord draws it, and the server's owner must switch it on in Discord: Server Settings → Widget → Enable Server Widget. The server id is shown on that same screen. A server the league does not run shows its card and Join button either way; its widget appears once its owner turns it on.
- **The page.**
  - It frames only `discord.com`, sandboxed.
  - It asks Discord for nothing except each invitation's public counts, sent with no cookies. An expired invitation is labelled as expired, and its Join button is hidden.
  - The talk itself stays on Discord.

## Tests

- `supabase/tests/fan-profiles.test.mjs`: 0197 on PGlite, and the pages' wiring.
- `supabase/tests/league-creators.test.mjs`: the Forum and Content creators sections, run on a stand-in page, and 0206 on PGlite.
- Both run in `guard.yml`.
