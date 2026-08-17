'use strict';
/* ============================================================================
   MERCHANDISE — the processor.

   The league page draws shirts and mugs from each club's crest. This turns
   those pictures into things that exist: a print file at the right physical
   size, uploaded where a factory can fetch it, and a product created in
   whichever print-on-demand store the league uses.

   IT RUNS BY ITSELF. Opening this section picks up anything pending and builds
   it — nobody has to remember that approving a club's logo means new shirts.
   The database does the remembering: a trigger puts a design back to `pending`
   when its club's logo is approved, or the club is renamed or recoloured.

   WHY THE ARTWORK IS BUILT HERE, IN A BROWSER. Rasterising an SVG needs a
   canvas, and this page has one. The alternative was a WebAssembly renderer in
   an Edge Function — a second rasteriser to keep in step with the first, for a
   job that happens a handful of times a season. What is NOT done here is
   talking to the store: that needs the API key, and the key must never reach a
   page, so it stays behind the `merch` function.

   THE LOGO IS FETCHED AS A DATA URI rather than referenced. A print file is
   read by a factory's renderer that will not fetch our storage, and drawing a
   cross-origin image onto a canvas taints it. Inlining solves both at once.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMerchUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const A = () => window.EpinoiaArtwork;

const KIND_LABEL = { tee: 'Match tee', hoodie: 'Terrace hoodie', scarf: 'Bar scarf',
                     poster: 'Crest print', mug: 'Half-time mug' };

/* A 18×24" sheet at 300 DPI is 39 million pixels, and a browser asked for
   several of those at once will fall over. One at a time, and anything past
   this is scaled down with the real DPI recorded rather than silently. */
const MAX_PIXELS = 40e6;

/* -------------------------------------------------------------- helpers --- */
async function dataUri(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('logo ' + r.status);
  const b = await r.blob();
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('could not read the logo'));
    fr.readAsDataURL(b);
  });
}

const imageSize = (uri) => new Promise((res) => {
  const i = new Image();
  i.onload = () => res({ width: i.naturalWidth, height: i.naturalHeight });
  i.onerror = () => res({ width: 0, height: 0 });
  i.src = uri;
});

/** SVG string -> PNG blob, at print size unless that is unreasonable. */
async function rasterise(svg, w, h) {
  let scale = 1;
  if (w * h > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (w * h));
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('the print file would not render'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, W, H);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    /* let a 39-megapixel canvas go before the next one is made */
    c.width = c.height = 0;
    if (!blob) throw new Error('the canvas produced nothing');
    return { blob, width: W, height: H, scale };
  } finally { URL.revokeObjectURL(url); }
}

const hash = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
};

