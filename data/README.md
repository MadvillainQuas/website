# /data — CSV files for the live site

The two web apps look here on every page load and pull whatever CSVs they
find. Drop in a file with one of the names below and every visitor will
see the data after the next GitHub Pages deploy (~30–90 seconds).

You don't need a working copy of the repo to update these — go to GitHub
in a browser, open this folder, click **Add file → Upload files**, drag
the new CSV in, and **Commit changes**.

## Prophesy Shortlist (`basketball-analyzer-profiles_9.html`)

| File                    | Required? | Purpose                                    |
| ----------------------- | --------- | ------------------------------------------ |
| `offense.csv`           | yes       | Per-player offensive possessions / stats   |
| `defense.csv`           | yes       | Per-player defensive possessions / stats   |
| `team-utilities.csv`    | optional  | Team-level utility / pace data             |
| `player-utilities.csv`  | optional  | Per-player utility data (linked offences)  |

## Lineup Analyzer (`index_9.html`)

| File                                  | Required? | Purpose                              |
| ------------------------------------- | --------- | ------------------------------------ |
| `lineup_stats_enhanced.csv`           | yes       | Lineup totals — the core dataset     |
| `player_stats_enhanced.csv`           | yes       | Per-player season stats              |
| `player_lineup_stats_enhanced.csv`    | yes       | Per-player lineup splits             |
| `lineup_matchups.csv`                 | optional  | Matchup-level lineup splits          |
| `lineup_assist_combinations.csv`      | optional  | Assist combinations (alt: `assist_combinations.csv`) |
| `clutch_lineup_stats.csv`             | optional  | Clutch-only lineup splits            |
| `stints.csv`                          | optional  | Lineup stints                        |
| `player_stints.csv`                   | optional  | Per-player stint durations           |
| `team_totals.csv`                     | optional  | Team game-level totals               |
| `play_by_play.csv`                    | optional  | Play-type / play-by-play (alt: `playbyplay.csv`) |

## Notes

- The exact format must match what the apps expect (i.e. the same headers
  the in-app upload buttons accept). The simplest way to produce a valid
  CSV is to export it from whichever scraper / pipeline you use locally.
- File names are case-sensitive on GitHub Pages.
- If any of these files are missing the app falls back to its empty
  state and the upload buttons in the Settings tab still work for ad-hoc
  testing.
