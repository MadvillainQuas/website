# The page standard

Every page added to the site from 30 September 2026 is built this way. It is the look of HOME and a league's front page, written down so that each new page starts from it rather than from whatever the last page did.

`supabase/tests/page-standard.test.mjs` holds every page to it. Any new page that does not follow it fails `guard.yml`.

## The rules

1. **Centred.** Centre all of these:
   - the page's head;
   - every section's title and its subtitle, and whatever sits under them;
   - a list or a grid (in the middle of the page, never hanging from the left edge);
   - an empty state, in its dashed box.

   Long running text inside a card may stay left-aligned for reading. The page around it does not.
2. **No numbered sections.** A section's title is its name, and nothing before it: no `01`, `02`, no `.idx`, no CSS counters. The order of the page says the order.
3. **Every section has a subtitle.** One short line under the title, saying what the section holds: *The league's games nearest you, or nearest anywhere you are headed*. Write it this way:
   - sentence case, with no full stop at the end;
   - 70 characters or fewer;
   - never a count, a switch or a link. Those sit on the line under the subtitle.
4. **The head** is the page's name, with what it belongs to above it and what it is for below it:
   - `.pg-kick`: the league or club the page is about, linked to its page (optional on a platform page);
   - `h1`: the page's name in the title face. The kit gives it the gradient and teletext.css the sheen, in the league's colours on a league's page;
   - `.pg-sub`: one sentence saying what the page is for.
5. **Navigation comes from the teletext layer.** The frame carries `data-std`, and nav.js then adds:
   - the teletext line (the page's name, the date and the clock);
   - the four quick keys (the league's own when the page is about one);
   - **ON THIS PAGE**, listing every section shown;
   - a **SKIP** key on every section's title but the last.

   None of these is built by hand.
6. **A league's page wears the league's colours.** Read the whole row (`leagues?slug=eq.<slug>&select=*`) and pass it to `EpinoiaTeamColour.league(row, { keepAccent: !!(row.theme && row.theme.accent) })` (teamcolour.js), as the league's front page does. The title, the accent and the rail follow.
7. **A part with nothing to show** either stays away (`.hide`, and it leaves ON THIS PAGE with it) or shows `.pg-empty` saying how it will fill. There is never a title over nothing.
8. **Words.** Titles are a few words. Subtitles and empty states are plain sentences that say what is there, or what to do. British spelling.

## The sheets, in this order

```html
<link rel="stylesheet" href="../kit/epinoia-kit.css?v=…">
<link rel="stylesheet" href="../kit/nav.css?v=…">
<!-- the feature sheets the page uses (newscard.css, go/go.css …) -->
<link rel="stylesheet" href="../kit/page.css?v=…">        <!-- the standard's base -->
<!-- the page's own sheet, if it has one (kit/<page>.css), never a <style> copy of the base -->
<link rel="stylesheet" href="../kit/sectitle.css?v=…">    <!-- the centred title, no number -->
<link rel="stylesheet" href="../kit/teletext.css?v=…">    <!-- the mosaic, the index, SKIP -->
<link rel="stylesheet" href="../kit/legibility.css?v=…">  <!-- always last -->
```

`nav.js` is the last script, as on every page. A page about a league also loads `teamcolour.js` before its own script.

## The markup

```html
<div class="ep-frame" data-std>
  <div class="topbar">
    <a href="../home/" class="plain"><span class="wm epinoia-mark" aria-label="Epinoia">EPINOIΛ</span></a>
    <span id="ctx" class="ep-micro"></span>
  </div>

  <header class="hero pg-head">
    <p class="pg-kick"><a href="../?l=acb">Liga Endesa</a></p>
    <h1>Community</h1>
    <p class="pg-sub">Where Liga Endesa's fans meet: its games near you, and where they talk.</p>
  </header>

  <section class="sec" id="find" aria-labelledby="findH">
    <div class="sec-h"><h2 id="findH">Find a game</h2>
      <p class="note">The league's games nearest you, or nearest anywhere you are headed</p>
      <!-- optional, on the line under: a switch and a link -->
      <div class="pg-seg" role="group" aria-label="…"><button aria-pressed="true">Upcoming</button><button aria-pressed="false">Results</button></div>
      <a class="showall" href="…">all fixtures →</a>
    </div>
    <div class="sec-b">…</div>          <!-- .sec-b.narrow for a column of reading width -->
  </section>
</div>
```

Helpers in `kit/page.css`:
- `.pg-row`: a centred row of buttons or chips;
- `.pg-more`: a centred "more →" link under a section;
- `.pg-empty`: the empty state;
- `.pg-seg`: the switch;
- `.sec-b.narrow`: content at reading width, centred.

Each section has an `id`, which is the anchor ON THIS PAGE links to. A section's title is an `h2`, and the head's is the only `h1`.

## A new page, checked

- [ ] The frame has `data-std`, and the head is `header.hero.pg-head` with an `h1` and a `.pg-sub`.
- [ ] Every section is `.sec` with an `id`, and its `.sec-h` has an `h2` and a `.note` subtitle.
- [ ] No numbers before any title.
- [ ] `kit/page.css`, then `kit/sectitle.css`, then `teletext.css` and `legibility.css`, and no copy of their rules in the page.
- [ ] On a league's page: the league's colours (rule 6) and a `.pg-kick` naming the league.
- [ ] Empty parts are away or say how they will fill.
- [ ] It reads at 390 px as well as at a desktop's width.
- [ ] `node supabase/tests/page-standard.test.mjs` passes.

## The pages that came before it

- **Already on the look.** HOME, a league's front page, a player's page and Global fixtures already have it, through `kit/sectitle.css`, and the rest of the kit's `.ep-hdr` titles are centred and unnumbered.
- **Built on it.** The Community page (`community/`) is the first page built on this standard.
- **The rest.** Every other page keeps its look until it is next reworked. The test lists them as predating the standard: a page taken off that list must meet it, and a new page is never put on it.
