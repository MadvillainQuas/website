'use strict';
/* ============================================================================
   YOUR PAGE — the editor of a fan's public profile, on /me/ (migration 0197).

   The page itself is fan/?u=<username>, and it is shown only while the fan is
   public on EPINOIA GO (a username, 18 or over, and the one tap on the GO page).
   This says which it is, and edits what the page shows:

     FROM YOUR ACCOUNTS   the name, picture and handle each social account the fan
                          signed in with already has (my_fan_profile suggest):
                          one press fills the form with them
     THE PAGE             a name, a line, a picture (an https address: the
                          account's own or one they host), a colour, their club,
                          their social links, and whether their follows show
     DISCORD              linked to the account (the provider's manual linking),
                          then read from the identity itself (sync_fan_discord);
                          shown on the page or not

   The head of the page is drawn beside the form as it will look (newscard.js
   hero). The database checks everything again (set_fan_profile), and what it
   refuses is said in words.
     window.EpinoiaFanProfileEditor.mount({ host, sec, sb, after })  -> Promise
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFanProfileEditor = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const https = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || '').trim());
const LINKS = [['instagram', 'Instagram'], ['x', 'X'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['twitch', 'Twitch'],
  ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['facebook', 'Facebook'], ['website', 'Website']];
const PROVIDER = { google: 'Google', discord: 'Discord', twitter: 'X', twitch: 'Twitch', facebook: 'Facebook', apple: 'Apple', github: 'GitHub' };
/* where a provider's handle is a page of theirs */
const HANDLE_LINK = { twitter: h => ['x', 'https://x.com/' + encodeURIComponent(h)], twitch: h => ['twitch', 'https://www.twitch.tv/' + encodeURIComponent(h)] };
const WHY = {
  name_long: 'The name is 40 characters at the most.', bio_long: 'The line is 280 characters at the most.',
  words: 'Please use different words: something in the name or the line is not allowed.',
  avatar: 'A picture is an https:// address.', colour: 'The colour did not take: pick it again.',
  club: 'That club cannot be chosen.', signed_out: 'You are signed out: sign in again.', shape: 'That did not save.'
};

async function discordOffered(cfg) {
  try {
    const r = await fetch(cfg.supabaseUrl + '/auth/v1/settings', { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey } });
    const j = r.ok ? await r.json() : null;
    return !!(j && j.external && j.external.discord);
  } catch (_) { return false; }
}

