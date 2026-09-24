# Where each league's games come from

Ten leagues were added to the ingest in September 2026. Five are FIBA LiveStats and cost almost
nothing (see `config/ingest-sources.json` and `scripts/ingest/adapters/fiba_site_schedule.py`).
Five are not, and each needs its own adapter.

EVERY RECIPE BELOW IS TAKEN FROM CODE THAT ALREADY WORKS. The scrapers in Louie's
`scraper files` project have parsed these feeds for years; nothing here was designed, it was read
off the files named against each league and probed live on 2026-09-18 to confirm that the CURRENT
season resolves. It is written down so the next pass ports rather than re-derives.

WHAT AN ADAPTER MUST RETURN is in `scripts/ingest/adapters/base.py`, and one detail decides how
much work each league is: `write_platform` reads `bundle.raw` AS A FIBA PAYLOAD -
`feedplatform.ensure_game_people` walks `raw["tm"]["1"|"2"]` for `code`, `name` and
`pl{pno: player}`. An adapter that shapes its league's payload into that form gets the clubs, the
players, the rosters, the box score, the stints and the shot chart from code that already exists.
That is the intended way to add these five.

PLAYER NAMES are not an adapter's problem: `scripts/ingest/names.py` already handles every form
these feeds send (LAST, FIRST / shouted / kanji with a romaji field / diacritics), and
`names.same_club` handles the sponsor in a club's name, which the ACB and EuroLeague change
mid-season. An adapter passes the feed's own fields through and lets that module decide.

## Liga Endesa (ACB)

### host

own API + HTML (NOT FIBA LiveStats). Three different sources in one league: schedule = server/JS-rendered HTML at www.acb.com (Next.js/RSC, needs Selenium); play-by-play = JSON REST at api2.acb.com behind a hardcoded X-APIKEY; box score = Selenium-rendered HTML tables at live.acb.com.

### current_season

Token shape: ?temporada=<N> where N = season START year minus 1935 (scrape-now.py:2660-2670, comment '90 = 2025-26, 89 = 2024-25, ... => start_year - 1935; verified'). Season tokens accepted by the CLI are '2026', '2026/27' or '2026-27' (_season_start_year, scrape-now.py:809); only ONE season per run (_single_season, line 818 — extra tokens are warned about and dropped). TODAY (2026-09-18) the current season is 2026-27 => temporada=91. NOTE the hardcoded default at scrape-now.py:78 is still temporada=90 (2025-26), so a default run scrapes LAST season unless a season token is passed.

### schedule_recipe

Verbatim from scrape-now.py:78 — "https://www.acb.com/es/calendario?temporada=90" (90 = 2025-26). Dispatcher rewrites it per season at scrape-now.py:2670: f"https://www.acb.com/es/calendario?temporada={year - 1935}". Fetched by fetch_acb_schedule_page() (line 23947) with Selenium: waits for document.readyState=='complete', then for CSS 'a[href*="live.acb.com/partidos/"]', then 5 scroll passes to force lazy rounds, then returns driver.page_source. Parsed by _parse_acb_schedule() (3650): round containers are div[id^="calendar-round-"] (fallback class prefix 'Round_round__'); jornada from 'RoundTitle_roundTitle__' via regex 'Jornada\s+(\d+)'; date headers h3 'DayTitle_dayTitle__' parsed with a Spanish month map from '4 de octubre de 2025' -> ISO; per game it requires an anchor matching r'live\.acb\.com/partidos/.*/estadisticas', strips '/estadisticas' to get match_url, and takes match_id from r'-(\d+)$' on the slug. Team names from span class prefix 'roundMatch__teamName--fullName__', scores from p class prefix 'roundMatch__teamScore__'. Emits {'match_id','match_url','home_team','away_team','status','spieltag','game_date','is_acb': True}.

### game_recipe

Two calls per game, both verbatim from the code.
1) PBP (primary, ~675 events): GET https://api2.acb.com/api/matchdata/PlayByPlay/play-by-play?matchId={match_id}  with headers exactly as LINEUPDATASCRAPE:24048-24052 — {'X-APIKEY': '0dd94928-6f57-4c08-a3bd-b1b2f092976e', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}, timeout=20. match_id is pulled off the game URL with r'-(\d+)(?:/[^/]*)?$' (fallback r'(\d{4,})(?:/|$)'). Response accepted only if len(plays) > 10.
2) Box score (no API exists): Selenium on {match_url}/estadisticas — fetch_acb_game_page() line 24078 loads the page, waits for >=2 <table> and >10 'tbody tr', clicks the Radix toggle '[role="group"] button[role="radio"]' whose text is All/Todo/Todos, then grabs page_source. When the PBP API succeeded it is called with skip_pbp=True so the /jugadas tab is never loaded. HTML PBP fallback (only if the API fails) = {match_url}/jugadas with per-quarter button clicking, parsed by parse_playbyplay_acb() (11475).
Game URL shape: https://live.acb.com/en/partidos/<home-slug>-vs-<away-slug>-<matchId> (the /es/ path also works; the schedule yields the /es/ form).

### parser_entry

PBP: LINEUPDATASCRAPE - Copy - Copy.txt::parse_playbyplay_acb_api() line 11680 — fed at 27267-27268 (`if acb_api_data: pbp_success = parser.parse_playbyplay_acb_api(acb_api_data)`). It sorts plays by 'order', converts (quarter, minute, second) to elapsed seconds with 10-min quarters / 5-min OT (`elapsed = (quarter-1)*600 + (600 - minute*60 - second)`; OT: `2400 + (ot-1)*300 + (300 - ...)`), maps team via `team_idx = 0 if play.get('local') else 1`, and translates the 36 verified numeric playType codes (92 FT made, 93 2pt made, 94 3pt made, 96/97/98 misses, 100 dunk made, 101 OREB, 102 block, 103 steal, 104 DREB, 106 TOV, 107/108/119 assist, 109/159/160/161 PF, 110 foul drawn, 112 sub IN, 115 sub OUT, 178/179 jump ball, 599 starting lineup, 600 possession — full table in the docstring at 11686-11702) into the engine's English action strings, then calls the shared process_action(). Box score: parse_boxscore_acb() 11172 -> _extract_acb_team_stats() 11319 (22-column table; note the documented column swap at 11412-11415: the column labelled 'DR' actually holds OREB and 'OR' holds DREB). HTML PBP fallback: parse_playbyplay_acb() 11475 + _translate_acb_action() 12143 (88 locale event titles).

### names

ACB API gives natural Spanish 'First Last' with full diacritics. Verbatim from today's live probe of matchId=104459: "Kendrick Perry", "Harald Frey", "Olek Balcerowski", "Nihad Djedovic", "Tyson Pérez", "Chris Duarte", "Darrun Hilliard", "Tryggvi Hlinason", "Margiris Normantas", "Alberto Díaz", "Xavier Castañeda". The HTML box score gives ABBREVIATED forms ('A. Font'), so the two feeds disagree. Existing normalisation: _acb_lookup_number() (LINEUPDATASCRAPE:12091) bridges them — exact match, then last-name + first-initial against the roster regex r'([A-Z])\.\s+(.+)', then a difflib SequenceMatcher fuzzy fallback with a 0.6 threshold. The global normalize_player_name() (line 546) also applies: it strips ALL periods (because process_action's name character class has no '.', so 'K.J. Williams' would be dropped entirely) and flips 'LAST, FIRST' to Title Case 'First Last'. Player identity is also available as a stable numeric key: plays carry 'playerLicenseId' (e.g. 30001977 for Kendrick Perry) — the existing code ignores it, but for the website ingest it is a far better join key than the name.

### logos

