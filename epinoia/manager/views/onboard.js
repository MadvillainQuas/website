'use strict';
/* ============================================================================
   MANAGER - A NEW CLUB (#/new). Louie, 2026-10-09: "login prompt -> black transition animation -> 'WHAT IS YOUR TEAM
   NAME' -> 'WHAT IS YOUR MANAGER'S NAME' -> badge creation (create or upload) -> FM-like country and league selection
   -> mode options". The signed-out reader has met the door already (app.js); this is the rest, on black, a question at
   a time, each name checked as it is typed (core/names.js; the database checks again, 0259).
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const IMG = 96;

function render(host) {
  const st = { step: 0, name: '', manager: '', badge: null, league: null, loaded: null, perWeek: 2, mode: 'solo' };
  const ob = h('div.mg-ob.in', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'A new club' });
  root.document.body.appendChild(ob);
  const close = () => { ob.remove(); };
  host.appendChild(h('div.mg-loading', h('p', 'Setting up your club…')));
  const steps = [askName, askManager, askBadge, askLeague, askMode];
  function show(i) {
    st.step = i;
    ob.textContent = '';
    ob.classList.remove('in'); void ob.offsetWidth; ob.classList.add('in');
    if (i > 0) ob.appendChild(h('button.back', { type: 'button', onclick: () => show(i - 1) }, '← BACK'));
    else if (A.club) ob.appendChild(h('button.back', { type: 'button', onclick: () => { close(); A.go('/'); } }, '← CANCEL'));
    const stage = h('div.stage');
    stage.appendChild(h('div.step', 'Step ' + (i + 1) + ' of ' + steps.length));
    ob.appendChild(stage);
    steps[i](stage, () => show(i + 1));
  }

  /* ---- 1 and 2: the names ---- */
  function nameStep(stage, q, key, next, ph) {
    stage.appendChild(h('h1.q', q));
    const inp = h('input.big', { type: 'text', maxlength: '28', autocomplete: 'off', spellcheck: 'false', placeholder: ph, value: st[key] || '', 'aria-label': q });
    const hint = h('p.hint', { 'aria-live': 'polite' });
    const btn = h('button.mg-btn.primary.big', { type: 'button', disabled: true }, 'Continue');
    const check = () => {
      const v = Mgr.names.clean(inp.value), why = v ? Mgr.names.check(v) : 'too short';
      hint.textContent = !v ? '' : why === '' ? '' : why === 'not allowed' ? 'That name is not allowed.' : why === 'too short' ? 'At least two characters.'
        : why === 'too long' ? 'At most 28 characters.' : 'Letters, numbers, spaces and . ’ & - only.';
      hint.classList.toggle('bad', !!v && why !== '');
      btn.disabled = why !== '';
      return why === '' ? v : null;
    };
    const go = () => { const v = check(); if (v) { st[key] = v; next(); } };
    inp.addEventListener('input', check);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    btn.addEventListener('click', go);
    stage.appendChild(inp); stage.appendChild(hint); stage.appendChild(h('div.go', btn));
    check();
    setTimeout(() => inp.focus(), 250);
  }
  function askName(stage, next) { nameStep(stage, 'What is your team name?', 'name', next, 'Utopia City'); }
  function askManager(stage, next) { nameStep(stage, 'What is your manager’s name?', 'manager', next, 'Your name'); }

  /* ---- 3: the badge, made here or uploaded ---- */
  function askBadge(stage, next) {
    if (!st.badge) st.badge = Mgr.badge.defaults(st.name);
    stage.appendChild(h('h1.q', 'Your club’s badge'));
    const pv = h('div.pv');
    const draw = () => { pv.textContent = ''; pv.appendChild(A.badge(st.badge, 150)); };
    const B = Mgr.badge, opts = h('div.opts');
    const set = (label, list, key, names) => {
      const row = h('div.set', { role: 'group', 'aria-label': label });
      list.forEach(v => row.appendChild(h('button', { type: 'button', 'aria-pressed': String(st.badge[key] === v), onclick: e => {
        st.badge = B.sanitise(Object.assign({}, st.badge, { [key]: v }));
        if (key !== 'img') delete st.badge.img;
        row.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        draw();
      } }, (names && names[v]) || v)));
      return h('div', h('div.mg-cap', label), row);
    };
    opts.appendChild(set('Shape', B.SHAPES, 'shape'));
    opts.appendChild(set('Pattern', B.PATTERNS, 'pattern'));
    opts.appendChild(set('Emblem', B.EMBLEMS, 'emblem'));
    const col = k => { const i = h('input', { type: 'color', value: st.badge[k], 'aria-label': 'Colour ' + k.slice(1) }); i.addEventListener('input', () => { st.badge = B.sanitise(Object.assign({}, st.badge, { [k]: i.value })); draw(); }); return i; };
    const txt = h('input', { type: 'text', maxlength: '3', value: st.badge.text, 'aria-label': 'Letters' });
    txt.addEventListener('input', () => { st.badge = B.sanitise(Object.assign({}, st.badge, { text: txt.value })); draw(); });
    opts.appendChild(h('div', h('div.mg-cap', 'Colours and letters'), h('div.cols', 'Main', col('c1'), 'Second', col('c2'), 'Trim', col('c3'), 'Letters', txt)));
    /* AN UPLOADED BADGE: made 96 x 96 here, kept as a small image (badge.js IMG_MAX), clipped to the shape */
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const up = h('button.mg-btn', { type: 'button', onclick: () => file.click() }, 'Upload an image instead');
    const err = h('p.hint', { 'aria-live': 'polite' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try { const url = await shrink(f); st.badge = B.sanitise(Object.assign({}, st.badge, { img: url })); err.textContent = ''; draw(); }
      catch (_) { err.textContent = 'That image could not be used: try a PNG or a JPEG.'; err.classList.add('bad'); }
    });
    opts.appendChild(h('div.go', { style: { justifyContent: 'flex-start', marginTop: '6px' } }, up, h('button.mg-btn.ghost', { type: 'button', onclick: () => { delete st.badge.img; st.badge = B.sanitise(st.badge); draw(); } }, 'Use the drawing'), file));
    opts.appendChild(err);
    stage.appendChild(h('div.mg-maker', pv, opts));
    stage.appendChild(h('div.go', h('button.mg-btn.primary.big', { type: 'button', onclick: next }, 'Continue')));
    draw();
  }
  function shrink(f) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => {
        try {
          const c = root.document.createElement('canvas'); c.width = c.height = IMG;
          const g = c.getContext('2d'), s = Math.min(img.width, img.height);
          g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, IMG, IMG);
          let out = '';
          for (const [type, q] of [['image/webp', 0.86], ['image/jpeg', 0.84], ['image/webp', 0.6], ['image/jpeg', 0.55]]) {
            out = c.toDataURL(type, q);
            if (out.startsWith('data:' + type) && out.length <= Mgr.badge.IMG_MAX) break;
          }
          URL.revokeObjectURL(url);
          if (out.length > Mgr.badge.IMG_MAX) return rej(new Error('too big'));
          res(out);
        } catch (e) { rej(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('not an image')); };
      img.src = url;
    });
  }

  /* ---- 4: the country and the league, as FM picks them ---- */
  function askLeague(stage, next) {
    stage.style.width = 'min(920px, calc(100vw - 32px))';
    stage.appendChild(h('h1.q', 'Where will you manage?'));
    const box = h('div.mg-pick'), cs = h('div.cs', { role: 'listbox', 'aria-label': 'Countries' }), ls = h('div.ls', { role: 'listbox', 'aria-label': 'Leagues' });
    box.appendChild(cs); box.appendChild(ls);
    const info = h('div', { style: { marginTop: '14px', minHeight: '64px' } });
    const btn = h('button.mg-btn.primary.big', { type: 'button', disabled: true, onclick: next }, 'Continue');
    stage.appendChild(box); stage.appendChild(info); stage.appendChild(h('div.go', btn));
    cs.appendChild(h('p.hint', 'Reading the leagues…'));
    Mgr.site.leagues().then(list => {
      const C = root.EpinoiaCountry, groups = C ? C.group(list) : [{ code: '', name: 'Leagues', leagues: list }];
      cs.textContent = '';
      let cur = null;
      groups.forEach(g => {
        const src = C && C.flagSrc(g.code);
        const b = h('button', { type: 'button', role: 'option', 'aria-pressed': 'false' }, src ? h('img.flag', { src: '../' + src, alt: '' }) : h('span', g.flag || ''), h('span', g.name),
          h('span', { style: { marginLeft: 'auto', opacity: '.6', fontSize: '12px' } }, String(g.leagues.length)));
        b.addEventListener('click', () => { cs.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); cur = g; leaguesOf(g); });
        cs.appendChild(b);
      });
      const pre = st.league && groups.find(g => g.leagues.some(l => l.id === st.league.id));
      const first = cs.querySelectorAll('button')[pre ? groups.indexOf(pre) : 0];
      if (first) first.click();
      void cur;
    }).catch(() => { cs.textContent = ''; cs.appendChild(h('p.hint.bad', 'The leagues could not be read. Try again in a moment.')); });
    function leaguesOf(g) {
      ls.textContent = '';
      g.leagues.forEach(L => {
        const b = h('button', { type: 'button', role: 'option', 'aria-pressed': String(!!(st.league && st.league.id === L.id)) }, A.nm(L.name), h('span.r', L.seasonName || ''));
        b.addEventListener('click', () => { ls.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); pick(L); });
        ls.appendChild(b);
      });
    }
    async function pick(L) {
      st.league = L; st.loaded = null; btn.disabled = true;
      info.textContent = ''; info.appendChild(h('p.hint', 'Reading ' + L.name + '…'));
      try {
        const lg = await Mgr.site.league(L);
        if (st.league !== L) return;
        const top = Math.max(...lg.teams.map(x => +x.gp || 0)), clubs = (lg.teams || []).filter(t => (+t.gp || 0) >= (top >= 10 ? 0.34 * top : 1));
        const enough = lg.rows && lg.rows.length >= 50 && clubs.length >= 4;
        info.textContent = '';
        info.appendChild(h('div.mg-row', { style: { justifyContent: 'center', gap: '18px', color: 'rgba(220,230,255,.85)', fontSize: '14px' } },
          h('span', h('b', String(clubs.length)), ' clubs'), h('span', h('b', String((lg.S.games || []).length)), ' games played'),
          h('span', 'Wages ', h('b', Mgr.value.money(lg.range.min)), '–', h('b', Mgr.value.money(lg.range.max))),
          h('span', 'Squad budget ', h('b', Mgr.value.money(lg.budget)))));
        if (!enough) info.appendChild(h('p.hint.bad', 'Too few games have been played in this league yet for a manager league: pick another, or come back when its season is under way.'));
        st.loaded = enough ? lg : null;
        btn.disabled = !enough;
      } catch (_) { info.textContent = ''; info.appendChild(h('p.hint.bad', 'This league could not be read just now.')); }
    }
  }

  /* ---- 5: how to play ---- */
  function askMode(stage) {
    stage.appendChild(h('h1.q', 'How will you play?'));
    const solo = h('button.mg-mode', { type: 'button', 'aria-pressed': 'true' }, h('b', 'Individual'),
      h('span', 'Your club against the league’s real clubs, each played by its own players at their own minutes. A place on the leaderboards, the league’s and everybody’s.'));
    const friends = h('button.mg-mode', { type: 'button', disabled: true, 'aria-pressed': 'false' }, h('b', 'With friends'),
      h('span', 'Your friends’ clubs in the same league, a table of your own. Coming soon.'));
    stage.appendChild(h('div.mg-modes', solo, friends));
    const pw = h('div.mg-tabs', { role: 'group', 'aria-label': 'Games a week', style: { marginTop: '22px' } });
    [[2, 'Two games a week'], [1, 'One game a week']].forEach(([n, label]) => pw.appendChild(h('button', { type: 'button', 'aria-pressed': String(st.perWeek === n), onclick: e => {
      st.perWeek = n; pw.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }, label)));
    stage.appendChild(h('div', pw));
    /* THE PLAYER POOL (Louie: "preset by the user ... whether they want to use from one league or select multiple") */
    st.pool = st.pool || [];
    const poolBox = h('div.mg-poolpick', { style: { marginTop: '22px', textAlign: 'left' } });
    const list = h('div', { style: { maxHeight: '28vh', overflowY: 'auto', marginTop: '10px', display: 'none', border: '1px solid rgba(160,190,255,.22)', borderRadius: '12px', padding: '8px 12px' } });
    const one = h('button', { type: 'button', 'aria-pressed': String(!st.pool.length) }, 'Draft from ' + st.league.name + ' only');
    const many = h('button', { type: 'button', 'aria-pressed': String(!!st.pool.length) }, 'Add other leagues');
    const tabs = h('div.mg-tabs', { role: 'group', 'aria-label': 'Player pool' }, one, many);
    const pick = on => { one.setAttribute('aria-pressed', String(!on)); many.setAttribute('aria-pressed', String(on)); list.style.display = on ? 'block' : 'none'; if (!on) { st.pool = []; list.querySelectorAll('input').forEach(i => { i.checked = false; }); } };
    one.addEventListener('click', () => pick(false)); many.addEventListener('click', () => pick(true));
    Mgr.site.leagues().then(all => {
      const C = root.EpinoiaCountry, groups = C ? C.group(all) : [{ name: '', leagues: all }];
      groups.forEach(g => { const ls = g.leagues.filter(L => L.id !== st.league.id); if (!ls.length) return;
        list.appendChild(h('div.mg-cap', { style: { margin: '8px 0 4px' } }, g.name));
        ls.forEach(L => { const cb = h('input', { type: 'checkbox', checked: st.pool.includes(L.id) ? true : null });
          cb.addEventListener('change', () => { st.pool = cb.checked ? st.pool.concat([L.id]) : st.pool.filter(x => x !== L.id); });
          list.appendChild(h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', fontSize: '14px' } }, cb, A.nm(L.name))); }); });
      if (st.pool.length) pick(true);
    }).catch(() => {});
    poolBox.appendChild(h('div.mg-cap', 'Players to draft from')); poolBox.appendChild(tabs); poolBox.appendChild(list);
    stage.appendChild(poolBox);
    stage.appendChild(h('p.hint', 'Your games are played on the real calendar: Saturdays, and Wednesdays too at two a week, from the first match day after you confirm your squad. The players’ real form in the days before each round moves them.'));
    const err = h('p.hint.bad', { 'aria-live': 'polite' });
    /* NOTHING IS MADE YET (Louie: "teams to not be confirmed/saved until confirm squad has been clicked"): the club waits in
       this browser while its squad is drafted, and is made when the squad is confirmed (app.js confirmSquad) */
    const btn = h('button.mg-btn.primary.big', { type: 'button' }, 'Build my squad');
    btn.addEventListener('click', async () => {
      btn.disabled = true; err.textContent = '';
      try {
        if (A.clubs.length >= 3) throw new Error('three clubs at most');
        const L = st.league;
        const club = A.newPending({ league: L.id, competition: L.competitionIds[0], name: st.name, manager: st.manager, badge: Mgr.badge.sanitise(st.badge), perWeek: st.perWeek, budget: st.loaded.budget });
        A.store('mgr_net_pending', JSON.stringify(st.pool || []));
        A.keepPending(club);
        close();
        A.lg = null; A.identity = new Map(); A.news = [];
        await A.openClub(club);
        A.go('/squad');
      } catch (e) {
        btn.disabled = false;
        const m = String(e && e.message || e);
        err.textContent = /three clubs/.test(m) ? 'You already have three clubs: delete one in its settings first.' : 'The club could not be set up: ' + m;
      }
    });
    stage.appendChild(h('div.go', btn));
    stage.appendChild(err);
  }

  show(0);
  /* leaving the page by the address (Back) takes the black screen with it */
  root.addEventListener('hashchange', function off() { if (A.route.name !== 'new') { close(); root.removeEventListener('hashchange', off); } });
}

A.views.new = { render };
})(typeof globalThis !== 'undefined' ? globalThis : self);
