'use strict';
/* ============================================================================
   AWARDS AND THE TEAM OF THE YEAR.

   Two panels. The first lets a league OVERRULE a computed award — Coach of the
   Year is a vote, Most Improved is an opinion, and neither falls out of a box
   score. The override is stored beside the computed answer rather than on top
   of it (migration 0047), so "what did the numbers say" survives being
   overruled, and so the next finalised game does not silently undo the
   decision when compute_season_awards rebuilds the set.

   The second runs a ballot with two electorates: the public, from a button on
   the league's front page, and the league's own officials, entered here or
   pasted from a spreadsheet. Each side is scored as a share of ITSELF and the
   two are mixed by a weighting the league sets, which is what stops nine
   officials being drowned by four hundred fans.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAwards = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const opt = (v, l) => { const o = document.createElement('option'); o.value = v;
  o.textContent = l; return o; };

/* The codes the platform computes, plus the ones it never will. Kept here
   rather than read from the database so a league can award something it has
   not awarded before without a migration. */
const CODES = [
  ['mvp', 'Most Valuable Player'], ['scorer', 'Leading Scorer'],
  ['rebounder', 'Leading Rebounder'], ['playmaker', 'Leading Playmaker'],
  ['defender', 'Defensive Player of the Year'],
  ['newcomer', 'Newcomer of the Year'], ['improved', 'Most Improved'],
  ['coach', 'Coach of the Year'], ['sixth', 'Sixth Man'],
  ['fairplay', 'Fair Play Award'], ['club', 'Club of the Year']
];

/* -------------------------------------------------------------- overrides --- */
function mountOverrides(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';
  if (!o.comp) {
    host.appendChild(el('div', 'empty', 'Pick a competition above to award something.'));
    return;
  }

  host.appendChild(el('p', 'empty',
    'A chosen winner sits beside the computed one rather than replacing it, so ' +
    'the numbers are still there underneath and clearing the choice puts them ' +
    'back. Awards the platform does not compute — Coach of the Year, Most ' +
    'Improved — simply appear once you set them.'));

  const r = el('div', 'row');
  const code = el('select', 'ep-input');
  code.style.flex = '1 1 200px';
  CODES.forEach(c => code.appendChild(opt(c[0], c[1])));
  const who = el('select', 'ep-input'); who.style.flex = '2 1 220px';
  const detail = el('input', 'ep-input grow');
  detail.placeholder = 'A line of explanation (optional, published)';
  detail.maxLength = 140;
  const go = el('button', 'ep-btn pri', 'award'); go.type = 'button';
  r.append(code, who);
  const r2 = el('div', 'row'); r2.append(detail, go);
  host.append(r, r2);

  const listHost = el('div', 'list');
  host.appendChild(listHost);

  /* Players and clubs in one picker. A Coach of the Year is recorded against
     the club, because the platform does not hold coaches as people with ids —
     staff are names on a team profile — and inventing a second identity for
     them here would be a worse problem than a club-shaped trophy. */
  async function fillWho() {
    who.textContent = '';
    Object.values(o.teams || {}).forEach(t =>
      who.appendChild(opt('team:' + t.id, 'club — ' + t.name)));
    const res = await o.sb.rpc('league_players', { p_league: o.league.id, p_search: '' });
    (res.data || []).forEach(p => who.appendChild(
      opt('player:' + p.player_id, p.first_name + ' ' + p.last_name + ' · ' + p.team_name)));
  }

  go.addEventListener('click', async () => {
    if (!who.value) return o.say('Choose who it goes to.', 'err');
    const [kind, id] = who.value.split(':');
    const title = (CODES.find(c => c[0] === code.value) || [])[1] || code.value;
    go.disabled = true;
    const res = await o.sb.rpc('set_award_override', {
      p_competition: o.comp.id, p_code: code.value,
      p_player: kind === 'player' ? id : null,
      p_team: kind === 'team' ? id : null,
      p_title: title, p_detail: detail.value });
    go.disabled = false;
    if (res.error) return o.say(res.error.message, 'err');
    o.say(title + ' awarded.', 'ok');
    detail.value = '';
    load();
  });

  async function load() {
    const res = await o.sb.rpc('season_awards_resolved', { p_competition: o.comp.id });
    listHost.textContent = '';
    if (res.error) return o.say(res.error.message, 'err');
    const rows = res.data || [];
    if (!rows.length) {
      listHost.appendChild(el('div', 'empty',
        'Nothing awarded yet. The computed ones appear as soon as a game is finalised.'));
      return;
    }
    rows.forEach(a => {
      const row = el('div', 'item');
      if (a.chosen) row.classList.add('on');
      const title = a.title || (CODES.find(c => c[0] === a.code) || [])[1] || a.code;
      row.append(el('div', 'nm', title),
                 el('div', 'mt', (a.chosen ? 'chosen' : 'computed') +
                    (a.value != null ? ' · ' + a.value : '') +
                    (a.detail ? ' · ' + a.detail : '')));
      if (a.chosen) {
        const sp = el('div', 'sp');
        const rm = el('button', 'ep-btn mini', 'back to computed'); rm.type = 'button';
        rm.addEventListener('click', async () => {
          const res2 = await o.sb.rpc('clear_award_override',
            { p_competition: o.comp.id, p_code: a.code });
          if (res2.error) return o.say(res2.error.message, 'err');
          o.say(res2.data, 'ok'); load();
        });
        sp.appendChild(rm); row.appendChild(sp);
      }
      listHost.appendChild(row);
    });
  }

  fillWho();
  load();
}

