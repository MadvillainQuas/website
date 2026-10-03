# Deleting an account (2026-10-03, migration 0227)

A signed-in person deletes their own account from **Personalisation → Delete my account** (`me/`, `me.js`
`wireDelete`), in the browser or in the iOS and Android apps. It happens at once and cannot be undone, which is
what Apple (5.1.1(v)) and Google Play ask for. The privacy page's **Erase it** form (`privacy/#delete`, the address
Google Play is given) stays for whoever cannot use the button: signed out, a membership still running, an
administrator's own account. That form makes a request that a platform administrator handles in the console's privacy
queue (docs of 0120, "The data-rights queue").

## The flow

1. The page lists what goes and what stays, and asks for the address the person signs in with, typed (an account
   with no address types DELETE). The button stays off until it matches.
2. The page removes the **photographs' files** first (`go_my_photos`, the Storage API, `delete_go_photo`: the same
   steps as removing one photograph on GO), then sweeps their `go-pending` folder. Storage is not SQL's to delete
   from, and after the account is gone nothing proves whose a public file was.
3. `delete_my_account(p_confirm)` (security definer): refuses signed out; refuses a **platform administrator** (another
   administrator revokes the role first, as the console insists); refuses while a **membership is still running**
   (`access_active`, 0117: deleting the row would leave Stripe billing someone who is not there, so it is cancelled
   first); checks the typed address again; then `erase_account`.
4. The browser forgets the session (`epinoiaSignOut`) and the page says it is done.

The function takes the confirmation and nothing else, and uses `auth.uid()`: nobody can name another account.

## `erase_account(user, actor)`

The one place an account is deleted, whoever asked (the console's `platform_delete_account` goes through it too). Not
callable from a browser. In one transaction:

- the person's own **open erasure request** (about themselves, Epinoia the controller) is closed as completed, with the
  audit row the console writes for a close (not for an administrator's delete: they close it with their own words);
- what is keyed to the **address** rather than the account is deleted: grants (`access_grants`), scouts, front-office
  seats, outlet seats (`creator_members`), invitations (`pending_roles`) and the weekly report emails
  (`report_mail_subs`, with their log, files and requests): they would otherwise outlive the account and keep emailing it;
- the creator columns with no key to the account are cleared; the stored notification audience loses the account;
- one audit row, `privacy.erase`, with the account's id, no address, and the administrator's id when one did it;
- `delete from auth.users`: the profile, roles, follows, preferences, notifications, push subscriptions, stamps,
  GO rows, usernames, suggestions and billing rows go with it (`on delete cascade`).

## What stays

Games, scores, statistics and plays the account entered (`created_by` and its like are cleared: **set null**), the
record that the account was deleted (no name, no address), what the law has us keep, and **contact-form messages**
(read and answered by a person; there is no retention rule for them yet). **Stripe keeps its own customer record**
and payments for tax: deleting the customer there is a step in the Stripe dashboard.

## What was broken, and is mended

The console's delete **failed for any account that had ever made a club, a player, a game or a play**, uploaded or
approved a photograph, sent an announcement or an invitation, or released a player: eleven keys to `auth.users` had no
`ON DELETE` rule (so no action), against 0044's own comment, and `game_events`, which is append-only, refused even the
update that clears its `created_by`. A fan with nothing of the kind deleted fine, so it was never seen. 0227 makes those
keys `ON DELETE SET NULL` (any other single-column key that blocks and may be null, too) and gives
`forbid_event_mutation` one more exception: `created_by` cleared, while `epinoia.account_erasure` is set for the
transaction (the merge's exception, 0183, is as it was). The keys are added `NOT VALID`, so nothing is scanned and no
lock is held longer than the swap; validate them in a quiet moment if wanted (`alter table <t> validate constraint <name>`).
The console's audit row no longer carries the deleted address, which erasure must not keep.

## Not covered

- Files in other buckets (a league's media, report PDFs, creator media) stay as they are: they are the league's or the
  club's, and SQL does not write to `storage.objects` (Supabase refuses it; `console-audit` holds the repo to that).
  An administrator deleting a fan's account from the console does not remove that fan's GO photograph files: remove
  the photographs under Photographs first.
- A membership still running has to be cancelled first (Membership → Cancel membership), then the account can be
  deleted. Cancelling and deleting in one step needs a Stripe call from an Edge Function and is not built.

## Tests

`supabase/tests/delete-my-account.test.mjs`: on a real Postgres with every migration applied. An account that made a row
in each of the eleven tables is deleted and the rows stay nameless; the typed address; signed out, an administrator, a
running membership and an account with no address; what is keyed to the address; the open erasure request (and a
guardian's, which is not closed); the console's delete for a scorer; the event log still append-only. The page: the
section, the photographs' files first, the shared sign-out.
