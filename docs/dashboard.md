# The Profile dashboard and the reports in it

PROFILE (`epinoia/profile/`) is a fan's dashboard: one screen of everything that is theirs. Built to the page standard
(`docs/page-standard.md`).

## What it shows

| Part | What | From |
|---|---|---|
| The head | Their title over the page (or "Your dashboard"), their picture or initial in their colour, a banner, at a glance: new reports and how many leagues, clubs and players they follow | `fan_prefs` (`dash_title`, `dash_banner`, 0224; `colour`, `theme`), `my_fan_profile()` (0197) |
| Your reports | Every report made for them, newest first: its kind, title and line, the day, **NEW** until opened, Open and Download | `my_reports()` (0225) and the private `reports` bucket |
| Coming up | The next eight games of the leagues and clubs they follow, as HOME's fixture cards | `games` (globalgames.js) |
| Your leagues | A tile a league: its logo, its next game | `fan_prefs.fav_league_ids` |
| Your clubs | A tile a club: the last result (won or lost, from its side) and the next game | `fan_prefs.fav_team_ids` |
| Your players | A tile a player: their club, their latest line (points, rebounds, assists, minutes) and when | `fan_prefs.fav_player_ids`, `player_game_stats` |
| Your public page, Username, Your page | As before: whether `fan/?u=<username>` shows, the username, the page editor | 0163, 0197 |

**Customise** (in the head) opens the form: the title (40 characters, one line; blank puts the page's back), the colour
(/me/'s swatches or any), the banner (glow, plain, stripes, grid, or the colours of the first club they follow) and light
or dark. Every change shows at once; **save** writes `set_dashboard(title, banner)` and `set_fan_prefs({colour, theme})`.
Cancel or Esc puts it back.

A section with nothing to show says how it fills (the follows) or stays away (Coming up with no games; Your reports for
an account with no reports address). Signed out, the page asks them to sign in and comes back.

## The reports (0225)

The report mailer (`scripts/report_mailer.mjs`, `.github/workflows/report-mail.yml`, every half hour) emails an address
the game analysis after each of its club's games, and on Sunday mornings the scouting reports on the week's opponents
(with the club's own report every other Sunday). Every PDF it makes is also **kept**, before the email goes:

- the file in the private storage bucket `reports`, at `<address id>/<day>/<file>.pdf`;
- a row of `report_files`: the address, the kind (`game`, `opp`, `team`), a title and a line, the size, when it was made,
  when it was first opened.

**Whose they are.** An address in `report_mail_subs` belongs to the Epinoia account that signs in with it (a confirmed
email, any case) — so hooking an account up to the report system is giving the platform console's **Reports by email**
the address that account signs in with. `report_mail_subs.user_id`, when set, hooks one account up whatever its address,
and then that account alone.

**Opening one.** The dashboard asks storage for a five-minute signed link (storage gives one only for a file whose row is
the caller's: `report_path_mine`) and opens it in a new tab, or downloads it under its own name; either marks it opened
(`report_seen`). **Mark all as opened** does them all.

Every report email says the reports are kept in the dashboard, with a link (`PUBLIC_SITE`, default
`https://prophesyscouting.co.uk`).

## Sending next week's reports now (0226)

The Sunday email comes on Sunday morning. To send it sooner, the platform console's **Reports by email** (Accounts tab, at
the bottom) has **send next week's reports now** on each address, and **send everyone next week's reports now** above the list when
there is more than one. Pressing it says what will go and asks first.

- **What goes:** exactly the Sunday email, for the Monday-to-Sunday week that begins next Monday at the address's own time
  (pressed on a Sunday, the week that begins tomorrow): a scouting report on each club the address's club plays that week,
  and the club's own report when it is that fortnight's. The confirmation names the dates.
- **It counts as that Sunday's email.** It is logged as the Sunday before the week, which Sunday morning's own run finds, so
  that Sunday does not send it again. A week with no games and no team report due sends nothing, says so, and is *not*
  logged: the fixtures may still be announced, and Sunday morning looks again.
- **When it goes:** a press queues a request (`report_mail_requests`, `request_report_send`, platform administrators only) and
  starts the mailer through the `console-kick` function, so the reports are on their way within a few minutes. Where
  `console-kick` is not set up (see `docs/backfills.md`, "Setting up the instant start"), the request waits for the mailer's next
  half-hourly run: within 30 minutes. No setup is needed for that.
- **Where it stands:** each address shows *queued*, *sending now*, then what went (*Sent Sat 3 Oct, 14:02 · Sent the week of Mon
  12 Oct: scouting reports on …*), *not sent* (nothing to send, or the address was paused meanwhile) or *failed* with the reason.
  The list refreshes by itself while a request is open. Pressing twice sends once; an address already on its way is left alone.
  A request nobody has taken in three hours is given up (*failed: not done within three hours*) and can be asked for again.
- The reports are kept for the dashboard as for any Sunday, and the mailer takes requests *before* its usual rounds, so a
  request made on a Sunday morning is already in the log when the Sunday round reads it.

## Switching it on

1. Migrations: `npx supabase@latest db push` lists whatever is not applied yet, including `0220`–`0226`. 0224 adds the
   head's two columns; 0225 the bucket, the table and the functions; 0226 the "send next week's reports now" requests.
2. The mailer (already built; nothing is sent until these exist), GitHub → Settings → Secrets → Actions:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `REPORTS_FROM` (for example
   `Epinoia Reports <reports@your-domain>`, a domain verified in Resend).
3. Platform console → **Reports by email**: an address (the one the account signs in with) and a club.
4. Actions → **report-mail** → Run workflow with `dry_run` on and `only` set to that address: it prints what it would
   build, keep and send, and sends nothing. Then run it with `dry_run` off, or wait for the half hour.

Tests: `node supabase/tests/dashboard.test.mjs` (0224 and 0225 on PGlite), `node supabase/tests/dashboard-ui.test.mjs`,
`node supabase/tests/report-mailer.test.mjs`, `node supabase/tests/report-send-now.test.mjs` (0226 on PGlite, the week, the
mailer taking a request against PostgREST's own answers, console-kick, the console's buttons).
