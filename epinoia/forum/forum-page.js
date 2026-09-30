'use strict';
/* ============================================================================
   A LEAGUE'S FORUM — forum/?l=<slug>[&s=<server>] (migration 0197).

   The Discord servers where the league's fans talk, as the league attached them:
   its own, a fans' community, a club's. Servers that exist, whoever runs them;
   nothing here makes one. Each is a card:
     its picture and name, whose it is (official, a club's, the fans'),
     the league's line about it,
     how many are in it and online (Discord's own public answer for its
       invitation: nothing is sent but the invitation's code),
     and the way in.
   A server whose id the league gave shows Discord's own widget beside the list
   (who is online, the channels), framed from discord.com and nothing else. The
   first such server opens; a card's "show here" swaps it, and the address keeps
   the choice (&s=). The talk is on Discord; this is the door.

   A server shows its widget only once its owner has switched it on (Discord:
   Server Settings > Widget > Enable Server Widget); the page says so under it.
   league_discord_public answers nothing for a league with no server, or one the
   reader may not see, and the rail only offers the page where there is one
   (league_discord_probe).
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG;
  const K = window.EpinoiaNewsCard;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const Q = new URLSearchParams(location.search);
  const WANT = Q.get('l') || '';
  const INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,40})\/?$/i;
  const ID = /^[0-9]{15,22}$/;
  const ICON = /^https:\/\/cdn\.discordapp\.com\/icons\/[0-9]{15,22}\/[A-Za-z0-9_]{1,80}\.(png|webp|gif|jpg)(\?size=[0-9]{2,4})?$/;
  const hasWidget = s => ID.test(String(s.server_id || ''));
  const num = v => Number(v).toLocaleString();

  /* how many are in a server and online, from Discord's public answer for its invitation (no sign-in, no cookie) */
  async function counts(invite) {
    const m = INVITE.exec(String(invite || ''));
    if (!m) return null;
    try {
      const r = await fetch('https://discord.com/api/v10/invites/' + encodeURIComponent(m[2]) + '?with_counts=true',
        { cache: 'no-store', credentials: 'omit' });
      if (r.status === 404) return { gone: true };
      if (!r.ok) return null;                                   // busy (429) or down: the card simply has no numbers
      const j = await r.json();
      return { members: j.approximate_member_count, online: j.approximate_presence_count };
    } catch (_) { return null; }
  }

  (async function boot() {
    const main = $('#forum');
    const empty = t => { main.textContent = ''; const d = el('div', 'pc-empty', t); d.style.margin = '16px'; main.appendChild(d); };
    if (!WANT) return empty('No league asked for.');
    let L = null;
    try {
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/league_discord_public', {
        method: 'POST', cache: 'no-store',
        headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_slug: WANT })
      });
      L = r.ok ? await r.json() : null;
    } catch (_) { L = null; }
    const back = $('#back');
    back.href = '../?l=' + encodeURIComponent(WANT);
    const servers = ((L && L.servers) || []).filter(s => hasWidget(s) || INVITE.test(String(s.invite || '')));
    if (!L || !servers.length) return empty('This league has no forum here yet.');
    window.__CS_LEAGUE_SLUG = L.slug;
    back.textContent = '← ' + L.name;
    document.title = 'Forum · ' + L.name;
    main.textContent = '';

    const one = servers.length === 1;
    const crest = L.logo_path && typeof window.epinoiaLogoUrl === 'function' ? window.epinoiaLogoUrl(L.logo_path, 128) : null;
    main.appendChild(K.hero({ name: L.name, logo: crest, colour: L.colour, kicker: 'Forum · on Discord',
      tagline: one ? 'Where the league’s fans talk, on Discord: who is online, the channels, and the way in.'
                   : servers.length + ' Discord servers where the league’s fans talk: the way into each, and who is online. The talk itself is on Discord.',
      links: one && servers[0].invite ? [{ href: servers[0].invite, text: 'Join the server ↗', external: true, primary: true }] : [] }));

    const wrap = el('div', 'fo-wrap');
    main.appendChild(wrap);

    /* ---- the widget: the chosen server's, or the first with one ---- */
    const framed = servers.filter(hasWidget);
    let open = framed.find(s => s.id === Q.get('s')) || framed[0] || null;
    let frame = null;
    const cards = new Map();
    if (open) {
      const col = el('div', 'fo-wcol');
      const box = el('div', 'fo-widget');
      frame = document.createElement('iframe');
      frame.loading = 'lazy';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      box.appendChild(frame);
      col.appendChild(box);
      col.appendChild(el('p', 'fo-note', 'An empty box means the server’s widget is switched off: its owner turns it on in Discord (Server Settings, Widget, Enable Server Widget).'));
      wrap.appendChild(col);
    }
    function show(s, remember) {
      if (!frame || !s || !hasWidget(s)) return;
      open = s;
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      frame.src = 'https://discord.com/widget?id=' + s.server_id + '&theme=' + (dark ? 'dark' : 'light');
      frame.title = s.name + ' on Discord';
      cards.forEach((c, id) => {
        c.card.classList.toggle('on', id === s.id);
        if (c.pick) { c.pick.textContent = id === s.id ? 'Showing' : 'Show here'; c.pick.disabled = id === s.id; }
      });
      if (remember) {
        try { history.replaceState(null, '', '?l=' + encodeURIComponent(L.slug) + '&s=' + encodeURIComponent(s.id)); } catch (_) { /* file:// */ }
      }
    }

    /* ---- the servers ---- */
    const list = el('div', 'fo-list');
    if (one) {
      list.appendChild(el('h2', 'fo-h', 'Talk basketball with ' + L.name + '’s fans'));
      list.appendChild(el('p', 'fo-p', 'Match threads, the table, the trades and the rumours. Each server keeps its own rules.'));
    }
    servers.forEach(s => {
      const card = el('article', 'fo-srv' + (s.official ? ' official' : ''));
      const icon = el('span', 'fo-ic');
      if (ICON.test(String(s.icon_url || ''))) {
        const img = el('img'); img.src = s.icon_url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        img.addEventListener('error', () => { icon.textContent = ''; icon.appendChild(el('span', null, K.initials(s.name))); });
        icon.appendChild(img);
      } else icon.appendChild(el('span', null, K.initials(s.name)));
      card.appendChild(icon);
      const body = el('div', 'fo-body');
      const whose = el('div', 'fo-whose');
      if (s.official) whose.appendChild(el('span', 'fo-badge official', 'Official'));
      if (s.club && s.club.slug) {
        const c = el('a', 'fo-badge club', s.club.name);
        c.href = '../t/?t=' + encodeURIComponent(s.club.slug);
        if (/^#[0-9a-f]{6}$/i.test(s.club.colour || '')) c.style.setProperty('--cc', s.club.colour);
        whose.appendChild(c);
      }
      if (!s.official && !(s.club && s.club.slug)) whose.appendChild(el('span', 'fo-badge', 'Community'));
      body.appendChild(whose);
      body.appendChild(el('h3', 'fo-name', s.name));
      if (s.note) body.appendChild(el('p', 'fo-line', s.note));
      const count = el('div', 'fo-count');
      body.appendChild(count);
      const acts = el('div', 'fo-acts');
      let join = null;
      if (INVITE.test(String(s.invite || ''))) {
        join = el('a', 'fo-join', 'Join ↗');
        join.href = s.invite; join.target = '_blank'; join.rel = 'noopener noreferrer';
        acts.appendChild(join);
      }
      let pick = null;
      if (frame && hasWidget(s) && framed.length > 1) {
        pick = el('button', 'fo-pick', 'Show here'); pick.type = 'button';
        pick.addEventListener('click', () => { show(s, true); if (window.matchMedia && matchMedia('(max-width:760px)').matches) frame.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        acts.appendChild(pick);
      }
      if (acts.childNodes.length) body.appendChild(acts);
      card.appendChild(body);
      cards.set(s.id, { card, pick });
      list.appendChild(card);
      if (join) counts(s.invite).then(c => {
        if (!c) return;
        if (c.gone) { count.textContent = 'This invitation has expired.'; join.remove(); return; }
        const bits = [];
        if (c.members) bits.push(num(c.members) + ' members');
        if (c.online) bits.push(num(c.online) + ' online');
        count.textContent = bits.join(' · ');
      });
    });
    wrap.appendChild(list);
    show(open, false);
  })();
})();
