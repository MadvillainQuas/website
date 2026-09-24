'use strict';
/* ============================================================================
   FANS' PHOTOGRAPHS - the platform console's queue for EPINOIA GO's "Games been to" (migration 0167).

   Every photograph a fan posts waits here before it can go on the wall (D7), and so does any approved one
   that three fans reported. For each: the picture (a short-lived signed link while it is private), who
   posted it, where, and the caption. Approve moves its two files from the fan's private folder to their
   public names (p/<photo id>: nothing in a public address says whose it is) and then records the decision;
   reject records it and then removes the files.

   The order matters both ways, as in the clubs' media queue (platform.js): a file is public only once it
   has been moved, so the row may say "approved" only after the move; and a rejection must stand even if
   removing the file fails, because the private folder is served to nobody.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGoPhotosUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

async function src(sb, p) {
  if (p.status === 'hidden') {
    const { data: d } = sb.storage.from('go-public').getPublicUrl(p.thumb_path);
    return d && d.publicUrl;
  }
  const { data: d } = await sb.storage.from('go-pending').createSignedUrl(p.thumb_path, 900);
  return d && d.signedUrl;
}

async function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const { sb, say, oops } = o;
  host.setAttribute('data-i18n-ctx', 'gophotos');
  host.textContent = '';
  const { data: rows, error } = await sb.rpc('go_photo_queue', { p_limit: 100 });
  if (error) {
    if (error.code === 'PGRST202' || /schema cache/i.test(error.message || '')) {
      host.appendChild(el('div', 'empty', 'Not on the server yet: migration 0167 needs pushing.'));
      return;
    }
    return oops(error);
  }
  sweep(o, host);
  if (!rows || !rows.length) {
    host.appendChild(el('div', 'empty', 'Nothing waiting. Every fan photograph has been dealt with.'));
    return;
  }
  const grid = host.appendChild(el('div', 'gq-grid'));
  rows.forEach(p => {
    const card = grid.appendChild(el('div', 'gq-card' + (p.status === 'hidden' ? ' gq-hidden' : '')));
    const img = card.appendChild(el('img', 'gq-img'));
    img.alt = '';
    src(sb, p).then(u => { if (u) img.src = u; });
    const t = card.appendChild(el('div', 'gq-txt'));
    if (p.status === 'hidden') {
      const h = t.appendChild(el('div', 'pill off'));
      h.appendChild(el('span', null, 'taken down after reports'));
      h.appendChild(document.createTextNode(': '));
      h.appendChild(data('span', null, String(p.reports)));
    }
    t.appendChild(data('div', 'nm', '@' + (p.username || '—')));
    t.appendChild(data('div', 'mt', [p.venue, p.league].filter(Boolean).join(' · ')));
    if (p.home || p.away) t.appendChild(data('div', 'mt', (p.home || '—') + ' v ' + (p.away || '—')));
    if (p.caption) t.appendChild(data('div', 'gq-cap', '“' + p.caption + '”'));
    const acts = card.appendChild(el('div', 'row'));
    const ok = acts.appendChild(el('button', 'ep-btn mini pri', 'approve'));
    ok.type = 'button';
    ok.addEventListener('click', () => approve(o, p, ok));
    const no = acts.appendChild(el('button', 'ep-btn mini danger', 'reject'));
    no.type = 'button';
    no.addEventListener('click', () => reject(o, p, no));
  });
}

/* FILES LEFT BEHIND (0167's go_photo_trash_list): a photograph's row went - an account erased, most often -
   and its files may still be in a bucket, an approved one's in public; or a fan's upload never became a
   photograph (the connection went between sending the files and posting). Offered here, removed on a click. */
async function sweep(o, host) {
  const { sb, say, oops } = o;
  const { data: left, error } = await sb.rpc('go_photo_trash_list', { p_limit: 500 });
  if (error || !left || !left.length) return;
  const line = el('div', 'row gq-trash');
  host.insertBefore(line, host.firstChild);
  const t = line.appendChild(el('span', 'mt'));
  t.appendChild(el('span', null, 'Photograph files left behind'));
  t.appendChild(document.createTextNode(': '));
  t.appendChild(data('b', null, String(left.length)));
  const go = line.appendChild(el('button', 'ep-btn mini danger', 'remove them'));
  go.type = 'button';
  go.addEventListener('click', async () => {
    go.disabled = true;
    const done = [];
    for (const bucket of ['go-pending', 'go-public']) {
      const paths = left.filter(x => x.bucket === bucket).map(x => x.path);
      if (!paths.length) continue;
      const r = await sb.storage.from(bucket).remove(paths);
      // a file already gone is gone: only a refusal keeps a name on the list
      if (!r.error || /not found|does not exist/i.test(r.error.message || '')) done.push(...paths);
    }
    const { error: e2 } = await sb.rpc('go_photo_trash_done', { p_paths: done });
    go.disabled = false;
    if (e2) return oops(e2);
    say(done.length === left.length ? 'Removed.' : 'Some files could not be removed; they stay on the list.', done.length === left.length ? 'ok' : 'err');
    mount(o);
  });
}

async function approve(o, p, btn) {
  const { sb, say, oops } = o;
  btn.disabled = true;
  if (p.status === 'pending') {
    // the files move first, to their public names; only then may the row say approved
    const U = window.EpinoiaUpload;
    if (!U || !U.publishPending) { btn.disabled = false; return say('upload.js did not load. Reload the page.', 'err'); }
    for (const [from, to] of [[p.path, p.public_path], [p.thumb_path, p.public_thumb]]) {
      const r = await U.publishPending(sb, from, { from: 'go-pending', to: 'go-public', toPath: to });
      if (!r.ok) { btn.disabled = false; return say('Could not publish the file: ' + r.error.message, 'err'); }
    }
  }
  const { data: r, error } = await sb.rpc('approve_go_photo', { p_photo: p.id });
  btn.disabled = false;
  if (error) return oops(error);
  if (!r || !r.ok) return say('That photograph was already dealt with.', 'err');
  say('Approved: it is on the wall.', 'ok');
  mount(o);
}

async function reject(o, p, btn) {
  const { sb, say, oops } = o;
  const why = window.prompt('Why is it not going up? (optional, shown to the fan)', '');
  if (why === null) return;
  btn.disabled = true;
  // the decision first: the files are private (or come down next), so a failed removal leaves nothing public
  const { data: r, error } = await sb.rpc('reject_go_photo', { p_photo: p.id, p_reason: why });
  if (error) { btn.disabled = false; return oops(error); }
  if (!r || !r.ok) { btn.disabled = false; return say('That photograph was already dealt with.', 'err'); }
  const gone = await sb.storage.from(r.bucket).remove([r.path, r.thumb_path]);
  btn.disabled = false;
  say(gone && gone.error ? 'Rejected, but the file could not be removed: ' + gone.error.message : 'Rejected.',
      gone && gone.error ? 'err' : 'ok');
  mount(o);
}

return { mount };
}));
