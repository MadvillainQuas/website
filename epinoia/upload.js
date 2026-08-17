'use strict';
/* ============================================================================
   EPINOIA UPLOAD — resize in the browser, then send.

   The plan calls client-side resizing the single biggest lever on both cost and
   page speed, and it is: a 4 MB phone photograph becomes about 60 KB before it
   leaves the device. Every visitor to that player's page downloads the small
   one forever, and the storage bill is a rounding error rather than a bill.

   Doing it here rather than server-side also means the upload itself is fast on
   arena wifi, which is where these will actually be taken.

   Two sizes are produced from one pick: the display image and a 96px thumbnail
   for rosters and tables, because a roster of twelve should not pull twelve
   800px photographs to draw twelve small circles.

   EXIF ORIENTATION is respected via createImageBitmap's imageOrientation, so a
   portrait photo taken on a phone is not published on its side — which is the
   single most common way a photo upload looks broken.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaUpload = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const SIZES = {
  photo: 800,     // player photograph, long edge
  logo:  512,     // club logo
  thumb:  96      // roster and table use
};
const MAX_BYTES = 2 * 1024 * 1024;   // matches the bucket limit in 0017

/* WebP where the browser has it, JPEG where it does not. Not PNG: a photograph
   as PNG is several times the size for no visible gain. */
function bestType(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const webp = c.toDataURL('image/webp').startsWith('data:image/webp');
  if (webp) return 'image/webp';
  /* JPEG HAS NO ALPHA, and a crest is the one thing here that needs it. On a
     browser too old for WebP encoding, a logo with a transparent background
     came out on a flat black rectangle — the club would have uploaded exactly
     what we asked for and got exactly what we said they would not. PNG is
     several times the size of a JPEG for a photograph, which is why that is
     still the photo fallback, but a 512px crest is small either way. */
  return kind === 'logo' ? 'image/png' : 'image/jpeg';
}

async function decode(file) {
  /* imageOrientation:'from-image' applies the EXIF rotation, so a portrait
     photograph does not arrive sideways. */
  if (self.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) { /* Safari used to refuse the option; fall through */ }
    try { return await createImageBitmap(file); } catch (_) {}
  }
  return await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('that file is not an image the browser can read'));
    img.src = URL.createObjectURL(file);
  });
}

/* draw to a long-edge box, never upscaling — enlarging a small photo just
   makes a blurry big one and costs bytes to do it */
function scaleTo(bitmap, edge, type, quality) {
  const w = bitmap.width, h = bitmap.height;
  const f = Math.min(1, edge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * f)), ch = Math.max(1, Math.round(h * f));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, cw, ch);
  return new Promise(res => c.toBlob(b => res({ blob: b, w: cw, h: ch }), type, quality));
}

/* An SVG that we rasterise is not an SVG. A crest is the one upload where the
   file is artwork rather than a photograph — it goes on a card at 240px, a
   plate at 620px and a print sheet at several thousand, and the whole reason to
   ask for vector is that one file serves all of them. Putting it through a
   512px canvas would have thrown that away silently, while the panel was
   telling clubs that vector was preferred.

   SO IT IS STORED UNTOUCHED, and only for a logo. There is no resizing to do
   and no thumbnail worth making: the same file is the thumbnail.

   ON SAFETY, because an SVG is a document and not just pixels. It can carry
   script, so it is worth being exact about where it is allowed to be one:

     · every place on this site renders a crest in an <img>, and an <img> does
       not run script in an SVG — that is the specification, not a hopeful
       reading of it
     · a crest is served from the storage origin, which is a different origin
       from the site, so a document opened directly there cannot reach the
       session on prophesyscouting.co.uk
     · and it goes through the same approval queue as every other upload, so a
       league admin sees it before the public does

   The cap is deliberately tight. A club crest that will not fit in 256kB of
   vector is not a crest, it is a traced photograph. */
const SVG_MAX = 256 * 1024;

