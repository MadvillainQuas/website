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

  /* REMOVE SITS BESIDE ADD, not inside a menu. A club that has uploaded the
     wrong crest wants it gone now, and hunting for how is the worst minute of
     that. Hidden while there is nothing to remove. */
  /* FINISH A PUBLISH THAT DID NOT. Hidden unless the crest is pending. */
  let pubBtn = document.getElementById('crestPublish');
  if (!pubBtn) {
    pubBtn = document.createElement('button');
    pubBtn.id = 'crestPublish'; pubBtn.type = 'button'; pubBtn.className = 'mini';
    pubBtn.textContent = 'publish crest';
    pubBtn.title = 'put this crest live now';
    pubBtn.hidden = true;
  }

  /* THE CLUB COLOUR, BESIDE THE CREST IT COMES FROM.

     A crest suggests a colour and the club has to be able to overrule it — an
     automatic choice nobody can change is worse than no automatic choice,
     because the club is then stuck with whatever a routine made of their
     artwork. Until now the colour was picked once when the club was created
     and could never be changed by the club again. */
  let swatch = document.getElementById('clubColour');
  if (!swatch) {
    swatch = document.createElement('input');
    swatch.type = 'color'; swatch.id = 'clubColour'; swatch.className = 'clubcolour';
    swatch.title = 'the club colour — used on your card, the table and the box score';
  }

  let rm = document.getElementById('crestRemove');
  if (!rm) {
    rm = document.createElement('button');
    rm.id = 'crestRemove'; rm.type = 'button'; rm.className = 'mini';
    rm.textContent = 'remove crest';
    rm.title = 'take this crest down — your initials come back';
    slot.parentNode.insertBefore(swatch, document.getElementById('back'));
    slot.parentNode.insertBefore(pubBtn, document.getElementById('back'));
    slot.parentNode.insertBefore(rm, document.getElementById('back'));

    pubBtn.addEventListener('click', async () => {
      pubBtn.disabled = true;
      try {
        const { data: rows } = await sb.from('media')
          .select('id,storage_path')
          .eq('owner_type', 'team').eq('owner_id', team.id).eq('kind', 'logo')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(1);
        const m = rows && rows[0];
        if (!m) { say('Nothing waiting to be published.', 'warn'); pubBtn.disabled = false; return; }
        /* A crest uploaded before crests went straight to the public bucket is
           still in the private one and has to be moved first.

           IF THAT MOVE FAILS, NOTHING IS PUBLISHED. Marking the row live while
           the file sits in the private bucket is precisely the broken state
           this whole sequence has been unpicking — a record that says published
           over an image that 404s. Better to say so and let the crest be
           uploaded again, which now writes straight to the public bucket and
           cannot land in that state at all. */
        try {
          await moveToPublic(m.storage_path);
        } catch (e) {
          throw new Error('could not move the file into public storage (' +
            (e.message || 'refused') + '). Remove the crest and upload it ' +
            'again — a new upload goes straight to public storage.');
        }
        const pub = await sb.rpc('publish_team_logo', { p_media: m.id });
        if (pub.error) throw new Error(pub.error.message);
        const orphans = (pub.data && pub.data.orphans) || [];
        if (orphans.length) {
          sb.storage.from('media-public').remove(orphans).catch(() => {});
          sb.storage.from('media-pending').remove(orphans).catch(() => {});
        }
        paint(window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, m.storage_path), 'approved');
        say('Crest published — it is live now.', 'ok');
      } catch (e) { say(e.message || 'that was refused', 'err'); }
      pubBtn.disabled = false;
    });
    rm.addEventListener('click', async () => {
      if (!confirm('Remove your club crest?\n\nYour initials come back on your ' +
                   'club card, in the league table and on every fixture. You can ' +
                   'upload another at any time.')) return;
      rm.disabled = true;
      try {
        await removeImage('team', team.id, 'logo');
        paint(null, null);
        say('Crest removed — your initials are showing again.', 'ok');
      } catch (e) { say(e.message, 'err'); }
      rm.disabled = false;
    });
  }

  const saveColour = async (hex, why) => {
    const { error } = await sb.rpc('set_team_colour',
      { p_team: team.id, p_colour: hex });
    if (error) { say(error.message, 'err'); return false; }
    team.colour = hex;
    swatch.value = hex;
    document.documentElement.style.setProperty('--team-a', hex);
    colourHelp(hex, why);
    return true;
  };

  const colourHelp = (hex, why) => {
    const h = document.getElementById('colourHelp');
    if (!h) return;
    h.textContent = '';
    const b = document.createElement('b'); b.textContent = 'Club colour ' + hex + '. ';
    h.appendChild(b);
    h.appendChild(document.createTextNode(
      (why === 'crest'
        ? 'Taken from your crest and lightened enough to read on a dark page. '
        : '') +
      'It colours your club card, your name in the league table and your side ' +
      'of every box score. Change it with the swatch.'));
  };

  const paint = (url, status) => {
    slot.textContent = '';
    if (rm) rm.hidden = !url;
    /* A CREST THAT DID NOT PUBLISH IS NOT STRANDED. The upload succeeded and
       the file is sitting in the pending bucket; all that failed was the last
       step. Offering to finish it beats telling somebody to upload the same
       file again. */
    if (pubBtn) pubBtn.hidden = (status !== 'pending');
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
      line('Uploaded, but not published yet', true);
      line(' — your initials show publicly until it is. Use publish beside the ' +
           'crest, or click the crest to upload a different one.');
    } else {
      line('That upload was not approved. ');
      line('Click the crest to try another — an SVG with a transparent background works best.');
    }
  };

  swatch.value = /^#[0-9a-fA-F]{6}$/.test(team.colour || '') ? team.colour : '#93f2bf';
  colourHelp(swatch.value, null);
  if (!swatch.dataset.wired) {
    swatch.dataset.wired = '1';
    /* on change rather than on input: a colour picker fires continuously while
       somebody drags around it, and each one of those would be a write */
    swatch.addEventListener('change', async () => {
      if (await saveColour(swatch.value, 'manual')) say('Club colour saved.', 'ok');
    });
  }

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
      /* STRAIGHT INTO THE PUBLIC BUCKET. A crest is published on arrival, so
         there is nothing for the private bucket to hold it for — and the
         cross-bucket move that used to follow is the step that failed with
         "new row violates row-level security policy". Writing it where it is
         going to live removes the operation rather than debugging it: no copy,
         no delete, no second set of permissions, and no window in which the row
         and the file disagree about which bucket they are in. */
      const up = await window.EpinoiaUpload.upload(sb, {
        file: f, ownerType: 'team', ownerId: team.id, kind: 'logo',
        bucket: 'media-public' });
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
      /* THE COLOUR COMES WITH THE CREST. Read off the artwork during the
         resize, so it costs no extra work and no extra request. Only when the
         crest actually went live — a colour matching a crest nobody can see
         would be a change the club did not ask for and cannot explain.

         A vector gives none (nothing is decoded to read), and a monochrome
         crest gives none either, and in both cases the existing colour is left
         exactly as it was. */
      let colourNote = '';
      if (live && up.colour && up.colour.toLowerCase() !== (team.colour || '').toLowerCase()) {
        if (await saveColour(up.colour, 'crest')) colourNote = ' Club colour set to ' + up.colour + '.';
      }
      say(live ? 'Crest updated — it is live now.' + colourNote
               : 'Crest uploaded, but marking it live was refused: ' +
                 (pub.error.message || 'unknown') +
                 ' Use publish beside the crest to try again.',
          live ? 'ok' : 'warn');
    } catch (e) {
      say('Upload failed: ' + (e.message || e), 'err');
    }
    slot.disabled = false;
  });
}

