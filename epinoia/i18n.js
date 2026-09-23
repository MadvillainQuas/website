'use strict';
/* ============================================================================
   LANGUAGES: English (the source), 日本語, Español. docs/i18n.md is the guide.

   Loaded synchronously in <head> on every page. English costs nothing: no dictionary is
   fetched and nothing is observed. Any other language hides the body, fetches
   i18n/<code>.js plus the packs the page names (data-i18n-packs="game report" on this
   script tag, from i18n/<code>/<pack>.js), translates what is already there, then watches
   the DOM so text a page renders later is translated before it is painted.

   Translation is by the English text itself, in CONTEXT: a table header, the rail, a standings
   row ('PF' there is points for; in a box score it is personal fouls) or an explicit
   data-i18n-ctx. Anything under translate="no", .notranslate or data-i18n="off" is left alone.
   ============================================================================ */
(function (G) {
  const LANGS = [
    { code: 'en', native: 'English', short: 'EN',     locale: 'en-GB' },
    { code: 'ja', native: '日本語',   short: '日本語', locale: 'ja-JP', punct: { '.': '。', '?': '？', '!': '！' } },
    { code: 'es', native: 'Español', short: 'ES',     locale: 'es-ES' }
  ];
  const STORE = 'epinoia_lang';

  /* ------------------------------------------------------------------ pure --- */
  const norm = s => String(s).replace(/[\s ]+/g, ' ').trim();
  const fold = s => norm(s).toLowerCase();
  const HAS_LATIN = /[A-Za-z]/;

  function caseOf(s) {
    const letters = s.replace(/[^A-Za-z]/g, '');
    if (!letters) return 'none';
    if (letters === letters.toUpperCase()) return letters.length > 1 || s.length === 1 ? 'upper' : 'title';
    return /^[^A-Za-z]*[A-Z]/.test(s) ? 'title' : 'lower';
  }

  function applyCase(out, kind, locale) {
    if (kind === 'upper') return out.toLocaleUpperCase(locale);
    if (kind === 'title') return out.replace(/^([^\p{L}]*)(\p{L})/u, (m, a, b) => a + b.toLocaleUpperCase(locale));
    if (kind === 'lower') {
      if (/^[^\p{L}]*\p{Lu}{2}/u.test(out)) return out;       // an acronym stays an acronym
      return out.replace(/^([^\p{L}]*)(\p{L})/u, (m, a, b) => a + b.toLocaleLowerCase(locale));
    }
    return out;
  }

  /* A dictionary as registered (the core file, or a pack):
       phrases      English -> translation, matched whatever case the page wrote it in
       exact        matched only as written ('v' but never a crest's 'V')
       keep         shown as they are, on purpose (the leagues print these in English)
       ctx          { name: { ... } }, tried before phrases when the text sits in that context
       units        'games' -> '{n} partidos', for "3 games"
       patterns     [RegExp, template | (match, T, Q) => string | null], tried everywhere
       ctxPatterns  { name: [...] }, tried only inside that context (generated prose)
       sentences    context names whose paragraphs are translated a sentence at a time
       sentenceJoin what goes between two translated sentences ('' in Japanese)
       decimal      ',' to write 2.5 as 2,5 */
  function merge(parts) {
    const out = { phrases: {}, exact: {}, keep: [], ctx: {}, units: {}, patterns: [], ctxPatterns: {}, sentences: [] };
    for (const d of parts) {
      for (const k of ['locale', 'caseless', 'decimal', 'sentenceJoin']) {
        if (d[k] !== undefined && out[k] === undefined) out[k] = d[k];
      }
      Object.assign(out.phrases, d.phrases);
      Object.assign(out.exact, d.exact);
      out.keep.push(...(d.keep || []));
      Object.keys(d.ctx || {}).forEach(c => { out.ctx[c] = Object.assign(out.ctx[c] || {}, d.ctx[c]); });
      Object.assign(out.units, d.units);
      out.patterns.push(...(d.patterns || []));
      Object.keys(d.ctxPatterns || {}).forEach(c => { (out.ctxPatterns[c] = out.ctxPatterns[c] || []).push(...d.ctxPatterns[c]); });
      out.sentences.push(...(d.sentences || []));
    }
    return out;
  }

  function compile(code, d) {
    const exact = new Map(), folded = new Map();
    const add = (ctx, table) => {
      const e = new Map(), f = new Map();
      Object.keys(table || {}).forEach(k => {
        e.set(norm(k), table[k]);
        const fk = fold(k);
        if (!f.has(fk)) f.set(fk, table[k]);
      });
      exact.set(ctx, e); folded.set(ctx, f);
    };
    add('*', d.phrases);
    const verbatim = new Map();
    Object.keys(d.exact || {}).forEach(k => verbatim.set(norm(k), d.exact[k]));
    (d.keep || []).forEach(k => verbatim.set(norm(k), k));
    Object.keys(d.ctx || {}).forEach(c => add(c, d.ctx[c]));
    const units = new Map();
    Object.keys(d.units || {}).forEach(u => units.set(u.toLowerCase(), d.units[u]));
    const ctxPatterns = new Map();
    Object.keys(d.ctxPatterns || {}).forEach(c => ctxPatterns.set(c, d.ctxPatterns[c]));
    const reg = LANGS.find(l => l.code === code);
    return {
      code, locale: d.locale || code, caseless: !!d.caseless, decimal: d.decimal || '.',
      punct: (reg && reg.punct) || null,
      exact, folded, verbatim, units, patterns: d.patterns || [], ctxPatterns,
      sentences: new Set(d.sentences || []),
      sentenceJoin: d.sentenceJoin == null ? ' ' : d.sentenceJoin
    };
  }

  /* 2.5 -> 2,5 where the language writes it so; a version (1.0.0) or a clock's tenths (0:05.4) is not a decimal */
  const DECIMAL = /(^|[^\d.,:])(\d+)\.(\d+)(?!\d|\.\d)/g;
  /* …nor is a version that a product name comes before: iOS 16.4, Android 6.0, v1.2 */
  const VERSIONED = /(?:\b(?:iOS|iPadOS|macOS|Android|Chrome|Safari|Edge|Firefox|Windows|version|versión|バージョン)\s*|\bv)$/i;
  const decimalize = (D, s) => D.decimal === '.' ? s : s.replace(DECIMAL, (m, pre, a, b, at) =>
    VERSIONED.test(s.slice(0, at) + pre) ? m : pre + a + D.decimal + b);

  const AFFIX = /^([\s›‹»«→←↑↓▾▸▴◂✓✔×•·…:：(（\-–—+]*)([\s\S]*?)([\s›‹»«→←↑↓▾▸▴◂✓✔×•·…:：)）!?.,±\-–—]*)$/;
  const SEPS = [' · ', ' | ', ' / ', ' — ', ' – '];
  const UNIT = /^([+-]?\d[\d,]*(?:\.\d+)?)(\s*)([A-Za-z][A-Za-z%/.]*)$/;
  /* a sentence ends at . ! ? before a capital — but not after an initial (J. Anderson) or a title */
  const SENTENCE_BREAK = /(?<!(?:^|[\s(])(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.)(?<=[.!?])\s+(?=[A-Z0-9“"‘'(])/;

  /* A translation takes the case the page wrote the English in (CSS may uppercase it anyway);
     only the exact and keep lists come back exactly as written. */
  function direct(D, core, ctxs) {
    const key = norm(core), fk = key.toLowerCase();
    const cased = v => (D.caseless ? v : applyCase(v, caseOf(key), D.locale));
    for (const c of ctxs.concat('*')) {
      if (c === '*' && D.verbatim.has(key)) return D.verbatim.get(key);
      const e = D.exact.get(c);
      if (e && e.has(key)) return cased(e.get(key));
      const f = D.folded.get(c);
      if (f && f.has(fk)) return cased(f.get(fk));
    }
    return null;
  }

  /* a sentence's own full stop, in the language's own mark (Japanese 。？！), unless the
     translation already ends in one; an ellipsis stays an ellipsis */
  function punctuate(D, tail, inner) {
    if (!D.punct || !tail) return tail;
    if (/[。？！]$/.test(inner) && /^[.?!]\s*$/.test(tail)) return tail.replace(/[.?!]/, '');
    return tail.replace(/(?<![.])([.?!])(?![.])/g, c => D.punct[c] || c);
  }

  function runPatterns(list, core, T, Q) {
    for (const [re, rep] of list) {
      const m = re.exec(core);
      if (!m) continue;
      const out = typeof rep === 'function'
        ? rep(m, T, Q)
        : rep.replace(/\$(\d)/g, (x, i) => m[+i] == null ? '' : m[+i]);
      if (out != null) return out;
    }
    return null;
  }

  function tr(D, core, ctxs, depth) {
    if (!core || !HAS_LATIN.test(core)) return null;
    const hit = direct(D, core, ctxs);
    if (hit != null) return hit;
    if (depth > 2) return null;

    /* T: the translation, or the text as it was; Q: the translation, or null */
    const Q = s => tr(D, s, ctxs, depth + 1);
    const T = s => { const t = Q(s); return t == null ? s : t; };

    /* a context's own sentence templates come first: a whole sentence beats its pieces */
    for (const c of ctxs) {
      const list = D.ctxPatterns.get(c);
      if (!list) continue;
      const out = runPatterns(list, core, T, Q);
      if (out != null) return out;
    }

    const a = AFFIX.exec(core);
    if (a && (a[1] || a[3]) && HAS_LATIN.test(a[2])) {
      const inner = tr(D, a[2], ctxs, depth + 1);
      if (inner != null) return a[1] + inner + punctuate(D, a[3], inner);
    }

    /* in prose (a `sentences` context) half a sentence in each language is worse than English:
       the pieces either all translate or none do */
    const prose = ctxs.some(c => D.sentences.has(c));
    for (const sep of SEPS) {
      if (core.indexOf(sep) < 0) continue;
      let any = false, all = true;
      const parts = core.split(sep).map(p => {
        const t = tr(D, p, ctxs, depth + 1);
        if (t != null) { any = true; return t; }
        all = false;
        return p;
      });
      if (prose ? all : any) return parts.join(sep);
    }

    const u = UNIT.exec(core);
    if (u) {
      const tpl = D.units.get(u[3].toLowerCase());
      if (tpl != null) return tpl.replace('{n}', u[1]);
    }

    return runPatterns(D.patterns, core, T, Q);
  }

  /* A paragraph of generated prose: each sentence on its own, the untranslated ones left as they
     were (and reported), joined as the language joins sentences. */
  function bySentence(D, core, ctxs, onMiss) {
    const parts = core.split(SENTENCE_BREAK);
    if (parts.length < 2) return null;
    let any = false;
    const outs = parts.map(p => {
      const t = tr(D, p, ctxs, 0);
      if (t != null) { any = true; return { t, ok: true }; }
      if (onMiss) onMiss(p);
      return { t: p, ok: false };
    });
    if (!any) return null;
    return outs.reduce((s, o, i) => i === 0 ? o.t
      : s + (o.ok && outs[i - 1].ok ? D.sentenceJoin : ' ') + o.t, '');
  }

  /* The whole of a text node: whitespace around it is kept exactly. Null when nothing changes. */
  function translateText(D, text, ctxs, onMiss) {
    if (!D || text == null) return null;
    const s = String(text);
    const cx = ctxs || [];
    let out = null;
    if (HAS_LATIN.test(s)) {
      const lead = /^\s*/.exec(s)[0];
      const trail = /\s*$/.exec(s.slice(lead.length))[0];
      /* a text node carries the HTML source's own line breaks and indentation, which the page
         renders as single spaces: collapse them, or no sentence pattern could ever match */
      const core = s.slice(lead.length, s.length - trail.length).replace(/\s*\n\s*|[ \t]{2,}/g, ' ');
      let t = tr(D, core, cx, 0);
      if (t == null && cx.some(c => D.sentences.has(c))) t = bySentence(D, core, cx, onMiss);
      else if (t == null && onMiss) onMiss(core);
      if (t != null) out = lead + t + trail;
    }
    if (D.decimal !== '.') {
      const dec = decimalize(D, out == null ? s : out);
      if (dec !== (out == null ? s : out)) out = dec;
    }
    return out;
  }

  const pick = (want, stored) => {
    const ok = c => LANGS.some(l => l.code === c);
    if (ok(want)) return want;
    if (ok(stored)) return stored;
    return 'en';
  };

  /* the locale a toLocale*String call should get: English (or none) becomes the chosen one */
  const swapLocale = (loc, target) => {
    const l = Array.isArray(loc) ? loc[0] : loc;
    return l == null || /^en(-|$)/i.test(String(l)) ? target : loc;
  };

  const core = { LANGS, norm, fold, caseOf, applyCase, merge, compile, translateText, pick, swapLocale };

  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  if (G.EpinoiaI18n) return;

  /* --------------------------------------------------------------- browser --- */
  const doc = G.document;
  const html = doc.documentElement;
  let stored = null;
  try { stored = G.localStorage.getItem(STORE); } catch (_) { /* private mode */ }
  let asked = null;
  try { asked = new URLSearchParams(G.location.search).get('lang'); } catch (_) { /* no URL */ }
  const lang = pick(asked, stored);
  if (asked && asked === lang && asked !== stored) {
    try { G.localStorage.setItem(STORE, lang); } catch (_) { /* private mode */ }
  }
  const meta = LANGS.find(l => l.code === lang);

  const me = doc.currentScript;
  const packs = ((me && me.getAttribute('data-i18n-packs')) || '').split(/\s+/).filter(Boolean);

  let D = null;
  let started = false;
  const loaded = {};
  const waiting = new Set(['core'].concat(packs));
  const pending = [];
  /* ?i18n=misses (kept for the tab): every English string seen and not translated, for
     EpinoiaI18n.misses(), which is how a gap in a dictionary is found on a real page */
  let debug = false;
  try {
    if (new URLSearchParams(G.location.search).get('i18n') === 'misses') G.sessionStorage.setItem('epinoia_i18n_misses', '1');
    debug = G.sessionStorage.getItem('epinoia_i18n_misses') === '1';
  } catch (_) { /* private mode */ }
  const missed = new Map();
  const miss = s => { const k = norm(s); if (k && HAS_LATIN.test(k)) missed.set(k, (missed.get(k) || 0) + 1); };

  const rebuild = () => {
    if (!loaded.core) return;
    D = compile(lang, merge([loaded.core].concat(packs.filter(p => loaded[p]).map(p => loaded[p]))));
  };
  const settle = name => {
    waiting.delete(name);
    if (started) { if (D) doTree(html); }       // a pack that arrived after the page was shown
    else if (!waiting.size && D) start();
  };

  const api = {
    LANGS, lang, locale: meta.locale, packs, core,
    /* A string for code that builds text itself; English, or anything unknown, comes back as given. */
    t(text, ctx) {
      if (!D) return text;
      const out = translateText(D, text, ctx ? [].concat(ctx) : []);
      return out == null ? text : out;
    },
    set(code) {
      if (!LANGS.some(l => l.code === code)) return;
      try { G.localStorage.setItem(STORE, code); } catch (_) { /* private mode */ }
      const u = new URL(G.location.href);
      u.searchParams.delete('lang');
      if (u.href !== G.location.href) G.location.replace(u.href);
      else G.location.reload();
    },
    /* i18n/<code>.js calls register(code, dict); a pack calls register(code, dict, 'name') */
    register(code, dict, pack) {
      const name = pack || 'core';
      if (code !== lang || loaded[name] || (name !== 'core' && packs.indexOf(name) < 0)) return;
      loaded[name] = dict;
      rebuild();
      settle(name);
    },
    whenReady(fn) { if (started || lang === 'en') fn(); else pending.push(fn); },
    misses() { return [...missed].sort((a, b) => b[1] - a[1]).map(([s, n]) => n + '  ' + s); }
  };
  G.EpinoiaI18n = api;

  if (lang === 'en') return;

  html.lang = lang;
  html.classList.add('i18n', 'i18n-' + lang, 'i18n-wait');
  patchDates();
  patchDialogs();

  const style = doc.createElement('style');
  style.id = 'epinoia-i18n-style';
  style.textContent =
    'html.i18n-wait body{visibility:hidden}' +
    ':root:lang(ja){' +
      "--f-micro:'Silkscreen','Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic UI','Yu Gothic','Meiryo','Noto Sans JP','Noto Sans CJK JP',sans-serif;" +
      "--f-score:'Jersey25','Hiragino Sans','Yu Gothic UI','Meiryo','Noto Sans JP',sans-serif;" +
      "--f-ui:'Archivo','Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic UI','Yu Gothic','Meiryo','Noto Sans JP','Noto Sans CJK JP',system-ui,sans-serif;" +
      "--f-data:'MartianMono','Hiragino Sans','Yu Gothic UI','Meiryo','Noto Sans JP',ui-monospace,monospace}" +
    /* a column header is a word: 試合数 must not break into 試合 / 数 */
    ':root:lang(ja) th{word-break:keep-all}';
  (doc.head || html).appendChild(style);

  /* a slow or failed dictionary never leaves a blank page: English is shown instead, and a
     slow pack is applied whenever it lands */
  const reveal = () => html.classList.remove('i18n-wait');
  const failsafe = G.setTimeout(() => {
    if (started) return;
    if (D) start();
    else { reveal(); html.lang = 'en'; }
  }, 2500);

  const stamp = (me && /[?&]v=\d+/.exec(me.src || '') || [''])[0].replace(/^&/, '?');
  const base = me && me.src ? me.src.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : '';
  const load = (path, name) => {
    const s = doc.createElement('script');
    s.src = base + path + stamp;
    s.onerror = () => {
      if (name === 'core') { G.clearTimeout(failsafe); reveal(); html.lang = 'en'; return; }
      settle(name);
    };
    (doc.head || html).appendChild(s);
  };
  load('i18n/' + lang + '.js', 'core');
  packs.forEach(p => load('i18n/' + lang + '/' + p + '.js', p));

  /* ------------------------------------------------------------- the DOM --- */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'TEMPLATE']);
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const done = new WeakMap();      // text node -> what this file last wrote into it
  const orig = new WeakMap();      // text node -> the English it replaced
  const attrDone = new WeakMap();  // element -> { attr: what this file last wrote }

  function skipEl(el) {
    if (SKIP_TAGS.has(el.tagName ? el.tagName.toUpperCase() : '')) return true;
    if (el.getAttribute('translate') === 'no' || el.getAttribute('data-i18n') === 'off') return true;
    const cl = el.classList;
    return !!cl && (cl.contains('notranslate') || cl.contains('epinoia-mark')) || el.isContentEditable === true;
  }
  function skipped(node) {
    for (let e = node.nodeType === 1 ? node : node.parentElement; e; e = e.parentElement) {
      if (skipEl(e)) return true;
    }
    return false;
  }

  const englishOf = cell => {
    let t = '';
    const w = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) t += orig.has(n) ? orig.get(n) : n.data;
    return norm(t).toUpperCase();
  };
  /* 'PF' beside 'PA' is points for; anywhere else in a header it is a personal foul */
  function headerCtx(th) {
    const row = th.parentElement;
    if (!row) return null;
    for (const c of row.children) {
      if (/^(PA|OPP PTS|GB)$/.test(englishOf(c))) return 'standings';
    }
    return null;
  }
  function ctxsFor(el) {
    const out = [];
    for (let e = el; e && e !== doc.body; e = e.parentElement) {
      const c = e.getAttribute && e.getAttribute('data-i18n-ctx');
      if (c) out.push(...c.split(/\s+/));
      if (e.tagName === 'TH' || (e.getAttribute && e.getAttribute('role') === 'columnheader')) {
        const h = headerCtx(e);
        if (h) out.push(h);
        out.push('col');
      }
      if (e.classList && e.classList.contains('ep-tabbar')) out.push('tab');
      if (e.classList && e.classList.contains('ep-nav')) out.push('nav');
      if (e.tagName === 'TITLE') out.push('title');
    }
    return out;
  }

  function doText(n, walked) {
    const v = n.data;
    /* a sentence's full stop left on its own after a link or a bold word: in the language's
       own mark, and without the space English put before nothing */
    const loneMark = D.punct && /^\s*[.?!]\s*$/.test(v);
    if (!(HAS_LATIN.test(v) || loneMark || (D.decimal !== '.' && /\d\.\d/.test(v))) || done.get(n) === v) return;
    const p = n.parentElement;
    if (!p || (walked !== true && skipped(n))) return;
    const out = loneMark ? v.replace(/^\s*([.?!])/, (m, c) => D.punct[c] || c)
                         : translateText(D, v, ctxsFor(p), debug ? miss : null);
    if (out == null || out === v) return;
    orig.set(n, v);
    done.set(n, out);
    n.data = out;
  }
  function doAttr(el, a) {
    const v = el.getAttribute(a);
    if (!v || !HAS_LATIN.test(v)) return;
    const mine = attrDone.get(el);
    if (mine && mine[a] === v) return;
    if (skipped(el)) return;
    const out = translateText(D, v, ctxsFor(el), debug ? miss : null);
    if (out == null || out === v) return;
    const rec = mine || {};
    rec[a] = out;
    attrDone.set(el, rec);
    el.setAttribute(a, out);
  }
  function doTree(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    const w = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === 1 && skipEl(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n = root; n; n = w.nextNode()) {
      if (n.nodeType === 3) doText(n, true);
      else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
    }
  }

  let mo = null;
  function start() {
    if (started) return;
    started = true;
    G.clearTimeout(failsafe);
    html.lang = lang;             // the safety net may have said English while the files were slow
    doTree(html);
    mo = new MutationObserver(recs => {
      for (const r of recs) {
        if (r.type === 'childList') r.addedNodes.forEach(n => doTree(n));
        else if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttr(r.target, r.attributeName);
      }
      mo.takeRecords();         // the records our own writes just queued
    });
    mo.observe(html, { subtree: true, childList: true, characterData: true,
                       attributes: true, attributeFilter: ATTRS });
    reveal();
    pending.splice(0).forEach(fn => { try { fn(); } catch (_) { /* a page's own hook */ } });
  }

  /* alert/confirm/prompt never pass through the DOM, so their message is translated here, in the
     `dialog` context (a pack lists it in `sentences` to take multi-sentence messages apart) */
  function patchDialogs() {
    ['alert', 'confirm', 'prompt'].forEach(m => {
      const was = G[m];
      if (typeof was !== 'function') return;
      G[m] = function (msg, ...rest) {
        if (typeof msg !== 'string' || !D) return was.call(G, msg, ...rest);
        const out = translateText(D, msg, ['dialog'], debug ? miss : null);
        return was.call(G, out == null ? msg : out, ...rest);
      };
    });
  }

  /* Every page formats dates with toLocale*String('en-GB', …); asked for English, answer in the
     chosen language. An explicit non-English locale is left as it was asked for. */
  function patchDates() {
    ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].forEach(m => {
      const was = Date.prototype[m];
      Date.prototype[m] = function (loc, opts) { return was.call(this, swapLocale(loc, meta.locale), opts); };
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
