'use strict';
/* ============================================================================
   STRUCTURED DATA AND LINK PREVIEWS.

   A box score gets shared. Somebody pastes the URL into a WhatsApp group, a
   club posts it on Facebook, a search engine finds it. What those three do
   with the link is decided by markup this page can add for itself.

   The honest limits, stated up front because they shape the design:

     THIS RUNS IN THE BROWSER, so it is invisible to the crawlers that do not
     execute JavaScript. Facebook and WhatsApp read the raw HTML and will see
     the generic tags in the document, not these. That is exactly what the
     static per-game pages in the publish queue are for, and they are the real
     fix. What this does buy is Google (which does render), the browser tab,
     and anything reading the page after load — which is most of the value for
     no server-side work at all.

     SO THE TAGS MUST BE HONEST RATHER THAN FLATTERING. A scheduled game says
     it is scheduled. A live one says the score is provisional. Writing a final
     score into a preview for a game still being played is how a widget starts
     lying on somebody else's page.

   Everything is set with textContent or setAttribute — never innerHTML — since
   team names come from user input.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSEO = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* one <meta> per property, created once and updated after */
function meta(attr, key, content) {
  if (content == null || content === '') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', String(content));
}

const ISO = d => { try { return new Date(d).toISOString(); } catch (_) { return null; } };

/* opts: { game, home, away, league, competition, venue, url } */
function game(opts) {
  const o = opts || {};
  const g = o.game || {};
  const home = o.home || {}, away = o.away || {};
  const hn = home.name || 'Home', an = away.name || 'Away';
  const url = o.url || location.href;

  const live = g.status === 'live';
  const done = g.status === 'final';

  const title = done
    ? `${hn} ${g.home_score}–${g.away_score} ${an}`
    : live
      ? `${hn} v ${an} — live`
      : `${hn} v ${an}`;

  /* A description that describes. "Box score" tells a reader nothing they did
     not get from the title; the state and the competition do. */
  const bits = [];
  if (o.competition) bits.push(o.competition);
  else if (o.league) bits.push(o.league);
  if (done) bits.push('Final');
  else if (live) bits.push('In progress — score is provisional');
  else if (g.tipoff_at) {
    try {
      bits.push(new Date(g.tipoff_at).toLocaleString('en-GB',
        { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
    } catch (_) { /* an unparseable date is better omitted than shown broken */ }
  }
  if (o.venue) bits.push(o.venue);
  bits.push('Full box score, play-by-play, shot chart and lineups.');
  const description = bits.join(' · ');

  meta('name', 'description', description);
  meta('property', 'og:type', 'website');
  meta('property', 'og:title', title);
  meta('property', 'og:description', description);
  meta('property', 'og:url', url);
  meta('property', 'og:site_name', 'Epinoia Network');
  /* The mark, so a shared link is not a blank card. An ABSOLUTE url, because a
     relative one is resolved against the scraper's own host and fetches
     nothing — which is how an og:image ends up silently doing nothing. */
  meta('property', 'og:image', new URL('../brand/epinoia-mark-512.png',
                                       location.href).toString());
  meta('name', 'twitter:card', 'summary');
  meta('name', 'twitter:title', title);
  meta('name', 'twitter:description', description);

  let canon = document.head.querySelector('link[rel="canonical"]');
  if (!canon) {
    canon = document.createElement('link');
    canon.rel = 'canonical';
    document.head.appendChild(canon);
  }
  canon.href = url;

  /* SportsEvent, which is the type search engines actually understand for a
     fixture. eventStatus and the scores are only asserted when they are true. */
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${hn} v ${an}`,
    url,
    sport: 'Basketball',
    startDate: ISO(g.tipoff_at) || undefined,
    /* schema.org's EventStatusType has no value for "already played" — the options
       are scheduled, cancelled, postponed, rescheduled and moved online. A
       game that happened when it said it would IS EventScheduled, and claiming
       anything else would be inventing vocabulary consumers do not read. */
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    competitor: [
      { '@type': 'SportsTeam', name: hn },
      { '@type': 'SportsTeam', name: an }
    ]
  };
  if (o.venue) {
    ld.location = { '@type': 'Place', name: o.venue };
  }
  if (done) {
    /* homeTeam/awayTeam only once we know which way round it ended, and the
       score as a plain string, which is the shape consumers expect */
    ld.homeTeam = { '@type': 'SportsTeam', name: hn };
    ld.awayTeam = { '@type': 'SportsTeam', name: an };
    ld.description = `${hn} ${g.home_score}, ${an} ${g.away_score}`;
  }
  if (o.competition) {
    ld.superEvent = { '@type': 'SportsEvent', name: o.competition };
  }

  jsonld('game', ld);
}

/* a league page describes the organisation rather than an event */
function league(opts) {
  const o = opts || {};
  const name = o.name || 'League';
  const url = o.url || location.href;
  const description = (o.season ? name + ' · ' + o.season + '. ' : name + '. ') +
    'Standings, fixtures, results and season statistics.';

  meta('name', 'description', description);
  meta('property', 'og:type', 'website');
  meta('property', 'og:title', name);
  meta('property', 'og:description', description);
  meta('property', 'og:url', url);
  meta('property', 'og:site_name', 'Epinoia Network');

  jsonld('league', {
    '@context': 'https://schema.org',
    '@type': 'SportsOrganization',
    name, url, sport: 'Basketball'
  });
}

/* JSON-LD goes in a script tag of its own, replaced rather than appended so a
   re-render cannot leave two contradictory blocks in the document */
function jsonld(id, obj) {
  const tag = 'epinoia-ld-' + id;
  let el = document.getElementById(tag);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = tag;
    document.head.appendChild(el);
  }
  /* JSON.stringify drops undefined keys, which is why they are set to
     undefined above rather than null — a null startDate is a claim, an absent
     one is not */
  el.textContent = JSON.stringify(obj);
}

return { game, league, meta, jsonld };
}));