/* ----------------------------------------------------------------------------
   THE COLOUR OF A CREST.

   A club uploads its badge and then has to go and find a colour picker to make
   the rest of the site match it. The badge already knows: this reads it out.

   WHAT IT IS LOOKING FOR is the colour a person would name if you held the
   crest up and asked. That is not the most common pixel — for most badges that
   is the background, or the black of an outline — so:

     * fully and mostly transparent pixels are skipped entirely. On the
       transparent-background crests we ask for, those ARE the background, and
       counting them would return the page behind the badge.
     * near-white, near-black and near-grey are skipped. They are almost always
       outline, shadow or paper rather than identity, and a club whose crest is
       genuinely monochrome falls through to the fallback rather than getting a
       muddy near-grey.
     * what is left is bucketed by hue and weighted by saturation, so a small
       area of strong club colour beats a large wash of pale tint. Weighting by
       area alone picks the biggest thing; a badge's identity is usually the
       most VIVID thing.

   THEN IT IS MADE READABLE. The platform draws these on a near-black page and
   uses them for text, so the winner is lifted into a band of lightness that can
   actually be read there — a navy that is right on a shirt is invisible as
   type on this background. Hue and saturation are kept; only lightness moves.

   Sampled on a grid rather than every pixel: a 512px crest is a quarter of a
   million pixels and the answer does not get better for looking at all of them.
   ---------------------------------------------------------------------------- */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, sat, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

function dominantColour(bitmap) {
  try {
    const N = 96;                       // the grid the crest is sampled on
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, N, N);
    const px = ctx.getImageData(0, 0, N, N).data;

    const bins = new Array(36).fill(0);       // 10 degrees of hue each
    let counted = 0;

    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;                       // transparent
      const [h, sat, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      if (sat < 0.18) continue;                            // grey, white, black
      if (l < 0.10 || l > 0.93) continue;                  // outline or paper
      /* weight by saturation, so vividness beats area */
      bins[Math.min(35, Math.floor(h / 10))] += sat;
      counted++;
    }
    if (!counted) return null;                             // monochrome crest

    let best = 0;
    for (let i = 1; i < 36; i++) if (bins[i] > bins[best]) best = i;
    if (!bins[best]) return null;

    const hue = best * 10 + 5;
    /* the mean saturation and lightness OF THE WINNING HUE, not of everything */
    let ws = 0, wl = 0, wn = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const [h, sat, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      if (sat < 0.18 || l < 0.10 || l > 0.93) continue;
      if (Math.min(35, Math.floor(h / 10)) !== best) continue;
      ws += sat; wl += l; wn++;
    }
    if (!wn) return null;
    let sat = ws / wn, lit = wl / wn;

    /* READABLE ON A NEAR-BLACK PAGE, MEASURED RATHER THAN ESTIMATED.

       The first version clamped lightness into a band and called it readable.
       It is not the same thing: blue carries about a fifteenth of green's
       luminance, so the same lightness that puts a green at 12:1 against this
       page leaves a royal blue at 4.16 — under the 4.5 that body text needs.
       Measured across six test crests, only the blues failed, which is exactly
       the shape of the error you get from guessing at luminance.

       So the lightness is raised until the contrast is actually there. Hue and
       saturation are untouched — they are what makes the colour the club's —
       and it stops at 0.86 so a colour is never bleached to near-white chasing
       a ratio it cannot reach. */
    sat = Math.max(0.45, Math.min(0.92, sat));
    lit = Math.max(0.52, Math.min(0.78, lit));

    const lumOf = (hex) => {
      const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    /* the page these are drawn on */
    const bgLum = lumOf('#04100b');
    const contrast = (hex) => (lumOf(hex) + 0.05) / (bgLum + 0.05);

    let out = hslToHex(hue, sat, lit);
    while (contrast(out) < 4.5 && lit < 0.86) {
      lit = Math.min(0.86, lit + 0.02);
      out = hslToHex(hue, sat, lit);
    }
    return out;
  } catch (_) {
    return null;                        // a colour is a bonus, never a blocker
  }
}

/* ------------------------------------------------------------------ public ---
   prepare(file, kind)  ->  { main, thumb, type, w, h }                        */