YES — and better than expected: the ACB PBP API response itself carries the crests, so no extra request is needed. Verbatim from probe (3), homeTeam object: {"id":4384,"competitionId":1,"editionId":90,"clubId":14,"fullName":"Unicaja","shortName":"Unicaja","abbreviatedName":"UNI","primaryColorHex":"#3d9c35","textColorHex":"#FFFFFF","logo":"https://static.acb.com/img/www/clubes2024/2324UnicajaLogo.png","logoAlt":"Unicaja logo","secondaryLogo":"https://static.acb.com/img/www/clubes2024/2324UnicajaLogo.png","contrastRequired":false,"shirtColor":null,"shirtTextColor":null}. So per game you get home/away crest URL, a negative/secondary crest, and the club's primary + text hex colours — enough to theme a league page. Crest host pattern: https://static.acb.com/img/www/clubes<YYYY>/<file>.png (also seen: .../clubes2026/202627MonbusObradoiroLogoPositivoOK.png, .../clubes2026/202627ValenciaBasket40Anys.png in the 2026-27 calendar page's <link rel="preload" as="image"> tags, i.e. the schedule page preloads every club crest for the season). Each club also has Positivo/Negativo variants. The existing scraper NEVER captures any of this — _parse_acb_schedule() only reads img alt text as a team-NAME fallback (lines 3790-3798). Pure gain for the website ingest.

### shots

NO shot coordinates. The api2.acb.com PBP payload's play keys are exactly ['licenseType','local','minute','order','playTag','playType','playerImage','playerLicenseId','playerName','playerNumber','playerStats','quarter','scoreAway','scoreHome','second'] (verified across all 675 plays of matchId 104459) — there is no x/y, no zone, no distance field. Shot TYPE is available only coarsely: playType 100 = Dunk Made is a distinct code from 93 = 2pt Made, and the HTML-fallback translator _translate_acb_action() (12143) has a DUNKS branch; that is the entire rim signal. 'playTag' exists but is null on 650 of 675 plays (values seen: 12 x12, 13 x10, 1 x2, 7 x1) and the code ignores it. What ACB DOES give per play that EuroLeague does not: cumulative 'playerStats' on every event and 'playerImage' (a headshot URL, e.g. https://static.acb.com/media/PRO/00/00/82/69/59/0000826959_5-6_01.jpg).

### probe

3 requests, all today 2026-09-18.
(1) GET https://www.acb.com/es/calendario?temporada=91 -> HTTP 301, 162 bytes (redirects to https://acb.com/es/liga/calendario?temporada=91).
(2) Same URL following redirects -> HTTP 200, 2,461,222 bytes. Page heading contains 'temporada <!-- -->2026-27' — confirms temporada=91 == 2026-27 and the year-1935 rule. 20 round containers present (id="calendar-round-6015" ... ), 307 links of the form live.acb.com/partidos/<slug>-<id>/previa (e.g. 'live.acb.com/partidos/asisa-joventut-vs-barca-105410/previa'), and ZERO '/estadisticas' links — the 2026-27 season has its full fixture list published but no game has been played yet, so the existing schedule parser (which requires an estadisticas link) correctly returns 0 games today.
(3) GET https://api2.acb.com/api/matchdata/PlayByPlay/play-by-play?matchId=104459 with the X-APIKEY header copied from LINEUPDATASCRAPE:24049 -> HTTP 200, 382,049 bytes, JSON keys ['homeTeam','awayTeam','plays','matchFinished'], 675 plays, matchFinished=true, homeTeam.editionId=90 (independently confirming edition 90 == 2025-26). The hardcoded API key still works.

### gotchas

- The season default is stale: scrape-now.py:78 still says temporada=90 (2025-26). Today the current season is 91. Always pass a season token or compute year-1935 at ingest time.
- As of today the 2026-27 calendar has 307 fixtures but 0 '/estadisticas' links (all '/previa'), so the existing schedule parser legitimately yields zero games until the first jornada is played. Do not treat that as a broken scraper.
- The ACB site's CSS-module class scheme has CHANGED since the parser was written. The SSR HTML I pulled today uses 'RoundMatch-module-scss-module__q1UjKa__roundMatch__homeTeam' (hash in the MIDDLE, no trailing hash) and 'RoundTitle-module-scss-module__...' / 'DayTitle-module-scss-module__...', whereas _parse_acb_schedule() matches the older Next.js scheme r'RoundMatch_roundMatch__[A-Z]', 'RoundTitle_roundTitle__', 'DayTitle_dayTitle__' and 'roundMatch__teamName--fullName__' (trailing underscores). div[id^='calendar-round-'] still matches, so the round loop survives, but every inner selector looks stale. I could not confirm the post-hydration DOM without running Selenium — verify before porting, or (better) skip the HTML entirely.
- The SSR HTML is a skeleton: team names/scores render as literal 'XXXXXXXX' and 'XX' placeholders until React hydrates. Plain requests.get on the calendario page cannot read names or scores — that is why the code uses Selenium. The one thing the raw HTML DOES give you without a browser is the 307 live.acb.com/partidos/<slug>-<matchId> links (and every club crest URL in the preload tags), which is all the ingest actually needs to enumerate a season.
- The api2.acb.com X-APIKEY '0dd94928-6f57-4c08-a3bd-b1b2f092976e' is hardcoded at LINEUPDATASCRAPE:24049 and still works today. It is a third-party key that can be rotated without notice — the ingest needs a clear failure path, not a silent empty season.
- Box-score column trap, already fixed in the code and easy to re-break: in the 22-column ACB table the header labelled 'DR' actually holds OREB and 'OR' holds DREB (cells[9] = oreb, cells[10] = dreb; comment at 11412-11415).
- Offensive fouls: code 160 is a PF, and the turnover it implies arrives as a SEPARATE code 106 event — do not double-count.
- There is no ACB validation harness and no cached ACB payload on disk. Anything ported here has no regression net; the 675-play matchId=104459 response I fetched is the only known-good sample.


## EuroLeague

### host