/* TAKING AN IMAGE DOWN, in one place.

   The RPC removes the rows and the pointers and hands back the storage paths,
   because SQL is not allowed to delete the files (0062). Clearing them is
   best-effort for the same reason it is on publish: an orphaned file is a few
   kilobytes nobody points at, and failing a removal because a tidy-up failed
   would be the wrong way round. What matters is that the row is gone — that is
   what every reader looks at. */
/* MOVE THE FILE, THEN SAY IT IS PUBLISHED — in that order, and never the
   other way round.

   Only the Storage API can move an object, because only it moves the bytes; a
   SQL update of storage.objects.bucket_id moves the row and leaves the file
   where it was, which is how two crests came to be marked approved with their
   images 404ing. So the move happens here and the row is only marked published
   if it worked. A failed move now means "not published", which is the honest
   outcome, instead of a record that claims otherwise.

   'already exists' is treated as success: the file is in the public bucket,
   which is the whole objective, and a retry after a half-finished move should
   not be an error. */
async function moveToPublic(path) {
  const { error } = await sb.storage.from('media-pending')
    .move(path, path, { destinationBucket: 'media-public' });
  if (!error) return;
  /* "already exists" means the file is where it needs to be, which is the whole
     objective — a retry after a half-finished move is not a failure. Anything
     else is, and is raised rather than swallowed: a move that quietly did
     nothing is how a row comes to claim a file it has not got. */
  if (/exists/i.test(error.message || '')) return;
  throw new Error(error.message || 'could not move the file to public storage');
}

