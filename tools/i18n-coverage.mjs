#!/usr/bin/env node
/* What the language dictionaries (epinoia/i18n/<code>.js and the packs in epinoia/i18n/<code>/)
   do not cover yet.

   Lists the English UI strings the pages put on screen, most-used first, and which of them a
   language cannot translate. Advisory: the extraction is a heuristic over the source, so it
   includes some code keys and misses text assembled at runtime (for that, open the page with
   ?lang=ja&i18n=misses and run EpinoiaI18n.misses()).

     node tools/i18n-coverage.mjs                          summary, 40 most-used misses per language
     node tools/i18n-coverage.mjs ja --all                 every miss for one language
     node tools/i18n-coverage.mjs es --min 3               misses used in at least 3 files
     node tools/i18n-coverage.mjs ja --only game/ --pack game --pack report --all
                                                           one area, counting its packs
     node tools/i18n-coverage.mjs ja --only admin/ --json  the misses as JSON, for a script */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EP = path.join(ROOT, 'epinoia');
const require = createRequire(import.meta.url);
const core = require(path.join(EP, 'i18n.js'));

function run(file, code, pack) {
  const src = fs.readFileSync(file, 'utf8');
  let dict = null;
  vm.runInNewContext(src, { window: { EpinoiaI18n: { register: (c, d, p) => {
    if (c === code && (p || null) === (pack || null)) dict = d;
  } } } });
  return dict;
}

/* core, plus the named packs that exist */
export function loadDict(code, packs = []) {
  const base = run(path.join(EP, 'i18n', code + '.js'), code, null);
  if (!base) throw new Error('i18n/' + code + '.js registered nothing for ' + code);
  const parts = [base];
  for (const p of packs) {
    const f = path.join(EP, 'i18n', code, p + '.js');
    if (fs.existsSync(f)) { const d = run(f, code, p); if (d) parts.push(d); }
  }
  return core.compile(code, core.merge(parts));
}

/* the reader-facing default; --only reaches into any of these on purpose */
const SKIP_DIRS = /[\\/](vendor|android[\\/]app|ios[\\/](?!index)|brand|fonts|i18n)([\\/]|$)/;
const STOP = new Set(('div span a b i p li ul ol tr td th tbody thead table section article header footer nav main ' +
  'button input select option label img svg path small strong em time canvas video source iframe click change ' +
  'keydown keyup load error submit scroll resize focus blur hidden none block flex grid auto true false null ' +
  'undefined object string number function get post put patch delete utf-8 json text html css on off open ' +
  'close left right top bottom center start end id name key value type role style class href src alt title').split(' '));
const CODE = /^(use strict|GET|POST|PUT|PATCH|DELETE|Bearer|numeric|2-digit|short|long|narrow|smooth|lazy|nearest|auto|none|anonymous|same-origin|no-store|no-cache|application|text|utf-8)$/;

