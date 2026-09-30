'use strict';
/* ============================================================================
   SUGGESTED EDITS - the moderators' queue (0199), in a league's console and in the platform's.

   Fans suggest corrections to what only a club, a league or the platform may change (suggest.js): a
   player's name, height, weight, wingspan, position or previous club, the coaching staff, an arena's name,
   address, city and place on the map. Each waits here with who or what it is about, what it says now and
   what the fan suggests, their note and source, and how many other fans said the same - fans saying the
   same thing are one row, and are decided together.

   ACCEPT makes the change: the value as suggested, or as the moderator corrects it in the box (checked
   again by the database either way). REJECT leaves everything as it was. Either way the fan is told, with
   the note if one is written. A suggested photograph or crest is decided in Photographs, with every other
   upload, and is only counted here.

     mount({ host, sb, league: () => league | null, say, base })
       league() null: the platform's queue, every league's (the platform's administrators alone)
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSuggestionsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const when = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
/* the details whose value a moderator may correct before it goes in (a new member of staff is taken as
   suggested, and "no longer with the club" has no value) */
const CORRECTABLE = f => f !== 'staff_add' && f !== 'staff_remove';
const WHY = {
  value: 'That value does not pass the checks for this detail.',
  withheld: 'This player is under 18: their details are the league’s alone.',
  photographs: 'A picture is decided in Photographs.',
  note: 'The note is too long: 400 characters at most.',
  not_found: 'That suggestion is no longer there.'
};

