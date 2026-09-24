# Self-hosted runners

GitHub charges for Actions minutes on a private repository beyond the plan's allowance
(Pro: 3,000 a month). This repository uses about 1,600–2,100 minutes **a day**, mostly
the league ingest's live lane, so its Linux jobs run on one small server of our own
instead. Jobs on self-hosted runners are not billed.

## What runs where

| Workflow | Runner | Why |
|---|---|---|
| ingest, clubs, pages, guard | self-hosted, once `RUNS_ON` is set | the minutes |
| android | GitHub (ubuntu-latest) | Android SDK and Gradle; a few runs a month |
| ios | GitHub (macos) | needs a Mac |

`runs-on` in the first four reads the repository variable **`RUNS_ON`**:

- unset: GitHub's own runners, as before;
- `["self-hosted","linux","epinoia"]`: the server.

Switching back is deleting the variable. Nothing else changes.

```bash
gh variable set RUNS_ON --repo MadvillainQuas/website --body '["self-hosted","linux","epinoia"]'
gh variable delete RUNS_ON --repo MadvillainQuas/website
```

## The server

- x86-64 (Chrome has no Linux ARM build) Ubuntu 24.04, 2 vCPU / 4 GB at least.
- `setup-runner.sh` installs what GitHub's image had and a bare server lacks: Chrome,
  the gh CLI, libcairo2, and Python with requests. It adds a 4 GB swap file, turns on
  security updates and the firewall, and registers three runners as services under a
  `runner` account with no sudo.
- Three runners, because a live ingest pass holds one for up to five and a half hours.

Setting it up, from this PC once the server exists (`<IP>` is its address):

```bash
scp -i ~/.ssh/epinoia_runner tools/runner/setup-runner.sh root@<IP>:/root/
ssh -i ~/.ssh/epinoia_runner root@<IP> "RUNNER_TOKEN=$(gh api -X POST repos/MadvillainQuas/website/actions/runners/registration-token --jq .token) bash /root/setup-runner.sh"
```

Re-running it is safe. To add runners, run it again with a higher count.

## Things a datacenter address may not get

- **lnb.fr** refuses GitHub's runners (403), and may refuse this server too. The French
  leagues' live lane already runs on the processing PC (`scripts/ingest/live_lane.bat`).
- **YouTube** shows datacenter addresses a sign-in wall. The video worker runs on the PC.

## Removing it

On the server: in each `/home/runner/actions-runner-N`, run `./svc.sh stop`,
`./svc.sh uninstall`, then `sudo -u runner ./config.sh remove --token <removal token>`.
Get the removal token from
`gh api -X POST repos/MadvillainQuas/website/actions/runners/remove-token --jq .token`.
Then delete `RUNS_ON`.
