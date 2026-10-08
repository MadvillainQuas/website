# jsRealB (vendored)

The English realiser the house voice (`epinoia/voice.js`) writes with: a SimpleNLG-style constituent grammar
(S / NP / VP, coordination, subordinate and relative clauses) that makes agreement, tense and aspect, negation,
modals, articles, number words, pronouns and the commas of coordination and subordination.

| | |
|---|---|
| file | `jsRealB.js` (the project's `dist/jsRealB.js`, 3,923,542 bytes) |
| version | 5.6.0 |
| source | https://github.com/rali-udem/jsRealB, commit `15014fe7027abcbfe466fc6d71b2129d28bb8744` (fetched 2026-10-08) |
| authors | Guy Lapalme and contributors, RALI, Université de Montréal |
| licence | code: Apache License 2.0 (`LICENSE.txt`, beside it); linguistic resources (the English lexicon bundled in the file): CC BY-SA 4.0 |

**Where it runs:** only in the hourly builder (`tools/build-narratives.mjs`, through `epinoia/voice.js`). It is
never shipped to a page: `tools/` is not deployed, and a page without it says only the phrasebook's canned options.

**Updating:** replace `jsRealB.js` with a newer `dist/jsRealB.js`, update the version and commit here, and run
`node supabase/tests/voice.test.mjs` and `node supabase/tests/newsroom.test.mjs`.
