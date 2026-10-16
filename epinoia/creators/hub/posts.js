'use strict';
/* ============================================================================
   THE CREATOR HUB'S NEWS POSTS (Louie, 2026-10-16) - a story made into an Instagram post the way a sports desk makes
   them, from the pieces newspost.js draws.   window.EpinoiaHubPosts.mount(opts)

     THE STORY      the outlet's own pieces (signed in), the league's news and match reports, the publishers' stories
                    about the league, or a post written from nothing
     THE LAYOUT     headline, quote, report, result, big number or cover art: the one the story suits is chosen first
                    (newspost.js compose), any other a click away; the sizes are Instagram's three and a 16:9 cover
     THE PICTURES   photographs and cut-outs (a PNG with no background) from this device - chosen, or dropped on the
                    preview, a cut-out told from a photograph by its transparent corners - and the story's own picture
                    where its site lets it be used; each moved by dragging it on the preview, zoomed, darkened, blurred
     THE WORDS      every piece's words filled in from the story and changeable: *stars* put words in the accent; a
                    report's table is a row a line, its cells split by |, or filled from the league's injury report
     THE PIECES     each piece of the layout on or off; the accent from the club, the league or the desk's colours
     OUT            the picture as a PNG, every size at once as a ZIP, and the words to post it with

   Nothing is uploaded: the pictures stay on this device and the post is drawn here.

     mount({ host, sb, league, outlet, D, say })
   ============================================================================ */
