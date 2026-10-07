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
   /e\.key === 'Escape' && CINE\.group/.test(media) && /veil\.onclick = \(\) => cineExit\(\)/.test(media) && /M\.cineExit\(true\); stage\.hidden = true/.test(tabs)
   && /forEach\(b => b\.addEventListener\('click', \(\) => \{ if \(window\.EpinoiaMedia\) window\.EpinoiaMedia\.cineExit\(true\)/.test(tabs));
ok('what the dark covers is not painted (visibility, so nothing moves), and given back on the way out',
   /\.md-unlit\{visibility:hidden !important\}/.test(css) && /s\.classList\.add\('md-unlit'\)/.test(media) && /CINE\.off\.forEach\(s => s\.classList\.remove\('md-unlit'\)\)/.test(media));
ok('the veil above everything, the group above the veil, no fade under reduced motion',
   /\.md-veil\{position:fixed;inset:0;z-index:2147483000/.test(css) && /\.md-lit\{position:relative;z-index:2147483001/.test(css) && /prefers-reduced-motion:reduce\)\{ \.md-veil,\.md-lit\{transition:none\}/.test(css));
ok('the lit group: the stage on the Video tab, the whole room (stream, box score, chat) on the Live tab',
   /group: stage \}/.test(tabs) && /group: room \}/.test(tabs) && /tr\('Live stream'\), room\)/.test(tabs));

console.log('\nthe box score, once');
ok('the game is the site\'s own embed in a frame, sized by its message', /BASE \+ 'embed\/game\/\?g='/.test(media) && /epinoiaEmbed !== 'height'/.test(media)
   && !/deriveGame/.test(media + tabs) && !/gamebox/.test(tabs));

console.log('\nthe chat');
ok('posts through the function, reads with game_chat_read, follows chat:<game> on the small socket',
   /\/functions\/v1\/chat'/.test(chat) && /rpc\('game_chat_read'/.test(chat) && /rt\.watch\('chat:' \+ gameId/.test(chat) && /load\('rt\.js', 'EpinoiaRT'\)/.test(chat));
ok('says what is missing before anything is typed (sign in, a username, the chat closed, not on now)',
   /chat_my_status/.test(chat) && /Sign in/.test(chat) && /Choose a username/.test(chat) && /REASONS\.not_now/.test(chat));
ok('a slow read only while the page is seen', /if \(!document\.hidden\) history\(\)/.test(chat));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
