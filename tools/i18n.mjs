#!/usr/bin/env node
/* The language files, as commands. docs/i18n.md explains the system; this is the tool for it.

     node tools/i18n.mjs status                         every language x pack: keys, and what is missing
     node tools/i18n.mjs conflicts                      the same English translated two ways across packs
     node tools/i18n.mjs add <entries.json>             merge translations into every language's files
     node tools/i18n.mjs remove <pack> <section> <english>...
     node tools/i18n.mjs new-pack <name> <page/>...      empty pack files for every language, pages wired
     node tools/i18n.mjs new-language <code> --native <name> --short <label> --locale <xx-YY>
                        [--decimal ,] [--caseless] [--join ''] [--like es]
     node tools/i18n.mjs export <code> [--out <file>]   the worklist: every key, the references, blanks to fill
     node tools/i18n.mjs import <code> <file>           write a filled worklist into <code>'s files
     node tools/i18n.mjs unhide <code>                  show a finished language in the picker

   entries.json — one block or a list of them:
     { "pack": "core" | "<pack>", "section": "phrases" | "units" | "exact" | "ctx.<name>",
       "entries": { "<English exactly as the page writes it>": { "ja": "…", "es": "…" } } }
   Every visible language must be given (so no language falls behind); pass --partial to allow
   less, e.g. while building a hidden one. An existing key is replaced. Patterns and context
   patterns are code, written by hand in the files; export lists the references for them. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EP = path.join(ROOT, 'epinoia');
const DIR = path.join(EP, 'i18n');
const ENGINE = path.join(EP, 'i18n.js');
const require = createRequire(import.meta.url);
const SECTIONS = ['phrases', 'units', 'exact'];

const langs = () => {
  delete require.cache[require.resolve(ENGINE)];
  return require(ENGINE).LANGS.filter(l => l.code !== 'en');
};
const fileOf = (code, pack) => pack === 'core' ? path.join(DIR, code + '.js') : path.join(DIR, code, pack + '.js');
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

/* ------------------------------------------------------------------ reading --- */
export function readDict(code, pack) {
  const f = fileOf(code, pack);
  if (!fs.existsSync(f)) return null;
  let dict = null;
  vm.runInNewContext(fs.readFileSync(f, 'utf8'), { window: { EpinoiaI18n: { register: (c, d, p) => {
    if (c === code && (p || 'core') === pack) dict = d;
  } } } });
  return dict;
}
export function packsOnDisk() {
  const all = new Set();
  for (const l of langs()) {
    const d = path.join(DIR, l.code);
    if (fs.existsSync(d)) fs.readdirSync(d).filter(f => f.endsWith('.js')).forEach(f => all.add(f.slice(0, -3)));
  }
  return [...all].sort();
}
const table = (dict, section) => {
  if (!dict) return {};
  if (section.startsWith('ctx.')) return (dict.ctx || {})[section.slice(4)] || {};
  return dict[section] || {};
};
const sectionsOf = dicts => {
  const s = new Set(SECTIONS);
  dicts.forEach(d => Object.keys((d && d.ctx) || {}).forEach(c => s.add('ctx.' + c)));
  return [...s];
};

/* ------------------------------------------------------- editing the source --- */
/* A small scanner that knows strings, comments and regex literals, so braces inside them do not
   count. Enough for the dictionary files, which are one object literal of tables. */
