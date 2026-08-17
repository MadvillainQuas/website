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
  root.classList.add(q.get('l') ? 'm-league' : 'm-splash');

  /* An article was asked for, or it was not. Harmless on every page that is
     not the news archive, which is why one file answers both questions rather
     than each page carrying its own copy of this. */
  root.classList.add(q.get('a') ? 'm-article' : 'm-list');
}());
