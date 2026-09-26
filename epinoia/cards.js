'use strict';
/* ============================================================================
   COLLAPSIBLE CARDS (kit/cards.css), shared by the player profile's league percentile
   bars and the club page's team statistics.

     EpinoiaCards.collapsible({ key, title, summary, note, open, sub, body, doc })
       one card: a header button (title, an optional summary chip, a chevron) over a body
       that folds away. `key` remembers, in this browser, whether the reader left it open
       or shut (localStorage, wrapped: private mode simply means it opens the default way).
       `sub` is the quieter nested form. `body` is a node, or a function that returns one
       (called once, the first time the card is open, so a shut card draws nothing).
     EpinoiaCards.setAll(root, open)     open or shut every card under root
     EpinoiaCards.mean(rows, key)        the field's average for a statistic (null under 3 values)
     EpinoiaCards.delta(v, avg, low, dp) how far a value sits above / below that average, and whether
                                         that is good news (a lower-is-better statistic below average is)

   The card wears the page's club colours through --team-a / --team-b, which both pages
   set (teamcolour.js); with no club colours they are the site's own mint and aqua.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaCards = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const PREFIX = 'epinoia_card_';
function recall(key) {
  try { return localStorage.getItem(PREFIX + key); } catch (_) { return null; }
}
function remember(key, open) {
  try { localStorage.setItem(PREFIX + key, open ? '1' : '0'); } catch (_) { /* private mode: it opens the default way */ }
}

let seq = 0;

function collapsible(o) {
  const doc = o.doc || document;
  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const kept = o.key ? recall(o.key) : null;
  let open = kept === '1' ? true : kept === '0' ? false : o.open !== false;

  const card = mk('section', 'xc' + (o.sub ? ' sub' : '') + (o.cls ? ' ' + o.cls : ''));
  const id = 'xc' + (++seq);
  const head = mk('button', 'xc-h');
  head.type = 'button';
  head.setAttribute('aria-controls', id);
  head.appendChild(mk('span', 'xc-t', o.title));
  if (o.note) head.appendChild(mk('span', 'xc-n', o.note));
  const grow = mk('span', 'xc-g');
  head.appendChild(grow);
  if (o.summary) head.appendChild(mk('span', 'xc-s', o.summary));
  head.appendChild(mk('span', 'xc-c'));                      // the chevron, drawn in CSS

  const wrap = mk('div', 'xc-b');
  wrap.id = id;
  const inner = mk('div', 'xc-bi');
  wrap.appendChild(inner);
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    const b = typeof o.body === 'function' ? o.body() : o.body;
    if (b) inner.appendChild(b);
  };

  const paint = () => {
    card.classList.toggle('shut', !open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { wrap.removeAttribute('inert'); build(); } else wrap.setAttribute('inert', '');
  };
  head.addEventListener('click', () => {
    open = !open;
    if (o.key) remember(o.key, open);
    paint();
    if (typeof o.onToggle === 'function') o.onToggle(open);
  });
  card.append(head, wrap);
  card._open = v => { if (v === open) return; open = v; if (o.key) remember(o.key, open); paint(); };
  paint();
  return card;
}

/* every card under `root`, open or shut, remembered like a click */
function setAll(rootNode, open) {
  if (!rootNode || !rootNode.querySelectorAll) return;
  /* twice: opening a card draws its body, which is where its own folds are */
  for (let pass = 0; pass < 2; pass++) {
    rootNode.querySelectorAll('.xc').forEach(c => { if (typeof c._open === 'function') c._open(open); });
  }
}

/* the field's average for one statistic: the same values the percentile ranks over */
function mean(rows, key) {
  let n = 0, s = 0;
  (rows || []).forEach(r => {
    const v = r && r[key];
    if (v != null && isFinite(v)) { n++; s += Number(v); }
  });
  return n >= 3 ? s / n : null;
}

/* HOW FAR ABOVE OR BELOW THE LEAGUE AVERAGE, in the statistic's own units, and whether that is a good thing.
   `low` marks a statistic where a smaller number is the better performance: a turnover rate below the average
   is a strength, so it is "below" in the words and "good" in the colour. A gap that rounds to nothing at the
   figure's own precision is "level", not a +0.0. */
function delta(v, avg, low, dp) {
  if (v == null || avg == null || !isFinite(v) || !isFinite(avg)) return null;
  const places = dp == null ? 1 : dp;
  const d = Number(v) - avg;
  const shown = Number(Math.abs(d).toFixed(places));
  if (shown === 0) return { d: 0, dir: 'level', tone: 'level', text: 'level with league average', avg };
  const above = d > 0;
  return {
    d, dir: above ? 'above' : 'below',
    tone: (low ? !above : above) ? 'good' : 'bad',
    text: (above ? '+' : '-') + shown.toFixed(places) + ' ' + (above ? 'above' : 'below') + ' league avg',
    avg
  };
}

return { collapsible, setAll, mean, delta, _test: { recall, remember, PREFIX } };
}));
