'use strict';
/* ============================================================================
   THE CLUB'S OWN PAGE, from the club's side.

   The public team profile grew a venue, a contact block, a staff list, player
   measurements and a career history. Every one of those had to be typed in by
   a league administrator on the club's behalf, which is backwards — the club
   is the only party that knows its own hall, its own secretary's number and
   whose guardian has said yes.

   Four panels: the club (venue, contact, socials), the staff, one player's
   profile, and the consent that decides whether an under-age player appears
   at all.

   ON CONSENT. The tick box is the single most consequential control in this
   whole application: it is what puts a child's name, club and measurements on
   a public website. So it cannot be a bare checkbox — the database refuses it
   without a name recorded against it, and this panel says what will happen in
   plain words before it is ticked rather than after.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaClubUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const field = (label, node, flex) => {
  const l = el('label', 'f');
  if (flex) l.style.flex = flex;
  l.append(el('span', null, label), node);
  return l;
};
const input = (ph, val, type) => {
  const i = el('input', 'ep-input');
  if (type) i.type = type;
  i.placeholder = ph || '';
  if (val != null) i.value = val;
  return i;
};

let DATA = null;      // the last portal_club() result

/* opts: { host, sb, team, say, onDone } */
async function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  const res = await o.sb.rpc('portal_club', { p_team: o.team.id });
  if (res.error) { o.say(res.error.message, 'err'); return; }
  DATA = res.data || {};

  clubPanel(host, o);
  staffPanel(host, o);
  playersPanel(host, o);
}

