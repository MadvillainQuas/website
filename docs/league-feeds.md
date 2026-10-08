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


## FIBA's own competitions (Basketball Champions League, FIBA Europe Cup, any FIBA event)

### host

FIBA's one Next.js site for everything it organises: www.fiba.basketball/en/events/<event-slug>/... and, for a competition with its own domain, that domain (www.championsleague.basketball/en/...). Games are scored on FIBA LiveStats ("statisticSystem": "FLS") but no LiveStats id is ever published, so the Genius data.json is out of reach - the site's own data is used instead. Adapter `fiba_events` (scripts/ingest/adapters/fiba_events.py), format module scripts/ingest/fiba_format.py. A desktop browser User-Agent is required.

### current_season

In the event slug, start and end year: fiba-europe-cup-26-27 (config: `{season}` in the URL). The competition object's `season` is the END year (2027 for 2026-27). championsleague.basketball/en/games shows its season being played only; a past BCL season is fiba.basketball/en/events/basketball-champions-league-25-26/games, which 308s to /en/history/112-fiba-mens-european-club-competitions-tier-1/208962/games (adapter_config.season_url, read only when a season is asked for).

### schedule_recipe

One GET of the competition's /games page = every fixture of every round (2026-27: BCL 136, Europe Cup 308), in the page's flight data (`self.__next_f.push([1,"..."])` chunks; adapters/fiba_events.rsc_text + schedule_games). Later-round fixtures exist with teamA null and a 0001-01-01 date until their clubs are known; the day picker is a client-side filter over the list. Round, group (groupPairingCode), game system, venue, UTC tip-off (gameDateTimeUTC, unmarked) and both clubs' organisationId/code are on each fixture.

### game_recipe

GET https://www.fiba.basketball/en/events/api/game-live-info/<gameId>/detail (any FIBA event; cached 20 s): game.content = the box score and scoreboard, periodActions.content = the play-by-play by period, gameCompetitors = the rosters. The ONLY source while a game is live: the game page then carries the scoreboard only. A game the live cache has let go (weeks old) answers {"game":{}}, and its page is read instead: <games url>/<gameId>-<codeA>-<codeB> - any other form 308s, and on www.fiba.basketball the Location header is the target twice, comma-joined (follow by hand, take the first). A finished game's page holds everything (clicking the tabs fetches nothing).

### parser_entry

FibaEventsAdapter.payload() translates either source (props_from_detail / game_props) into a FIBA LiveStats data.json: tm[1|2] with pl keyed by personId, the play-by-play as the event stream stints.py replays (actionNumber 1..n, gt = "Time", remaining), shots onto tm[].shot joined by actionNumber, clock/period/periodType on top. PBP codes: P2/P3/FT shots, REB/TREB, TO/TTO, FOUL/CFOUL, RFOUL (foul drawn -> foulon), ASS, ST, BS, SUBST (in IN/OUT), STARTG/STARTP/ENDP/ENDG; TIMO/JB/JS/VTR dropped. A shot's kind is the last clause of its text ("..., driving layup made"), its qualifiers in the text ("points from fastbreak", "points from second chance", "after turnover").

### names

FIBA's shortName ("Asisa Joventut", "SL Benfica", "Surne Bilbao"), never officialName - that is the registered company ("Club Joventut Badalona SAD", "Sport Lisboa e Benfica", "C.D. Basket Bilbao Berri S.A.D.") and the live-info feed carries only the short one. Players: firstName / lastName as written (names.py decides the rest).

### logos

https://assets.fiba.basketball/image/upload/d_.logoflag--light--organisation_{organisationId}.webp/w_256/f_auto/q_auto/.logoflag--light--organisation_{organisationId}--competition_{competitionId} - on every fixture through home_logo/away_logo.

### shots

Half court: x 0..280 across (15 m), y out from the baseline, rim at (140, 29.4); free throws at (0, 0). Fitted 2026-10-07 to the three-point line (every three at 6.96 m or more, every two at 6.10 m or less). fibashape.at_rim_offset puts them on the full-court frame.

### probe

~/.claude/skills/fiba-feed/scripts/fiba_probe.py schedule|format|game|live|capture (the fiba-feed skill). Dry run: python scripts/ingest/run_ingest.py --source BCL,FEC --dry-run --no-supabase --max-games 2. Offline test: python scripts/ingest/fiba_events_test.py (CI guard.yml).

### format

The /standings page is the competition's structure: stages of three kinds (groups, flat = one round of pairings, bracket = rounds feeding each other + a 3rd-place smallFinalRound), each with roundIds, dates, status, groups (teamFroms: "1st of group A"), pairings (gameSystemCode S / HA / BOF3). fiba_format.stage_sources makes one source per stage that has a fixture with both clubs (the main group phase under the league's own label, the rest under FIBA's stage names, 'groups' or 'knockout'); sync_stage writes competitions.qualifiers (inferred from the later stages' feeders - FIBA leaves numberOfTeamsQualifying empty), competitions.format_config.fiba, and for a knockout stage its bracket_ties (legs and decider from the game system) with every game on its tie and leg.

### gotchas