(function (root) {
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
  const NP = () => root.EpinoiaNewsPost, NA = () => root.EpinoiaNewsArt;
  const https = u => (typeof u === 'string' && /^https:\/\/[^\s<>"]+$/i.test(u) ? u : null);
  const BASE = '../../';
  const SITE = 'https://prophesyscouting.co.uk/epinoia/';
  const ACCENTS = [['#ffe14d', 'Yellow'], ['#3ddc84', 'Green'], ['#ff4d5e', 'Red'], ['#4fc3ff', 'Blue'], ['#ff9f1c', 'Orange'], ['#ffffff', 'White']];
  const PIECE_WORDS = { brand: 'Your mark', kicker: 'Kicker', crest: 'Crest', cutouts: 'Cut-outs', headline: 'Headline', sub: 'Strap line',
    corners: 'Corner lines', photos: 'Photos', badge: 'Badge', quote: 'Quote', who: 'Who said it', title: 'Big title', sponsor: 'Sponsor',
    table: 'Table', score: 'Score bar', stat: 'Number' };
  const ICON_WORDS = { cross: 'Cross', star: 'Star', bolt: 'Bolt', quote: 'Quotes', ball: 'Ball', none: 'None' };

  let run = 0;

  function mount(o) {
    const my = ++run;
    const host = o.host;
    host.textContent = '';
    if (!NP() || !NA()) { host.appendChild(el('div', 'pg-empty', 'News posts could not be loaded.')); return; }
    const st = { league: o.league, outlet: o.outlet, sb: o.sb, D: o.D || root.EpinoiaData, clubs: [], stories: [], post: null,
                 size: 'portrait', active: 'photo0', template: null, storyKey: null, caption: '', teams: null };
    const live = () => my === run;
    host.appendChild(el('div', 'pg-empty', 'Reading ' + st.league.name + '’s stories…'));
    load(st).then(() => { if (live()) build(st, host, live); },
      e => { if (live()) { host.textContent = ''; host.appendChild(el('div', 'pg-empty', 'The stories could not be read: ' + ((e && e.message) || e))); } });
  }

  /* ------------------------------------------------------------------- the stories --- */
  async function load(st) {
    const A = NA();
    const lg = st.league;
    const brandL = { name: lg.name, colour: lg.colour_a || null, logo: lg.logo_path && root.epinoiaLogoUrl ? root.epinoiaLogoUrl(lg.logo_path, 256) : null };
    const settle = p => Promise.resolve(p).then(v => v, () => null);
    const rpc = (fn, args) => (st.sb ? st.sb.rpc(fn, args).then(r => (r.error ? null : r.data)) : Promise.resolve(null));
    const [clubs, mine, news, feed] = await Promise.all([
      settle(A.clubsFor([lg.slug])),
      st.outlet ? settle(rpc('creator_studio', { p_outlet: st.outlet.outlet_id })) : null,
      settle(rpc('news_public', { p_league: lg.id, p_limit: 20, p_offset: 0 })),
      settle(rpc('news_feed', { p_league: lg.id, p_before: null, p_limit: 30, p_kinds: ['outlet', 'creator', 'channel'] }))
    ]);
    st.clubs = clubs || [];
    const out = [];
    const oBrand = st.outlet ? { name: st.outlet.name, colour: st.outlet.colour || null, logo: https(st.outlet.logo_url || st.outlet.logo) } : null;
    ((mine && mine.posts) || []).filter(p => p.kind === 'article' || p.kind === 'social').slice(0, 20).forEach(p => out.push({
      key: 'mine:' + p.id, group: 'Your pieces', title: p.title || '', summary: p.standfirst || '', kind: 'article', brand: oBrand,
      image: https(p.cover_url), url: p.slug && st.outlet ? SITE + 'creators/?l=' + encodeURIComponent(st.outlet.league_slug) + '&o=' + encodeURIComponent(st.outlet.slug) + '&p=' + encodeURIComponent(p.slug) : '' }));
    (news || []).forEach(a => {
      const game = a.home_name && a.away_name;
      const club = k => ({ name: a[k + '_name'], short: a[k + '_short'], colour: a[k + '_colour'], colour2: a[k + '_colour_2'], logo: a[k + '_logo'] });
      out.push({ key: 'news:' + a.id, group: lg.name + ' news', title: a.title || '', summary: a.standfirst || '', kind: game ? 'league' : 'article',
        brand: brandL, image: a.cover_path ? (root.EpinoiaUpload && root.EPINOIA_CONFIG ? root.EpinoiaUpload.publicUrl(root.EPINOIA_CONFIG, a.cover_path) : null) : null,
        home: game ? club('home') : null, away: game ? club('away') : null,
        homeScore: a.home_score, awayScore: a.away_score,
        url: SITE + 'news/?l=' + encodeURIComponent(lg.slug) + '&a=' + encodeURIComponent(a.slug) });
    });
    (feed || []).filter(r => r.kind === 'outlet' || r.kind === 'channel' || r.kind === 'creator').forEach(r => out.push({
      key: 'feed:' + r.kind + ':' + r.id, group: 'Around ' + lg.name, title: r.title || '', summary: r.summary || '', kind: 'story',
      brand: { name: r.source_name, colour: r.source_colour || null, logo: https(r.source_logo) }, image: https(r.image_url), url: https(r.url) || '' }));
    out.push({ key: 'blank', group: 'Your own', title: '', summary: '', kind: 'article', brand: oBrand || brandL, url: '' });
    st.stories = out;
  }
  const articleOf = (st, s) => ({ title: s.title, summary: s.summary, kind: s.kind, brand: s.brand || {}, url: s.url,
    league: { name: st.league.name, slug: st.league.slug, colour: st.league.colour_a }, home: s.home, away: s.away,
    homeScore: s.homeScore, awayScore: s.awayScore });

  /* ---------------------------------------------------------------- the page --- */
  function build(st, host, live) {
    host.textContent = '';
    const top = host.appendChild(el('div', 'np-top'));
    const pickW = top.appendChild(el('label', 'np-field np-story'));
    pickW.appendChild(el('span', 'np-l', 'Story'));
    const pick = pickW.appendChild(el('select', 'ep-input'));
    const groups = new Map();
    st.stories.forEach(s => {
      if (!groups.has(s.group)) { const g = pick.appendChild(el('optgroup')); g.label = s.group; groups.set(s.group, g); }
      const op = groups.get(s.group).appendChild(data('option', null, s.key === 'blank' ? 'Write one from nothing' : (s.title || 'Untitled').slice(0, 110)));
      if (s.key === 'blank') op.removeAttribute('translate');
      op.value = s.key;
    });
    const tplRow = top.appendChild(el('div', 'np-segs'));
    const tplSeg = tplRow.appendChild(el('div', 'pg-seg np-tpl')); tplSeg.setAttribute('role', 'group'); tplSeg.setAttribute('aria-label', 'Layout');
    const sizeSeg = tplRow.appendChild(el('div', 'pg-seg')); sizeSeg.setAttribute('role', 'group'); sizeSeg.setAttribute('aria-label', 'Size');

    const grid = host.appendChild(el('div', 'np-grid'));
    const stage = grid.appendChild(el('div', 'np-stage'));
    const cv = stage.appendChild(el('canvas', 'np-canvas'));
    cv.setAttribute('aria-label', 'The post, as it will be saved');
    stage.appendChild(el('p', 'ch-muted np-hint', 'Drag a picture on the post to move it. Drop photographs or cut-outs (PNGs with no background) here.'));
    const acts = stage.appendChild(el('div', 'np-acts'));
    const dl = acts.appendChild(el('button', 'ep-btn pri', 'Download PNG')); dl.type = 'button';
    const zipB = acts.appendChild(el('button', 'ep-btn', 'Every size (ZIP)')); zipB.type = 'button';
    const capW = stage.appendChild(el('label', 'np-field'));
    capW.appendChild(el('span', 'np-l', 'Words to post with it'));
    const cap = capW.appendChild(el('textarea', 'ep-input np-cap')); cap.rows = 6;
    const cp = stage.appendChild(el('button', 'ep-btn mini', 'Copy the words')); cp.type = 'button';
    const side = grid.appendChild(el('div', 'np-side'));

    let raf = 0;
    const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paint(st, cv)); };

    const segButtons = (seg, list, cur, onPick) => {
      seg.textContent = '';
      list.forEach(([v, t]) => {
        const b = seg.appendChild(el('button', null, t)); b.type = 'button'; b.setAttribute('aria-pressed', String(v === cur));
        b.addEventListener('click', () => { seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); onPick(v); });
      });
    };
    const sizes = () => segButtons(sizeSeg, Object.keys(NP().SIZES).map(k => [k, NP().SIZES[k].label]), st.size, v => { st.size = v; st.post.size = v; redraw(); });
    const tpls = () => segButtons(tplSeg, NP().TEMPLATES, st.post.template, v => { st.template = v; st.post.template = v; form(); redraw(); });

    /* ---------------------------------------------------------------- choose a story --- */
    async function choose(key) {
      const s = st.stories.find(x => x.key === key) || st.stories[0];
      st.storyKey = s.key;
      const A = NA();
      const art = articleOf(st, s);
      const facts = A.analyse(art, { clubs: st.clubs });
      st.noteText = '';
      /* what a person chose stays with the next story; the last story's own picture does not */
      const keep = st.post ? { photos: (st.post.photos || []).filter(x => x && x.from !== 'story'), cutouts: st.post.cutouts, accent: st.post.accent, sponsor: st.post.sponsor,
                               images: { sponsor: st.post.images.sponsor } } : {};
      st.post = NP().compose(art, facts, Object.assign({ size: st.size }, st.template ? { template: st.template } : {}));
      if (s.key === 'blank') Object.assign(st.post, { headline: 'YOUR HEADLINE\n*IN TWO COLOURS*', kicker: 'BREAKING', template: st.template || 'headline' });
      st.post.photos = keep.photos || []; st.post.cutouts = keep.cutouts || [];
      if (keep.accent) st.post.accent = keep.accent;
      if (keep.sponsor) st.post.sponsor = keep.sponsor;
      st.post.images = { crest: null, crests: [], brand: null, sponsor: keep.images ? keep.images.sponsor : null };
      tpls(); sizes(); form(); redraw();
      /* the pictures a story brings: its clubs' crests and its brand's mark, asked for so that the post can be saved */
      const crests = await Promise.all(facts.clubs.map(c => (c && !c.guess && c.logo ? A.crest(c.logo, true) : null)));
      const brand = s.brand && s.brand.logo ? await A.load(s.brand.logo, true) : null;
      if (!live() || st.storyKey !== s.key) return;
      st.post.images.crests = crests; st.post.images.crest = crests[0] || null; st.post.images.brand = brand;
      /* the story's own picture as the first photograph, where its site allows it to be drawn into a saved picture */
      if (s.image && !(st.post.photos || []).some(p => p && p.img)) {
        const img = await A.load(s.image, true);
        if (!live() || st.storyKey !== s.key) return;
        if (img) st.post.photos = [{ img, panX: 0, panY: 0, zoom: 1, from: 'story' }];
        else note('The story’s own picture is on a site that does not let it be used in a saved image: save it and choose it from your device.');
      }
      form(); redraw();
    }
    const note = t => { st.noteText = t; };

    /* ---------------------------------------------------------------- the controls --- */
    function form() {
      const p = st.post;
      side.textContent = '';
      if (st.noteText) side.appendChild(el('p', 'np-note', st.noteText));
      cap.value = NP().caption(p);
      const pieces = NP().PIECES[p.template] || [];
      const has = k => pieces.includes(k);

      /* PICTURES */
      const pics = side.appendChild(el('fieldset', 'np-box'));
      pics.appendChild(el('legend', 'ch-h', 'Pictures'));
      /* a cut-out is only ever a picture a person gives it: no figure is drawn in its place */
      const slots = [['photo0', 'Photo'], ['photo1', 'Second photo'], ['cut0', 'Cut-out (a PNG, no background)'], ['cut1', 'Second cut-out']];
      const slotOf = k => (k.startsWith('photo') ? p.photos : p.cutouts)[+k.slice(-1)];
      slots.forEach(([k, label]) => {
        const row = pics.appendChild(el('div', 'np-slot' + (st.active === k ? ' on' : '')));
        const pickB = row.appendChild(el('button', 'np-slot-b', label)); pickB.type = 'button';
        pickB.setAttribute('aria-pressed', String(st.active === k));
        pickB.title = 'Move this one when the post is dragged';
        pickB.addEventListener('click', () => { st.active = k; form(); });
        const f = row.appendChild(el('input')); f.type = 'file'; f.accept = 'image/*'; f.className = 'np-file';
        f.setAttribute('aria-label', label + ': a picture from this device');
        f.addEventListener('change', async () => { if (f.files && f.files[0]) { await putFile(f.files[0], k); st.active = k; form(); redraw(); } });
        const cur = slotOf(k);
        if (cur && cur.img) {
          const rm = row.appendChild(el('button', 'ep-btn mini', 'Remove')); rm.type = 'button';
          rm.addEventListener('click', () => { (k.startsWith('photo') ? p.photos : p.cutouts)[+k.slice(-1)] = null; form(); redraw(); });
        }
      });
      const cur = slotOf(st.active);
      if (cur && cur.img) {
        const isCut = st.active.startsWith('cut');
        slider(pics, isCut ? 'Size' : 'Zoom', isCut ? 0.2 : 1, isCut ? 1 : 3, 0.01, isCut ? (cur.scale || 0.6) : (cur.zoom || 1), v => { if (isCut) cur.scale = v; else cur.zoom = v; redraw(); });
      }
      slider(pics, 'Darken the photo', 0, 0.85, 0.01, p.dim || 0, v => { p.dim = v; redraw(); });
      slider(pics, 'Blur the photo', 0, 24, 1, p.blur || 0, v => { p.blur = v; redraw(); });

      /* WORDS */
      const words = side.appendChild(el('fieldset', 'np-box'));
      words.appendChild(el('legend', 'ch-h', 'Words'));
      if (has('kicker')) text(words, 'Kicker', p.kicker, v => { p.kicker = v; });
      if (has('headline') || p.template === 'cover') area(words, 'Headline', p.headline, v => { p.headline = v; }, 'A new line starts a line; *stars* put words in the accent colour.', 3);
      if (has('sub')) text(words, 'Strap line', p.sub, v => { p.sub = v; });
      if (has('title')) {
        const two = words.appendChild(el('div', 'np-two'));
        text(two, 'Big title, white', (p.title || [])[0] || '', v => { p.title = [v, (p.title || [])[1] || '']; });
        text(two, 'Big title, accent', (p.title || [])[1] || '', v => { p.title = [(p.title || [])[0] || '', v]; });
      }
      if (has('quote')) {
        area(words, 'Quote', p.quote, v => { p.quote = v; }, null, 3);
        text(words, 'Who said it', p.who, v => { p.who = v; });
        text(words, 'When, or about what', p.whoLine, v => { p.whoLine = v; });
      }
      if (has('stat')) {
        const two = words.appendChild(el('div', 'np-two'));
        text(two, 'Number', p.stat.value, v => { p.stat.value = v; });
        text(two, 'What it counts', p.stat.label, v => { p.stat.label = v; });
        text(words, 'Whose', p.stat.who, v => { p.stat.who = v; });
      }
      if (has('score') && p.score) {
        const two = words.appendChild(el('div', 'np-two np-three'));
        text(two, (p.score.home && p.score.home.name) || 'Home', String(p.score.hs == null ? '' : p.score.hs), v => { p.score.hs = v; });
        text(two, (p.score.away && p.score.away.name) || 'Away', String(p.score.as == null ? '' : p.score.as), v => { p.score.as = v; });
        text(two, 'Label', p.score.label || '', v => { p.score.label = v; });
      }
      if (has('table')) {
        text(words, 'Table heading', p.tableHead, v => { p.tableHead = v; });
        const rowsTxt = (p.rows || []).map(r => r.join(' | ')).join('\n');
        area(words, 'Rows', rowsTxt, v => { p.rows = NP().parseRows(v); }, 'A row a line: position | name | status | when | note. *Stars* colour part of a note.', 6);
        injuryFill(words);
      }
      if (has('sponsor')) {
        const two = words.appendChild(el('div', 'np-two'));
        text(two, 'Sponsor line', p.sponsor.text || 'PRESENTED BY:', v => { p.sponsor.text = v; });
        text(two, 'Sponsor', p.sponsor.name || '', v => { p.sponsor.name = v; });
        const lr = words.appendChild(el('label', 'np-field'));
        lr.appendChild(el('span', 'np-l', 'Sponsor’s logo'));
        const f = lr.appendChild(el('input')); f.type = 'file'; f.accept = 'image/*'; f.className = 'np-file';
        f.addEventListener('change', async () => { if (f.files && f.files[0]) { p.images.sponsor = await fileImg(f.files[0]); redraw(); } });
      }
      if (has('brand')) text(words, 'Your handle (when there is no logo)', p.handle, v => { p.handle = v; });

      /* LOOK */
      const look = side.appendChild(el('fieldset', 'np-box'));
      look.appendChild(el('legend', 'ch-h', 'Look'));
      /* the club, for the crest and the colours */
      if (st.clubs.length) {
        const cl = look.appendChild(el('label', 'np-field'));
        cl.appendChild(el('span', 'np-l', 'Club'));
        const sel = cl.appendChild(el('select', 'ep-input'));
        sel.appendChild(el('option', null, 'As the story says')).value = '';
        st.clubs.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => { const op = sel.appendChild(data('option', null, c.name)); op.value = c.name; });
        sel.value = p.club && !p.club.guess ? p.club.name : '';
        sel.addEventListener('change', async () => {
          const c = st.clubs.find(x => x.name === sel.value);
          if (!c) return;
          p.club = c; p.tableHead = c.name;
          p.palette = NA().palette(c.colour, c.colour2, c.name);
          p.images.crest = await NA().crest(c.logo, true);
          redraw();
        });
      }
      const sw = look.appendChild(el('div', 'np-swatches'));
      sw.appendChild(el('span', 'np-l', 'Accent'));
      const club = p.club || (p.facts && p.facts.clubs && p.facts.clubs[0]);
      const own = [club && NA().hex(club.colour2), club && NA().hex(club.colour), NA().hex(st.league.colour_a), NA().hex(st.league.colour_b)].filter(Boolean);
      [[null, 'Automatic']].concat(own.map(c => [c, c]), ACCENTS).forEach(([c, label]) => {
        const b = sw.appendChild(el('button', 'np-sw' + ((p.accent || null) === c ? ' on' : '')));
        b.type = 'button'; b.title = label; b.setAttribute('aria-label', 'Accent: ' + label);
        if (c) b.style.background = c; else b.textContent = 'A';
        b.addEventListener('click', () => { p.accent = c; form(); redraw(); });
      });
      const custom = sw.appendChild(el('input')); custom.type = 'color'; custom.value = p.accent || '#ffe14d';
      custom.setAttribute('aria-label', 'Accent: any colour');
      custom.addEventListener('input', () => { p.accent = custom.value; redraw(); });
      if (pieces.includes('badge')) {
        const ic = look.appendChild(el('label', 'np-field'));
        ic.appendChild(el('span', 'np-l', 'Badge'));
        const sel = ic.appendChild(el('select', 'ep-input'));
        NP().ICONS.forEach(k => { sel.appendChild(el('option', null, ICON_WORDS[k] || k)).value = k; });
        sel.value = p.icon || 'bolt';
        sel.addEventListener('change', () => { p.icon = sel.value; redraw(); });
      }
      /* THE PIECES, each on or off */
      const pc = look.appendChild(el('div', 'np-pieces'));
      pieces.forEach(k => {
        const l = pc.appendChild(el('label', 'np-chk'));
        const c = l.appendChild(el('input')); c.type = 'checkbox'; c.checked = !(p.off || []).includes(k);
        l.appendChild(el('span', null, PIECE_WORDS[k] || k));
        c.addEventListener('change', () => { p.off = (p.off || []).filter(x => x !== k).concat(c.checked ? [] : [k]); redraw(); });
      });
    }
    const field = (hostEl, label) => { const l = hostEl.appendChild(el('label', 'np-field')); l.appendChild(el('span', 'np-l', label)); return l; };
    function text(hostEl, label, value, set) {
      const l = field(hostEl, label);
      const i = l.appendChild(el('input', 'ep-input')); i.type = 'text'; i.value = value || ''; i.setAttribute('translate', 'no');
      i.addEventListener('input', () => { set(i.value); cap.value = NP().caption(st.post); redraw(); });
    }
    function area(hostEl, label, value, set, hint, rows) {
      const l = field(hostEl, label);
      const t = l.appendChild(el('textarea', 'ep-input')); t.rows = rows || 3; t.value = value || ''; t.setAttribute('translate', 'no');
      t.addEventListener('input', () => { set(t.value); cap.value = NP().caption(st.post); redraw(); });
      if (hint) l.appendChild(el('span', 'np-hint2', hint));
    }
    function slider(hostEl, label, min, max, step, value, set) {
      const l = field(hostEl, label);
      const r = l.appendChild(el('input')); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
      r.addEventListener('input', () => set(+r.value));
    }

    /* A REPORT'S ROWS FROM THE LEAGUE'S INJURY REPORT (injuries.js): who the club has been missing, worked out from the
       box scores, for the club chosen */
    function injuryFill(hostEl) {
      const I = root.EpinoiaInjuries, D = st.D;
      if (!I || !D) return;
      const b = hostEl.appendChild(el('button', 'ep-btn mini', 'Fill from the injury report')); b.type = 'button';
      b.addEventListener('click', async () => {
        const p = st.post;
        const club = p.club;
        if (!club) { b.textContent = 'Choose a club first (Look)'; setTimeout(() => { b.textContent = 'Fill from the injury report'; }, 2600); return; }
        b.disabled = true; b.textContent = 'Reading the box scores…';
        try {
          const rows = await injuryRows(st, club);
          p.rows = rows.length ? rows : [['', 'Nobody missing', 'In', '', 'Every regular played the last game']];
          form(); redraw();
        } catch (e) { b.textContent = 'Could not read it'; setTimeout(() => { b.textContent = 'Fill from the injury report'; b.disabled = false; }, 2600); return; }
      });
    }

    /* ---------------------------------------------------------------- pictures in --- */
    function fileImg(file) {
      return new Promise(res => {
        const u = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => res(img); img.onerror = () => res(null);
        img.src = u;
      });
    }
    /* a cut-out is a picture whose corners are see-through */
    function isCutout(img) {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 24;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
        const px = [[0, 0], [23, 0], [0, 23], [23, 23], [12, 0]].map(([a, b]) => x.getImageData(a, b, 1, 1).data[3]);
        return px.filter(a => a < 200).length >= 3;
      } catch (_) { return false; }
    }
    async function putFile(file, slot) {
      const img = await fileImg(file);
      if (!img) return;
      const p = st.post;
      const k = slot || (isCutout(img) ? (p.cutouts[0] && p.cutouts[0].img ? 'cut1' : 'cut0') : (p.photos[0] && p.photos[0].img ? 'photo1' : 'photo0'));
      const i = +k.slice(-1);
      if (k.startsWith('photo')) p.photos[i] = { img, panX: 0, panY: 0, zoom: 1 };
      else p.cutouts[i] = { img, x: null, y: 0, scale: null };
      st.active = k;
    }
    stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drop'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
    stage.addEventListener('drop', async e => {
      e.preventDefault(); stage.classList.remove('drop');
      const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type)).slice(0, 4);
      for (const f of files) await putFile(f, null);
      form(); redraw();
    });
    /* DRAGGING the picture chosen in Pictures */
    let drag = null;
    cv.addEventListener('pointerdown', e => {
      const p = st.post, k = st.active;
      const cur = (k.startsWith('photo') ? p.photos : p.cutouts)[+k.slice(-1)];
      if (!cur || !cur.img) return;
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cur, k, start: Object.assign({}, cur) };
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = cv.getBoundingClientRect();
      const dx = (e.clientX - drag.x) / r.width, dy = (e.clientY - drag.y) / r.height;
      const c = drag.cur;
      if (drag.k.startsWith('photo')) {
        const z = c.zoom || 1;
        c.panX = Math.max(-1, Math.min(1, (drag.start.panX || 0) - dx * 2 * z));
        c.panY = Math.max(-1, Math.min(1, (drag.start.panY || 0) - dy * 2 * z));
      } else {
        const def = drag.k === 'cut1' ? 0.36 : 0.6;
        c.x = Math.max(0, Math.min(1, (drag.start.x != null ? drag.start.x : def) + dx));
        c.y = (drag.start.y || 0) + dy;
      }
      redraw();
    });
    const end = () => { drag = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

    /* ---------------------------------------------------------------- out --- */
    const save = (blob, name) => {
      const u = URL.createObjectURL(blob);
      const a = el('a'); a.href = u; a.download = name; a.dataset.track = 'creator-newspost';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
    };
    const busy = (b, t, f) => async () => {
      const was = b.textContent; b.disabled = true; b.textContent = 'Drawing…';
      try { await f(); b.textContent = was; }
      catch (e) { b.textContent = /tainted|insecure|SecurityError/i.test(String(e && (e.name + e.message))) ? 'A picture here cannot be saved: choose it from your device' : 'Could not draw it'; setTimeout(() => { b.textContent = was; }, 3600); }
      b.disabled = false;
    };
    dl.addEventListener('click', busy(dl, '', async () => save(await NP().png(st.post, { size: st.size }), NP().filename(st.post, st.size))));
    zipB.addEventListener('click', busy(zipB, '', async () => {
      const SC = root.EpinoiaSocialCard;
      const files = [];
      for (const k of Object.keys(NP().SIZES)) {
        const bl = await NP().png(Object.assign({}, st.post, { size: k }), { size: k });
        files.push({ name: NP().filename(st.post, k), bytes: new Uint8Array(await bl.arrayBuffer()) });
      }
      files.push({ name: NP().filename(st.post, 'words').replace(/\.png$/, '.txt'), bytes: new TextEncoder().encode(cap.value) });
      if (!SC || !SC.zip) throw new Error('no zip');
      save(new Blob([SC.zip(files, new Date())], { type: 'application/zip' }), NP().filename(st.post, 'all').replace(/\.png$/, '.zip'));
    }));
    cp.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(cap.value); cp.textContent = 'Copied'; } catch (_) { cp.textContent = 'Select the words above'; }
      setTimeout(() => { cp.textContent = 'Copy the words'; }, 2200);
    });

    pick.addEventListener('change', () => { st.template = null; choose(pick.value); });
    const first = st.stories.find(s => s.key !== 'blank') || st.stories[0];
    pick.value = first.key;
    choose(first.key);
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => redraw()).observe(stage);
  }

  /* the preview: the post at the stage's width, at the screen's own sharpness */
  function paint(st, cv) {
    const S = NP().SIZES[st.size];
    const w = Math.max(200, Math.min(cv.parentNode.clientWidth, 520));
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    cv.style.width = w + 'px'; cv.style.height = Math.round(w * S.h / S.w) + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(w * S.h / S.w * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(cv.width / S.w, 0, 0, cv.height / S.h, 0, 0);
    try { NP().draw(ctx, st.post, { size: st.size, preview: true }); } catch (e) { console.warn('[news posts]', e); }
  }

  /* ---------------------------------------------------------------- the injury report --- */
  async function injuryRows(st, club) {
    const D = st.D, I = root.EpinoiaInjuries;
    const seasons = await D.all('seasons?league_id=eq.' + encodeURIComponent(st.league.id) + '&select=id,competitions(id)&order=starts_on.desc&limit=1');
    const comps = seasons && seasons[0] && Array.isArray(seasons[0].competitions) ? seasons[0].competitions.map(c => c.id) : [];
    if (!comps.length) return [];
    const scope = comps.length === 1 ? 'competition_id=eq.' + comps[0] : 'competition_id=in.(' + comps.join(',') + ')';
    const games = await D.all('games?' + scope + '&status=in.(final,finalising)&select=id,home_team_id,away_team_id,tipoff_at');
    if (!games.length) return [];
    if (D.BIG_GAMES && games.length > D.BIG_GAMES) throw new Error('too big');
    const teams = st.teams || (st.teams = await D.teamMeta(st.league.id));
    const teamId = Object.keys(teams).find(id => teams[id].name === club.name);
    if (!teamId) return [];
    const ids = games.filter(g => String(g.home_team_id) === teamId || String(g.away_team_id) === teamId).map(g => g.id);
    const parts = [];
    for (let i = 0; i < ids.length; i += 40) parts.push(ids.slice(i, i + 40));
    const rows = await Promise.all(parts.map(c => D.all('player_game_stats?game_id=in.(' + c.join(',') + ')&select=game_id,player_uuid,player_id,team_idx,min:stats->min')));
    const pgs = rows.flat().map(r => ({ game_id: r.game_id, player_uuid: r.player_uuid, player_id: r.player_id, team_idx: r.team_idx, stats: r.min == null ? {} : { min: r.min } }));
    const mine = games.filter(g => ids.includes(g.id));
    const released = D.releases ? await D.releases([teamId]).catch(() => []) : [];
    const rep = I.report({ games: mine, pgs, released });
    const list = (rep.byTeam.get(String(teamId)) || []).filter(e => !e.stale).slice(0, 8);
    if (!list.length) return [];
    const meta = await D.playerMeta(list.map(e => e.playerId)).catch(() => ({}));
    return list.map(e => {
      const m = meta[e.playerId] || {};
      const games = e.missed === 1 ? 'Last game' : 'Last ' + e.missed;
      return [m.position || '', m.name || 'Player', e.dnp ? 'DNP' : 'Out', games, I.line(e)];
    });
  }

  root.EpinoiaHubPosts = { mount };
}(typeof globalThis !== 'undefined' ? globalThis : self));