/* ------------------------------------------------------------- the club --- */
function clubPanel(host, o) {
  const t = DATA.team || {};
  const c = DATA.contact || {};
  const s = DATA.socials || {};

  host.appendChild(el('div', 'ep-hdr')).append(
    el('span', 'idx', '02'), Object.assign(document.createElement('h2'),
      { textContent: 'Home venue, contact & socials' }));

  const band = el('div', 'ep-band stack');
  host.appendChild(band);

  band.appendChild(el('p', 'note',
    'This is the “Home venue & contact” block on your club’s public page. ' +
    'The address is what an away supporter navigates to, so it is worth the ' +
    'postcode.'));

  const r1 = el('div', 'row');
  const venue = input('The Drill Hall', t.home_venue);
  const address = input('Street, town, postcode', t.home_venue_address);
  r1.append(field('Venue name', venue), field('Address', address, '2 1 260px'));
  band.appendChild(r1);

  const r2 = el('div', 'row');
  const note = input('Parking behind the hall; entrance on the side street',
                     t.home_venue_note);
  r2.append(field('Getting there (optional)', note, '3 1 300px'));
  band.appendChild(r2);

  /* ---- the photograph ----
     Either an upload or an address. Both end up in the same column, because
     from the page's point of view they are the same thing: something to put
     in an <img>. */
  const r3 = el('div', 'row');
  const image = input('https://… or upload', t.home_venue_image);
  const file = el('input');
  file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
  const pick = el('button', 'mini', 'upload a photo');
  pick.type = 'button';
  pick.addEventListener('click', () => file.click());
  r3.append(field('Venue photograph', image, '3 1 280px'), pick, file);
  band.appendChild(r3);

  const preview = el('div', 'venue-prev');
  if (t.home_venue_image) {
    const img = el('img'); img.alt = '';
    /* A stored value is either an absolute address the club supplied or a
       path in the media bucket; only the second needs resolving. */
    img.src = /^https?:\/\//.test(t.home_venue_image)
      ? t.home_venue_image
      : (window.EpinoiaUpload
          ? window.EpinoiaUpload.publicUrl(window.EPINOIA_CONFIG, t.home_venue_image)
          : t.home_venue_image);
    preview.appendChild(img);
  }
  band.appendChild(preview);

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    if (!window.EpinoiaUpload) return o.say('The uploader did not load.', 'err');
    pick.disabled = true;
    try {
      /* THE SAME PIPELINE A PLAYER PHOTOGRAPH GOES THROUGH: resized in the
         browser first, so a 4 MB picture from a phone leaves as about 60 KB,
         then held in the private bucket until the league approves it. A venue
         is a building rather than a person and the queue is arguably heavy
         for it — but one pipeline that always applies beats two, one of which
         is the exception somebody forgets. */
      const up = await window.EpinoiaUpload.upload(o.sb, {
        file: f, ownerType: 'team', ownerId: o.team.id, kind: 'venue' });
      if (!up || !up.storage_path) throw new Error('the upload returned no path');
      image.value = up.storage_path;
      preview.textContent = '';
      preview.appendChild(el('p', 'note',
        'Uploaded. It appears on your page once the league approves it — ' +
        'press save to attach it in the meantime.'));
      o.say('Photograph uploaded and queued for approval.', 'ok');
    } catch (e) {
      o.say('Upload failed: ' + (e.message || e), 'err');
    }
    pick.disabled = false;
  });

  /* ---- contact ---- */
  band.appendChild(el('div', 'fmt-h', 'Who to contact'));
  const r4 = el('div', 'row');
  const cname = input('Club Secretary', c.contact_name);
  const cmail = input('secretary@club.example', c.email, 'email');
  const cphone = input('07700 900000', c.phone, 'tel');
  r4.append(field('Name or role', cname), field('Email', cmail),
            field('Telephone', cphone));
  band.appendChild(r4);

  const r5 = el('div', 'row');
  const pub = el('input'); pub.type = 'checkbox';
  pub.checked = c.is_public !== false;
  const form = el('input'); form.type = 'checkbox';
  form.checked = c.accepts_form !== false;
  const lp = el('label', 'sw'); lp.append(pub, document.createTextNode(' show these publicly'));
  const lf = el('label', 'sw'); lf.append(form, document.createTextNode(' accept the contact form'));
  r5.append(lp, lf);
  band.appendChild(r5);
  band.appendChild(el('p', 'note',
    'With “show publicly” off, the page says the club can be reached and does ' +
    'not print the address — the form still delivers, so nobody has to publish ' +
    'a personal mobile number to be contactable.'));

  /* ---- socials ---- */
  band.appendChild(el('div', 'fmt-h', 'Socials'));
  const r6 = el('div', 'row');
  const ig = input('@yourclub', s.instagram);
  const xh = input('@yourclub', s.x_handle);
  const fb = input('facebook.com/yourclub', s.facebook);
  const web = input('https://yourclub.example', s.website);
  r6.append(field('Instagram', ig), field('X', xh),
            field('Facebook', fb), field('Website', web));
  band.appendChild(r6);

  band.appendChild(el('p', 'note',
    'Up to four Instagram posts appear underneath the venue photograph on ' +
    'your club’s page. Paste the link to each post.'));
  const pins = [];
  for (let i = 0; i < 4; i++) {
    const row = el('div', 'row');
    const p = input('https://www.instagram.com/p/…', (s.pinned || [])[i]);
    row.append(el('span', 'ep-micro', String(i + 1)), p);
    band.appendChild(row);
    pins.push(p);
  }

  const bar = el('div', 'row');
  const save = el('button', 'ep-btn pri', 'Save the club');
  save.type = 'button';
  bar.appendChild(save);
  band.appendChild(bar);

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      let r = await o.sb.rpc('set_team_venue', {
        p_team: o.team.id, p_venue: venue.value, p_address: address.value,
        p_image: image.value, p_note: note.value });
      if (r.error) throw r.error;

      r = await o.sb.rpc('set_team_contact', {
        p_team: o.team.id, p_contact_name: cname.value,
        p_email: cmail.value, p_phone: cphone.value,
        p_is_public: pub.checked, p_accepts_form: form.checked });
      if (r.error) throw r.error;

      r = await o.sb.rpc('set_team_socials', {
        p_team: o.team.id, p_instagram: ig.value, p_x: xh.value,
        p_facebook: fb.value, p_website: web.value,
        p_pinned: pins.map(p => p.value) });
      if (r.error) throw r.error;

      o.say('Saved — your club page is updated.', 'ok');
      if (o.onDone) o.onDone();
    } catch (e) {
      o.say(e.message || 'That was refused.', 'err');
    }
    save.disabled = false;
  });
}

