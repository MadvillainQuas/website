'use strict';
/* ============================================================================
   WHICH PAGE THIS DOCUMENT IS — decided before the first paint.

   Two documents here each serve two pages, because in both cases the pair
   differ by a filter rather than by a design:

     /epinoia/        no ?l= is the platform splash; ?l=slug is that league's
                     front page. Two completely different designs in one file.
     /epinoia/news/   no ?a= is the archive; ?a=slug is one article.

   THE BUG THIS FIXES. Which one you get was decided in home.js and
   news-page.js, at the bottom of the body, behind sixteen synchronous script
   tags — 400kB of them, 207kB of Supabase alone. Measured on this machine, with
   no network latency at all: nothing ran until 3.5 seconds in. Until then the
   browser had already painted whatever the markup said, which was the league
   page — its wordmark, its fixture strip, its Games and Take part sections —
   and then JavaScript hid all of it and revealed the pool. Opening the splash
   showed a second of a different website first. Reported as exactly that: "it's
   almost like it's loading a different iteration of that page for a while".

   IT WAS NEVER A SLOW ANSWER, ONLY A LATE QUESTION. Both modes are decided by
   a URL parameter — no session, no round trip, nothing to wait for. So this
   runs from <head>, before the body is parsed, and puts the answer on the root
   element where CSS can act on it. The correct page is the first one painted,
   and the wrong one is never laid out at all.

   Deliberately not deferred and deliberately tiny. A blocking script in head is
   normally a thing to remove, but this one is a few hundred bytes on the same
   connection as the document, and it buys the removal of a full-page reflow
   that used to happen seconds later. Everything else on these pages is
   deferred; this is the one exception, and the reason it is the exception is
   that its whole job is to be finished before the first paint.

   NO STATE, NO STORAGE, NO NETWORK. It reads location.search and nothing else,
   which is what makes it safe to run this early: there is no failure mode where
   it hangs, and if it were somehow blocked the page still works — it just goes
   back to deciding late.
   ============================================================================ */
(function () {
  var root = document.documentElement;
  var q;
  try { q = new URLSearchParams(location.search); }
  catch (_) { return; }          /* ancient browser: fall back to the old path */

  /* A league was asked for, or it was not. An unknown slug is still "a league
     was asked for" — that case shows the hub with an error in it, which is the
     same layout as a league page and not the splash. */
  /* THE SPLASH IS MOTHBALLED (2026-10-06). The site's front door is now the Prophesy splash at the root
     (prophesyscouting.co.uk/), with EPINOIA, Learn more and Prophesy scouting on it. This document still serves every
     league's front page (?l=), so it stays; only its splash mode is retired: the bare /epinoia/ goes straight to
     Epinoia's HOME, before anything is painted. The splash's markup and scripts are left in place, unreached, and
     ?mothballed=1 still shows it for reference. */
  /* A COLLEGE SYSTEM IS NOT A LEAGUE PAGE (Louie, 2026-10-16: U SPORTS and NCAA D2 each "its own navigational splash
     page instead of being treated like a league page ... U Sports/NCAA D2 as a country"). ?college=<system> is its hub;
     a system league's own front page with no conference asked for (?l=u-sports) goes to the hub, before anything is
     painted; with one (?l=u-sports&conf=oua) it is that conference's page, a league page. The league -> system list is
     config.js EPINOIA_COLLEGE's (conferences.test.mjs holds the three copies to one another). */
  var COLLEGE = { 'u-sports': 'u-sports', 'ncaa-d2-men': 'ncaa-d2', 'ncaa-d2-women': 'ncaa-d2' };
  var front = /\/epinoia\/(index\.html)?$/.test(location.pathname);
  var lg = q.get('l');
  if (front && lg && COLLEGE[lg] && !q.get('conf')) {
    try {
      var u = new URL(location.href);
      u.searchParams.delete('l');
      u.searchParams.set('college', COLLEGE[lg]);
      if (COLLEGE[lg] === 'ncaa-d2') u.searchParams.set('g', /women/.test(lg) ? 'women' : 'men');
      location.replace(u.href);
      return;
    } catch (_) { /* the league page, as before */ }
  }
  var college = front && q.get('college');
  if (!lg && !college && q.get('mothballed') !== '1' && front) {
    try { location.replace(new URL('home/', location.href.split(/[?#]/)[0].replace(/index\.html$/, '')).href); return; } catch (_) { /* fall through to the old page */ }
  }
  root.classList.add(lg || college ? 'm-league' : 'm-splash');
  /* m-leaguepage: a league's own page (its groups, secgroups data-pgrp-if); m-college: a system's hub */
  root.classList.add(college ? 'm-college' : lg ? 'm-leaguepage' : 'm-none');

  /* An article was asked for, or it was not. Harmless on every page that is
     not the news archive, which is why one file answers both questions rather
     than each page carrying its own copy of this. */
  /* ...and on the news page, one publisher's story (?i=, where a notification lands) is one thing too */
  /* ...and one of the newsdesk's own pieces (?d=, newsroom.js) */
  root.classList.add(q.get('a') || ((q.get('i') || q.get('d')) && /\/news\//.test(location.pathname)) ? 'm-article' : 'm-list');
}());
