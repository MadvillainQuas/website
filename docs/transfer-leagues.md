# League adjustment: the transfer matrix's leagues on EPINOIA

Maintainers' note (2026-10-15). Louie asked for:

* "in comparisons across covered leagues, can there be an option to adjust stats to each players' leagues?"
* "on player profiles, there be an option to adjust stats to a covered league?"
* "smart matching of league names/countries of leagues and assumed league tier in transfermatrix to the leagues on the site"
* for leagues with no matrix data, "an estimate based on the Spanish league tiering barometer but it has to be
  specifically stated as estimated"
* members only.

## The files

| file | what it is |
|---|---|
| `epinoia/transfer-scale.json` | the transfer matrix's numbers, written by the matrix's build (the transfer matrix page's agent owns it). **Until that build lands, a FIXTURE with made-up numbers is in its place (`"fixture": true`); replace it.** |
| `epinoia/transferleagues.js` | `EpinoiaTransferLeagues`: matrix league names read into countries / division / kind, and every site league matched to one (pure, no fetch) |
| `epinoia/transferadjust.js` | `EpinoiaTransferAdjust`: reads the file once a page, moves a line's nine rates from one league to another, and the members-only lock |
| `epinoia/compare.js`, `kit/compare.css` | the compare chart's "adjust for league" (global scouting, the profile's compare player) |
| `epinoia/p/player.js`, `p/index.html` | the profile's "adjust to league" (tiles and career table) |
| `epinoia/fulltable.js`, `kit/table.css` | a table cell marked as moved (`r.__adj`) |
| `supabase/tests/transfer-leagues.test.mjs`, `transfer-adjust.test.mjs` | the matching on the real names, the arithmetic; `compare.test.mjs` §13, `profile-compare.test.mjs`, `scouting-page.test.mjs` |

The matrix's league names are the scraped source's own ("Spanish ACB", "French Jeep Elite", "Kosovo FBK"). The
source is never named: not here, and nothing under `epinoia/`, comments included.

## The file's shape (the contract)

```
{ "version":1, "built":"YYYY-MM-DD", "seasons":[first,last],
  "settings":{"mode":"blend","robust":true,"talent":false,"kBlend":30,"anchor":"Spanish ACB"},
  "stats":["BPM","TS_pct","USG_pct","ORB_pct","DRB_pct","AST_pct","TOV_pct","STL_pct","BLK_pct"],
  "meta":[{k,lab,dec,lo,hi,signed?,inverse?} x9],
  "leagues": { "<matrix league name>": { "net":[9 or null], "mean":[9 or null], "strength":[bpmOffset, grade], "stints":n, "seasons":[first,last] } },
  "pairs": { "<F>><T>": [ [meanDiff,n] or null x9 ] } }
```

Read by name, not position (`stats`, `meta.k`), so a reordered file still works. A league whose `net` is all null is
treated as missing.

## The arithmetic (the matrix's BLEND route)

For stat k, F the player's league, T the target:

```
emp  = pairs[F>T][k]                       (only between two measured leagues)
w    = emp ? emp.n / (emp.n + kBlend) : 0   (kBlend from settings, default 30)
diff = w * emp.mean + (1 - w) * (net[F][k] - net[T][k])
new  = clamp(value + diff, meta.lo, meta.hi)
```

Same league: no change. A league with a null `net` for a stat: that stat stays as played and is reported in
`unavailable`. Site keys: `bpm`↔BPM, `ts`↔TS_pct, `usg`↔USG_pct, `oreb_pct`↔ORB_pct, `dreb_pct`↔DRB_pct,
`ast_pct`↔AST_pct, `tov_pct`↔TOV_pct, `stl_pct`↔STL_pct, `blk_pct`↔BLK_pct (all 0-100). Nothing else is moved.

## Matching, in order

1. **direct**: the explicit table `ALIASES` in `transferleagues.js`; else a name or abbreviation match inside the
   same country set and the same division (sponsors and nationality words ignored: "easyCredit BBL" = "German BBL",
   "CEBL" = the initials of "Canadian Elite Basketball League"). Without the table, 25 of the 37 measured leagues are
   still found by name, none differently (tested).
2. **country-tier**: the one matrix league with the same countries and the same division (a future "NB I/A" site
   league would get "Hungarian NBIA"). Two candidates: no guess.
