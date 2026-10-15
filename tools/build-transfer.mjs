#!/usr/bin/env node
/* ============================================================================
   THE TRANSFER MATRIX'S DATA: the scraped player-stats files -> two members' files, gzipped, NEVER published.

     node tools/build-transfer.mjs --src <dir>           read <dir>/player_stats*.csv, write transfermatrix/build/
                                                         (or set EPINOIA_TRANSFER_SRC instead of --src)
     node tools/build-transfer.mjs --out <dir>           write somewhere else (never under epinoia/)
     node tools/build-transfer.mjs --built 2026-10-15    the date written into both (default: today, UTC)
     node tools/build-transfer.mjs --dry                 build and report, write nothing
   then
     node tools/upload-transfer.mjs [--dry-run]          put them in the private bucket and index them (docs/transfer-matrix.md)

   The CSVs are the scraped player-stats files the old standalone Transfer Matrix read: one row per player, club, league
   and season, 97 men's leagues. THEY ARE NOT IN THIS REPOSITORY (it is public; removed 2026-10-15): they live in the
   scrape sessions on the processing PC, and --src names the folder. They and everything made from them stay off the
   website: transfermatrix/ is on
   tools/build-site.py's never-publish list (TOP_NEVER), and transfermatrix/build/ is in .gitignore as well, so the
   files are neither published nor committed. A reader gets them only through the analytics-file function, which asks
   the database first (analytics_check, scopes 'transfer' and 'tscale', the 'transferMatrix' gate; migration 0265) and
   answers with a two-minute signed URL into the private 'analytics' bucket.

   Everything is computed by the page's own engine (epinoia/scouting/transfer/engine.js). The files are merged exactly as
   the old app merged them: player_stats.csv, then player_stats2.csv, ... by number; a row is keyed on the player's source
   id + season + league + club and the row with the most minutes wins; the older archive's MSL- identities are matched
   onto the main ids; then one stint per player, league and season, minutes-weighted.

   OUT (transfermatrix/build/):
   1. transfer.bin.gz - THE STORE THE PAGE LOADS: engine.encodeStore (format 2, 'TMS2', binary columns, described in
      engine.js) gzipped at level 9. Every stint, in the CSV path's order; players as numbers counted from 1 (the source's
      ids, addresses and name are not in it: checked below and by supabase/tests/transfer-matrix.test.mjs); every stat to
      two decimals (a single-club season is exactly what the CSV says, a season split between clubs its minutes-weighted
      mean to 0.005).
   2. tscale.json.gz - THE PUBLISHED SCALE, for the pages that adjust a stat from one league to another (compare and the
      player profile, through EpinoiaTransferData.load('tscale')). It is the matrix at its defaults - BLEND, robust
      weighting on, talent curve off, every season, no league left out - computed from the store itself, so it agrees
      with the page to the digit:
        { "version": 1, "built": "YYYY-MM-DD", "seasons": [first, last],
          "settings": { "mode": "blend", "robust": true, "talent": false, "kBlend": 30, "anchor": "Spanish ACB" },
          "stats": ["BPM","TS_pct","USG_pct","ORB_pct","DRB_pct","AST_pct","TOV_pct","STL_pct","BLK_pct"],
          "meta": [ {k, lab, dec, lo, hi, signed?, inverse?} x 9 ],        each stat's label, decimals and range
          "leagues": { "<league>": {
              "net":      [9] or null,   the network-scale coefficient per stat, against the anchor (anchor = 0);
                                         null for a league with no moves at all
              "mean":     [9] or null,   the league's minutes-weighted average per stat (a stat with no minutes: null)
              "strength": [bpm, grade],  the BPM coefficient and its grade, 100 + 10 x bpm
              "stints":   n,             player-seasons with a BPM
              "seasons":  [first, last] } },
          "pairs": { "<F>><T>": [ [meanShift, n] or null x 9 ] } }       the moves on the route F -> T, both ways
                                         (T -> F sign-flipped), minutes-weighted mean shift and how many (robust: unique
                                         movers); only routes with any move; null for a stat no mover had
      THE ADJUST RULE (the page's BLEND): for a value v of stat k moving from league F to league T,
          emp, n = pairs["F>T"][k]  (none: n = 0)
          w      = n / (n + kBlend)
          diff   = w x emp + (1 - w) x (net[F][k] - net[T][k])
          proj   = min(meta[k].hi, max(meta[k].lo, v + diff))
      How sure: n >= 150 high, >= 40 moderate, >= 10 sparse, else the network model alone. TOV% is better lower (inverse).
   3. manifest.json - what upload-transfer.mjs reads: for each file its name, token (the first 20 hex digits of the
      SHA-256 of the gzipped bytes, so a rebuild with nothing new keeps its token and readers their cached copy), bytes
      gzipped and raw, layout, and the build date.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = require(path.join(ROOT, 'epinoia', 'scouting', 'transfer', 'engine.js'));
export const OUT_DEFAULT = path.join(ROOT, 'transfermatrix', 'build');
export const FILES = { transfer: 'transfer.bin.gz', tscale: 'tscale.json.gz' };

/* the files, in the old app's order: player_stats.csv first, then by the number in the name */
export function csvFiles(dir) {
  return fs.readdirSync(dir).filter(n => /^player_stats\d*\.csv$/i.test(n))
    .sort((a, b) => (parseInt((a.match(/\d+/) || ['1'])[0], 10) - parseInt((b.match(/\d+/) || ['1'])[0], 10)));
}
/* what must never be in a members' file: an address, or the source's own player-page path or ids */
export function leaks(text) {
  const bad = [];
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(text)) bad.push('an address (://)');
  if (/\bwww\./i.test(text)) bad.push('a www. host');
  if (/\/(player|players|team|teams)\/[^"]*\/(summary|stats)?/i.test(text)) bad.push('a source page path');
  if (/MSL-\d/.test(text)) bad.push('a source id (MSL-)');
  return bad;
}
/* the scale written one league and one route to a line: valid JSON, and two builds compare as text */
export function scaleText(S) {
  const head = Object.assign({}, S); delete head.leagues; delete head.pairs;
  const top = JSON.stringify(head).slice(0, -1);
  const lines = o => Object.keys(o).map(k => JSON.stringify(k) + ':' + JSON.stringify(o[k])).join(',\n');
  return top + ',\n"leagues":{\n' + lines(S.leagues) + '\n},\n"pairs":{\n' + lines(S.pairs) + '\n}}\n';
}
/* the store's header (all its strings) as text, for the leak check */
export function storeHeader(bin) {
  const hl = new DataView(bin.buffer, bin.byteOffset, bin.byteLength).getUint32(4, true);
  return new TextDecoder().decode(bin.subarray(8, 8 + hl));
}
export const gzip = b => zlib.gzipSync(b, { level: 9 });
export const tokenOf = gz => crypto.createHash('sha256').update(gz).digest('hex').slice(0, 20);
/* the out folder may be anywhere but where the website is assembled from */
export function safeOut(dir) {
  const rel = path.relative(ROOT, path.resolve(dir)).replace(/\\/g, '/');
  return !(rel === 'epinoia' || rel.startsWith('epinoia/') || ['.well-known', 'brand', 'prophesy'].some(d => rel === d || rel.startsWith(d + '/')) || rel === '');
}
const mb = n => (n / 1e6).toFixed(2) + ' MB';

/* RAW -> {transfer: {bin, gz}, tscale: {text, gz}, S, D} with every check made */
export function build(RAW, built) {
  const bin = E.encodeStore(RAW, { built });
  const bad = leaks(storeHeader(bin));
  if (bad.length) throw new Error('REFUSED: the store would carry ' + bad.join(', '));
  /* the scale, from the store exactly as the page reads it */
  const R2 = E.decodeStore(bin);
  const D = E.deriveD(R2, R2.years[R2.years.length - 1], R2.years[0], {});
  const S = E.scaleFile(R2, D, { built });
  const text = scaleText(S);
  JSON.parse(text);
  const sbad = leaks(text);
  if (sbad.length) throw new Error('REFUSED: the scale would carry ' + sbad.join(', '));
  return { transfer: { bin, gz: gzip(bin) }, tscale: { text, gz: gzip(Buffer.from(text, 'utf8')) }, S, D, R2 };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const given = arg('--src') || process.env.EPINOIA_TRANSFER_SRC;
  if (!given) {
    console.error('the scraped player-stats files are not in the repository: name their folder with --src <dir> ' +
                  '(or EPINOIA_TRANSFER_SRC)');
    process.exit(2);
  }
  const SRC = path.resolve(given);
  const OUT = path.resolve(arg('--out') || OUT_DEFAULT);
  const BUILT = arg('--built') || new Date().toISOString().slice(0, 10);
  const DRY = argv.includes('--dry');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(BUILT)) { console.error('--built must be YYYY-MM-DD'); process.exit(2); }
  if (!safeOut(OUT)) { console.error('REFUSED: ' + OUT + ' is a folder the website is published from'); process.exit(2); }
  const names = csvFiles(SRC);
  if (!names.length) { console.error('no player_stats*.csv in ' + SRC); process.exit(1); }
  console.log('reading ' + names.length + ' files from ' + path.relative(ROOT, SRC).replace(/\\/g, '/') + ': ' + names.join(', '));
  const t0 = Date.now();
  const RAW = E.ingestCSV(names.map(n => fs.readFileSync(path.join(SRC, n), 'utf8')), { log: m => console.log('  ' + m) });
  console.log('  ' + RAW.allTransfers.length + ' moves across ' + RAW.allLeagues.length + ' leagues, seasons ' +
    RAW.yearLabel.get(RAW.years[RAW.years.length - 1]) + ' to ' + RAW.yearLabel.get(RAW.years[0]) + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  let out;
  try { out = build(RAW, BUILT); } catch (e) { console.error(e.message); process.exit(1); }
  const { transfer, tscale, S, D } = out;
  console.log(FILES.transfer + ': ' + mb(transfer.bin.length) + ' raw, ' + mb(transfer.gz.length) + ' gzipped');
  console.log(FILES.tscale + ': ' + Object.keys(S.leagues).length + ' leagues, ' + Object.keys(S.pairs).length + ' routes, ' +
    mb(tscale.text.length) + ' raw, ' + mb(tscale.gz.length) + ' gzipped');

  /* the store against the files themselves: how far two decimals move the scale */
  const lo = RAW.years[RAW.years.length - 1], hi = RAW.years[0];
  const D0 = E.deriveD(RAW, lo, hi, {});
  let net = 0, pair = 0;
  D0.leagues.forEach((nm, i) => { const j = D.leagues.indexOf(nm); D0.net[i].forEach((v, k) => { net = Math.max(net, Math.abs(v - D.net[j][k])); }); });
  for (const key of Object.keys(D0.pairs)) {
    const [i, j] = key.split('>').map(Number), k2 = D.leagues.indexOf(D0.leagues[i]) + '>' + D.leagues.indexOf(D0.leagues[j]);
    D0.pairs[key].forEach((x, k) => { const y = D.pairs[k2] && D.pairs[k2][k]; if (y) pair = Math.max(pair, Math.abs(x[0] - y[0])); });
  }
  console.log('the store against the CSVs: largest change in a league coefficient ' + net.toFixed(3) + ', in a route shift ' + pair.toFixed(3));

  const manifest = { built: BUILT,
    transfer: { file: FILES.transfer, token: tokenOf(transfer.gz), bytes: transfer.gz.length, raw: transfer.bin.length, layout: E.STORE_V },
    tscale: { file: FILES.tscale, token: tokenOf(tscale.gz), bytes: tscale.gz.length, raw: Buffer.byteLength(tscale.text), layout: 1 } };
  if (DRY) { console.log('(dry run: nothing written)\n' + JSON.stringify(manifest, null, 1)); return; }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, FILES.transfer), transfer.gz);
  fs.writeFileSync(path.join(OUT, FILES.tscale), tscale.gz);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log('wrote ' + [FILES.transfer, FILES.tscale, 'manifest.json'].map(f => path.relative(ROOT, path.join(OUT, f)).replace(/\\/g, '/')).join(', '));
  console.log('next: node tools/upload-transfer.mjs --dry-run, then node tools/upload-transfer.mjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
