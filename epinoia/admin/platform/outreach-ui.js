'use strict';
/* ============================================================================
   OUTREACH (platform console, migration 0276) - the clubs on the platform, each with the contact address it publishes
   itself, for pitching the analytics report subscription by hand (Louie, 2026-10-16: "store on site on platform ready
   to select via tickbox which ones to therefore use its email template to then send on my own email address to the
   chosen recipient").

     THE CLUBS     every club with its address (an organisational one the club publishes: info@, office@,
                   commercial@ ... never a person's), where it was read, its leagues and country, and where it stands:
                   new, ready, sent, replied, interested, declined, do not contact, bounced. Filters by league, country,
                   state, and words; a tickbox each.
     THE PITCH     one template: a subject, the letter and the sign-off, with merge fields - {{club}}, {{league}},
                   {{club_page}} (its page on EPINOIA), {{hook}} (its season so far, from the table), {{country}},
                   {{website}} - kept in the database (outreach_templates).
     WRITE         for the ticked clubs, each letter in the EPINOIA email dress (scripts/report_mailer.mjs layout),
                   and the ways to send it from your own address: Open in Gmail (the recipient and subject filled in,
                   the styled letter copied to paste in), Copy the styled letter, Download as an email file (.eml,
                   opens as a draft in Outlook or Apple Mail). Then Mark as sent.
     IMPORT        a researched contacts file (outreach-import.json): new clubs added, known ones refreshed, never
                   their state (outreach_import).

   NOTHING IS SENT FROM HERE. Every letter leaves from the owner's own email, by his hand. A country whose law wants
   consent before a commercial email, even to a business, wears a CONSENT FIRST flag.

     window.EpinoiaOutreachUI.mount({ host, sb, say, oops })
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaOutreachUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const SITE = 'https://prophesyscouting.co.uk';
const STATES = [['new', 'New'], ['ready', 'Ready'], ['sent', 'Sent'], ['replied', 'Replied'], ['interested', 'Interested'],
  ['declined', 'Declined'], ['do_not_contact', 'Do not contact'], ['bounced', 'Bounced']];
/* rules of thumb, not legal advice: where a commercial email to a business still wants the recipient's consent first */
const CONSENT = {
  CA: 'Canada (CASL): express or implied consent needed before a commercial email, business addresses included.',
  DE: 'Germany (UWG): consent generally needed for advertising email, businesses included.',
  AT: 'Austria (TKG): prior consent needed for direct-marketing email.',
  IT: 'Italy: the regulator expects consent for marketing email, businesses included.',
  ES: 'Spain (LSSI): consent needed unless there is an existing relationship.',
  PL: 'Poland: consent needed for commercial information by email.',
  PT: 'Portugal: consent generally needed for marketing email.'
};
const COUNTRY = { GB: 'United Kingdom', IE: 'Ireland', ES: 'Spain', FR: 'France', DE: 'Germany', IT: 'Italy', AU: 'Australia', AR: 'Argentina',
  JP: 'Japan', CA: 'Canada', CH: 'Switzerland', CZ: 'Czechia', FI: 'Finland', AT: 'Austria', PL: 'Poland', LT: 'Lithuania', MX: 'Mexico',
  HU: 'Hungary', RO: 'Romania', BR: 'Brazil', SE: 'Sweden', DK: 'Denmark', GR: 'Greece', AL: 'Albania', BG: 'Bulgaria', IL: 'Israel',
  SK: 'Slovakia', MK: 'North Macedonia', KR: 'South Korea', AZ: 'Azerbaijan', XK: 'Kosovo', EU: 'Europe-wide', 'BE+NL': 'Belgium / Netherlands',
  'EE+LV': 'Estonia / Latvia', XB: 'Balkans', PT: 'Portugal', US: 'United States' };

