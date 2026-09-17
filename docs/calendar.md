# Fixtures in a calendar

A club's fixtures as a calendar feed: one URL that never changes, which a calendar app
re-reads by itself, so a moved tip-off, a new round or a final score arrives without anybody
doing anything.

| | |
|---|---|
| The feed | `GET {supabase}/functions/v1/ics/team/<slug or id>.ics` |
| A whole league | `GET {supabase}/functions/v1/ics/league/<slug>.ics` |
| The same as a file to save | add `?download=1` |
| The code | `supabase/functions/ics/index.ts` (routing, rows), `supabase/functions/_shared/icsfeed.js` (the calendar itself) |
| The button | `epinoia/calendar.js`, mounted by the club page (`epinoia/t/team.js`) |
| Tests | `supabase/tests/ics.test.mjs` |

## The one thing that goes wrong

**A calendar added to Google by URL never reaches Samsung Calendar.** Google fetches the feed
on its own servers, so it shows in Google Calendar on the web and in the Google Calendar app,
and that is all: Android's own calendar store never hears about it, and every other calendar
app on the phone — Samsung Calendar, the stock one, any widget — reads that store. Nothing
about the feed can change this; it is where Google puts the subscription.

So the panel puts the route that *does* work on an Android phone first:

- **ICSx⁵** (free, open source) subscribes on the phone itself and writes the fixtures into
  Android's calendar store, which is exactly what Samsung Calendar reads. It keeps updating.
- **The file** (`?download=1`) imports into any calendar app, including Samsung Calendar on
  its own. It is a snapshot and does not update, and the panel says so.

The other routes are unchanged: **Apple Calendar** takes the `webcal:` link, **Google** takes
the address in "From URL", **Outlook** in "Subscribe from web".

## What the panel does

`EpinoiaCalendar.mount(host, { url, name })` draws an "add to calendar" chip and a panel with
every route, ordered for the device in hand (iPhone → Apple first; Android → ICSx⁵ first;
desktop → Google first), each with what it does and what to expect. Under them: the address in
a field, a copy button, and a line about refresh times. It brings its own styles and has no
dependencies, so any page can mount it.

## What the feed promises

Built in `_shared/icsfeed.js`, held to this by `supabase/tests/ics.test.mjs`:

- **RFC 5545 to the letter:** CRLF lines, folded at 75 *octets* (never inside a character),
  with `\`, `;`, `,` and newlines escaped in text.
- **UTC only.** Every `DTSTART`/`DTEND` ends in `Z`, so there is no time zone for a client to
  get wrong, British Summer Time included.
- **A stable `UID`** (the game's id), so a refetch updates the event rather than adding a
  second one.
- **A stable `DTSTAMP`** — the row's own last change, never "now" — so the bytes only move when
  the fixtures do. That makes the `ETag` worth something: a client that asks again with
  `If-None-Match` gets `304` and spends nothing.
- **A voided game stays**, as `STATUS:CANCELLED`, instead of quietly vanishing.
- **`TRANSP:TRANSPARENT`:** a fixture should not make a fan look busy to their colleagues.
- **No empty properties.** A game with no venue has no `LOCATION` line at all.
- **Two hours** per game, from tip-off. A finished game carries the score in its title, so a
  subscription becomes a results archive.
- `HEAD`, `OPTIONS` and CORS are answered, because some clients check before they subscribe.

## How often each app looks

| | |
|---|---|
| Apple Calendar | its own setting, hourly by default; the feed asks for every 6 hours (`REFRESH-INTERVAL`) |
| ICSx⁵ | its own schedule, every few hours by default |
| Outlook | a few hours |
| Google | **up to a day**, whatever the feed asks for |

Nothing on Epinoia's side changes this, so the panel says it rather than leaving somebody
waiting for a fixture that "should" be there.

## Checking it

```bash
curl -sD- -o feed.ics "https://<ref>.supabase.co/functions/v1/ics/team/<slug>.ics"
```

- `Content-Type: text/calendar; charset=utf-8` and an `ETag`.
- Asking again with `-H 'If-None-Match: <that etag>'` answers `304` with no body.
- `?download=1` answers `Content-Disposition: attachment`.
- `node supabase/tests/ics.test.mjs` holds the calendar to everything above without a network.
