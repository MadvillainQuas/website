# Suggested edits

Migration **0199**. Some details can only be changed by a club, a league or the platform. Any signed-in fan can now **suggest** a correction to one of them, from the page they are reading. The suggestion goes to the moderators of the league it belongs to, and to the platform's. Nothing on the page changes until a moderator accepts it. Either way, the fan is told what was decided.

## What can be suggested, and where

| Page | On hover (with a mouse) | From the **suggest an edit** button |
| --- | --- | --- |
| A player's page (`p/`) | the name, the photograph, the height, the weight, the position | all of those, plus the wingspan and the previous club, which the page does not show |
| A club's page (`t/`) | the crest; each member of staff (their name, their role, or that they have left); the arena's name, address, and place on the map | all of those, plus someone missing from the staff and the arena's city |

- **Hover.** With a mouse, the detail gets a dashed outline and a **✎ suggest an edit** chip on its corner.
- **Button.** The button sits beside the follow bell. On a touch screen, which cannot hover, it is the only way in. It opens a picker of every suggestible detail on the page, grouped by who or what each one is about.
- **Club with no staff listed.** The page says so and offers **suggest a coach**. A club's own managers still edit the staff in place, so they are not offered suggestions on it.
- **Under 18.** No suggestion is ever offered about a player under 18, and the database refuses one. Their details are the league's alone.

## The dialog (`suggest.js`, `kit/suggest.css`)

- **What it says now.** The detail's current value is shown, then the new value is asked for in the form the database keeps it.
- **Measures.** A height, wingspan or weight can be typed in centimetres and kilograms, or in feet, inches and pounds. The dialog starts in whichever units the reader chose for the site (`units.js`). What is sent is always whole centimetres and kilograms.
- **A position** is chosen from the positions the database knows.
- **A name** is a first and a last name. Only the part that changed is sent.
- **A place on the map** can be the two numbers Google Maps copies when you right-click the arena, or a Google Maps link. For a link, the place inside it (`!3d…!4d…`) wins over the point the map was centred on (`@…`).
- **A new member of staff** is a name and a role.
- **A photograph or a crest** is a PNG, JPEG or WebP. It is resized in the browser (`upload.js`), which also drops its EXIF, and uploaded into the private bucket.
- **Note and source.** Every suggestion can carry a note for the moderators (up to 400 characters) and a source, which must be a web address.
- **Checks.** The dialog checks what it can before sending. The database checks everything again (`suggestion_value`): heights 100 to 260 cm, weights 30 to 250 kg, wingspans 120 to 280 cm, names made of letters, and a pin on the Earth that is not 0,0. It also refuses GO's word list, and a value that is what the page already says.
- **Signed out.** The dialog asks the fan to sign in and brings them back to the same page afterwards.
- **Language.** The dialog is translated into Spanish and Japanese, in its own `suggest` context in `i18n/es.js` and `i18n/ja.js`.

## Where a suggestion goes

The league a suggestion belongs to is found from its subject (`suggestion_owner`):

- a player: the club of their current squad entry;
- a member of staff: their club;
- an arena: the club whose home it is, or else the league of its most recent game.

That league's administrators see it in their console. The platform's administrators see every league's, plus any suggestion about something that belongs to no league.

- **League console.** A section called **Suggested edits**, next to Photographs.
- **Platform console.** **Moderation → Suggested edits** (`admin/suggestions-ui.js`).

Each suggestion shows:

- who or what it is about, linked to its page;
- the detail;
- what it says now, crossed out, and what the fan suggests;
- the fan's note and source, their username, and the date;
- how many other fans suggested the same.

**Fans who suggest the same thing are one row**, and they are decided together.

- **Accept.** The value goes in as suggested, or as the moderator corrects it in the box first. The database checks it again either way.
  - A height, weight, wingspan, name or previous club goes on the player.
  - A position goes on the player's current squad entry.
  - A new coach joins the staff, ranked by role the way the console ranks them (`staff_rank`).
  - A role changes, or someone is marked as having left the club.
  - An arena's name, address or city changes. A club linked to that arena which shows its own typed copy of the name or address gets the correction too.
  - A pin moves and is marked as set by hand.
- **Reject.** Nothing changes.
- **The fan is told.** Every fan behind the row gets a notification: "Your suggestion was accepted" or "Your suggestion was not taken". It includes the moderator's note, if one was written, and a link to the page. Every decision is written to the audit log.

## Photographs and crests

A suggested picture is decided in **Photographs** with every other upload, and only counted in Suggested edits.

- **Where the file goes.** It is written to the private bucket, in the subject's own folder, named `suggested-<random>` (for example `player/<id>/suggested-k3x9….webp`). The storage policy `media_pending_suggest` lets a signed-in fan write that one kind of file and nothing else. A player under 18 is refused there too.
- **The pending image.** `suggest_photo` checks that the file is there and belongs to the fan. It then records a pending image (a photograph for a player, a logo for a club) along with the suggestion.
- **In Photographs.** The row is marked **suggested by a fan**, with the fan's note, name and source.
- **The decision.** Approve and reject work as for any upload. Approving a crest makes it the club's crest. The suggestion follows the decision (a trigger on `media`), and the fan is told.

## Limits

- **Waiting suggestions.** A fan may have 30 suggestions waiting at once, and send 60 a day.
- **Waiting pictures.** A fan may have 5 pictures waiting.
- **Replacing a suggestion.** A fan's newer suggestion on a detail replaces their older one for that detail, so repeated tries leave one waiting.
- **Withdrawing.** A fan can withdraw their own waiting suggestion (`withdraw_suggestion`). `my_suggestions` lists what a fan sent and what became of each.
- **Access.** The table has row-level security on and no policy, so everything goes through the functions. A signed-out visitor can call none of them.

## Setting it up

1. Run `npx supabase@latest db push` after `supabase/migrations/0199_suggestions.sql` reaches the branch Supabase deploys from. It creates the table, the functions, the trigger on `media`, and the storage policy.
2. There is nothing to switch on. Until the migration is on the server:
   - the dialog says suggestions are not switched on yet;
   - the consoles say migration 0199 needs pushing.

## Tests

`supabase/tests/suggestions.test.mjs`, in `guard.yml`, runs in two parts.

- **The pages.** No database is needed. It checks:
  - the conversions and the pin reader;
  - that the fields, positions and reasons match the database's;
  - each page's wiring;
  - both consoles;
  - the translations.
- **The database.** It runs on a real Postgres (PGlite). It checks:
  - every check a value passes, and where each suggestion goes;
  - accepting with a correction, and rejecting;
  - that fans who say the same thing are decided as one;
  - the photograph route through Photographs;
  - the limits, and who may call what.