3. **estimate**: a men's league with a rung in `SPANISH_RUNG`.
4. **none**: every women's league (the matrix holds men's leagues only), and any league with no match and no rung.

Women's or men's: the league's `gender` (0131), else its tier's side (`EPINOIA_LEAGUE_TIERS`), else its name.

## The Spanish ladder (estimates)

Rung 1 = Liga Endesa (Spanish ACB), 2 = Primera FEB, 3 = Segunda FEB, halves halfway between. Nothing below Segunda
FEB is in the data, so a rung past 3 continues the measured Primera FEB → Segunda FEB step, stat by stat
(`net(r) = net(Segunda) + (r - 3) × (net(Segunda) − net(Primera))`), and is labelled **extrapolated**. An estimated
league moves with its rung's `net` and never with measured pairs. Every adjusted figure through one says
"estimated" (the compare chart's option, chip, note and exported subtitle; the profile's dropdown, banner and every
marked cell's title).

The matrix has **no NKL and no Liga Ouro data** (checked 2026-10-15), so both are estimates.

### Proposed rungs (for Louie to confirm)

| slug | league | rung | why |
|---|---|---|---|
| `b-league-one` | B.LEAGUE One | 2.5 | Japan's new second division (2026): B1 clubs short of a Premier licence plus B2's best; the matrix's B.League is the old B1 |
| `nkl` | NKL | 3 | Lithuania's professional second division, LKL prospects and veterans; no matrix data |
| `aba-league-2` | ABA League 2 | 3 | the Adriatic second division, young squads of the region's clubs |
| `1-liga-mezczyzn` | 1 Liga Mężczyzn | 3 | Poland's professional second division, few imports |
| `macedonian-super-league` | Macedonian Super League | 3 | a top flight whose best clubs play the Europe Cup and ABA League 2 |
| `liga-ouro` | Liga Ouro | 3.5 | Brazil's second division, short seasons, few imports; no matrix data |
| `nbl1-men` | NBL1 Men | 3.5 | Australia's semi-professional second level: college players and former NBL players |
| `azerbaijan-basketball-league` | Azerbaijan Basketball League | 3.5 | a small top flight that leans on imports |
| `czech-1-liga` | 1. liga mužů | 4 | the Czech semi-professional second division |
| `kkm-albania` | Kampionati Kombëtar Meshkuj | 4 | a small top flight, few professionals |
| `bcb` | British Championship Basketball | 4 | Britain's second level, below Super League Basketball |
| `nlb-men` | NLB Men | 4.5 | Switzerland's second division (the SB League itself is near the ladder's foot) |
| `i-divisioona-a` | I divisioona A | 4.5 | Finland's second division |
| `u-sports` | U SPORTS | 4.5 | Canadian university basketball |
| `ncaa-d2-men` | NCAA Division II (when it appears) | 4.5 | below the Division I conferences the matrix measures |
| `nbl-d1` | NBL Division One | 5 | Britain's third level, semi-professional and amateur |
| `i-divisioona-b` | I divisioona B | 5.5 | Finland's third division |

A NEW MEN'S LEAGUE needs a line in `ALIASES` (if the matrix has it) or in `SPANISH_RUNG` (if not), or it is never
offered. Change a rung here and in the code together; the reader's sentence for each rung is `ladderNote()`, and
every sentence it can produce has a Japanese and Spanish entry (a new kind of rung needs a new entry).

## Every site league (2026-10-15)

