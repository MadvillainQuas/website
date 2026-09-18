#!/usr/bin/env python3
"""A repeated, generically-labelled shot coordinate is not an observation.

    python scripts/ingest/translate/shot_dup_test.py

LNB's under-21 feed names 92% of its shots the generic "jumpshot" and places dozens of them at
a handful of points sitting almost on the rim, reused three and four times in a single game --
which is how a whole league's shooting from the restricted area came out at 75-95% for BOTH
sides of the same match. A genuine dunk or lay-up is trusted at any repeated spot, because its
type already says where it was; an unlabelled shot is not, and falls back to that label instead.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from translate.fiba_events import translate  # noqa: E402

FAILED = []


def ok(name, cond, why=''):
    if not cond:
        FAILED.append(f'{name}: {why or "false"}')


def shot(action, x, y, sub, made=True, team='1', period=1, gt='9:00'):
    return {'actionNumber': action, 'x': x, 'y': y}, {
        'actionNumber': action, 'actionType': '2pt', 'subType': sub,
        'success': 1 if made else 0, 'team': team, 'period': period, 'gt': gt, 'pno': 'p1'}


def game_with(shots):
    """shots: [(action, x, y, sub, made)]. Returns the raw {tm, pbp} translate() reads."""
    markers, actions = [], []
    for a, x, y, sub, made in shots:
        m, act = shot(a, x, y, sub, made)
        markers.append(m); actions.append(act)
    return {'tm': {'1': {'shot': markers}, '2': {'shot': []}}, 'pbp': actions}


def locs_for(shots):
    raw = game_with(shots)
    tr = translate(raw)
    events = tr['events']
    refs = {e['payload']['ref'] for e in events if e['t'] == 'loc'}
    # the shot events, in the order they were emitted -- one per entry in `shots`
    shot_events = [e for e in events if e['t'] in ('p2_made', 'p2_miss')]
    return {i: (shot_events[i]['seq'] in refs) for i in range(len(shots))}


def test_repeated_generic_is_dropped():
    shots = [(1, 8, 44, 'jumpshot', True), (2, 8, 44, 'jumpshot', True), (3, 8, 44, 'jumpshot', False),
             (4, 40, 60, 'jumpshot', False)]
    has_loc = locs_for(shots)
    ok('a coordinate reused 3 times is dropped for all three', not any(has_loc[i] for i in (0, 1, 2)), has_loc)
    ok('a coordinate seen once elsewhere keeps its location', has_loc[3], has_loc)


def test_twice_is_still_trusted():
    shots = [(1, 8, 44, 'jumpshot', True), (2, 8, 44, 'jumpshot', False), (3, 40, 60, 'jumpshot', False)]
    has_loc = locs_for(shots)
    ok('two of the same coordinate is not enough to distrust', has_loc[0] and has_loc[1], has_loc)


def test_a_named_finish_is_trusted_at_any_repeat():
    shots = [(1, 8, 44, 'layup', True), (2, 8, 44, 'layup', True), (3, 8, 44, 'layup', True),
             (4, 8, 44, 'dunk', True)]
    has_loc = locs_for(shots)
    ok('a layup keeps its location no matter how often the spot repeats', all(has_loc.values()), has_loc)


def test_a_unique_coordinate_near_the_rim_is_kept():
    """The rule only distrusts a REPEATED coordinate. A single close, generically-labelled shot
    -- a real floater, a broken play -- keeps its marker, because nothing here says it is fake."""
    shots = [(1, 10, 40, 'jumpshot', True), (2, 60, 60, 'jumpshot', False)]
    has_loc = locs_for(shots)
    ok('a lone near-rim generic shot is trusted', has_loc[0], has_loc)


def main():
    for fn in (test_repeated_generic_is_dropped, test_twice_is_still_trusted,
               test_a_named_finish_is_trusted_at_any_repeat,
               test_a_unique_coordinate_near_the_rim_is_kept):
        fn()
    if FAILED:
        print(f'{len(FAILED)} FAILED')
        for f in FAILED:
            print('  x ' + f)
        return 1
    print('all shot-duplicate tests pass')
    return 0


if __name__ == '__main__':
    sys.exit(main())
