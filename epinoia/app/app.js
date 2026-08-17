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
      .in('owner_id', ids)
      .order('created_at', { ascending: false });   // newest crest wins
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

/* ---------------------------------------------------------------------------
   THE CLUB CREST, BESIDE THE CLUB'S NAME.

   It lived in the venue band, four sections down, where it read as one more
   field about the building. A crest is not a detail about a club — it is how
   the club appears everywhere else on the platform — so it belongs against the
   name at the top of the only screen that shows it.

   THE SLOT IS ALWAYS THERE. Empty it says ADD and is a dashed square somebody
   can find; filled it shows the crest. A control that only appears once you
   already have a crest is a control nobody discovers.

   AND IT SAYS WHAT WILL HAPPEN, which is the other half of the request. Three
   different things are worth knowing and none of them are guessable: what the
   crest is used for, what file to give it, and that the league has to approve
   it before the public sees it. "Uploaded" and "live on the website" are
   different states and the slot shows the difference — a pending crest is
   drawn at half strength rather than as though it were already live. */
async function mountCrest() {
  const slot = $('#crestSlot'), help = $('#crestHelp'), file = $('#crestFile');
  if (!slot || !team) return;

  const paint = (url, status) => {
    slot.textContent = '';
    slot.classList.toggle('has', !!url);
    slot.classList.toggle('pending', status === 'pending');
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      img.addEventListener('error', () => { img.remove(); slot.textContent = 'add'; });
      slot.appendChild(img);
    } else {
      slot.textContent = 'add';
    }
    /* textContent throughout — a club's name is typed by a person and this
       sentence carries it */
    help.textContent = '';
    const line = (t, bold) => {
      const n = document.createElement(bold ? 'b' : 'span');
      n.textContent = t; help.appendChild(n);
    };
    if (!url) {
      line('Your club crest. ');
      line('Add one and it replaces the initials on your club card, in the league table and on every fixture — ');
      line('it goes live straight away', true);
      line(', no approval needed. ');
      line('An SVG with a transparent background is best', true);
      line(' — it stays sharp at every size, from this list to a printed shirt. A transparent PNG works too.');
    } else if (status === 'approved') {
      line('Your crest is live. ');
      line('It appears on your club card, in the league table and on every fixture. Click it to replace it — the new one goes live straight away.');
    } else if (status === 'pending') {
      /* only reachable if publishing was refused, or for a crest uploaded
         before this went in */
      line('Uploaded, but not published yet', true);
      line(' — your initials show publicly until it is. Click the crest to try again.');
    } else {
      line('That upload was not approved. ');
      line('Click the crest to try another — an SVG with a transparent background works best.');
    }
  };

  paint(null, null);
  try {
    const { data } = await sb.from('media')
      .select('storage_path,status,created_at')
      .eq('owner_type', 'team').eq('owner_id', team.id).eq('kind', 'logo')
      .order('created_at', { ascending: false }).limit(1);
    const m = data && data[0];
    if (m && window.EpinoiaUpload) {
      paint(window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, m.storage_path), m.status);
    }
  } catch (_) { /* the slot still works as an upload button */ }

  if (slot.dataset.wired) return;      // renderRoster runs again after every edit
  slot.dataset.wired = '1';
  slot.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (!window.EpinoiaUpload) return say('The uploader did not load.', 'err');
    slot.disabled = true;
    try {
      const up = await window.EpinoiaUpload.upload(sb, {
        file: f, ownerType: 'team', ownerId: team.id, kind: 'logo' });
      if (!up || !up.storage_path) throw new Error('the upload returned no path');

      /* A CREST GOES UP WITHOUT REVIEW. Every other image waits for the league,
         and for a photograph of a person that is right — publishing one is the
         step that puts a face on the internet. A crest is the club's own mark
         and contains nobody, so making a league administrator approve it before
         a club can look like itself is friction with nothing behind it.

         The RPC does the publishing rather than this page: it refuses anything
         that is not a club crest, so this cannot become a way around the queue
         for anything else. If it fails the upload still exists as pending and
         the league can approve it the old way, which is why the message says
         what actually happened rather than assuming. */
      const pub = await sb.rpc('publish_team_logo', { p_media: up.id });
      const live = !pub.error;

      /* THE OLD FILE IS REMOVED THROUGH THE STORAGE API, because SQL may not
         touch it — Supabase refuses a direct delete from storage.objects and
         says to come through the API instead. The function hands back the
         paths whose rows it removed and this clears the files.

         Best-effort on purpose, and after the publish rather than before it: an
         orphaned crest is a few kilobytes nobody points at, and failing a
         publish because a tidy-up failed would be the wrong way round. */
      const orphans = (pub.data && pub.data.orphans) || [];
      if (live && orphans.length) {
        sb.storage.from('media-public').remove(orphans).catch(() => {});
      }

      paint(window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, up.storage_path),
            live ? 'approved' : 'pending');
      say(live ? 'Crest updated — it is live now.'
               : 'Crest uploaded, but publishing it was refused: ' +
                 (pub.error.message || 'unknown') + ' The league can approve it.',
          live ? 'ok' : 'warn');
    } catch (e) {
      say('Upload failed: ' + (e.message || e), 'err');
    }
    slot.disabled = false;
  });
}

async function renderRoster() {
  show('#roster', true);
  $('#rtitle').textContent = team.name;
  mountCrest();
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