async function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const say = o.say || (() => {});
  const base = o.base || '../';
  const lg = typeof o.league === 'function' ? o.league() : o.league;
  host.setAttribute('data-i18n-ctx', 'suggestions');
  host.textContent = '';
  if (o.league !== undefined && o.league !== null && !lg) return;     // a league's console before its league is chosen

  const { data: q, error } = await o.sb.rpc('suggestions_queue', { p_league: lg ? lg.id : null });
  if (error) {
    const missing = error.code === 'PGRST202' || /schema cache|does not exist/i.test(error.message || '');
    host.appendChild(el('div', 'empty', missing ? 'Not on the server yet: migration 0199 needs pushing.'
                                                : (error.message || 'The queue could not be read.')));
    return;
  }
  const items = (q && q.items) || [];
  const photos = Number(q && q.photos) || 0;

  const top = host.appendChild(el('div', 'sgq-top'));
  const count = top.appendChild(el('span', 'sgq-n'));
  const paintCount = () => { count.textContent = items.length ? items.length + ' waiting' : 'nothing waiting'; };
  if (photos) {
    top.appendChild(el('span', 'sgq-ph', photos === 1 ? '1 suggested picture waits in Photographs'
                                                      : photos + ' suggested pictures wait in Photographs'));
  }
  const again = top.appendChild(el('button', 'ep-btn mini', 'refresh'));
  again.type = 'button';
  again.addEventListener('click', () => mount(o));
  paintCount();

  if (!items.length) {
    host.appendChild(el('div', 'empty',
      'No suggestions are waiting. When a fan suggests a correction to a player, the staff or an arena, it waits here.'));
    return;
  }
  const list = host.appendChild(el('div', 'sgq-list'));
  items.forEach(it => list.appendChild(card(it)));

  function card(it) {
    const c = el('div', 'sgq');
    const h = c.appendChild(el('div', 'sgq-h'));
    const subj = h.appendChild(data(it.link ? 'a' : 'span', 'sgq-subj', it.subject || '(gone)'));
    if (it.link) { subj.href = base + it.link; subj.target = '_blank'; subj.rel = 'noopener'; }
    h.appendChild(el('span', 'sgq-f', it.label || it.field));
    if (!lg && it.league && it.league.name) h.appendChild(data('span', 'sgq-lg', it.league.name));

    /* now -> suggested */
    const ch = c.appendChild(el('div', 'sgq-ch'));
    if (it.field === 'staff_add') {
      ch.appendChild(el('span', 'sgq-k', 'add'));
      ch.appendChild(data('span', 'sgq-to', it.value));
    } else if (it.field === 'staff_remove') {
      if (it.current) ch.appendChild(data('span', 'sgq-from', it.current));
      ch.appendChild(el('span', 'sgq-arrow', '\u2192'));
      ch.appendChild(el('span', 'sgq-to', 'leaves the club'));
    } else {
      ch.appendChild(it.current ? data('span', 'sgq-from', it.current) : el('span', 'sgq-from none', 'not set'));
      ch.appendChild(el('span', 'sgq-arrow', '→'));
      ch.appendChild(data('span', 'sgq-to', it.value));
    }
    if (it.note) c.appendChild(data('p', 'sgq-note', '“' + it.note + '”'));
    const meta = c.appendChild(el('div', 'sgq-meta'));
    meta.appendChild(data('span', null, it.by ? '@' + it.by : 'a fan'));
    meta.appendChild(el('span', null, when(it.created_at)));
    if (it.agree) meta.appendChild(el('span', 'sgq-agree', it.agree === 1 ? '+1 other fan agrees' : '+' + it.agree + ' other fans agree'));
    if (it.source && /^https?:\/\//i.test(it.source)) {
      const a = meta.appendChild(el('a', null, 'source ↗'));
      a.href = it.source; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow ugc';
      a.title = it.source;
    }

    const acts = c.appendChild(el('div', 'sgq-acts'));
    let val = null;
    if (CORRECTABLE(it.field)) {
      val = acts.appendChild(el('input', 'ep-input sgq-val'));
      val.value = it.value; val.maxLength = 200;
      val.setAttribute('aria-label', 'The value to put in: correct it first if needed');
      val.title = 'The value to put in: correct it first if needed';
    }
    const note = acts.appendChild(el('input', 'ep-input sgq-why'));
    note.maxLength = 400; note.placeholder = 'a note to the fan (optional)';
    note.setAttribute('aria-label', 'A note to the fan (optional)');
    const ok = acts.appendChild(el('button', 'ep-btn mini pri', 'accept')); ok.type = 'button';
    const no = acts.appendChild(el('button', 'ep-btn mini dgr', 'reject')); no.type = 'button';

    const decide = async accept => {
      ok.disabled = no.disabled = true;
      const typed = val ? val.value.replace(/\s+/g, ' ').trim() : '';
      const { data: r, error: e } = await o.sb.rpc('decide_suggestion', {
        p_id: it.id, p_accept: accept, p_note: note.value.trim() || null,
        p_value: accept && val && typed && typed !== it.value ? typed : null });
      if (e || !r || r.ok === false) {
        ok.disabled = no.disabled = false;
        const why = r && r.reason;
        if (why === 'decided') { gone(); return say('Already decided (' + (r.status || 'decided') + ').', 'err'); }
        return say((e && e.message) || WHY[why] || 'That did not go through.', 'err');
      }
      gone();
      say((accept ? 'accepted — ' : 'rejected — ') + (it.subject || '') + ': ' + (it.label || it.field) +
          (accept && it.field !== 'staff_remove' ? ' → ' + (r.value || it.value) : ''), 'ok');
    };
    const gone = () => {
      c.remove();
      const i = items.indexOf(it);
      if (i >= 0) items.splice(i, 1);
      paintCount();
      if (!items.length) list.appendChild(el('div', 'empty', 'Nothing more waiting.'));
    };
    ok.addEventListener('click', () => decide(true));
    no.addEventListener('click', () => decide(false));
    return c;
  }
}

/* A PHOTOGRAPHS ROW THAT CAME FROM A FAN (its file is named suggested-…): the consoles mark it, with the fan's
   note, name and source - read once per drawing of the queue (photoNotes: media id -> note) - so a picture
   is judged with what the fan said about it. */
const isSuggested = path => /\/suggested-[a-z0-9]+\.(webp|jpe?g|png)$/i.test(String(path || ''));
async function photoNotes(sb, leagueId) {
  const m = new Map();
  try {
    const { data: q } = await sb.rpc('suggestions_queue', { p_league: leagueId || null });
    ((q && q.photo_notes) || []).forEach(n => m.set(String(n.media), n));
  } catch (_) { /* marked without the note */ }
  return m;
}
function fanLine(n) {
  const d = el('div', 'mt sgq-fan');
  d.setAttribute('data-i18n-ctx', 'suggestions');
  d.appendChild(el('span', 'sgq-fan-k', 'suggested by a fan'));
  if (n && n.by) d.appendChild(data('span', null, '@' + n.by));
  if (n && n.note) d.appendChild(data('span', 'sgq-fan-note', '\u201c' + n.note + '\u201d'));
  if (n && n.source && /^https?:\/\//i.test(n.source)) {
    const a = d.appendChild(el('a', null, 'source \u2197'));
    a.href = n.source; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow ugc';
  }
  return d;
}

return { mount, isSuggested, photoNotes, fanLine };
}));
