'use strict';
/* The portal must never be framed — a clickjacked "remove player" is a real risk and
   GitHub Pages cannot send X-Frame-Options. Bust out before anything else runs. */
if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (_) {} document.documentElement.innerHTML = ''; throw new Error('framed'); }
const $ = s => document.querySelector(s);
const show = (id, on) => $(id).classList.toggle('hide', !on);
const TEAMCOLORS = ['#93f2bf','#8ff5ff','#ffb3ef','#ffd166','#b7a8ff','#ff8f97',
                    '#ffffff','#ff9f43','#c8ff5a','#5ab8ff','#ff5fb0','#d7c4a1'];
let colour = TEAMCOLORS[0], sb = null, me = null, team = null;

function say(text, kind) {
  const m = $('#msg'); m.textContent = text;
  m.className = 'msg ' + (kind || ''); show('#msg', !!text);
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)
                 + '-' + Math.random().toString(36).slice(2,6);

/* Supabase errors are the honest place to detect "schema missing" */
const schemaMissing = e => e && (e.code === 'PGRST205' || /schema cache|does not exist/i.test(e.message || ''));

async function boot() {
  sb = window.epinoiaClient && epinoiaClient();
  if (!sb) { say('No Supabase key in config.js — the portal needs one.', 'err'); return; }

  const { data: { session } } = await sb.auth.getSession();
  me = session && session.user;
  sb.auth.onAuthStateChange((_e, s) => { me = s && s.user; render(); });
  render();
}

async function render() {
  show('#signin', !me); show('#out', !!me);
  $('#who').textContent = me ? me.email : '';
  show('#teams', false); show('#roster', false); show('#setup', false); show('#club', false);
  if (!me) return;
  if (team) return renderRoster();
  await renderTeams();
}

/* A CLUB'S CREST WHERE ITS COLOUR SWATCH WAS.

   The list of clubs somebody manages showed a 26px square of the club colour.
   That was fine when nothing better existed; now that a club can upload a
   crest, the square is exactly where the crest belongs — it is the one place
   in the portal a club looks at itself.

   Approved crests only, and the colour swatch stays as the fallback: a club
   that has not uploaded one, or whose upload is still in the queue, still gets
   a square rather than a gap. */
async function crestsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    const { data } = await sb.from('media')
      .select('owner_id,storage_path')
      .eq('owner_type', 'team').eq('kind', 'logo').eq('status', 'approved')
      .in('owner_id', ids);
    (data || []).forEach(m => {
      if (!out.has(m.owner_id)) {
        out.set(m.owner_id, window.EpinoiaUpload
          ? window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, m.storage_path)
          : null);
      }
    });
  } catch (_) { /* swatches all round */ }
  return out;
}

