# Player Stats Viewer data

`player_stats_viewer_pro.html` auto-loads its CSVs from **this folder** on page load.
Admins publish them straight from the viewer: open the Player Stats Viewer while
signed in as an admin, choose the files in the **Data Files** boxes, then click
**“⬆ Publish loaded CSVs to website.”** That commits them here via the GitHub API
(it reuses the same Personal Access Token as the rest of the admin tools), and
within ~30–60s every signed-in user's page loads them automatically.

You can also drop the files in here manually (GitHub web UI → *Add file → Upload files*).

## Expected files (exact names)

| File | Required | Powers |
|------|----------|--------|
| `player_stats.csv` | ✅ | The main All Players table |
| `team_totals.csv` | ✅ | Team context / advanced stats |
| `definitely_out.csv` | optional | **Free Agents** view |
| `job_market.csv` | optional | **Job Market** view |
| `raw_team_stats.csv` | optional | More accurate TOV / PACE |
| `raw_opponent_stats.csv` | optional | Opponent-adjusted numbers |
| `raw_player_stats.csv` | optional | Extra raw per-player stats |

Only `player_stats.csv` + `team_totals.csv` are needed for the basic view; the
rest unlock the extra view modes when present. Missing optional files are simply
skipped (no error).