| country | slug | name | site tier | gender | method | matrix league / rung |
|---|---|---|---|---|---|---|
| AL | `kkf-albania` | Kampionati Kombëtar Femra | 1 | women | none | — |
| AL | `kkm-albania` | Kampionati Kombëtar Meshkuj | 1 | men | estimate | rung 4 (extrapolated) |
| AU | `nbl` | NBL | 1 | men | direct | Australian NBL |
| AU | `nbl1-men` | NBL1 Men | 2 | men | estimate | rung 3.5 (extrapolated) |
| AU | `nbl1-women` | NBL1 Women | 2 | women | none | — |
| AU | `wnbl` | WNBL | 1 | women | none | — |
| AZ | `azerbaijan-basketball-league` | Azerbaijan Basketball League | 1 | men | estimate | rung 3.5 (extrapolated) |
| BE+NL | `bnxt-league` | BNXT League | 1 | men | direct | BNXT League |
| BG | `nbl-bulgaria` | NBL Bulgaria | 1 | men | direct | Bulgarian NBL |
| BR | `liga-ouro` | Liga Ouro | 2 | men | estimate | rung 3.5 (extrapolated) |
| BR | `nbb` | NBB | 1 | men | direct | Brazilian NBB |
| CA | `cebl` | CEBL | 1 | men | direct | Canadian Elite Basketball League |
| CA | `u-sports` | U SPORTS | uni | men | estimate | rung 4.5 (extrapolated) |
| CH | `nlb-men` | NLB Men | 2 | men | estimate | rung 4.5 (extrapolated) |
| CH | `nlb-women` | NLB Women | 2 | women | none | — |
| CH | `sb-league` | SB League | 1 | men | direct | Swiss LNA |
| CH | `sb-league-women` | SB League Women | 1 | women | none | — |
| CZ | `czech-1-liga` | 1. liga mužů | 2 | men | estimate | rung 4 (extrapolated) |
| CZ | `czech-zbl` | Chance ŽBL | 1 | women | none | — |
| CZ | `czech-nbl` | Kooperativa NBL | 1 | men | direct | Czech NBL |
| DE | `bbl` | easyCredit BBL | 1 | men | direct | German BBL |
| DE | `proa` | ProA | 2 | men | direct | German Pro A |
| DE | `prob` | ProB | 3 | men | direct | German Pro B |
| DK | `basketligaen` | Basketligaen | 1 | men | direct | Danish Basketligaen |
| DK | `kvinde-basketligaen` | Kvinde Basketligaen | 1 | women | none | — |
| EE+LV | `estonian-latvian-basketball-league` | Estonian-Latvian Basketball League | 1 | men | direct | Estonian-Latvian Basketball League |
| ES | `liga-endesa` | Liga Endesa | 1 | men | direct | Spanish ACB |
| ES | `liga-femenina-2` | Liga Femenina 2 | 3 | women | none | — |
| ES | `liga-femenina-challenge` | Liga Femenina Challenge | 2 | women | none | — |
| ES | `liga-femenina-endesa` | Liga Femenina Endesa | 1 | women | none | — |
| ES | `liga-u` | Liga U | y1 | men | none | youth: not adjusted |
| ES | `primera-feb` | Primera FEB | 2 | men | direct | Spanish Primera FEB |
| ES | `segunda-feb` | Segunda FEB | 3 | men | direct | Spanish Segunda FEB |
| EU | `basketball-champions-league` | Basketball Champions League | 2 | men | direct | Basketball Champions League Europe |
| EU | `eurocup` | EuroCup | 2 | men | direct | Eurocup |
| EU | `euroleague` | EuroLeague | 1 | men | direct | Euroleague |
| EU | `fiba-europe-cup` | FIBA Europe Cup | 3 | men | direct | FIBA Europe Cup |
| FI | `i-divisioona-a` | I divisioona A | 2 | men | estimate | rung 4.5 (extrapolated) |
| FI | `i-divisioona-b` | I divisioona B | 3 | men | estimate | rung 5.5 (extrapolated) |
| FI | `korisliiga` | Korisliiga | 1 | men | direct | Finnish Korisliiga |
| FI | `naisten-korisliiga` | Naisten Korisliiga | 1 | women | none | — |
| FR | `lnb-elite` | Betclic ÉLITE | 1 | men | direct | French Jeep Elite |
| FR | `lnb-elite-2` | ÉLITE 2 | 2 | men | direct | French LNB Pro B |
| FR | `lnb-espoirs-elite` | Espoirs ÉLITE | y1 | men | none | youth: not adjusted |
| FR | `lnb-espoirs-elite-2` | Espoirs ÉLITE 2 | y2 | men | none | youth: not adjusted |
| GB | `bcb` | British Championship Basketball | 2 | men | estimate | rung 4 (extrapolated) |
| GB | `eabl` | Elite Academy Basketball League | y1 | men | none | youth: not adjusted |
| GB | `nbl-d1` | NBL Division One | 3 | men | estimate | rung 5 (extrapolated) |
| GB | `slb-men` | Super League Basketball Men | 1 | men | direct | Super League Basketball |
| GB | `slb-women` | Super League Basketball Women | 1 | women | none | — |
| GB | `wnbl-d1` | WNBL Division One | 2 | women | none | — |
| GB | `weabl` | Women's Elite Academy Basketball League | y1 | women | none | — |
| GR | `greek-elite-league` | Greek Elite League | 2 | men | direct | Greek HEBA A2 (the Elite League is the renamed A2) |
| IL | `winner-league` | Winner League | 1 | men | direct | Israeli BSL |
| IT | `lega-basket-serie-a` | Lega Basket Serie A | 1 | men | direct | Italian Lega Basket Serie A |
| IT | `serie-a1-femminile` | Serie A1 Femminile | 1 | women | none | — |
| IT | `serie-a2-femminile` | Serie A2 Femminile | 2 | women | none | — |
| JP | `b-league-one` | B.LEAGUE One | 2 | men | estimate | rung 2.5 |
| JP | `b-league-premier` | B.LEAGUE Premier | 1 | men | direct | Japanese B.League |
| JP | `w-league-future` | W League Future | 2 | women | none | — |
| JP | `w-league-premier` | W League Premier | 1 | women | none | — |
| KR | `kbl` | KBL | 1 | men | direct | South Korean KBL |
| LT | `lkl` | LKL | 1 | men | direct | Lithuanian LKL |
| LT | `nkl` | NKL | 2 | men | estimate | rung 3 |
| MK | `macedonian-super-league` | Macedonian Super League | 1 | men | estimate | rung 3 |
| MX | `cibacopa` | CIBACOPA | 2 | men | direct | Mexican CIBACOPA |
| MX | `lnbp` | LNBP | 1 | men | direct | Mexican LNBP |
| PL | `1-liga-kobiet` | 1 Liga Kobiet | 2 | women | none | — |
| PL | `1-liga-mezczyzn` | 1 Liga Mężczyzn | 2 | men | estimate | rung 3 |
| PL | `orlen-basket-liga` | ORLEN Basket Liga | 1 | men | direct | Polish OBL |
| RO | `lnbf` | Liga Nationala de Baschet Feminin | 1 | women | none | — |
| RO | `lnbm` | Liga Nationala de Baschet Masculin | 1 | men | direct | Romanian Divizia A |
| SE | `basketligan` | Basketligan | 1 | men | direct | Swedish Basketligan |
| SE | `basketligan-dam` | Basketligan Dam | 1 | women | none | — |
| SK | `slovak-sbl` | Tipos Slovenska basketbalova liga | 1 | men | direct | Slovakian Extraliga |
| XB | `aba-league` | ABA League | 1 | men | direct | Adriatic League Liga ABA |
| XB | `aba-league-2` | ABA League 2 | 2 | men | estimate | rung 3 |
| XB | `aba-u19-league` | ABA U19 League | y1 | men | none | youth: not adjusted |
| XK | `kosovo-superliga` | Kosovo Superliga | 1 | men | direct | Kosovo FBK |
| — | `nbl-u18s-men-s` | NBL U18s Men's (private) | — | men | none | — |
| — | `test` | Test (private) | — | men | none | — |

37 measured, 21 estimated, 23 never offered (21 women's, the private U18 league and the test league).

## Members only

`EpinoiaTransferAdjust.locked(league)` = `EpinoiaAccess.featureLocked('transferMatrix', league)`. Until access.js
names `transferMatrix` (the matrix page's agent adds it), the premium table columns' lock (`statColumns`) stands in:
an account first, then the analytics gate. Locked, the option is drawn as a button that MemLock wires to the sign-in
prompt (or the membership popup): shown, never hidden.

## Open questions

* The rungs above are proposals; NKL and Liga Ouro in particular.
* DECIDED (Louie, 2026-10-15): youth leagues are left out - any league filed under a youth tier ('y1'/'y2' in
  config.js) is never offered (transferleagues.js isYouth). University leagues (U SPORTS, NCAA D2) stay as
  extrapolated estimates. B.LEAGUE Premier matches the matrix's "Japanese B.League" directly.
* `B.LEAGUE Premier` is matched to the matrix's `Japanese B.League` (the old B1, 2017-2025).
