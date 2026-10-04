'use strict';
/* ============================================================================
   THE REPORTS MANAGER (2026-10-04; the platform console, Accounts > Reports by email > Open the reports manager).
   Everything about the reports by email in one pop-up:

     ADDRESSES AND CLUBS  each address with ALL its clubs - an address can have several (report_mail_subs is a row an address
                 and a club) - its name and time zone, whether its clubs' players' reports follow the Sunday email in a ZIP
                 (0228 player_zip), and for each club: PRIME REPORT (a report made ready - RAPM, Synergy, every page - and
                 downloaded, report.js prime) of each club it plays in the next two weeks (the reports its Sunday email
                 carries) or of its own, send next week's reports now, pause, remove. An address is added with one club or
                 several at once, and a club is added to an address already there.
     SYNERGY FILES  the scraper's CSV files dropped in (synergy.js reads them; only the numbers are kept, 0228
                 synergy_profiles), each player in them matched to a player OF THE CLUBS THE REPORTS ARE ON - every club an
                 address is sent reports of, and every club those play in the next two weeks (the Sunday email's scouting
                 reports), each with its PRIME REPORT; a club the schedule does not show yet can be added by hand. Never the
                 whole site: a name is suggested from those squads, and changed by hand from them (typed, or picked from a
                 club's squad), then kept, for every report the site draws and the mailer sends. The kept ones listed, each
                 to open its report primed, or to remove.

   platform.js opens it: EpinoiaReportsManager.open(sb, { say, oops, sendNow, sendLine, reload }).
   ============================================================================ */
