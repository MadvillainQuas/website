/* ============================================================================
   A YOUTUBE CHANNEL, READ AS THE HALF-HOURLY READER READS IT - for "Load now" (news-refresh).

   THE SECOND IMPLEMENTATION of scripts/news/videos.py's YouTube half: a channel's link made into its feed through the
   YouTube Data API (apiChannel: a channel's page sits behind a consent wall from a server), its newest uploads read
   through the same API (apiItems: one quota unit; YouTube's RSS has gone down for every channel at once before), and
   each video's id and kind (videoIdOf, classify) for the video columns of 0237. The word lists are videos.py's own,
   held to them by supabase/tests/news-refresh-youtube.test.mjs, which reads them out of the Python file: change one,
   the test fails until the other follows.

   PURE but for the getJson handed in: no Deno, no clock but the `now` given. Plain ESM, so node tests it as it stands.
   The API key travels only in the request it is handed to; nothing here puts it in an error or a log.
   ============================================================================ */

export const YT_API = 'https://www.googleapis.com/youtube/v3/';
const ID = /^[A-Za-z0-9_-]{6,20}$/;
const UC = /[?&]channel_id=(UC[A-Za-z0-9_-]{22})/;
const PL = /[?&]playlist_id=([A-Za-z0-9_-]{10,64})/;

/* the playlist the API reads for a channel's or a playlist's feed address (a channel's uploads: UU + its id) */
export function playlistOf(feedUrl) {
  const s = String(feedUrl || '');
  if (!/^https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?/.test(s)) return null;
  const m = UC.exec(s);
  if (m) return 'UU' + m[1].slice(2);
  const p = PL.exec(s);
  return p ? p[1] : null;
}
export const isYouTubeLink = u => { try { return /(^|\.)youtube\.com$/i.test(new URL(String(u)).hostname); } catch (_) { return false; } };

/* a YouTube video's id from its watch link, short link, embed link or its feed's guid (yt:video:ID) */
export function videoIdOf(url, guid) {
  const g = String(guid || '');
  if (g.startsWith('yt:video:') && ID.test(g.slice(9))) return g.slice(9);
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  const host = u.hostname.toLowerCase();
  let cand = null;
  if (host.endsWith('youtu.be')) cand = u.pathname.replace(/^\/+/, '').split('/')[0];
  else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') cand = u.searchParams.get('v');
    else { const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname); cand = m ? m[1] : null; }
  }
  return cand && ID.test(cand) ? cand : null;
}

/* ------------------------------------------------------------------------------------- what the video is --- */
export const hasCjk = s => /[぀-ヿ㐀-鿿가-힯]/.test(String(s || ''));
/* videos.py wide_fold: lower case, accents off (never off kana), any script's letters and digits, one space between
   words and one at each end */
export function wideFold(text) {
  let t = String(text || '').normalize('NFKC');
  t = Array.from(t).map(ch => hasCjk(ch) ? ch : ch.normalize('NFKD').replace(/\p{M}/gu, '')).join('').toLowerCase();
  t = t.replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ß/g, 'ss').replace(/æ/g, 'ae');
  return ' ' + t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
}
export const HIGHLIGHT_WORDS = [
  'highlights', 'highlight', 'hl', 'extended highlights', 'game recap', 'match recap', 'recap',
  'resumen', 'resumen del partido', 'mejores momentos', 'lo mejor del partido', 'resumo', 'melhores momentos',
  'temps forts', 'resume du match', 'le resume', 'faits saillants',
  'zusammenfassung', 'spielzusammenfassung', 'die highlights',
  'sintesi', 'gli highlights', 'momenti salienti',
  'skrot', 'skrot meczu', 'najlepsze akcje', 'najciekawsze akcje',
  'hojdpunkter', 'sammandrag', 'hoydepunkter', 'hojdepunkter', 'sammendrag',
  'kohokohdat', 'kooste', 'koosteet', 'ottelukooste',
  'hoogtepunten', 'samenvatting', 'samenvattingen',
  'sazetak', 'najbolji trenuci', 'rezime', 'highlajti', 'сажетак',
  'ozet', 'mac ozeti', 'ozetler',
  'apzvalga', 'rungtyniu apzvalga', 'akimirkos', 'kokkuvote', 'parskats', 'labakie momenti',
  'sestrih', 'zostrih', 'osszefoglalo', 'rezumat', 'povzetek',
  'στιγμιοτυπα', 'περιληψη', 'highlights αγωνα', 'акценти', 'обзор', 'огляд', 'основни моменти'
];
export const HIGHLIGHT_CJK = ['ハイライト', 'ダイジェスト', '하이라이트', '集锦', '精华', '精華', '集錦'];
export const FULL_WORDS = [
  'full game', 'full match', 'full broadcast', 'whole game', 'live', 'livestream', 'live stream', 'en vivo',
  'en directo', 'directo', 'partido completo', 'retransmision', 'transmision', 'jogo completo', 'ao vivo',
  'match complet', 'en direct', 'direct', 'ganzes spiel', 'komplettes spiel', 'partita completa', 'diretta',
  'caly mecz', 'transmisja', 'na zywo', 'hela matchen', 'direktsandning', 'koko ottelu', 'suora', 'suorana',
  'volledige wedstrijd', 'cijela utakmica', 'uzivo', 'canli', 'tiesiogiai', 'visos rungtynes', 'prenos',
  'ζωντανα', 'πληρης αγωνας', 'на живо', 'цял мач'
];
export const FULL_CJK = ['ライブ', '生中継', '生配信', 'フルマッチ', '配信', '생중계', '직캐', '直播', '全场', '全場'];
const has = (F, words, cjk) => words.some(w => F.includes(' ' + w + ' ')) || cjk.some(c => F.includes(c));
export function classify(title) {
  const F = wideFold(title);
  if (has(F, HIGHLIGHT_WORDS, HIGHLIGHT_CJK)) return 'highlights';
  if (has(F, FULL_WORDS, FULL_CJK)) return 'full';
  return 'video';
}