async function prepare(file, kind) {
  if (!file || !/^image\//.test(file.type)) throw new Error('choose an image file');

  if (kind === 'logo' && /^image\/svg\+xml$/i.test(file.type)) {
    if (file.size > SVG_MAX) {
      throw new Error('that SVG is ' + Math.round(file.size / 1024) +
        'kB — crests should be under ' + (SVG_MAX / 1024) + 'kB. ' +
        'Flatten any embedded images out of it.');
    }
    /* w/h are recorded as 0: an SVG has no single pixel size, and writing a
       viewBox in as though it did would be a number that means nothing to
       anything reading the column later. */
    /* null rather than 0: a vector has no intrinsic pixel size, and 0 would be
       a measurement rather than the absence of one. */
    /* an SVG is never decoded here, so there is no bitmap to read a colour
       from; the caller simply gets none and leaves the colour alone */
    return { main: file, thumb: file, type: 'image/svg+xml', w: null, h: null,
             originalBytes: file.size, vector: true, colour: null };
  }

  const edge = SIZES[kind] || SIZES.photo;
  const type = bestType(kind);
  const bmp = await decode(file);

  let main = await scaleTo(bmp, edge, type, 0.82);
  /* If it is still large — a very detailed image, or a browser that ignored the
     quality hint — step the quality down rather than the size, so the picture
     stays the size the page expects. */
  let q = 0.72;
  while (main.blob && main.blob.size > MAX_BYTES && q >= 0.45) {
    main = await scaleTo(bmp, edge, type, q);
    q -= 0.12;
  }
  if (main.blob && main.blob.size > MAX_BYTES) {
    throw new Error('that image is too detailed to compress — try a smaller one');
  }
  const thumb = await scaleTo(bmp, SIZES.thumb, type, 0.8);
  /* read the colour before the bitmap is released */
  const colour = kind === 'logo' ? dominantColour(bmp) : null;
  if (bmp.close) bmp.close();
  return { main: main.blob, thumb: thumb.blob, type, w: main.w, h: main.h,
           originalBytes: file.size, colour };
}

/* upload(sb, {ownerType, ownerId, kind, file, bucket}) -> the media row

   bucket: which bucket to write into, defaulting to the private one.

   ANYTHING THAT NEEDS APPROVING GOES TO media-pending, waits there, and is
   moved when a league administrator approves it. That is the whole point of the
   queue and every player photograph still takes that route.

   A CLUB CREST DOES NOT. It publishes the moment it is uploaded, so staging it
   in a private bucket and then moving it across is work done only to be undone
   — and the cross-bucket move is exactly what was failing with "new row
   violates row-level security policy" after a crest had been removed and
   another uploaded. Writing it where it is going to live deletes the operation
   rather than debugging it: no copy, no delete, no second set of permissions to
   satisfy, and no window in which the row and the file disagree about which
   bucket they are in — which is the fault this whole sequence started with.

   The destination policy is the same one the move needed, so nothing is
   loosened by arriving directly. */
async function upload(sb, opts) {
  const { ownerType, ownerId, kind } = opts;
  const bucket = opts.bucket || 'media-pending';
  const out = await prepare(opts.file, kind);
  const ext = out.type === 'image/svg+xml' ? 'svg'
            : out.type === 'image/webp' ? 'webp'
            : out.type === 'image/png' ? 'png' : 'jpg';
  const stamp = Date.now().toString(36);

  /* the path encodes the owner, which is what the storage policy reads to
     decide whether this person may write here at all */
  const base = `${ownerType}/${ownerId}`;
  const path = `${base}/${kind}-${stamp}.${ext}`;
  const thumbPath = `${base}/${kind}-${stamp}-thumb.${ext}`;

  const up = async (p, blob) => {
    const { error } = await sb.storage.from(bucket)
      .upload(p, blob, { contentType: out.type, upsert: false });
    if (error) throw new Error(error.message || 'upload refused');
  };
  await up(path, out.main);
  /* one file is every size for a vector, so there is no thumbnail to write */
  if (!out.vector) await up(thumbPath, out.thumb);

  /* THE COLUMNS ARE width AND height, and they always have been. This insert
     said w and h, so PostgREST rejected every upload the platform has ever
     attempted with "Could not find the 'h' column of 'media' in the schema
     cache" — a player photograph, a venue picture, a club crest, a league
     logo, every one of them, since the pipeline was written. The media table
     had nought rows in it, which is what that looks like from the outside.

     It survived because the failure is at the LAST step: the images resize,
     both files upload to storage successfully, and only the row that records
     them is refused. Everything looks like it is working until the error
     appears, and nothing that reads media ever had anything to read. */
  const { data, error } = await sb.from('media').insert({
    owner_type: ownerType, owner_id: ownerId, kind,
    storage_path: path, width: out.w, height: out.h, bytes: out.main.size,
    status: 'pending'
  }).select('*').single();
  if (error) throw new Error(error.message || 'could not record the upload');

  return Object.assign({}, data, {
    thumbPath: out.vector ? path : thumbPath,
    vector: !!out.vector,
    bucket,
    colour: out.colour || null,
    saved: out.originalBytes - out.main.size
  });
}

/* the public URL of an approved object; nothing else is reachable */
function publicUrl(cfg, path) {
  if (!path) return null;
  return `${cfg.supabaseUrl}/storage/v1/object/public/media-public/${path}`;
}

return { prepare, upload, publicUrl, dominantColour, SIZES, MAX_BYTES };
}));
