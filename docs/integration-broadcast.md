# Feeding broadcast graphics

Written 2026-08-22. Code: [`epinoia/broadcast/`](../epinoia/broadcast/),
[`supabase/functions/broadcast`](../supabase/functions/broadcast/index.ts).

A production truck does not want a website. It wants either a transparent layer
it can composite, or a JSON document it can bind into a template. Both are
served here, from **one state document** — because a scorebug that disagrees
with the box score on air is worse than no scorebug.

Everything comes from the same event log, through the same engine, over the same
live transport as every other surface. What this adds is a stable, versioned
**shape**: a graphics template is authored once against field names and then not
touched for a season, and a renamed field is a black rectangle during a game.

---

## 1. Browser source — OBS, vMix, CasparCG, Singular, Vizrt's HTML engine

Point the source at the page. Transparent background, no chrome, scales with the
render size.

```
https://prophesyscouting.co.uk/epinoia/broadcast/?g=<game-id>&scene=scorebug&pos=bl
```

Set the source to **1920×1080** and let the mixer scale it; every dimension is in
`vmin`, so the graphic keeps its proportions at 720p.

| parameter | | |
|---|---|---|
| `g` | the game id | **required** |
| `scene` | `scorebug` · `lower` · `compare` · `final` | `scorebug` |
| `pos` | `bl br tl tr bc tc c` | `bl` |
| `side` | `0` home, `1` away — for `lower` | `0` |
| `pid` | player id for `lower`; omit for the leading scorer on court | — |
| `home` / `away` | `#rrggbb`, override a club colour for contrast against the pitch | club colour |
| `chroma` | `#00b140` — paint a key colour instead of transparency | off |
| `safe` | `0` turns off title-safe padding when the mixer positions the source | on |
| `scale` | `0.5`–`2` | `1` |
| `debug` | `1` shows a transport readout. **Off air only.** | off |

Notes that matter in a gallery:

- **Transparency is the default; keying is opt-in.** Every modern mixer takes an
  alpha channel, and defaulting to a key colour would make everyone key for no
  reason. `?chroma=` exists for the ones that cannot.
- **Nothing renders until there is something true to show.** A scorebug that
  appears at 0–0 and then corrects itself has already been on air wrong.
- **The clock ticks locally**, from the last known state and the server's clock
  offset. A graphic redrawing on network frames would stutter at exactly the
  moment anyone is watching it.
- **The DOM is only touched when the state actually changes.** A mixer
  composites every frame; rewriting identical HTML sixty times a second is
  dropped frames on a laptop running OBS.

## 2. Polled JSON or XML — Vizrt, Chyron, Ross XPression, vMix data sources

```
GET /functions/v1/broadcast?game=<game-id>
GET /functions/v1/broadcast?game=<game-id>&format=xml
```

Same shape, produced server-side. Poll as fast as you like; caching is off, since
a graphics engine polling twice a second through a CDN that decided to cache for
sixty is a fault that is invisible in rehearsal and obvious on air.

The XML rendering uses elements only, never attributes: it is the shape a
data-binding template expects, and it cannot be broken by a club name with a
quote in it.

## 3. In-page — a mixer running its own HTML

```js
const state = window.EpinoiaBroadcast.state();
window.addEventListener('epinoia:state', e => draw(e.detail));
```

---

## The state document (`v: 1`)

```jsonc
{
  "v": 1,
  "generatedAt": "2026-08-22T19:41:07.221Z",
  "game": { "id": "…", "status": "live",
            "competition": "Epinoia Demo League · Division One",
            "venue": "Copper Box Arena", "attendance": 6120, "capacity": 7500,
            "officials": { "referee": "A. Shaw", "umpire1": "K. Brand" } },
  "clock": { "period": 4, "periodLabel": "Q4",
             "ms": 143400, "display": "2:23", "running": true },
  "possessionArrow": 0,
  "home": {
    "name": "neon city", "short": "NC", "colour": "#93f2bf",
    "score": 79, "periodFouls": 5, "bonus": true, "timeoutsLeft": 2,
    "onCourt": [ { "id": "…", "number": "7", "name": "isaac nwosu",
                   "pts": 21, "reb": 6, "ast": 1, "stl": 0, "blk": 1, "pf": 2,
                   "fg": "8-14", "tp": "3-4", "ft": "2-2", "min": 28 } ]
  },
  "away": { "…": "same shape" },
  "lastPlay": { "text": "nwosu — 3pt made", "period": 4, "clock": "2:23" }
}
```

**Fields are added, never renamed or removed.** Somewhere there is a template
authored against `v: 1` that nobody will revisit until it breaks during a game.
If the shape ever has to change incompatibly, `v` becomes `2` and both are served.

Two conventions worth knowing:

- **`clock.display` follows broadcast convention, not the app's.** Under a
  minute it shows tenths, because the last thirty seconds is the only time
  anybody reads the clock precisely; above a minute, `m:ss`. `clock.ms` is there
  for a template that would rather count down itself — and sending only the
  number would mean every integrator writing this formatter, and not all of them
  agreeing about tenths.
- **`bonus` is derived, not stored.** It is `periodFouls >= 5`, computed from the
  same replay as everything else, so it cannot drift from the foul count beside it.

## Row-level security still applies

The feed reads with the anonymous key. A graphics layer is not a reason to see
more than the public sees — a player withheld from a box score must not appear in
a lower third.

---

## A worked setup for a single-camera stream

1. OBS → **Sources → Browser**, 1920×1080, URL
   `…/epinoia/broadcast/?g=<id>&scene=scorebug&pos=bl`
2. A second browser source for the lower third, `&scene=lower&pos=bl`, hidden
   until you want it — it picks the leading scorer on court by itself, so it is
   correct whenever you cut to it without anybody driving it.
3. A third, `&scene=final&pos=c`, for the whistle.
4. Tick **"Shutdown source when not visible"** on the last two so a hidden layer
   is not holding a socket open for two hours.

Nothing else has to be running: the graphics read the same live feed as the
public box score, so if the statistician is scoring, the bug is live.
