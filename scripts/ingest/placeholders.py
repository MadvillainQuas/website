"""
Placeholder sides: what a fixture list calls a team that is not known yet.

A cup draw publishes its later rounds before anybody has won the earlier ones, so a
schedule lists "To be determined", "TBC", "Winner of QF1". Taken at face value those
become clubs: the SLB Trophy created a "To be determined" club with two fixtures of
its own on 17 September 2026. A placeholder is never a club, so nothing is created
for one, and a fixture that has one waits until the schedule names the side.

The same rule, character for character, is public.is_placeholder_team_name in the
database (migration 0126) and isPlaceholderTeam in epinoia/admin/admin.js; every copy
is tested against supabase/tests/fixtures/placeholder_teams.json.

Run the tests: python scripts/ingest/placeholders_test.py
"""
import re

# Applied to the normalised name: lower case, dots removed, runs of spaces made one.
PATTERNS = (
    r"^(team )?t ?b ?[dca]( ?[0-9]+)?( ?\(.*\))?$",                                   # TBD, TBC 1, T.B.A., Team TBD, TBD (Winner SF1)
    r"^to be (determined|confirmed|decided|announced|named|assigned|agreed)( .*)?$",  # To be determined
    r"^(winners?|losers?) (of )?(the )?(qf|sf|semi|quarter|final|game|match|round|tie|r[0-9]|g[0-9]|m[0-9]|#)",  # Winner of QF1
    r"^(qf|sf|semi ?-?final|quarter ?-?final|game|match|round|tie) ?[0-9]* (winners?|losers?)$",  # Semi-final 1 winner
    r"^(bye|unknown( team)?|placeholder|not yet (known|determined|decided))$",
    r"^t ?b ?[dca] vs?\.? t ?b ?[dca]$",                                                # TBD v TBD
)
_RE = re.compile("|".join("(?:" + p + ")" for p in PATTERNS))


def normalise(name) -> str:
    s = str(name or "").lower().replace(".", "")
    return re.sub(r"\s+", " ", s).strip()


def is_placeholder_team(name) -> bool:
    """True for a name that stands for a side not known yet. An empty name is not a
    placeholder here; callers already refuse a team with no name."""
    s = normalise(name)
    return bool(s) and _RE.search(s) is not None