/* ------------------------------------------------------------------ the letter --- */
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function merge(text, f) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (f[k] != null ? String(f[k]) : ''));
}
/* a club's colour as ink on white (report_mailer.mjs inkOn) */
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#08603f';
  const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = x => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
  for (let t = 0; t <= 1.0001; t += 0.05) { const x = c.map(v => Math.round(v * (1 - t))); if (1.05 / (L(x) + 0.05) >= 4.5) return '#' + x.map(v => v.toString(16).padStart(2, '0')).join(''); }
  return '#0d1f17';
}
const F = 'font-family:Arial,Helvetica,sans-serif;';
/* words to paragraphs, its addresses as links (escaped first: nothing in a template is markup) */
function paras(text) {
  return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => '<p style="margin:0 0 14px">' +
    esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#0d1f17;font-weight:bold">$1</a>') + '</p>');
}
/* THE EPINOIA EMAIL (scripts/report_mailer.mjs layout, the same dress): the bar, a band in the club's colour, the kicker
   and the headline, the letter, the sign-off, and the foot */
function letterHTML(o) {
  const colour = /^#[0-9a-f]{6}$/i.test(o.colour || '') ? o.colour : '#08603f';
  const ink = inkOn(colour);
  const blocks = paras(o.body);
  const signoff = esc(o.signoff || '').replace(/\n/g, '<br>');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#eef2ef">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ef"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">' +
      '<tr><td style="background:#0d1f17;padding:18px 28px;' + F + 'font-size:15px;font-weight:bold;letter-spacing:.32em;color:#ffffff">EPINOIA</td></tr>' +
      '<tr><td style="height:6px;line-height:6px;font-size:0;background:' + colour + '">&nbsp;</td></tr>' +
      '<tr><td style="padding:26px 28px 6px">' +
        '<div style="' + F + 'font-size:11px;font-weight:bold;letter-spacing:.16em;text-transform:uppercase;color:' + ink + '">' + esc(o.kicker) + '</div>' +
        '<div style="' + F + 'font-size:24px;font-weight:bold;line-height:1.25;color:#0d1f17;margin-top:6px">' + esc(o.title) + '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:14px 28px 4px;' + F + 'font-size:15px;line-height:1.6;color:#0d1f17">' + blocks.join('') +
        (signoff ? '<p style="margin:18px 0 0">' + signoff + '</p>' : '') +
      '</td></tr>' +
      '<tr><td style="padding:18px 28px 24px;' + F + 'font-size:12px;line-height:1.5;color:#7a8a82;border-top:1px solid #e4ebe7">' +
        esc(o.foot || '') + ' <a href="' + SITE + '/epinoia/" style="color:#0d1f17;font-weight:bold">EPINOIA</a>' +
      '</td></tr>' +
    '</table></td></tr></table></body></html>';
}
function letterText(o) {
  return merge(o.body, {}).trim() + '\n\n' + (o.signoff || '').trim() + '\n\n--\n' + (o.foot || '') + ' ' + SITE + '/epinoia/';
}
/* an email file a mail program opens as a draft: the recipient, the subject, the plain words and the styled ones */
function emlOf(to, subject, text, html) {
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/.{76}/g, '$&\r\n');
  const B = 'epinoia-' + Math.random().toString(36).slice(2);
  return ['To: ' + to, 'Subject: =?UTF-8?B?' + btoa(unescape(encodeURIComponent(subject))) + '?=', 'X-Unsent: 1', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + B + '"', '', '--' + B, 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', b64(text), '--' + B, 'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', b64(html), '--' + B + '--', ''].join('\r\n');
}