async function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  const sec = typeof o.sec === 'string' ? document.querySelector(o.sec) : o.sec;
  const sb = o.sb;
  const K = (typeof window !== 'undefined' && window.EpinoiaNewsCard) || null;
  if (!host || !sb) return;
  let { data: P, error } = await sb.rpc('my_fan_profile');
  if (error || !P) return;                                   // no 0197 yet: the section stays hidden
  const cfg = window.EPINOIA_CONFIG || {};

  /* a fan back from linking Discord: read it from the identity now */
  if (!P.discord && (P.suggest || []).some(s => s.provider === 'discord')) {
    const { data: d } = await sb.rpc('sync_fan_discord');
    if (d) P.discord = d;
  }

  host.textContent = '';
  if (sec) sec.classList.remove('hide');
  if (typeof o.after === 'function') o.after();

  /* ---- is it shown ---- */
  const state = el('p', 'fp-state');
  if (P.public && P.username) {
    state.append('Your page is public: ');
    const a = el('a', null, 'fan/?u=' + P.username + ' →');
    a.href = '../fan/?u=' + encodeURIComponent(P.username);
    state.appendChild(a);
  } else if (!P.username) {
    state.append('Your page shows once you have a username (above) and go public on EPINOIΛ GO. ');
  } else {
    state.append('Your page shows once you go public on EPINOIΛ GO (18 or over): ');
    const a = el('a', null, 'go public →');
    a.href = '../go/stamps/';
    state.appendChild(a);
  }
  host.appendChild(state);

  const grid = el('div', 'fp-grid');
  const form = el('div', 'fp-form');
  const side = el('div', 'fp-side');
  grid.append(form, side);
  host.appendChild(grid);

  /* ---- from your accounts ---- */
  const sugg = (P.suggest || []).filter(s => s && (s.name || s.avatar_url || s.handle));
  if (sugg.length) {
    const box = el('div', 'fp-from');
    box.appendChild(el('span', 'fp-label', 'From your accounts'));
    sugg.forEach(s => {
      const b = el('button', 'ep-btn mini', 'Use my ' + (PROVIDER[s.provider] || s.provider) + (s.avatar_url ? ' name and picture' : ' name'));
      b.type = 'button';
      b.addEventListener('click', () => {
        if (s.name) name.value = s.name.slice(0, 40);
        if (s.avatar_url) avatar.value = s.avatar_url;
        const h = s.handle && HANDLE_LINK[s.provider] ? HANDLE_LINK[s.provider](s.handle) : null;
        if (h && links[h[0]] && !links[h[0]].value) links[h[0]].value = h[1];
        paint();
        say('Filled in from ' + (PROVIDER[s.provider] || s.provider) + ': check it, then save.', '');
      });
      box.appendChild(b);
    });
    form.appendChild(box);
  }

  const field = (label, input, hint) => {
    const w = el('label', 'fp-field');
    w.appendChild(el('span', 'fp-label', label));
    w.appendChild(input);
    if (hint) w.appendChild(el('span', 'fp-hint', hint));
    return w;
  };
  const inp = (v, ph, max) => { const i = el('input', 'ep-input'); i.value = v || ''; i.placeholder = ph || ''; if (max) i.maxLength = max; return i; };

  const name = inp(P.name, P.username ? '@' + P.username : 'your name', 40);
  const bio = el('textarea', 'ep-input fp-ta'); bio.maxLength = 280; bio.rows = 3; bio.value = P.bio || ''; bio.placeholder = 'A line about you: your club, your seats, your streak';
  const avatar = inp(P.avatar_url, 'https://… a square picture', 500);
  const colour = el('input', 'fp-colour'); colour.type = 'color'; colour.value = /^#[0-9a-f]{6}$/i.test(P.colour || '') ? P.colour : '#1f8a5b';
  const noColour = el('input'); noColour.type = 'checkbox'; noColour.checked = !P.colour;
  const cl = el('label', 'fp-inline'); cl.append(colour, noColour, el('span', null, 'no colour of my own'));
  form.append(field('Name', name, 'shown large on your page; your @username is always beside it'), field('Line', bio),
              field('Picture', avatar, 'an https:// address; "From your accounts" fills in the one you have there'), field('Colour', cl));

  /* your club: one of the clubs you follow */
  const club = el('select', 'ep-input');
  const none = el('option', null, 'none'); none.value = ''; club.appendChild(none);
  try {
    const { data: prefs } = await sb.from('fan_prefs').select('fav_team_ids').maybeSingle();
    const ids = ((prefs && prefs.fav_team_ids) || []).slice(0, 60);
    if (ids.length) {
      const { data: ts } = await sb.from('teams').select('id,name').in('id', ids).order('name');
      (ts || []).forEach(t => { const opt = el('option', null, t.name); opt.value = t.id; club.appendChild(opt); });
    }
  } catch (_) { /* no clubs to offer */ }
  if (P.club_id && ![...club.options].some(x => x.value === P.club_id)) { const opt = el('option', null, 'your club'); opt.value = P.club_id; club.appendChild(opt); }
  club.value = P.club_id || '';
  form.appendChild(field('Your club', club, 'from the clubs you follow (Your clubs, below)'));

  const links = {};
  const lw = el('div', 'fp-links');
  LINKS.forEach(([k, label]) => { links[k] = inp((P.links || {})[k], 'https://…', 300); lw.appendChild(field(label, links[k])); });
  form.appendChild(el('span', 'fp-label', 'Your accounts, on your page'));
  form.appendChild(lw);

  const follows = el('input'); follows.type = 'checkbox'; follows.checked = !!P.show_follows;
  const fl = el('label', 'fp-inline'); fl.append(follows, el('span', null, 'Show the leagues and clubs I follow'));
  form.appendChild(fl);

  /* Discord */
  const dbox = el('div', 'fp-discord');
  dbox.appendChild(el('span', 'fp-label', 'Discord'));
  const showD = el('input'); showD.type = 'checkbox'; showD.checked = P.show_discord !== false;
  function drawDiscord() {
    [...dbox.querySelectorAll('.fp-d')].forEach(n => n.remove());
    if (P.discord) {
      const row = el('div', 'fp-d fp-inline');
      if (https(P.discord.avatar_url)) { const i = el('img', 'fp-davatar'); i.src = P.discord.avatar_url; i.alt = ''; row.appendChild(i); }
      row.appendChild(el('b', null, P.discord.username || P.discord.global_name || 'linked'));
      const lab = el('label', 'fp-inline'); lab.append(showD, el('span', null, 'on my page'));
      row.appendChild(lab);
      const re = el('button', 'ep-btn mini', 'read it again'); re.type = 'button';
      re.addEventListener('click', async () => { const { data: d } = await sb.rpc('sync_fan_discord'); P.discord = d || null; drawDiscord(); paint(); });
      row.appendChild(re);
      dbox.appendChild(row);
    } else {
      const row = el('div', 'fp-d');
      row.appendChild(el('span', 'fp-hint', 'Link your Discord account to show your Discord name on your page, from Discord itself.'));
      discordOffered(cfg).then(on => {
        if (!on) { row.appendChild(el('span', 'fp-hint', ' (Discord sign-in is not switched on for Epinoia yet.)')); return; }
        const b = el('button', 'ep-btn mini', 'Link Discord'); b.type = 'button';
        b.addEventListener('click', async () => {
          if (typeof sb.auth.linkIdentity !== 'function') return say('This browser’s copy of the sign-in library cannot link accounts: reload the page.', 'bad');
          const { error: e } = await sb.auth.linkIdentity({ provider: 'discord', options: { redirectTo: location.origin + location.pathname + '#fanprofile' } });
          if (e) say(/manual linking/i.test(e.message || '') ? 'Linking accounts is not switched on for Epinoia yet.' : (e.message || 'Discord could not be linked.'), 'bad');
        });
        row.appendChild(b);
      });
      dbox.appendChild(row);
    }
  }
  drawDiscord();
  form.appendChild(dbox);

  const msg = el('div', 'fp-msg'); msg.setAttribute('role', 'status');
  const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'fp-msg' + (kind ? ' ' + kind : ''); };
  const save = el('button', 'ep-btn pri', 'Save your page'); save.type = 'button';
  form.append(save, msg);

  /* the head as it will look */
  side.appendChild(el('span', 'fp-label', 'How your page starts'));
  const prev = el('div', 'fp-prev');
  side.appendChild(prev);
  function paint() {
    prev.textContent = '';
    if (!K) return;
    const ls = LINKS.filter(([k]) => https(links[k].value)).map(([k, label]) => ({ href: links[k].value.trim(), text: label + ' ↗', external: true }));
    if (P.discord && showD.checked) ls.push({ href: 'https://discord.com/users/' + encodeURIComponent(P.discord.id || ''), text: 'Discord ↗', external: true });
    prev.appendChild(K.hero({ name: name.value.trim() || '@' + (P.username || 'you'), logo: https(avatar.value) ? avatar.value.trim() : null,
      colour: noColour.checked ? null : colour.value, kicker: '@' + (P.username || 'username'), tagline: bio.value.trim(), links: ls }));
  }
  [name, bio, avatar].concat(Object.values(links)).forEach(i => i.addEventListener('input', paint));
  colour.addEventListener('input', () => { noColour.checked = false; paint(); });
  noColour.addEventListener('change', paint);
  showD.addEventListener('change', paint);
  paint();

  save.addEventListener('click', async () => {
    const L = {};
    Object.keys(links).forEach(k => { const v = links[k].value.trim(); if (v) L[k] = v; });
    const bad = Object.keys(L).filter(k => !https(L[k]));
    if (bad.length) return say('Each account is an https:// address: ' + bad.join(', ') + '.', 'bad');
    if (avatar.value.trim() && !https(avatar.value)) return say(WHY.avatar, 'bad');
    save.disabled = true;
    say('Saving…');
    const { data: r, error: e } = await sb.rpc('set_fan_profile', { p: {
      name: name.value, bio: bio.value, avatar_url: avatar.value.trim() || null, colour: noColour.checked ? null : colour.value,
      links: L, club_id: club.value || null, show_follows: follows.checked, show_discord: showD.checked } });
    save.disabled = false;
    if (e) return say(e.message || 'That did not save.', 'bad');
    if (!r || !r.ok) return say(WHY[(r && r.reason) || 'shape'] || 'That did not save.', 'bad');
    say(P.public ? 'Saved: your page shows it now.' : 'Saved. Your page shows it once you go public on EPINOIΛ GO.', 'ok');
  });
}

return { mount };
}));