/* ------------------------------------------------------- team of the year --- */
function mountToty(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';
  if (!o.comp) {
    host.appendChild(el('div', 'empty', 'Pick a competition above to run a ballot.'));
    return;
  }

  let ballot = null;
  let candidates = [];

  host.appendChild(el('p', 'empty',
    'The public vote from the league’s front page; your officials vote here. ' +
    'Each side is scored as a share of its own electorate and the two are ' +
    'mixed by the weighting below — so nine officials are not drowned by four ' +
    'hundred supporters, whatever the turnout. Nothing is shown publicly until ' +
    'you publish it.'));

  /* ---- the ballot itself ---- */
  const r1 = el('div', 'row');
  const title = el('input', 'ep-input grow'); title.value = 'Team of the Year';
  title.maxLength = 60;
  const slots = el('input', 'ep-input'); slots.type = 'number'; slots.min = '1';
  slots.max = '15'; slots.value = '5';
  const lSlots = el('label', 'f'); lSlots.style.flex = '0 0 90px';
  lSlots.append(el('span', null, 'SLOTS'), slots);
  r1.append(title, lSlots);

  const r2 = el('div', 'row');
  const opens = el('input', 'ep-input'); opens.type = 'datetime-local';
  const closes = el('input', 'ep-input'); closes.type = 'datetime-local';
  const pw = el('input', 'ep-input'); pw.type = 'number'; pw.step = '0.05';
  pw.min = '0'; pw.max = '1'; pw.value = '0.4';
  const ow = el('input', 'ep-input'); ow.type = 'number'; ow.step = '0.05';
  ow.min = '0'; ow.max = '1'; ow.value = '0.6';
  const lo = el('label', 'f'); lo.style.flex = '1 1 170px';
  lo.append(el('span', null, 'OPENS'), opens);
  const lc = el('label', 'f'); lc.style.flex = '1 1 170px';
  lc.append(el('span', null, 'CLOSES'), closes);
  const lp = el('label', 'f'); lp.style.flex = '0 0 110px';
  lp.append(el('span', null, 'PUBLIC WEIGHT'), pw);
  const lw = el('label', 'f'); lw.style.flex = '0 0 110px';
  lw.append(el('span', null, 'OFFICIAL WEIGHT'), ow);
  r2.append(lo, lc, lp, lw);

  const r3 = el('div', 'row');
  const status = el('select', 'ep-input'); status.style.flex = '0 0 auto';
  [['draft', 'draft — nobody can see it'],
   ['open', 'open — voting'],
   ['closed', 'closed — voting over, result not out'],
   ['published', 'published — the team is on the site']]
    .forEach(pair => status.appendChild(opt(pair[0], pair[1])));
  const save = el('button', 'ep-btn pri', 'save ballot'); save.type = 'button';
  const state = el('span', 'mt'); state.style.marginLeft = 'auto';
  r3.append(status, save, state);

  host.append(r1, r2, r3);

  save.addEventListener('click', async () => {
    save.disabled = true;
    const res = await o.sb.rpc('toty_upsert', {
      p_ballot: ballot ? ballot.id : null, p_competition: o.comp.id,
      p_title: title.value, p_slots: Number(slots.value || 5),
      p_opens: opens.value ? new Date(opens.value).toISOString() : null,
      p_closes: closes.value ? new Date(closes.value).toISOString() : null,
      p_public_weight: Number(pw.value || 0), p_official_weight: Number(ow.value || 0),
      p_status: status.value });
    save.disabled = false;
    if (res.error) return o.say(res.error.message, 'err');
    o.say(status.value === 'published'
      ? 'Published — the team is now on the league’s front page.'
      : 'Ballot saved.', 'ok');
    load();
  });

  /* ---- candidates ---- */
  host.appendChild(el('div', 'fmt-h', 'Shortlist'));
  const cRow = el('div', 'row');
  const autoN = el('input', 'ep-input'); autoN.type = 'number'; autoN.min = '2';
  autoN.max = '60'; autoN.value = '20';
  const lAuto = el('label', 'f'); lAuto.style.flex = '0 0 100px';
  lAuto.append(el('span', null, 'TOP N'), autoN);
  const autoBtn = el('button', 'ep-btn', 'shortlist the leading scorers');
  autoBtn.type = 'button';
  cRow.append(lAuto, autoBtn);
  host.appendChild(cRow);
  const cList = el('div', 'fmt-grid');
  host.appendChild(cList);

  autoBtn.addEventListener('click', async () => {
    if (!ballot) return o.say('Save the ballot first.', 'err');
    autoBtn.disabled = true;
    const res = await o.sb.rpc('toty_set_candidates',
      { p_ballot: ballot.id, p_players: null, p_top: Number(autoN.value || 20) });
    autoBtn.disabled = false;
    if (res.error) return o.say(res.error.message, 'err');
    o.say(res.data + ' candidates shortlisted.', 'ok');
    load();
  });

  /* ---- official votes ---- */
  host.appendChild(el('div', 'fmt-h', 'Official votes'));
  host.appendChild(el('p', 'empty',
    'One line per voter. Paste from a spreadsheet: the first column is who is ' +
    'voting, the second their weight, and the rest are the players they picked ' +
    'by name. A voter entered twice replaces their earlier ballot rather than ' +
    'voting twice.'));
  const ta = el('textarea', 'ep-input im-ta');
  ta.placeholder = 'Head of Officiating,1,Jo Bloggs,Sam Smith,Alex Roe\n' +
                   'Statistician,1,Sam Smith,Alex Roe,Jo Bloggs';
  ta.rows = 5;
  host.appendChild(ta);
  const oRow = el('div', 'row');
  const oGo = el('button', 'ep-btn', 'record official votes'); oGo.type = 'button';
  const file = el('input'); file.type = 'file'; file.accept = '.csv,text/csv';
  oRow.append(file, oGo);
  host.appendChild(oRow);

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { ta.value = String(fr.result || ''); };
    fr.readAsText(f);
  });

  oGo.addEventListener('click', async () => {
    if (!ballot) return o.say('Save the ballot first.', 'err');
    if (!candidates.length) return o.say('Shortlist some candidates first.', 'err');

    /* Names are matched against the SHORTLIST rather than the whole league,
       because that is the only set a vote can legally name and it makes the
       match unambiguous where two players share a surname across clubs. */
    const byName = new Map();
    candidates.forEach(c => byName.set(norm(c.name), c.player_id));

    const rows = [];
    const missing = [];
    ta.value.split(/\r?\n/).forEach(line => {
      const cells = splitCsv(line);
      if (cells.length < 3 || !cells[0].trim()) return;
      const voter = cells[0].trim();
      const weight = Number(cells[1]) || 1;
      const players = [];
      cells.slice(2).forEach(nameRaw => {
        const name = nameRaw.trim();
        if (!name) return;
        const id = byName.get(norm(name));
        if (id) players.push(id); else missing.push(name);
      });
      if (players.length) rows.push({ voter, weight, players });
    });

    if (!rows.length) return o.say('Nothing readable in there.', 'err');
    if (missing.length) {
      if (!confirm('These names are not on the shortlist and will be skipped:\n\n' +
                   missing.join(', ') + '\n\nCarry on with the rest?')) return;
    }
    oGo.disabled = true;
    const res = await o.sb.rpc('toty_official_votes',
      { p_ballot: ballot.id, p_rows: rows });
    oGo.disabled = false;
    if (res.error) return o.say(res.error.message, 'err');
    o.say(rows.length + ' official ballot' + (rows.length === 1 ? '' : 's') +
          ' recorded (' + res.data + ' votes).', 'ok');
    ta.value = '';
    count();
  });

  /* ---- the count ---- */
  host.appendChild(el('div', 'fmt-h', 'The count'));
  const countRow = el('div', 'row');
  const countBtn = el('button', 'ep-btn', 'count the votes'); countBtn.type = 'button';
  countRow.appendChild(countBtn);
  host.appendChild(countRow);
  const results = el('div', 'list');
  host.appendChild(results);

  countBtn.addEventListener('click', async () => {
    if (!ballot) return o.say('Save the ballot first.', 'err');
    countBtn.disabled = true;
    const res = await o.sb.rpc('compute_toty', { p_ballot: ballot.id });
    countBtn.disabled = false;
    if (res.error) return o.say(res.error.message, 'err');
    o.say('Counted — ' + res.data + ' players received a vote.', 'ok');
    count();
  });

  async function count() {
    results.textContent = '';
    if (!ballot) return;
    const res = await o.sb.rpc('toty_standings', { p_ballot: ballot.id });
    if (res.error) return;
    const rows = res.data || [];
    if (!rows.length) {
      results.appendChild(el('div', 'empty', 'Nothing counted yet.'));
      return;
    }
    const slotN = ballot.slots || 5;
    rows.forEach(r => {
      const row = el('div', 'item');
      if (r.rank <= slotN) row.classList.add('on');
      row.append(el('div', 'nm', r.rank + '. ' + r.player_name),
                 el('div', 'mt', (r.team_name || '') +
                    ' · score ' + Number(r.score).toFixed(3) +
                    ' · public ' + pct(r.public_share) +
                    ' · officials ' + pct(r.official_share)));
      results.appendChild(row);
    });
  }

  async function load() {
    const res = await o.sb.from('toty_ballots')
      .select('id,title,slots,opens_at,closes_at,public_weight,official_weight,status')
      .eq('competition_id', o.comp.id)
      .order('created_at', { ascending: false }).limit(1);
    ballot = (res.data || [])[0] || null;

    if (ballot) {
      title.value = ballot.title;
      slots.value = ballot.slots;
      opens.value = forInput(ballot.opens_at);
      closes.value = forInput(ballot.closes_at);
      pw.value = ballot.public_weight;
      ow.value = ballot.official_weight;
      status.value = ballot.status;
      state.textContent = 'ballot is ' + ballot.status;
    } else {
      state.textContent = 'no ballot yet';
    }

    cList.textContent = '';
    candidates = [];
    if (ballot) {
      const c = await o.sb.from('toty_candidates')
        .select('player_id,players(first_name,last_name),teams(name)')
        .eq('ballot_id', ballot.id);
      candidates = (c.data || []).map(x => ({
        player_id: x.player_id,
        name: ((x.players || {}).first_name || '') + ' ' + ((x.players || {}).last_name || ''),
        team: (x.teams || {}).name || ''
      }));
      if (!candidates.length) {
        cList.appendChild(el('div', 'empty', 'No shortlist yet.'));
      } else {
        candidates.forEach(c2 => {
          const cell = el('div', 'fmt-cell');
          cell.append(el('span', 'fmt-name', c2.name.trim()),
                      el('span', 'mt', c2.team));
          cList.appendChild(cell);
        });
      }
    }
    count();
  }

  load();
}

/* ---------------------------------------------------------------- helpers --- */
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  /* fold accents, so "Šarić" pasted from one system matches "Saric" typed in
     another — the same fold the identity matcher uses elsewhere */
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const pct = v => (Number(v || 0) * 100).toFixed(0) + '%';

const forInput = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         'T' + p(d.getHours()) + ':' + p(d.getMinutes());
};

/* Enough CSV for a pasted row: quoted cells, doubled quotes inside them. A
   full parser is not warranted for three columns of names, but ignoring
   quotes entirely breaks the first time somebody's club has a comma in it. */
function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/* splitCsv and norm are exported so they can be tested on their own. They are
   the two places a pasted spreadsheet goes wrong — a club with a comma in its
   name, and a surname spelt with the accents in one system and without them
   in another — and neither is reachable through the UI without a live
   ballot. */
return { mountOverrides, mountToty, CODES, splitCsv, norm };
}));