/* ----------------------------------------------------------------------------------- the YouTube Data API --- */
/* the reader's items (newsfeed.js parseFeed's shape) for a channel's or a playlist's newest uploads: videos.py api_items */
export async function apiItems(feedUrl, key, getJson, now) {
  const pl = playlistOf(feedUrl);
  if (!pl || !key) return [];
  const j = await getJson(YT_API + 'playlistItems?part=snippet,contentDetails&maxResults=15&playlistId=' + encodeURIComponent(pl) + '&key=' + encodeURIComponent(key));
  const out = [];
  for (const it of (j && j.items) || []) {
    const sn = it.snippet || {}, cd = it.contentDetails || {};
    const vid = cd.videoId || (sn.resourceId || {}).videoId;
    const title = String(sn.title || '').trim();
    if (!vid || !ID.test(vid) || !title || title === 'Private video' || title === 'Deleted video') continue;
    const th = sn.thumbnails || {};
    const img = ['high', 'medium', 'standard', 'default'].map(k => (th[k] || {}).url).find(Boolean) || null;
    const desc = String(sn.description || '').replace(/\s+/g, ' ').trim();
    const cut = desc.length > 320 ? desc.slice(0, 319).replace(/\s+\S*$/, '') + '…' : desc;
    out.push({
      guid: 'yt:video:' + vid, url: 'https://www.youtube.com/watch?v=' + vid, title: title.slice(0, 300), summary: cut,
      image_url: img && img.startsWith('https://') ? img : null, author: sn.videoOwnerChannelTitle || sn.channelTitle || null,
      tags: [], published_at: cd.videoPublishedAt || sn.publishedAt || (now || new Date()).toISOString()
    });
  }
  out.sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0));
  return out;
}

/* {feed_url, name, logo, site_url} for a YouTube link (/@handle, /channel/UC…, /c/name, /user/name, a playlist), found
   with the Data API: videos.py api_channel. null when it names no channel. */
export async function apiChannel(link, key, getJson) {
  if (!key) return null;
  let u;
  try { u = new URL(String(link || '').trim()); } catch (_) { return null; }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const list = u.searchParams.get('list') || '';
  if (parts[0] === 'playlist' && /^[A-Za-z0-9_-]{10,64}$/.test(list)) {
    const j = await getJson(YT_API + 'playlists?part=snippet&id=' + encodeURIComponent(list) + '&key=' + encodeURIComponent(key));
    const it = ((j && j.items) || [])[0];
    if (!it) return null;
    const sn = it.snippet || {};
    return { feed_url: 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + list, name: sn.title || null,
             logo: ((sn.thumbnails || {}).high || {}).url || null, site_url: String(link).trim() };
  }
  let q = null;
  if (parts[0] && parts[0].startsWith('@')) q = 'forHandle=' + encodeURIComponent(parts[0]);
  else if (parts.length >= 2 && parts[0] === 'channel' && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1])) q = 'id=' + parts[1];
  else if (parts.length >= 2 && (parts[0] === 'user' || parts[0] === 'c')) q = 'forUsername=' + encodeURIComponent(parts[1]);
  if (!q) return null;
  const j = await getJson(YT_API + 'channels?part=snippet&' + q + '&key=' + encodeURIComponent(key));
  const it = ((j && j.items) || [])[0];
  if (!it || !/^UC[A-Za-z0-9_-]{22}$/.test(it.id || '')) return null;
  const sn = it.snippet || {}, th = sn.thumbnails || {};
  const logo = ['high', 'medium', 'default'].map(k => (th[k] || {}).url).find(Boolean) || null;
  return { feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + it.id, name: sn.title || null, logo,
           site_url: 'https://www.youtube.com/channel/' + it.id };
}
