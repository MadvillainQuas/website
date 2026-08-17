/* ============================================================================
   TALKING TO A PRINT-ON-DEMAND STORE.

   A wrong request here creates a REAL PRODUCT in somebody's REAL SHOP, on sale,
   pointing at the wrong artwork or priced at nothing. That cannot be undone
   from our side, which makes the request shapes worth asserting rather than
   discovering:

     * a variant id or a price missing, and the product going up anyway
     * Printify's two-step upload skipped, so the product has no artwork on it
       — the classic silent failure of that API
     * a mug sent with a "front" placement, which is accepted and ignored
     * a price in pennies where the provider wants pounds, or the reverse
     * a 200 with no product id in it being recorded as a success

   Run: node supabase/tests/merchstore.test.mjs
   ============================================================================ */
import {
  PROVIDERS, money, missing, printfulRequest, printifyRequests,
  requestsFor, readCreated, readUpload, withImageId
} from '../functions/_shared/merchstore.js';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (c, what) => { if (c) pass++; else { fail++; console.error(`  FAIL ${what}`); } };

const DESIGN = { kind: 'tee', teamName: 'East Dock',
                 artworkUrl: 'https://x.supabase.co/storage/v1/object/public/merch-print/l/t/tee.png',
                 fileName: 'ed-tee.png' };
const FULL = {
  apiKey: 'k-123', hasKey: true, storeId: '99', currency: 'GBP',
  catalogue: {
    tee:  { variants: [4011, 4012], price: 2500, blueprint: 5, printProvider: 29 },
    mug:  { variants: [7001], price: 1100, blueprint: 68, printProvider: 3 }
  }
};

console.log('money');
eq(money(2500), '25.00', 'pennies become pounds for Printful');
eq(money(999), '9.99', 'and round trip');
eq(money(0), '0.00', 'zero is zero');
eq(money(null), '0.00', 'and nothing is not NaN');

console.log('what is still missing');
{
  eq(missing('manual', 'tee', {}), [], 'doing it by hand needs nothing');
  const none = missing('printful', 'tee', { hasKey: false, catalogue: {} });
  ok(none.some(t => /API key/.test(t)), 'no key is named');
  ok(none.some(t => /catalogue ids/.test(t)), 'no catalogue is named');
  eq(missing('printful', 'tee', FULL), [], 'a complete Printful setup is complete');
  eq(missing('printify', 'tee', FULL), [], 'and a complete Printify one');
  const noShop = missing('printify', 'tee', { ...FULL, storeId: '' });
  ok(noShop.some(t => /shop id/.test(t)), 'Printify without a shop id is caught');
  const noPrice = missing('printful', 'tee',
    { ...FULL, catalogue: { tee: { variants: [1] } } });
  ok(noPrice.some(t => /price/.test(t)), 'a product with no price is caught — it would list at zero');
  const noVar = missing('printful', 'tee',
    { ...FULL, catalogue: { tee: { price: 100, variants: [] } } });
  ok(noVar.some(t => /variant/.test(t)), 'a product with no variants is caught');
  ok(missing('printful', 'scarf', FULL).length,
     'a kind with no catalogue entry is caught rather than guessed');
}

console.log('Printful');
{
  const [r] = printfulRequest(DESIGN, FULL);
  eq(r.method, 'POST', 'posts');
  ok(/api\.printful\.com\/store\/products$/.test(r.url), 'to the products endpoint');
  eq(r.headers.Authorization, 'Bearer k-123', 'bearer auth');
  eq(r.headers['X-PF-Store-Id'], '99', 'and names the store when there is one');
  eq(r.body.sync_variants.length, 2, 'one sync variant per catalogue variant');
  eq(r.body.sync_variants[0].variant_id, 4011, 'ids are numbers, not strings');
  eq(r.body.sync_variants[0].retail_price, '25.00', 'price as pounds');
  eq(r.body.sync_variants[0].files[0].url, DESIGN.artworkUrl, 'artwork by url');
  eq(r.body.sync_variants[0].files[0].type, 'front', 'a tee prints on the front');
  ok(/East Dock/.test(r.body.sync_product.name), 'the club is in the title');
  ok(/tee/i.test(r.body.sync_product.name), 'and so is the product');

  const mug = printfulRequest({ ...DESIGN, kind: 'mug' },
    { ...FULL, catalogue: { mug: FULL.catalogue.mug } })[0];
  eq(mug.body.sync_variants[0].files[0].type, 'default',
     'a mug has one print area called default — "front" is accepted and ignored, ' +
     'which is how you get a blank mug');

  const noStore = printfulRequest(DESIGN, { ...FULL, storeId: '' })[0];
  ok(!('X-PF-Store-Id' in noStore.headers), 'and no store header when there is no store');
}

