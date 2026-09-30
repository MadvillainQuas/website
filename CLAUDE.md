# Working on this repository

## Every new page follows the page standard

Read `docs/page-standard.md` before building or reworking a page under `epinoia/`. In short:

- the frame carries `data-std`, so nav.js adds the teletext line, the quick keys, ON THIS PAGE and each section's SKIP;
- the head is `header.hero.pg-head`: a `.pg-kick`, the `h1`, and a `.pg-sub`, all centred;
- the sections are `section.sec` with an `id`, each `.sec-h` holding an `h2` title and a `.note` subtitle. Titles are centred and never numbered;
- the stylesheets are `kit/page.css`, then `kit/sectitle.css`, then `kit/teletext.css` and `kit/legibility.css` (last). Their rules are never copied into a page;
- a league's page wears the league's colours (`teamcolour.js`, with the whole league row).

`supabase/tests/page-standard.test.mjs` enforces this. A new `index.html` that is not built to the standard fails it.