(function () {
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const btn = (t, cls, fn) => { const b = el('button', 'ep-btn ' + (cls || ''), t); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
const SYN = () => window.EpinoiaSynergy;
const SITE = '../../';                                       // the console is at epinoia/admin/platform/
let sb = null, H = {}, dlg = null, body = null, tab = 'addr';
const PENDING = [];                                          // Synergy players read and not yet kept: { p, file, pick, hint, hand }
const EXTRA = new Map();                                     // clubs added by hand to match against: id -> { id, name, why }
const AHEAD_MS = 15 * 864e5;                                 // the next two weeks: the next Sunday email's week, wherever its reader is

/* ------------------------------------------------------------------ the pop-up --- */
function style() {
  if (document.getElementById('rm-style')) return;
  const s = el('style'); s.id = 'rm-style';
  s.textContent = `
.rm{ width:min(980px,96vw); max-height:92vh; padding:0; border:1px solid var(--rule-2,#ccc); border-radius:14px; background:var(--panel,#fff); color:var(--ink,#111) }
.rm::backdrop{ background:rgba(6,14,10,.55) }
.rm-h{ position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 18px 10px; background:var(--panel,#fff); border-bottom:1px solid var(--rule,#ddd) }
.rm-h h3{ margin:0; font-size:18px }
.rm-tabs{ display:flex; gap:6px; padding:10px 18px 0 }
.rm-tabs button.on{ background:var(--ink,#111); color:var(--panel,#fff) }
.rm-b{ padding:12px 18px 18px; overflow:auto; max-height:calc(92vh - 110px) }
.rm-box{ border:1px solid var(--rule,#ddd); border-radius:12px; padding:10px 12px; margin:0 0 12px }
.rm-box h4{ margin:0 0 8px; font-size:13px; letter-spacing:.04em; text-transform:uppercase }
.rm-row{ display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px }
.rm-chips{ display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 }
.rm-chip{ display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius:999px; background:var(--panel-2,#eef4f0); font-size:12px }
.rm-chip button{ border:0; background:none; cursor:pointer; font-size:14px; line-height:1; color:inherit }
.rm-addr{ border:1px solid var(--rule,#ddd); border-radius:12px; margin:0 0 10px; overflow:hidden }
.rm-addr-h{ display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:9px 12px; background:var(--panel-2,#eef4f0) }
.rm-addr-h b{ font-size:14px; overflow-wrap:anywhere }
.rm-club{ display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto; align-items:center; gap:6px 10px; padding:8px 12px; border-top:1px solid var(--rule,#ddd) }
.rm-club .acts{ display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end }
.rm-club small, .rm-mt{ color:var(--ink-3,#666); font-size:12px }
.rm-primes{ grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:6px }
.rm-prime{ background:#0d1f17 !important; color:#ffd166 !important; border-color:#0d1f17 !important; font-weight:800; letter-spacing:.06em }
.rm-syn{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:10px; align-items:start; padding:9px 0; border-top:1px solid var(--rule,#ddd) }
.rm-syn:first-child{ border-top:0 }
.rm-syn .who b{ display:block; font-size:14px }
.rm-pick{ display:flex; flex-direction:column; gap:6px }
.rm-found{ list-style:none; margin:0; padding:0; max-height:160px; overflow:auto; border:1px solid var(--rule,#ddd); border-radius:8px }
.rm-found li{ padding:5px 8px; cursor:pointer; font-size:13px } .rm-found li:hover{ background:var(--panel-2,#eef4f0) }
.rm-found li small{ color:var(--ink-3,#666) }
.rm-sel{ font-weight:700 } .rm-sel.none{ color:#b32433 }
@media (max-width:640px){ .rm-club, .rm-syn{ grid-template-columns:1fr } .rm-club .acts{ justify-content:flex-start } }`;
  document.head.appendChild(s);
}

async function open(client, hooks) {
  sb = client; H = hooks || {};
  style();
  if (!dlg) {
    dlg = el('dialog', 'rm');
    const head = el('div', 'rm-h');
    head.append(el('h3', null, 'Reports manager'), btn('close', 'mini', () => dlg.close()));
    const tabs = el('div', 'rm-tabs');
    [['addr', 'Addresses and clubs'], ['syn', 'Synergy files']].forEach(([k, t]) => {
      const b = btn(t, 'mini', () => { tab = k; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
      b.dataset.t = k; if (k === tab) b.classList.add('on'); tabs.appendChild(b);
    });
    body = el('div', 'rm-b');
    dlg.append(head, tabs, body);
    dlg.addEventListener('close', () => { if (H.reload) H.reload(); });
    document.body.appendChild(dlg);
  }
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  await draw();
}
const say = (t, k) => (H.say ? H.say(t, k) : null);
const oops = e => (H.oops ? H.oops(e) : say(String(e && e.message || e), 'err'));

async function draw() {
  body.textContent = '';
  body.appendChild(el('p', 'rm-mt', 'reading…'));
  try { if (tab === 'syn') await drawSynergy(); else await drawAddresses(); }
  catch (e) { body.textContent = ''; body.appendChild(el('p', 'rm-mt', 'Could not read them: ' + (e.message || e))); }
}

/* ------------------------------------------------------------------ the data --- */
async function subs() {
  let q = await sb.from('report_mail_subs').select('id,email,name,tz,active,player_zip,created_at,team_id,teams(id,name,leagues(name,timezone))').order('email');
  if (q.error && /player_zip/.test(q.error.message || '')) q = await sb.from('report_mail_subs').select('id,email,name,tz,active,created_at,team_id,teams(id,name,leagues(name,timezone))').order('email');
  if (q.error) throw q.error;
  return q.data || [];
}
const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch (_) { return ['UTC', 'Europe/London']; } };
function tzSelect(value) {
  const s = el('select', 'ep-input');
  const here = value || (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
  zones().forEach(z => { const o = el('option', null, z); o.value = z; if (z === here) o.selected = true; s.appendChild(o); });
  return s;
}
/* a club, found as its name is typed (a list under the box): resolves to { id, label, tz } on picking */
function clubFinder(onPick) {
  const wrap = el('div', 'rm-pick');
  const inp = el('input', 'ep-input'); inp.type = 'search'; inp.placeholder = 'club: type to find'; inp.style.minWidth = '220px';
  const list = el('ul', 'rm-found'); list.hidden = true;
  let tm = 0;
  inp.addEventListener('input', () => {
    clearTimeout(tm);
    const q = inp.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    tm = setTimeout(async () => {
      const { data } = await sb.from('teams').select('id,name,leagues(name,timezone)').ilike('name', '%' + q.replace(/[%_,()]/g, ' ') + '%').limit(20);
      list.textContent = '';
      (data || []).forEach(t => {
        const li = el('li'); li.append(el('span', null, t.name + ' '), el('small', null, (t.leagues && t.leagues.name) || ''));
        li.addEventListener('click', () => { list.hidden = true; inp.value = ''; onPick({ id: t.id, label: t.name + (t.leagues && t.leagues.name ? ' (' + t.leagues.name + ')' : ''), tz: t.leagues && t.leagues.timezone }); });
        list.appendChild(li);
      });
      list.hidden = !(data || []).length;
    }, 250);
  });
  wrap.append(inp, list);
  return wrap;
}

/* ------------------------------------------------------------------ addresses and clubs --- */
async function drawAddresses() {
  const rows = await subs();
  const ahead = await upcoming([...new Set(rows.map(r => r.team_id))]).catch(() => new Map());
  const [{ data: log }, { data: rq }] = await Promise.all([
    sb.from('report_mail_log').select('sub_id,kind,sent_at').order('sent_at', { ascending: false }).limit(800),
    sb.from('report_mail_requests').select('sub_id,state,requested_at,dispatched_at,finished_at,detail').order('requested_at', { ascending: false }).limit(300)
  ]);
  const asked = new Map(); (rq || []).forEach(q => { if (!asked.has(q.sub_id)) asked.set(q.sub_id, q); });
  body.textContent = '';

  /* AN ADDRESS, WITH ONE CLUB OR SEVERAL */
  const add = el('div', 'rm-box');
  add.appendChild(el('h4', null, 'Add an address'));
  const email = el('input', 'ep-input'); email.type = 'email'; email.placeholder = 'their@email'; email.style.minWidth = '220px';
  const name = el('input', 'ep-input'); name.placeholder = 'first name (optional)';
  const tz = tzSelect();
  const picked = new Map(), chips = el('div', 'rm-chips');
  const drawChips = () => { chips.textContent = ''; picked.forEach((c, id) => { const ch = el('span', 'rm-chip', c.label); const x = el('button', null, '×'); x.type = 'button'; x.title = 'take it off'; x.onclick = () => { picked.delete(id); drawChips(); }; ch.appendChild(x); chips.appendChild(ch); }); };
  const finder = clubFinder(c => { picked.set(c.id, c); if (c.tz && picked.size === 1 && [...tz.options].some(o => o.value === c.tz)) tz.value = c.tz; drawChips(); });
  const save = btn('add the address with these clubs', 'pri', async () => {
    const e = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { say('That email address does not look right.', 'warn'); return; }
    if (!picked.size) { say('Pick one club or more from the list as you type.', 'warn'); return; }
    const { error } = await sb.from('report_mail_subs').upsert([...picked.keys()].map(team_id => ({ email: e, team_id, name: name.value.trim() || null, tz: tz.value || 'UTC', active: true })), { onConflict: 'email,team_id' });
    if (error) { oops(error); return; }
    say(e + ' will be sent the reports of ' + picked.size + (picked.size === 1 ? ' club.' : ' clubs.'), 'ok');
    draw();
  });
  const r1 = el('div', 'rm-row'); r1.append(email, name, tz);
  add.append(r1, el('p', 'rm-mt', 'Its clubs (as many as it should be sent):'), finder, chips, save);
  body.appendChild(add);

  /* EACH ADDRESS WITH ALL ITS CLUBS */
  const by = new Map();
  rows.forEach(r => { if (!by.has(r.email)) by.set(r.email, []); by.get(r.email).push(r); });
  if (!by.size) { body.appendChild(el('p', 'rm-mt', 'Nobody is sent reports yet.')); return; }
  by.forEach((list, addr) => {
    const box = el('div', 'rm-addr');
    const h = el('div', 'rm-addr-h');
    const first = list[0];
    h.appendChild(el('b', null, addr + (first.name ? ' (' + first.name + ')' : '')));
    h.appendChild(el('span', 'rm-mt', first.tz + ' · ' + list.length + (list.length === 1 ? ' club' : ' clubs')));
    /* the players' reports in a ZIP, a reply to the Sunday email (0228); one switch for the address */
    if ('player_zip' in first) {
      const lab = el('label', 'rm-row'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = list.every(r => r.player_zip !== false);
      cb.addEventListener('change', async () => {
        const { error } = await sb.from('report_mail_subs').update({ player_zip: cb.checked }).in('id', list.map(r => r.id));
        if (error) { oops(error); cb.checked = !cb.checked; return; }
        say(cb.checked ? 'Its clubs’ players’ reports will follow each Sunday email, in a ZIP.' : 'No players’ reports for ' + addr + '.', 'ok');
      });
      lab.append(cb, el('span', null, 'players’ reports (ZIP)'));
      lab.title = 'After the Sunday email, a reply to it with the player report of every player of each club in it - not the released, nor those under 10 minutes a game';
      h.appendChild(lab);
    }
    const live = list.filter(r => r.active);
    if (live.length && H.sendNow) h.appendChild(btn('send next week’s reports now', 'mini', async () => {
      if (!confirm('Send ' + addr + ' next week’s reports now, for ' + live.length + (live.length === 1 ? ' club' : ' clubs') + '?')) return;
      for (const r of live) await H.sendNow(r.id);
      draw();
    }));
    box.appendChild(h);
    list.forEach(r => {
      const row = el('div', 'rm-club');
      const t = r.teams || {}, lg = (t.leagues && t.leagues.name) || '';
      const nm = el('div'); nm.append(el('b', null, t.name || 'club'), el('br'), el('small', null, lg + (r.active ? '' : ' · paused')));
      const last = (log || []).find(l => l.sub_id === r.id);
      const st = el('div'); st.appendChild(el('small', null, last ? 'last sent ' + new Date(last.sent_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : 'nothing sent yet'));
      const line = H.sendLine ? H.sendLine(asked.get(r.id)) : '';
      if (line) { st.appendChild(el('br')); st.appendChild(el('small', null, line)); }
      const acts = el('div', 'acts');
      acts.appendChild(btn(r.active ? 'pause' : 'resume', 'mini', async () => { const { error } = await sb.from('report_mail_subs').update({ active: !r.active }).eq('id', r.id); if (error) oops(error); else draw(); }));
      acts.appendChild(btn('remove', 'mini danger', async () => {
        if (!confirm(addr + ' will no longer be sent ' + (t.name || 'the club') + '’s reports.')) return;
        const { error } = await sb.from('report_mail_subs').delete().eq('id', r.id); if (error) oops(error); else draw();
      }));
      /* PRIME REPORT: each upcoming opponent's report (what its Sunday email carries), or the club's own */
      const primes = el('div', 'rm-primes');
      primes.appendChild(el('small', null, 'PRIME REPORT:'));
      const opps = [...new Map((ahead.get(r.team_id) || []).map(o => [o.id, o])).values()];
      opps.forEach(o => primes.appendChild(primeLink(o.name + ' \u00b7 ' + dayOf(o.at), o.id, o.name)));
      if (!opps.length) primes.appendChild(el('small', 'rm-mt', 'no games in the next two weeks'));
      primes.appendChild(primeLink('own report: ' + (t.name || 'the club'), r.team_id, t.name || 'the club'));
      row.append(nm, st, acts, primes);
      box.appendChild(row);
    });
    /* another club for this address */
    const more = el('div', 'rm-club');
    more.appendChild(el('small', null, 'Add a club to ' + addr + ':'));
    more.appendChild(clubFinder(async c => {
      const { error } = await sb.from('report_mail_subs').upsert({ email: addr, team_id: c.id, name: first.name || null, tz: first.tz || 'UTC', active: true }, { onConflict: 'email,team_id' });
      if (error) { oops(error); return; }
      say(addr + ' will be sent ' + c.label + '’s reports too.', 'ok'); draw();
    }));
    more.appendChild(el('span'));
    box.appendChild(more);
    body.appendChild(box);
  });
}

/* ------------------------------------------------------------------ the clubs the reports are on --- */
/* THE CLUBS THE REPORTS ARE ON, and their squads: what a Synergy file's players are matched against - never the whole site.
   Every club an active address is sent reports of (its own report, its game analyses), every club those play in the next
   two weeks (the Sunday email's scouting reports, and "send next week's reports now"'s), and any added here by hand (a
   club the schedule does not show yet). A player on two of them is one player. */
const nameOf = p => ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
const poss = n => String(n) + (/s$/i.test(String(n)) ? '\u2019' : '\u2019s');           // Omega Flyers\u2019, Alpha\u2019s
const dayOf = iso => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
/* THE UPCOMING GAMES of some clubs, the next two weeks' still to be played (what the next Sunday emails carry): club id ->
   its opponents in the order they come, [{ id, name, at }] */
async function upcoming(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const list = ids.join(',');
  const { data } = await sb.from('games').select('home_team_id,away_team_id,tipoff_at,home:home_team_id(name),away:away_team_id(name)')
    .or('home_team_id.in.(' + list + '),away_team_id.in.(' + list + ')').in('status', ['scheduled', 'live'])
    .gte('tipoff_at', new Date(Date.now() - 3 * 36e5).toISOString()).lt('tipoff_at', new Date(Date.now() + AHEAD_MS).toISOString()).order('tipoff_at');
  (data || []).forEach(g => [[g.home_team_id, g.away_team_id, g.away], [g.away_team_id, g.home_team_id, g.home]].forEach(([mine, opp, o]) => {
    if (!opp || !ids.includes(mine)) return;
    if (!out.has(mine)) out.set(mine, []);
    out.get(mine).push({ id: opp, name: (o && o.name) || 'opponent', at: g.tipoff_at });
  }));
  return out;
}
/* PRIME REPORT for one report: it opens primed (report.js ?prime=1: RAPM, Synergy, every page) and downloads */
function primeLink(text, id, who) {
  const a = el('a', 'ep-btn mini rm-prime', text);
  a.href = SITE + 't/?t=' + encodeURIComponent(id) + '&tab=report&prime=1'; a.target = '_blank'; a.rel = 'noopener';
  a.title = 'Open ' + poss(who) + ' report made ready - RAPM worked out and kept, Synergy read, every page built - and download it';
  return a;
}
async function reportedClubs() {
  const rows = (await subs().catch(() => [])).filter(r => r.active);
  const clubs = new Map();
  rows.forEach(r => {
    const c = clubs.get(r.team_id);
    if (c) { if (!c.emails.includes(r.email)) c.emails.push(r.email); return; }
    clubs.set(r.team_id, { id: r.team_id, name: (r.teams && r.teams.name) || 'club', own: true, emails: [r.email], plays: [] });
  });
  const ahead = await upcoming([...clubs.keys()]);
  ahead.forEach((opps, mine) => opps.forEach(o => {
    const me = clubs.get(mine);
    if (!clubs.has(o.id)) clubs.set(o.id, { id: o.id, name: o.name, own: false, emails: [], plays: [] });
    const them = clubs.get(o.id);
    if (!them.own) them.plays.push(me.name + ' ' + dayOf(o.at));
  }));
  EXTRA.forEach((c, id) => { if (!clubs.has(id)) clubs.set(id, c); });
  /* one player once, with every one of those clubs that lists him (teams): a club's own files find him in its squad */
  const people = [], seen = new Map();
  const ids = [...clubs.keys()];
  for (let i = 0; i < ids.length; i += 40) {
    const { data } = await sb.from('roster_entries').select('team_id,players(id,first_name,last_name)').in('team_id', ids.slice(i, i + 40)).eq('active', true);
    (data || []).forEach(x => {
      if (!x.players) return;
      const had = seen.get(x.players.id);
      if (had) { if (!had.teams.includes(x.team_id)) had.teams.push(x.team_id); return; }
      const p = { id: x.players.id, name: nameOf(x.players), club: (clubs.get(x.team_id) || {}).name || '', team: x.team_id, teams: [x.team_id] };
      seen.set(p.id, p); people.push(p);
    });
  }
  return { clubs, people };
}
const whyOf = c => c.own ? 'reports go to ' + c.emails.join(', ') : c.plays.length ? 'plays ' + c.plays.join(', ') : 'added here';
/* a file's player, suggested from those squads - from one club's alone when the files were added to that club: the same name,
   or the same surname and first initial when that is one player */
function suggest(x, people) {
  const pool = x.club ? people.filter(p => (p.teams || [p.team]).includes(x.club)) : people;
  const hit = SYN().matchPlayer(x.p.name, pool);
  x.pick = hit ? hit.person : null;
  x.hint = hit ? (hit.how === 'name' ? 'same name, ' + hit.person.club : 'same surname and initial, ' + hit.person.club + ': check it')
               : x.club ? 'not in ' + poss(x.clubName || 'that club') + ' squad: pick him' : 'not in these clubs\u2019 squads: pick him, or add his club above';
}
/* FILES READ: as many as are chosen, each with one player or several; for one club (club: { id, name }) or for all of them */
async function readFiles(files, people, club) {
  const S = SYN();
  let n = 0;
  for (const f of files) {
    let got = [];
    try { got = S.read(await f.text()); } catch (_) { got = []; }
    if (!got.length) { say(f.name + ': no Synergy rows in it.', 'warn'); continue; }
    got.forEach(p => { const x = { p, file: f.name, pick: null, hint: '', hand: false, club: club ? club.id : null, clubName: club ? club.name : '' }; suggest(x, people); PENDING.push(x); n++; });
  }
  if (n) say(n + (n === 1 ? ' player' : ' players') + ' read from ' + files.length + (files.length === 1 ? ' file' : ' files') + (club ? ' for ' + club.name : '') + ': check the matches, then keep them.', 'ok');
  return n;
}
/* a button that takes any number of CSV files at once */
function filesButton(text, onFiles) {
  const lab = el('label', 'ep-btn mini');
  lab.appendChild(document.createTextNode(text));
  const inp = el('input'); inp.type = 'file'; inp.accept = '.csv,text/csv'; inp.multiple = true; inp.hidden = true;
  inp.addEventListener('change', async () => { const files = [...(inp.files || [])]; inp.value = ''; if (files.length) await onFiles(files); });
  lab.appendChild(inp);
  return lab;
}

/* ------------------------------------------------------------------ Synergy files --- */
async function drawSynergy() {
  const S = SYN();
  body.textContent = '';
  if (!S) { body.appendChild(el('p', 'rm-mt', 'The Synergy reader (synergy.js) is not on this page.')); return; }
  const { clubs, people } = await reportedClubs();
  /* the suggestions follow the squads (a club added, or one that left): a pick made by hand stays */
  PENDING.forEach(x => { if (!x.hand) suggest(x, people); });

  /* THE CLUBS THE REPORTS ARE ON */
  const on = el('div', 'rm-box');
  on.appendChild(el('h4', null, 'The clubs the reports are on'));
  on.appendChild(el('p', 'rm-mt', 'A Synergy file\u2019s players are matched to these clubs\u2019 squads only: each club an address is sent reports of, and every club it plays in the next two weeks. A club\u2019s own files (add CSVs, as many as you like) are matched to its squad alone.'));
  if (!clubs.size) on.appendChild(el('p', 'rm-mt', 'None yet: add an address and its clubs first, or add a club here.'));
  const list = [...clubs.values()].sort((a, b) => (b.own - a.own) || a.name.localeCompare(b.name));
  list.forEach(c => {
    const row = el('div', 'rm-club');
    const n = people.filter(p => (p.teams || [p.team]).includes(c.id)).length;
    const nm = el('div'); nm.append(el('b', null, c.name), el('br'), el('small', null, whyOf(c)));
    const st = el('div'); st.appendChild(el('small', null, n ? n + (n === 1 ? ' player' : ' players') + ' in the squad' : 'no squad listed for this club'));
    const acts = el('div', 'acts');
    acts.appendChild(primeLink('PRIME REPORT', c.id, c.name));
    /* this club's files, as many as there are: matched to its squad alone */
    const add = filesButton('add CSVs', async files => { await readFiles(files, people, c); drawSynergy(); });
    add.title = 'Any number of Synergy CSV files for ' + poss(c.name) + ' players, matched to its squad alone';
    acts.appendChild(add);
    if (EXTRA.has(c.id)) acts.appendChild(btn('take off', 'mini', () => { EXTRA.delete(c.id); drawSynergy(); }));
    row.append(nm, st, acts);
    on.appendChild(row);
  });
  const more = el('div', 'rm-club');
  more.appendChild(el('small', null, 'A club the schedule does not show yet:'));
  more.appendChild(clubFinder(c => { EXTRA.set(c.id, { id: c.id, name: c.label, own: false, emails: [], plays: [] }); drawSynergy(); }));
  more.appendChild(el('span'));
  on.appendChild(more);
  body.appendChild(on);

  /* DROP THE FILES IN */
  const box = el('div', 'rm-box');
  box.appendChild(el('h4', null, 'Add Synergy files'));
  box.appendChild(el('p', 'rm-mt', 'The scraper\u2019s play-type CSVs, as many as you like at once (and more after them), one player a file or several. Each player is matched by name to a player of the clubs above (or of the one club whose add CSVs you used), and you can change any match by hand, from those squads, before keeping them. Only the numbers the reports print are kept.'));
  box.appendChild(filesButton('add CSVs for any of these clubs', async files => { await readFiles(files, people, null); drawSynergy(); }));
  /* THE MATCHES, TO CHECK AND CHANGE BY HAND */
  if (PENDING.length) {
    const wrap = el('div');
    PENDING.forEach(x => wrap.appendChild(matchRow(x, people, list)));
    const keep = btn('keep the matched ones', 'pri', async () => {
      let n = 0;
      for (const x of PENDING.slice()) {
        if (!x.pick) continue;
        const { error } = await sb.from('synergy_profiles').upsert({ player_id: x.pick.id, profile: S.pack(S.profile(x.p)), source_name: x.p.name || null, source_id: x.p.id || null,
          seasons: (x.p.seasonsText || '').slice(0, 600) || null, file_name: String(x.file).slice(0, 200), uploaded_at: new Date().toISOString() }, { onConflict: 'player_id' });
        if (error) { oops(error); return; }
        PENDING.splice(PENDING.indexOf(x), 1); n++;
      }
      say(n + (n === 1 ? ' Synergy file kept' : ' Synergy files kept') + ': every report from now on has them.', 'ok');
      drawSynergy();
    });
    const clear = btn('clear the list', 'mini', () => { PENDING.length = 0; drawSynergy(); });
    const acts = el('div', 'rm-row'); acts.append(keep, clear);
    box.append(wrap, acts);
  }
  body.appendChild(box);

  /* THE KEPT ONES */
  const kept = el('div', 'rm-box');
  kept.appendChild(el('h4', null, 'Kept'));
  const q = await sb.from('synergy_profiles').select('player_id,source_name,seasons,file_name,uploaded_at,players(first_name,last_name)').order('uploaded_at', { ascending: false });
  if (q.error) { kept.appendChild(el('p', 'rm-mt', /synergy_profiles|schema cache|does not exist/i.test(q.error.message || '') ? 'Synergy files arrive with migration 0228: it has not been applied to this database yet.' : 'Could not read them: ' + q.error.message)); body.appendChild(kept); return; }
  if (!(q.data || []).length) kept.appendChild(el('p', 'rm-mt', 'None yet.'));
  (q.data || []).forEach(r => {
    const row = el('div', 'rm-club');
    const pn = r.players ? nameOf(r.players) : 'player';
    const at = people.find(p => p.id === r.player_id);
    const nm = el('div'); nm.append(el('b', null, pn), el('br'), el('small', null, (at ? at.club + ' · ' : '') + 'file: ' + (r.source_name || '?') + (r.file_name ? ' (' + r.file_name + ')' : '')));
    const span = S.span(S.seasonsOf(r.seasons || ''));
    const st = el('div'); st.appendChild(el('small', null, (span ? span + ' · ' : '') + 'kept ' + new Date(r.uploaded_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })));
    const acts = el('div', 'acts');
    const prime = el('a', 'ep-btn mini rm-prime', 'PRIME REPORT');
    prime.href = SITE + 'p/?p=' + encodeURIComponent(r.player_id) + '&tab=report&prime=1'; prime.target = '_blank'; prime.rel = 'noopener';
    prime.title = 'Open ' + pn + '’s report made ready and download it';
    acts.append(prime, btn('remove', 'mini danger', async () => {
      if (!confirm('Take ' + pn + '’s Synergy numbers out of every report?')) return;
      const { error } = await sb.from('synergy_profiles').delete().eq('player_id', r.player_id); if (error) oops(error); else drawSynergy();
    }));
    row.append(nm, st, acts);
    kept.appendChild(row);
  });
  body.appendChild(kept);
}
/* ONE FILE'S PLAYER, MATCHED: the suggestion, and the two ways to pick by hand, both from the clubs the reports are on - his
   name typed (any of their squads), or a club's squad */
function matchRow(x, people, clubs) {
  const S = SYN();
  const row = el('div', 'rm-syn');
  const who = el('div', 'who');
  who.append(el('b', null, x.p.name || '?'), el('small', null, [S.span(x.p.seasons), x.file].filter(Boolean).join(' · ')));
  const pick = el('div', 'rm-pick');
  const sel = el('div', 'rm-sel' + (x.pick ? '' : ' none'), x.pick ? '→ ' + x.pick.name + (x.pick.club ? ' · ' + x.pick.club : '') : '→ not matched yet');
  const hint = el('small', 'rm-mt', x.hint || '');
  const choose = person => { x.pick = person; x.hand = true; x.hint = 'chosen by hand'; sel.textContent = '→ ' + person.name + (person.club ? ' · ' + person.club : ''); sel.classList.remove('none'); hint.textContent = x.hint; };
  /* his name typed: the players of those squads it fits */
  const find = el('input', 'ep-input'); find.type = 'search'; find.placeholder = 'match by hand: type a name';
  const found = el('ul', 'rm-found'); found.hidden = true;
  find.addEventListener('input', () => {
    const q = S.normName(find.value);
    found.textContent = '';
    if (q.length < 2) { found.hidden = true; return; }
    people.filter(z => S.normName(z.name).includes(q)).slice(0, 30).forEach(z => {
      const li = el('li'); li.append(el('span', null, z.name + ' '), el('small', null, z.club || ''));
      li.addEventListener('click', () => { found.hidden = true; find.value = ''; choose(z); });
      found.appendChild(li);
    });
    if (!found.children.length) found.appendChild(el('li', 'rm-mt', 'Nobody of that name in these clubs’ squads: add his club above.'));
    found.hidden = false;
  });
  /* or a club's squad */
  const squad = el('select', 'ep-input');
  const o0 = el('option', null, '…or pick from a club’s squad'); o0.value = ''; squad.appendChild(o0);
  clubs.forEach(c => {
    const g = el('optgroup'); g.label = c.name;
    people.filter(z => (z.teams || [z.team]).includes(c.id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(z => { const o = el('option', null, z.name); o.value = z.id; g.appendChild(o); });
    if (g.children.length) squad.appendChild(g);
  });
  squad.addEventListener('change', () => { const z = people.find(p => String(p.id) === squad.value); if (z) choose(z); });
  const out = btn('leave out', 'mini', () => { PENDING.splice(PENDING.indexOf(x), 1); row.remove(); });
  pick.append(sel, hint, find, found, squad, out);
  row.append(who, pick);
  return row;
}

/* _t: for supabase/tests/reports-manager.test.mjs (a client of its own, the clubs and the suggestions) */
window.EpinoiaReportsManager = { open, _t: { use: c => { sb = c; }, reportedClubs, upcoming, suggest, readFiles, EXTRA, PENDING } };
}());