function scan(src, from, onChar) {
  let i = from, prev = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) return; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      i = j + 1; prev = 'x'; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev || ';')) {
      let j = i + 1, cls = false;
      while (j < src.length && (src[j] !== '/' || cls)) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        j++;
      }
      i = j + 1;
      while (/[a-z]/.test(src[i] || '')) i++;
      prev = 'x'; continue;
    }
    if (onChar(c, i) === false) return i;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
}
/* the index of the brace that closes the one at `open` */
function closeOf(src, open) {
  let depth = 0, at = -1;
  scan(src, open, (c, i) => {
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) { at = i; return false; } }
  });
  return at;
}
/* the `{` of `name: {` directly inside the object whose `{` is at `open`, or -1 */
function childObject(src, open, name) {
  const end = closeOf(src, open);
  let depth = 0, found = -1;
  const re = new RegExp('^(?:' + name + '|\'' + name + '\'|"' + name + '")\\s*:\\s*\\{');
  scan(src, open, (c, i) => {
    if (i > end) return false;
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (depth === 1 && /[A-Za-z'"]/.test(c) && /[\s,{]/.test(src[i - 1])) {
      const m = re.exec(src.slice(i, i + name.length + 40));
      if (m) { found = i + m[0].length - 1; return false; }
    }
  });
  return found;
}
/* the dictionary object literal: the `{` after register('xx', */
function dictOpen(src, code) {
  const m = new RegExp('register\\(\\s*[\'"]' + code + '[\'"]\\s*,\\s*\\{').exec(src);
  if (!m) throw new Error('no register(\'' + code + '\', {…}) found');
  return m.index + m[0].length - 1;
}
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const indentAt = (src, i) => { const ls = src.lastIndexOf('\n', i) + 1; return /^[ \t]*/.exec(src.slice(ls))[0]; };

/* insert or replace entries in one section of one file */
function writeEntries(file, code, section, entries) {
  let src = fs.readFileSync(file, 'utf8');
  const top = dictOpen(src, code);
  let open;
  if (section.startsWith('ctx.')) {
    let ctx = childObject(src, top, 'ctx');
    if (ctx < 0) src = addChild(src, top, 'ctx'), ctx = childObject(src, dictOpen(src, code), 'ctx');
    const name = section.slice(4);
    open = childObject(src, ctx, name);
    if (open < 0) { src = addChild(src, ctx, name); open = childObject(src, childObject(src, dictOpen(src, code), 'ctx'), name); }
  } else {
    open = childObject(src, top, section);
    if (open < 0) { src = addChild(src, top, section); open = childObject(src, dictOpen(src, code), section); }
  }
  const existing = table(readDictFromSource(src, code), section);
  /* the engine matches phrases whatever their case, so "match officials" replaces an existing
     "Match officials" rather than sitting beside it as a second copy */
  const byFold = new Map(Object.keys(existing).map(k => [k.toLowerCase(), k]));
  const add = [];
  for (const [k, v] of Object.entries(entries)) {
    const have = Object.prototype.hasOwnProperty.call(existing, k) ? k
      : section === 'exact' ? null : byFold.get(k.toLowerCase()) || null;
    if (have != null) src = replaceValue(src, open, have, v);
    else add.push([k, v]);
  }
  if (add.length) {
    const close = closeOf(src, open);
    const inner = src.slice(open + 1, close);
    const pad = indentAt(src, open) + '  ';
    const needsComma = /[^\s,{]\s*$/.test(inner.replace(/\/\/[^\n]*$|\/\*[\s\S]*?\*\/\s*$/g, ''));
    const body = add.map(([k, v]) => pad + q(k) + ': ' + q(v)).join(',\n');
    const lead = inner.trim() ? (needsComma ? ',' : '') + '\n' : '\n';
    src = src.slice(0, close).replace(/\s*$/, '') + lead + body + '\n' + indentAt(src, close) + src.slice(close);
  }
  fs.writeFileSync(file, src.replace(/\r\n/g, '\n'), 'utf8');
  readDictFromSource(fs.readFileSync(file, 'utf8'), code);        // throws if the edit broke it
  return add.length;
}
function addChild(src, open, name) {
  const close = closeOf(src, open);
  const inner = src.slice(open + 1, close);
  const pad = indentAt(src, open) + '  ';
  const comma = inner.trim() && !/,\s*$/.test(inner) ? ',' : '';
  return src.slice(0, close).replace(/\s*$/, '') + comma + '\n' + pad + name + ': {\n' + pad + '}\n' +
         indentAt(src, close) + src.slice(close);
}
function replaceValue(src, open, key, value) {
  const close = closeOf(src, open);
  for (const lit of [q(key), JSON.stringify(key)]) {
    let at = src.indexOf(lit, open);
    while (at > 0 && at < close) {
      const after = /^\s*:\s*/.exec(src.slice(at + lit.length));
      if (after) {
        const vStart = at + lit.length + after[0].length;
        const quote = src[vStart];
        let j = vStart + 1;
        while (j < src.length && src[j] !== quote) j += src[j] === '\\' ? 2 : 1;
        return src.slice(0, vStart) + q(value) + src.slice(j + 1);
      }
      at = src.indexOf(lit, at + 1);
    }
  }
  throw new Error('could not find the entry "' + key + '" to replace');
}
function readDictFromSource(src, code) {
  let dict = null;
  vm.runInNewContext(src, { window: { EpinoiaI18n: { register: (c, d) => { if (c === code) dict = d; } } } });
  if (!dict) throw new Error('the file no longer registers ' + code);
  return dict;
}

/* ----------------------------------------------------------------- commands --- */
function status() {
  const L = langs(), packs = ['core'].concat(packsOnDisk());
  let problems = 0;
  for (const pack of packs) {
    const dicts = L.map(l => readDict(l.code, pack));
    const secs = sectionsOf(dicts);
    const union = new Map();
    secs.forEach(s => dicts.forEach(d => Object.keys(table(d, s)).forEach(k => union.set(s + '\u0000' + k, [s, k]))));
    console.log('\n' + pack + ' (' + union.size + ' keys)');
    L.forEach((l, i) => {
      const d = dicts[i];
      if (!d) { problems++; console.log('  ' + l.code + '  MISSING FILE ' + rel(fileOf(l.code, pack))); return; }
      const miss = [...union.values()].filter(([s, k]) => !(k in table(d, s)) || !String(table(d, s)[k]).trim());
      if (miss.length) problems++;
      console.log('  ' + l.code + (l.hidden ? ' (hidden)' : '') + '  ' + (union.size - miss.length) + '/' + union.size +
                  (miss.length ? '  missing: ' + miss.slice(0, 6).map(([s, k]) => s + ':' + JSON.stringify(k)).join(', ') +
                    (miss.length > 6 ? ' … +' + (miss.length - 6) : '') : '  complete'));
    });
  }
  console.log(problems ? '\n' + problems + ' language/pack pairs need work' : '\nevery language has every key');
}

/* the same English translated two ways in different packs (or a pack and core): one term per
   meaning is the point of precedent, so each of these is either a real difference of context
   (then it belongs in a ctx table) or a slip to settle */
function conflicts() {
  const packs = ['core'].concat(packsOnDisk());
  let n = 0;
  for (const l of langs()) {
    const seen = new Map();
    for (const pack of packs) {
      const d = readDict(l.code, pack);
      if (!d) continue;
      for (const s of sectionsOf([d])) {
        for (const [k, v] of Object.entries(table(d, s))) {
          const key = s + '\u0000' + k.toLowerCase();
          if (!seen.has(key)) seen.set(key, []);
          seen.get(key).push({ pack, v });
        }
      }
    }
    const rows = [...seen].filter(([, xs]) => new Set(xs.map(x => x.v.toLowerCase())).size > 1);
    if (!rows.length) continue;
    console.log('\n' + l.code + ': ' + rows.length + ' English strings with more than one translation');
    for (const [key, xs] of rows) {
      n++;
      const [s, k] = key.split('\u0000');
      console.log('  ' + s + ' ' + JSON.stringify(k) + '  ' + xs.map(x => x.pack + '=' + JSON.stringify(x.v)).join('  '));
    }
  }
  if (!n) console.log('one translation per English string, in every language');
}

function addCmd(file, partial) {
  const blocks = [].concat(JSON.parse(fs.readFileSync(file, 'utf8')));
  const L = langs(), visible = L.filter(l => !l.hidden).map(l => l.code);
  for (const b of blocks) {
    const pack = b.pack || 'core', section = b.section || 'phrases';
    if (!/^(phrases|units|exact|ctx\.[a-z][a-z0-9_]*)$/.test(section)) throw new Error('unknown section ' + section);
    for (const [en, tr] of Object.entries(b.entries || {})) {
      const lacking = visible.filter(c => !tr[c] || !String(tr[c]).trim());
      if (lacking.length && !partial) throw new Error('"' + en + '" has no ' + lacking.join(', ') + ' (every visible language, or --partial)');
    }
    for (const l of L) {
      const entries = {};
      for (const [en, tr] of Object.entries(b.entries || {})) if (tr[l.code] && String(tr[l.code]).trim()) entries[en] = tr[l.code];
      if (!Object.keys(entries).length) continue;
      const f = fileOf(l.code, pack);
      if (!fs.existsSync(f)) throw new Error(rel(f) + ' does not exist (new-pack first)');
      const n = writeEntries(f, l.code, section, entries);
      console.log(rel(f) + '  ' + section + ': ' + n + ' added, ' + (Object.keys(entries).length - n) + ' replaced');
    }
  }
}

function removeCmd(pack, section, keys) {
  for (const l of langs()) {
    const f = fileOf(l.code, pack);
    if (!fs.existsSync(f)) continue;
    let src = fs.readFileSync(f, 'utf8');
    for (const k of keys) {
      for (const lit of [q(k), JSON.stringify(k)]) {
        const re = new RegExp('\\n[ \\t]*' + lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*"),?');
        src = src.replace(re, '');
      }
    }
    src = src.replace(/,(\s*\n[ \t]*\})/g, '$1');
    readDictFromSource(src, l.code);
    fs.writeFileSync(f, src, 'utf8');
    console.log(rel(f) + '  removed from ' + section + ': ' + keys.length);
  }
}

const HEADER = (what, code) => "'use strict';\n/* " + what + ' Keys are the English on screen; every language carries the same keys\n' +
  '   (supabase/tests/i18n.test.mjs). No other site is named in these files. */\n' +
  '(function () {\n  const I = window.EpinoiaI18n;\n  if (!I) return;\n';

function newPack(name, pages) {
  if (!/^[a-z][a-z0-9]*$/.test(name)) throw new Error('a pack name is lower-case letters and digits');
  for (const l of langs()) {
    const f = fileOf(l.code, name);
    if (fs.existsSync(f)) { console.log(rel(f) + '  exists'); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, HEADER('The "' + name + '" pack, ' + l.native + '.', l.code) +
      "  I.register('" + l.code + "', {\n    phrases: {\n    }\n  }, '" + name + "');\n})();\n", 'utf8');
    console.log(rel(f) + '  created');
  }
  for (const p of pages) {
    const f = path.join(EP, p.replace(/\/?$/, '/'), 'index.html');
    if (!fs.existsSync(f)) { console.log(p + '  no index.html'); continue; }
    let html = fs.readFileSync(f, 'utf8');
    const m = /<script src="([./]*)i18n\.js(\?v=\d+)?"(?: data-i18n-packs="([^"]*)")?><\/script>/.exec(html);
    if (!m) { console.log(rel(f) + '  has no i18n.js tag'); continue; }
    const list = (m[3] || '').split(/\s+/).filter(Boolean);
    if (list.indexOf(name) >= 0) { console.log(rel(f) + '  already asks for ' + name); continue; }
    list.push(name);
    html = html.slice(0, m.index) + '<script src="' + m[1] + 'i18n.js' + (m[2] || '') + '" data-i18n-packs="' + list.join(' ') + '"></script>' + html.slice(m.index + m[0].length);
    fs.writeFileSync(f, html, 'utf8');
    console.log(rel(f) + '  now loads ' + list.join(' '));
  }
}

function newLanguage(code, o) {
  if (!/^[a-z]{2,3}$/.test(code)) throw new Error('a language code is two or three lower-case letters');
  if (langs().some(l => l.code === code)) throw new Error(code + ' is already in LANGS');
  for (const k of ['native', 'short', 'locale']) if (!o[k]) throw new Error('--' + k + ' is required');
  const like = o.like || 'es';
  /* the registry: one line in LANGS, hidden from the picker until the language is complete */
  let eng = fs.readFileSync(ENGINE, 'utf8');
  const at = eng.indexOf('\n  ];', eng.indexOf('const LANGS = ['));
  const line = "    { code: '" + code + "', native: " + q(o.native) + ', short: ' + q(o.short) +
               ', locale: ' + q(o.locale) + ', hidden: true }';
  eng = eng.slice(0, at).replace(/\s*$/, '') + ',\n' + line + eng.slice(at);
  fs.writeFileSync(ENGINE, eng, 'utf8');
  console.log(rel(ENGINE) + '  LANGS += ' + code + ' (hidden)');
  /* the core file: its settings, the reference's keep list (the leagues' English), empty tables */
  const ref = readDict(like, 'core') || {};
  const settings = ["    locale: " + q(o.locale) + ','];
  if (o.caseless) settings.push('    caseless: true,');
  if (o.decimal && o.decimal !== '.') settings.push('    decimal: ' + q(o.decimal) + ',');
  if (o.join != null) settings.push('    sentenceJoin: ' + q(o.join) + ',');
  const f = fileOf(code, 'core');
  fs.writeFileSync(f, HEADER(o.native + '. The words follow what this language\'s basketball box scores, standings,\n' +
    '   live text and media print (precedent, not a dictionary).', code) +
    "  I.register('" + code + "', {\n" + settings.join('\n') + '\n' +
    '    keep: [' + (ref.keep || []).map(q).join(', ') + '],\n' +
    '    exact: {\n    },\n    phrases: {\n    },\n    ctx: {\n    },\n    units: {\n    },\n' +
    '    /* write these by hand: see export\'s "patterns" for the references in the other languages */\n' +
    '    patterns: [\n    ]\n  });\n})();\n', 'utf8');
  console.log(rel(f) + '  created');
  for (const p of packsOnDisk()) {
    const r = readDict(like, p) || {};
    const pf = fileOf(code, p);
    fs.mkdirSync(path.dirname(pf), { recursive: true });
    fs.writeFileSync(pf, HEADER('The "' + p + '" pack, ' + o.native + '.', code) +
      "  I.register('" + code + "', {\n    phrases: {\n    }" +
      (r.sentences ? ',\n    sentences: [' + r.sentences.map(q).join(', ') + '],\n    ctxPatterns: {\n    }' : '') +
      "\n  }, '" + p + "');\n})();\n", 'utf8');
    console.log(rel(pf) + '  created');
  }
  console.log('\nnext: node tools/i18n.mjs export ' + code + ' --out <file>, fill it, import it, write the patterns, then status and the tests');
}

function exportCmd(code, out) {
  const L = langs();
  const refs = L.filter(l => l.code !== code && !l.hidden).map(l => l.code);
  const items = [];
  const patterns = [];
  for (const pack of ['core'].concat(packsOnDisk())) {
    const dicts = Object.fromEntries(L.map(l => [l.code, readDict(l.code, pack)]));
    const secs = sectionsOf(Object.values(dicts));
    const keys = new Map();
    secs.forEach(s => Object.values(dicts).forEach(d => Object.keys(table(d, s)).forEach(k => keys.set(s + '\u0000' + k, [s, k]))));
    for (const [s, k] of keys.values()) {
      const row = { pack, section: s, en: k };
      refs.forEach(r => { row[r] = table(dicts[r], s)[k] || ''; });
      row[code] = table(dicts[code], s)[k] || '';
      items.push(row);
    }
    refs.forEach(r => {
      const src = fs.existsSync(fileOf(r, pack)) ? fs.readFileSync(fileOf(r, pack), 'utf8') : '';
      const m = /\n\s*(patterns|ctxPatterns)\s*:\s*[[{][\s\S]*$/.exec(src);
      if (m) patterns.push({ pack, language: r, source: src.slice(m.index).trim().slice(0, 20000) });
    });
  }
  const doc = { language: code, references: refs, todo: items.filter(i => !i[code]).length, items, patterns,
    how: 'Fill each item\'s "' + code + '" with the words this language\'s basketball sites and media print ' +
         '(precedent). Leave names, codes and brand words as they are. Then: node tools/i18n.mjs import ' + code + ' <this file>' };
  const text = JSON.stringify(doc, null, 1);
  if (out) { fs.writeFileSync(out, text, 'utf8'); console.log(out + '  ' + items.length + ' items, ' + doc.todo + ' to fill'); }
  else console.log(text);
}

function importCmd(code, file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const groups = new Map();
  for (const it of doc.items || []) {
    const v = it[code];
    if (!v || !String(v).trim()) continue;
    const k = it.pack + '\u0000' + it.section;
    if (!groups.has(k)) groups.set(k, { pack: it.pack, section: it.section, entries: {} });
    groups.get(k).entries[it.en] = v;
  }
  let n = 0;
  for (const g of groups.values()) {
    const f = fileOf(code, g.pack);
    if (!fs.existsSync(f)) throw new Error(rel(f) + ' does not exist');
    writeEntries(f, code, g.section, g.entries);
    n += Object.keys(g.entries).length;
  }
  console.log(code + ': ' + n + ' entries written. Next: node tools/i18n.mjs status');
}

function unhide(code) {
  let eng = fs.readFileSync(ENGINE, 'utf8');
  const re = new RegExp("(\\{ code: '" + code + "'[^\\n]*?), hidden: true \\}");
  if (!re.test(eng)) throw new Error(code + ' is not a hidden language');
  eng = eng.replace(re, '$1 }');
  fs.writeFileSync(ENGINE, eng, 'utf8');
  console.log(code + ' is in the picker. Run the tests: every visible language is now held to every key.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
  const flag = n => args.includes('--' + n);
  const plain = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(native|short|locale|decimal|join|like|out)$/));
  try {
    if (cmd === 'status') status();
    else if (cmd === 'conflicts') conflicts();
    else if (cmd === 'add') addCmd(plain[0], flag('partial'));
    else if (cmd === 'remove') removeCmd(plain[0], plain[1], plain.slice(2));
    else if (cmd === 'new-pack') newPack(plain[0], plain.slice(1));
    else if (cmd === 'new-language') newLanguage(plain[0], { native: opt('native'), short: opt('short'), locale: opt('locale'),
      decimal: opt('decimal'), caseless: flag('caseless'), join: opt('join'), like: opt('like') });
    else if (cmd === 'export') exportCmd(plain[0], opt('out'));
    else if (cmd === 'import') importCmd(plain[0], plain[1]);
    else if (cmd === 'unhide') unhide(plain[0]);
    else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(cmd ? 1 : 0); }
  } catch (e) { console.error('i18n: ' + e.message); process.exit(1); }
}
