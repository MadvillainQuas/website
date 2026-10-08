/* ============================================================================
   THE MATCH REPORTS' TRANSLATION GAPS, ON REAL GAMES.

   report-i18n.test.mjs holds the templates someone remembered to list; this finds the ones nobody did. It reads reports
   written from real games (`node supabase/tests/report-eval.mjs --ctx --limit 40 --dump reports.json`), translates every
   sentence as the game page does (the headline as a news card does; the standfirst and the paragraphs in the 'report'
   context, a paragraph split into sentences), and lists the sentences that come back untranslated or with English left
   in them, grouped by template (the game's names out as X, figures as N), the most common first.

       node supabase/tests/report-i18n-gaps.mjs reports.json            every visible language, the top 25 each
       node supabase/tests/report-i18n-gaps.mjs reports.json ja --all   one language, every gap, with an example of each
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const require = createRequire(import.meta.url);
const core = require(path.join(EP, 'i18n.js'));

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.log('usage: node supabase/tests/report-i18n-gaps.mjs <reports.json> [ja|es] [--all]'); process.exit(1); }
const only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const all = process.argv.includes('--all');
const reports = JSON.parse(fs.readFileSync(file, 'utf8'));

function registered(f) {
  const got = [];
  if (!fs.existsSync(f)) return got;
  vm.runInNewContext(fs.readFileSync(f, 'utf8'), { window: { EpinoiaI18n: { register: (c, d, pack) => got.push({ code: c, dict: d, pack: pack || null }) } } });
  return got;
}
/* the packs the game page loads (game, report), over the core */
function dictFor(code) {
  const dicts = [registered(path.join(EP, 'i18n', code + '.js')).find(x => x.code === code && !x.pack)];
  ['game', 'report'].forEach(p => dicts.push(registered(path.join(EP, 'i18n', code, p + '.js')).find(x => x.code === code && x.pack === p)));
  return core.compile(code, core.merge(dicts.filter(Boolean).map(x => x.dict)));
}

/* a translation still carrying an English word no other language here uses, and three words after it, left part behind
   (in lower case: "Champions League, y llegó" is a competition's name before Spanish, not English left over) */
const ENGLISH_RUN = /\b(?:the|and|of|to|in|for|with|was|were|their|they|points|game|games|season|league|won|lost|have|has|is|are|on|at|by)\b(?:\W+[a-z’']+){3}/;
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the engine's own sentence break, so a piece here is a piece on the page */
const sentences = p => String(p).split(core.SENTENCE_BREAK).filter(s => s.trim());

const CODES = core.LANGS.filter(l => l.code !== 'en' && !l.hidden && (!only || l.code === only)).map(l => l.code);
for (const code of CODES) {
  const D = dictFor(code);
  const gaps = new Map();
  let total = 0, missed = 0;
  reports.forEach(r => {
    const names = (r.names || []).concat(r.players || []).filter(Boolean).sort((a, b) => b.length - a.length);
    const nameRe = names.length ? new RegExp(names.map(reEsc).join('|'), 'g') : null;
    const bare = s => (nameRe ? String(s).replace(nameRe, ' ') : String(s));
    const key = s => (nameRe ? s.replace(nameRe, 'X') : s).replace(/\d+(?:[.,]\d+)?/g, 'N');
    const tryOne = (s, ctx) => {
      total++;
      const out = core.translateText(D, s, ctx);
      const bad = out == null || out === s ? 'untranslated' : ENGLISH_RUN.test(bare(out)) ? 'English left' : null;
      if (!bad) return;
      missed++;
      const k = key(s);
      const g = gaps.get(k) || { n: 0, kind: bad, example: s, out };
      g.n++;
      gaps.set(k, g);
    };
    /* a paragraph as the page translates it (i18n.js bySentence): sentence by sentence, and a piece that will not go
       tried again with the next (a break inside "C.B. Al-Qazeres") */
    const para = p => {
      const xs = sentences(p);
      for (let i = 0; i < xs.length; i++) {
        const out = core.translateText(D, xs[i], ['report']);
        if ((out == null || out === xs[i]) && i + 1 < xs.length) {
          const j = core.translateText(D, xs[i] + ' ' + xs[i + 1], ['report']);
          if (j != null && j !== xs[i] + ' ' + xs[i + 1]) { tryOne(xs[i] + ' ' + xs[i + 1], ['report']); i++; continue; }
        }
        tryOne(xs[i], ['report']);
      }
    };
    if (r.headline) tryOne(r.headline, []);
    if (r.standfirst) para(r.standfirst);
    (r.paras || []).forEach(para);
  });
  const list = [...gaps.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log('\n' + code + ': ' + missed + ' of ' + total + ' sentences not translated whole (' + Math.round(100 * missed / Math.max(1, total)) + '%), ' + list.length + ' templates');
  list.slice(0, all ? list.length : 25).forEach(([k, g]) => {
    console.log('  ' + String(g.n).padStart(3) + '  ' + g.kind + ': ' + k);
    if (all) console.log('         e.g. ' + g.example + (g.out && g.out !== g.example ? '\n         -> ' + g.out : ''));
  });
}
