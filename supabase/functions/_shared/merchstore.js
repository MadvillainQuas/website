// ============================================================================
// TALKING TO A PRINT-ON-DEMAND STORE.
//
// PURE. Every function here takes a design and a configuration and returns the
// request somebody else will send — url, headers, body — so the shapes can be
// tested without a key, without a network, and without creating a real product
// in somebody's shop by accident. The posting lives in the `merch` function.
//
// TWO PROVIDERS, PLUS DOING IT BY HAND.
//
//   printful   one call. The product and its variants go up together, each
//              variant pointing at the print file by URL, which Printful
//              fetches itself.
//   printify   two calls. The image is uploaded first and comes back with an
//              id; the product then refers to that id. Skipping the upload and
//              passing a URL is the single most common way a Printify
//              integration silently creates a product with no artwork on it.
//   manual     no calls. The artwork is produced and left where a human can
//              download it. This is the honest default: a league with no store
//              account still gets print-ready files out of the pipeline, which
//              is most of the value, and nothing pretends to have published.
//
// THE CATALOGUE IDS ARE NOT GUESSABLE. Which integer means "unisex heavy
// cotton tee, black, large" is a fact about the provider's catalogue that
// changes without notice, so the league pastes them in from their own store
// and this validates that they are present rather than inventing them. A
// product created against a guessed variant id is a real product, in a real
// shop, that nobody can buy.
// ============================================================================

export const PROVIDERS = ['manual', 'printful', 'printify'];

/** Pennies -> the decimal string Printful wants. */
export const money = (pennies) => (Math.max(0, Math.round(pennies || 0)) / 100).toFixed(2);

/**
 * What a league still has to fill in before a kind can be published.
 * Returned as sentences, because this is shown to a person.
 */
export function missing(provider, kind, cfg) {
  const out = [];
  if (provider === 'manual') return out;
  const c = ((cfg && cfg.catalogue) || {})[kind];
  if (!cfg || !cfg.hasKey) out.push('an API key for ' + provider);
  if (!c) {
    out.push('catalogue ids for "' + kind + '" — paste them from your store');
    return out;
  }
  if (!Array.isArray(c.variants) || !c.variants.length) {
    out.push('at least one variant id for "' + kind + '"');
  }
  if (!c.price) out.push('a price for "' + kind + '"');
  if (provider === 'printify') {
    if (!cfg.storeId) out.push('the Printify shop id');
    if (!c.blueprint) out.push('the Printify blueprint id for "' + kind + '"');
    if (!c.printProvider) out.push('the Printify print provider id for "' + kind + '"');
  }
  return out;
}

const title = (d) => [d.teamName, KIND_TITLES[d.kind] || d.kind].filter(Boolean).join(' — ');

const KIND_TITLES = {
  tee: 'Match tee', hoodie: 'Terrace hoodie', scarf: 'Bar scarf',
  poster: 'Crest print', mug: 'Half-time mug'
};

/** Printful: one POST creates the product and all of its variants. */
export function printfulRequest(design, cfg) {
  const c = (cfg.catalogue || {})[design.kind] || {};
  const headers = {
    Authorization: 'Bearer ' + cfg.apiKey,
    'Content-Type': 'application/json'
  };
  if (cfg.storeId) headers['X-PF-Store-Id'] = String(cfg.storeId);
  return [{
    step: 'create',
    url: 'https://api.printful.com/store/products',
    method: 'POST',
    headers,
    body: {
      sync_product: { name: title(design), thumbnail: design.artworkUrl },
      sync_variants: c.variants.map((v) => ({
        variant_id: Number(v),
        retail_price: money(c.price),
        /* `type` is the placement. A garment's front is "front"; a mug and a
           poster have a single area the provider calls "default". Sending
           "front" for a mug is accepted and then ignored, which is how you
           get a blank mug. */
        files: [{ type: c.placement || defaultPlacement(design.kind),
                  url: design.artworkUrl }]
      }))
    }
  }];
}

const defaultPlacement = (kind) =>
  (kind === 'mug' || kind === 'poster' || kind === 'scarf') ? 'default' : 'front';

/** Printify: upload the image, then create the product against its id. */
export function printifyRequests(design, cfg) {
  const c = (cfg.catalogue || {})[design.kind] || {};
  const headers = {
    Authorization: 'Bearer ' + cfg.apiKey,
    'Content-Type': 'application/json'
  };
  const variantIds = c.variants.map(Number);
  return [
    {
      step: 'upload',
      url: 'https://api.printify.com/v1/uploads/images.json',
      method: 'POST',
      headers,
      body: { file_name: design.fileName, url: design.artworkUrl },
      /* the id from this response is substituted into the next request */
      yields: 'imageId'
    },
    {
      step: 'create',
      url: 'https://api.printify.com/v1/shops/' + cfg.storeId + '/products.json',
      method: 'POST',
      headers,
      body: {
        title: title(design),
        description: design.description || (design.teamName + ' — printed to order.'),
        blueprint_id: Number(c.blueprint),
        print_provider_id: Number(c.printProvider),
        variants: variantIds.map((id) => ({
          id, price: Math.round(c.price), is_enabled: true
        })),
        print_areas: [{
          variant_ids: variantIds,
          placeholders: [{
            position: c.placement || defaultPlacement(design.kind),
            images: [{
              id: '__imageId__',        // filled from the upload step
              x: 0.5, y: 0.5, scale: 1, angle: 0
            }]
          }]
        }]
      }
    }
  ];
}

export function requestsFor(provider, design, cfg) {
  if (provider === 'printful') return printfulRequest(design, cfg);
  if (provider === 'printify') return printifyRequests(design, cfg);
  return [];                               // manual: the artwork is the product
}

/**
 * Pull the product's id and its public link out of whatever the provider sent
 * back. Deliberately forgiving about shape and deliberately strict about the
 * result: a create that returns 200 with nothing usable in it is a failure,
 * not a success with blanks, or the catalogue fills up with rows that point
 * nowhere.
 */
export function readCreated(provider, body) {
  const r = (body && (body.result || body.data || body)) || {};
  if (provider === 'printful') {
    const p = r.sync_product || r;
    const id = p.id != null ? String(p.id) : null;
    return { id, url: id ? 'https://www.printful.com/dashboard/sync/' + id : null };
  }
  if (provider === 'printify') {
    const id = r.id != null ? String(r.id) : null;
    return {
      id,
      url: r.external && r.external.handle ? r.external.handle : null
    };
  }
  return { id: null, url: null };
}

export function readUpload(body) {
  const r = (body && (body.result || body)) || {};
  return r.id != null ? String(r.id) : null;
}

/** Substitute the uploaded image id into a prepared body. */
export function withImageId(body, imageId) {
  const s = JSON.stringify(body).split('"__imageId__"').join(JSON.stringify(imageId));
  return JSON.parse(s);
}
