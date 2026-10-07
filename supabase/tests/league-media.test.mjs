/* ============================================================================
   A LEAGUE'S VIDEO AND LIVE TABS, THE PLAYER AND ITS CINEMA (0237: l/mediatabs.js, media.js, gamechat.js).

     * the page: two tabs, hidden until the league has highlights / a game on now; their panes; a frame-src for
       YouTube, Twitch and the site's own embeds; mediatabs.js only (no media code at load);
     * the load: one call (league_media) when the page is idle, asked at once when the address opens one of the tabs;
       media.js, kit/media.css and gamechat.js loaded the first time a tab is opened;
     * the player: nothing of YouTube until play (a thumbnail), then youtube-nocookie with enablejsapi, its state read
       from its frame's own messages (never the iframe_api script);
     * cinema: a veil while playing, the group lit, the rest not painted once dark; a pause (after a moment), the end,
       Esc and a press on the dark bring it back; a closed stage or another tab too;
     * the box score is the site's own embed (embed/game) in a frame, sized by its message - never drawn a second time;
     * the chat posts through the function `chat`, reads with game_chat_read, follows chat:<game> on the small socket.

     node supabase/tests/league-media.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(d).slice(0, 300) : '')); } };

const page = rd('epinoia', 'l', 'index.html'), tabs = rd('epinoia', 'l', 'mediatabs.js'), media = rd('epinoia', 'media.js');
const chat = rd('epinoia', 'gamechat.js'), css = rd('epinoia', 'kit', 'media.css'), league = rd('epinoia', 'l', 'league.js');

console.log('the page');
ok('a Live and a Video tab, hidden until there is something in them, with their panes',
   /<button class="ep-tab" data-p="live" role="tab" hidden>Live<\/button>/.test(page) && /<button class="ep-tab" data-p="video" role="tab" hidden>Video<\/button>/.test(page)
   && /id="pane-video"/.test(page) && /id="pane-live"/.test(page));
ok('frames allowed: the site\'s own embeds, YouTube (no-cookie), Twitch',
   /frame-src 'self' https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com https:\/\/player\.twitch\.tv/.test(page));
ok('only mediatabs.js is loaded with the page', /<script src="mediatabs\.js\?v=\d+" defer><\/script>/.test(page)
   && !/media\.js\?v|gamechat\.js|kit\/media\.css/.test(page.replace(/mediatabs\.js/g, '')));
ok('league.js says which league it is', /window\.EPINOIA_LEAGUE = league;/.test(league) && /new CustomEvent\('epinoia:league'/.test(league));

console.log('\nthe load');
ok('one call, league_media, when the page is idle - at once when the address opens a tab',
   (tabs.match(/rpc\('league_media'/g) || []).length === 1 && /requestIdleCallback\(go/.test(tabs) && /\/\^#\(video\|live\)\$\/\.test\(location\.hash\)/.test(tabs));
ok('the tab code arrives with the first opening', /s\.src = '\.\.\/media\.js'/.test(tabs) && /EpinoiaMedia\.css\('kit\/media\.css'\)/.test(tabs)
   && /load\('gamechat\.js', 'EpinoiaGameChat'\)/.test(tabs));

console.log('\nthe player');
ok('a thumbnail until pressed, then youtube-nocookie', /md-play/.test(media) && /youtube-nocookie\.com\/embed\//.test(media) && /addEventListener\('click', \(\) => \{\s*playFrame\(/.test(media));
ok('its state from the frame\'s own messages (enablejsapi), never the iframe_api script',
   /enablejsapi=1&origin=/.test(media) && /event: 'listening'/.test(media) && /onStateChange/.test(media) && !/iframe_api/.test(media.replace(/its iframe_api script/, '')));

console.log('\ncinema');
ok('playing (1) or buffering (3) darkens; paused (2) or ended (0) brings it back after a moment',
   /if \(st === 1 \|\| st === 3\) cineEnter\(group\)/.test(media) && /else if \(st === 2 \|\| st === 0\) cineExitSoon\(\)/.test(media) && /setTimeout\(\(\) => cineExit\(\), 900\)/.test(media));
ok('Esc and a press on the dark bring it back; a closed stage and another tab too',
   /e\.key === 'Escape' && CINE\.group/.test(media) && /veil\.onclick = \(\) => cineExit\(\)/.test(media) && /cineExit\(true\); stage\.hidden = true/.test(media)
   && /forEach\(b => b\.addEventListener\('click', \(\) => \{ if \(window\.EpinoiaMedia\) window\.EpinoiaMedia\.cineExit\(true\)/.test(tabs));
ok('what the dark covers is not painted (visibility, so nothing moves), and given back on the way out',
   /\.md-unlit\{visibility:hidden !important\}/.test(css) && /s\.classList\.add\('md-unlit'\)/.test(media) && /CINE\.off\.forEach\(s => s\.classList\.remove\('md-unlit'\)\)/.test(media));
ok('the veil above everything, the group above the veil, no fade under reduced motion',
   /\.md-veil\{position:fixed;inset:0;z-index:2147483000/.test(css) && /\.md-lit\{position:relative;z-index:2147483001/.test(css) && /prefers-reduced-motion:reduce\)\{ \.md-veil,\.md-lit\{transition:none\}/.test(css));
ok('the lit group: the stage on the Video tab, the whole room (stream, box score, chat) on the Live tab',
   /group: stage \}/.test(media) && /group: room \}/.test(tabs) && /tr\('Live stream'\), room\)/.test(tabs));

console.log('\nthe board, one for every page of a league');
const front = rd('epinoia', 'index.html'), fjs = rd('epinoia', 'home.js');
ok('the stats page\'s Video tab and the league\'s front page draw the same board (media.js videoBoard)',
   /M\.videoBoard\(pane\('video'\), \{ leagueId: league\.id \}\)/.test(tabs) && /M\.videoBoard\(host, \{ leagueId: LEAGUE\.id, limit: 7/.test(fjs)
   && /function videoBoard\(host, opts\)/.test(media));
ok('the front page: a Video section under the news, shut until there is video, its frames allowed',
   /<section class="sec hide" id="videoSec"/.test(front) && front.indexOf('id="videoSec"') > front.indexOf('id="newsSec"')
   && /frame-src 'self' https:\/\/www\.instagram\.com https:\/\/w\.soundcloud\.com https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com/.test(front));
ok('...watched only once the page is laid out, read only when the reader comes near, media.js loaded then',
   /renumber\(\);\s*\/\*[^]*?\*\/\s*if \(!wall\.walled\) video\(\)/.test(fjs) && /rootMargin: '400px 0px'/.test(fjs) && /near\(\)\.then\(media\)/.test(fjs));
const home = rd('epinoia', 'home', 'index.html'), vh = rd('epinoia', 'home', 'videos-home.js');
ok('HOME: the video feed under the feed - All, Highlights, Videos - read near it, ranked as the feed',
   /id="videos"/.test(home) && /data-vk="highlights"/.test(home) && /rpc\('video_feed'/.test(vh) && /rankRows\(pool/.test(vh)
   && /feed\.then\(\(\) => run\('videos'\)\)/.test(rd('epinoia', 'home', 'front.js')) && /frame-src 'self' https:\/\/www\.youtube-nocookie\.com/.test(home));

console.log('\nthe tiles, printed like the site\'s cards');
const tileCss = css.slice(0, css.indexOf('/* -------------------------------------------------------------------------------------- the chat'));
ok('in their clubs\' inks (teamcolour.js card, the surface variants for edges), the clash printed in a second colour',
   /inks\(b, it\)/.test(media) && /TC\.card\(node, A, B\)/.test(media) && /'--ink-s', TC\.surface\(A\)/.test(media) && /TC\.contrast\(A, B\) < 1\.6/.test(media));
ok('the plate\'s print: halftone, registration crosses, the kind tag, the stencil band, the edition mark',
   ['md-tone', 'md-reg', 'md-kind', 'md-band', 'md-ed'].every(c => new RegExp("'" + c).test(media) && new RegExp('\\.' + c + '[{ .]').test(tileCss))
   && /'NO ' \+ String\(pos\.no\)/.test(media));
ok('a game\'s video has the scorebug: a row per club, its score in a cell at the end of the row',
   /function board\(g\)/.test(media) && /\.md-side\.a\{grid-row:2;flex-direction:row-reverse/.test(tileCss) && /\.md-pts > span:last-child\{grid-row:2\}/.test(tileCss));
ok('no LATEST stamp; the words are Archivo (no pixel faces on the board)',
   !/md-stamp|'Latest'/.test(media + css) && !/--f-micro|--f-score/.test(tileCss));
ok('the large tile is not the page hero (its own class), a feature where the board is wide',
   /' md-lead'/.test(media) && !/'hero'|' hero'/.test(media) && /@container \(min-width:720px\)\{\s*\.md-tile\.md-lead\{display:grid/.test(css));

ok('the words as a news card sets them: the channel on a block of its colour (its own, else one made from its name), how long ago, the headline, the foot',
   /el\('div', 'md-kick'\)/.test(media) && /el\('div', 'md-foot'\)/.test(media) && /'hsl\(' \+ h \+ ' 52% 46%\)'/.test(media)
   && /\.md-title\{margin:0;font-family:var\(--f-ui\);font-weight:800;font-size:15\.5px/.test(tileCss) && /\.md-kick b\{/.test(tileCss));
ok('three to a row, as the news cards (two on a tablet, one on a phone)',
   /@media \(min-width:1000px\)\{ \.md-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\} \}/.test(css)
   && /@media \(min-width:600px\)\{ \.md-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\} \}/.test(css));
ok("highlights lead where they are shown with other videos (HOME's All, a league's All videos): a week's lead, older ones move up",
   /function prioritise\(rows, now\)/.test(media) && /const FRESH_DAYS = 7, LIFT = 8;/.test(media)
   && /const shown = kind \? picked : prioritise\(picked\)/.test(media) && /return kind \? ranked : M\.prioritise\(ranked\)/.test(vh));
ok('one tile a video: a channel added twice shows each video once, the copy on a game first',
   /function uniq\(list\)/.test(media) && /items = uniq\(items\.concat\(rows\)\)/.test(media) && /M\.uniq\(\(mine \|\| \[\]\)\.concat\(all\)\)/.test(vh));

console.log('\nthe console: a channel\'s own names for clubs (0240)');
const cui = rd('epinoia', 'admin', 'creators-ui.js');
ok('a Club names panel under each channel\'s video switch: its names, a new one, its newest videos with what was found',
   /const names = btn\('Club names'\)/.test(cui) && /function clubNames\(s\)/.test(cui)
   && ['news_video_clubs', 'news_video_club_teams', 'set_news_video_club', 'delete_news_video_club', 'rematch_news_videos'].every(f => cui.includes("sb.rpc('" + f + "'")));
ok('...words selected in a title fill the name in; before 0240 it says so',
   /window\.getSelection/.test(cui) && /arrive with migration 0240/.test(cui));

console.log('\nthe box score: the modern view, as the game embed');
const eg = rd('epinoia', 'embed', 'game', 'game.js'), egh = rd('epinoia', 'embed', 'game', 'index.html'), mod = rd('epinoia', 'game', 'modern.js');
ok('the frame shows the game embed, sized by its message, never a second box score',
   /BASE \+ 'embed\/game\/\?g='/.test(media) && /epinoiaEmbed !== 'height'/.test(media) && !/deriveGame/.test(media + tabs));
ok('embed/game is the modern view: the game page\'s courts (modern.js courts) with its cards (mounted)',
   /MB\.courts\(d\)/.test(eg) && /MB\.mounted\(host\)/.test(eg) && /function courts\(d\)/.test(mod) && /game\/modern\.js/.test(egh) && /game\/modern\.css/.test(egh));
ok('one club at a time, a switch under the score, remembered for the game', /id="sides"/.test(egh) && /SIDE_KEY = 'epinoia_ebox_side_' \+ gameId/.test(eg)
   && /\.eb-host\[data-side="0"\] \.mv-card\.t1/.test(rd('epinoia', 'embed', 'game', 'game.css')));
ok('a player\'s card opens beside the face in a frame (no sheet below the reader\'s view), never on the face',
   /window\.EPINOIA_MV_NO_SHEET = true/.test(eg) && /!window\.EPINOIA_MV_NO_SHEET && window\.matchMedia/.test(mod) && /r\.bottom \+ gap/.test(mod));
ok('the clubs\' own colours win over the snapshot\'s kit defaults', /color: clubColour\(i\) \|\| t\.color/.test(eg));
ok('its height is the body\'s (a floating card is not part of it); Esc inside it is the page\'s too',
   /document\.body\.offsetHeight/.test(eg) && /epinoiaEmbed: 'escape'/.test(eg) && /ev\.data\.epinoiaEmbed === 'escape'/.test(media));

console.log('\nthe chat');
ok('posts through the function, reads with game_chat_read, follows chat:<game> on the small socket',
   /\/functions\/v1\/chat'/.test(chat) && /rpc\('game_chat_read'/.test(chat) && /rt\.watch\('chat:' \+ gameId/.test(chat) && /load\('rt\.js', 'EpinoiaRT'\)/.test(chat));
ok('says what is missing before anything is typed (sign in, a username, the chat closed, not on now)',
   /chat_my_status/.test(chat) && /Sign in/.test(chat) && /Choose a username/.test(chat) && /REASONS\.not_now/.test(chat));
ok('a slow read only while the page is seen', /if \(!document\.hidden\) history\(\)/.test(chat));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
