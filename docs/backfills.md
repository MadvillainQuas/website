# The console's long jobs: filling in an older season, starting a league again

Two buttons in the consoles queue work that takes an hour or more:

| Button | Console | Queue | Worker |
|---|---|---|---|
| **Fill in an older season** | league console | `season_backfills` (0135, 0187) | `run_ingest.py --backfill` |
| **Start a league again** | platform console | `league_resets` (0187) | `reset_league.py --claim` |

Both run in `.github/workflows/console-jobs.yml`.

## When the worker starts (2026-10-02)

The workflow used to be started by its own ten-minute cron and nothing else. GitHub delivered 16 of those runs in 76 hours, with gaps of 2.8 to 7.2 hours. So a season somebody asked for could wait half a day while its console said "the worker looks every 10 minutes".

Now it is started as soon as something is queued. Every start is noted on the request (`dispatched_at`, 0217), and nothing starts it again for 15 minutes (3 for the console's button).

| Who starts it | When | What it needs |
|---|---|---|
| **The console's button** | the moment the request is queued | the `console-kick` Edge Function, set up (below) |
| **The live lane** (`ingest.yml`) | within two minutes; it runs around the clock | nothing new: the workflow's own token |
| **The workflow itself** | when it finishes and something is still queued | nothing new |
| **The cron** | every ten minutes, when GitHub delivers it | nothing: the floor |

`scripts/ingest/console_kick.py` does the starting for the live lane and the workflow. It is one `workflow_dispatch` call to GitHub, using only the standard library.

## What the worker does now

- **Two jobs**, reset and backfill, each with its own concurrency group. A league being started again no longer holds up another league's season.
- **Asks the queue first.** Each job checks the queue before it installs Chrome and the scraper, so a run with nothing to do costs a checkout and two requests.
- **Every queued season in turn.** The backfill job takes up to six seasons a run, oldest request first, across every league.
- **Says each step as it happens**, on the request:
  - taken by the worker, with a link to the run's log;
  - the sources to read;
  - each source's schedule, read and counted;
  - the fixtures being written;
  - then game *n* of *m*, with a percentage and a time left.
- **The log is unbuffered**, so it can be watched line by line from the console's link.
- **Nothing on the schedule is a failure, not "done".** A season the source shows nothing for is closed with the reason. It used to be "filled in: 0 of 0 games".

## What the console shows

- **Waiting to be started:** "Waiting for the worker to be started: usually within a few minutes, at most about an hour."
- **Started:** "Starting: the worker was started at 14:02 and usually begins within a couple of minutes."
- **In the queue:** how many requests are ahead of it (`season_backfill_queue`, 0217). The queue runs oldest first across every league, which a league's administrator could not see before.
- **Running:** the step, the bar, the time left, and the worker's log.

## Setting up the instant start (optional)

Without this, the live lane starts the worker within a few minutes, so everything above already works. With it, the button does.

1. On GitHub, create a fine-grained personal access token:
   - **Repository:** `MadvillainQuas/website` only;
   - **Permission:** "Actions: Read and write" and nothing else.
2. Give it to the function:
   ```
   npx supabase secrets set GITHUB_DISPATCH_TOKEN=<the token> GITHUB_REPO=MadvillainQuas/website
   npx supabase functions deploy console-kick
   ```
   `GITHUB_REF` (default `main`) names the branch the workflow runs from.

The same function also starts the report mailer (`report-mail.yml`) when the platform console's Reports by email asks to
**send next week's reports now** (0226, `docs/dashboard.md`): no second secret, no second function. Redeploy `console-kick`
once after pulling 0226 so it knows about it; without that the request waits for the mailer's half-hourly run.

## Deploying

```
npx supabase db push        # 0217: dispatched_at, season_backfill_queue
```

The workflows take effect from `main`.

## Tests

- `scripts/ingest/console_kick_test.py`:
  - who starts the worker, when, and what is noted;
  - the dispatch call and the light client;
  - the live lane's kick;
  - the worker's steps and the empty-season failure;
  - the workflow's shape.
- `supabase/tests/console-dispatch.test.mjs`: 0217 on PGlite (the queue position, who may ask) and the `console-kick` function.
- `supabase/tests/backfill-ui.test.mjs`: the console's wording, the log link, the kick on the press, and the queue position.
