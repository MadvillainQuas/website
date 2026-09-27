'use strict';
/* ============================================================================
   UNITS - metric or imperial, one choice for the whole site.   window.EpinoiaUnits

   A height used to be printed twice ("206 cm · 6'9\"") and a weight once, in
   kilograms. Now the reader picks: centimetres and kilograms, or feet, inches
   and pounds. The choice is kept in this browser (localStorage) and every page
   that shows a height or a weight reads it from here, so setting it on a
   profile changes the roster and the stats tables too - and a page already open
   in another tab follows along (the storage event).

   The database always holds centimetres and kilograms; nothing here converts a
   value on its way in, only on its way to the screen.

     get()                    'metric' | 'imperial'
     set(u)                   saves it and tells every listener on the page
     onChange(fn)             fn(u) after each change, here or in another tab
     height(cm, u?)           '206 cm'  |  '6\'9"'
     weight(kg, u?)           '110 kg'  |  '243 lb'
     heightUnit(u?)           'cm' | 'ft·in'   (a column's title)
     weightUnit(u?)           'kg' | 'lb'
     toggle(opts?)            a small two-button switch that stays in step with the choice
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaUnits = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const KEY = 'epinoia.units';
const EVT = 'epinoia:units';
const LB_PER_KG = 2.20462;

const valid = u => (u === 'metric' || u === 'imperial');
let current = null;

function get() {
  if (current) return current;
  let u = null;
  try { u = root.localStorage && root.localStorage.getItem(KEY); } catch (_) { /* blocked storage: the default */ }
  current = valid(u) ? u : 'metric';
  return current;
}

function set(u) {
  if (!valid(u) || u === get()) return;
  current = u;
  try { root.localStorage && root.localStorage.setItem(KEY, u); } catch (_) { /* kept for this page only */ }
  announce();
}

function announce() {
  try { root.dispatchEvent && root.dispatchEvent(new CustomEvent(EVT, { detail: current })); } catch (_) { /* no DOM */ }
}

function onChange(fn) {
  if (typeof fn !== 'function' || !root.addEventListener) return () => {};
  const h = () => fn(get());
  root.addEventListener(EVT, h);
  return () => root.removeEventListener(EVT, h);
}

/* another tab changed it: take it up here too */
if (root.addEventListener) {
  root.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const u = valid(e.newValue) ? e.newValue : 'metric';
    if (u === current) return;
    current = u;
    announce();
  });
}

const num = v => (v == null || v === '' || !isFinite(v) || +v <= 0) ? null : +v;

function feetInches(cm) {
  const total = Math.round(cm / 2.54);
  return Math.floor(total / 12) + "'" + (total % 12) + '"';
}

function height(cm, u) {
  const v = num(cm);
  if (v == null) return '';
  return (u || get()) === 'imperial' ? feetInches(v) : Math.round(v) + ' cm';
}

function weight(kg, u) {
  const v = num(kg);
  if (v == null) return '';
  return (u || get()) === 'imperial' ? Math.round(v * LB_PER_KG) + ' lb' : Math.round(v) + ' kg';
}

const heightUnit = u => ((u || get()) === 'imperial' ? 'ft·in' : 'cm');
const weightUnit = u => ((u || get()) === 'imperial' ? 'lb' : 'kg');

/* THE SWITCH. Two buttons, the chosen one lit; pressing either sets the site-wide choice, and every
   switch on the page (and every other tab) moves with it. opts.className adds to the wrapper's class. */
function toggle(opts) {
  const o = opts || {};
  const doc = root.document;
  if (!doc) return null;
  const wrap = doc.createElement('span');
  wrap.className = 'ep-units' + (o.className ? ' ' + o.className : '');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'units');
  wrap.setAttribute('translate', 'no');
  wrap.title = 'Show heights and weights in metric or imperial — applies across the site';
  const btns = [['metric', 'cm · kg'], ['imperial', 'ft · lb']].map(([u, label]) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.units = u;
    b.textContent = label;
    b.addEventListener('click', () => set(u));
    wrap.appendChild(b);
    return b;
  });
  const paint = () => btns.forEach(b => {
    const on = b.dataset.units === get();
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  paint();
  onChange(paint);
  return wrap;
}

return { get, set, onChange, height, weight, heightUnit, weightUnit, toggle, KEY, LB_PER_KG };
}));
