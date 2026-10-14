# NCAA Division II: club names (ncaa.com nameShort -> the club's name)

A note for maintainers, not shipped. It backs `club_name` and `CLUB_NAMES` in `scripts/ingest/adapters/ncaa.py`.

**Why.** Clubs are created from the scoreboard the first time a season is discovered. ncaa.com's `nameShort` is its own
column-width shorthand ("Bemidji St.", "Neb.-Kearney"). EPINOIA names a club as its league's box scores and media print
it, which for college basketball is the school's name ("Bemidji State", "Nebraska-Kearney"). No nickname is ever
invented or translated.

**Identity is unchanged.** The platform keys a club by its feed code (`feedplatform.team_code`): here the scoreboard's
`name6Char`, which is identical on the scoreboard line and in the game's own play-by-play and box documents. That was
checked on all 328 team entries of the 82 captured games: 0 differences in `name6Char` or `nameShort`. Six schools have an
empty `name6Char` (Jamestown, Jessup, UC Merced, Point Park, Roosevelt, Vanguard) and are keyed by the slug of their name.
Discovery (`_game`) and the game (`to_fiba`) both name them through `club_name`, so the two cannot make two clubs.

**The rules** (`club_name`):
- "St." is Saint as the first word of the name or of a part after a hyphen ("St. Cloud St.", "Concordia-St. Paul",
  "Mo.-St. Louis"), and State anywhere else.
- A state abbreviation is spelled out where it is part of the name. A disambiguator in brackets is left as written
  ("Lincoln (MO)", "Albany St. (GA)").
- "Int'l", "Sch." and "Univ." are spelled out.
- A school's own short form that is its name in print stays as it is ("UAH", "UIndy", "CSUSB", "UT Dallas").

**Exceptions** (`CLUB_NAMES`, by seoname) are listed below as "exception". Where a school's own athletics style was not
checked, ncaa.com's spelled-out form is used and the row is marked **?**.

**Accents.** The platform stores a club's name in ASCII (`names.team_name` latinises it), so "Puerto Rico-Bayamón"
becomes "Puerto Rico-Bayamon" on the site. That happens to every accented club name; changing it is a platform decision,
not this adapter's.