- "Winner of Game N" is NOT the fixture's gameNumber ("A".."C" in knockouts). On the Europe Cup N is the pairing code; on the BCL it is an unrelated running count (157/158 for pairings 37/38). fiba_format._resolve_feeders matches codes first, then pairs off in order with the round before.
- Statuses: live-info game.content.status 3 = live, 5 = over; the page's copy says 999; CurrentPeriodStatus "E" = period ended. Over is the ENDG action first.
- Bench points are A_PFB on the page and only T_PFB on the live-info feed; team REB/OR/DR/TO include the team ones (as LiveStats' totals do).
- A history page's standings carry no stages: a backfilled past season is ingested as one competition.
- The pages are CDN-cached 240 s, the live-info JSON 20 s.


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

## Balkans: ABA League, ABA League 2, ABA U19 League (aba-liga.com)

Added 2026-09-24. Adapter `scripts/ingest/adapters/aba.py`, test `scripts/ingest/aba_test.py`, source
codes ABA, ABA2, ABAU19 (a regular-season row and a play-off row each). Filed under the region code XB,
"Balkans" (ISO's user-assigned range; epinoia/country.js REGIONS), drawn as an outline of the former
Yugoslavia in epinoia/brand/flags/xb.svg rather than a flag.

### host

The league's own server-rendered site. One site, three leagues, told apart by a league number and a host:
1 ABA on www.aba-liga.com, 2 ABA 2 on druga.aba-liga.com, 7 the U19 on www (calendar-u19).

### current_season

The site's season number is the start year less 2000 (2026-27 = 26), derived from the platform's season
name. `adapter_config.aba_season` overrides it.

### schedule_recipe

    GET https://www.aba-liga.com/calendar/26/1/          (ABA)
    GET https://druga.aba-liga.com/calendar/26/2/        (ABA 2)
    GET https://www.aba-liga.com/calendar-u19/26/7/      (U19)

One page per league-season: a panel per round heading, a row per game (clubs, phone codes, score, date
and time, group). Games are keyed `<league>-<season>-<game id>`. Play-offs are the headings that say so
(play-in, quarter, semi, final, classification, place); "Top8 - R1" and "Play-out - R1" (ABA 2025-26's
second phase) are regular season. Groups ride on regular-season games only (`groups_from_feed`).

### game_recipe

    GET https://<host>/match/<id>/<season>/<league>/                     every tab at once
    GET https://<host>/live-match/rezultati-1718/create_shooting_chart.php?id=&sez=&lea=
    GET https://<host>/player/<id>/<season>/<league>/<slug>/              only for a name nobody printed

### parser_entry

`AbaAdapter` (adapters/aba.py) builds FIBA's data.json shape from the page and hands it to
`FibaLiveStatsAdapter.bundle_from_raw`. The play-by-play is FIBA LiveStats written out in English
("made 2 points (drivinglayup)"), newest first, clock = time remaining, home left and away right.

### names

Clubs: the calendar's (the sponsor's form, "Igokea m:tel"), coded with the calendar's phone column.
Players: keyed by the site's player id. The box prints "Jovanović Đ.", so the full name comes from the
shot feed's `player_name`, the leader tables ("Sulaimon Rasheed"), or the player's own page (its h1),
read once a process and at most 8 a game. The family name is always the box's own.

### logos

https://www.aba-liga.com/images/club/150x150/<club id>.png, the club id from the site's club menu, joined
on the name (or on initials: "GGD Šenčur" is "Gorenjska gradbena družba Šenčur"). The menu lists the
current season's clubs, so a past season's departed club has no crest in discovery; its games carry one.

### shots

The chart feed: x/y in percent of the full court, `ekipa` 1/2, made, `player_id`. No clock and no type,
so each is joined to the play-by-play's shots of the same player and result, preferring the type its
distance says (beyond 6.75 m a three).

### probe

2026-09-24: ABA 2026-27 180 fixtures from 25 Sep (two groups of ten, 20 clubs x 18), 136 of them dated
with no time yet (TBC); ABA 2 50 fixtures published (16 clubs, groups A-D); U19 2026-27 not published.
ABA 2025-26 226 regular + 22 play-off games; U19 2025-26 24 + 12.

### gotchas

- Times: ABA prints "CET", the others "Local time"; all are Europe/Belgrade (Dubai's games are printed
  on the league's clock). A date with no time is noon UTC with `time_tbc`.
- The server HTML single-quotes the box score's links (a browser-saved page double-quotes them): every
  pattern accepts either.
- The chart's player lists are filled by JavaScript: empty in the server HTML.
- The shot chart over-counts: a shot with player_id 0, or one more for a player than his box has. Those
  are left out; the box and the play-by-play agree exactly.
- A bare "(defensive)" / "(offensive)" line is the club's rebound; a bare other bracket ("(outofbounds)")
  its turnover. "turnover (offensive)" on a player is an offensive foul.

## Denmark: Basketligaen and Kvinde Basketligaen

Added 2026-09-27. Test `scripts/ingest/dbl_test.py` (35 checks). Both are FIBA LiveStats; the games are the
ordinary data.json path (box, play-by-play, shots, stints). Source codes DBL (a regular-season row and a
play-off row) and KBL. League slugs `basketligaen` and `kvinde-basketligaen`, country DK (`brand/flags/dk.svg`).

### basketligaen (men) - basketligaen.dk

A Sportality single-page app in front of a JSON API; the site's robots.txt publishes no rules (every path
answers with the app). Genius's hosted schedule for the league's client, DBBF, is EMPTY, and the site links a
game to LiveStats ("Tag mig derhen" on the game centre) only once the operator opens it, but **the API names
the LiveStats game id of every game from the day the schedule exists**, so there is nothing to wait for and no
game centre to refresh: `gameInfo.extId` of `/api/sports-v2/game-info/<gameUuid>` (all 132 games of 2026-27, all
different; on the saved post-game page the webcast link `webcast/DBBF/2868197` is the id the API gave for that
game). Adapter: `adapters/fiba_site_schedule.py`, site `basketligaen`.

    GET /api/sports-v2/season-series-game-types-filter     seasons (code 2026 = 2026/2027), series (DBL), game types (regular = Grundspil)
    GET /api/sports-v2/game-schedule?seasonUuid=&seriesUuid=&gameTypeUuid=&completeSeason=all&homeAway=all&allGames=all
                                                            uuid, rawStartDateTime (UTC), state pre-game / post-game, both clubs (code, names, icon), venue
    GET /api/sports-v2/game-info/<gameUuid>                gameInfo.extId = the LiveStats id, arenaName

- A fixture is keyed on its LiveStats id, so the game keeps one identity from the first sighting to the final.
- The id is asked for once per game (the schedule list does not carry it) and kept in
  `data/feed/DBL/idmap.json` (committed with the 132 already read), so a pass after the first is one request.
- Not yet scored, `data.json` answers 403 and the fetch returns None: the next poll asks again. The live lane
  covers it (a `FibaLiveStatsAdapter` subclass).
- The feed's club codes are typed by an operator per game ("Hol" here, "HOL" on the site); the fetch replaces
  them (and the name) with the site's, so one club is never filed under two codes.
- The play-off source finds nothing until the site lists a game type that is not `regular` in the filter. Check
  the filter when the play-offs are near: if the type appears under another key the read has to follow.
- Series 2025-26 and earlier are on the site under their own season uuids; only the current season is read
  unless `adapter_config.season` says otherwise.

### kvinde-basketligaen (women) - kvindebasketligaen.dk

A WordPress site embedding Genius's hosted widget (`?WHurl=/competition/49175/...`), on Genius tenant **DAM**.
The hosted schedule is server-rendered: `https://hosted.wh.geniussports.com/DAM/en/schedule` lists the current
competition (63 games in 2026-27), each block's id (`extfix_<id>`) is the LiveStats id and its time is
Copenhagen time. The same path as SLB and WBBL: source `KBL`, adapter `fiba_livestats`, `client_code DAM`,
`timezone Europe/Copenhagen`, `client_is_league` (the tenant hosts nothing but this league; its archive is
"Dameligaen 2009/2010 ...") and `sync_clubs`.

- Feed codes differ from the schedule's ("Sko" v "Sir" for Skovbakken Sirens); clubs match on the name.
- One hosted request straight after another once answered with an empty page in a dry run; the next pass read
  it (the run only reports a pass with no games, and the following pass fills it in).

### gotchas

- Times: the men's API is UTC already; the women's hosted page is Copenhagen time (CEST/CET), converted.
- `DBBF` is the men's LiveStats client, `DAM` the women's. Only `DAM` is in `epinoia/livestats-clients.json`, which
  serves `fiba_livestats` sources; a game fed through `fiba_site_schedule` (the men's, like Kosovo's) has no
  LiveStats link on its game page.

## Romania: Liga Nationala de Baschet Masculin (LNBM)

Added 2026-10-07. Test `scripts/ingest/romania_test.py` (in guard). Source `LNBM`, adapter `fiba_livestats`,
`client_code FRB`, `timezone Europe/Bucharest`; league slug `lnbm`, country RO (`brand/flags/ro.svg`). The games
are the ordinary data.json path (box, play-by-play, shots, stints).

- **The federation's site is not the source.** frbaschet.ro draws its schedule and game centre with BasketHotel
  widgets (`widgets.baskethotel.com/widget-service/show`, league 25493, season 133412). Their game ids (6189488)
  are not LiveStats ids, there is no fixed offset between the two, and no widget names a LiveStats id (the game
  widget 400 has none; the live-stream widget 405 answers "Widget is empty").
- **Genius's hosted page of the season's competition is.** `https://hosted.wh.geniussports.com/FRB/en/competition/50100/schedule?roundNumber=-1&`
  lists all 182 games of 2026-27 with their LiveStats ids (`extfix_<id>`), clubs, codes, crests and Bucharest
  times. Not yet played, a game's `data.json` answers 403 and the fetch returns None; the live lane covers it.
- **The competition is pinned, and must be changed each season.** The client's landing page lists only 2016's
  league (competition 11929), its bare `/FRB/en/schedule` shows that 2016 season, and its competition picker
  calls this season's competition "English" — so the per-competition expansion would find nothing for the
  season. The row names the competition outright (a `/competition/` URL is never expanded). **For 2027-28:** open
  any LNBM game's LiveStats page (`fibalivestats.dcd.shared.geniussports.com/u/FRB/<gameId>/`): its `<body>` class
  carries `page_comp_id_<N>`; put N in the row's URL. The picker on the old competition's page may also list it.
- FRB's hosted template prints the home club's code bare (`<span class="team-name-full">…</span>VAL</span>`).
  `FibaLiveStatsAdapter.parse_schedule` now reads each side inside its own `home-team` / `away-team` div; before,
  the home club took the away club's code and score and every away club was read as nobody. Every other saved
  hosted page parses identically (30 games across SLB, DAM, CIBA, Albania).
- No `sync_clubs`: it keys clubs on the hosted `/team/<id>` links and FRB's schedule links none (`<a href="">`).
  The schedule's own codes and crests make each club before its first game.
- Play-offs: not yet seen. Check the hosted page near the end of the regular season (a new competition, or phases
  of 50100) and add a play-off row if needed.

### Liga Nationala de Baschet Feminin (LNBF)

Added 2026-10-08, the same way as LNBM. Source `LNBF`, `client_code FRB`, `timezone Europe/Bucharest`, slug `lnbf`,
country RO, `league_gender women`. On frbaschet.ro it is BasketHotel league 25503, season 133419 (ids 61908xx); its
games are Genius competition **50109** ("LNBF BT" on each game's LiveStats page, "English" in the client's picker):
`https://hosted.wh.geniussports.com/FRB/en/competition/50109/schedule?roundNumber=-1&`, 90 games of 2026-27 between
10 clubs, LiveStats ids 2913067-2913172. Pinned like the men's, so it changes each season the same way (read
`page_comp_id_<N>` off any LNBF game's LiveStats page). Checked: the 4 finished games of the first round
reconcile (box = stints = the schedule's score, 200 minutes a side). 127-13 (Targoviste v Politehnica Timisoara,
3 Oct) is the feed's real result, on the hosted schedule as well.

## North Macedonia: Macedonian Super League (MSL, "МТЕЛ Супер Лига")

Added 2026-10-08. Test `scripts/ingest/macedonia_test.py` (in guard). Source `MSL`, adapter `fiba_livestats`,
`client_code MSL`, `timezone Europe/Skopje`; league slug `macedonian-super-league`, country MK
(`brand/flags/mk.svg`). The games are the ordinary data.json path (box, play-by-play, shots, stints).

- **The federation's site** (man.mkd.basketball, "Резултати и Табела") lists the season in pages of 45 and links
  every game to its LiveStats webcast (`fibalivestats.dcd.shared.geniussports.com/webcast/MSL/<id>/`). Its pages need
  no walking: **Genius's hosted page of the season's competition** lists all 90 games of 2026-27 (10 clubs, double
  round robin, 2 Oct 2026 - 6 Mar 2027, LiveStats ids 2923476-2923646) on one page:
  `https://hosted.wh.geniussports.com/MSL/en/competition/50171/schedule?roundNumber=-1&`. Every id on the site's
  first page is on it.
- **Pinned, and changed each season**, as Romania's: the client's picker calls this season's competition "English"
  (beside the old "Prva Liga Mazi" 4454 and "Kup na Makedonija" 8032). **For 2027-28:** open any game's LiveStats
  page (`/u/MSL/<gameId>/`) and read `page_comp_id_<N>` off its `<body>` class.
- **No club codes on the hosted page** (as SLB's). `sync_clubs` is on: it reads one LiveStats preview page per club
  and makes each club under the code the game feed uses (STP, KOZ, MKK, MZT, PEL, RAB, SKP, STR, TFT, TIK) with its
  crest, so a fixture and its box score land on the same club. Dry run: 10 clubs, 10 with a feed code.
- Checked: the 3 finished games of round 1 (MZT 85-77 Kumanovo, Stip 65-93 Tikves, Strumica 85-92 Rabotnicki)
  reconcile - box points = the feed's team points = the schedule's score, 200 minutes and 5 starters a side,
  stints covering 40 minutes.
- Play-offs: not yet seen. Check the hosted page near the end of the regular season (March) and add a play-off row
  if they are a separate competition. The cup ("Kup na Makedonija") is not added.

## Israel: Winner League (basket.co.il + Segev Stats)

Added 2026-10-08. Adapter `ibsl` (`scripts/ingest/adapters/ibsl.py`, its docstring has the detail), test
`scripts/ingest/ibsl_test.py` (in guard). Source `IBSL`, three rows: the regular season, the play-offs
(`competition_kind playoff`) and the Winner Cup (`cup`); league slug `winner-league`, country IL (`brand/flags/il.svg`).
Not FIBA LiveStats: the league's stats are kept by **Segev Stats**, which basket.co.il's own LIVESTATS page reads.

- **Schedule:** `basket.co.il/ws/ws.asmx/Games?...&cYear=Y` (JSON, every competition of a season; cYear = the season's END
  year, 2026-27 is 2027). Each game: basket.co.il's game id (the key; `game-zone.asp?GameId=`), date + time in Israel
  time, both clubs (team1 home), the score once played, the board (5 Winner League, 16/26/17 its quarter-finals,
  semi-finals and final series, 10 Winner Cup, 34 Supercup) and **ExternalID = the Segev game id**, "0" until assigned
  (21 of the 182 league games of 2026-27 had one on 8 Oct 2026). Rows pick boards by name (`stage` regular / playoffs /
  cup, or `board_match`). The Supercup is not added (Segev has no 2025 Supercup: "game not found").
- **Clubs:** `ws.asmx/Teams?board_id=5&cYear=Y`: **TeamUID** is the club's id every season (Maccabi Tel Aviv 10, Hapoel
  Holon 7 through its sponsor's change) and is the club code; the Games list's team ids are new every season.
- **Game:** `stats.segevstats.com/realtimestat_heb/api/?method=getActions|getBoxScore&game_id=S` (no key). Translated
  into FIBA data.json shape like the other translated leagues. Checked on 15 games of 2025-26 (overtime, double
  overtime, every play-off round, the cup): box = actions re-counted for every player (352 lines), 5 starters, 200/225/250
  minutes, stints cover the game with five a side and add up to the final; 3 cup games of 2026-27 the same, except
  Segev's own box minutes a minute or two short of 200 and one game's operator slips (players scoring while recorded off).
- **Segev's habits, handled:** a change typed across running seconds (2026-27) is one moment; a change at a period's 0:00
  goes to the next period; an and-one's drawn foul points at the foul, not the shot; lay-ups, dunks and alley-oops are
  drawn back to 1.2 m from the basket (operators tap them by area: only 14% within 1.22 m as tapped); `blocked` is a
  miss; a game Segev never flags as finished is final once basket.co.il posts the same score three hours on; a result
  that differs from the feed's (a 2025-26 semi-final awarded 20-1, the feed three quarters to 77-67) is held.
- **Not in the play-by-play:** second-chance and off-turnover flags (the stint buckets stay 0); the box carries Segev's
  own per-player fast-break and second-chance points and the club's published paint, off-turnover and bench points.
- **Bio:** `bio_sources.ibsl`: the Winner League's clubs, then `ws.asmx/Players?team_uid=U&cYear=Y` per club (English
  name, height in metres, birth date day-first; its "jersy" is the list's order, not the shirt, so no number).
- **Next season:** nothing to change (cYear follows the season). Watch the board names if the league renames a phase.

## Czech Republic: ŽBL and 1. liga mužů (FIBA LiveStats via the federation's system)

### host

The Czech federation (ČBF) runs one system behind three addresses, and every game on it links a FIBA LiveStats
webcast (client `CBFFE`, the same as NBL). So both leagues are Czech NBL again (`fiba_site_schedule`, site `czech`):
only the list of fixtures differs.

- **ŽBL** (Chance ŽBL, women): `zbl.basketball`, the identical `/zapasy?y=<start year>` page NBL has
  (`czech_base: https://zbl.basketball`). 90 fixtures in 2026-27, crests through the site's own resizer.
- **1. liga mužů** (men's second tier): no site of its own. It lives on the federation's `cz.basketball`, one page per
  PART of the competition (`/soutez/<competition id>?p=<part id>`), found each season by name
  (`czech_competition: 1. liga mužů`) on `cz.basketball/soutez?y=<start year>`. 2026-27: competition 5404, parts
  10223 (Skupina VÝCHOD) and 10224 (Skupina ZÁPAD), 90 fixtures each, 20 clubs. Only the page's "Zápasy" tab
  (`tab-pane-one`) is read: the table and records tabs link games too.
- Page titles read "… | CZ.BASKETBALL" (a browser's translation turns that into "PART II. BASKETBALL").
- `cz.basketball/zapasy` is NOT usable: it ignores the part filter (`p1[]=`) and returns every game in the country
  (56 MB); its rows also lack the `data-sort` kick-off.

### current_season

`?y=2026` = 2026-27 on all three. The federation's competition and part ids are new every season, so they are read
off the competitions page each pass, never stored.

### schedule_recipe

`adapters/fiba_site_schedule.py` `czech_rows()`: one `<tr>` per fixture with `/zapas/<site id>` (the fixture's key),
both clubs in `<div>`s, the kick-off in `data-sort="YYYY-MM-DD-HH-MM"` (Prague time), and - once the game is set
up - `fibalivestats.com/webcast/CBFFE/<LiveStats id>/`, which goes straight into `data/feed/<CODE>/idmap.json` (no hop
to the game page). A 1. liga row also names its part in the first cell ("skupina VÝCHOD") and the hall straight
after the kick-off; the two first-phase groups become each fixture's `home_group`/`away_group` ("Východ", "Západ";
`groups_from_feed`), later parts (placement groups "Skupina C 1.-6.", play-out, play-off) go into the same
competition untagged, as NBL's later parts do.

### game_recipe

`fibalivestats.dcd.shared.geniussports.com/data/<LiveStats id>/data.json`, unchanged (FibaLiveStatsAdapter); the
bundle keeps the fixture's site id. A row without a webcast yet is looked up once on
`<czech_base>/zapas/<site id>` and remembered.

### logos

ŽBL rows carry both crests (`/min.php?...file=http://cbf.cz/files/<id>.png` on zbl.basketball). 1. liga pages carry
NONE (fixtures, standings and club pages checked), so its clubs start without crests or colours.

### bio

`bio_sources.czech_site()` reads ŽBL's club pages exactly as NBL's (date, height). `czech_federation("1. liga mužů")`
reads each club's squad tab on `cz.basketball/tym/<id>?y=<year>`: birth YEAR as printed and height where entered
(no date anywhere; a player page says "narození 2000 - 26 let").

## Italy: Serie A2 and Serie B Nazionale (Lega Nazionale Pallacanestro) - NOT BUILT

Looked at 2026-09-27 and left out on purpose: the public play-by-play cannot give lineups (see gotchas). Everything
found is here so the next attempt starts from it.

### host

`www.legapallacanestro.com` (Drupal). **robots.txt: `Crawl-delay: 10`** - one request per 10 s on this host. The
schedule and standings come from a JSON host with no robots.txt (404): `lnpstat.domino.it`.

### current_season

`Drupal.settings.wpCurrentYear` on any page: `x2627` = 2026-27.

### schedule_recipe

The calendar pages (`/serie/1/calendario` = A2, `/serie/4/calendario` = Serie B with two tabs, `?qt-campionato-selector=0|1`)
render an empty table; their script fills it from JSON, one round at a time:

    https://lnpstat.domino.it/getstatisticsfiles?task=schedule&year=x2627&league=<league>&round=<n>

- Leagues: `ita2` (Serie A2, 20 clubs, 38 rounds), `ita3_a` and `ita3_b` (Serie B Nazionale groups A and B,
  18 clubs, 34 rounds each). The round list and the current round are in `Drupal.settings.calendario.<league>`
  (`round_options`, `curr_round`). `round=all` does not exist. The script also knows `ita2_a`/`ita2_b`,
  `ita2_2ph_*` and `ita2_clock` (phases of other seasons' formats).
- Each game: `gameid` ("ita2_403"), `teamid_home`/`teamid_away` (numeric), `teamname_*`, `score_*`, `round`,
  `date` ("26/09/2026") and `time` ("20:00", Italian local), `arena`, `stream_url`, `game_status`
  ("finished", "ready", ...).
- Standings: `task=standings&year=x2627&league=<league>&round=ista`.
- Crests: `static.legapallacanestro.com/sites/default/files/styles/255_x/public/team_logo/<teamid>.png`.

### game_recipe

No JSON for a game was found (`task=boxscore|tabellino|playbyplay|pbp|match|partita|game|stats|livestats|team`, with
`round` = the game id or its number: all "file not found"). The game centre is server-rendered HTML:

- `/wp/match/<gameid>/<league>/x2627` - box score. Per club, a names table (`Num` empty, `Q` = `*` for a starter,
  the player linked `/giocatore/wp/<id>`, then "Squadra" and "Totali" rows) and a stats table of 23 columns:
  Pun, Min (whole minutes), Falli C (committed), S (drawn), Tiri da 2 R/T/%, Tiri da 3 R/T/%, Tiri liberi R/T/%,
  Rimbalzi O/D/T, Stop D (blocks)/S (received), Palle P (turnovers)/R (steals), Ass, Val Lega, OER.
  The quarter table is headed "Ospite | Casa" but its FIRST column is the home club's.
- `/play-by-play` - `<tr data-period="n">`: Minuto (elapsed game time, 0:00-40:00), the home club's event, the
  score (home-away), the margin, the away club's event; "<player link>, <description>". Descriptions seen: Tiro
  realizzato da 2 punti da fuori area / da 3 punti, Tiro sbagliato da fuori area / dall'area / da 3 punti, Tiro
  libero segnato / sbagliato, Rimbalzo offensivo / difensivo (di squadra), Assist, Palla recuperata, Stoppata,
  Fallo subito, Timeout, Cambio.
- `/tabellino` - a text summary only.

### gotchas

- **The play-by-play cannot give lineups.** "Cambio" names ONE player and it is the player coming ON (of the
  substitutions with any play by that player within 90 s, 27 of 30 had them after and 1 before); who went off
  is never written. There are also NO committed fouls and NO turnovers in it (the box score has both). Building
  it would mean inferring each substitution's player off from who keeps acting and checking the result against
  the box score's minutes, keeping a game's lineups only when they agree.
- Other leads checked: the live page's Genius SportingPulse widget (`widget.wh.sportingpulseinternational.com/widget/?OPJA9B6WM5WC7JWV52HAFSRKR5F7GC`)
  serves an empty table; the Netcasting page embeds `lnpscoreboard.webpont.com/?nat=ita2`, a plain HTML
  scoreboard; the live page links `organizer.statbasket.it/Matches/OffLineMatches` (the federation's stats system,
  which timed out from here). None exposes game data.
- Player pages `/giocatore/wp/<id>` are the obvious bio source when the league is built.

## Turkey: BSL, TBL, KBSL, TKBL, BGL (Turkish Basketball Federation) - NOT BUILT

Looked at 2026-09-27 and left out: the federation's site will not answer an automated client from anywhere.

### host

`www.tbf.org.tr` (a Nuxt app: leagues under `/ligler/<league>-<season>/`, e.g. `bsl-2026-2027`; fixtures by game
week, one button per week; a game at `/ligler/<league>-<season>/mac-detay/<game id>` (346279), with a "Statistics"
tab (box score) and a "Game Flow" tab (play-by-play, including substitutions with an in/out icon). Crests and
player photos are served from `tbf.org.tr/res/...`. There is also `api.tbf.org.tr`.

### gotchas

- **Every request gets Cloudflare's interactive "Just a moment..." challenge (403)**: the pages, `robots.txt` and
  `api.tbf.org.tr` alike, from a server AND from a home connection (checked from the operator's PC with plain
  `requests`, 2026-09-27: `403 BLOCKED`). Unlike lnb.fr, which only refuses GitHub's addresses, this tests the client
  itself, so the home live lane does not help. The only way through would be a browser passing Cloudflare's bot
  check, which is not something the ingest does.
- No FIBA LiveStats / Genius tenant for the federation or its leagues (TBF, TUR, BSL, TBL, KBSL, TKBL: none), and
  no other public source of box scores was found.
- The route is data access from the federation itself (an API key or an allowed feed).

## Estonian-Latvian Basketball League (FIBA LiveStats via the Estonian federation's live-score portal)

### host

The games are on FIBA LiveStats (the Estonian federation's account, `fibalivestats.com/u/EBF/<id>`). The fixtures and
each game's LiveStats id come from **online.basket.ee**, the federation's live-score portal (BestIT "basketis", the
same system and game ids as the league's site). `fiba_site_schedule`, site `basketee`.

- NOT estlatbl.com and NOT www.basket.ee: both robots.txt files disallow every crawler except Google, Bing and Apple
  (`User-agent: * / Disallow: /`, crawl delay 30). online.basket.ee publishes no robots.txt (404) and marks its pages
  `index,follow`.
- The Genius hosted tenant `EBF` is the Egyptian federation (a 2019 U16 schedule): unrelated to the LiveStats `u/EBF`.

### schedule_recipe

- `https://online.basket.ee/en`: two menus, `chid` (the championships: "Estonian-Latvian Basketball League" = 212,
  read by name) and `date` (13 days back to 7 ahead, `dd.mm.yyyy`).
- `https://online.basket.ee/s2/list/<YYYY-MM-DD>/data.json`: every federation game that day - `gid` (the league's own
  id, `2027212001` = season, championship, game), `chid`, `date`, `time` (Tallinn time; Riga's is the same), `place`,
  `team_home`/`team_visitor`, `h_tid`/`v_tid` (federation club ids, used as the clubs' codes), scores, `is_over`,
  `sporting_id_live` (the LiveStats id, there for upcoming games too; null until set up).
- **A date outside the menu answers an error page that e-mails their webmaster.** So only menu dates are asked for, and
  not its first or last day (clock and midnight margin).
- One request every 30 s (the federation's crawl delay on its other sites), retried on a dropped connection. Each date
  is cached in `data/feed/ESTLAT/days.json` (committed with the other feed caches): a past day whose games are all
  over is never asked for again; today is re-read after 30 minutes, a day ahead after 12 hours, a past day still in
  play after 3 hours. The first pass is ~20 requests (~10 minutes); after that the menu and a day or two.

### game_recipe

`fibalivestats.dcd.shared.geniussports.com/data/<sporting_id_live>/data.json` (tm "1" is home), unchanged, with the
clubs' names and codes replaced by the schedule's; the game keeps its `gid`. Full play-by-play with substitutions, so
stints and lineups are built as for any LiveStats league.

### gotchas

- The window is only 13 days back: the ingest must run at least every ~12 days or a finished game drops out of reach
  (the full season is only on the two disallowed sites).
- The server drops connections now and then (about half the requests in one probe): each request is tried three times.
- No bio source: the portal's per-game stats (`/s2/stats/<gid>/<tid>/data.json`) and LiveStats carry none, and the
  two sites that might are disallowed (`bio_sources.NO_BIO`).
- Crests: the portal names none. Each game's LiveStats data does (`tm.logoS`, Genius's image host), so every crest a
  payload shows is kept in `data/feed/ESTLAT/crests.json` under the federation's club id, and the schedule hands it on
  as `home_logo` / `away_logo` (run_ingest.sync_logos). A club that has not played yet has none (LiveStats answers 403
  for a game that has not started). Before this, the crest a payload carried was dropped when its club had been met on
  the schedule earlier in the same pass (feedplatform.Platform.take_crest now fills it on a cached club too).

## Lithuania: NKL (nkl.lt)

### host

**nkl.lt**, the league's own WordPress site, and FIBA LiveStats (client `NKLNBL`) for the games themselves.
`fiba_site_schedule`, site `nkl`; two source rows on one code (`NKL`), `stage` regular and playoffs. robots.txt allows
every path and asks for `Crawl-delay: 10`, which every request to nkl.lt keeps (`NKL_GAP_S`).

**nkl.lt never lists a game's LiveStats id.** On 23 Sep 2026 the homepage's match strip linked 15 games to their
webcasts (each the site's match id + 2769710); by the first game night it linked none, the ingest found no id for any
game, and the NKL showed nothing (1 Oct 2026: every game "scheduled", the finished ones included).

### schedule_recipe

`https://nkl.lt/matches/?type=schedule` carries the whole season (both stages) as one inline array,
`const allMatches = [...]`: `id` (the match id, the games' external id), `season`, `stage_type_id` (1 = regular),
`date_label` + `time` (Vilnius), `arena`, `home_team_id`/`away_team_id` (the clubs' codes), names, crests (served
over http, asked for over https), `home_score`/`away_score`, `is_result`. `is_running` stays 0 while a game is played.
Read once per pass (cached five minutes).

### game_recipe

A game's own page, `https://nkl.lt/matches/<id>/`, is three different things (seen 2026-10-01):

- **before tip-off**: a preview ("Artėjančios Rungtynės");
- **while the game is being played**: a 302 to its webcast, `www.fibalivestats.com/u/NKLNBL/<LiveStats id>`
  (125748 -> 2895458, which is the match id + 2769710; a fixture re-entered later is not);
- **once the result is in**: nkl.lt's own box score.

So from five minutes before tip-off the page is asked with its redirect NOT followed (`_nkl_match`), every minute for
half an hour and every ten minutes after that until it answers with a webcast. The id is remembered in
`data/feed/NKL/idmap.json`, and from then on the game is its LiveStats `data.json` under nkl.lt's club ids and names:
play-by-play, live box, stints and shots, like any LiveStats league. The live lane (`_live` in the fetch config) never
waits out the crawl delay for a page: its next pass asks.

A finished game is the LiveStats feed when that **agrees** with the site's result: the same two clubs, the same final
score, the game over (closed, or its clock run out at the end of the 4th or an overtime). The feed tried is the one
its page sent us to, then the match id + the offset the remembered pairs share (else 2769710); the offset is never
trusted without that agreement (for 126051 it names a Chilean game). With no feed that agrees, the game is the page's
box score (`nkl_match_page` -> `nkl_payload`), published as a result (`translate` False: no event log, no stints):

- the score under `.nkl-score-display`, the arena below it, the referees in the info bar;
- `table.nkl-quarters-table`: each club's points per quarter (any overtime as further columns) and its abbreviation;
- the **Protokolas** tab: one `table.nkl-protocol-table` per club, home first - shirt, the player (`/zaidejai/<id>/`,
  the nkl.lt player id the player is keyed on), MIN, TŠK, MŽ, 2TŠK, 3TŠK, BM (made/attempted), AK (rebounds), RP, PK,
  KL, BL, EF;
- the **Statistika** tab: the team lines - shooting, rebounds with the offensive/defensive split, assists, steals,
  blocks, turnovers, fouls, points off turnovers, fast-break, second-chance and bench points.

### gotchas

- **A webcast can die mid-game.** 125745's stopped in the 2nd quarter at 15-16 while the game finished 83-108: live, the
  game sits at the dead score (the stall rule takes it off the live list); once the site has the result, the feed
  disagrees and the page's box score is published instead.
- **The site's text is partly mojibake** since late September: arenas, players and referees are UTF-8 read as
  Windows-1252 (`Å\xa0akiÅ³ sporto centras` for Šakių sporto centras, `GuÅ¡Äikas` for Guščikas). `demojibake` reads
  them back word by word, and leaves text that was right to begin with exactly as it was.
- **A box score from the page has no player rebound split and no player fouls**: a player's rebounds are a total, his
  fouls 0, starters unmarked. The team lines have both.
- **Fixtures are rewritten, not moved.** In the first week nkl.lt re-entered a game under a new id (126051 for 125746)
  and entered and then deleted another (126055, "Alytaus Patriotai v Jurbarkas, 16:30 at Šakiai" - the real game is
  125747, the other way round, at 19:00 in Jurbarkas). The adapter's `withdrawn()` names the stored ids the season's
  array no longer lists (dated inside that season), and `run_ingest.retire_withdrawn` removes each one that was never
  fetched and whose game is still scheduled, scoreless and without a play (delete_fixture's own rule) - and nothing at
  all when a read seems to have lost more than a handful.

## Italy (women): Serie A1 and Serie A2 Femminile (Lega Basket Femminile)

### host

`www.legabasketfemminile.it`, a SvelteKit front on the league's own JSON API; games on FIBA LiveStats (client `LEGBF`).
robots.txt allows every path to a general crawler (`User-agent: * / Allow: /`); it closes `/it/squadre/`, `/it/atlete/`
(and the English equivalents) to AI crawlers only. `fiba_site_schedule`, site `lbf`. No Genius hosted tenant (`LBF` is
a 2021 leftover, `LEGBF` nothing).

### schedule_recipe

- `/rm/v1/competitions/<serie-a1|serie-a2>/<2026-27>/calendar-index.json`: every round with its `phase_id` and games:
  `id` (uuid), `start_at` (UTC), `status` (scheduled / final ...), `home`/`away` {id, slug, name, short_name, logo_url}.
- `/rm/v1/competitions/<...>/<season>/overview.json`: `phases` - A1 one round robin; A2 "Girone A" and "Girone B",
  both round robins (so they are groups, `groups_from_feed`); a play-off phase has another `format`. Two sources per
  league: `stage` regular (the round robins) and playoffs (the rest).
- Clubs are keyed on the league's `slug`: the three-letter `short_name` is not unique (A2 2026-27: two Cagliari clubs
  CAG, two Milan clubs MIL, three clubs none) and not FIBA's (San Martino: SAN here, SML in the feed). It is passed as
  the short name only where no other club has it.

### game_recipe

`/rm/v1/matches/<id>.json` gives `genius_id` (the LiveStats id; null until the game is set up) - asked for once per
game when it is fetched, kept in `data/feed/<CODE>/games.json`, asked again at most every 10 minutes while null. Then
`fibalivestats.dcd.shared.geniussports.com/data/<genius_id>/data.json` under the league's club names and slugs.

### gotchas

- The API's `venue` is wrong: Sassari at home in "Palaleonessa" (Brescia's arena), Costa Masnaga in "La Molisana Arena"
  (Campobasso's). Not used.
- No bio reader (`bio_sources.NO_BIO`): see docs/player-bio.md.

## Brazil: NBB and Liga Ouro (Liga Nacional de Basquete) - LDB NOT BUILT

### host

`lnb.com.br`, the league's own WordPress site, server-rendered. No robots.txt (`/robots.txt` redirects to the 404 page);
Cloudflare's Rocket Loader is on the pages but not its bot check - a plain GET answers. The Content-Type names no charset:
the pages are UTF-8.

**It refuses GitHub's runners (403)**, as lnb.fr does: the first run from Actions (2026-09-27) read no fixture at all.
NBB and Liga Ouro are read from the processing PC: `scripts/ingest/home_sources.bat` (a normal pass for the two
sources, straight to Supabase; run by hand or daily from Task Scheduler), and the PC's live lane follows a game once
its fixture is on the schedule. The adapter says so in the log when it meets the 403. Adapter `lnbbr` (`scripts/ingest/adapters/lnbbr.py`), one request every 3 s. Two sources per
league (`stage` regular / playoffs), codes `NBB` and `LOURO`.

### current_season

`/<nbb|liga-ouro>/tabela-de-jogos/` shows the current season (the season filter's checked radio: NBB 2026/2027 = 106,
Liga Ouro 2026 = 102). `season_id` in adapter_config asks for another (`?season[]=<id>`, what the FILTRAR button sends).

### schedule_recipe

One `<tr>` per game on the schedule page: `data-real-id` (the league's game id, the game's external id), date and time
(Brasilia, UTC-3 all year), both clubs (name, crest, and the three-letter code in the small-screen cell - the clubs'
codes, which follow a club through a sponsor rename), round, stage ("1º TURNO", "2º TURNO" = regular season; "OITAVAS",
"QUARTAS", "SEMIFINAL", "FINAL" = play-offs) and one link: `/partidas/<slug>/` until the game's report is published,
then `/noticias/<slug>/`. A game with a report is final. The page is read once per pass; a fetch that finds no report
link cached re-reads it at most every 30 minutes. Links are kept in `data/feed/<CODE>/games.json`.

### game_recipe

The report (`/noticias/<slug>/`): the score and quarters, the hall (`p.score_header_place`), and three tabs.

- `#stats`: a box score per club (`team_home_stats` / `team_away_stats`): shirt, display name, games, minutes
  (decimal), points ("20/35 (57)": the first number), rebounds "D+O T", assists, 3P / 2P / FT "made/attempted (pct)",
  steals (BR), blocks (TO), fouls committed (FC) and drawn (FR), turnovers (ER), dunks (EN), +/-, efficiency; an
  "Equipe" row with the club's totals (team rebounds and turnovers are the difference from its players' sum).
- `#movethemove`: the play-by-play, NEWEST FIRST, in Portuguese: quarter (`idq`), club (`idt`: 1 home, 2 away), clock
  (counting down), running score ("78 x 87", home first), a title and a sentence naming the player by the box score's
  display name. The adapter reads it oldest first and translates each sentence (made/missed twos, threes, dunks and free
  throws, rebounds, assists, steals, blocks, fouls committed and drawn, turnovers and violations, timeouts, both sides of
  each substitution). A sentence it does not know is kept on `raw.lnbbr.unknown` and printed ("not translated"), never
  guessed.
- `#graphic` ("GRÁFICO DE ARREMESSO"): the shot chart, NEWEST FIRST, one `<li>` per shot in `div.graphic_gym`:
  `idj` (the site's player id), `idp` (the quarter, 5+ overtime), `ide` (1 home, 2 away), class `2pt` / `3pt` / `ll`
  (free throw, no place) and `correct` / `incorrect`, `style="top: T%; left: L%"` and `time` (the clock). Left and top
  are FIBA's own chart frame (28 x 15 m, rims at x 6 and 94, y 50): of 8,629 twos in the 113 games none is beyond
  6.75 m of its rim, and 4 of 6,414 threes are inside 6.6 m. The club's players stand beside the court
  (`players_block_left` = home, `players_block_right` = away), named as the play-by-play names them.
- **The shot chart is what splits the rim from mid-range.** Each dot is joined to its play-by-play shot by quarter,
  clock, club, two or three, and made or missed (where two shots share all five, by player, then in order): all 15,043
  shots of the 113 games placed, none left over. They go on `tm[side].shot` with the shot's `actionNumber`, so the
  box score's zones, the stints and the game stream all measure the shot from the ring: 4,222 twos at the rim (61.7%),
  4,407 mid-range (37.9%). A report whose shots cannot all be placed says so in the log ("N of M shots have no place
  on the shot chart"); counts are on `raw.lnbbr.shots`.
- **A shot on the ring itself is a putback.** The scorers' quick button puts a tap-in exactly on the rim (x 6 or 94,
  y 50: 639 shots, 5.7 a game, where no other spot is used three times in a game), and 622 of them follow their own club's
  offensive rebound, 613 in the same second. Such a two is labelled `putback` when the play before it (substitutions,
  assists, blocks and timeouts passed over) is its club's offensive rebound or missed shot, in the same quarter, at
  most 5 s earlier: 635, with 3 dunks there left as dunks. Without the label the game stream would not believe the
  spot: one place used three times or more in a game is how a quick-tap default looks (`translate/fiba_events.py`),
  and it keeps a shot there only with a label that says the rim.
- Players have no id in the box score or the play-by-play: a player is his display name and shirt within his club (`pno`
  `pedro-nunes-11`; a club can have two players of one display name - Paulistano 2025-26, Gabriel 14 and Gabriel 11).
  The shot chart's `idj` is the site's player id (one name per id across the sample); it is used only to tell two
  shots of one second apart.
- **The play-by-play does not always name a player as the box score does**: it uses the scorers' name ("Gama",
  "JV Martins", "Sbardelotti"), the box score the site's ("Juan", "Martins", "Thiago") - IVV/CETAF in most Liga Ouro
  games, 22 names in the sample. A name the box score does not have is given the box line of its club that its own
  plays add up to exactly (shots made and missed, free throws, rebounds, assists, steals, blocks, fouls both ways,
  turnovers), only where no other line fits; quiet players (all zeros) by their time on court from their own
  substitutions. Kept on `raw.lnbbr.renamed`.
- Starters: each club's five "Entra" lines at 10:00 before the first play.
- **The changes made between quarters are not logged**: a player who starts a quarter is simply there. Each later
  quarter's opening five is the five of the club that the quarter's own lines contradict least (a play by someone not
  on court weighs more than a substitution line that cannot be), and the substitutions are written at the quarter's
  start, marked `"inferred": 1`. That is what lets the lineups and stints be built.
- A change entered the wrong way round is put right by entering its reverse at the same clock ("Sai L. Muller, Entra
  Emerson, Sai Emerson, Entra L. Muller"), and a change can be written in two halves with plays between them: the
  lines are kept as logged, the second half moved up beside the first.
- Checked against every Liga Ouro 2026 report and 78 NBB 2025-26 ones (113 with stats): every sentence translated, the
  play-by-play's points equal to the box score's for both clubs in every game, five starters, no lineup warnings.

### gotchas

- The report is published some hours after the game (the adapter polls 12:00-24:00 UTC; weekend games tip as early as
  late morning Brasilia time).
- About one report in twelve is an article with no stats and no link to any (Liga Ouro 2026 game 26825; 9 of 78 NBB
  2025-26 games sampled, mostly play-offs): no game is made from it, and it is read again at most every 12 hours
  (`nobox` in `games.json`) in case the stats are added.
- A free-throw trip is numbered from its made/missed lines (1of2, 2of2); a drawn foul is paired with the other club's foul
  at the same clock.
- **LDB (Liga de Desenvolvimento) is not built**: its games (2025 and 2026, the final included) have a result and
  nothing else - the game page's tabs are empty and no report is ever published - so there is no box score to ingest.
- Bio (`bio_sources.lnb_br`): each club's page (`/<path>/equipes/` -> `/equipes/<slug>/`) is its squad with the display
  name, shirt and height; the athlete's own page has the date of birth and weight, but about half of them are the site's
  "not found" page. A club page does not name its three-letter code, so it is matched to the athletes page's club filter
  (`?equipe=BCE`) by crest.

## Albania and Azerbaijan (Genius hosted schedules)

Added 2026-09-27. Test `scripts/ingest/albania_test.py`. Both federations keep their schedules on Genius's
hosted pages and score on FIBA LiveStats, so both are `fiba_livestats` sources (box, play-by-play, shots,
stints from data.json). Neither has published 2026-27 yet: the sources name their competitions
(`competitions_include`) and skip the pass ("no 2026-27 competition published yet") until the client lists one
with this season's year. The discovery pass (Mon and Thu) checks again every time, so the season is picked up
the week it appears, with nothing to change.

### Albania - FSHB (fshb.basketball), client ALBS

- The federation's WordPress pages only embed the widget; the data is `hosted.dcd.shared.geniussports.com/ALBS/en/...`.
- Sources `ALBM` (Kampionati Kombëtar Meshkuj, KKM; "Superliga M" until 2022-23) and `ALBW` (Kampionati Kombëtar
  Femra, KKF), each a regular and a play-off row. Slugs `kkm-albania`, `kkf-albania`, country AL. Europe/Tirane.
- **The schedule is paged by day** and ignores `roundNumber=-1`: a competition's page shows one match day and a
  calendar of the others (`SelectedDates['2026-04-15']=1;`), per match type - `?matchType=REGULAR` (the season),
  `?matchType=FINALS` (the play-offs); the bare page shows whichever came last. `adapter_config.date_paged` reads
  each type's calendar and each day (`?matchType=&dateFilter=`), ~70 pages a season on the discovery pass, and the
  match type is the stage. A day that cannot be read files nothing that pass. KKM 2025-26: 132 + 13 games.
- The tenant also runs the cups (Kupa, Superkupa), the second tier (Kategoria I-rë) and youth leagues; excluded.
  One 2024-25 men's competition is named just "2024-25" and is not picked (it is last season anyway).
- Liga Unike (Albanian + Kosovan clubs) is on ligaunike.com with no LiveStats; not built.

### Azerbaijan - ABF (aze.basketball), client ABS

- The federation's "ABL - Statistika" link goes to `hosted.dcd.shared.geniussports.com/ABS/`. abl.az is not the
  league (a redirect to an unrelated site); basketball.az is a 2021 copy of the federation site.
- Source `AZABL`, slug `azerbaijan-basketball-league`, country AZ, Asia/Baku (UTC+4, no summer time). The ordinary
  `roundNumber=-1` whole-season page works (ABL 2025-26: 145 games).
- The season is one competition ("ABL 2025-2026"; plain "ABL" for 2022 and 2023); the play-offs are phases of it
  (A GROUP / B GROUP, PLAY-IN, PLAY-OFF 1/4, PLAY OFF 1/2, Final), split with `playoff_phases` as CIBACOPA is.
- The tenant also runs the Azerbaijan Cup, AQL, TGBL and an amateur league; excluded.
- aze.basketball's own 26/27 tab lists three round-1 games (30 Sep - 3 Oct 2026) with no times and no Genius ids;
  the hosted page has no 2026-27 competition yet, which is what the source waits for.

## Switzerland: SB League, SB League Women, NLB Men, NLB Women (swiss.basketball / Basketplan)

Added 2026-09-27. Test `scripts/ingest/swiss_test.py`. Adapter `fiba_site_schedule`, site `swiss`; the games are
FIBA LiveStats (client SUI). Sources `CHSBL`, `CHSBLW`, `CHNLB`, `CHNLBW`, each a regular and a play-off row;
slugs `sb-league`, `sb-league-women`, `nlb-men`, `nlb-women`; country CH; Europe/Zurich.

- The schedule pages (`/national-competitions/<sbl|nlb>/<men|women>/schedule`) are shells drawn in the browser
  from Basketplan, the federation's match database, which the site proxies as XML under `/basketplan/`.
  swiss.basketball's robots.txt disallows nothing; basketplan.ch's disallows everything, so the proxy is read.

      <league>/schedule                         window.seasons = {'2026-2027': 31, ...}   the season id
      /basketplan/findAllLeagueHoldings.do?leagueId=&federationId=12&seasonId=          the season's phases
      /basketplan/showLeagueSchedule.do?leagueId=&leagueHoldingId=&daysBack=2500&daysFuture=2250&totalGames=1000
                                                                                        every game of a phase
      /app-basketball/schedule?widget=N         JSON: the LiveStats id of each game weeks ahead (2 SBL men, 3 SBL
                                                women, 10 NLB men; none for NLB women), ~2 days back to ~8 weeks on

- Basketplan league ids: 1 SBL men, 6 SBL women, 2 NLB men, 7 NLB women. Phase `PLAYOFF` is the play-offs,
  anything else (PRELIMINARY_ROUND) the regular season.
- **The ?gid= a row links to is Basketplan's game id, not LiveStats'** (data/367239 is a 403). A fixture is keyed on
  it (`BP367239`) from the day the schedule exists. The LiveStats id is the row's `liveStatsLink` (from about game
  day) or the widget's `match_id` (weeks ahead); fetch tries the widget's first, keeps an id only when the feed
  names the fixture's two clubs, and remembers it in `data/feed/<CODE>/idmap.json`.
- **Basketplan can give the wrong id**: on 2026-09-27 Lions de Genève v BBC Nyon (men) carried 2909496, a women's
  game; the widget had 2909438. The club check is what keeps the wrong one out.
- NLB Women had no LiveStats links at all on 2026-09-27: its fixtures are listed, and a game is fetched only once
  one appears.
- Clubs are named and coded from the schedule on both paths (fixture and game), so one club is one row.
- The site also runs the Swiss Cup, SBL Cup and SuperCup (Basketplan leagues 165/166, 1053/1064, 1044/1045); not built.
- Basketplan's game overview carries officials' licence numbers and contact details; it is never read.

## Korea: KBL (kbl.or.kr)

Added 2026-09-27. Test `scripts/ingest/kbl_test.py`. Adapter `kbl` (`adapters/kbl.py`), a translation into the
FIBA shape as the B.LEAGUE's is. Source `KRKBL` (the Danish women's league already has `KBL`): a regular-season
row, a play-off row and a pre-season row (Open Match Day, a friendly); slug `kbl`, country KR.

- kbl.or.kr is a single-page app over `api.kbl.or.kr`, which wants `Channel: WEB` and `TeamCode: XX` and nothing else.

      /match/list?fromDate=YYYY0801&toDate=YYYY+10731&tcodeList=all   the season, one request
      /match/<gmkey>   /player-stat   /team-record   /text-cast?quarterList=Q1,...,X4

- `S49G14N1` = season code 49 (2026-27; the first division's are odd, the D-League's even), game code 14, game 1.
  Game codes: 01 regular season, 03 play-offs, 04 championship final, 14 Open Match Day (pre-season), 07 EASL,
  10 All-Star, 13 the old KBL Cup. The season is read off each game's `seasonName1`.
- Times are KST (+09:00, no summer time). 2026-27: Open Match Day 24-27 Sep, regular season 3 Oct - 11 Apr (270 games).
- Clubs in English from a table keyed on the logo class (`kcc`, `pega` ...), which is also the club's code; the
  API's own English names are shouted and run sponsors together. Crests `www.kbl.or.kr/assets/img/logo/logo-<class>.svg`.
- Names: every player comes in Hangul (`pname`) and in the league's Latin spelling (`ename`), family name first for
  a Korean ("KIM KYUNG WON" -> Kyung-won Kim), given name first for an import (`playerFlag` 1/2). The Hangul is
  kept as the native name (an alias). An `ename` of initials ("KIM S C") or none is spelt from the Hangul by rule
  (`names.korean_name`: Revised Romanization, family names as passports write them).
- The play-by-play names a player by club + Korean name (no id) and carries no running score. Each period opens
  with ten `101` rows without `c` before `001`: the first period's are the starters' announcement (dropped; the box
  has `startFlag`), later periods' pair with the mass `102` after the previous `009` and are kept. The mass
  substitution after the LAST period's end is dropped, or the game would end with nobody on court.
- No shot chart: `match-chart.shootLog` gives pixels on an unspecified court drawing.
- Bio: each player's profile on the league's statistics service (kbl-api.sports2i.com, Referer kbl.or.kr),
  by pcode: date of birth and height, no weight.
