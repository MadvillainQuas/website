'use strict';
/* ============================================================================
   WHAT A STATS TABLE COVERS: which competitions, and which conference.

   A college league is forty-eight clubs in four conferences (U SPORTS), and a
   table of all forty-eight is one nobody reads -- the clubs a reader is looking
   for are the ones their own club plays. So a stats table on EPINOIA is split
   the way its league is:

     covering    the whole season, or one competition of it (a league phase, a
                 cup, a trophy). Only competitions with a finalised game are
                 offered: one with none has no statistics, and BCB carries a
                 duplicate competition that has never had a fixture at all.
     conference  when the clubs in view fall into two or more conferences
                 (competition_teams.group_name on a 'conferences' competition,
                 0144) or groups (ProB's Nord and Sud), one button each. The
                 buttons are named the way the standings name them.

   Both are buttons, not a select: they are the choice the page is about, not a
   setting. A view that would list SPLIT_AT clubs or more opens on its first
   conference rather than on all of them; "all" is always one tap away.

   Shared by the league page (Leaders, Team Stats, Strength of Schedule) and the
   Statistics page, so the control and its rules are one thing. The rules are
   pure functions over the rows PostgREST returns, and run under node
   (supabase/tests/scopebar.test.mjs).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaScopeBar = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SPLIT_AT = 40;

/* a club in two competitions takes the group of the one that is a conference league, then of
   one played in groups, then of anything else */
const FORMAT_RANK = { conferences: 0, groups: 1, groups_knockout: 1 };
const rankOf = c => (c && Object.prototype.hasOwnProperty.call(FORMAT_RANK, c.format) ? FORMAT_RANK[c.format] : 2);

/* named the way the standings name them (standings.js): a conference as itself, a group of a
   single league as "Group X" */
function label(name, comp) {
  const ST = root && root.EpinoiaStandings;
  if (ST && typeof ST.groupLabel === 'function') return ST.groupLabel(name, comp);
  return comp && comp.format === 'conferences' ? name : 'Group ' + name;
}

/* ------------------------------------------------------------- the model ---
   comps    the season's competition rows {id, name, kind, format}
   entries  competition_teams rows {competition_id, team_id, group_name}
   played   Set of the competition ids that have a finalised game */
function model(comps, entries, played) {
  const list = (comps || []).filter(c => c && c.id);
  const done = played || new Set(list.map(c => c.id));
  return { comps: list, played: list.filter(c => done.has(c.id)), entries: entries || [] };
}

/* The groups of the clubs entered in the competitions in scope: {noun, list, clubs}. `list` is
   empty unless there are two or more groups -- one group is not a choice. */
function groups(M, scopeIds) {
  const want = new Set(scopeIds || []);
  const cs = (M && M.comps || []).filter(c => want.has(c.id)).sort((a, b) => rankOf(a) - rankOf(b));
  const ofTeam = new Map(), byName = new Map(), clubs = new Set();
  let conferences = false;
  cs.forEach(c => {
    (M.entries || []).forEach(e => {
      if (!e || e.competition_id !== c.id || !e.team_id) return;
      clubs.add(e.team_id);
      const g = e.group_name == null ? '' : String(e.group_name).trim();
      if (!g || ofTeam.has(e.team_id)) return;
      ofTeam.set(e.team_id, g);
      if (!byName.has(g)) byName.set(g, { name: g, label: label(g, c), teams: new Set() });
      byName.get(g).teams.add(e.team_id);
      if (c.format === 'conferences') conferences = true;
    });
  });
  const list = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { noun: conferences ? 'conference' : 'group', list: list.length >= 2 ? list : [], clubs };
}

/* The conference to show: the reader's choice while this scope still has it; otherwise every
   club, unless that is SPLIT_AT clubs or more, when it is the first conference. */
function settle(M, scopeIds, conf) {
  const G = groups(M, scopeIds);
  if (!G.list.length) return 'all';
  if (conf === 'all' || G.list.some(g => g.name === conf)) return conf;
  return G.clubs.size >= SPLIT_AT ? G.list[0].name : 'all';
}

/* teamId -> is this club in the conference being shown */
function keeper(M, scopeIds, conf) {
  if (!conf || conf === 'all') return () => true;
  const g = groups(M, scopeIds).list.find(x => x.name === conf);
  return g ? (id => g.teams.has(id)) : () => true;
}

/* ------------------------------------------------------------------ read ---
   Once per season. D is EpinoiaData, so a members-only league's rows are asked for with the
   member's token like every other read. A read that fails leaves the control as it was before
   conferences existed: every competition offered, no conference buttons. */
async function load(D, comps) {
  const list = (comps || []).filter(c => c && c.id);
  const ids = list.map(c => c.id);
  if (!ids.length || !D) return model(list, [], new Set());
  const many = typeof D.all === 'function' ? D.all : D.get;
  const [entries, played] = await Promise.all([
    Promise.resolve().then(() => many('competition_teams?competition_id=in.(' + ids.join(',') + ')' +
      '&select=competition_id,team_id,group_name')).catch(() => []),
    Promise.all(ids.map(id => Promise.resolve()
      .then(() => D.get('games?competition_id=eq.' + id + '&status=in.(final,finalising)&select=id&limit=1'))
      .then(r => (r && r.length ? id : null), () => id)))
  ]);
  return model(list, entries || [], new Set(played.filter(Boolean)));
}

/* ------------------------------------------------------------------ view --- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function row(noun, items, value, onPick) {
  const wrap = el('div', 'scopebar');
  wrap.appendChild(el('span', 'scopelab', noun));
  items.forEach(([v, text, tag]) => {
    const on = v === value;
    const b = el('button', 'ep-chip' + (on ? ' on' : ''), text);
    b.type = 'button';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (tag) b.appendChild(el('span', 'kindtag', tag));
    b.addEventListener('click', () => { if (!on) onPick(v); });
    wrap.appendChild(b);
  });
  return wrap;
}

/* o: { host, model, scope ('all' or a competition id), conf, scopeIds(scope) -> ids,
        onScope(scope), onConf(conf) } */
function mount(o) {
  const host = o.host;
  if (!host) return;
  host.textContent = '';
  const M = o.model;
  if (M.played.length >= 2) {
    host.appendChild(row('covering',
      [['all', 'whole season']].concat(M.played.map(c =>
        [c.id, c.name, c.kind && c.kind !== 'league' ? c.kind : null])),
      o.scope, o.onScope));
  }
  const G = groups(M, o.scopeIds(o.scope));
  if (G.list.length) {
    host.appendChild(row(G.noun, [['all', 'all']].concat(G.list.map(g => [g.name, g.label])),
      o.conf, o.onConf));
  }
}

return { SPLIT_AT, model, groups, settle, keeper, load, mount, label };
}));