own API (NOT FIBA LiveStats). Two official hosts: feeds.incrowdsports.com for the schedule (the site's own Game Center feed) and live.euroleague.net/api for per-game data. No Selenium on the happy path since 2026-07.

### current_season

Token shape: E + season START year, e.g. E2025 = 2025-26, E2026 = 2026-27. Used as the {SEASON} path segment in the feeds API and as &seasoncode= on live.euroleague.net. scrape-now.py:1878-1881 accepts either form and coerces: a token not starting with 'E' becomes f"E{s.split('/')[0]}", so '2026' or '2026/27' -> 'E2026'; multiple seasons are allowed and joined with commas. TODAY (2026-09-18) the current season is E2026 (the feed names it "EuroLeague 2026-27", alias "2026-27", year 2026) and its full 38-round fixture list is already published. As with ACB, the hardcoded default at scrape-now.py:99 is still ?season=E2025 — stale by one season as of today.

### schedule_recipe

Primary, verbatim from LINEUPDATASCRAPE:25036-25039 — one call per season, whole season in one response:
  https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/{SEASON}/games?limit=500
with headers {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36'}, timeout=45; games are resp.json()['data']. Season codes are read out of the schedule URL's ?season= param, comma-separated (scrape-now.py:1881-1886 REPLACES rather than appends the param, and strips ?round= — the comment at 97-99 warns that a stray round=1 silently truncates a full-season scrape to 10 games). Per game the code builds: match_id = f"EL_{sc}_{code}"; match_url = f"https://www.euroleaguebasketball.net/en/euroleague/game-center/{season_alias}/{home_slug}-{away_slug}/{sc}/{code}/" (slugs = re.sub(r'[^a-z0-9]+','-', name.lower()).strip('-')); status = 'COMPLETE' if g['status']=='result' else 'SCHEDULED'; game_date = g['date'][:10]; is_euroleague=True.
Secondary path, only used from inside an already-loaded Selenium page (_collect_euroleague_games_via_feeds_api, 24920), same base with per-round enumeration — useful because it also enumerates Play-In / Playoffs / Final Four:
  https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/{SEASON}/rounds
  https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/{SEASON}/games?teamCode=&roundNumber={N}
The schedule page URL itself (https://www.euroleaguebasketball.net/euroleague/game-center/?season=E2025) is only a carrier for the season param on the happy path.

### game_recipe

Three GETs per game, all verbatim from fetch_euroleague_game_via_api() (LINEUPDATASCRAPE:25392-25490), all with headers {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36'} and timeout=max(wait_time,30):
  https://live.euroleague.net/api/Boxscore?gamecode={game_code}&seasoncode={season_code}
  https://live.euroleague.net/api/PlayByPlay?gamecode={game_code}&seasoncode={season_code}
  https://live.euroleague.net/api/Points?gamecode={game_code}&seasoncode={season_code}   (shot chart, for the rim split only; failure is non-fatal)
game_code and season_code are recovered from the match URL with re.search(r'/(E\d{4})/(\d+)/?', match_url). Accepted only if box['Stats'] has exactly 2 entries. There is NO 'Header' call anywhere in this codebase — the task brief's 'Header feed' does not exist here; team names/codes come from the PlayByPlay feed's TeamA/TeamB/CodeTeamA/CodeTeamB, and quarter scores from Boxscore's 'ByQuarter'/'EndOfQuarter'.

### parser_entry

The fetcher converts the three feeds into two sentinel HTML strings and the existing parsers consume those: '<!-- EUROLEAGUE_BOXSCORE_JSON -->{rawGameInfo}<!-- /EUROLEAGUE_BOXSCORE_JSON -->' and '<!-- EUROLEAGUE_PBP_JSON -->{pbp}<!-- /EUROLEAGUE_PBP_JSON -->' (built at LINEUPDATASCRAPE:25536-25543). Box score: parse_boxscore_euroleague() 13782 -> _parse_euroleague_boxscore_json() 13798 (reads {'home'/'away': {name, code, score, players:[{dorsal,name,startFive,stats{...}}]}}; the Boxscore->rawGameInfo field map is conv_team() at 25430-25462, e.g. Assistances->assists, BlocksFavour->blocksFavour, FoulsCommited->foulsCommited, totr.Points->team score). PBP: parse_playbyplay_euroleague() 14496 -> _parse_euroleague_pbp_json() 14293, fed by conv_events() at 25492-25512 (PLAYTYPE->playType, CODETEAM->teamCode, PLAYER->playerName, DORSAL->playerDorsal, MARKERTIME->markerTime, MINUTE->minute, PLAYINFO->playInfo). Action mapping at 14425-14472: 2FGM/2FGA/3FGM/3FGA/FTM/FTA/D/O/TO/ST/FV/CM/CMT/CMU/CMD/CMTI/OF/AS. Two things to port with it: the ExtraTime splitter (25514-25523, OT number = 1 + (minute-41)//5) and the 'EL sub-stream repair' at 14330-14414 — EuroLeague operators emit the substitution IN before the matching OUT, which leaves 6 men on court; the fix holds each IN while the shadow lineup is full and releases it when an OUT frees a slot. Skip-list for non-stat events is mirrored in validate_el.py:24 — {'BP','EP','EG','JB','TOUT','TOUT_TV','CCH','RV','AG','B','C'} ('C' = coach foul, PLAYER_ID CO_A/CO_B, has no box row).

### names

EuroLeague gives 'LAST, FIRST' in ALL CAPS, in BOTH feeds, with trailing space padding on the id/code fields. Exact strings from validation\euroleague\captures\E2025_20.json: Boxscore player row {"Player_ID": "P007982   ", "IsStarter": 1, "Team": "ZAL", "Dorsal": "1", "Player": "WILLIAMS-GOSS, NIGEL", "Minutes": "24:30", ...}; PBP event {"PLAYTYPE": "TO", "PLAYER": "HORTON TUCKER, TALEN", "CODETEAM": "ULK       ", "DORSAL": "8", "MINUTE": 1, "MARKERTIME": "09:36", "PLAYINFO": "Turnover (1)"}; also "HALL, DEVON", "SLEVA, DUSTIN". Team fields are padded too: CodeTeamA='ZAL       ', TeamA='Zalgiris Kaunas', while Boxscore Stats[0]['Team']='ZALGIRIS KAUNAS' (all caps) — the code always .strip()s codes and prefers the PBP feed's mixed-case team names (25425-25427). Existing normalisation: normalize_player_name() (LINEUPDATASCRAPE:546) turns 'WILLIAMS-GOSS, NIGEL' into 'Nigel Williams-Goss' (flip on the comma + .title()) and strips every period first (periods break process_action's name regex and silently drop the whole event). On top of that, _build_euroleague_name_lookup() (13688) indexes each roster name four ways — exact, 'LAST, FIRST', 'FIRST LAST', and bare last name (last-name key set to None when ambiguous) — and _euroleague_lookup_number() (13719) tries exact, comma-stripped, reversed, last-name-only, then a substring fuzzy fallback. Note 'Player_ID' (e.g. 'P007982') is a stable per-player key the current code ignores; use it as the join key in the website ingest instead of the name.

### logos

YES, on the schedule feed, one field per team, no extra request: data[].home.imageUrls.crest and data[].away.imageUrls.crest. From today's probe: FC Barcelona -> https://media-cdn.incrowdsports.com/35dfa503-e417-481f-963a-bdf6f013763e.png ; Partizan -> https://media-cdn.incrowdsports.com/2681304e-77dd-4331-88b1-683078c0fb49.png ; Olympiacos -> https://media-cdn.incrowdsports.com/789423ac-3cdf-4b89-b11c-b458aa5f59a6.png ; Valencia -> https://media-cdn.cortextech.io/1dU3kpCqReRp93/1BSdBWIjChWbHL/bc3e00b2-fea4-40be-a7ec-1e633129bde3.png (note: two different CDN hosts, so do not hardcode one). The same team objects also carry code/tla/abbreviatedName/editorialName and a venue block (name, capacity, address). The existing scraper reads only name/score/code from this payload (25046-25065) and throws the crests away — free win for the website. The live.euroleague.net game feeds carry NO images.

### shots

YES — the Points feed, and the existing code already derives a rim/other split from it. Endpoint: https://live.euroleague.net/api/Points?gamecode={code}&seasoncode={season}. Payload is {'Rows': [...]}; verified against validation\euroleague\points\E2025_20_points.json (152 rows). Row verbatim: {"NUM_ANOT":12,"TEAM":"ULK       ","ID_PLAYER":"P011205   ","PLAYER":"HALL, DEVON","ID_ACTION":"2FGM","ACTION":"Two Pointer","POINTS":2,"COORD_X":-81,"COORD_Y":56,"ZONE":"B","FASTBREAK":"0","SECOND_CHANCE":"0","POINTS_OFF_TURNOVER":"0","MINUTE":1,"CONSOLE":"09:24","POINTS_A":2,"POINTS_B":2,"UTC":"20251003170220"}. Coordinate convention assumed by the code (LINEUPDATASCRAPE:25464-25486): COORD_X/COORD_Y are CENTIMETRES measured from the BASKET CENTRE, already folded to a single half-court (no side flipping needed), so distance = sqrt(x^2+y^2). The rim rule, verbatim: rows whose ID_ACTION is '2FGM' or '2FGA' with sqrt(x^2+y^2) <= 200 are rim attempts. Join key: Points.NUM_ANOT == PlayByPlay.NUMBEROFPLAY. The matched events get shotSubtype='layup' (which trips the engine's rim keyword list); unmatched 2pt shots fall back to the neutral 'jump shot' (neither rim nor OTD), so a Points failure degrades rather than breaks. Calibration note in the code: 3FG rows start at ~671cm (the 6.75m arc) and the 2pt histogram falls off sharply after 200cm; the resulting rim share is 64.5% vs 60.8% for LNB's true subtypes. My own check of the cached file agrees: 2pt distances span 12-564cm (83 shots), 3pt 683-1180cm (44 shots). Free throws are sentinel-coded COORD_X=-1, COORD_Y=-1, ZONE=' ' — exclude them (the code only looks at 2FGM/2FGA so it already does). Also unused and free: ZONE (letters A-J), FASTBREAK, SECOND_CHANCE and POINTS_OFF_TURNOVER flags per shot, and UTC wall-clock — the engine currently recomputes fast break from an 8-second window (FASTBREAK_WINDOW_SECONDS, line 5637) instead of reading these.

### probe

1 live request plus zero-network local proof.
Live: GET https://feeds.incrowdsports.com/provider/euroleague-feeds/v2/competitions/E/seasons/E2026/games?limit=2 (Accept: application/json, the code's UA) -> HTTP 200, 3,373 bytes. First record verbatim: {"identifier":"E2026_379","code":379,"season":{"code":"E2026","name":"EuroLeague 2026-27","alias":"2026-27","year":2026},"competition":{"code":"E","name":"Euroleague"},"phaseType":{"code":"RS",...},"round":{"round":38,...},"date":"2027-04-16T18:30:00.000Z","status":"confirmed","home":{"code":"BAR","name":"FC Barcelona","tla":"BAR",...,"imageUrls":{"crest":"https://media-cdn.incrowdsports.com/35dfa503-e417-481f-963a-bdf6f013763e.png"}},"away":{"code":"PAR","name":"Partizan Mozzart Bet Belgrade",...},"venue":{"code":"AMH","name":"PALAU BLAUGRANA","capacity":7585,...}} — so E2026 resolves today and its round-38 fixtures are already dated.
Local proof the whole path works today with no extra request: C:\Users\Admin\Documents\scraper files\output\EL_20260918_020603\ was produced at 2026-09-18 02:06; its schedule_1.html is literally '<html><body data-euroleague-api-schedule="1"><!-- 402 games from incrowd feeds API --></body></html>' and diagnostic_log.txt shows 'STARTING GAME: EL_E2025_406  Home: Olympiacos Piraeus  Away: Real Madrid' with rosters parsed.

### gotchas

- Season default is stale: scrape-now.py:99 still pins ?season=E2025 (2025-26). Today's season is E2026. Compute it, don't inherit it.
- NEVER carry a round= param on the EuroLeague schedule URL. The feeds fetcher treats it as a filter, so a leftover round=1 silently reduces a 402-game season to 10 games — the warning is in the config comment at scrape-now.py:97-99 and the season rewriter at 1883 explicitly strips both 'season' and 'round'.
- The season param must be REPLACED, not appended: the fetcher reads only the first occurrence of ?season=, so appending a second one silently loses the requested seasons (scrape-now.py:1881-1886).
- Plain requests to euroleaguebasketball.net get rate-limited (429) — that is why _collect_euroleague_games_via_feeds_api() runs its fetches from inside the Selenium page. The feeds.incrowdsports.com host itself answers fine to a plain request (proved today), which is what the primary path relies on.
- The site moved to the Next.js App Router in 2026-07 and no longer embeds __NEXT_DATA__; the Selenium/RSC path (25546+, _extract_euroleague_rsc_object) is a legacy fallback only. Port the API path and leave Selenium behind entirely.
- Substitution order is wrong in the source feed (IN before OUT), producing 6-man lineups. The repair loop at 14330-14414 is not optional if you want correct minutes/stints — port it verbatim.
- API field name traps in the Boxscore feed: 'Assistances' (not Assists), 'BlocksFavour'/'BlocksAgainst', 'FoulsCommited' (single 't'), 'ForthQuarter' (sic) for Q4 in the PBP feed, and 'totr' for team totals vs 'tmr'. All strings from the feed are space-padded and must be .strip()ed.
- Known-open issue carried in the user's memory: EL 6-man sub-pairing was still flagged after the 2026-07-16 RAPM/stint audit; and the EVENTS-tab work (2026-09-13) found the engine's fast/second-chance windows running above FIBA's official totals and a first-FT window quirk — neither was fixed. Do not assume the EL fast-break/second-chance numbers are authoritative.
- A regression harness already exists and needs no network: python validation\euroleague\validate_el.py --cached replays 41 cached E2025 games through the same mapping rules and diffs the reconstructed box vs the official one.


## LNB Elite (Betclic ÉLITE, France, division 1)

### host

own API (two hops, NO FIBA LiveStats host involved): schedule from lnb.fr's own backend `https://api-prod.lnb.fr`; game data from Sportradar EUI Connect embed `https://embed-api.eui.connect.sportradar.com/v1/embed/12` (unit 12 = LNB; Bulgaria reuses the identical engine on unit 308).

### current_season

Season axis = the season START YEAR, an ordinary integer (not a token/uuid). Resolution at LINEUPDATASCRAPE :23334-23340:
    years = [today.year if today.month >= 7 else today.year - 1]
when no `years=` is given. scrape-now.py :1432-1434 turns a `--seasons 2025/2026` token into `&years=2025` (it splits on '/' and takes the left half), so '2026', '2026/27' and '2026-27' all mean the 2026-27 season.

TODAY (2026-09-18, month 9 >= 7) the current season resolves to year=2026, and year=2026 + division_external_id=1 returns competition external_id=317, competition_name 'Betclic ÉLITE', season_id '4e3b2f66-6a4c-11f1-a5ad-25baed35874f', start_date 2026-01-07, end_date 2027-06-30. The same call also returns the sibling comps the scraper will sweep: 316 FULFIL Supercoupe, 323 Leaders Cup, 325 Betclic ÉLITE - Play-In, 326 Betclic ÉLITE - Playoffs (321 All Star Game and 322 Young Star Game are dropped by the 'star game' filter).

### schedule_recipe

Two calls, verbatim from LINEUPDATASCRAPE :23322-23402 (and lnb_adapter.py :514-568).

HEADERS (LNB_HEADERS, :22891-22892):
  {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
   'Referer': 'https://lnb.fr/', 'Origin': 'https://lnb.fr'}

1) competitions for the season/division:
   GET https://api-prod.lnb.fr/competition/getDivisionCompetitionByYear?year={YEAR}&division_external_id=1
   -> {'data':[{external_id, season_id, competition_name, start_date, end_date, ...}]}
   Code SKIPS any competition whose name lowercases to contain 'star game' (exhibition).

2) per competition, the calendar:
   POST https://api-prod.lnb.fr/match/getCalendar
   headers = {**LNB_HEADERS, 'Content-Type': 'application/json'}
   body    = {"competition_external_id": <external_id>, "start_date": "<comp.start_date[:10] or YEAR-07-01>", "end_date": "<comp.end_date[:10] or (YEAR+1)-06-30>"}
   -> {'data':[{date, data:[match,...]}, ...]}  (date-grouped)

Match dict built at :23378-23394:
  match_id  = 'LNB_{external_id or match_id}'
  fixture_id= m['match_id']            # THIS is the EUI fixture UUID
  season_id = comp['season_id']        # threaded to the game fetch
  match_url = 'https://lnb.fr/fr/match-center/{m[match_id]}'
  home/away = m['teams'][0|1]['team_name'], game_date = m['match_date']
  status    = 'COMPLETE' if m['match_status']=='COMPLETE' else 'SCHEDULED'
  is_lnb    = True
  home_score/away_score only set when teams[].score_string is non-empty (filter_completed_games needs those keys).

The internal pseudo-URL 'https://lnb.fr/fr/calendar?division=1[&years=2024,2025]' is just a carrier for division + years; is_lnb_schedule_url() (:23317) matches on 'lnb.fr' in url and 'calendar' in url.

### game_recipe

TWO GETs per game (LINEUPDATASCRAPE :23304-23315, identical in lnb_adapter.py :72-83). The state param is zlib-compressed, urlsafe-base64'd, '='-stripped JSON:

  state = base64.urlsafe_b64encode(zlib.compress(json.dumps({'s': season_id, 'l': 'fr-FR', 'z': z, 'f': fixture_id}, separators=(',',':')).encode())).decode().rstrip('=')

  for z in ('pbp', 'statistics'):
      GET https://embed-api.eui.connect.sportradar.com/v1/embed/12/fixture_detail
          ?state=<state>&fixtureId=<fixture_id>
      headers=LNB_HEADERS, timeout=40
      payload = r.json()['data']

fixture_id is pulled out of the match-center URL by re.search(r'match-center/([0-9a-f-]{20,})', match_url) at :23406.
z='pbp'        -> data['pbp'] = {"1": {"events": [...]}, "2": {...}, ...} plus data['fixture'] and data['seasonId'].
z='statistics' -> data['statistics']['data']['base']['home'|'away']['persons'][0]['rows'].
Both payloads are then merged into {'pbp':..., 'statistics':...} and wrapped as
  '<html><body data-lnb-v1="1"><!-- LNB_DATA_JSON -->' + json + '<!-- /LNB_DATA_JSON --></body></html>'
Sanity gate at :23420-23422: if total pbp events < 50 it prints 'WARNING: LNB feed looks incomplete'.
A cached example of exactly this merged payload: validation\lnb\captures\0b38ca72-6715-11f0-bb3c-27e6e78614e1.json (fixture 0b38ca72-…, season df310a05-51ad-11f0-bd89-c735508e1e09).

### parser_entry

parse_lnb_game_data(data) — LINEUPDATASCRAPE - Copy - Copy.txt:22974-23302. Pure function, no network, no Selenium: takes {'pbp','statistics'} and returns teams / site box score / normalized (action, team_idx, elapsed, quarter) stream with cleaned substitutions.
Class wrappers that call it: BasketballParser._lnb_parse :6461, _parse_lnb_boxscore :6474, _parse_lnb_playbyplay :6541; detection _detect_lnb_format :6454 ('<!-- LNB_DATA_JSON -->' in first 200k chars, or _format_hint=='lnb').
Standalone equivalent for porting: validation\lnb\lnb_adapter.py :149 parse_lnb_game(data).

### names

FIRST LAST, Latin script with French/Slavic diacritics — box and PBP agree.
Real strings from validation\lnb\captures\0b38ca72-6715-11f0-bb3c-27e6e78614e1.json:
  statistics rows: "personName": "Justin Bibbins" (bib '1', starter true), "Robin Ducoté" (bib '6'), "Tariq Owens" (bib '41'), "Gregor Hrovat" (bib '15'), "David Holston" (bib '11')
  pbp events:      "name": "Justin Bibbins", "TaShawn Thomas", "Trevor Hudgins"
Existing normalisation (LINEUPDATASCRAPE :22998-22999 and again in _actor at :23046-23049):
    name = re.sub(r'\s+', ' ', (row.get('personName') or '').replace('.', '').strip())
i.e. periods are STRIPPED because the engine's player regex forbids them ("K.J. Williams" -> "KJ Williams", "Baker Jr." -> "Baker Jr"). Players are keyed on `bib` (jersey) + `personId`; pid_info maps personId -> (team_idx, bib, name) and the action strings are built as "#{bib} {name}".

### logos

YES, from two places, neither of which the current scraper extracts (it only ever uses names).
1) Game feed (best for a game page): pbp/statistics ['fixture']['competitors'][i] carries — verbatim from the cached capture —
   "logo": "https://images.dc.prod.cloud.atriumsports.com/b1fgf/d75d46d8f9474798b55e76f0efd76c0e?size=400"
   plus "code":"DIJ", "name":"Dijon", "entityId", "isHome", "score", and "colors":{"primary":"892F5C","secondary":"1D2749","tertiary":"6C1D45"}. The ?size=N query param is resizable.
   Player headshots come free on the same CDN: every pbp event and every box row has "personImage": "https://images.dc.prod.cloud.atriumsports.com/b1fgf/69dfdfda9def4670908e467eaedd36be?size=400".
2) Schedule feed (best for a team directory): each getCalendar match's teams[] entry carries external_id plus logo_white and logo_black, each with lg/md/or/sm variants:
   "logo_white":{"lg":"https://assets.altrstat.xyz/images/Basketball/Team/1862/logoWhite/lg.png", ...}
   "logo_black":{"lg":"https://assets.altrstat.xyz/images/Basketball/Team/1862/logoBlack/lg.png", ...}
   and the competition's own crest at .../Competition/317/logoWhite|logoBlack/{lg,md,or,sm}.png, plus colour_primary/colour_secondary hex on the match.