/* -------------------------------------------------------------- the staff --- */
function staffPanel(host, o) {
  host.appendChild(el('div', 'ep-hdr')).append(
    el('span', 'idx', '03'), Object.assign(document.createElement('h2'),
      { textContent: 'Staff' }));

  const band = el('div', 'ep-band stack');
  host.appendChild(band);
  band.appendChild(el('p', 'note',
    'Shown at the top of your roster on the public page. Only a name, a role ' +
    'and an age — a birth year is held so the age stays right next season, and ' +
    'the year itself is never published.'));

  const list = el('div', 'stafflist');
  band.appendChild(list);

  (DATA.staff || []).forEach(s => list.appendChild(staffRow(s, o)));

  const add = el('div', 'row');
  const name = input('Alex Roe');
  const role = el('input', 'ep-input');
  role.setAttribute('list', 'staffroles');
  role.placeholder = 'Head Coach';
  const born = input('1985', '', 'number');
  born.min = '1900'; born.max = String(new Date().getFullYear());
  const go = el('button', 'ep-btn', 'Add');
  go.type = 'button';
  add.append(field('Name', name), field('Role', role),
             field('Born', born, '0 0 110px'), go);
  band.appendChild(add);

  /* The roles a basketball club actually has, offered but not enforced —
     somebody's title is their own business. */
  if (!document.querySelector('#staffroles')) {
    const dl = document.createElement('datalist');
    dl.id = 'staffroles';
    ['Head Coach', 'Assistant Coach', 'Team Manager', 'Physiotherapist',
     'Strength & Conditioning', 'Analyst', 'Team Doctor', 'Kit Manager',
     'Statistician', 'Club Secretary'].forEach(r => {
      const opt = document.createElement('option'); opt.value = r; dl.appendChild(opt);
    });
    document.body.appendChild(dl);
  }

  go.addEventListener('click', async () => {
    if (!name.value.trim() || !role.value.trim())
      return o.say('A staff member needs a name and a role.', 'err');
    go.disabled = true;
    const rankRes = await o.sb.rpc('staff_rank', { p_role: role.value });
    const r = await o.sb.from('team_staff').insert({
      team_id: o.team.id, name: name.value.trim(), role: role.value.trim(),
      born_year: born.value ? Number(born.value) : null,
      sort: rankRes.error ? 100 : rankRes.data });
    go.disabled = false;
    if (r.error) return o.say(r.error.message, 'err');
    o.say('Added.', 'ok');
    if (o.onDone) o.onDone();
  });
}

function staffRow(s, o) {
  const row = el('div', 'row');
  const name = input('', s.name);
  const role = input('', s.role);
  role.setAttribute('list', 'staffroles');
  const born = input('', s.born_year || '', 'number');
  born.style.flex = '0 0 100px';
  const save = el('button', 'mini', 'save'); save.type = 'button';
  const del = el('button', 'mini', '×'); del.type = 'button';
  del.title = 'remove';
  row.append(name, role, born, save, del);

  save.addEventListener('click', async () => {
    const r = await o.sb.from('team_staff').update({
      name: name.value.trim(), role: role.value.trim(),
      born_year: born.value ? Number(born.value) : null }).eq('id', s.id);
    if (r.error) return o.say(r.error.message, 'err');
    o.say('Saved ' + name.value + '.', 'ok');
  });
  del.addEventListener('click', async () => {
    if (!confirm('Remove ' + s.name + ' from the staff list?')) return;
    const r = await o.sb.from('team_staff').delete().eq('id', s.id);
    if (r.error) return o.say(r.error.message, 'err');
    o.say('Removed.', 'ok');
    if (o.onDone) o.onDone();
  });
  return row;
}

/* ------------------------------------------------------------ the players --- */
function playersPanel(host, o) {
  const age = DATA.consent_age || 16;

  host.appendChild(el('div', 'ep-hdr')).append(
    el('span', 'idx', '04'), Object.assign(document.createElement('h2'),
      { textContent: 'Player profiles' }));

  const band = el('div', 'ep-band stack');
  host.appendChild(band);
  band.appendChild(el('p', 'note',
    'Height, weight and wingspan appear on the player’s public profile. ' +
    'Centimetres and kilograms — the page converts for display, and storing ' +
    '6′4″ as text is how a table ends up unable to sort by height.'));

  (DATA.players || []).forEach(p => band.appendChild(playerCard(p, age, o)));
  if (!(DATA.players || []).length) {
    band.appendChild(el('p', 'note', 'No players on the roster yet.'));
  }
}

