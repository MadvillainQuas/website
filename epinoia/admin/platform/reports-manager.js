'use strict';
/* ============================================================================
   THE REPORTS MANAGER (2026-10-04; the platform console, Reports > Team reports by email > Open the reports manager).
   Everything about the reports by email in one pop-up, a tab each (Louie, 2026-10-16: "two tabs in report manager (teams and
   players)"):

     TEAMS        each address with ALL its clubs - an address can have several (report_mail_subs is a row an address
                 and a club) - its name and time zone, whether its clubs' players' reports follow the Sunday email in a ZIP
                 (0228 player_zip), and for each club: PRIME REPORT (a report made ready - RAPM, Synergy, every page - and
                 downloaded, report.js prime) of each club it plays in the next two weeks (the reports its Sunday email
                 carries) or of its own, send next week's reports now, pause, remove. An address is added with one club or
                 several at once, and a club is added to an address already there.
     PLAYERS      the players' weekly reports (0272, until 2026-10-16 in the console's Reports tab): an address and a player,
                 each with what the mailer last did, send now - of the games ticked (0273), the week of their latest game
                 ticked to start with - pause, remove.
     SYNERGY FILES  the scraper's CSV files dropped in (synergy.js reads them; only the numbers are kept, 0228
                 synergy_profiles), each player in them matched to a player OF THE CLUBS THE REPORTS ARE ON - every club an
                 address is sent reports of, and every club those play in the next two weeks (the Sunday email's scouting
                 reports), each with its PRIME REPORT; a club the schedule does not show yet can be added by hand. Never the
                 whole site: a name is suggested from those squads, and changed by hand from them (typed, or picked from a
                 club's squad), then kept, for every report the site draws and the mailer sends. The kept ones listed, each
                 to open its report primed, or to remove.

   platform.js opens it: EpinoiaReportsManager.open(sb, { say, oops, sendNow, sendLine, reload, pickWeek, askPick, ... }, tab?).
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
/* the page is zoomed (the kit's body zoom: 1.25 from 1000px, 1.5 from 1200px) and the zoom multiplies vw / vh too: --rmz (set on
   opening) takes it back out, so the pop-up fits the screen and its close button is always on it */