console.log('Printify — the two steps');
{
  const rs = printifyRequests(DESIGN, FULL);
  eq(rs.length, 2, 'upload THEN create — one call would post a product with no artwork');
  eq(rs[0].step, 'upload', 'the image goes first');
  ok(/uploads\/images\.json$/.test(rs[0].url), 'to the uploads endpoint');
  eq(rs[0].body.url, DESIGN.artworkUrl, 'by url');
  eq(rs[0].yields, 'imageId', 'and yields the id the next step needs');

  eq(rs[1].step, 'create', 'then the product');
  ok(/\/shops\/99\/products\.json$/.test(rs[1].url), 'in the configured shop');
  eq(rs[1].body.blueprint_id, 5, 'blueprint as a number');
  eq(rs[1].body.print_provider_id, 29, 'print provider as a number');
  eq(rs[1].body.variants.map(v => v.id), [4011, 4012], 'every variant');
  eq(rs[1].body.variants[0].price, 2500, 'PENNIES for Printify, unlike Printful');
  ok(rs[1].body.variants.every(v => v.is_enabled), 'and enabled, or they do not appear');
  eq(rs[1].body.print_areas[0].variant_ids, [4011, 4012], 'the print area covers them all');
  eq(rs[1].body.print_areas[0].placeholders[0].images[0].id, '__imageId__',
     'with a placeholder for the uploaded id');
}

console.log('substituting the uploaded id');
{
  const rs = printifyRequests(DESIGN, FULL);
  const filled = withImageId(rs[1].body, 'img-abc');
  eq(filled.print_areas[0].placeholders[0].images[0].id, 'img-abc', 'the id lands');
  ok(!JSON.stringify(filled).includes('__imageId__'), 'and the placeholder is gone');
  eq(filled.blueprint_id, 5, 'nothing else moves');
  /* the original must not be mutated — the same prepared body is reused if a
     design is retried */
  eq(rs[1].body.print_areas[0].placeholders[0].images[0].id, '__imageId__',
     'and the prepared request is left alone for a retry');
}

console.log('reading the answer');
{
  eq(readUpload({ id: 'img-1' }), 'img-1', 'a bare upload response');
  eq(readUpload({ result: { id: 22 } }), '22', 'or a wrapped one, as a string');
  eq(readUpload({}), null, 'and nothing when there is nothing');

  const pf = readCreated('printful', { result: { sync_product: { id: 771 } } });
  eq(pf.id, '771', 'Printful id');
  ok(/printful\.com/.test(pf.url), 'with a link somebody can open');
  const pfy = readCreated('printify', { id: 'p-9', external: { handle: 'https://shop/x' } });
  eq(pfy.id, 'p-9', 'Printify id');
  eq(pfy.url, 'https://shop/x', 'and its storefront link when it has one');
  eq(readCreated('printify', { id: 'p-9' }).url, null,
     'a product not yet on a storefront has no link, rather than a made-up one');
  eq(readCreated('printful', {}).id, null,
     'a 200 with nothing in it yields no id — the caller treats that as a failure');
}

console.log('manual');
{
  eq(requestsFor('manual', DESIGN, FULL), [],
     'no store means no calls — the artwork IS the deliverable');
  eq(PROVIDERS, ['manual', 'printful', 'printify'], 'and the three are named');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
