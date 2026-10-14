# NCAA Division II: schools in the membership process (provisional), 2025-26 and 2026-27

A note for maintainers, not shipped. It backs `D2_PROVISIONAL` in `scripts/ingest/adapters/ncaa.py`.

**The rule (Louie, 2026-10-14).** A school's games count only in a season when it is a FULL (active) NCAA Division II
member. In its provisional (reclassifying) seasons its games are left out, for men and women alike. A school in the
process already plays in a Division II conference and is on the D2 scoreboards like any other, so the conference rule
(`outside_division`) cannot see it. It is left out by its ncaa.com scoreboard `seoname`, per season, keyed by the
season's start year (2025 = 2025-26).

**Keeping it current.** Each July the NCAA's Division II Membership Committee announces who becomes active on 1 September
and who enters or advances in the process. Add the new season's set to `D2_PROVISIONAL` then. A season with no entry
leaves nobody out, and the lane prints once per run that the table has no entry for it.

Membership is the institution's, so a school is provisional in men's and women's basketball alike. Every school below
appears on both the men's and the women's 2025-26 D2 scoreboards cached for the accuracy sample.

## 2025-26 (`D2_PROVISIONAL[2025]`)

| School | seoname | Status in 2025-26 | Full member from | Came from |
|---|---|---|---|---|
| University of Jamestown | `jamestown` | expedited, year 2 | 1 Sep 2026 | NAIA |
| UC Merced | `merced` | expedited, year 2 | 1 Sep 2026 | NAIA |
| UT Dallas | `texas-dallas` | expedited, year 2 | 1 Sep 2026 | Division III |
| Ferrum | `ferrum` | expedited, year 1 (accepted Feb 2025) | Aug 2027 | Division III |
| Roosevelt | `roosevelt-university` | three-year process, year 3 | 1 Sep 2026 | NAIA |
| Sul Ross State | `sul-ross-st` | three-year process, year 3 | 1 Sep 2026 | Division III |
| Point Park | `point-park` | three-year process, year 2 | 1 Sep 2026 (year 3 waived) | NAIA |
| Menlo | `menlo` | three-year process, year 2 repeated (see uncertain) | 11 Sep 2026 (after appeal) | NAIA |
| Middle Georgia State | `middle-georgia-st` | three-year process, year 1 | 2028-29 (planned) | NAIA |

**Full members in 2025-26 (they count):** Jessup (`jessup`), USC Beaufort (`usc-beaufort`), Thomas More
(`thomas-more`) and Vanguard (`vanguard`) became active on 1 Sep 2025. ncaa.com's men's box scores still carry no player
lines for Jessup and Vanguard (6507240, 6509044), so those games publish as a result only. That is the box's gap, not
membership.

## 2026-27 (`D2_PROVISIONAL[2026]`)

| School | seoname | Status in 2026-27 | Full member from | Came from |
|---|---|---|---|---|
| Middle Georgia State | `middle-georgia-st` | three-year process, year 2 | 2028-29 (planned) | NAIA |
| Ferrum | `ferrum` | expedited, year 2 (final) | Aug 2027 | Division III |
| Texas A&M-Texarkana | **unknown** | three-year process, year 1 | not before 2029-30 | NAIA |
| Shawnee State | **unknown** | expedited, year 1 | not before 2028-29 | NAIA |

**New full members in 2026-27 (they count):** Jamestown, Point Park, Roosevelt, Sul Ross State, UT Dallas and UC Merced
from 1 Sep 2026; Menlo from 11 Sep 2026.

## Uncertain

- **Shawnee State and Texas A&M-Texarkana have no known ncaa.com seoname.** On 2026-10-14 neither was on any
  scoreboard cached here, in ncaa.com's schools index (pages 17-19), or at `/schools/<guess>` (`shawnee-st`,
  `shawnee-state`, `tex-am-texarkana`, `texas-am-texarkana` and `am-texarkana` all return 404). They are listed in
  `D2_PROVISIONAL_PENDING[2026]` and left out BY CLUB NAME meanwhile (`club_name` of the scoreboard's nameShort,
  letters and digits only: "Shawnee St." -> "Shawnee State"). The first 2026-27 line that names one prints its
  seoname once a run ("... is seoname '...' - add it to adapters/ncaa.py D2_PROVISIONAL"); move it into
  `D2_PROVISIONAL[2026]` then. If ncaa.com writes either name in a form club_name does not turn into the names above,
  it is NOT caught - check the first scoreboard of the season.
- **Texas A&M-Texarkana's conference in 2026-27.** It joins the Lone Star Conference only on 1 Jul 2027, per the
  related-stories headline on the LSC release below. If it plays its 2026-27 games outside a D2 conference, the
  conference rule leaves those games out anyway.
