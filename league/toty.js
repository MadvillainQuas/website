'use strict';
/* ============================================================================
   TEAM OF THE YEAR, AND THE BALLOT THAT DECIDES IT.

   Drawn with the SAME CARDS as the Stars section directly below it. That is
   deliberate rather than lazy: a reader has already learnt what one of those
   cards means by the time they reach it, and inventing a second visual
   language for the same kind of object — a player, their club, one number —
   would make the more important of the two harder to read.

   What changes is the plate. A star card carries a rank; a team-of-the-year
   card carries the award, as a ribbon across the shoulder.

   The ballot is anonymous by design. There is no account behind a vote, only
   a random key the browser keeps, which stops the accidental double
   submission and the idle refresh and nothing more determined than that. The
   platform does not pretend otherwise — that is exactly why the league's own
   officials vote with a separate weight (migration 0047).
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaToty = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

const VOTER_KEY = 'epinoia.ballot.voter';

/* A random identifier the browser keeps. Not identity, and not treated as
   any: it exists so the same person refreshing does not vote twice by
   accident. crypto.randomUUID is everywhere that matters; the fallback keeps
   an old browser voting rather than silently failing. */
function voterKey() {
  try {
    let v = localStorage.getItem(VOTER_KEY);
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID()
        : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      localStorage.setItem(VOTER_KEY, v);
    }
    return v;
  } catch (_) {
    /* private browsing with storage blocked: still let them vote, they just
       get a fresh key each time, which is the same as a new visitor */
    return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
}

/* ASKING AND DRAWING ARE SEPARATE, and the split is the point rather than
   tidiness. A league page has to find which of its competitions has a Team of
   the Year before it can draw one, and when the only way to ask was to call
   mount() — which fetched and rendered in one go — finding out meant walking the
   competitions in series, two round trips each, stopping at the first hit. Four
   competitions with no ballot cost eight serial requests and drew nothing.

   probe() is the question and touches no DOM, so a caller can ask about every
   competition at once. render() takes what probe() found and does not fetch.

   The two requests inside a probe go together too: a published team and an open
   ballot are independent, and neither answer changes what the other asks. */
async function probe(o) {
  const [team, shortlist] = await Promise.all([
    o.rpc('toty_public', { p_competition: o.competitionId }).catch(() => []),
    o.rpc('toty_ballot_public', { p_competition: o.competitionId }).catch(() => [])
  ]);
  const named = (team || []).filter(r => r.player_id);
  const list = shortlist || [];
  return { named, shortlist: list, any: !!(named.length || list.length) };
}

/* opts: { host, ballotHost, sec, note, rpc, league, photos, data? }
   data, when given, is a probe() result and nothing is fetched. */
async function mount(o) {
  const sec = o.sec;
  if (!sec) return;
  const found = o.data || await probe(o);
  if (!found.any) return false;              // no ballot, no section
  return render(Object.assign({}, o, { data: found }));
}