function playerCard(p, consentAge, o) {
  const card = el('div', 'pcard');
  /* WHAT ACTUALLY WITHHOLDS SOMEBODY IS is_minor, not their age. The two
     usually agree and they can drift — a club may set the flag on a squad
     member with no birth year, or leave it on somebody who has since had a
     birthday — and the panel has to describe the state the DATABASE will act
     on, or it will cheerfully tell a club their player is visible while the
     public page hides them. The age is context beside it, not the test. */
  const under = !!p.is_minor;

  const head = el('div', 'pcard-h');
  head.append(el('span', 'pcard-n', (p.jersey || '–')),
              el('span', 'pcard-name', (p.first_name + ' ' + p.last_name).trim()));
  if (p.age != null) head.appendChild(el('span', 'ep-micro', p.age + ' years'));
  if (under) {
    head.appendChild(el('span', p.public_consent ? 'tag ok' : 'tag warn',
      p.public_consent ? 'consent recorded · visible'
                       : (p.age != null && p.age < consentAge
                          ? 'under ' + consentAge + ' · withheld' : 'protected · withheld')));
  }
  card.appendChild(head);

  const r1 = el('div', 'row');
  const h = input('198', p.height_cm || '', 'number');
  const w = input('92', p.weight_kg || '', 'number');
  const ws = input('208', p.wingspan_cm || '', 'number');
  const pos = input('Guard', p.position || '');
  r1.append(field('Height cm', h, '0 0 110px'), field('Weight kg', w, '0 0 110px'),
            field('Wingspan cm', ws, '0 0 120px'), field('Position', pos, '1 1 140px'));
  card.appendChild(r1);

  /* ---- previous clubs ---- */
  card.appendChild(el('div', 'fmt-h', 'Previous clubs'));
  const prevHost = el('div', 'prevlist');
  card.appendChild(prevHost);
  const rows = [];
  function addPrev(v) {
    const row = el('div', 'row');
    const club = input('Old Town', (v && v.club) || '');
    const from = input('2019', (v && v.from) || '', 'number');
    const to = input('2022', (v && v.to) || '', 'number');
    from.style.flex = '0 0 92px'; to.style.flex = '0 0 92px';
    const x = el('button', 'mini', '×'); x.type = 'button';
    x.addEventListener('click', () => { row.remove(); rows.splice(rows.indexOf(rec), 1); });
    row.append(club, from, to, x);
    prevHost.appendChild(row);
    const rec = { club, from, to };
    rows.push(rec);
  }
  (p.previous_clubs || []).forEach(addPrev);
  const addBtn = el('button', 'mini', '+ another club');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => addPrev(null));
  card.appendChild(el('div', 'row')).appendChild(addBtn);

  /* ---- consent ----
     Offered for everybody, because a league may set its threshold anywhere and
     a club should be able to record a permission before it is needed. It only
     CHANGES anything for a player under the threshold, and the wording says
     so rather than implying every player is at risk of being hidden. */
  card.appendChild(el('div', 'fmt-h', 'Publication consent'));
  const cRow = el('div', 'row');
  const tick = el('input'); tick.type = 'checkbox'; tick.checked = !!p.public_consent;
  tick.style.cssText = 'width:17px;height:17px;accent-color:var(--amber)';
  const tickLab = el('label', 'sw');
  tickLab.append(tick, document.createTextNode(
    ' consent given for this player to appear publicly'));
  const guardian = input('Name of the parent or guardian who agreed',
                         p.consent_guardian || '');
  cRow.append(tickLab);
  card.appendChild(cRow);
  card.appendChild(el('div', 'row')).appendChild(
    field('Who gave it', guardian, '2 1 260px'));

  const explain = el('p', 'note');
  function say2() {
    const why = p.age != null
      ? (p.age < consentAge ? 'under ' + consentAge : 'marked as a protected player')
      : 'marked as a protected player';
    explain.textContent = under
      ? (tick.checked
          ? 'With this ticked, ' + p.first_name + '’s name, club and measurements ' +
            'appear on the public site. They are still withheld from the JSON API ' +
            'and from every partner feed — consent here is consent for this ' +
            'league’s website, not for anybody else to republish it.'
          : p.first_name + ' is ' + why + ', so nothing about them is shown ' +
            'publicly. They still appear in the league’s own records and their ' +
            'games are still scored normally.')
      : 'Not a protected player, so this changes nothing today — it is recorded ' +
        'for the club’s own files.';
  }
  say2();
  tick.addEventListener('change', say2);
  card.appendChild(explain);

  const save = el('button', 'ep-btn pri', 'Save ' + p.first_name);
  save.type = 'button';
  card.appendChild(el('div', 'row')).appendChild(save);

  save.addEventListener('click', async () => {
    if (tick.checked && !guardian.value.trim()) {
      return o.say('Record who gave consent before ticking it.', 'err');
    }
    save.disabled = true;
    try {
      /* 0 rather than null CLEARS a measurement. null means "leave it alone",
         which is what an untouched field should do — otherwise opening this
         card and pressing save on a different player's row would wipe it. */
      const num = v => v.value === '' ? 0 : Number(v.value);
      let r = await o.sb.rpc('set_player_profile', {
        p_player: p.id, p_height: num(h), p_weight: num(w), p_wingspan: num(ws),
        p_previous_club: null, p_position: pos.value,
        p_consent: tick.checked, p_guardian: guardian.value });
      if (r.error) throw r.error;

      r = await o.sb.rpc('set_player_previous_clubs', {
        p_player: p.id,
        p_rows: rows.map(x => ({ club: x.club.value,
                                 from: x.from.value || null, to: x.to.value || null }))
                    .filter(x => x.club.trim()) });
      if (r.error) throw r.error;

      o.say('Saved ' + p.first_name + '.', 'ok');
      if (o.onDone) o.onDone();
    } catch (e) {
      o.say(e.message || 'That was refused.', 'err');
    }
    save.disabled = false;
  });

  return card;
}

return { mount };
}));