.rm{ width:min(980px, calc(96vw / var(--rmz, 1))); max-height:calc(92vh / var(--rmz, 1)); padding:0; overflow:hidden; border:1px solid var(--rule-2,#ccc); border-radius:14px; background:var(--panel,#fff); color:var(--ink,#111) }
/* the title bar and the tabs never scroll away: only the body does */
.rm[open]{ display:flex; flex-direction:column }
.rm::backdrop{ background:rgba(6,14,10,.55) }
.rm-h{ flex:none; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 18px 10px; background:var(--panel,#fff); border-bottom:1px solid var(--rule,#ddd) }
.rm-h h3{ margin:0; font-size:18px }
.rm-tabs{ flex:none; display:flex; gap:6px; padding:10px 18px 0 }
/* the open tab, marked: specific enough to beat the light theme's :root[data-theme="light"] .ep-btn (which hid it) */
.rm .rm-tabs button.ep-btn.on{ background:var(--ink,#111); color:var(--panel,#fff); border-color:var(--ink,#111) }
.rm-b{ flex:1 1 auto; min-height:0; padding:12px 18px 18px; overflow:auto }
.rm-x{ font-size:15px !important; font-weight:800 }
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
.rm-primed-at{ display:inline-flex; align-items:center; gap:6px }
.rm-stored{ color:#1d7a46 !important; font-weight:700 }
.rm-prime-all{ background:#7a1f2b !important; color:#fff !important; border-color:#7a1f2b !important; font-weight:800; letter-spacing:.04em }
.rm-del{ color:#b32433 !important }
.rm-run{ flex:none; display:none; gap:12px; padding:10px 18px; border-bottom:1px solid var(--rule,#ddd); background:#fffbea }
.rm-run.on{ display:flex }
.rm-run ol{ margin:6px 0 0; padding-left:18px; max-height:150px; overflow:auto; font-size:12px }
.rm-run li.ok{ color:#1d7a46 } .rm-run li.gap{ color:#8a5a00 } .rm-run li.go{ font-weight:700 }
.rm-prime{ background:#0d1f17 !important; color:#ffd166 !important; border-color:#0d1f17 !important; font-weight:800; letter-spacing:.06em }
.rm-syn{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:10px; align-items:start; padding:9px 0; border-top:1px solid var(--rule,#ddd) }
.rm-syn:first-child{ border-top:0 }
.rm-syn .who b{ display:block; font-size:14px }
.rm-pick{ display:flex; flex-direction:column; gap:6px }
.rm-found{ list-style:none; margin:0; padding:0; max-height:160px; overflow:auto; border:1px solid var(--rule,#ddd); border-radius:8px }
.rm-found li{ padding:5px 8px; cursor:pointer; font-size:13px } .rm-found li:hover{ background:var(--panel-2,#eef4f0) }
.rm-found li small{ color:var(--ink-3,#666) }
.rm-sel{ font-weight:700 } .rm-sel.none{ color:#b32433 }
.rm-kinds{ display:flex; flex-wrap:wrap; gap:4px 12px; flex-basis:100%; font-size:12px } .rm-kinds label{ display:inline-flex; gap:5px; align-items:center; cursor:pointer }
.rm-week{ grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:4px 12px; font-size:12px; padding:6px 8px; border-radius:8px; background:var(--panel-2,#eef4f0) }
.rm-week label{ display:inline-flex; gap:5px; align-items:center; cursor:pointer } .rm-week label i{ font-style:normal; color:var(--ink-3,#666) }
@media (max-width:640px){ .rm-club, .rm-syn{ grid-template-columns:1fr } .rm-club .acts{ justify-content:flex-start } }`;
  document.head.appendChild(s);
}

function fitZoom() {
  if (!dlg) return;
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  dlg.style.setProperty('--rmz', String(z > 0 ? z : 1));
}
async function open(client, hooks, which) {
  sb = client; H = hooks || {};
  if (which === 'addr' || which === 'pl' || which === 'syn') tab = which;
  style();
  if (!dlg) {
    dlg = el('dialog', 'rm');
    const head = el('div', 'rm-h');
    const x = btn('\u2715 close', 'mini rm-x', () => closeAsked());
    x.setAttribute('aria-label', 'Close the reports manager'); x.title = 'Close (Esc)';
    head.append(el('h3', null, 'Reports manager'), x);
    const tabs = el('div', 'rm-tabs');
    [['addr', 'Teams'], ['pl', 'Players'], ['syn', 'Synergy files']].forEach(([k, t]) => {
      const b = btn(t, 'mini', () => { tab = k; draw(); });
      b.dataset.t = k; tabs.appendChild(b);
    });
    body = el('div', 'rm-b');
    RUN.box = el('div', 'rm-run');
    dlg.append(head, tabs, RUN.box, body);
    /* a priming run draws its reports in a frame inside this pop-up: closing it would stop them, so it asks */
    dlg.addEventListener('cancel', e => { if (RUN.busy && !confirm('Reports are being primed. Close and stop them?')) e.preventDefault(); else RUN.stop = true; });
    dlg.addEventListener('close', () => { if (H.reload) H.reload(); });
    /* a click outside it (on the dimmed page) closes it too, as Esc does */
    dlg.addEventListener('click', e => { if (e.target === dlg) closeAsked(); });
    document.body.appendChild(dlg);
    window.addEventListener('resize', fitZoom);
  }
  fitZoom();
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  await draw();
}
const markTab = () => { if (dlg) dlg.querySelectorAll('.rm-tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === tab)); };
function closeAsked() {
  if (RUN.busy && !confirm('Reports are being primed. Close and stop them?')) return;
  RUN.stop = true;
  dlg.close();
}
const say = (t, k) => (H.say ? H.say(t, k) : null);
const oops = e => (H.oops ? H.oops(e) : say(String(e && e.message || e), 'err'));

async function draw() {
  markTab();
  clearTimeout(pTimer);
  body.textContent = '';
  body.appendChild(el('p', 'rm-mt', 'reading…'));
  try { if (tab === 'syn') await drawSynergy(); else if (tab === 'pl') await drawPlayers(); else await drawAddresses(); }
  catch (e) { body.textContent = ''; body.appendChild(el('p', 'rm-mt', 'Could not read them: ' + (e.message || e))); }
}

/* ------------------------------------------------------------------ the data --- */
/* every column: the kinds the address takes are there once their migrations are (0228 player_zip, 0263 send_games / send_opponents / send_own) */
async function subs() {
  const q = await sb.from('report_mail_subs').select('*,teams(id,name,leagues(name,timezone))').order('email');
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
  const stored = await primedNow().catch(() => new Map());
  const [{ data: log }, { data: rq }] = await Promise.all([
    sb.from('report_mail_log').select('sub_id,kind,sent_at').order('sent_at', { ascending: false }).limit(800),
    sb.from('report_mail_requests').select('sub_id,state,requested_at,dispatched_at,finished_at,detail').order('requested_at', { ascending: false }).limit(300)
  ]);
  const asked = new Map(); (rq || []).forEach(q => { if (!asked.has(q.sub_id)) asked.set(q.sub_id, q); });
  /* THE WEEK'S TICKS (0263 report_mail_picks; none before it) and the Sundays the own report and the emails went for */
  const [pk, { data: refs }] = await Promise.all([
    sb.from('report_mail_picks').select('sub_id,sunday,skip_opps,own,players').gte('sunday', new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10)),
    sb.from('report_mail_log').select('sub_id,kind,ref').in('kind', ['team', 'sunday']).gte('sent_at', new Date(Date.now() - 60 * 864e5).toISOString())
  ]);
  const picks = pk.error ? null : pk.data || [];
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
    const live = list.filter(r => r.active);
    /* send now: the week's opponents, own reports and ZIP of each of its clubs, ticked (0263; platform.js pickWeek) */
    if (live.length && H.sendNow) h.appendChild(btn('send next week’s reports now', 'mini', async () => {
      let picks = null;
      if (H.pickWeek) { picks = await H.pickWeek(live, 'Send ' + addr + ' next week’s reports now').catch(e => { oops(e); return null; }); if (!picks) return; }
      else if (!confirm('Send ' + addr + ' next week’s reports now, for ' + live.length + (live.length === 1 ? ' club' : ' clubs') + '?')) return;
      for (const r of live) await H.sendNow(r.id, picks ? picks.get(r.id) : undefined);
      draw();
    }));
    /* WHAT THE ADDRESS TAKES, ticked once for all its clubs: the game analyses, the opponents' scouting reports, the own report every
       other Sunday (0263), the players' reports in a ZIP, a reply to the Sunday email (0228). A kind before its migration is not shown. */
    const kinds = el('div', 'rm-kinds');
    [['send_games', 'game analyses', 'After each game, its analysis'],
     ['send_opponents', 'opponents’ scouting reports', 'In the Sunday email, a scouting report on each club its club plays that week'],
     ['send_own', 'own report, fortnightly', 'In the Sunday email every other week, the club’s own team report'],
     ['player_zip', 'players’ reports (ZIP)', 'After the Sunday email, a reply to it with the player report of every player of each club in it - not the released, nor those under 10 minutes a game']]
      .filter(([k]) => k in first).forEach(([k, label, tip]) => {
        const lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = list.every(r => r[k] !== false);
        cb.addEventListener('change', async () => {
          const { error } = await sb.from('report_mail_subs').update({ [k]: cb.checked }).in('id', list.map(r => r.id));
          if (error) { oops(error); cb.checked = !cb.checked; return; }
          list.forEach(r => { r[k] = cb.checked; });
          say((cb.checked ? addr + ' will be sent ' : 'No more ') + label + (cb.checked ? '.' : ' for ' + addr + '.'), 'ok');
          draw();
        });
        lab.append(cb, el('span', null, label)); lab.title = tip;
        kinds.appendChild(lab);
      });
    if (kinds.childNodes.length) h.appendChild(kinds);
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
      opps.forEach(o => { primes.appendChild(primeLink(o.name + ' \u00b7 ' + dayOf(o.at), o.id, o.name, stored.get('team:' + o.id))); primes.appendChild(primeAllBtn(o.id, o.name, stored)); });
      if (!opps.length) primes.appendChild(el('small', 'rm-mt', 'no games in the next two weeks'));
      primes.appendChild(primeLink('own report: ' + (t.name || 'the club'), r.team_id, t.name || 'the club', stored.get('team:' + r.team_id)));
      primes.appendChild(primeAllBtn(r.team_id, t.name || 'the club', stored));
      row.append(nm, st, acts, primes);
      if (r.active) row.appendChild(weekTicks(r, ahead.get(r.team_id) || [], picks, refs || []));
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

/* NEXT SUNDAY'S EMAIL, TICKED (0263, Louie 2026-10-14): the opponents of its week, the own report, the players' ZIP, kept for that Sunday
   (report_mail_picks) and read by the mailer when it sends it. A tick is kept only where it differs from what the address takes. */
function weekTicks(r, opps, picks, refs) {
  const wrap = el('div', 'rm-week');
  if (!H.weekOf) return wrap;
  const W = H.weekOf(r.tz), t = r.teams || {};
  const words = H.weekWords ? H.weekWords(r.tz) : W.sunday;
  if (refs.some(x => x.sub_id === r.id && x.kind === 'sunday' && x.ref === W.sunday)) { wrap.appendChild(el('small', null, 'This Sunday’s email (week of ' + words + ') has gone.')); return wrap; }
  wrap.appendChild(el('b', null, 'SUNDAY EMAIL, week of ' + words + ':'));
  if (!picks) { wrap.appendChild(el('small', null, 'ticking a week arrives with migration 0263')); return wrap; }
  const row = picks.find(p => p.sub_id === r.id && p.sunday === W.sunday) || { skip_opps: [], own: null, players: null };
  const skip = new Set(row.skip_opps || []);
  const due = H.ownDueFor(refs.filter(x => x.sub_id === r.id && x.kind === 'team').map(x => x.ref), W.sunday);
  const ownDef = due && r.send_own !== false, zipDef = r.player_zip !== false;
  const save = async () => {
    const rec = { sub_id: r.id, sunday: W.sunday, skip_opps: [...skip], own: own.checked === ownDef ? null : own.checked, players: zip.checked === zipDef ? null : zip.checked };
    const { error } = await sb.from('report_mail_picks').upsert(rec, { onConflict: 'sub_id,sunday' });
    if (error) { oops(error); return; }
    Object.assign(row, rec);
    say('Kept: ' + (t.name || 'the club') + '’s email of Sunday ' + W.sunday + '.', 'ok');
  };
  const tick = (label, hint, on, fn) => { const lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = on; cb.addEventListener('change', () => { fn(cb.checked); save(); });
    lab.append(cb, el('span', null, label)); if (hint) lab.append(el('i', null, hint)); wrap.appendChild(lab); return cb; };
  const seen = new Set();
  opps.filter(o => Date.parse(o.at) >= W.from.getTime() && Date.parse(o.at) < W.to.getTime() && !seen.has(o.id) && seen.add(o.id)).forEach(o =>
    tick(o.name, dayOf(o.at), r.send_opponents !== false && !skip.has(o.id), on => { if (on) skip.delete(o.id); else skip.add(o.id); }));
  if (!seen.size) wrap.appendChild(el('small', null, 'no games that week'));
  const own = tick('own report', due ? 'fortnight up' : 'not its fortnight', row.own != null ? row.own : ownDef, () => {});
  const zip = tick('players’ ZIP', '', row.players != null ? row.players : zipDef, () => {});
  return wrap;
}

/* ------------------------------------------------------------------ players --- */
/* PLAYERS' WEEKLY REPORTS (0272; until 2026-10-16 in the console's Reports tab): an address and a player - found by name in the
   site's search, as anyone on the site can be sent their own report (unlike a Synergy file's players, matched only to the clubs
   the reports are on) - and the time zone of its Monday morning. Each with what the mailer last did, send now, pause, remove.
   SEND NOW ASKS WHICH GAMES (0273 send_now_games; Louie, 2026-10-16: "give the option to select which games to include if 'send
   now' is selected for player reports"): their last 20 games, newest first, those of the week of their latest game ticked (what
   send now sent before); the report is drawn of the games ticked alone (p/?rpgames=). Before 0273, the week, once asked. */
const PMAX = 12;                                             // the mailer's MAX_PICKED, and 0273's check
let pTimer = 0;
const ymdIn = (iso, tz) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); } catch (_) { return String(iso || '').slice(0, 10); } };
const mondayOfYmd = ymd => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
const dayIn = (iso, tz) => { try { return new Date(iso).toLocaleDateString('en-GB', { timeZone: tz || 'UTC', weekday: 'short', day: 'numeric', month: 'short' }); } catch (_) { return dayOf(iso); } };
const playedIn = st => !!st && (+st.min > 0 || (st.adv && +st.adv.min > 0));
/* their games as the send-now ticks list them: finals they played in, a game once, newest first, the latest's week ticked */
function playerGameList(rows, tz, max = 20) {
  const seen = new Set();
  const list = (rows || []).filter(r => r.games && r.games.status === 'final' && playedIn(r.stats))
    .sort((a, b) => String(b.games.tipoff_at).localeCompare(String(a.games.tipoff_at)))
    .filter(r => !seen.has(r.game_id) && seen.add(r.game_id)).slice(0, max)
    .map(r => {
      const g = r.games, side = +r.team_idx === 1 ? 1 : 0, st = r.stats || {};
      const us = side ? g.away_score : g.home_score, them = side ? g.home_score : g.away_score;
      const opp = ((side ? g.home : g.away) || {}).name || 'opponent', ymd = ymdIn(g.tipoff_at, tz);
      return { id: r.game_id, ymd, monday: mondayOfYmd(ymd), label: (side ? 'at ' : 'v ') + opp + ' (' + (us > them ? 'W' : us < them ? 'L' : 'D') + ' ' + us + '–' + them + ')',
        hint: dayIn(g.tipoff_at, tz) + ' · ' + (+st.pts || 0) + ' pts' };
    });
  const latest = list.length ? list[0].monday : null;
  list.forEach(g => { g.on = g.monday === latest; });
  return list;
}
/* THE CLUB'S GAMES TO COME, for the match-ups (0274; Louie, 2026-10-16: "selectable in the send now if clicked"): the next three
   weeks', at most eight, those of the week now beginning ticked when the address has its match-ups on */
const MUMAX = 8;                                             // 0274's check
async function playerUpcoming(x) {
  const { data: re } = await sb.from('roster_entries').select('teams(id)').eq('player_id', x.player_id).order('created_at', { ascending: false }).limit(1);
  const tid = re && re[0] && re[0].teams && re[0].teams.id;
  if (!tid) return [];
  const now = new Date(), to = new Date(now.getTime() + 21 * 864e5);
  const { data, error } = await sb.from('games').select('id,tipoff_at,status,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)')
    .or('home_team_id.eq.' + tid + ',away_team_id.eq.' + tid).in('status', ['scheduled', 'live'])
    .gte('tipoff_at', now.toISOString()).lt('tipoff_at', to.toISOString()).order('tipoff_at').limit(MUMAX);
  if (error) throw error;
  const thisWeek = mondayOfYmd(ymdIn(now.toISOString(), x.tz));
  return (data || []).map(g => {
    const home = g.home_team_id === tid, opp = ((home ? g.away : g.home) || {}).name || 'opponent';
    return { id: g.id, label: (home ? 'v ' : 'at ') + opp, hint: dayIn(g.tipoff_at, x.tz), on: !!x.send_matchups && mondayOfYmd(ymdIn(g.tipoff_at, x.tz)) === thisWeek };
  });
}
/* what a player's send now carries: { games: the report's games ([] for the match-ups alone), mu: the games whose opponents' match-ups
   go }, 'week' (no ticks to be had: the week of their latest game), or null (not sent) */
async function pickPlayerGames(x, pname) {
  if (!H.askPick) return confirm('Send ' + x.email + ' ' + pname + '’s report for the week of their latest game now?') ? 'week' : null;
  let ids = [x.player_id];
  /* every profile of theirs (0178), as the mailer reads them; a query builder is only "then"-able, so try, not .catch */
  try { const L = await sb.rpc('linked_players', { p_player: x.player_id }); if (L && L.data && L.data.players) ids = [...new Set(ids.concat(L.data.players.map(p => p.id).filter(Boolean)))]; } catch (_) {}
  const { data, error } = await sb.from('player_game_stats')
    .select('game_id,team_idx,stats,games!inner(id,tipoff_at,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name))')
    .in('player_uuid', ids).eq('games.status', 'final').gte('games.tipoff_at', new Date(Date.now() - 200 * 864e5).toISOString());
  if (error) throw error;
  const list = playerGameList(data, x.tz);
  const up = await playerUpcoming(x).catch(() => []);
  if (!list.length && !up.length) { say(pname + ' has played no game in the last 200 days and their club has none to come: there is nothing to send.', 'warn'); return null; }
  const groups = [];
  if (list.length) groups.push({ head: pname + ': games', note: 'Their last ' + list.length + (list.length === 1 ? ' game' : ' games') + ', newest first. The week of their latest game is ticked; at most ' + PMAX + '. Untick them all to send the match-ups alone',
    items: list.map(g => ({ key: g.id, label: g.label, hint: g.hint, on: g.on })) });
  if (up.length) groups.push({ head: 'Potential match-ups: games to come', note: 'For each game ticked, the opponent’s players ' + pname + ' could be matched up onto (their position or one up), in a second PDF: each one’s title page, shot chart, left v right and connections. At most ' + MUMAX,
    items: up.map(g => ({ key: 'mu:' + g.id, label: g.label, hint: g.hint, on: g.on })) });
  const t = await H.askPick({ title: 'Send ' + pname + '’s report now', go: 'send now',
    lead: 'Tick the games the report is of: its games section draws each one, its shot chart and full stats line, and the email lists them. The rest of the report is their season as always.' + (up.length ? ' Tick games to come for the match-ups that go with it.' : '') + ' It goes to ' + x.email + ' at the mailer’s next run.',
    groups });
  if (!t) return null;
  const games = list.filter(g => t.get(g.id)).map(g => g.id);
  const mu = up.filter(g => t.get('mu:' + g.id)).map(g => g.id);
  if (!games.length && !mu.length) { say('Tick a game or more: nothing was sent.', 'warn'); return null; }
  if (games.length > PMAX) { say('At most ' + PMAX + ' games in one report: nothing was sent, untick some.', 'warn'); return null; }
  return { games, mu };
}
async function sendPlayerNow(x, pname, b) {
  const games = await pickPlayerGames(x, pname).catch(e => { oops(e); return null; });
  if (!games) return;
  b.disabled = true;
  const at = new Date().toISOString();
  const pick = games === 'week' ? null : games;
  const upd = { send_now_at: at };
  if (pick && pick.games.length) upd.send_now_games = pick.games;
  if (pick && pick.mu.length) { upd.send_now_matchups = pick.mu; upd.send_now_report = pick.games.length ? null : false; }
  let { error } = await sb.from('report_mail_players').update(upd).eq('id', x.id);
  /* before 0274 there are no match-up columns, before 0273 no send_now_games: say so, and send what can go only if asked to */
  if (error && pick && pick.mu.length && /send_now_matchups|send_now_report|schema cache|column/i.test(error.message || '')) {
    if (!pick.games.length || !confirm('The match-ups need migration 0274, which is not applied yet. Send the report alone?')) { if (!pick.games.length) say('The match-ups need migration 0274, which is not applied yet: nothing was sent.', 'warn'); b.disabled = false; return; }
    delete upd.send_now_matchups; delete upd.send_now_report;
    ({ error } = await sb.from('report_mail_players').update(upd).eq('id', x.id));
  }
  if (error && pick && pick.games.length && /send_now_games|schema cache|column/i.test(error.message || '')) {
    if (!confirm('Choosing the games needs migration 0273, which is not applied yet. Send the week of their latest game instead?')) { b.disabled = false; return; }
    ({ error } = await sb.from('report_mail_players').update({ send_now_at: at }).eq('id', x.id));
  }
  if (error) { oops(error); b.disabled = false; return; }
  const what = !pick ? 'report for the week of their latest game' : (pick.games.length ? 'report of ' + (pick.games.length === 1 ? 'one game' : pick.games.length + ' games') : 'match-ups') +
    (pick.games.length && pick.mu.length ? ' and their match-ups (' + (pick.mu.length === 1 ? 'one game' : pick.mu.length + ' games') + ' to come)' : !pick.games.length ? ' for ' + (pick.mu.length === 1 ? 'one game' : pick.mu.length + ' games') + ' to come' : '');
  say(pname + '’s ' + what + ' go' + (pick && !pick.games.length ? '' : 'es') + ' to ' + x.email + ' at the mailer’s next run.', 'ok');
  draw();
}
/* a player, found as the name is typed (the site's search): resolves to { id, slug, label } on picking */
function playerFinder(onPick) {
  const wrap = el('div', 'rm-pick');
  const inp = el('input', 'ep-input'); inp.type = 'search'; inp.placeholder = 'player: type to find'; inp.style.minWidth = '240px';
  const list = el('ul', 'rm-found'); list.hidden = true;
  let tm = 0;
  inp.addEventListener('input', () => {
    clearTimeout(tm);
    const q = inp.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    tm = setTimeout(async () => {
      const { data } = await sb.rpc('site_search', { p_q: q, p_limit: 12 });
      list.textContent = '';
      (data || []).filter(x => x.kind === 'player').forEach(x => {
        const where = x.sub || x.league_slug || '';
        const li = el('li'); const nm = el('span', null, x.name + ' '); nm.setAttribute('translate', 'no');
        li.append(nm, el('small', null, where));
        li.addEventListener('click', () => { list.hidden = true; inp.value = ''; onPick({ id: x.id, slug: x.slug, label: x.name + (where ? ' (' + where + ')' : '') }); });
        list.appendChild(li);
      });
      list.hidden = !list.childNodes.length;
    }, 250);
  });
  wrap.append(inp, list);
  return wrap;
}
async function drawPlayers() {
  const q = await sb.from('report_mail_players').select('*,players(id,first_name,last_name,slug)').order('created_at', { ascending: false });
  body.textContent = '';

  /* AN ADDRESS AND A PLAYER */
  const add = el('div', 'rm-box');
  add.appendChild(el('h4', null, 'Add a player'));
  add.appendChild(el('p', 'rm-mt', 'Every Monday morning, at the address’s time, their player report for the week just played (Monday to Sunday): the season’s pages, and the shot chart and full stats line of each game that week. A week they did not play is skipped.'));
  let who = null;
  const chosen = el('span', 'rm-sel none', 'no player picked');
  const email = el('input', 'ep-input'); email.type = 'email'; email.placeholder = 'their@email'; email.style.minWidth = '220px';
  const name = el('input', 'ep-input'); name.placeholder = 'first name (optional)';
  const tz = tzSelect();
  /* THEIR POTENTIAL MATCH-UPS too (0274): the players of each club they play that week they could be matched up onto */
  const muLab = el('label', 'rm-mt'); const muCb = el('input'); muCb.type = 'checkbox';
  muLab.append(muCb, document.createTextNode(' and their potential match-ups each week'));
  muLab.title = 'With the Monday email, a second PDF: every player of each club they play that week whom they could be matched up onto (their position or one up), each with a title page, the shot chart, left v right and connections';
  const finder = playerFinder(pk => {
    who = pk; chosen.textContent = pk.label; chosen.classList.remove('none'); chosen.setAttribute('translate', 'no');
    /* their league's clock is the reader's, most likely (it can still be changed) */
    sb.from('roster_entries').select('teams(leagues(timezone))').eq('player_id', pk.id).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => { const z = data && data[0] && data[0].teams && data[0].teams.leagues && data[0].teams.leagues.timezone;
        if (z && [...tz.options].some(o => o.value === z)) tz.value = z; });
  });
  const save = btn('add', 'pri', async () => {
    const e = email.value.trim().toLowerCase();
    if (!who) { say('Pick the player from the list as you type their name.', 'warn'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { say('That email address does not look right.', 'warn'); return; }
    const row = Object.assign({ email: e, player_id: who.id, name: name.value.trim() || null, tz: tz.value || 'UTC', active: true }, muCb.checked ? { send_matchups: true } : {});
    const { error } = await sb.from('report_mail_players').upsert(row, { onConflict: 'email,player_id' });
    if (error) { oops(/send_matchups|schema cache|column/i.test(error.message || '') ? new Error('The match-ups need migration 0274, which is not applied yet: untick them to add the player.') : error); return; }
    say(e + ' will be sent ' + who.label + '’s weekly report' + (muCb.checked ? ' and their potential match-ups' : '') + ', every Monday morning.', 'ok');
    draw();
  });
  const r1 = el('div', 'rm-row'); r1.append(finder, chosen);
  const r2 = el('div', 'rm-row'); r2.style.marginTop = '6px'; r2.append(email, name, tz, muLab, save);
  add.append(r1, r2);
  body.appendChild(add);

  /* EACH ADDRESS AND ITS PLAYER */
  if (q.error) { body.appendChild(el('p', 'rm-mt', /report_mail_players|schema cache|does not exist/i.test(q.error.message || '') ? 'Players’ weekly reports arrive with migration 0272: it has not been applied to this database yet.' : 'Could not read them: ' + q.error.message)); return; }
  const rows = q.data || [];
  if (!rows.length) { body.appendChild(el('p', 'rm-mt', 'No player is sent a weekly report yet.')); return; }
  const box = el('div', 'rm-addr');
  const h = el('div', 'rm-addr-h');
  h.append(el('b', null, 'Weekly player reports'), el('span', 'rm-mt', rows.length + (rows.length === 1 ? ' address' : ' addresses') + ' · Monday mornings at their time'));
  box.appendChild(h);
  rows.forEach(x => {
    const P = x.players || {}, pname = nameOf(P) || 'player';
    const row = el('div', 'rm-club');
    const nm = el('div'); const b = el('b', null, pname); b.setAttribute('translate', 'no');
    nm.append(b, el('br'), el('small', null, x.email + (x.name ? ' (' + x.name + ')' : '')));
    const st = el('div');
    st.appendChild(el('small', null, x.tz + (x.send_matchups ? ' · with match-ups' : '') + (x.active ? '' : ' · paused')));
    st.appendChild(el('br'));
    st.appendChild(el('small', null, x.last_at ? 'last ' + new Date(x.last_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ': ' + (x.last_detail || '') : 'nothing sent yet'));
    if (x.send_now_at) {
      const mu = Array.isArray(x.send_now_matchups) && x.send_now_matchups.length ? ' + match-ups (' + (x.send_now_matchups.length === 1 ? 'one game' : x.send_now_matchups.length + ' games') + ')' : '';
      st.appendChild(el('br'));
      st.appendChild(el('small', 'rm-stored', 'send now queued' + (x.send_now_report === false ? ': match-ups alone' + mu.replace(' + match-ups', '') :
        (Array.isArray(x.send_now_games) && x.send_now_games.length ? ': ' + (x.send_now_games.length === 1 ? 'one game' : x.send_now_games.length + ' games') : ': the week of their latest game') + mu)));
    }
    const acts = el('div', 'acts');
    if (x.active) {
      const now = btn(x.send_now_at ? 'queued' : 'send now', 'mini', () => sendPlayerNow(x, pname, now));
      now.disabled = !!x.send_now_at;
      now.title = 'Email them their report now, of the games you tick';
      acts.appendChild(now);
    }
    const muB = btn(x.send_matchups ? 'match-ups on' : 'match-ups off', 'mini' + (x.send_matchups ? ' pri' : ''), async () => {
      const { error } = await sb.from('report_mail_players').update({ send_matchups: !x.send_matchups }).eq('id', x.id);
      if (error) oops(/send_matchups|schema cache|column/i.test(error.message || '') ? new Error('The match-ups need migration 0274, which is not applied yet.') : error); else draw();
    });
    muB.title = 'With the Monday email, their potential match-ups: every player of each club they play that week whom they could be matched up onto (their position or one up), each with a title page, the shot chart, left v right and connections';
    acts.appendChild(muB);
    acts.appendChild(btn(x.active ? 'pause' : 'resume', 'mini', async () => { const { error } = await sb.from('report_mail_players').update({ active: !x.active }).eq('id', x.id); if (error) oops(error); else draw(); }));
    acts.appendChild(btn('remove', 'mini danger', async () => {
      if (!confirm(x.email + ' will no longer be sent ' + pname + '’s weekly report.')) return;
      const { error } = await sb.from('report_mail_players').delete().eq('id', x.id); if (error) oops(error); else draw();
    }));
    row.append(nm, st, acts);
    box.appendChild(row);
  });
  body.appendChild(box);
  /* read again while a send now waits, as long as this tab is open */
  if (rows.some(x => x.active && x.send_now_at)) pTimer = setTimeout(() => { if (dlg && dlg.open && tab === 'pl' && !document.hidden) draw(); }, 30000);
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
/* THE REPORTS PRIMED AND STORED FOR SENDING (0229 primed_reports): 'kind:id' -> when; none before 0229 */
async function primedNow() {
  const { data, error } = await sb.from('primed_reports').select('kind,ref_id,primed_at');
  return new Map((error ? [] : data || []).map(r => [r.kind + ':' + r.ref_id, r.primed_at]));
}
const hm = iso => { const d = new Date(iso); return dayOf(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
/* PRIME REPORT for one report: it opens primed (report.js ?prime=1: RAPM, Synergy, every page) and stores it for sending; one
   already stored says when (at), and goes with the next email that carries it */
function primeLink(text, id, who, at, kind) {
  const k = kind || 't';
  const a = el('a', 'ep-btn mini rm-prime', text);
  a.href = SITE + k + '/?' + k + '=' + encodeURIComponent(id) + '&tab=report&prime=1'; a.target = '_blank'; a.rel = 'noopener';
  a.title = 'Open ' + poss(who) + ' report made ready - RAPM worked out and kept, Synergy read, every page built - and store it for sending';
  if (!at) return a;
  const w = el('span', 'rm-primed-at');
  const del = btn('delete stored', 'mini rm-del', async () => {
    if (!confirm('Delete the stored copy of ' + poss(who) + ' report? The next email draws it afresh unless it is primed again.')) return;
    const n = await deleteStored([[k === 'p' ? 'player' : 'team', id]]);
    say(n ? 'Deleted the stored copy of ' + poss(who) + ' report.' : 'Nothing was deleted.', n ? 'ok' : 'warn');
    draw();
  });
  w.append(a, el('small', 'rm-stored', '\u2713 stored ' + hm(at)), del);
  w.title = 'Primed and stored for sending ' + hm(at) + ': the next email carrying this report sends it, then it is deleted';
  return w;
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
  const stored = await primedNow().catch(() => new Map());
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
    acts.appendChild(primeLink('PRIME REPORT', c.id, c.name, stored.get('team:' + c.id)));
    acts.appendChild(primeAllBtn(c.id, c.name, stored));
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
    acts.append(primeLink('PRIME REPORT', r.player_id, pn, stored.get('player:' + r.player_id), 'p'), btn('remove', 'mini danger', async () => {
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

/* ------------------------------------------------------------------ PRIME CLUB + PLAYERS (2026-10-04) --- */
/* A club's report AND the player report of everyone its players' ZIP carries, primed one after another and each stored for sending,
   so the Sunday email and its ZIP reply send the primed files. Each report is opened with ?prime=1 in a frame inside this pop-up
   (RAPM read from report_rapm or worked out and kept, the kept Synergy CSVs read, every page built, the PDF stored), and the run waits
   for the report's own "Primed" line before the next. The players are the mailer's (scripts/report_mailer.mjs zipPlayers): everyone
   who has played for the club in its league's newest season, at 10 minutes a game or more, not released by it, most minutes first. */
const RUN = { busy: false, stop: false, box: null };
const MIN_MPG = 10, MIN_GAMES = 3;                         // the mailer's: 10+ minutes a game, MORE than two games
function zipPlayers(rows, teamId, released, minGames = MIN_GAMES) {
  const acc = new Map();
  rows.forEach(r => {
    const m = +r.min || 0;
    if (r.team !== teamId || !r.pid || m <= 0) return;
    const a = acc.get(r.pid) || { id: r.pid, games: 0, min: 0 };
    a.games++; a.min += m / 60000; acc.set(r.pid, a);
  });
  return [...acc.values()].map(a => ({ ...a, mpg: a.min / a.games }))
    .filter(a => a.mpg >= MIN_MPG && a.games >= minGames && !(released && released.has(a.id))).sort((a, b) => b.mpg - a.mpg);
}
async function allOf(q) {                                     // q: (from, to) -> a supabase query; every page of it
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await q(off, off + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
async function zipSquad(teamId) {
  const { data: t } = await sb.from('teams').select('league_id').eq('id', teamId).limit(1);
  if (!t || !t[0] || !t[0].league_id) return [];
  const { data: s } = await sb.from('seasons').select('id').eq('league_id', t[0].league_id).order('starts_on', { ascending: false }).limit(1);
  const { data: comps } = s && s[0] ? await sb.from('competitions').select('id').eq('season_id', s[0].id) : { data: [] };
  if (!comps || !comps.length) return [];
  const games = await allOf((a, b) => sb.from('games').select('id,home_team_id,away_team_id').or('home_team_id.eq.' + teamId + ',away_team_id.eq.' + teamId)
    .eq('status', 'final').in('competition_id', comps.map(c => c.id)).order('id').range(a, b));
  const rows = [];
  for (let i = 0; i < games.length; i += 40) {
    const part = games.slice(i, i + 40), by = new Map(part.map(g => [g.id, g]));
    const got = await allOf((a, b) => sb.from('player_game_stats').select('game_id,player_uuid,team_idx,min:stats->min').in('game_id', part.map(g => g.id))
      .not('player_uuid', 'is', null).order('game_id').order('player_id').range(a, b));
    got.forEach(r => { const g = by.get(r.game_id); if (g) rows.push({ pid: r.player_uuid, team: r.team_idx === 0 ? g.home_team_id : g.away_team_id, min: r.min }); });
  }
  let gone = new Set();
  try { const { data } = await sb.from('player_releases').select('player_id').eq('team_id', teamId); gone = new Set((data || []).map(r => r.player_id)); } catch (_) { /* none kept */ }
  const picked = zipPlayers(rows, teamId, gone);
  if (!picked.length) return [];
  const { data: named } = await sb.from('players').select('id,first_name,last_name').in('id', picked.map(p => p.id));
  const nm = new Map((named || []).map(p => [p.id, nameOf(p)]));
  return picked.map(p => ({ ...p, name: nm.get(p.id) || 'Player' }));
}
/* ONE REPORT, PRIMED IN THE RUN'S OWN WINDOW (opened by "start priming", one for the whole run, then closed). Not a frame inside
   this pop-up: the console page is zoomed (the kit's body zoom, 1.5 on a wide screen) and Chrome carries that zoom into a frame,
   so a report there was laid out about 870px wide and drawn at another width - rows ran into each other in the stored PDF
   (2026-10-04, the Leicester report). A window of its own is a page like any tab, the way PRIME REPORT from a tab draws it.
   Resolves with what the report's "Primed" line says. */
function primeInWindow(url, w) {
  return new Promise(resolve => {
    if (!w || w.closed) { resolve({ ok: false, text: 'the priming window was closed' }); return; }
    try { w.location.href = url; } catch (e) { resolve({ ok: false, text: 'the priming window could not be used' }); return; }
    const t0 = Date.now();
    const tick = () => {
      if (RUN.stop) { resolve({ ok: false, text: 'stopped' }); return; }
      if (w.closed) { RUN.stop = true; resolve({ ok: false, text: 'the priming window was closed' }); return; }
      let box = null;
      try { box = w.location.href.indexOf(url.replace(/^\.\.\/\.\.\//, '')) !== -1 && w.document.querySelector('.rp-primed'); } catch (_) { /* not loaded yet */ }
      if (box && !box.hidden && box.textContent.trim()) { resolve({ ok: box.classList.contains('ok'), text: box.textContent.trim() }); return; }
      if (Date.now() - t0 > 10 * 60000) { resolve({ ok: false, text: 'did not finish within 10 minutes' }); return; }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 2000);
  });
}
function primeAllBtn(teamId, name, stored) {
  const b = btn('PRIME CLUB + PLAYERS', 'mini rm-prime-all', () => primeAll(teamId, name));
  b.title = 'Prime ' + poss(name) + ' club report and every player report its players’ ZIP carries (10+ minutes a game over more than two games, not released), each with its Synergy CSVs and RAPM, and store them all for sending';
  if (!(stored && stored.has('team:' + teamId))) return b;
  const w = el('span', 'rm-primed-at');
  const del = btn('delete stored (club + players)', 'mini rm-del', async () => {
    if (!confirm('Delete the stored copies of ' + poss(name) + ' club report and its players’ reports?')) return;
    const squad = await zipSquad(teamId).catch(() => []);
    const k = await deleteStored([['team', teamId]].concat(squad.map(p => ['player', p.id])));
    say('Deleted ' + k + ' stored report' + (k === 1 ? '' : 's') + ' of ' + name + '.', 'ok');
    draw();
  });
  w.append(b, del);
  return w;
}
/* FIRST, THE CHECKLIST: whose reports will be primed (the club and every ZIP player), each player's Synergy file kept or not, and
   "add CSVs" for this club's players before anything is drawn (matched on the Synergy tab, then kept); "start priming" when ready. */
async function primeAll(teamId, name) {
  if (RUN.busy) { say('A priming run is going already: wait for it, or close the reports manager to stop it.', 'warn'); return; }
  const box = RUN.box;
  box.textContent = ''; box.classList.add('on');
  const side = el('div'); side.style.cssText = 'flex:1 1 auto;min-width:0';
  const head = el('b', null, 'Prime ' + name + ': reading whose reports its players’ ZIP carries…');
  const bar = el('div', 'rm-row'); bar.style.margin = '6px 0';
  const list = el('ol');
  side.append(head, bar, list);
  box.append(side);
  let squad = [];
  try { squad = await zipSquad(teamId); } catch (e) { head.textContent = 'Could not read ' + poss(name) + ' players: ' + (e.message || e); bar.appendChild(closeRunBtn()); return; }
  const drawList = async () => {
    const { data } = squad.length ? await sb.from('synergy_profiles').select('player_id,uploaded_at').in('player_id', squad.map(p => p.id)) : { data: [] };
    const kept = new Map((data || []).map(r => [r.player_id, r.uploaded_at]));
    list.textContent = '';
    list.appendChild(el('li', null, name + ' — club report'));
    squad.forEach(p => {
      const at = kept.get(p.id);
      const li = el('li', at ? 'ok' : 'gap', p.name + ' (' + p.mpg.toFixed(1) + ' min a game): ' + (at ? '✓ Synergy file kept ' + hm(at) : 'no Synergy file kept'));
      list.appendChild(li);
    });
    const n = squad.filter(p => kept.has(p.id)).length;
    head.textContent = 'Prime ' + name + ': the club report and ' + squad.length + ' player report' + (squad.length === 1 ? '' : 's') +
      ' · Synergy kept for ' + n + ' of ' + squad.length + '. Add any CSVs first, then start.';
  };
  await drawList();
  const add = filesButton('add CSVs for these players', async files => {
    const { people, clubs } = await reportedClubs();
    if (!clubs.has(teamId)) EXTRA.set(teamId, { id: teamId, name, why: 'primed from here' });
    const mine = people.filter(p => (p.teams || [p.team]).includes(teamId));
    const n = await readFiles(files, mine.length ? mine : people, { id: teamId, name });
    if (n) {
      head.textContent = n + ' player' + (n === 1 ? '' : 's') + ' read: check the matches on the Synergy files tab below and press keep, then "check again" here.';
      tab = 'syn';
      if (dlg) dlg.querySelectorAll('.rm-tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === 'syn'));
      draw();
    }
  });
  add.title = 'Synergy CSV files for ' + poss(name) + ' players: matched to its squad on the Synergy files tab, where you keep them';
  bar.append(btn('start priming', 'mini rm-prime-all', () => runPrime(teamId, name, squad)), add,
    btn('check again', 'mini', () => drawList()), closeRunBtn('cancel'));
}
function closeRunBtn(text) {
  return btn(text || '✕ close', 'mini', () => { if (RUN.busy) RUN.stop = true; else { RUN.box.textContent = ''; RUN.box.classList.remove('on'); } });
}
async function runPrime(teamId, name, squad) {
  if (RUN.busy) return;
  /* the run's window, opened at once from the click (a window opened later, after an await, is a blocked pop-up) */
  const win = window.open('about:blank', 'epinoia-prime', 'width=1320,height=1000');
  if (!win) { say('The priming window was blocked: allow pop-ups for this site, then press start priming again.', 'warn'); return; }
  try { win.document.title = 'Priming ' + name + '\u2026'; win.document.body.textContent = 'Priming ' + name + ': the reports open here one after another. Leave this window open.'; } catch (_) { /* fine */ }
  window.focus();
  RUN.busy = true; RUN.stop = false;
  const box = RUN.box;
  box.textContent = '';
  const list = el('ol'), side = el('div');
  side.style.cssText = 'flex:1 1 auto;min-width:0';
  const head = el('b', null, 'Priming ' + name + '…');
  const bar = el('div', 'rm-row'); bar.style.margin = '6px 0';
  const stop = btn('stop', 'mini', () => { RUN.stop = true; });
  bar.appendChild(stop);
  side.append(head, bar, list);
  box.append(side);
  try {
    const jobs = [{ k: 't', id: teamId, name: name + ' — club report' }].concat(squad.map(p => ({ k: 'p', id: p.id, name: p.name + ' (' + p.mpg.toFixed(1) + ' min a game)' })));
    head.textContent = 'Priming ' + name + ': the club report and ' + squad.length + ' player report' + (squad.length === 1 ? '' : 's') + ', one at a time, in the window that opened (leave it open)';
    const lines = jobs.map(j => { const li = el('li', null, j.name); list.appendChild(li); return li; });
    let good = 0;
    for (let i = 0; i < jobs.length && !RUN.stop; i++) {
      const j = jobs[i], li = lines[i];
      li.className = 'go'; li.textContent = j.name + ': priming…';
      li.scrollIntoView({ block: 'nearest' });
      const r = await primeInWindow(SITE + j.k + '/?' + j.k + '=' + encodeURIComponent(j.id) + '&tab=report&prime=1', win);
      li.className = r.ok ? 'ok' : 'gap';
      li.textContent = j.name + ': ' + (r.ok ? '' : '⚠ ') + r.text.replace(/^[✓⚠]\s*/, '');
      if (r.ok) good++;
    }
    head.textContent = (RUN.stop ? 'Stopped: ' : 'Done: ') + good + ' of ' + jobs.length + ' reports of ' + name + ' primed and stored for sending' + (good < jobs.length ? ' (amber lines say what is missing)' : '');
    say(head.textContent, good === jobs.length ? 'ok' : 'warn');
  } catch (e) {
    head.textContent = 'Priming stopped: ' + (e.message || e);
    oops(e);
  } finally {
    try { if (!win.closed) win.close(); } catch (_) { /* fine */ }
    stop.remove();
    bar.appendChild(closeRunBtn());
    RUN.busy = false;
    if (dlg && dlg.open) draw();
  }
}
/* stored copies deleted (the file, then its row); [[kind, id]] -> how many went */
async function deleteStored(pairs) {
  const { data } = await sb.from('primed_reports').select('kind,ref_id,path').in('ref_id', pairs.map(p => p[1]));
  const want = new Set(pairs.map(p => p[0] + ':' + p[1]));
  const rows = (data || []).filter(r => want.has(r.kind + ':' + r.ref_id));
  let n = 0;
  for (const r of rows) {
    const rm = await sb.storage.from('primed').remove([r.path]);
    if (rm && rm.error) { oops(rm.error); continue; }
    const { error } = await sb.from('primed_reports').delete().eq('kind', r.kind).eq('ref_id', r.ref_id);
    if (error) { oops(error); continue; }
    n++;
  }
  return n;
}

/* _t: for supabase/tests/reports-manager.test.mjs (a client of its own, the clubs and the suggestions) */
window.EpinoiaReportsManager = { open, _t: { use: c => { sb = c; }, hooks: h => { H = h; }, reportedClubs, upcoming, suggest, readFiles, EXTRA, PENDING, zipPlayers, zipSquad, deleteStored, playerGameList, pickPlayerGames } };
}());