/* opts: { host, sb, league, cfg, say } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  host.textContent = '';
  if (!opts.league) {
    host.appendChild(el('div', 'empty', 'Pick a league to build its merchandise.'));
    return;
  }
  if (!A()) {
    host.appendChild(el('div', 'empty',
      'artwork.js has not loaded, so no print files can be built.'));
    return;
  }

  host.appendChild(el('div', 'empty',
    'Print files are built here from each club’s approved logo — or its ' +
    'monogram where there is no logo — at the real size the factory prints, ' +
    '300 DPI, on transparency. Anything pending is built automatically when ' +
    'this page opens. Connecting a store is optional: without one you still ' +
    'get downloadable print files, which is most of the job.'));

  const cfgBox = el('div'); host.appendChild(cfgBox);
  const bar = el('div', 'row'); host.appendChild(bar);
  const log = el('div', 'merch-log'); host.appendChild(log);
  const list = el('div', 'list'); host.appendChild(list);

  let provider = { provider: 'manual', has_key: false, catalogue: {} };
  let busy = false;

  const note = (t, cls) => {
    const d = el('div', 'merch-line' + (cls ? ' ' + cls : ''), t);
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  };

  /* ------------------------------------------------------------ the store --- */
  function drawConfig() {
    cfgBox.textContent = '';
    cfgBox.appendChild(el('div', 'fmt-h', 'The store'));

    const r1 = el('div', 'row');
    const sel = el('select', 'cs-input');
    [['manual', 'No store — print files only'],
     ['printful', 'Printful'], ['printify', 'Printify']]
      .forEach(([v, l]) => { const o = el('option', null, l); o.value = v; sel.appendChild(o); });
    sel.value = provider.provider || 'manual';
    const key = el('input', 'cs-input');
    key.type = 'password'; key.autocomplete = 'off';
    key.placeholder = provider.has_key ? 'API key stored — type a new one to replace it'
                                       : 'API key';
    const shop = el('input', 'cs-input');
    shop.placeholder = 'Shop id (Printify)';
    shop.value = provider.store_id || '';
    shop.style.flex = '0 0 170px';
    const save = el('button', 'cs-btn', 'save store');
    save.type = 'button';
    r1.append(sel, key, shop, save);
    cfgBox.appendChild(r1);
    cfgBox.appendChild(el('div', 'fhint',
      'The key is stored on a table with no read access — this page cannot show ' +
      'it back, and neither can anyone else with a browser. Only the server ' +
      'that talks to the store can read it.'));

    cfgBox.appendChild(el('div', 'fmt-h', 'Catalogue'));
    cfgBox.appendChild(el('div', 'fhint',
      'Which product in the provider’s catalogue each of ours becomes, and what ' +
      'to charge. These ids are specific to your store and change without ' +
      'notice, so they are pasted rather than guessed — a product created ' +
      'against a guessed variant is a real product nobody can buy. Price in ' +
      'pennies.'));
    const cat = el('textarea', 'cs-input feedmap');
    cat.rows = 6; cat.spellcheck = false;
    cat.value = JSON.stringify(provider.catalogue || {}, null, 1);
    cat.placeholder = '{\n "tee": {"variants":[4011,4012], "price":2500,' +
                      ' "blueprint":5, "printProvider":29}\n}';
    cfgBox.appendChild(cat);
    const r2 = el('div', 'row');
    const saveCat = el('button', 'cs-btn', 'save catalogue');
    saveCat.type = 'button';
    r2.appendChild(saveCat);
    cfgBox.appendChild(r2);

    save.addEventListener('click', async () => {
      save.disabled = true;
      const { error } = await opts.sb.rpc('set_merch_provider', {
        p_league: opts.league.id, p_provider: sel.value,
        p_api_key: key.value.trim() || null, p_store_id: shop.value.trim() || null,
        p_currency: null, p_markup: null, p_catalogue: null, p_enabled: true
      });
      save.disabled = false;
      if (error) return opts.say(error.message, 'err');
      key.value = '';
      opts.say('Store saved.', 'ok');
      load();
    });
    saveCat.addEventListener('click', async () => {
      let parsed;
      try { parsed = JSON.parse(cat.value.trim() || '{}'); }
      catch (_) { return opts.say('The catalogue is not valid JSON.', 'err'); }
      const { error } = await opts.sb.rpc('set_merch_provider', {
        p_league: opts.league.id, p_provider: null, p_api_key: null,
        p_store_id: null, p_currency: null, p_markup: null,
        p_catalogue: parsed, p_enabled: null
      });
      if (error) return opts.say(error.message, 'err');
      opts.say('Catalogue saved.', 'ok');
      load();
    });
  }

  /* ------------------------------------------------------------ the work --- */
  function drawBar(pending) {
    bar.textContent = '';
    const build = el('button', 'cs-btn pri',
      pending ? 'build ' + pending + ' waiting' : 'rebuild everything');
    build.type = 'button';
    build.addEventListener('click', () => pending ? run() : rebuildAll());
    const dry = el('button', 'cs-btn', 'dry run');
    dry.type = 'button';
    dry.addEventListener('click', () => callStore('dryrun'));
    const pub = el('button', 'cs-btn', 'publish to store');
    pub.type = 'button';
    pub.disabled = provider.provider === 'manual';
    if (pub.disabled) pub.title = 'No store connected — the print files are the output.';
    pub.addEventListener('click', () => {
      if (!confirm('Create these products in your ' + provider.provider +
                   ' store? They appear in a real shop and cannot be removed from here.')) return;
      callStore('publish');
    });
    bar.append(build, dry, pub);
  }

  async function rebuildAll() {
    const { error } = await opts.sb.rpc('queue_merch',
      { p_league: opts.league.id, p_kinds: null });
    if (error) return opts.say(error.message, 'err');
    /* queue_merch only fills gaps; a rebuild also restales what is there */
    await opts.sb.from('merch_designs').update({ status: 'pending' })
      .eq('league_id', opts.league.id).neq('status', 'off');
    load();
  }

  /* THE PROCESSOR. One design at a time on purpose: these canvases are tens of
     millions of pixels and several at once is how a tab dies. */
  async function run() {
    if (busy) return;
    busy = true;
    log.textContent = '';
    try {
      const teams = new Map();
      const { data: ts } = await opts.sb.from('teams')
        .select('id,name,short_name,colour').eq('league_id', opts.league.id);
      (ts || []).forEach(t => teams.set(t.id, t));

      /* every club's approved logo, resolved once */
      const logos = new Map();
      if (ts && ts.length) {
        const { data: md } = await opts.sb.from('media')
          .select('owner_id,storage_path').eq('owner_type', 'team')
          .eq('kind', 'logo').eq('status', 'approved')
          .in('owner_id', ts.map(t => t.id));
        (md || []).forEach(m => { if (!logos.has(m.owner_id)) logos.set(m.owner_id, m.storage_path); });
      }

      let done = 0, failed = 0;
      for (;;) {
        const { data: batch, error } = await opts.sb.rpc('merch_claim',
          { p_league: opts.league.id, p_limit: 6 });
        if (error) { opts.say(error.message, 'err'); break; }
        if (!batch || !batch.length) break;

        for (const d of batch) {
          const club = teams.get(d.team_id);
          if (!club) {
            await opts.sb.rpc('merch_failed',
              { p_design: d.id, p_error: 'the club this design belongs to is gone' });
            failed++; continue;
          }
          note('building ' + club.name + ' · ' + (KIND_LABEL[d.kind] || d.kind) + '…');
          try {
            const spec = { name: club.name, short_name: club.short_name,
                           colour: club.colour, season: opts.season || '' };
            const path = logos.get(club.id);
            if (path) {
              spec.logoDataUri = await dataUri(
                opts.cfg.supabaseUrl + '/storage/v1/object/public/' + path);
              const sz = await imageSize(spec.logoDataUri);
              spec.logoWidth = sz.width; spec.logoHeight = sz.height;
            }

            const art = A().build(spec, { kind: d.kind });
            const png = await rasterise(art.svg, art.width, art.height);
            const warnings = art.warnings.slice();
            if (png.scale < 0.999) {
              warnings.push({ level: 'warn', text:
                'Rasterised at ' + Math.round(A().DPI * png.scale) + ' DPI rather than 300 — ' +
                'the full sheet is ' + (art.width * art.height / 1e6).toFixed(0) +
                ' megapixels, past what a browser will hold. The SVG beside it is ' +
                'full resolution if the factory takes vector.' });
            }

            const h = await hash(art.svg);
            const base = opts.league.id + '/' + club.id + '/' + d.kind + '-' + h;
            for (const [name, body, type] of [
              [base + '.png', png.blob, 'image/png'],
              [base + '.svg', new Blob([art.svg], { type: 'image/svg+xml' }), 'image/svg+xml']
            ]) {
              const { error: up } = await opts.sb.storage.from('merch-print')
                .upload(name, body, { contentType: type, upsert: true });
              if (up) throw new Error('upload refused: ' + up.message);
            }

            const { error: fin } = await opts.sb.rpc('merch_artwork_ready', {
              p_design: d.id, p_path: base + '.png', p_hash: h,
              p_width: png.width, p_height: png.height, p_warnings: warnings
            });
            if (fin) throw new Error(fin.message);
            done++;
            note('  ' + club.name + ' ' + d.kind + ' — ' + png.width + '×' + png.height +
                 (warnings.length ? ' · ' + warnings.length + ' note(s)' : ''), 'ok');
          } catch (e) {
            failed++;
            await opts.sb.rpc('merch_failed',
              { p_design: d.id, p_error: String(e.message || e) });
            note('  ' + club.name + ' ' + d.kind + ' — ' + (e.message || e), 'err');
          }
        }
      }
      if (done || failed) {
        opts.say(done + ' print file(s) built' + (failed ? ', ' + failed + ' failed' : '') + '.',
                 failed ? 'warn' : 'ok');
      }
    } finally { busy = false; load(); }
  }

  /* ----------------------------------------------------------- the store --- */
  async function callStore(action) {
    log.textContent = '';
    note(action === 'dryrun' ? 'asking the server what it would send…' : 'publishing…');
    try {
      const { data: { session } } = await opts.sb.auth.getSession();
      const r = await fetch(opts.cfg.supabaseUrl + '/functions/v1/merch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: opts.cfg.supabaseAnonKey,
                   Authorization: 'Bearer ' + (session ? session.access_token : '') },
        body: JSON.stringify({ action, leagueId: opts.league.id })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { note(j.error || ('refused (' + r.status + ')'), 'err'); return; }
      if (j.note) note(j.note);
      (j.results || []).forEach(res => {
        if (res.missing) note('  ' + res.team + ' ' + res.kind + ' — still needs: ' +
                              res.missing.join('; '), 'err');
        else if (res.requests) {
          note('  ' + res.team + ' ' + res.kind + ':');
          const pre = el('pre', 'feedpre');
          pre.textContent = JSON.stringify(res.requests, null, 2);
          log.appendChild(pre);
        } else note('  ' + res.team + ' ' + res.kind + ' — ' +
                    (res.ok ? 'published' : 'FAILED: ' + res.error), res.ok ? 'ok' : 'err');
      });
      if (action === 'publish') opts.say(j.published + ' product(s) created.', 'ok');
    } catch (e) {
      note('could not reach the server: ' + (e.message || e), 'err');
    }
    load();
  }

  /* ---------------------------------------------------------- the listing --- */
  async function load() {
    const [{ data: p }, { data: rows }] = await Promise.all([
      opts.sb.rpc('merch_provider_status', { p_league: opts.league.id }),
      opts.sb.rpc('merch_admin_list', { p_league: opts.league.id })
    ]);
    provider = (p && p[0]) || provider;
    drawConfig();

    const designs = rows || [];
    const pending = designs.filter(d => d.status === 'pending' || d.status === 'building').length;
    drawBar(pending);

    list.textContent = '';
    if (!designs.length) {
      list.appendChild(el('div', 'empty',
        'No designs yet. "Rebuild everything" creates one per club per product.'));
      return;
    }

    const { data: ts } = await opts.sb.from('teams')
      .select('id,name').eq('league_id', opts.league.id);
    const names = new Map((ts || []).map(t => [t.id, t.name]));

    designs.forEach(d => {
      const row = el('div', 'item');
      const box = el('div');
      box.appendChild(el('div', 'nm',
        (names.get(d.team_id) || 'Club') + ' · ' + (KIND_LABEL[d.kind] || d.kind)));
      const bits = [d.status.toUpperCase()];
      if (d.width_px) bits.push(d.width_px + '×' + d.height_px);
      if (d.price_pennies) bits.push('£' + (d.price_pennies / 100).toFixed(2));
      if (d.external_id) bits.push('store ' + d.external_id);
      box.appendChild(el('div', 'mt', bits.join(' · ')));
      if (d.error) box.appendChild(el('div', 'mt feederr', d.error));
      (d.warnings || []).forEach(w =>
        box.appendChild(el('div', 'mt' + (w.level === 'bad' ? ' feederr' : ''), w.text)));
      row.appendChild(box);
      if (d.status !== 'published') row.style.opacity = '.72';

      const sp = el('div', 'sp');
      if (d.artwork_path) {
        const u = opts.cfg.supabaseUrl + '/storage/v1/object/public/merch-print/' + d.artwork_path;
        [['print file', u], ['vector', u.replace(/\.png$/, '.svg')]].forEach(([t, href]) => {
          const a = el('a', 'cs-btn mini', t);
          a.href = href; a.target = '_blank'; a.rel = 'noopener';
          sp.appendChild(a);
        });
      }
      if (d.external_url) {
        const a = el('a', 'cs-btn mini', 'in the shop ↗');
        a.href = d.external_url; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
        sp.appendChild(a);
      }
      row.appendChild(sp);
      list.appendChild(row);
    });

    /* AUTOMATIC. Anything waiting gets built the moment somebody looks at this
       section — the point of the pipeline is that nobody has to remember. */
    if (pending && !busy) {
      note(pending + ' design(s) waiting — building them now.');
      run();
    }
  }

  load();
}

return { mount };
}));
