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
    return { main: file, thumb: file, type: 'image/svg+xml', w: null, h: null,
             originalBytes: file.size, vector: true };
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
  if (bmp.close) bmp.close();
  return { main: main.blob, thumb: thumb.blob, type, w: main.w, h: main.h,
           originalBytes: file.size };
}

/* upload(sb, {ownerType, ownerId, kind, file}) -> the media row              */
async function upload(sb, opts) {
  const { ownerType, ownerId, kind } = opts;
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
    const { error } = await sb.storage.from('media-pending')
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
    saved: out.originalBytes - out.main.size
  });
}

/* the public URL of an approved object; nothing else is reachable */
function publicUrl(cfg, path) {
  if (!path) return null;
  return `${cfg.supabaseUrl}/storage/v1/object/public/media-public/${path}`;
}

return { prepare, upload, publicUrl, SIZES, MAX_BYTES };
}));