function looksLikeUi(s) {
  s = s.trim();
  if (!s || !/[A-Za-z]/.test(s) || s.length > 400) return false;
  if (/^(https?:|\/|\.\.?\/|#|\?|&|--|@)/.test(s)) return false;
  if (/[{};=<>\\]|\$\{|=>/.test(s)) return false;
  if (!s.includes(' ') && /[-_.:/]/.test(s) && !/^[A-Z0-9+/%:.-]+$/.test(s)) return false;
  if (/^[a-z]+[A-Z]\w*$/.test(s)) return false;
  if (STOP.has(s) || CODE.test(s)) return false;
  /* a lone lower-case word is usually a key, a class or a date option, not something on screen */
  if (!/\s/.test(s) && /^[a-z0-9]+$/.test(s) && s.length < 5) return false;
  return /^[\w'’ ,.!?:;()%+/&—–\- ·…“”‘#±«»"]+$/.test(s);
}

function* files(dir, only) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(EP, p).replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (/(^|\/)(vendor|brand|fonts|i18n)$/.test(rel)) continue;
      if (!only.length && SKIP_DIRS.test(p + path.sep)) continue;
      yield* files(p, only);
    } else if (/\.(js|html)$/.test(e.name) && e.name !== 'i18n.js') {
      if (only.length && !only.some(o => rel === o || rel.startsWith(o))) continue;
      yield p;
    }
  }
}

export function inventory(only = []) {
  const seen = new Map();
  const add = (s, rel) => {
    s = s.replace(/\s+/g, ' ').trim();
    if (!looksLikeUi(s)) return;
    if (!seen.has(s)) seen.set(s, new Set());
    seen.get(s).add(rel);
  };
  for (const p of files(EP, only)) {
    const rel = path.relative(EP, p).replace(/\\/g, '/');
    let src = fs.readFileSync(p, 'utf8');
    if (p.endsWith('.html')) {
      /* a single-file app (the scorer) keeps its UI in <script>; read the markup, then the code */
      const scripts = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
      const body = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ');
      for (const m of body.matchAll(/>([^<>]{1,400})</g)) add(m[1], rel);
      for (const m of body.matchAll(/\b(?:title|placeholder|aria-label)="([^"]{1,200})"/g)) add(m[1], rel);
      if (scripts) scan(scripts, rel, add);
    } else {
      scan(src, rel, add);
    }
  }
  return [...seen].map(([s, set]) => ({ s, n: set.size, files: [...set].sort() }))
    .sort((a, b) => b.n - a.n || a.s.localeCompare(b.s));
}

function scan(src, rel, add) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[;,{}()\s])\/\/[^\n]*/g, '$1');
  for (const m of src.matchAll(/(?<![\w$])(['"])((?:\\.|(?!\1).){1,300}?)\1/g)) {
    add(m[2].replace(/\\u00a0|\\xa0/g, ' ').replace(/\\(['"])/g, '$1'), rel);
  }
  for (const m of src.matchAll(/`((?:\\.|[^`])*)`/g)) {
    for (const t of m[1].matchAll(/>([^<>{}$`]{1,300})</g)) add(t[1], rel);
    /* a template with no markup is itself the text, holes and all: report it with its holes */
    if (!/[<>]/.test(m[1]) && /\$\{/.test(m[1]) && /[a-z]{3,} [a-z]{3,}/.test(m[1])) add(m[1].replace(/\$\{[^}]*\}/g, '…'), rel);
  }
}

/* an abbreviation is only ever a column header or a stat label, so it is asked about there */
export const ctxFor = s => (/^[A-Z0-9%+/.#± -]{1,14}$/.test(s) && /[A-Z]/.test(s) ? ['col'] : []);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = n => { const out = []; args.forEach((a, i) => { if (a === n && args[i + 1]) out.push(args[i + 1]); }); return out; };
  const only = opt('--only');
  const packs = opt('--pack');
  const code1 = args.find((a, i) => /^[a-z]{2}$/.test(a) && !/^--/.test(args[i - 1] || ''));
  const all = args.includes('--all');
  const asJson = args.includes('--json');
  const min = +(opt('--min')[0] || 1);
  const inv = inventory(only).filter(r => r.n >= min);
  const codes = core.LANGS.map(l => l.code).filter(c => c !== 'en' && (!code1 || c === code1));
  const report = {};
  for (const code of codes) {
    const D = loadDict(code, packs);
    report[code] = inv.filter(r => core.translateText(D, r.s, ctxFor(r.s)) == null);
  }
  if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
  console.log(inv.length + ' English UI strings' + (only.length ? ' under ' + only.join(', ') : '') +
              (min > 1 ? ' (in ' + min + '+ files)' : '') + (packs.length ? ', with packs ' + packs.join(', ') : ''));
  for (const code of codes) {
    const miss = report[code];
    const pct = inv.length ? (100 * (inv.length - miss.length) / inv.length).toFixed(1) : '100';
    console.log('\n' + code + ': ' + (inv.length - miss.length) + ' translated (' + pct + '%), ' + miss.length + ' not yet');
    for (const r of (all ? miss : miss.slice(0, 40))) {
      console.log('  ' + String(r.n).padStart(3) + '  ' + JSON.stringify(r.s) + '   ' + r.files.slice(0, 3).join(', '));
    }
  }
}