async function renderTeams() {
  const { data, error } = await sb.from('teams').select('id,name,short_name,colour,slug').order('name');
  if (error) {
    if (schemaMissing(error)) { show('#setup', true); say(''); return; }
    say(error.message, 'err'); return;
  }
  show('#teams', true); say('');
  const list = $('#teamlist'); list.textContent = '';
  if (!data.length) {
    const d = document.createElement('div');
    d.className = 'msg'; d.textContent = 'No teams yet — create one below.';
    list.appendChild(d);
  }
  const crests = await crestsFor(data.map(t => t.id));

  data.forEach(t => {
    const row = document.createElement('div');
    row.className = 'teamcard'; row.tabIndex = 0; row.setAttribute('role','button');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = t.colour || '#93f2bf';
    const crest = crests.get(t.id);
    if (crest) {
      const img = document.createElement('img');
      img.className = 'dot-crest';
      img.src = crest; img.alt = ''; img.loading = 'lazy';
      /* a crest that will not load leaves the colour square behind rather than
         a broken frame where the club's identity should be */
      img.addEventListener('error', () => img.remove());
      dot.appendChild(img);
      dot.style.background = 'transparent';
    }
    const box = document.createElement('div');
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = t.name;   // textContent: never innerHTML
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = (t.short_name || '') + ' · manage roster';
    box.append(nm, sub); row.append(dot, box);
    const open = () => { team = t; render(); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    list.appendChild(row);
  });
}

async function renderRoster() {
  show('#roster', true);
  $('#rtitle').textContent = team.name;
  document.documentElement.style.setProperty('--team-a', team.colour || '#93f2bf');
  const { data, error } = await sb.from('roster_entries')
    .select('id,jersey,active,players(id,first_name,last_name,is_minor)')
    .eq('team_id', team.id).order('jersey');
  const tbl = $('#rlist'); tbl.textContent = '';
  if (error) { say(error.message, 'err'); return; }
  say('');

  /* The importer needs to know who is already here, so a re-imported sheet
     updates people rather than creating a second copy of each of them. */
  /* Everything a club maintains about itself, below the roster. Mounted from
     here rather than at boot because it needs the team, and re-mounted after
     every roster change so a newly added player has a profile card without a
     reload. */
  show('#club', true);
  window.EpinoiaClubUI.mount({
    host: '#club', sb, team, say, onDone: renderRoster
  });

  window.EpinoiaRosterCSV.mount({
    host: '#csvpanel', sb, team, me, say,
    existing: data.map(r => ({
      name: (((r.players || {}).first_name || '') + ' ' + ((r.players || {}).last_name || '')).trim(),
      jersey: r.jersey,
      playerId: (r.players || {}).id
    })),
    onDone: renderRoster
  });
  if (!data.length) {
    const tr = tbl.insertRow(); const td = tr.insertCell();
    td.colSpan = 4; td.textContent = 'No players yet.'; td.style.color = 'var(--ink-3)';
  }
  data.forEach(r => {
    const p = r.players || {};
    const tr = tbl.insertRow();
    tr.insertCell().textContent = r.jersey || '–';
    const nameCell = tr.insertCell();
    nameCell.textContent = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (p.is_minor) { const b = document.createElement('span'); b.className = 'minor'; b.textContent = 'U18'; nameCell.appendChild(b); }
    tr.insertCell().textContent = r.active ? '' : 'inactive';
    const act = tr.insertCell();

    /* Photograph. Resized in the browser before it leaves the device — a 4 MB
       phone picture becomes about 60 KB — then held privately until the league
       approves it. Nothing here makes an image public; that is the league's
       decision and it happens in the admin console.

       A minor's photograph is refused by the database without recorded
       guardian consent, so the button is offered and the refusal is honest
       rather than the control being hidden and unexplained. */
    const pic = document.createElement('input');
    pic.type = 'file'; pic.accept = 'image/*'; pic.style.display = 'none';
    const upl = document.createElement('button');
    upl.className = 'mini'; upl.textContent = 'photo';
    upl.title = 'upload a photograph for approval';
    upl.addEventListener('click', () => pic.click());
    pic.addEventListener('change', async () => {
      const file = pic.files && pic.files[0];
      pic.value = '';
      if (!file) return;
      upl.disabled = true; upl.textContent = 'resizing…';
      try {
        const res = await window.EpinoiaUpload.upload(sb, {
          ownerType: 'player', ownerId: p.id, kind: 'photo', file
        });
        const saved = Math.max(0, Math.round(res.saved / 1024));
        say('sent for approval — ' + Math.round(res.bytes / 1024) + ' KB' +
            (saved ? ' (' + saved + ' KB saved before upload)' : ''), 'ok');
        upl.textContent = 'pending';
      } catch (e) {
        say(e.message || 'that upload was refused', 'err');
        upl.textContent = 'photo';
      } finally { upl.disabled = false; }
    });
    act.append(upl, pic);

    const del = document.createElement('button');
    del.className = 'mini'; del.textContent = 'remove';
    del.addEventListener('click', async () => {
      if (!confirm('Remove ' + nameCell.textContent + ' from this roster?')) return;
      const { error } = await sb.from('roster_entries').delete().eq('id', r.id);
      if (error) say(error.message, 'err'); else renderRoster();
    });
    act.appendChild(del);
  });
}

/* ---------------- actions ---------------- */
$('#send').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) return say('Enter your email first.', 'warn');
  $('#send').disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: location.href }
  });
  $('#send').disabled = false;
  say(error ? error.message : 'Link sent — check your inbox, then come back here.', error ? 'err' : 'ok');
});

$('#out').addEventListener('click', async () => { await sb.auth.signOut(); team = null; render(); });
$('#back').addEventListener('click', () => { team = null; render(); });

$('#mkteam').addEventListener('click', async () => {
  const name = $('#tname').value.trim();
  if (!name) return say('The team needs a name.', 'warn');
  const short = ($('#tshort').value.trim() || name.slice(0, 3)).toUpperCase();
  const { data, error } = await sb.from('teams')
    .insert({ name, short_name: short, colour, slug: slug(name), created_by: me.id })
    .select().single();
  if (error) return say(error.message, 'err');
  // creating a team makes you its manager — otherwise RLS would lock you out of it
  const { error: mErr } = await sb.from('memberships')
    .insert({ user_id: me.id, role: 'team_manager', scope_type: 'team', scope_id: data.id });
  if (mErr) say('Team made, but the manager grant failed: ' + mErr.message, 'warn');
  $('#tname').value = ''; $('#tshort').value = '';
  team = data; render();
});

$('#addp').addEventListener('click', async () => {
  const first = $('#pfirst').value.trim(), last = $('#plast').value.trim();
  if (!first) return say('A first name at least.', 'warn');
  const yr = parseInt($('#pyear').value, 10);
  const isMinor = $('#pminor').checked;
  const { data: p, error } = await sb.from('players').insert({
    slug: slug(first + '-' + last), first_name: first, last_name: last,
    birth_year: Number.isFinite(yr) ? yr : null, is_minor: isMinor, created_by: me.id
  }).select().single();
  if (error) return say(error.message, 'err');
  const { error: rErr } = await sb.from('roster_entries')
    .insert({ team_id: team.id, player_id: p.id, jersey: $('#pnum').value.trim() });
  if (rErr) return say(rErr.message, 'err');
  ['#pnum','#pfirst','#plast','#pyear'].forEach(s => $(s).value = '');
  $('#pminor').checked = false;
  renderRoster();
});

/* colour swatches */
const swWrap = $('#sw');
TEAMCOLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.className = 'swatch'; b.style.background = c; b.style.color = c;
  b.setAttribute('aria-pressed', String(i === 0));
  b.setAttribute('aria-label', 'kit colour ' + (i + 1));
  b.addEventListener('click', () => {
    colour = c;
    swWrap.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
  });
  swWrap.appendChild(b);
});

boot();
