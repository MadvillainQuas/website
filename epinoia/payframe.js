'use strict';
/* ============================================================================
   THE PAYMENT FRAME (payframe.html; docs/memberships.md §12). Framed by the payment window (paywindow.js) on the page
   the fan is on. It says it is ready, takes { pk, cs, account } from that window, and only from a window of this
   same site, mounts Stripe's embedded Checkout with it, and tells the window its height (so the window fits it), when
   the payment is complete, or that it could not start (the window then uses Stripe's own page).
   ============================================================================ */
(function () {
  const ORIGIN = location.origin;
  const up = msg => { try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, ORIGIN); } catch (_) { /* no parent */ } };
  const host = document.getElementById('checkout');
  let started = false;
  function loadStripe() {
    return new Promise((res, rej) => {
      if (window.Stripe) { res(window.Stripe); return; }
      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = () => (window.Stripe ? res(window.Stripe) : rej(new Error('Stripe.js did not start')));
      s.onerror = () => rej(new Error('Stripe.js could not load'));
      document.head.appendChild(s);
    });
  }
  /* the window fits the frame to what Checkout draws, as it grows and shrinks */
  const report = () => up({ type: 'epinoia:payframe-height', h: Math.ceil(document.documentElement.scrollHeight) });
  try { new ResizeObserver(report).observe(document.body); } catch (_) { setInterval(report, 500); }
  window.addEventListener('message', async e => {
    if (e.origin !== ORIGIN || e.source !== window.parent || started) return;
    const d = e.data || {};
    if (d.type !== 'epinoia:pay' || typeof d.cs !== 'string' || !/^pk_(test|live)_[A-Za-z0-9]+$/.test(String(d.pk || ''))) return;
    started = true;
    try {
      const Stripe = await loadStripe();
      const stripe = Stripe(d.pk, d.account ? { stripeAccount: String(d.account) } : undefined);
      if (typeof stripe.initEmbeddedCheckout !== 'function') throw new Error('no embedded checkout');
      const checkout = await stripe.initEmbeddedCheckout({ fetchClientSecret: () => Promise.resolve(d.cs), onComplete: () => up({ type: 'epinoia:paid' }) });
      host.textContent = '';
      checkout.mount(host);
      report();
    } catch (err) {
      up({ type: 'epinoia:payframe-error', why: String((err && err.message) || err) });
    }
  });
  up({ type: 'epinoia:payframe-ready' });
})();
