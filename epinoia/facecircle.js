'use strict';
/* ============================================================================
   A FAN'S PHOTO CIRCLE — on the leaderboards, and in YOUR HUB's editor of their page (me/fanprofile.js).

   What it shows is the fan's choice (fan_profiles.circle, 0239: set in YOUR HUB, Your public page): their picture,
   the crest of the club they support, or their initials - ringed in their colour (else their club's, else a colour
   made from their name, so every fan is told apart at a glance). With no choice made: the picture when there is
   one, else the crest, else the initials. A picture that does not load falls back to the initials.

     EpinoiaFace.circle(face, name, { size })  -> <span class="ep-face">
        face: { avatar, colour, circle, club: { name, logo, colour, slug } } or null (a fan whose page is not public:
              their initials on the colour made from their name, nothing of theirs)
     EpinoiaFace.tint(face, name)               -> the ring's colour
     EpinoiaFace.mode(face)                     -> 'picture' | 'club' | 'initials'
   ============================================================================ */
(function (root) {
  const https = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || ''));
  const hex = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : null);
  /* a steady colour from a name: the same fan is the same colour on every board */
  function hashed(s) {
    let h = 0;
    for (const ch of String(s || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return 'hsl(' + (h % 360) + ' 62% 46%)';
  }
  const tint = (f, name) => (f && (hex(f.colour) || (f.club && hex(f.club.colour)))) || hashed(name);
  const logo = p => (p && typeof root.epinoiaLogoUrl === 'function' ? root.epinoiaLogoUrl(p, 96) : null);
  function mode(f) {
    if (!f) return 'initials';
    const has = { picture: https(f.avatar), club: !!(f.club && logo(f.club.logo)) };
    if (f.circle === 'initials') return 'initials';
    if (f.circle && has[f.circle]) return f.circle;
    return has.picture ? 'picture' : has.club ? 'club' : 'initials';
  }
  function initials(name) {
    const w = String(name || '').replace(/^@/, '').replace(/^fan-/, '').split(/[\s._-]+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '').slice(1, 2))).toUpperCase();
  }
  function circle(f, name, opts) {
    const o = opts || {};
    const s = document.createElement('span');
    const m = mode(f);
    s.className = 'ep-face m-' + m;
    s.setAttribute('aria-hidden', 'true');
    s.style.setProperty('--fc', tint(f, name));
    if (o.size) s.style.setProperty('--fs', o.size + 'px');
    const letters = () => { s.className = 'ep-face m-initials'; s.textContent = initials(name); };
    if (m === 'initials') { letters(); return s; }
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = m === 'picture' ? f.avatar : logo(f.club.logo);
    img.addEventListener('error', () => { img.remove(); letters(); }, { once: true });
    s.appendChild(img);
    return s;
  }
  root.EpinoiaFace = { circle, tint, mode, initials, hashed };
})(typeof window !== 'undefined' ? window : globalThis);