/* ------------------------------------------------------------------ the tab --- */
function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host || host.dataset.mounted) return;
  host.dataset.mounted = '1';
  const sb = o.sb, say = o.say || (() => {}), oops = o.oops || (e => say(String((e && e.message) || e), 'err'));
  const S = { rows: [], leagues: new Map(), tpl: null, picked: new Set(), shown: 200, f: { q: '', country: '', league: '', status: 'open', email: true } };

  host.textContent = '';
  const head = host.appendChild(el('div', 'or-head'));
  head.appendChild(el('p', 'or-note', 'The clubs on the platform, each with the contact address it publishes. Tick the ones to write to, ' +
    'then send each letter from your own email. Nothing is sent from here.'));
  const counts = head.appendChild(el('div', 'or-counts'));
  const tools = host.appendChild(el('div', 'or-tools'));
  const tplBox = host.appendChild(el('details', 'or-tpl'));
  const listBox = host.appendChild(el('div', 'or-list'));
  const writeBox = host.appendChild(el('div', 'or-write'));

  const missing = e => /does not exist|PGRST20[25]|42P01|Could not find/i.test(((e && e.code) || '') + ' ' + ((e && e.message) || ''));

  async function load() {
    listBox.textContent = '';
    listBox.appendChild(el('p', 'or-note', 'Reading the clubs…'));
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('outreach_contacts').select('*').order('country').order('club_name').range(from, from + 999);
      if (error) {
        listBox.textContent = '';
        listBox.appendChild(el('p', 'or-note', missing(error) ? 'Outreach needs migration 0276 on the database (npx supabase@latest db push).' : 'The clubs could not be read: ' + error.message));
        return;
      }
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    S.rows = all;
    if (!S.leagues.size) {
      const { data } = await sb.from('leagues').select('slug,name,country,colour_a');
      (data || []).forEach(l => S.leagues.set(l.slug, l));
    }
    if (!S.tpl) {
      const { data } = await sb.from('outreach_templates').select('*').eq('name', 'default').maybeSingle();
      S.tpl = data || { name: 'default', subject: '', body: '', signoff: '' };
      drawTemplate();
    }
    drawTools(); draw();
  }

  /* ---------------------------------------------------------------- filters --- */
  function drawTools() {
    tools.textContent = '';
    const q = tools.appendChild(el('input', 'ep-input or-q'));
    q.type = 'search'; q.placeholder = 'Club, address or league'; q.value = S.f.q;
    q.addEventListener('input', () => { S.f.q = q.value; S.shown = 200; draw(); });
    const sel = (label, opts, key) => {
      const s = tools.appendChild(el('select', 'ep-input'));
      s.setAttribute('aria-label', label);
      opts.forEach(([v, t]) => { const op = s.appendChild(el('option', null, t)); op.value = v; });
      s.value = S.f[key];
      s.addEventListener('change', () => { S.f[key] = s.value; S.shown = 200; draw(); });
    };
    const countries = [...new Set(S.rows.map(r => r.country).filter(Boolean))].sort((a, b) => (COUNTRY[a] || a).localeCompare(COUNTRY[b] || b));
    sel('Country', [['', 'Every country']].concat(countries.map(c => [c, (COUNTRY[c] || c) + (CONSENT[c] ? ' · consent first' : '')])), 'country');
    const lgs = [...new Set(S.rows.flatMap(r => r.league_slugs || []))].map(s => [s, (S.leagues.get(s) || {}).name || s]).sort((a, b) => a[1].localeCompare(b[1]));
    sel('League', [['', 'Every league']].concat(lgs), 'league');
    sel('State', [['open', 'Not yet written to'], ['', 'Every state']].concat(STATES), 'status');
    const em = tools.appendChild(el('label', 'or-chk'));
    const c = em.appendChild(el('input')); c.type = 'checkbox'; c.checked = S.f.email;
    em.append(' With an address');
    c.addEventListener('change', () => { S.f.email = c.checked; draw(); });
    const imp = tools.appendChild(el('label', 'ep-btn mini or-imp', 'Import contacts'));
    const f = imp.appendChild(el('input')); f.type = 'file'; f.accept = '.json,application/json'; f.hidden = true;
    f.addEventListener('change', () => { if (f.files && f.files[0]) importFile(f.files[0]); f.value = ''; });
  }
  function visible() {
    const q = S.f.q.trim().toLowerCase();
    return S.rows.filter(r => (!S.f.country || r.country === S.f.country)
      && (!S.f.league || (r.league_slugs || []).includes(S.f.league))
      && (S.f.status === '' || (S.f.status === 'open' ? ['new', 'ready'].includes(r.status) : r.status === S.f.status))
      && (!S.f.email || r.email)
      && (!q || (r.club_name + ' ' + r.email + ' ' + (r.league_slugs || []).map(s => (S.leagues.get(s) || {}).name || s).join(' ')).toLowerCase().includes(q)));
  }

  /* ---------------------------------------------------------------- the clubs --- */
  function draw() {
    const byState = {};
    S.rows.forEach(r => { byState[r.status] = (byState[r.status] || 0) + 1; });
    counts.textContent = '';
    counts.appendChild(el('span', null, S.rows.length + ' addresses · ' + new Set(S.rows.map(r => r.club_key)).size + ' clubs'));
    STATES.forEach(([k, t]) => { if (byState[k]) counts.appendChild(el('span', 'or-pill or-' + k, t + ' ' + byState[k])); });
    const rows = visible();
    listBox.textContent = '';
    if (!S.rows.length) { listBox.appendChild(el('p', 'or-note', 'No clubs yet: import the researched contacts file (outreach-import.json) above.')); drawWrite(); return; }
    const bar = listBox.appendChild(el('div', 'or-bar'));
    const all = bar.appendChild(el('label', 'or-chk'));
    const ca = all.appendChild(el('input')); ca.type = 'checkbox';
    const shown = rows.slice(0, S.shown);
    ca.checked = shown.length && shown.every(r => S.picked.has(r.id));
    all.append(' Tick all ' + shown.length + ' shown');
    ca.addEventListener('change', () => { shown.forEach(r => (ca.checked ? S.picked.add(r.id) : S.picked.delete(r.id))); draw(); });
    bar.appendChild(el('span', 'or-note', rows.length + ' match · ' + S.picked.size + ' ticked'));
    const mk = (label, st) => { const b = bar.appendChild(el('button', 'ep-btn mini', label)); b.type = 'button'; b.disabled = !S.picked.size; b.addEventListener('click', () => setState([...S.picked], st)); };
    mk('Mark ticked: ready', 'ready'); mk('Do not contact', 'do_not_contact');
    const tbl = listBox.appendChild(el('table', 'or-tbl'));
    const hr = tbl.createTHead().insertRow();
    ['', 'Club', 'Country', 'Address', 'Read at', 'State'].forEach(h => hr.appendChild(el('th', null, h)));
    const tb = tbl.createTBody();
    shown.forEach(r => {
      const tr = tb.insertRow();
      const c0 = tr.insertCell();
      const cb = c0.appendChild(el('input')); cb.type = 'checkbox'; cb.checked = S.picked.has(r.id);
      cb.setAttribute('aria-label', 'Tick ' + r.club_name);
      cb.addEventListener('change', () => { if (cb.checked) S.picked.add(r.id); else S.picked.delete(r.id); bar.querySelector('.or-note').textContent = rows.length + ' match · ' + S.picked.size + ' ticked'; drawWrite(); });
      const c1 = tr.insertCell();
      const nm = c1.appendChild(el('b', null, r.club_name)); nm.setAttribute('translate', 'no');
      c1.appendChild(el('div', 'or-sub', (r.league_slugs || []).map(s => (S.leagues.get(s) || {}).name || s).join(' · ')));
      const c2 = tr.insertCell();
      c2.appendChild(el('span', null, COUNTRY[r.country] || r.country || ''));
      if (CONSENT[r.country]) { const b = c2.appendChild(el('span', 'or-flag', 'CONSENT FIRST')); b.title = CONSENT[r.country]; }
      const c3 = tr.insertCell();
      if (r.email) { const a = c3.appendChild(el('span', 'or-mail', r.email)); a.setAttribute('translate', 'no'); c3.appendChild(el('div', 'or-sub', r.email_role || '')); }
      else if (r.contact_form) { const a = c3.appendChild(el('a', null, 'contact form ↗')); a.href = r.contact_form; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      else c3.appendChild(el('span', 'or-sub', '—'));
      const c4 = tr.insertCell();
      if (r.source_url) { const a = c4.appendChild(el('a', null, 'source ↗')); a.href = r.source_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      if (r.website) { const a = c4.appendChild(el('a', 'or-sub', ' site ↗')); a.href = r.website; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      const c5 = tr.insertCell();
      const st = c5.appendChild(el('select', 'ep-input or-st or-' + r.status));
      STATES.forEach(([k, t]) => { const op = st.appendChild(el('option', null, t)); op.value = k; });
      st.value = r.status;
      st.addEventListener('change', () => setState([r.id], st.value));
      if (r.sent_at) c5.appendChild(el('div', 'or-sub', 'sent ' + new Date(r.sent_at).toLocaleDateString()));
    });
    if (rows.length > S.shown) {
      const more = listBox.appendChild(el('button', 'ep-btn mini', 'Show ' + Math.min(200, rows.length - S.shown) + ' more'));
      more.type = 'button'; more.addEventListener('click', () => { S.shown += 200; draw(); });
    }
    drawWrite();
  }
  async function setState(ids, status) {
    if (!ids.length) return;
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === 'sent') patch.sent_at = new Date().toISOString();
    const { error } = await sb.from('outreach_contacts').update(patch).in('id', ids);
    if (error) return oops(error);
    S.rows.forEach(r => { if (ids.includes(r.id)) Object.assign(r, patch); });
    say(ids.length + (ids.length === 1 ? ' club' : ' clubs') + ': ' + (STATES.find(s => s[0] === status) || [0, status])[1].toLowerCase() + '.');
    draw();
  }

  /* ---------------------------------------------------------------- the pitch --- */
  function drawTemplate() {
    tplBox.textContent = '';
    tplBox.appendChild(el('summary', 'or-sum', 'The pitch: subject, letter and sign-off'));
    const t = S.tpl;
    const f = (label, value, rows) => {
      const l = tplBox.appendChild(el('label', 'or-field'));
      l.appendChild(el('span', null, label));
      const i = l.appendChild(el(rows ? 'textarea' : 'input', 'ep-input'));
      if (rows) i.rows = rows; else i.type = 'text';
      i.value = value || '';
      return i;
    };
    const subj = f('Subject', t.subject), body = f('Letter', t.body, 12), sign = f('Sign-off', t.signoff, 3);
    tplBox.appendChild(el('p', 'or-note', 'Merge fields: {{club}} {{league}} {{club_page}} {{hook}} (the club’s season so far, from the table) {{country}} {{website}}. ' +
      'A blank line starts a paragraph; addresses become links.'));
    const save = tplBox.appendChild(el('button', 'ep-btn', 'Save the pitch')); save.type = 'button';
    save.addEventListener('click', async () => {
      const row = { name: 'default', subject: subj.value, body: body.value, signoff: sign.value, updated_at: new Date().toISOString() };
      const { error } = await sb.from('outreach_templates').upsert(row, { onConflict: 'name' });
      if (error) return oops(error);
      S.tpl = row; say('Pitch saved.'); drawWrite();
    });
  }

  /* ---------------------------------------------------------------- write --- */
  const HOOKS = new Map();
  async function hookFor(r) {
    if (HOOKS.has(r.club_key)) return HOOKS.get(r.club_key);
    let line = '';
    try {
      const { data } = await sb.from('standings').select('team_id,rank,gp,w,l,competitions(name)').in('team_id', (r.team_ids || []).slice(0, 6)).gt('gp', 0).order('gp', { ascending: false }).limit(1);
      const s = data && data[0];
      if (s) {
        const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
        line = r.club_name + ' are ' + s.w + '–' + s.l + ' so far' + (s.rank ? ', ' + ord(s.rank) + ' in ' + ((s.competitions && s.competitions.name) || 'the table') : '') +
          ' - the report breaks down what is behind that, game by game.';
      }
    } catch (_) { /* no hook */ }
    HOOKS.set(r.club_key, line);
    return line;
  }
  function fieldsOf(r) {
    const lg = (r.league_slugs || []).map(s => S.leagues.get(s)).filter(Boolean);
    const main = lg.find(l => l.country && l.country !== 'EU') || lg[0] || {};
    return { club: r.club_name, league: main.name || 'your league', country: COUNTRY[r.country] || r.country || '',
             website: r.website || '', club_page: r.team_ids && r.team_ids[0] ? SITE + '/epinoia/t/?t=' + r.team_ids[0] : SITE + '/epinoia/',
             colour: main.colour_a || null };
  }
  async function letterFor(r) {
    const t = S.tpl || {};
    const f = fieldsOf(r);
    f.hook = await hookFor(r);
    const subject = merge(t.subject, f).trim();
    const body = merge(t.body, f).replace(/\n{3,}/g, '\n\n');
    const foot = 'You are receiving this because ' + r.club_name + ' publishes this address for enquiries. Reply "no thanks" and we will not write again.';
    const opts = { colour: f.colour, kicker: f.league, title: subject, body, signoff: merge(t.signoff, f), foot };
    return { to: r.email, subject, html: letterHTML(opts), text: letterText(opts) };
  }
  function drawWrite() {
    writeBox.textContent = '';
    const picked = S.rows.filter(r => S.picked.has(r.id) && r.email);
    if (!picked.length) return;
    writeBox.appendChild(el('h3', 'or-h', 'Write to ' + picked.length + (picked.length === 1 ? ' club' : ' clubs')));
    writeBox.appendChild(el('p', 'or-note', 'Each letter leaves from your own email. Open in Gmail fills in the recipient and the subject and copies the styled letter: ' +
      'press Ctrl+V in the message to paste it (the plain words are filled in as well). Or download it as an email file for Outlook or Apple Mail.'));
    picked.slice(0, 50).forEach(r => {
      const card = writeBox.appendChild(el('div', 'or-card'));
      const top = card.appendChild(el('div', 'or-card-h'));
      top.appendChild(el('b', null, r.club_name)).setAttribute('translate', 'no');
      top.appendChild(el('span', 'or-mail', r.email)).setAttribute('translate', 'no');
      if (CONSENT[r.country]) { const b = top.appendChild(el('span', 'or-flag', 'CONSENT FIRST')); b.title = CONSENT[r.country]; }
      const frame = card.appendChild(el('iframe', 'or-frame'));
      frame.setAttribute('sandbox', '');
      frame.title = 'The letter to ' + r.club_name;
      const acts = card.appendChild(el('div', 'or-acts'));
      const gm = acts.appendChild(el('button', 'ep-btn pri mini', 'Open in Gmail')); gm.type = 'button';
      const cp = acts.appendChild(el('button', 'ep-btn mini', 'Copy the styled letter')); cp.type = 'button';
      const dl = acts.appendChild(el('button', 'ep-btn mini', 'Download email file')); dl.type = 'button';
      const sent = acts.appendChild(el('button', 'ep-btn mini', 'Mark as sent')); sent.type = 'button';
      let L = null;
      letterFor(r).then(x => { L = x; frame.srcdoc = x.html; });
      const copy = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([L.html], { type: 'text/html' }), 'text/plain': new Blob([L.text], { type: 'text/plain' }) })]);
          return true;
        } catch (_) { return false; }
      };
      gm.addEventListener('click', async () => {
        if (!L) return;
        const ok = await copy();
        const u = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(L.to) + '&su=' + encodeURIComponent(L.subject) + '&body=' + encodeURIComponent(L.text);
        root.open(u, '_blank', 'noopener');
        say(ok ? 'Opened in Gmail; the styled letter is copied - select the message and paste (Ctrl+V) to use it.' : 'Opened in Gmail with the plain letter.');
      });
      cp.addEventListener('click', async () => { if (L) say((await copy()) ? 'Styled letter copied.' : 'Could not copy: your browser refused.', 'ok'); });
      dl.addEventListener('click', () => {
        if (!L) return;
        const blob = new Blob([emlOf(L.to, L.subject, L.text, L.html)], { type: 'message/rfc822' });
        const a = el('a'); a.href = URL.createObjectURL(blob);
        a.download = r.club_name.replace(/[^\w-]+/g, '-').toLowerCase() + '.eml';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      });
      sent.addEventListener('click', () => setState([r.id], 'sent'));
    });
    if (picked.length > 50) writeBox.appendChild(el('p', 'or-note', 'The first 50 ticked are shown; mark them sent to bring up the next.'));
  }

  /* ---------------------------------------------------------------- import --- */
  async function importFile(file) {
    let rows;
    try { rows = JSON.parse(await file.text()); } catch (_) { return say('That file is not JSON.', 'err'); }
    if (!Array.isArray(rows)) return say('The file should be an array of contacts.', 'err');
    let added = 0, refreshed = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await sb.rpc('outreach_import', { p_rows: rows.slice(i, i + 200) });
      if (error) return oops(error);
      added += (data && data.added) || 0; refreshed += (data && data.refreshed) || 0;
    }
    say('Imported: ' + added + ' new, ' + refreshed + ' refreshed.');
    S.rows = []; load();
  }

  load().catch(oops);
}

return { mount, letterHTML, letterText, merge, emlOf, inkOn, CONSENT };
}));