async function removeImage(ownerType, ownerId, kind) {
  const { data, error } = await sb.rpc('remove_media', {
    p_owner_type: ownerType, p_owner_id: ownerId, p_kind: kind || null });
  if (error) throw new Error(error.message || 'that removal was refused');
  const orphans = (data && data.orphans) || [];
  if (orphans.length) {
    /* it could be in either bucket — published or still waiting — and trying
       both is cheaper than asking which */
    sb.storage.from('media-public').remove(orphans).catch(() => {});
    sb.storage.from('media-pending').remove(orphans).catch(() => {});
  }
  return (data && data.removed) || 0;
}

/* Which players already have a photograph, so the row can offer to remove one
   rather than only to add another. One query for the whole roster. */
async function photosFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    const { data } = await sb.from('media')
      .select('owner_id,status,created_at')
      .eq('owner_type', 'player').eq('kind', 'photo').in('owner_id', ids)
      .order('created_at', { ascending: false });
    (data || []).forEach(m => { if (!out.has(m.owner_id)) out.set(m.owner_id, m.status); });
  } catch (_) { /* the add path still works without knowing */ }
  return out;
}

async function renderRoster() {
  show('#roster', true);
  $('#rtitle').textContent = team.name;
  mountCrest();
  document.documentElement.style.setProperty('--team-a', team.colour || '#93f2bf');
  const { data, error } = await sb.from('roster_entries')
    .select('id,jersey,active,players(id,first_name,last_name,is_minor)')
    .eq('team_id', team.id).order('jersey');
  const photos = await photosFor((data || []).map(r => r.players && r.players.id).filter(Boolean));
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

    /* A PHOTOGRAPH CAN BE TAKEN DOWN, and this is the only way to do it that is
       not anonymising the whole player — which is a safeguarding action, not a
       way to change a picture. Shown only when there is one, and labelled for
       the photograph specifically because the button below it removes the
       PLAYER and two things called "remove" on one row is a trap. */
    const has = photos.get(p.id);
    if (has) {
      upl.textContent = has === 'approved' ? 'replace photo' : 'pending';
      const rmPic = document.createElement('button');
      rmPic.className = 'mini'; rmPic.textContent = 'remove photo';
      rmPic.title = 'take this player\'s photograph down — the player stays on the roster';
      rmPic.addEventListener('click', async () => {
        if (!confirm('Remove the photograph of ' + nameCell.textContent +
                     '?\n\nThey stay on the roster. A new one can be uploaded ' +
                     'at any time.')) return;
        rmPic.disabled = true;
        try {
          await removeImage('player', p.id, 'photo');
          say('Photograph removed.', 'ok');
          renderRoster();
        } catch (e) { say(e.message, 'err'); rmPic.disabled = false; }
      });
      act.appendChild(rmPic);
    }

    const del = document.createElement('button');
    del.className = 'mini'; del.textContent = 'remove player';
    del.title = 'take this player off the roster entirely';
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
