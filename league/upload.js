'use strict';
/* ============================================================================
   COURTSIDE UPLOAD — resize in the browser, then send.

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
  else root.CourtsideUpload = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const SIZES = {
  photo: 800,     // player photograph, long edge
  logo:  512,     // club logo
  thumb:  96      // roster and table use
};
const MAX_BYTES = 2 * 1024 * 1024;   // matches the bucket limit in 0017

/* WebP where the browser has it, JPEG where it does not. Not PNG: a photograph
   as PNG is several times the size for no visible gain. */
function bestType() {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp' : 'image/jpeg';
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

/* ------------------------------------------------------------------ public ---
   prepare(file, kind)  ->  { main, thumb, type, w, h }                        */
async function prepare(file, kind) {
  if (!file || !/^image\//.test(file.type)) throw new Error('choose an image file');
  const edge = SIZES[kind] || SIZES.photo;
  const type = bestType();
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
  const ext = out.type === 'image/webp' ? 'webp' : 'jpg';
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
  await up(thumbPath, out.thumb);

  const { data, error } = await sb.from('media').insert({
    owner_type: ownerType, owner_id: ownerId, kind,
    storage_path: path, w: out.w, h: out.h, bytes: out.main.size,
    status: 'pending'
  }).select('*').single();
  if (error) throw new Error(error.message || 'could not record the upload');

  return Object.assign({}, data, {
    thumbPath,
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