### shots

YES — present in the raw feed, and CURRENTLY DISCARDED by the parser (verified: no x/y/coord reference anywhere in LINEUPDATASCRAPE :22974-23302).
Every pbp event carries "x" and "y" floats (percent-of-court, 0-100). Real shot event from the cached capture:
  {"bib":"1","clock":"PT9M43S","desc":"2 pts Layup","eventSubType":"layup","eventType":"2pt","name":"Justin Bibbins","personId":"0a26b3fe-f5c1-11eb-9523-523277e9c17f","success":true,"successString":"réussi","x":81.56,"y":43.51}
Caveat: non-shot events REPEAT the previous shot's x/y (the foul and the free throw at the same clock in that same game both carry x=81.56,y=43.51), and dead-ball events carry "x":null,"y":null. Filter to eventType in ('2pt','3pt','freeThrow') before trusting a coordinate.

### probe

2 live requests, both 200.
1) curl.exe -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' -H 'Referer: https://lnb.fr/' -H 'Origin: https://lnb.fr' 'https://api-prod.lnb.fr/competition/getDivisionCompetitionByYear?year=2026&division_external_id=1'
   -> STATUS=200, 9267 bytes. Body starts: {"status":true,"message":"Competition fetched","data":[{"id":2196,"competition_id":"3708c3cc-6a4c-11f1-a370-ab91b2a8bca2","external_id":317,"division_external_id":1,"season_id":"4e3b2f66-6a4c-11f1-a5ad-25baed35874f",...,"competition_name":"Betclic ÉLITE","competition_abbrev":"PROA","year":"2026"...  7 competitions returned.
2) curl.exe -X POST -H 'Content-Type: application/json' (+LNB_HEADERS) -d '{"competition_external_id":317,"start_date":"2026-01-07","end_date":"2027-06-30"}' 'https://api-prod.lnb.fr/match/getCalendar'
   -> STATUS=200, 905337 bytes, 42 date groups, 240 matches. First match: {"match_id":"391e04b2-a542-11f1-96cf-5392b5a73941","match_date":"2026-09-25","match_status":"SCHEDULED","external_id":30068,"display_round":"J1","venue_name":"Palais des Sports J.M. Geoffroy (Dijon)"} with teams Dijon (DIJ) vs Le Mans-side entry.
CONCLUSION: the current (2026-27) season is reachable today with the code exactly as written; tip-off of round 1 is 2026-09-25, so as of 2026-09-18 there are no completed games yet this season.

### gotchas

- The 'x'/'y' shot coordinates and every logo/headshot URL are in the feed but the existing parser throws them away — a website ingest must read them off the raw payload itself, not off the scraper's CSV output.
- Sportradar numbers OT periods 11, 12, … — LINEUPDATASCRAPE :23054-23063 renumbers them to 5, 6, … (found on OT game 5b4ff397 whose pbp key is "11").
- Some games misfile the next period's opening events into the previous period's array. Spill detection at :23086-23091 only fires when the clock goes from <=120s remaining back to >=480s remaining; a looser trigger false-fires on late-inserted corrections (game 5b4ff397).
- Substitutions are operator-noisy: batches get pre-logged then re-logged ~60s apart. lnb_match_subs (:22927) pairs in/out only within a 45s window and expires stale entries FIRST, otherwise noise batches become spuriously matchable.
- Minutes are ISO durations ("minutes":"PT23M53S") — lnb_clock_secs (:22920) parses them; DNP players carry None for every stat.
- Offensive fouls pair 1:1 with a separate turnover event: the foul contributes PF only, the paired event carries the TOV.
- foul/drawn events are mirrors and are skipped (:23074); jumpBall/timeOut/period/fixture event types are skipped too.
- The season_id must be threaded from the schedule into the game fetch (match_info['season_id'] -> fetch_lnb_game_page(season_id=...), :27051-27053 / :28877-28879). An empty 's' is accepted by the EUI but the code always passes the competition's season_id.
- Multi-season is supported by the schedule layer (&years=2024,2025) but scrape-now's ACB/BLJ-style single-season wrapper is NOT used here — run_lnb_scraper passes the whole list.
- A scheduled (unplayed) match still returns teams[].score_string == "0"; the completed-games filter relies on status=='COMPLETE' derived from match_status, so don't infer completion from the score.


## LNB Elite 2 (France, division 2)

### host

own API + Sportradar EUI — identical to Elite: api-prod.lnb.fr for the schedule, embed-api.eui.connect.sportradar.com/v1/embed/12 for game data. Same embed unit 12, same headers, same state encoding.

### current_season

Same axis as Elite: season START YEAR, resolved by `today.year if today.month >= 7 else today.year - 1` (LINEUPDATASCRAPE :23337-23340), overridable via `&years=`.
TODAY (2026-09-18) -> year=2026. year=2026 + division_external_id=2 returns 4 competitions: external_id 318 'ÉLITE 2' (season_id 95e6448b-6a4c-11f1-a9a9-4739aa510fe1, 2026-07-01 → 2027-06-30), 324 'Leaders Cup ÉLITE 2' (cfdbc2fd-6a4e-11f1-a57d-4109f837b959), 327 'ÉLITE 2 - Play-In' (d2f1f3ef-6a4f-11f1-86c8-2712042edcc1), 328 'Playoffs Accession Betclic ÉLITE' (1840d103-6a50-11f1-8811-b9faace48135). No 'star game' entries to filter here.

### schedule_recipe

IDENTICAL to Elite except ONE query param — `division_external_id=2` instead of 1 (read from the pseudo-URL's `division=2` at LINEUPDATASCRAPE :23331):
   GET https://api-prod.lnb.fr/competition/getDivisionCompetitionByYear?year={YEAR}&division_external_id=2
   POST https://api-prod.lnb.fr/match/getCalendar  body {"competition_external_id": <external_id>, "start_date": ..., "end_date": ...}
There is NO separate path segment, host or tenant — the competition external_ids returned by the division-2 lookup are simply different numbers.

### game_recipe

Byte-for-byte the same as Elite — the EUI embed unit does NOT change with division:
  state = base64.urlsafe_b64encode(zlib.compress(json.dumps({'s': season_id, 'l': 'fr-FR', 'z': z, 'f': fixture_id}, separators=(',',':')).encode())).decode().rstrip('=')
  GET https://embed-api.eui.connect.sportradar.com/v1/embed/12/fixture_detail?state=<state>&fixtureId=<uuid>   for z in ('pbp','statistics')
  headers = LNB_HEADERS, timeout=40, payload = r.json()['data']
fixture_id comes from https://lnb.fr/fr/match-center/<uuid>. The only thing that distinguishes an Elite 2 game is which season_id it was scheduled under.

### parser_entry

parse_lnb_game_data — LINEUPDATASCRAPE - Copy - Copy.txt:22974-23302 (shared with Elite). Class wrappers _parse_lnb_boxscore :6474 / _parse_lnb_playbyplay :6541. Standalone: validation\lnb\lnb_adapter.py:149 parse_lnb_game.

### names

Identical to Elite — FIRST LAST, Latin with diacritics, from statistics rows' `personName` and pbp `name`, periods stripped and whitespace collapsed at :22999. Cached Elite 2 fixtures sit alongside the Elite ones in validation\lnb\captures\ (the picked list validation\lnb\picked_20260811.txt groups them by season_id: df310a05-… and 5e31a852-51ae-11f0-b5bf-5988dba0fcf9 / 7c996222-51d3-11f0-8fa4-4f95478b1596 are the other competitions' seasons).

### logos

Same as Elite, same CDNs: EUI fixture.competitors[].logo on images.dc.prod.cloud.atriumsports.com/b1fgf/<hash>?size=400 plus colors{primary,secondary,tertiary}; schedule teams[].logo_white/logo_black on https://assets.altrstat.xyz/images/Basketball/Team/<external_id>/logoWhite|logoBlack/{lg,md,or,sm}.png; competition crest at .../Competition/318/logoWhite/lg.png for ÉLITE 2.

### shots

Same as Elite — x/y floats (0-100 court percent) on every pbp event, null on dead-ball events, repeated from the prior shot on non-shot events; not read by the current parser.

### probe

1 live request, 200.
curl.exe -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' -H 'Referer: https://lnb.fr/' -H 'Origin: https://lnb.fr' 'https://api-prod.lnb.fr/competition/getDivisionCompetitionByYear?year=2026&division_external_id=2'
-> STATUS=200, 5360 bytes, {"status":true,...} with 4 competitions: 318 'ÉLITE 2' season_id 95e6448b-6a4c-11f1-a9a9-4739aa510fe1, 324 'Leaders Cup ÉLITE 2', 327 'ÉLITE 2 - Play-In', 328 'Playoffs Accession Betclic ÉLITE'. Current season resolves today.
(I did not spend a second probe on the Elite 2 getCalendar — it is the same endpoint and body shape already proven for competition 317.)

### gotchas

- The ONLY difference from Elite is `division_external_id=2` (surfaced as `division=2` in the internal pseudo-URL). Same host, same embed unit 12, same parser, same headers — do not build a second adapter.
- Competition code in the pipeline is LNB_ELITE2, so its output folder/pool is kept separate from LNB_ELITE even though the code is shared.
- All the Elite gotchas apply unchanged: OT periods keyed 11/12 renumbered to 5/6, period spill detection, 45s sub-pairing window, ISO 'PT16M47S' minutes, None stats for DNPs, offensive-foul/turnover pairing, foul 'drawn' mirrors skipped.
- Competition 328 is named 'Playoffs Accession Betclic ÉLITE' but is returned by the DIVISION 2 lookup — it is the Elite 2 promotion playoff, not an Elite competition. Attribute it to LNB_ELITE2.


## Japan B.LEAGUE B1 (Premier)

### host

own API — bleague.jp serves BOTH halves to plain `requests` (no Selenium, no auth): its own JSON pagination mode for the schedule, and a cached Genius Sports feed embedded in the game page as `_contexts_s3id.data = {...};`. NOT fibalivestats.dcd.shared.geniussports.com and NOT hosted.wh.geniussports.com.

### current_season

Season axis = `?year=` on bleague.jp, which is the season START YEAR (an integer, no token/uuid). Two places resolve it:
• scrape-now.py:2702-2714 — `_season_start_year(tok)` accepts '2026', '2026/27' or '2026-27' and returns 2026, then `blj_url = re.sub(r'year=\d+', f'year={year}', BLEAGUE_SCHEDULE_URL)`.
• LINEUPDATASCRAPE :25968-25972 — if `year` is absent from the URL: `year = str(now.year if now.month >= 7 else now.year - 1)`.

TODAY (2026-09-18) the CURRENT season is year=2026 (the 2026-27 season), and it is live (probe below).

*** REAL GOTCHA: the default constant is STALE. scrape-now.py:103 hardcodes
    BLEAGUE_SCHEDULE_URL = "https://www.bleague.jp/schedule/?year=2025&mon=all&day=&event=&club=&tab=1&ha=&fb="
Because `year=2025` is non-empty, the fetcher's month>=7 fallback NEVER fires, so a bare `--competition BLJ` with no --seasons scrapes 2025-26, not the current 2026-27 season. An ingest must pass the season explicitly (or drop the year from the seed URL to let the fallback resolve it). ***

### schedule_recipe

Verbatim from LINEUPDATASCRAPE :25942-26046.

HEADERS (:25987-25990):
  {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
   'X-Requested-With': 'XMLHttpRequest'}

Paginated GET, looped until `index` is falsy (:26004-26027):
  https://www.bleague.jp/schedule/?data_format=json&year={Y}&mon=all&day=&event={E}&club=&tab=1&ha=&fb=&index={N}
  response = {"topics": [<li> HTML fragment per game], "broadcasts": [...], "index": <next offset or ''>}
  time.sleep(0.3) between pages.

event codes (:25981-25985): an EMPTY `event=` in the seed URL is expanded to BOTH ['2','3'] — 2 = regular season, 3 = Championship — and results are DEDUPED on ScheduleKey across the two sweeps. `mon` empty is coerced to 'all'. `tab`, `club`, `day` are read from the seed URL (tab defaults to '1').

Each topics entry is parsed by _parse_bleague_schedule_card (:25899-25940): <li class="list-item" id="{ScheduleKey}">, .team.home/.away .team-name (short Japanese display names), .home-score/.away-score, .info-scorestate contains 'FINAL' when played. It yields:
  match_id  = ScheduleKey
  match_url = f"https://www.bleague.jp/game_detail/?ScheduleKey={key}&tab=1"
  status    = 'COMPLETE' if 'FINAL' in scorestate.upper() else 'SCHEDULED'
  game_date = ''  (deliberately empty — Game.GameDateTime on the game page is authoritative)
  is_bleague= True
Parsed matches are stashed on driver._bleague_parsed_games and re-read at :28664-28667.

### game_recipe

One GET per game (LINEUPDATASCRAPE :26049-26098), plain requests, 3 attempts with backoff `time.sleep(2 + attempt*2)`:

  GET https://www.bleague.jp/game_detail/?ScheduleKey={ScheduleKey}&tab=1
  headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'}
  resp.encoding = 'utf-8'
  m = re.search(r'_contexts_s3id\.data\s*=\s*(\{.*?\});?\s*$', resp.text, re.M)
  blob = json.loads(m.group(1))

The single blob carries BOTH boxscore and play-by-play, so the same string is returned for both slots, wrapped as
  '<!-- BLEAGUE_JSON -->' + json_str + '<!-- /BLEAGUE_JSON -->'
followed by a polite time.sleep(random.uniform(0.4, 0.9)).

Blob containers (confirmed on the live page today and in the captures): 'Game', 'PlayByPlays', 'HomeBoxscores', 'AwayBoxscores', 'Summaries', 'Leaders', 'Points', 'ScheduleKey', 'Year', 'Event', 'GameDateTime'. ('Leaders' and 'Points' were null on the games inspected.)

### parser_entry

Two methods on BasketballParser in LINEUPDATASCRAPE - Copy - Copy.txt:
• parse_boxscore_bleague — :14919-15081. Player game-total rows are the ones with Category == 1 and PeriodCategory == 18 (1-4 = quarters, 15/16 = halves; Category 2/3 = team rows). There is NO FGM/FGA field: FG = PT2M+PT3M / PT2A+PT3A. It builds self._bleague_names {PlayerID -> (jersey, canonical_name, team_idx)} and self._bleague_tid_to_idx {TeamID -> team_idx}, both consumed by the PBP parser.
• parse_playbyplay_bleague — :15082-15266. Maps ActionCD1 through BLEAGUE_ACTIONCD1_MAP (:14817-14852).
Shared helpers: _extract_bleague_blob :14896, _detect_bleague_format :14887, _bleague_clean_name :14870.

### names

BOTH scripts are available, but only from the box score — the PBP is Japanese-only.
• Boxscore rows (HomeBoxscores/AwayBoxscores) carry BOTH: "PlayerNameE": "Ryo Terashima" / "PlayerNameJ": "寺嶋 良"; "PlayerNameE": "Tatsuya Ito" / "PlayerNameJ": "伊藤 達哉"; "PlayerNameE": "Masato Ichikawa" / "PlayerNameJ": "市川 真人"; "PlayerNameE": "Hamiltongary Kotera" / "PlayerNameJ": "小寺 ハミルトンゲイリー".
• PlayByPlays rows carry ONLY "PlayerNameJ1", and it is a DIFFERENT (surname-only) rendering than the box: e.g. "PlayerNameJ1": "寺嶋 良" with "PlayText": "#0 寺嶋 プレイヤーイン", and "PlayerNameJ1": "エバンス ドウェイン" (Dwayne Evans, katakana, surname first).
The existing fix (documented at :14924-14928): everything is keyed on PlayerID and the canonical form is the Latin `PlayerNameE` with `PlayerNameJ` only as a fallback — `p_name = (r.get('PlayerNameE') or '').strip() or (r.get('PlayerNameJ') or '').strip()` (:14976-14978), then _bleague_clean_name (:14870-14885) strips characters outside [\w\s'\-À-ɏͰ-ϿЀ-ӿ] and collapses whitespace so "D.J. Newbill" becomes "DJ Newbill" (periods would break the engine's #-number regex and silently drop ALL of that player's events, corrupting lineups). Team names come from Game.HomeTeamNameE/AwayTeamNameE ("HIROSHIMA DRAGONFLIES", "KOSHIGAYA ALPHAS") with HomeTeamNameJ/AwayTeamNameJ ("広島ドラゴンフライズ", "越谷アルファーズ") as fallback; Short variants also exist (HomeTeamShortNameJ/E).

### logos

YES — team crests are in the SCHEDULE card HTML (not the game blob), and the existing card parser throws them away (it only reads .team-name). Real markup from today's probe:
  <span class="team-logo"><img src="/files/user/common/img/logo/2026/s/at.png" alt="A東京"></span>
  <span class="team-logo"><img src="/files/user/common/img/logo/2026/s/rg.png" alt="琉球"></span>
So the pattern is https://www.bleague.jp/files/user/common/img/logo/{season_year}/{size}/{team_code}.png — season-year-scoped, with a short team code (at = Alvark Tokyo, rg = Ryukyu) and a size segment ('s' on the schedule cards). Adding `img[src]` + `alt` to _parse_bleague_schedule_card is a two-line change; the game blob itself has NO logo field (Game keys are Code/ScheduleKey/…/HomeTeamNameJ/E/ShortName/Score01-04, no image).

### shots

YES — present in the raw feed, and CURRENTLY DISCARDED (verified: no X/Y/AreaCD reference anywhere in :15082-15266).
On the cached game 505253, 197 of 810 PlayByPlays rows carry "X", "Y" and "AreaCD". Real shot row:
  {"Period":1,"TeamID":"721","PlayerID1":"30396","PlayerNo1":"34","PlayerNameJ1":"三谷 桂司朗","RestTime":"9:42","ActionCD1":2,"ActionCD2":27,"ActionCD3":null,"X":73.81999969482422,"Y":78.63999938964844,"AreaCD":11,"Success":0,"Side":"right","PlayText":"#34 三谷 3Pシュート×  ジャンプショット "}
AreaCD is a court-zone id that comes free alongside the raw X/Y, and the box rows already carry PT2IN (points in the paint) if a zone cross-check is wanted.

### probe

2 live requests, both 200.
1) curl.exe -H 'User-Agent: Mozilla/5.0 … Chrome/126.0.0.0 Safari/537.36' -H 'X-Requested-With: XMLHttpRequest' 'https://www.bleague.jp/schedule/?data_format=json&year=2026&mon=all&day=&event=2&club=&tab=1&ha=&fb=&index=0'
   -> STATUS=200, 122586 bytes. JSON keys ['topics','broadcasts','index']; 20 topics; "index": 20 (i.e. pagination continues exactly as the loop expects). First card: <span class="title">2026.09.22(火) </span> … <li class="list-item" id="506381"> … href="/game_detail/?ScheduleKey=506381&tab=1" … A東京 vs 琉球. So the CURRENT (2026-27) season resolves today; round 1 tips 2026-09-22, i.e. no completed games yet as of 2026-09-18.
2) curl.exe -H '<same UA>' 'https://www.bleague.jp/game_detail/?ScheduleKey=505253&tab=1'
   -> STATUS=200, 942609 bytes; the `_contexts_s3id.data` regex still matches; blob parsed to HIROSHIMA DRAGONFLIES 92 - 89 KOSHIGAYA ALPHAS, 810 PlayByPlays rows, Game.Year=2025. Game-page recipe still works unchanged.

### gotchas

- MADE/MISSED IS IN ActionCD1 ITSELF, not in `Success` (which is redundant): 1=3P made, 2=3P missed, 3=2P made outside paint, 4=2P made inside paint, 5=2P missed outside paint, 6=2P missed inside paint, 7=FT made, 8=FT missed. Full map at :14817-14852.
- `Side` ('left'/'right') FLIPS AT HALFTIME — never use it for team attribution. Use `HomeAway` (1=home, 2=away) with `TeamID` -> _bleague_tid_to_idx as fallback (:15134-15142).
- PlayByPlays is chronological but `No` is NOT monotonic, and late corrections get APPENDED with early-game periods/clocks (seen on 505235 and 505253). The parser stable-sorts by (Period, -RestTime_seconds) at :15118-15128 — do the same or the lineups corrupt.
- `RestTime` is time REMAINING as "M:SS" with no leading zero ("9:42"). PlayTime in the box is "MM:SS" or the literal string "DNP".
- FT trips are NOT numbered in the feed — "n of m" is synthesized by grouping FT events on (shooter, period, RestTime). Consecutive-run scanning is unsafe because assists and subs interleave between FTs of a trip (:15102-15104).
- Offensive foul arrives as ActionCD1=23 TOGETHER with a separate explicit turnover ActionCD1=13 for the same player at the same clock — emit the foul (PF+TOV) and SUPPRESS the paired 13, or turnovers double-count.
- Skipped codes that carry no player stat: 15 (foul drawn mirror), 16 (and-one marker), 17 (team turnover), 18/19 (team rebounds), 80-85/88 (game/period/clock/timeout noise).
- Starter announcements are ActionCD1=86 player-ins at P1 10:00 with Score=None — skipped; starters come from the box score's StartingFlg==1.
- Fast breaks are EXPLICIT: ActionCD2 or ActionCD3 in (35, 38) (35=fast break, 38=fast break off turnover). The engine's 8-second heuristic is bypassed for B.LEAGUE via the ACB-style override at :16070-16077. Second-chance (37) and points-off-TO (36/48) qualifiers also exist but have no override hook.
- ActionCD2 shot subtypes are only 27=jump shot (neither RIM nor OTD), 28=layup (RIM), 29=dunk (RIM) — coarser than LNB's taxonomy.
- Game date comes from Game.GameDateTime, a UNIX EPOCH STRING (e.g. "1772859900"), converted at :14939-14944. The schedule card deliberately leaves game_date empty.
- The seed constant scrape-now.py:103 is pinned to year=2025 — see current_season. Also `tab=1` is the B1 tab; nothing in the codebase scrapes B2, and event codes beyond 2/3 are not enumerated.
- Game page is ~940 KB of HTML for one game; the blob regex is anchored with re.M and `\s*$`, so the assignment must be the last thing on its line.

## Finland: Korisliiga, Naisten Korisliiga, I divisioona A and B (basket.fi)

Added 2026-09-24. Adapter `scripts/ingest/adapters/basketfi.py`, test `scripts/ingest/basketfi_test.py`,
source codes KORIS, KORISW, FIN1A, FIN1B (a regular-season row and a play-off row each).

### host

TorneoPal (the federation's result service, tulospalvelu.basket.fi) for the schedule and the official
results; Sportradar EUI website 322 (the widget every match page embeds) for the box score and the
play-by-play. The game side is LnbAdapter's, unchanged.

### current_season

TorneoPal's `competition_id` is the season's top series, "huki" + the two years: 2026-27 = huki2627,
2025-26 = huki2526. Derived from the platform's season name (the July cut-over when none is set). A
league is a category within it: 4 Korisliiga, 1 Naisten Korisliiga, 2 Miesten I divisioona A,
29461 Miesten I divisioona B. The same category ids held in 2025-26.

### schedule_recipe

    GET https://koripallo-api.torneopal.net/taso/rest/getMatches?competition_id=huki2627&category_id=4
        headers: Accept: json/df8e84j9xtdz269euy3h, Origin/Referer https://tulospalvelu.basket.fi
    GET https://embed-api.eui.connect.sportradar.com/v1/embed/322/fixtures?state=<{"l":"en-EN","s":<season>,"z":"RESULTS"|"FIXTURES"}>
        the same season in the EUI's words, for club codes and each fixture's status

A category's `category_external_id` IS the EUI season id; a match's `match_external_id` IS the EUI
fixture id. Games are keyed `<season>_<fixture>`, as LNB's are. Stages come from `group_type`:
knockout_* = play-offs, group_stage and additional_group_stage (Korisliiga's upper/lower
jatkosarja) = regular season. A `match_type` "series" row is a play-off series' summary, not a game.
Tip-offs are local date + time + the match's own `time_zone_offset` ("+0200" in lists, "+03:00" in
one match).

### game_recipe

LnbAdapter.fetch with website 322 and locale en-EN (fi-FI answers 500): `fixture_detail` twice,
`z` = pbp and statistics, `f` = the fixture, `s` = the category's season id.

### parser_entry

`BasketFiAdapter` (adapters/basketfi.py) over `LnbAdapter`: discovery is new, the game is inherited.

### names

The two systems name clubs identically (every linked fixture of all four leagues in 2026-27 checked,
none differs), so the TorneoPal names stand. Players come from the EUI box ("Daniel Dolenc").

### logos

TorneoPal's club crest, `club_A_crest` / `club_B_crest` (https://cdn.torneopal.net/logo/koripallo/<club id>x.png).

### shots

The EUI's x/y on every shot, as for LNB.

### probe

Discovery for all four leagues on 2026-09-24: Korisliiga 204 fixtures from 29 Sep (12 clubs x 34),
Naisten Korisliiga 108 from 2 Oct, I divisioona A 132 from 8 Oct, I divisioona B 110 from 9 Oct; every
one of them joined to a stats fixture.

### gotchas

- TorneoPal leaves `match_external_id` blank on some fixtures (18 of Naisten Korisliiga's 108, 15 of
  I divisioona A's 132 in 2026-27) though the EUI has them all. They are joined on the two clubs and the
  local date; a moved game only when exactly one partner is within 21 days.
- The official result is TorneoPal's. Leppävaaran Pyrintö v Puhuttaret (women's pre-season, 4 Sep 2026)
  is 64-63 after overtime there, and the EUI stops at 63-63 with no overtime in it. A game the two
  disagree on is held (fetch returns nothing and says so) rather than filed as a draw.
- EUI codes are believed only when they abbreviate the club (Kouvottaret is "SAL", ACO Basket "OUL",
  Korihait "UKI"), and a code two clubs of one league share is dropped (Espoo Basket Team's first and
  second teams are both "EBT" in the women's pre-season). A code becomes a club's short name and its key.
- The pre-season ("Valmistavat ottelut", categories 39227 and 42825) is not published: the league
  pages' whole-season numbers take every competition, friendlies included. Six of its games are the
  test's vetting set, one of them a player with six fouls, which the translator files as the bench's
  after his fifth as it does everywhere.
