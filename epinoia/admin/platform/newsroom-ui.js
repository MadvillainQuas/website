'use strict';
/* ============================================================================
   THE NEWSROOM — the platform console's tab for what the league newsdesks' writer learns (migration 0252).

   TEACH IT. Paste a sports article (a title, where it is from, the text): "Preview" shows what the newsroom would take
   from it (newsroom.js digest: the verbs for a rout and for a narrow win, for a hot hand and a cold one, the paragraph
   openers that turn an argument, the shape of a question headline), and "Add to the library" keeps it. The hourly
   newsdesk build reads the library (service role), digests every article and writes in the merged style from then on.
   It learns short, generic phrasing, never anybody's sentence, and every figure in an article still comes from the games.

   THE LIBRARY: every article kept, with what it taught; delete one and the build forgets it at its next run.

   WHAT IT HAS LEARNED: the library merged (newsroom.js learn), most used first - what the writer now draws on.

   WHAT WORKS: the click-through model the feeds rank by (snapshots/feed/model.json, fitted every hour on every visit's
   anonymous counts): the platform's rate, the headline words and shapes that lift a story and those that sink it, the
   kinds and leagues readers open most, and how the newsroom's formats are doing against each other.

   THE EDITOR'S REPORTS: league by league (the public newsdesk files), what the editor (scrutiny.js) did to every piece
   before it was posted and to the game to watch - each fix located, classed, with its reason and the words before and
   after - each piece's score (salience x format x quality, the bar it cleared), and what it held back and why.

   Platform administrators only: the table's own policy refuses everybody else (0252), whatever this page shows.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsroomUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const CAT = { winBig: 'a big win', winClose: 'a narrow win', win: 'a win', lose: 'a defeat', score: 'scoring', cold: 'a cold hand', hot: 'a hot hand',
              turn: 'turning an argument', add: 'adding to one' };
const THEME = { mvp: 'the MVP question', slump: 'a slump', prospect: 'a young talent', run: 'a run' };
/* a feature of the click-through model, said as what it is */
function featureWords(k) {
  const [t, v] = [k.slice(0, 2), k.slice(2)];
  if (t === 'w:') return v === '#' ? 'a number in the headline' : '“' + v + '”';
  if (t === 'b:') return '“' + v.replace('_', ' ') + '”';
  if (t === 'l:') return 'a story about ' + v;
  if (t === 'k:') return ({ 'league': 'a league’s own article', 'league:report': 'a match report', 'creator': 'a creator’s piece', 'outlet': 'a publisher’s story', 'channel': 'a channel’s video', 'desk': 'a newsdesk piece' })[v] || v;
  if (t === 's:') return ({ question: 'a question headline', number: 'a figure in it', lenshort: 'a short headline', lenmid: 'a middling headline', lenlong: 'a long headline', name: 'a name in it' })[v] || v;
  return k;
}

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  const sb = o.sb, say = o.say || (() => {});
  const NR = root.EpinoiaNewsroom;
  if (!host) return;
  host.textContent = '';
  host.setAttribute('data-i18n', 'off');

  /* --- teach it --- */
  host.appendChild(el('h3', null, 'Teach the newsroom'));
  host.appendChild(el('p', 'lead', 'Paste a sports article. The newsroom takes its phrasing - the verbs for a rout and for a narrow win, for a hot hand and a cold one, how a paragraph turns, the shape of a question headline - and writes the league newsdesks’ articles in it from the next hourly build. It never copies a sentence, and every figure still comes from the games.'));
  const form = host.appendChild(el('div', 'nrm-form'));
  const title = form.appendChild(el('input')); title.placeholder = 'title (the headline)'; title.maxLength = 300;
  const source = form.appendChild(el('input')); source.placeholder = 'where it is from (optional)'; source.maxLength = 300;
  const text = form.appendChild(el('textarea')); text.rows = 10; text.placeholder = 'the article’s text (200 characters or more)';
  const acts = form.appendChild(el('div', 'row'));
  const prevBtn = acts.appendChild(el('button', 'ep-btn mini', 'Preview what it learns')); prevBtn.type = 'button';
  const addBtn = acts.appendChild(el('button', 'ep-btn mini', 'Add to the library')); addBtn.type = 'button';
  const preview = form.appendChild(el('div', 'nrm-preview'));

  const learnedHTML = (lex, heads) => {
    const box = el('div', 'nrm-learned');
    const cats = Object.keys(lex || {}).filter(k => (lex[k] || []).length);
    if (!cats.length && !(heads || []).length) { box.appendChild(el('p', 'muted', 'Nothing to take from it: no score with a verb before it, no "N points", no form words, no question headline.')); return box; }
    cats.forEach(k => {
      const row = box.appendChild(el('div', 'nrm-cat'));
      row.appendChild(el('b', null, CAT[k] || k));
      row.appendChild(el('span', null, (lex[k] || []).map(x => (typeof x === 'string' ? x : x.p + (x.n > 1 ? ' ×' + x.n : ''))).join(' · ')));
    });
    (heads || []).forEach(h => { const row = box.appendChild(el('div', 'nrm-cat')); row.appendChild(el('b', null, 'headline, ' + (THEME[h.theme] || h.theme))); row.appendChild(el('span', null, h.shape)); });
    return box;
  };
  const digestNow = () => (NR ? NR.digest(text.value, title.value) : null);
  prevBtn.addEventListener('click', () => {
    preview.textContent = '';
    if (!NR) { preview.appendChild(el('p', 'err', 'newsroom.js did not load: reload the page.')); return; }
    const d = digestNow();
    preview.appendChild(el('p', 'muted', d.sentences + ' sentences, ' + d.words + ' words' + (d.questions ? ', ' + d.questions + ' questions' : '') + '.'));
    preview.appendChild(learnedHTML(d.lex, d.heads));
  });
  addBtn.addEventListener('click', async () => {
    const body = text.value.trim();
    if (body.length < 200) { say('An article needs 200 characters or more.', 'err'); return; }
    const d = digestNow();
    const learned = d ? { lex: Object.fromEntries(Object.keys(d.lex).map(k => [k, d.lex[k].length])), heads: d.heads.length, sentences: d.sentences } : {};
    addBtn.disabled = true;
    try {
      const r = await sb.from('newsroom_style').insert({ title: title.value.trim(), source: source.value.trim(), body, learned });
      if (r.error) throw r.error;
      say('Added. The newsroom writes with it from the next hourly build.', 'ok');
      title.value = ''; source.value = ''; text.value = ''; preview.textContent = '';
      await library();
    } catch (e) { say(/newsroom_style|42P01|404/.test(String(e.message || e.code || e)) ? 'The library is not in the database yet: migration 0252 has to be pushed first.' : 'Not added: ' + (e.message || e), 'err'); }
    finally { addBtn.disabled = false; }
  });

  /* --- the library, and what it has learned --- */
  host.appendChild(el('h3', null, 'The library'));
  const lib = host.appendChild(el('div', 'nrm-lib'));
  host.appendChild(el('h3', null, 'What it has learned'));
  const merged = host.appendChild(el('div', 'nrm-merged'));
  async function library() {
    lib.textContent = ''; merged.textContent = '';
    let rows = [];
    try {
      const r = await sb.from('newsroom_style').select('id,title,source,body,learned,created_at').order('created_at', { ascending: false }).limit(400);
      if (r.error) throw r.error;
      rows = r.data || [];
    } catch (_) { lib.appendChild(el('p', 'muted', 'The library is not in the database yet (migration 0252).')); return; }
    if (!rows.length) { lib.appendChild(el('p', 'muted', 'Empty: the newsroom writes in its own house words until something is added.')); return; }
    rows.forEach(x => {
      const row = lib.appendChild(el('div', 'nrm-row'));
      const main = row.appendChild(el('div'));
      main.appendChild(el('b', null, x.title || '(untitled)'));
      main.appendChild(el('span', 'muted', [x.source, new Date(x.created_at).toLocaleDateString('en-GB'), x.learned && x.learned.sentences ? x.learned.sentences + ' sentences' : null].filter(Boolean).join(' · ')));
      const del = row.appendChild(el('button', 'ep-btn mini ghost', 'delete')); del.type = 'button';
      del.addEventListener('click', async () => {
        if (!root.confirm || !root.confirm('Delete "' + (x.title || 'this article') + '" from the library? The newsroom forgets it at the next build.')) return;
        const r = await sb.from('newsroom_style').delete().eq('id', x.id);
        if (r.error) say('Not deleted: ' + r.error.message, 'err'); else { say('Deleted.', 'ok'); library(); }
      });
    });
    if (NR) {
      const st = NR.learn(rows.map(x => NR.digest(x.body, x.title)));
      merged.appendChild(el('p', 'muted', st.articles + ' article(s)' + (st.rhythm.wordsPerSentence ? ', ' + st.rhythm.wordsPerSentence + ' words a sentence on average' : '') + '.'));
      const heads = [];
      Object.keys(st.heads || {}).forEach(t => (st.heads[t] || []).forEach(h => heads.push({ theme: t, shape: h.p + (h.n > 1 ? ' ×' + h.n : '') })));
      merged.appendChild(learnedHTML(st.lex, heads));
    }
  }

  /* --- what works: the click-through model --- */
  host.appendChild(el('h3', null, 'What works'));
  host.appendChild(el('p', 'lead', 'What readers open, learned every hour from every visit’s anonymous counts: it ranks every feed, orders the newsroom’s headlines, decides its headline tests and weighs its formats.'));
  const works = host.appendChild(el('div', 'nrm-works'));
  (async () => {
    const c = root.EPINOIA_CONFIG || {};
    let m = null;
    try { const r = await fetch(c.supabaseUrl + '/storage/v1/object/public/snapshots/feed/model.json', { cache: 'no-store' }); m = r.ok ? await r.json() : null; } catch (_) { m = null; }
    if (!m || !m.w) { works.appendChild(el('p', 'muted', 'No model yet: it is fitted once there are enough showings and opens (migration 0252 pushed, then a few hundred visits).')); return; }
    works.appendChild(el('p', null, 'Fitted ' + new Date(m.trained).toLocaleString('en-GB') + ' on ' + m.items + ' stories, ' + m.shown + ' showings and ' + m.opened + ' opens: a platform rate of ' + (m.base * 100).toFixed(2) + '%.'));
    const ws = Object.entries(m.w).sort((a, b) => b[1] - a[1]);
    const list = (label, xs) => { const b = works.appendChild(el('div', 'nrm-cat')); b.appendChild(el('b', null, label));
      b.appendChild(el('span', null, xs.map(([k, v]) => featureWords(k) + ' (' + (v > 0 ? '+' : '') + Math.round((Math.exp(v) - 1) * 100) + '%)').join(' · ') || '—')); };
    list('opened more', ws.filter(x => x[1] > 0).slice(0, 15));
    list('opened less', ws.filter(x => x[1] < 0).slice(-15).reverse());
    if (m.formats && Object.keys(m.formats).length) list('the newsroom’s formats', Object.entries(m.formats).map(([k, v]) => ['k:' + k, Math.log(v)]));
  })();

  /* --- the editor's reports: what the last reader fixed and held back, league by league (the public newsdesk files) --- */
  host.appendChild(el('h3', null, 'The editor’s reports'));
  host.appendChild(el('p', 'lead', 'Every piece the newsroom posts, and the game to watch, is read whole by the editor first: each fix where it made it, why, and what it said before and after; what it held back and why. A piece is posted when its salience × its format’s weight × the editor’s quality clears the bar.'));
  const qaBox = host.appendChild(el('div', 'nrm-qa'));
  const pick = qaBox.appendChild(el('select'));
  const out = qaBox.appendChild(el('div'));
  (async () => {
    const c = root.EPINOIA_CONFIG || {}, U = c.supabaseUrl + '/storage/v1/object/public/snapshots/narrative/';
    let idx = null;
    try { const r = await fetch(U + 'index.json', { cache: 'no-store' }); idx = r.ok ? await r.json() : null; } catch (_) { idx = null; }
    const ls = idx && idx.leagues ? Object.entries(idx.leagues).map(([id, l]) => ({ id, slug: l.slug || id })).sort((a, b) => a.slug.localeCompare(b.slug)) : [];
    if (!ls.length) { out.appendChild(el('p', 'muted', 'No newsdesk files yet.')); return; }
    ls.forEach(l => { const op = pick.appendChild(el('option', null, l.slug)); op.value = l.id; });
    const fixes = (qa, box) => ((qa && qa.fixes) || []).forEach(f => {
      const r = box.appendChild(el('div', 'nrm-fix'));
      r.appendChild(el('b', null, [f.at, f.kind, f.rule].filter(Boolean).join(' · ')));
      r.appendChild(el('span', null, f.note));
      if (f.before) r.appendChild(el('del', null, f.before));
      if (f.after && f.after !== f.before) r.appendChild(el('ins', null, f.after));
    });
    const show = async () => {
      out.textContent = '';
      let b = null;
      try { const r = await fetch(U + pick.value + '.json', { cache: 'no-store' }); b = r.ok ? await r.json() : null; } catch (_) { b = null; }
      if (!b) { out.appendChild(el('p', 'err', 'Could not read that league’s file.')); return; }
      const nm = id => (b.clubs && b.clubs[id] ? b.clubs[id].name : id), w = b.watchCard;
      if (w) {
        const box = out.appendChild(el('div', 'nrm-qa-piece'));
        box.appendChild(el('b', null, 'The game to watch: ' + nm(w.home.id) + ' v ' + nm(w.away.id)));
        box.appendChild(el('span', 'muted', ['score ' + (w.score != null ? w.score : '—'), 'stakes ' + w.stakes, w.qa ? 'substance ' + w.qa.substance : null, w.qa ? 'quality ' + w.qa.quality : null].filter(Boolean).join(' · ')));
        fixes(w.qa, box);
      }
      (b.articles || []).forEach(a => {
        const box = out.appendChild(el('div', 'nrm-qa-piece'));
        box.appendChild(el('b', null, a.kind + ': ' + a.head));
        box.appendChild(el('span', 'muted', [new Date(a.written).toLocaleString('en-GB'), a.qa && a.qa.score != null ? 'posted at ' + a.qa.score : null,
          a.qa ? 'quality ' + a.qa.quality + ', substance ' + a.qa.substance : 'written before the editor', a.qa ? a.qa.fixes.length + ' fix' + (a.qa.fixes.length === 1 ? '' : 'es') : null,
          a.corrected ? 'rewritten ' + new Date(a.corrected).toLocaleString('en-GB') : null].filter(Boolean).join(' · ')));
        fixes(a.qa, box);
      });
      (b.qaHeld || []).forEach(h => {
        const box = out.appendChild(el('div', 'nrm-qa-piece held'));
        box.appendChild(el('b', null, 'Held back: ' + h.kind + (h.head ? ': ' + h.head : '')));
        (h.held || []).forEach(x => box.appendChild(el('span', null, x.rule + ': ' + x.note)));
        fixes({ fixes: h.fixes }, box);
      });
      if (!w && !(b.articles || []).length && !(b.qaHeld || []).length) out.appendChild(el('p', 'muted', 'Nothing written for this league yet.'));
    };
    pick.addEventListener('change', show);
    show();
  })();

  library();
}

return { mount, featureWords };
}));
