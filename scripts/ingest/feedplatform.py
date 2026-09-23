"""
platform.py — everything the worker needs to make a fed game a real Epinoia
game: league / season / competition / club / player / roster creation from a
FIBA payload, with identity rules that never guess.

  team   : teams.external_ids.fiba_livestats == tm.code  → else exact / alias name
           on the same league → else CREATE (when auto_create) → else unmatched
  player : players.external_ids.fiba_livestats == "<teamcode>:<pno>" → else exact
           full-name / alias match on that team's roster → else CREATE → else unmatched

(named feedplatform so it never shadows the stdlib platform module)
Used by bootstrap_league.py (one-off, whole archive) and by run_ingest.write_platform
(per game, so a league connected from the Epinoia console fills itself in as games arrive).
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone

import names

from matching import normalize as normalize_name
from placeholders import is_placeholder_team


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-{2,}", "-", s) or "x"


def full_name(p: dict) -> tuple[str, str]:
    """The name as the platform stores it. See scripts/ingest/names.py.

    This used to trust the Genius payload, which was fine while every league on the platform WAS
    Genius: two clean fields, Latin, already in reading order. It is not fine for a EuroLeague
    "DONCIC, LUKA", an ACB "Hernangomez, Willy" or a B.LEAGUE payload in kanji -- one of which
    would file a player under the surname D, and one of which the site cannot search at all."""
    first, last, _ = names.person(p)
    return first, last


def name_and_aliases(p: dict) -> tuple[str, str, list]:
    """As above, plus every form of the name that was thrown away on the way."""
    return names.person(p)


def season_name_for(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now.year}-{str(now.year + 1)[2:]}" if now.month >= 8 else f"{now.year - 1}-{str(now.year)[2:]}"


class Platform:
    """Thin, idempotent creator over the Supabase REST client (service role)."""

    def __init__(self, sb, dry: bool = False, auto_create: bool = True, log=print):
        self.sb, self.dry, self.auto_create, self.log = sb, dry, auto_create, log
        self.created: dict[str, int] = {}
        self.cache: dict = {"team": {}, "player": {}, "roster": set()}

    # -- primitives ---------------------------------------------------------------
    def one(self, table, query):
        rows = self.sb.select(table, query + "&limit=1") if self.sb else []
        return rows[0] if rows else None

    def insert(self, table, row, on_conflict="id"):
        self.created[table] = self.created.get(table, 0) + 1
        if self.dry or not self.sb:
            return {**row, "id": f"dry-{table}-{self.created[table]}"}
        return self.sb.upsert(table, row, on_conflict)[0]

    # -- league / season / competition ------------------------------------------
    def league(self, code: str, name: str, slug: str | None = None, country: str | None = None) -> dict:
        slug = slug or slugify(code)
        r = self.one("leagues", f"slug=eq.{slug}&select=id,slug,name,country")
        if r:
            if country and not r.get("country") and self.sb and not self.dry:
                try:
                    self.sb.patch("leagues", f"id=eq.{r['id']}", {"country": country})
                except Exception:
                    pass
            return r
        self.log(f"  + league {slug} ({name})")
        row = {"slug": slug, "name": name, "public_live": True, "youth_protected": False}
        if country:
            row["country"] = country
        lg = self.insert("leagues", row)
        # a league nobody administers is invisible in the console: hand it to every platform admin
        if self.sb and not self.dry:
            try:
                for m in self.sb.select("memberships", "role=eq.platform_admin&select=user_id"):
                    self.sb.upsert("memberships", {"user_id": m["user_id"], "role": "league_admin", "scope_type": "league", "scope_id": lg["id"]}, "user_id,role,scope_type,scope_id")
            except Exception as exc:
                self.log(f"    (could not grant league_admin: {exc})")
        return lg

    def season(self, league_id: str, name: str) -> dict:
        r = self.one("seasons", f"league_id=eq.{league_id}&name=eq.{name}&select=id,name")
        if r:
            return r
        y = re.match(r"(\d{4})", name)
        self.log(f"  + season {name}")
        return self.insert("seasons", {"league_id": league_id, "name": name,
                                       "starts_on": f"{y.group(1)}-09-01" if y else None,
                                       "ends_on": f"{int(y.group(1)) + 1}-06-30" if y else None}, "league_id,name")

    def competition(self, season_id: str, name: str, kind: str | None = None) -> dict:
        r = self.one("competitions", f"season_id=eq.{season_id}&name=eq.{name}&select=id,name,kind")
        if r:
            # a phase the feed names as a cup / playoff is filed as one, even if it was made as a league
            if kind and r.get("kind") != kind and r.get("kind") in (None, "league") and not self.dry and self.sb:
                try:
                    self.sb.patch("competitions", f"id=eq.{r['id']}", {"kind": kind}); r["kind"] = kind
                except Exception:
                    pass
            return r
        self.log(f"  + competition {name} ({kind or 'league'})")
        return self.insert("competitions", {"season_id": season_id, "name": name, "kind": kind or "league"}, "season_id,name")

    def ensure_competition(self, league_id: str, label: str, season_name: str | None = None, kind: str | None = None) -> dict:
        s = self.season(league_id, season_name or season_name_for())
        return self.competition(s["id"], label, kind)

    # -- clubs + people -----------------------------------------------------------
    @staticmethod
    def logo_url(t: dict) -> str | None:
        """Genius publishes each club's crest as {url, size, width, ...} under logo / logoT / logoS.
        The largest is preferred; only an https URL is worth storing (the pages refuse http)."""
        for k in ("logo", "logoS", "logoT"):
            v = t.get(k)
            if isinstance(v, dict):
                v = v.get("url")
            if isinstance(v, str) and v.startswith("https://"):
                return v
        return None

    def team(self, league_id: str, t: dict) -> dict | None:
        # "To be determined", "TBC", "Winner of QF1": a cup draw's side that is not known yet is
        # never matched to a club or created as one (placeholders.py). The caller skips the fixture
        # until the schedule names the side, and writes it then.
        if is_placeholder_team(t.get("name")):
            return None
        code = (t.get("code") or "").strip() or slugify(t.get("name", ""))
        key = (league_id, code)
        if key in self.cache["team"]:
            return self.cache["team"][key]
        r = self.one("teams", f"league_id=eq.{league_id}&external_ids->>fiba_livestats=eq.{code}&select=id,slug,name,aliases,logo_path")
        if r and not self.dry:
            # THE NAME A SCHEDULE COULD NOT GIVE. A club first seen on a fixture list may be named
            # in its own script and abbreviated with it (bleague.jp prints "広島", the game payload
            # says "HIROSHIMA DRAGONFLIES"). The moment a Latin name arrives for the same club, it
            # becomes the club's name and the native one is kept as an alias — so a supporter
            # searching either finds it, and the site does not carry one club in two alphabets.
            incoming = names.team_name((t.get("name") or "").strip())
            if incoming and names.has_cjk(r.get("name") or "") and not names.has_cjk(incoming):
                al = [a for a in (r.get("aliases") or []) if a]
                if r["name"] and r["name"] not in al:
                    al.append(r["name"])
                try:
                    self.sb.patch("teams", f"id=eq.{r['id']}", {"name": incoming, "aliases": al})
                    self.log(f"  ~ {r['name']} is {incoming}")
                    r["name"] = incoming
                except Exception:
                    pass
            # a crest the club has not got yet (or the JSON blob an early worker wrote) -> the feed's URL
            lp = r.get("logo_path") or ""
            url = self.logo_url(t)
            if url and (not lp or lp.startswith("{")):
                try:
                    self.sb.patch("teams", f"id=eq.{r['id']}", {"logo_path": url})
                    r["logo_path"] = url
                except Exception:
                    pass
        if not r:
            raw = (t.get("name") or "").strip()
            nm = raw.lower()
            real_code = (t.get("code") or "").strip()
            rows = self.sb.select("teams", f"league_id=eq.{league_id}&select=id,slug,name,aliases,external_ids,logo_path") if self.sb else []

            def adopt(row, why=""):
                """Take an existing club, and write back what this fixture taught us about it."""
                # Only a real feed code is written back. SLB's hosted schedule lists its clubs with no
                # code, and the slug stand-in would otherwise replace the club's real code on every
                # discovery pass until the next game put it back.
                patch = {}
                if real_code:
                    patch["external_ids"] = {**(row.get("external_ids") or {}), "fiba_livestats": real_code}
                if why:
                    # the sponsored form becomes an alias, so the next pass is an exact hit and the
                    # club is findable by the name the fixture list actually printed
                    al = list(row.get("aliases") or [])
                    if raw and raw not in al and raw != row.get("name"):
                        al.append(raw)
                        patch["aliases"] = al
                    self.log(f"  ~ {raw} is {row.get('name')} ({why})")
                if patch and not self.dry:
                    self.sb.patch("teams", f"id=eq.{row['id']}", patch)
                return {**row, **patch}

            for row in rows:
                # `known`, not `names`: that is the module this file imports, and shadowing it here
                # would take the name normaliser away from everything below.
                known = {row["name"].strip().lower()} | {a.strip().lower() for a in (row.get("aliases") or [])}
                if nm in known:
                    r = adopt(row)
                    break

            if not r:
                # THE SAME CLUB WEARING A SPONSOR (names.same_club). A fixture list writes "Baxi
                # Manresa" where the club was created as "Manresa", or drops a sponsor the club was
                # created with, and the platform used to register a second club: half the fixtures
                # under each, two rows in the table, and a field of twenty clubs showing twenty-two.
                # It is deliberately conservative — a leftover word that MARKS a different side (II,
                # B, Women, Academy) is never treated as a sponsor — and it only ever looks inside
                # one league.
                hits = [row for row in rows
                        if names.same_club(raw, row.get("name") or "")
                        or any(names.same_club(raw, a) for a in (row.get("aliases") or []))]
                if len(hits) == 1:
                    r = adopt(hits[0], "sponsor")
                elif len(hits) > 1:
                    # TWO CLUBS BOTH LOOK LIKE THIS ONE. Guessing wrong welds two real clubs
                    # together, which no re-run can undo — and creating a third is worse than the
                    # duplicate this whole path exists to prevent. So the side is left unresolved,
                    # exactly as an unnamed cup side is: the caller skips the fixture, and it is
                    # written the moment somebody names the club (or adds an alias).
                    self.log(f"  ? {raw} could be " + " / ".join(h.get("name") or "?" for h in hits[:3])
                             + " — fixture left for a human")
                    return None
        if not r and self.auto_create:
            self.log(f"  + team {t.get('name')} [{code}]")
            # THE CLUB'S NAME, LATINISED BUT NOT REWRITTEN (names.team_name): a club is not a
            # person, so its own capitalisation stands -- all that happens is that Rio Breogan and
            # Zalgiris Kaunas become sluggable and searchable on a Latin-alphabet site. Whatever
            # the feed actually wrote is kept as an alias, which is also how the next discovery
            # pass recognises the club it already created.
            raw_name = (t.get("name") or code).strip()
            nice = names.team_name(raw_name) or raw_name
            extra = [a for a in (raw_name, t.get("nameInternational")) if a and a != nice]
            # A SLUG FROM THE CODE WHEN THE NAME IS NOT LATIN. slugify strips to ASCII, so the
            # B.LEAGUE's own abbreviations come out as one letter or none at all: "A東京" -> "a"
            # and "琉球" -> "x", which is not a name and, worse, is the SAME slug for every club
            # whose abbreviation has no Latin in it. The feed's code (at, rg) is stable and
            # already unique within the league, so it is the better slug in that case.
            base = slugify(nice)
            if len(base) < 3 or base == "x":
                base = slugify(code) if len(slugify(code)) >= 2 else base
            # A DIGIT STRING IS NEVER A DISPLAY NAME. `code` here is whatever this fixture's own
            # source uses to key a club -- a real feed abbreviation for most adapters ("KOM"), but
            # for a schedule scraped straight off a site with no such codes (the Slovak SBL: the
            # crest URL carries only the club's own numeric id on that site, Competitor/699079/…)
            # it is that number, with nothing else to fall back to at discovery time. That number
            # was landing in short_name -- the one column every reader of "the short version of
            # this club's name" takes at face value, including the embed strip's own abbr(), which
            # does not go through EpinoiaInitials the way the rest of the platform does -- so a
            # club never seen with a proper shortName showed as "699" on a phone (reported
            # 2026-09-18). A code with no letter in it is not a name; the club's own name, not the
            # id that will never mean anything to a reader, is what stands in for one.
            # ...AND NOR IS A FILE NAME. A code earns the short_name slot only when it reads as
            # an abbreviation somebody would print: letters, and not ALL lower case. Genius and
            # the LNB send "BRI", "LON", "DIJ" and those are exactly right; bleague.jp's code is
            # the crest's FILE NAME ("at", "rg", "sr"), which put "AT" and "RG" on the strip's
            # cards for every club in both Japanese divisions (reported 2026-09-18). A club's own
            # name, trimmed, says more in the same three characters.
            sn_code = code if (re.search(r"[A-Za-z]", code) and code != code.lower()) else nice
            r = self.insert("teams", {"league_id": league_id, "slug": self.free_team_slug(league_id, base), "name": nice,
                                      "short_name": names.short_form(names.team_name(t.get("shortName") or "") or sn_code), "logo_path": self.logo_url(t),
                                      "external_ids": {"fiba_livestats": code},
                                      "aliases": list(dict.fromkeys(extra))})
        self.cache["team"][key] = r
        return r

    def free_team_slug(self, league_id: str, base: str) -> str:
        """teams.slug is unique across the platform, and clubs share names across leagues: London Lions
        run a men's and a women's Super League side, Oaklands Wolves play in BCB and SLB Women. The
        first club keeps the plain slug; a later one in another league is suffixed with its league's
        slug (london-lions-slb-women)."""
        if not self.sb or not self.one("teams", f"slug=eq.{base}&select=id"):
            return base
        lg = self.one("leagues", f"id=eq.{league_id}&select=slug")
        cand = f"{base}-{(lg or {}).get('slug') or 'league'}"
        n = 2
        while self.one("teams", f"slug=eq.{cand}&select=id"):
            cand = f"{base}-{(lg or {}).get('slug') or 'league'}-{n}"; n += 1
        return cand

    def league_of(self, team: dict) -> str | None:
        if team.get("league_id"):
            return team["league_id"]
        memo = self.cache.setdefault("team_league", {})
        if team["id"] not in memo:
            lg = self.sb.select("teams", f"id=eq.{team['id']}&select=league_id") if self.sb else []
            memo[team["id"]] = lg[0]["league_id"] if lg else None
        return memo[team["id"]]

    def by_feed_key(self, team: dict, ext: str, last: str = "") -> dict | None:
        """The player a "<teamcode>:<pno>" key was given to, IN THIS LEAGUE. The key is only a club code
        and a slot, and codes repeat across leagues (LON is London Lions men and women, OAK is Oaklands
        Wolves in BCB and SLB Women), so a player holding it counts only when they are on this club's
        roster or on a roster of another club in the same league.

        A SLOT IS NOT A PERSON. pno is the row the table operator typed a player into for THIS game,
        and clubs re-enter their squad every week, so the slots shuffle: Bristol Hurricanes v
        Gloucester (19 Sep 2026) had Kobe Hill in slot 3 and Corey Samuels in 4, where the stored
        stamps from an earlier game read 2 and 3. Trusting the stamp alone gave Kobe Hill's 13 points
        to Corey Samuels, and then the name matcher quite correctly gave slot 4 to Corey Samuels as
        well -- one player on two roster slots, which is a duplicate key on player_game_stats and a
        finalise that dies and reopens the game (it sat at Q4 0:00 for hours).

        So the stamp is a HINT, checked against the name the feed just gave: same surname and the
        slot is that player's, a different surname and the slot has been reassigned, the stamp is
        stale, and the caller falls through to the matcher -- which reads the name, the shirt number
        and the club, and is the thing that actually knows who this is. `last` empty (a feed with no
        usable surname) keeps the old behaviour, because then there is nothing better to go on."""
        if not self.sb or str(team.get("id", "")).startswith("dry-"):
            return None
        rows = self.sb.select("players", f"external_ids->>fiba_livestats=eq.{ext}&select=id,slug,first_name,last_name&limit=20")
        if not rows:
            return None
        if last:
            want_last = normalize_name(last)
            rows = [r for r in rows if normalize_name(r.get("last_name")) == want_last]
            if not rows:
                return None
        ids = ",".join(r["id"] for r in rows)
        on = self.sb.select("roster_entries", f"player_id=in.({ids})&select=player_id,team_id,teams!inner(league_id)")
        lid = self.league_of(team)
        for want in (lambda e: e.get("team_id") == team["id"], lambda e: (e.get("teams") or {}).get("league_id") == lid):
            hit = next((e["player_id"] for e in on if want(e)), None)
            if hit:
                return next(r for r in rows if r["id"] == hit)
        return None

    def player(self, team: dict, team_code: str, pno: str, p: dict, avoid: set | None = None) -> dict | None:
        """`avoid` = players already given a slot in THIS payload. A person cannot be two of the ten
        on court, so a stale feed key or a matcher that reaches for someone already spoken for is
        wrong by construction, and this slot goes on to the next rule (and, in the end, to a new
        player) rather than becoming a second line for the same person."""
        ext = f"{team_code}:{pno}"
        key = (team["id"], ext)
        if key in self.cache["player"]:
            return self.cache["player"][key]
        first, last = full_name(p)
        r = self.by_feed_key(team, ext, last)
        if r and avoid and r["id"] in avoid:
            self.log(f"  ! {first} {last}: feed key {ext} points at {r.get('first_name')} {r.get('last_name')}, already on this sheet — ignoring it")
            r = None
        if not r and self.sb:
            # THE SHARED MATCHER (matching.py = epinoia/match.js): the club's roster first, then anyone in
            # the league with that surname, scored on surname / forename / nickname / club / shirt number.
            # Only a clear winner is taken; an ambiguous pair is left to become (or stay) two players.
            from matching import match_player
            cands, seen = [], set()
            rows = self.sb.select("roster_entries", f"team_id=eq.{team['id']}&select=player_id,jersey,position,players(id,slug,first_name,last_name,aliases)")
            seen |= set(avoid or ())        # already on this sheet: not a candidate for a second slot
            for row in rows:
                pl = row.get("players") or {}
                if pl.get("id") and pl["id"] not in seen:
                    seen.add(pl["id"])
                    cands.append({**pl, "number": row.get("jersey"), "position": row.get("position"), "team": team.get("name")})
            try:
                lg = self.sb.select("teams", f"id=eq.{team['id']}&select=league_id")
                lid = lg[0]["league_id"] if lg else None
                if lid and last:
                    for row in self.sb.select("roster_entries", f"teams.league_id=eq.{lid}&players.last_name=ilike.*{last[:12]}*&select=player_id,jersey,position,teams!inner(name,league_id),players!inner(id,slug,first_name,last_name,aliases)"):
                        pl = row.get("players") or {}
                        if pl.get("id") and pl["id"] not in seen:
                            seen.add(pl["id"])
                            cands.append({**pl, "number": row.get("jersey"), "position": row.get("position"), "team": (row.get("teams") or {}).get("name")})
            except Exception:
                pass
            res = match_player({"name": {"first": first, "last": last}, "team": team.get("name"),
                                "number": p.get("shirtNumber"), "position": p.get("playingPosition")}, cands)
            if res["status"] == "match":
                r = res["match"]
                self.log(f"  = {first} {last} -> {r.get('first_name')} {r.get('last_name')} ({', '.join(res['best']['reasons'])})")
                if not self.dry:
                    # MERGE, DON'T REPLACE. external_ids is a small dict of NAMED feeds (the module
                    # docstring: "external_ids.fiba_livestats == tm.code", implying other keys can sit
                    # alongside it) -- patching the whole column to {"fiba_livestats": ext} clobbers
                    # any other key already on the row, and on a shared/merged canonical id (see the
                    # initial-only-unconfirmed fix above) it also meant two different real people's
                    # feed keys were overwriting each other on every poll rather than either being
                    # kept. `cands` was selected without external_ids, so it is re-read here rather
                    # than trusted from the match.
                    cur = self.sb.select("players", f"id=eq.{r['id']}&select=external_ids")
                    merged = dict((cur[0].get("external_ids") or {}) if cur else {})
                    merged["fiba_livestats"] = ext
                    self.sb.patch("players", f"id=eq.{r['id']}", {"external_ids": merged})
            elif res["status"] == "ambiguous":
                self.log(f"  ? {first} {last}: ambiguous between " + " / ".join(f"{x['candidate'].get('first_name')} {x['candidate'].get('last_name')}" for x in res["ranked"][:2]))
        if not r and self.auto_create:
            # EVERY form the normaliser folded away, so the native spelling stays searchable:
            # "Dončić" and the scoreboard's "L. DONCIC" both still find Luka Doncic.
            aliases = name_and_aliases(p)[2]
            r = self.insert("players", {"slug": f"{team['slug']}-{slugify(first + ' ' + last)}", "first_name": first or "?", "last_name": last,
                                        "is_minor": False, "external_ids": {"fiba_livestats": ext}, "aliases": aliases}, "slug")
        self.cache["player"][key] = r
        if r:
            self.photo(r, p)
        return r

    # ------------------------------------------------------------------ photographs
    # FIBA LiveStats carries a head shot for many players -- the picture the box score's
    # pop-up (#pop-player-image) shows -- under photoT / photoS / photo in data.json, as a
    # {url, ...} object or a bare URL. It is copied into media-public once, recorded as an
    # approved photo on the media table and pointed at from players.photo_media_id, which is
    # exactly what an uploaded, league-approved photograph looks like to every page.
    @staticmethod
    def photo_url(p: dict) -> str | None:
        for k in ("photoS", "photo", "photoT"):
            v = p.get(k)
            if isinstance(v, dict):
                v = v.get("url")
            if isinstance(v, str) and v.startswith("http"):
                return v
        return None

    def photo(self, player: dict, p: dict) -> None:
        url = self.photo_url(p)
        if not url or self.dry or not self.sb or not hasattr(self.sb, "storage_put"):
            return
        pid = player.get("id")
        if not pid or pid in self.cache.setdefault("photo", set()):
            return
        self.cache["photo"].add(pid)
        try:
            row = self.sb.select("players", f"id=eq.{pid}&select=photo_media_id,is_minor")
            if not row or row[0].get("photo_media_id") or row[0].get("is_minor"):
                return
            import requests as _rq
            r = _rq.get(url, timeout=30)
            if r.status_code != 200 or len(r.content) < 800:
                return
            ctype = (r.headers.get("content-type") or "image/jpeg").split(";")[0].strip()
            if not ctype.startswith("image/"):
                return
            ext = {"image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(ctype, "jpg")
            path = f"players/{pid}/fiba.{ext}"
            self.sb.storage_put("media-public", path, r.content, ctype)
            self.sb.insert("media", {"owner_type": "player", "owner_id": pid, "kind": "photo", "storage_path": path,
                                     "bytes": len(r.content), "status": "approved"})
            found = self.sb.select("media", f"owner_type=eq.player&owner_id=eq.{pid}&storage_path=eq.{path}&select=id&limit=1")
            mid = found[0]["id"] if found else None
            if mid:
                self.sb.patch("players", f"id=eq.{pid}", {"photo_media_id": mid})
                self.log(f"  \u25cf photo for {player.get('first_name')} {player.get('last_name')}")
        except Exception as exc:
            self.log(f"  (photo skipped for {pid[:8]}: {str(exc)[:80]})")

    def roster(self, team: dict, player: dict, season_id: str, p: dict) -> None:
        key = (team["id"], player["id"], season_id)
        if key in self.cache["roster"]:
            return
        self.cache["roster"].add(key)
        if self.one("roster_entries", f"team_id=eq.{team['id']}&player_id=eq.{player['id']}&season_id=eq.{season_id}&select=id"):
            return
        self.insert("roster_entries", {"team_id": team["id"], "player_id": player["id"], "season_id": season_id,
                                       "jersey": str(p.get("shirtNumber") or ""), "position": p.get("playingPosition") or None, "active": True})

    def ensure_game_people(self, league_id: str, comp: dict, season_id: str, raw: dict, group_of=None) -> dict:
        """Both clubs + every listed player of one payload. Returns {'1': team, '2': team, 'pids': {ext: uuid}}.

        ONE PERSON, ONE SLOT. Everything downstream keys a game's stats on the platform player id:
        player_game_stats is (game_id, player_id), so two slots resolving to one person is not a
        blurred box score, it is a duplicate-key error that kills finalise-game and leaves a
        finished game showing 'live' for ever. `taken` makes that structurally impossible — a slot
        the rules can only fill with someone already on the sheet is left OUT of the map, and
        run_ingest's pid_for then falls back to a plain "<side>:<pno>" and prints it as a player
        without a platform id, which is visible and harmless where a collision is neither."""
        out = {"pids": {}}
        taken: dict = {}                    # player id -> the slot that already has them, BOTH sides
        for k in ("1", "2"):
            t = (raw.get("tm") or {}).get(k) or {}
            team = self.team(league_id, t)
            out[k] = team
            if not team:
                continue
            if not self.dry and self.sb:
                # group_of: the club's group / division from the source's groups file (groups.py),
                # {} for every source without one - so their rows are written as they always were
                fields = group_of(t.get("name") or "", team.get("name") or "") if group_of else {}
                self.sb.upsert("competition_teams", {"competition_id": comp["id"], "team_id": team["id"], **fields},
                               "competition_id,team_id")
            tcode = (t.get("code") or "").strip() or slugify(t.get("name", ""))
            for pno, p in (t.get("pl") or {}).items():
                pl = self.player(team, tcode, str(pno), p, avoid=set(taken))
                if not pl:
                    continue
                if pl["id"] in taken:
                    first, last = full_name(p)
                    self.log(f"  ! {first} {last} ({tcode}:{pno}) resolves to the same player as {taken[pl['id']]} — left unmatched")
                    continue
                taken[pl["id"]] = f"{tcode}:{pno}"
                self.roster(team, pl, season_id, p)
                out["pids"][f"{tcode}:{pno}"] = pl["id"]
        return out
