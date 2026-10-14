'use strict';
/* ============================================================================
   CHECK VIA LEAGUE, AS A PART (2026-10-14): the three tick-box dropdowns HOME's Daily fixtures opened with - continent,
   country, league, each narrowing the next - for any section that wants them (Daily fixtures, Games to watch).

     EpinoiaLeaguePick.mount({
       btnAfter    the element the "Check via league" button is put after
       barBefore   the element the dropdowns' bar is put before
       id          the bar's id (aria-controls)
       key         where the choice is kept for the visit (sessionStorage): { sel, ids }
       leagues     optional async () -> the leagues to offer (default: globalgames.js leagues(), every public league)
       onChange    (Set of league ids | null) -> void, after every tick
     }) -> { ids() }

   What a choice means: the leagues ticked; else every league of the countries ticked; else of the continents; else all
   (null). A choice that leaves nothing is a set holding 'none', so a section shows its empty state, not everything.
   ============================================================================ */
(function () {
  /* the continent of a country code (the first of a pair like "BE NL") */
  const CONT = [['Europe', ''], ['North America', 'US CA MX PR DO CU'], ['South America', 'BR AR UY CL CO VE PY PE EC BO'],
    ['Asia', 'JP CN KR PH TW IL TR LB IR QA SA AE KZ IN ID TH MY SG HK MN JO BH KW'], ['Oceania', 'AU NZ'], ['Africa', 'EG TN MA NG SN AO ZA RW CM CI ML DZ']];
  const contOf = code => { const c = String(code || '').slice(0, 2).toUpperCase(); if (!c) return 'International'; const f = CONT.find(([, l]) => l && (' ' + l + ' ').includes(' ' + c + ' ')); return f ? f[0] : 'Europe'; };
  const mk = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

  /* the choice kept for the visit, as { sel, ids } */
  function stored(key) {
    try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); if (v && v.sel) return v; } catch (_) { /* private mode */ }
    return null;
  }

  function mount(o) {
    if (!o || !o.btnAfter || !o.barBefore || !o.barBefore.parentNode || typeof document.createElement !== 'function') return null;
    const G = window.EpinoiaGlobalGames, C = window.EpinoiaCountry;
    const kept = stored(o.key);
    let sel = kept ? { cont: kept.sel.cont || [], cty: kept.sel.cty || [], lg: kept.sel.lg || [] } : { cont: [], cty: [], lg: [] };
    let pick = kept && kept.ids && kept.ids.length ? new Set(kept.ids) : null;
    const btn = mk('button', 'fx-pickbtn');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    if (o.id) btn.setAttribute('aria-controls', o.id);
    const label = () => { btn.textContent = 'Check via league' + (pick ? ' · ' + pick.size : ''); btn.classList.toggle('on', !!pick); };
    label();
    o.btnAfter.after(btn);
    const bar = mk('div', 'fxp');
    if (o.id) bar.id = o.id;
    bar.hidden = true;
    o.barBefore.parentNode.insertBefore(bar, o.barBefore);
    let groups = null;
    const dd = (key, title) => {
      const d = mk('details', 'fxp-dd');
      const s = mk('summary', null);
      const t = mk('span', 'fxp-t', title), v = mk('span', 'fxp-v');
      s.append(t, v);
      const list = mk('div', 'fxp-list');
      d.append(s, list);
      d.dataset.key = key;
      return { d, v, list };
    };
    const conts = dd('cont', 'Continent'), ctys = dd('cty', 'Country'), lgs = dd('lg', 'League');
    const clear = mk('button', 'fxp-clear', 'Clear');
    clear.type = 'button';
    bar.append(conts.d, ctys.d, lgs.d, clear);
    const ctysLeft = () => groups.filter(g => !sel.cont.length || sel.cont.includes(contOf(g.code)));
    const leaguesLeft = () => ctysLeft().filter(g => !sel.cty.length || sel.cty.includes(g.code)).flatMap(g => g.leagues);
    const box = (dropdown, key, value, text, flag) => {
      const lab = mk('label', 'fxp-opt');
      const cb = mk('input');
      cb.type = 'checkbox';
      cb.checked = sel[key].includes(value);
      cb.addEventListener('change', () => {
        sel[key] = cb.checked ? sel[key].concat([value]) : sel[key].filter(x => x !== value);
        /* a narrower choice never keeps what the wider one has taken away */
        if (key === 'cont') sel.cty = sel.cty.filter(c => !sel.cont.length || sel.cont.includes(contOf(c)));
        if (key !== 'lg') { const ok = new Set(leaguesLeft().map(l => String(l.id))); sel.lg = sel.lg.filter(x => ok.has(x)); }
        paint(); apply();
      });
      lab.appendChild(cb);
      if (flag) { const i = mk('img', 'fxp-flag'); i.src = (o.base || '../') + flag; i.alt = ''; lab.appendChild(i); }
      lab.appendChild(mk('span', null, text));
      dropdown.list.appendChild(lab);
    };
    function paint() {
      [conts, ctys, lgs].forEach(x => { x.list.textContent = ''; });
      [...new Set(groups.map(g => contOf(g.code)))].sort().forEach(c => box(conts, 'cont', c, c));
      ctysLeft().forEach(g => box(ctys, 'cty', g.code, g.name, C && C.flagSrc ? C.flagSrc(String(g.code).slice(0, 2)) : null));
      leaguesLeft().slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(l => box(lgs, 'lg', String(l.id), l.name));
      conts.v.textContent = sel.cont.length ? sel.cont.length === 1 ? sel.cont[0] : sel.cont.length + ' picked' : 'All';
      ctys.v.textContent = sel.cty.length ? sel.cty.length + ' picked' : 'All';
      lgs.v.textContent = sel.lg.length ? sel.lg.length + ' picked' : 'All';
    }
    function apply() {
      const any = sel.cont.length || sel.cty.length || sel.lg.length;
      const ids = !any ? [] : sel.lg.length ? sel.lg.slice() : leaguesLeft().map(l => String(l.id));
      pick = any ? new Set(ids.length ? ids : ['none']) : null;
      try { sessionStorage.setItem(o.key, JSON.stringify({ sel, ids: pick ? [...pick] : [] })); } catch (_) { /* private mode */ }
      label();
      if (typeof o.onChange === 'function') { try { o.onChange(pick); } catch (e) { console.warn('[leaguepick]', e); } }
    }
    clear.addEventListener('click', () => { sel = { cont: [], cty: [], lg: [] }; if (groups) paint(); apply(); });
    btn.addEventListener('click', async () => {
      const open = bar.hidden;
      bar.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open && !groups) {
        bar.classList.add('loading');
        try {
          const all = typeof o.leagues === 'function' ? await o.leagues() : G ? await G.leagues() : [];
          groups = C && C.group ? C.group(all) : [{ code: '', name: 'Leagues', leagues: all }];
        } catch (_) { groups = []; }
        bar.classList.remove('loading');
        paint();
      }
    });
    /* one dropdown open at a time; a click elsewhere closes it */
    bar.addEventListener('toggle', e => { if (e.target.open) [conts, ctys, lgs].forEach(x => { if (x.d !== e.target) x.d.open = false; }); }, true);
    document.addEventListener('click', e => { if (!bar.contains(e.target)) [conts, ctys, lgs].forEach(x => { x.d.open = false; }); });
    return { ids: () => pick, btn, bar };
  }

  window.EpinoiaLeaguePick = { mount, stored, contOf };
})();