function render(o) {
  const sec = o.sec;
  if (!sec) return false;
  const named = o.data.named, shortlist = o.data.shortlist;

  sec.classList.remove('hide');
  const head = o.head, note = o.note;
  const title = (named[0] && named[0].title) || (shortlist[0] && shortlist[0].title)
              || 'Team of the Year';
  if (head) head.textContent = title;

  /* ---- the team, once it is published ---- */
  const host = o.host;
  host.textContent = '';
  if (named.length) {
    if (note) note.textContent = named.length + ' selected';
    const grid = el('div', 'toty-grid');
    named.forEach(r => grid.appendChild(card(r, title, o.photos)));
    host.appendChild(grid);
  } else if (note) {
    note.textContent = 'voting open';
  }

  /* ---- the ballot, while it is open ---- */
  const bh = o.ballotHost;
  bh.textContent = '';
  const open = shortlist.length && shortlist[0].status === 'open';
  if (!open) return true;

  const slots = shortlist[0].slots || 5;
  const closes = shortlist[0].closes_at ? new Date(shortlist[0].closes_at) : null;

  const wrap = el('div', 'bl');
  wrap.appendChild(el('h3', 'bl-h', 'Vote for your ' + title));
  wrap.appendChild(el('p', 'bl-s',
    'Pick ' + slots + '. Your vote is counted alongside the league’s own ' +
    'officials, who vote separately' +
    (closes ? ' — voting closes ' + closes.toLocaleDateString(undefined,
      { day: 'numeric', month: 'long' }) : '') + '.'));

  const picked = new Set();
  const grid = el('div', 'bl-grid');
  shortlist.forEach(c => {
    const b = el('button', 'bl-pick');
    b.type = 'button';
    const dot = el('span', 'bl-dot');
    dot.style.background = c.team_colour || 'var(--rule-2)';
    const who = el('span', 'bl-nm', c.player_name);
    b.append(dot, who, el('span', 'bl-tm', c.team_name || ''));
    b.addEventListener('click', () => {
      if (picked.has(c.player_id)) picked.delete(c.player_id);
      /* A full ballot does not silently swap somebody out. Saying it is full
         is the honest answer; quietly dropping the first pick to make room is
         how a voter ends up with a ballot they did not cast. */
      else if (picked.size >= slots) return msg('That is ' + slots + ' already — ' +
        'tap one to take it off first.', 'err');
      else picked.add(c.player_id);
      b.classList.toggle('on', picked.has(c.player_id));
      count.textContent = picked.size + ' of ' + slots + ' chosen';
      msg('');
    });
    grid.appendChild(b);
  });
  wrap.appendChild(grid);

  const bar = el('div', 'bl-bar');
  const send = el('button', 'ep-btn pri', 'cast my vote');
  send.type = 'button';
  const count = el('span', 'bl-count', '0 of ' + slots + ' chosen');
  bar.append(send, count);
  wrap.appendChild(bar);
  const m = el('div', 'bl-msg');
  wrap.appendChild(m);
  bh.appendChild(wrap);

  function msg(t, k) { m.textContent = t || ''; m.className = 'bl-msg ' + (k || ''); }

  send.addEventListener('click', async () => {
    if (!picked.size) return msg('Pick somebody first.', 'err');
    send.disabled = true;
    try {
      const out = await o.rpc('cast_toty_vote', {
        p_ballot: shortlist[0].ballot_id,
        p_players: [...picked],
        p_voter: voterKey()
      });
      msg(typeof out === 'string' ? out : 'Thank you — your vote is in.', 'ok');
      send.textContent = 'change my vote';
    } catch (e) {
      msg(e.message || 'That was refused.', 'err');
    }
    send.disabled = false;
  });
  return true;
}

/* One card, deliberately the same object as a star card. */
function card(r, award, photos) {
  const ink = r.team_colour || '#93f2bf';
  const a = el('a', 'club toty');
  a.href = 'p/?p=' + encodeURIComponent(r.player_slug || '');
  a.style.setProperty('--ink-c', ink);
  a.setAttribute('aria-label', r.player_name + ', ' + (r.team_name || ''));

  const plate = el('div', 'club-plate');
  plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

  const photo = photos && photos[r.player_id];
  if (photo) {
    const img = el('img', 'club-photo');
    img.src = photo; img.alt = ''; img.loading = 'lazy';
    plate.appendChild(img);
  }

  plate.appendChild(el('div', 'toty-ribbon', award));

  const mark = el('div', 'club-mark');
  const initials = (r.player_name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2);
  mark.append(el('span', 'club-mono ghost', initials), el('span', 'club-mono', initials));
  plate.appendChild(mark);
  plate.appendChild(el('div', 'club-grain'));

  const foot = el('div', 'club-foot star-foot');
  const who = el('div', 'star-who');
  who.append(el('span', 'star-name', r.player_name),
             el('span', 'star-team', r.team_name || ''));
  foot.appendChild(who);
  a.append(plate, foot);
  return a;
}

return { mount, probe, render, voterKey };
}));