- **Menlo's 2025-26 year.** The NCAA's July 2025 release says the committee "recommended that Menlo repeat provisional
  year two", subject to Management Council review on 21-22 July 2025. Menlo's athletics timeline calls 2025-26 year
  three. Either way Menlo was provisional in 2025-26.
- **Menlo's active date.** The NCAA's September 2026 release gives 11 Sep 2026. That is before the basketball season,
  so it is a full member for all of 2026-27.
- **The "full member from" dates for Shawnee State and Texas A&M-Texarkana** are the earliest the process allows. The
  NCAA gives no date for them.
- **2024-25 and earlier are not in the table.** A backfill of those seasons would count every school, including the ones
  then in the process (for example Jessup, Vanguard, USC Beaufort and Thomas More, active only from 1 Sep 2025). Add a
  2024 set from the NCAA's July 2024 release before backfilling.

## Sources

NCAA (first-party):

1. NCAA, 10 Jul 2025, "4 schools to become active DII members Sept. 1": Jessup, USC Beaufort, Thomas More and Vanguard
   active from 1 Sep 2025. It also lists the nine schools in the process in 2025-26 with their years: Roosevelt and
   Sul Ross State in year 3, Point Park in year 2, Menlo repeating year 2, Middle Georgia State accepted into year 1,
   Jamestown, UC Merced and Texas-Dallas in expedited year 2, Ferrum accepted into the expedited process.
   https://www.ncaa.org/media-center-4-schools-to-become-active-dii-members-sept-1/
2. NCAA, 12 Feb 2025, "Ferrum accepted into DII expedited membership process" (seen in search results, not opened;
   its content is restated by 1 and 10).
   https://www.ncaa.org/news/2025/2/12/media-center-ferrum-accepted-into-dii-expedited-membership-process.aspx
3. NCAA, 10 Jul 2026, "6 schools set to become active Division II members Sept. 1": Jamestown, Point Park, Roosevelt,
   Sul Ross State, UT Dallas and UC Merced. Menlo advanced to year 3, Middle Georgia State to year 2, Texas
   A&M-Texarkana accepted (joining the Lone Star Conference), Ferrum advanced to expedited year 2, Shawnee State accepted
   into the expedited process.
   https://www.ncaa.org/6-schools-set-to-become-active-division-ii-members-sept-1/
4. NCAA, 14 Sep 2026, "Menlo advances to active Division II membership status after appeal": active effective 11 Sep.
   https://www.ncaa.org/menlo-advances-to-active-division-ii-membership-status-after-appeal/
5. NCAA, 11 Feb 2026, "Shawnee State accepted into DII expedited membership process": entering 1 Sep 2026.
   https://www.ncaa.org/news/2026/2/11/media-center-shawnee-state-accepted-into-dii-expedited-membership-process.aspx

Conferences and schools (corroboration):

6. Lone Star Conference, 13 Jul 2026: Sul Ross State (transition from Sep 2023) and UT Dallas (from Sep 2024) active
   from 1 Sep 2026. The related-stories headline reads "Texas A&M University-Texarkana to join LSC membership July 1,
   2027".
   https://lonestarconference.org/news/2026/7/13/general-sul-ross-state-and-ut-dallas-gain-division-ii-active-member-status.aspx
7. D2Football, 11 Jul 2026: Jamestown (NSIC), Sul Ross (LSC) and Roosevelt (GLIAC) official members on 1 Sep 2026.
   https://www.d2football.com/jamestown-sul-ross-roosevelt-set-for-official-d2-membership/
8. Peach Belt Conference, 10 Jul 2025: Middle Georgia State, "Provisional Year 1" in 2025-26, full membership 2028-29.
   https://peachbeltconference.org/news/2025/7/10/general-mga-knights-begin-official-journey-to-ncaa-division-ii.aspx
   Peach Belt Conference, 10 Jul 2026: advanced to provisional year 2 (seen in search results, not opened; it agrees
   with 3).
   https://peachbeltconference.org/news/2026/7/10/general-mga-knights-advance-to-provisional-year-two-of-ncaa-division-ii-membership.aspx
9. Point Park University, 10 Jul 2026: full membership effective 1 Sep 2026, year 3 waived. Year 1 was 2024-25, and the
   criteria were completed in 2025-26.
   https://www.pointpark.edu/news/ncaa-membership
10. Ferrum College, 14 Jul 2026: final year of the expedited process from Aug 2026, full membership from Aug 2027.
    https://www.ferrum.edu/news/ferrum-enters-final-year-of-ncaa-division-ii-expedited-membership-process/
11. Menlo athletics, membership timeline: the year-three wording in the Uncertain section (seen in search results,
    not opened).
    https://menloathletics.com/sports/2024/1/30/ncaa-membership-process.aspx

The seonames come from the cached 2025-26 ncaa.com D2 scoreboards (men's and women's): `teams[].seoname` on every line
each school played.