Coverage: every Division II team (conferenceSeo on ncaa.com's D2 conference list) on the 24 cached D2 scoreboard days
(15 men's, 9 women's, 16 Oct 2025 to 14 Nov 2026): 298 schools, 99 renamed. A school that joins later is named by the same
rules. Check the new ones against this list when a season starts.

| seoname | ncaa.com nameShort | club name | how | uncertain / source |
|---|---|---|---|---|
| `adams-st` | Adams St. | Adams State | rule |  |
| `adelphi` | Adelphi | Adelphi | as printed |  |
| `ala-huntsville` | UAH | UAH | as printed |  |
| `alas-anchorage` | Alas. Anchorage | Alaska Anchorage | rule |  |
| `alas-fairbanks` | Alas. Fairbanks | Alaska Fairbanks | rule |  |
| `albany-st-ga` | Albany St. (GA) | Albany State (GA) | rule |  |
| `allen` | Allen | Allen | as printed |  |
| `american-intl` | American Int'l | American International | rule |  |
| `anderson-sc` | Anderson (SC) | Anderson (SC) | as printed |  |
| `angelo-st` | Angelo St. | Angelo State | rule |  |
| `ark-fort-smith` | Ark.-Fort Smith | Arkansas-Fort Smith | rule |  |
| `ark-monticello` | Ark.-Monticello | Arkansas-Monticello | rule |  |
| `arkansas-tech` | Arkansas Tech | Arkansas Tech | as printed |  |
| `ashland` | Ashland | Ashland | as printed |  |
| `assumption` | Assumption | Assumption | as printed |  |
| `aub-montgomery` | AUM | AUM | as printed | **?** ncaa.com's short form; media also print "Auburn Montgomery" |
| `augustana-sd` | Augustana (SD) | Augustana (SD) | as printed |  |
| `barry` | Barry | Barry | as printed |  |
| `barton` | Barton | Barton | as printed |  |
| `belmont-abbey` | Belmont Abbey | Belmont Abbey | as printed |  |
| `bemidji-st` | Bemidji St. | Bemidji State | rule |  |
| `benedict` | Benedict | Benedict | as printed |  |
| `bentley` | Bentley | Bentley | as printed |  |
| `biola` | Biola | Biola | as printed |  |
| `black-hills-st` | Black Hills St. | Black Hills State | rule |  |
| `bloomsburg` | Bloomsburg | Bloomsburg | as printed |  |
| `bluefield-st` | Bluefield St. | Bluefield State | rule |  |
| `bowie-st` | Bowie St. | Bowie State | rule |  |
| `bridgeport` | Bridgeport | Bridgeport | as printed |  |
| `cal-poly-pomona` | Cal Poly Pomona | Cal Poly Pomona | as printed |  |
| `cal-st-dom-hills` | Cal St. Dom. Hills | Cal State Dominguez Hills | exception |  |
| `cal-st-east-bay` | Cal St. East Bay | Cal State East Bay | rule |  |
| `cal-st-la` | Cal State LA | Cal State LA | as printed |  |
| `cal-st-monterey-bay` | Cal St. Monterey Bay | Cal State Monterey Bay | rule |  |
| `cal-st-san-bdino` | CSUSB | CSUSB | as printed |  |
| `cal-st-san-marcos` | Cal St. San Marcos | Cal State San Marcos | rule |  |
| `cal-st-stanislaus` | Stanislaus St. | Stanislaus State | rule |  |
| `caldwell` | Caldwell | Caldwell | as printed |  |
| `california-pa` | California (PA) | California (PA) | as printed | **?** now PennWest California (ncaa.com's nameFull: "Pennsylvania Western University, California"); kept as ncaa.com prints it |
| `cameron` | Cameron | Cameron | as printed |  |
| `carson-newman` | Carson-Newman | Carson-Newman | as printed |  |
| `catawba` | Catawba | Catawba | as printed |  |
| `cedarville` | Cedarville | Cedarville | as printed |  |
| `central-mo` | Central Mo. | Central Missouri | rule |  |
| `central-okla` | Central Okla. | Central Oklahoma | rule |  |
| `central-st-oh` | Central St. (OH) | Central State (OH) | rule |  |
| `central-wash` | Central Wash. | Central Washington | rule |  |
| `chadron-st` | Chadron St. | Chadron State | rule |  |
| `chaminade` | Chaminade | Chaminade | as printed |  |
| `charleston-wv` | Charleston (WV) | Charleston (WV) | as printed |  |
| `chestnut-hill` | Chestnut Hill | Chestnut Hill | as printed |  |
| `chico-st` | Chico St. | Chico State | rule |  |
| `chowan` | Chowan | Chowan | as printed |  |
| `christian-bros` | Christian Brothers | Christian Brothers | as printed |  |
| `claflin` | Claflin | Claflin | as printed |  |
| `clarion` | Clarion | Clarion | as printed | **?** now PennWest Clarion; kept as ncaa.com prints it |
| `clark-atlanta` | Clark Atlanta | Clark Atlanta | as printed |  |
| `clayton-st` | Clayton St. | Clayton State | rule |  |
| `coker` | Coker | Coker | as printed |  |
| `colo-christian` | Colo. Christian | Colorado Christian | rule |  |
| `colorado-mesa` | Colorado Mesa | Colorado Mesa | as printed |  |
| `colorado-mines` | Colo. Sch. of Mines | Colorado School of Mines | rule |  |
| `colorado-st-pueblo` | CSU Pueblo | CSU Pueblo | as printed |  |
| `columbus-st` | Columbus St. | Columbus State | rule |  |
| `concord` | Concord | Concord | as printed |  |
| `concordia-irvine` | CUI | CUI | as printed | **?** ncaa.com's short form; media also print "Concordia Irvine" |
| `concordia-st-paul` | Concordia-St. Paul | Concordia-St. Paul | as printed |  |
| `converse` | Converse | Converse | as printed |  |
| `daemen` | Daemen | Daemen | as printed |  |
| `dallas-baptist` | DBU | DBU | as printed | **?** ncaa.com's short form; media also print "Dallas Baptist" |
| `davenport` | Davenport | Davenport | as printed |  |
| `davis-elkins` | Davis & Elkins | Davis & Elkins | as printed |  |
| `delta-st` | Delta St. | Delta State | rule |  |
| `dist-columbia` | Dist. Columbia | District of Columbia | exception | **?** the school's athletics brand as "UDC" (not checked); kept spelled out |
| `dominican-ca` | Dominican (CA) | Dominican (CA) | as printed |  |
| `dominican-ny` | Dominican (NY) | Dominican (NY) | as printed |  |
| `drury` | Drury | Drury | as printed |  |
| `dyouville` | D'Youville | D'Youville | as printed |  |
| `east-central` | East Central | East Central | as printed |  |
| `east-stroudsburg` | East Stroudsburg | East Stroudsburg | as printed |  |
| `eastern-nm` | Eastern N.M. | Eastern New Mexico | rule |  |
| `eckerd` | Eckerd | Eckerd | as printed |  |
| `edinboro` | Edinboro | Edinboro | as printed | **?** now PennWest Edinboro; kept as ncaa.com prints it |
| `edward-waters` | Edward Waters | Edward Waters | as printed |  |
| `elizabeth-city-st` | Elizabeth City St. | Elizabeth City State | rule |  |
| `embry-riddle-fl` | Embry-Riddle (FL) | Embry-Riddle (FL) | as printed |  |
| `emmanuel-ga` | Emmanuel (GA) | Emmanuel (GA) | as printed |  |
| `emory-henry` | Emory & Henry | Emory & Henry | as printed |  |
| `emporia-st` | Emporia St. | Emporia State | rule |  |
| `erskine` | Erskine | Erskine | as printed |  |
| `fairmont-st` | Fairmont St. | Fairmont State | rule |  |
| `fayetteville-st` | Fayetteville St. | Fayetteville State | rule |  |
| `felician` | Felician | Felician | as printed |  |
| `ferris-st` | Ferris St. | Ferris State | rule |  |
| `ferrum` | Ferrum | Ferrum | as printed |  |
| `findlay` | Findlay | Findlay | as printed |  |
| `fla-southern` | Fla. Southern | Florida Southern | rule |  |
| `flagler` | Flagler | Flagler | as printed |  |
| `florida-tech` | Florida Tech | Florida Tech | as printed |  |
| `fort-hays-st` | Fort Hays St. | Fort Hays State | rule |  |
| `fort-lewis` | Fort Lewis | Fort Lewis | as printed |  |
| `fort-valley-st` | Fort Valley St. | Fort Valley State | rule |  |
| `francis-marion` | Francis Marion | Francis Marion | as printed |  |
| `franklin-pierce` | Franklin Pierce | Franklin Pierce | as printed |  |
| `fresno-pacific` | Fresno Pacific | Fresno Pacific | as printed |  |
| `frostburg-st` | Frostburg St. | Frostburg State | rule |  |
| `ga-southwestern` | Ga. Southwestern | Georgia Southwestern | rule |  |
| `gannon` | Gannon | Gannon | as printed |  |
| `georgia-college` | Georgia College | Georgia College | as printed |  |
| `georgian-court` | Georgian Court | Georgian Court | as printed |  |
| `glenville-st` | Glenville St. | Glenville State | rule |  |
| `goldey-beacom` | Goldey-Beacom | Goldey-Beacom | as printed |  |
| `grand-valley-st` | Grand Valley St. | Grand Valley State | rule |  |
| `gru-augusta` | Augusta | Augusta | as printed |  |
| `harding` | Harding | Harding | as printed |  |
| `hawaii-hilo` | Hawaii Hilo | Hawaii Hilo | as printed | **?** the school may write "UH Hilo" or "Hawaiʻi Hilo" (not checked); kept ncaa.com's form |
| `hawaii-pacific` | Hawaii Pacific | Hawaii Pacific | as printed |  |
| `henderson-st` | Henderson St. | Henderson State | rule |  |
| `hillsdale` | Hillsdale | Hillsdale | as printed |  |
| `holy-family` | Holy Family | Holy Family | as printed |  |
| `humboldt-st` | Cal Poly Humboldt | Cal Poly Humboldt | as printed |  |
| `ill-springfield` | Ill. Springfield | Illinois Springfield | rule |  |
| `indiana-pa` | Indiana (PA) | Indiana (PA) | as printed |  |
| `indianapolis` | UIndy | UIndy | as printed |  |
| `jamestown` | Jamestown | Jamestown | as printed |  |
| `jessup` | Jessup | Jessup | as printed |  |
| `johnson-c-smith` | Johnson C. Smith | Johnson C. Smith | as printed |  |
| `kentucky-st` | Kentucky St. | Kentucky State | rule |  |
| `king-tn` | King (TN) | King (TN) | as printed |  |
| `kutztown` | Kutztown | Kutztown | as printed |  |
| `ky-wesleyan` | Ky. Wesleyan | Kentucky Wesleyan | rule |  |
| `lake-erie` | Lake Erie | Lake Erie | as printed |  |
| `lake-superior-st` | Lake Superior St. | Lake Superior State | rule |  |
| `lander` | Lander | Lander | as printed |  |
| `lane` | Lane | Lane | as printed |  |
| `lee` | Lee | Lee | as printed |  |
| `lees-mcrae` | Lees-McRae | Lees-McRae | as printed |  |
| `lemoyne-owen` | LeMoyne-Owen | LeMoyne-Owen | as printed |  |
| `lenoir-rhyne` | Lenoir-Rhyne | Lenoir-Rhyne | as printed |  |
| `lewis` | Lewis | Lewis | as printed |  |
| `lincoln-memorial` | Lincoln Memorial | Lincoln Memorial | as printed |  |
| `lincoln-mo` | Lincoln (MO) | Lincoln (MO) | as printed |  |
| `lincoln-pa` | Lincoln (PA) | Lincoln (PA) | as printed |  |
| `livingstone` | Livingstone | Livingstone | as printed |  |
| `lock-haven` | Lock Haven | Lock Haven | as printed |  |
| `lubbock-christian` | Lubbock Christian | Lubbock Christian | as printed |  |
| `lynn` | Lynn | Lynn | as printed |  |
| `malone` | Malone | Malone | as printed |  |
| `mansfield` | Mansfield | Mansfield | as printed |  |
| `mars-hill` | Mars Hill | Mars Hill | as printed |  |
| `mary` | Mary | Mary | as printed |  |
| `maryville-mo` | Maryville (MO) | Maryville (MO) | as printed |  |
| `mckendree` | McKendree | McKendree | as printed |  |
| `menlo` | Menlo | Menlo | as printed |  |
| `merced` | UC Merced | UC Merced | as printed |  |
| `mercy` | Mercy | Mercy | as printed |  |
| `metro-st` | MSU Denver | MSU Denver | as printed |  |
| `michigan-tech` | Michigan Tech | Michigan Tech | as printed |  |
| `middle-georgia-st` | Middle Georgia | Middle Georgia State | exception | ncaa.com nameFull "Middle Georgia State University" |
| `midwestern-st` | Midwestern St. | Midwestern State | rule |  |
| `miles` | Miles | Miles | as printed |  |
| `millersville` | Millersville | Millersville | as printed |  |
| `minn-crookston` | Minn.-Crookston | Minnesota-Crookston | rule | **?** the school may write "Minnesota Crookston" with no hyphen (not checked); kept ncaa.com's hyphen |
| `minn-duluth` | Minn. Duluth | Minnesota Duluth | rule |  |
| `minn-st-mankato` | Minnesota St. | Minnesota State | rule |  |
| `minn-st-moorhead` | MSU Moorhead | MSU Moorhead | as printed |  |
| `minot-st` | Minot St. | Minot State | rule |  |
| `mississippi-christ` | Mississippi Christian | Mississippi Christian | as printed |  |
| `missouri-snt` | Missouri S&T | Missouri S&T | as printed |  |
| `mo-southern-st` | Mo. Southern St. | Missouri Southern State | rule |  |
| `mo-st-louis` | Mo.-St. Louis | Missouri-St. Louis | rule | **?** the school brands as "UMSL" (not checked); kept spelled out |
| `mo-western-st` | Missouri Western | Missouri Western | as printed |  |
| `molloy` | Molloy | Molloy | as printed |  |
| `mont-st-billings` | Mont. St. Billings | Montana State Billings | rule |  |
| `montevallo` | Montevallo | Montevallo | as printed |  |
| `morehouse` | Morehouse | Morehouse | as printed |  |
| `mount-olive` | Mount Olive | Mount Olive | as printed |  |
| `neb-kearney` | Neb.-Kearney | Nebraska-Kearney | rule | **?** the school may write "Nebraska Kearney" with no hyphen (not checked); kept ncaa.com's hyphen |
| `newberry` | Newberry | Newberry | as printed |  |
| `newman` | Newman | Newman | as printed |  |
| `nm-highlands` | N.M. Highlands | New Mexico Highlands | rule |  |
| `north-georgia` | North Georgia | North Georgia | as printed |  |
| `north-greenville` | North Greenville | North Greenville | as printed |  |
| `northeastern-st` | Northeastern St. | Northeastern State | rule |  |
| `northern-mich` | Northern Mich. | Northern Michigan | rule |  |
| `northern-st` | Northern St. | Northern State | rule |  |
| `northwest-mo-st` | Northwest Mo. St. | Northwest Missouri State | rule |  |
| `northwest-nazarene` | Northwest Nazarene | Northwest Nazarene | as printed |  |
| `northwestern-okla` | Northwestern Okla. | Northwestern Oklahoma State | exception | ncaa.com nameFull "Northwestern Oklahoma State University" |
| `northwood-mi` | Northwood | Northwood | as printed |  |
| `nova-southeastern` | Nova Southeastern | Nova Southeastern | as printed |  |
| `ohio-dominican` | Ohio Dominican | Ohio Dominican | as printed |  |
| `okla-baptist` | Okla. Baptist | Oklahoma Baptist | rule |  |
| `okla-christian` | Okla. Christian | Oklahoma Christian | rule |  |
| `ouachita-baptist` | Ouachita Baptist | Ouachita Baptist | as printed |  |
| `pace` | Pace | Pace | as printed |  |
| `palm-beach-atl` | Palm Beach Atl. | Palm Beach Atlantic | exception |  |
| `philadelphia-u` | Jefferson | Jefferson | as printed |  |
| `pitt-johnstown` | Pitt.-Johnstown | Pittsburgh-Johnstown | exception | **?** the school's own athletics write "Pitt-Johnstown" (not checked on its site); kept spelled out |
| `pittsburg-st` | Pittsburg St. | Pittsburg State | rule |  |
| `point-loma` | Point Loma | Point Loma | as printed |  |
| `point-park` | Point Park | Point Park | as printed |  |
| `post` | Post | Post | as printed |  |
| `pr-bayamon` | P.R.-Bayamon | Puerto Rico-Bayamón | exception | **?** the school's style may be "UPR Bayamón" (not checked); the accent is the town's own spelling, and the platform stores club names in ASCII ("Bayamon") |
| `pr-mayaguez` | P.R.-Mayaguez | Puerto Rico-Mayagüez | exception | **?** as Bayamón: style may be "UPR Mayagüez" (not checked); stored as "Mayaguez" |
| `pr-rio-piedras` | P.R.-Rio Piedras | Puerto Rico-Río Piedras | exception | **?** as Bayamón: style may be "UPR Río Piedras" (not checked); stored as "Rio Piedras" |
| `purdue-northwest` | Purdue Northwest | Purdue Northwest | as printed |  |
| `queens-ny` | Queens (NY) | Queens (NY) | as printed |  |
| `quincy` | Quincy | Quincy | as printed |  |
| `regis-co` | Regis (CO) | Regis (CO) | as printed |  |
| `roberts-wesleyan` | Roberts Wesleyan | Roberts Wesleyan | as printed |  |
| `rockhurst` | Rockhurst | Rockhurst | as printed |  |
| `rogers-st` | Rogers St. | Rogers State | rule |  |
| `rollins` | Rollins | Rollins | as printed |  |
| `roosevelt-university` | Roosevelt | Roosevelt | as printed |  |
| `saginaw-valley` | Saginaw Valley | Saginaw Valley | as printed |  |
| `saint-leo` | Saint Leo | Saint Leo | as printed |  |
| `saint-martins` | Saint Martin's | Saint Martin's | as printed |  |
| `saint-michaels` | Saint Michael's | Saint Michael's | as printed |  |
| `salem-intl` | Salem (WV) | Salem (WV) | as printed |  |
| `san-fran-st` | San Fran. St. | San Francisco State | exception |  |
| `savannah-st` | Savannah St. | Savannah State | rule |  |
| `sc-aiken` | USC Aiken | USC Aiken | as printed |  |
| `seattle-pacific` | Seattle Pacific | Seattle Pacific | as printed |  |
| `seton-hill` | Seton Hill | Seton Hill | as printed |  |
| `shaw` | Shaw | Shaw | as printed |  |
| `shepherd` | Shepherd | Shepherd | as printed |  |
| `shippensburg` | Shippensburg | Shippensburg | as printed |  |
| `shorter` | Shorter | Shorter | as printed |  |
| `simon-fraser` | Simon Fraser | Simon Fraser | as printed |  |
| `sioux-falls` | Sioux Falls | Sioux Falls | as printed |  |
| `slippery-rock` | Slippery Rock | Slippery Rock | as printed |  |
| `south-dakota-mines` | South Dakota Mines | South Dakota Mines | as printed |  |
| `southeastern-okla` | Southeastern Okla. | Southeastern Oklahoma State | exception | **?** Southeastern Oklahoma State University: the institution's name (not in any captured document) |
| `southern-ark` | Southern Ark. | Southern Arkansas | rule |  |
| `southern-conn-st` | Southern Conn. St. | Southern Connecticut State | rule |  |
| `southern-nazarene` | Southern Nazarene | Southern Nazarene | as printed |  |
| `southern-nh` | Southern N.H. | Southern New Hampshire | rule |  |
| `southern-wesleyan` | Southern Wesleyan | Southern Wesleyan | as printed |  |
| `southwest-baptist` | Southwest Baptist | Southwest Baptist | as printed |  |
| `southwest-minn-st` | Southwest Minn. St. | Southwest Minnesota State | rule |  |
| `southwestern-okla` | Southwestern Okla. | Southwestern Oklahoma State | exception | **?** Southwestern Oklahoma State University: the institution's name (not in any captured document) |
| `spring-hill` | Spring Hill | Spring Hill | as printed |  |
| `st-anselm` | Saint Anselm | Saint Anselm | as printed |  |
| `st-cloud-st` | St. Cloud St. | St. Cloud State | rule |  |
| `st-edwards` | St. Edward's | St. Edward's | as printed |  |
| `st-marys-tx` | St. Mary's (TX) | St. Mary's (TX) | as printed |  |
| `st-thomas-aquinas` | St. Thomas Aquinas | St. Thomas Aquinas | as printed |  |
| `staten-island` | Staten Island | Staten Island | as printed |  |
| `sul-ross-st` | Sul Ross St. | Sul Ross State | rule |  |
| `tampa` | Tampa | Tampa | as printed |  |
| `tex-am-intl` | Tex. A&M Int'l | Texas A&M International | rule |  |
| `tex-am-kingsville` | Tex. A&M-Kingsville | Texas A&M-Kingsville | rule |  |
| `tex-permian-basin` | UT Permian Basin | UT Permian Basin | as printed |  |
| `texas-dallas` | UT Dallas | UT Dallas | as printed |  |
| `texas-tyler` | UT Tyler | UT Tyler | as printed |  |
| `texas-womans` | Texas Woman's | Texas Woman's | as printed |  |
| `thomas-more` | Thomas More | Thomas More | as printed |  |
| `tiffin` | Tiffin | Tiffin | as printed |  |
| `trevecca-nazarene` | Trevecca Nazarene | Trevecca Nazarene | as printed |  |
| `truman` | Truman St. | Truman State | rule |  |
| `tusculum` | Tusculum | Tusculum | as printed |  |
| `tuskegee` | Tuskegee | Tuskegee | as printed |  |
| `uc-colo-springs` | UCCS | UCCS | as printed |  |
| `unc-pembroke` | UNC Pembroke | UNC Pembroke | as printed |  |
| `union-tn` | Union (TN) | Union (TN) | as printed |  |
| `upper-iowa` | Upper Iowa | Upper Iowa | as printed |  |
| `ursuline` | Ursuline | Ursuline | as printed |  |
| `usc-beaufort` | USC Beaufort | USC Beaufort | as printed |  |
| `uva-wise` | UVA Wise | UVA Wise | as printed |  |
| `valdosta-st` | Valdosta St. | Valdosta State | rule |  |
| `vanguard` | Vanguard | Vanguard | as printed |  |
| `virginia-st` | Virginia St. | Virginia State | rule |  |
| `virginia-union` | Virginia Union | Virginia Union | as printed |  |
| `walsh` | Walsh | Walsh | as printed |  |
| `washburn` | Washburn | Washburn | as printed |  |
| `wayne-st-mi` | Wayne St. (MI) | Wayne State (MI) | rule |  |
| `wayne-st-ne` | Wayne St. (NE) | Wayne State (NE) | rule |  |
| `west-ala` | West Ala. | West Alabama | rule |  |
| `west-chester` | West Chester | West Chester | as printed |  |
| `west-liberty` | West Liberty | West Liberty | as printed |  |
| `west-tex-am` | West Tex. A&M | West Texas A&M | rule |  |
| `west-va-wesleyan` | West Va. Wesleyan | West Virginia Wesleyan | rule |  |
| `west-virginia-st` | West Virginia St. | West Virginia State | rule |  |
| `western-nm` | Western N.M. | Western New Mexico | rule |  |
| `western-ore` | Western Ore. | Western Oregon | rule |  |
| `western-st` | Western Colo. | Western Colorado | rule |  |
| `western-wash` | Western Wash. | Western Washington | rule |  |
| `westminster-ut` | Westminster (UT) | Westminster (UT) | as printed |  |
| `westmont-college` | Westmont | Westmont | as printed |  |
| `wheeling-jesuit` | Wheeling | Wheeling | as printed |  |
| `william-jewell` | William Jewell | William Jewell | as printed |  |
| `wilmington-de` | Wilmington (DE) | Wilmington (DE) | as printed |  |
| `wingate` | Wingate | Wingate | as printed |  |
| `winona-st` | Winona St. | Winona State | rule |  |
| `winston-salem` | Winston-Salem | Winston-Salem | as printed |  |
| `wis-parkside` | Wis.-Parkside | Wisconsin-Parkside | rule | **?** the school's athletics may brand as "Parkside" (not checked) |
| `young-harris` | Young Harris | Young Harris | as printed |  |
