// ============================================================================
// DATA FEEDS — turning a finished game into whatever shape a partner wants.
//
// PURE. No database, no network, no Deno. Everything in this file is a
// function of its arguments, which is why it is .js and not .ts: it runs
// unchanged under Deno in the Edge Function and under Node in the test suite,
// exactly as engine.js does. The parts that touch the world live in feeds.ts.
//
// THREE RULES THIS FILE FOLLOWS
//
// 1. THE CANONICAL SHAPE IS OURS AND IT IS STABLE. Keys here are spelled the
//    way a box score is normally spelled — `reb`, `fg3a`, `plus_minus` — not
//    the way the engine spells them internally (`or`+`dr`, `p3a`, `pm`). A
//    partner integrates against this, and refactoring the engine must never
//    silently change what RealGM receives. The translation lives here on
//    purpose.
//
// 2. THE FIELD MAP IS APPLIED LAST, to leaf keys only. A partner who wants
//    "TRB" says {"reb":"TRB"} once and gets it in JSON, in CSV headers and in
//    XML element names alike.
//
// 3. NOTHING ABOUT A MINOR LEAVES. Under-18s are filtered by RLS on every
//    public read, but the dispatcher runs with the service role and RLS does
//    not apply to it — so the filter is explicit here. A feed is a publication
//    like any other page, and the safeguarding rule does not stop being true
//    because the reader is a machine.
// ============================================================================

/* ------------------------------------------------------------ formatting --- */

const pad = (n) => String(n).padStart(2, '0');

/** milliseconds on the floor -> "34:21", which is how minutes are read. */
export function mmss(ms) {
  const s = Math.round((ms || 0) / 1000);
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
}

export function fmtDate(iso, style) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  switch (style) {
    case 'uk':    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    case 'us':    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
    case 'epoch': return Math.floor(d.getTime() / 1000);
    default:      return d.toISOString();
  }
}

/** A name in whichever order the receiving site files people under. */
export function fmtName(first, last, style) {
  const f = (first || '').trim(), l = (last || '').trim();
  if (!f && !l) return '';
  switch (style) {
    case 'last_comma_first': return l ? (f ? `${l}, ${f}` : l) : f;
    case 'last_first':       return [l, f].filter(Boolean).join(' ');
    case 'last_upper':       return [f, l.toUpperCase()].filter(Boolean).join(' ');
    default:                 return [f, l].filter(Boolean).join(' ');
  }
}

/** Title Case, because the scorer stores what was typed and that is often all
    lower case. A partner republishing "neon city" would look careless. */
export const title = (s) => (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase());

/* The snapshot holds one name string. Where the player is still on file we use
   the real first/last; where they are not (an imported historic game, a guest)
   we split on the LAST space, which is right far more often than it is wrong
   and is at least predictable. */
export function splitName(full) {
  const s = (full || '').trim();
  const i = s.lastIndexOf(' ');
  return i < 0 ? { first: s, last: '' } : { first: s.slice(0, i), last: s.slice(i + 1) };
}

/* --------------------------------------------------------------- shaping --- */

/** One player's line, in the canonical spelling. */
export function playerLine(s) {
  const fgm = (s.p2m || 0) + (s.p3m || 0);
  const fga = (s.p2a || 0) + (s.p3a || 0);
  const oreb = s.or || 0, dreb = s.dr || 0;
  return {
    minutes: mmss(s.min || 0),
    minutes_decimal: Math.round(((s.min || 0) / 60000) * 10) / 10,
    pts: s.pts || 0,
    fgm, fga,
    fg2m: s.p2m || 0, fg2a: s.p2a || 0,
    fg3m: s.p3m || 0, fg3a: s.p3a || 0,
    ftm: s.ftm || 0, fta: s.fta || 0,
    oreb, dreb, reb: oreb + dreb,
    ast: s.ast || 0, stl: s.stl || 0, blk: s.blk || 0,
    tov: s.to || 0, pf: s.pf || 0, fouls_drawn: s.fd || 0,
    plus_minus: s.pm || 0
  };
}

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

/**
 * The canonical payload, built from what loadGame() read.
 *
 * A section the partner did not ask for is left OUT ENTIRELY rather than sent
 * empty — somebody parsing `players: []` cannot tell "nobody played" from "you
 * did not want this", and one of those is worth ringing about.
 */
export function shapeGame(loaded, feed) {
  const want = feed.sections || {};
  const { g, comp, season, league, tstats, pstats, people } = loaded;
  const byId = new Map(people.map((p) => [p.id, p]));
  const snap = (g.roster_snapshot && g.roster_snapshot.teams) || [];
  const teamsMeta = [g.home, g.away];

  /* Safeguarding: a minor never appears in a feed, and neither do their
     numbers. RLS does not protect this code path — the service role sees
     everything — so the filter is here, once, and everything below reads
     `visible`. */
  const hidden = new Set(people.filter((p) => p.is_minor).map((p) => p.id));
  const visible = pstats.filter((r) => !hidden.has(r.player_id));

  const rowsFor = (idx) => visible
    .filter((r) => r.team_idx === idx)
    .map((r) => {
      const person = byId.get(r.player_id);
      const fromSnap = ((snap[idx] || {}).players || []).find((p) => p.id === r.player_id);
      const nm = person
        ? { first: person.first_name || '', last: person.last_name || '' }
        : splitName(title((fromSnap || {}).name || ''));
      const starters = (g.roster_snapshot && g.roster_snapshot.starters &&
                        g.roster_snapshot.starters[idx]) || g.starters?.[idx] || [];
      return {
        player_id: r.player_id,
        player: fmtName(title(nm.first), title(nm.last), feed.name_style),
        first_name: title(nm.first), last_name: title(nm.last),
        slug: (person && person.slug) || null,
        jersey: fromSnap ? (fromSnap.num ?? null) : null,
        starter: starters.includes(r.player_id),
        ...playerLine(r.stats || {})
      };
    })
    .sort((a, b) => (Number(a.jersey) || 999) - (Number(b.jersey) || 999));

  const teamBlock = (idx) => {
    const meta = teamsMeta[idx] || {};
    const raw = (tstats.find((t) => t.team_idx === idx) || {}).stats || {};
    const lines = rowsFor(idx);
    /* Team totals are SUMMED FROM THE LINES, not read from a parallel total —
       two numbers that should agree but are computed separately will one day
       disagree, and the partner is the one who finds out. The exceptions are
       the things no player owns: team rebounds, team turnovers, period
       scores. */
    const totals = {
      pts: raw.score != null ? raw.score : sum(lines, 'pts'),
      fgm: sum(lines, 'fgm'), fga: sum(lines, 'fga'),
      fg2m: sum(lines, 'fg2m'), fg2a: sum(lines, 'fg2a'),
      fg3m: sum(lines, 'fg3m'), fg3a: sum(lines, 'fg3a'),
      ftm: sum(lines, 'ftm'), fta: sum(lines, 'fta'),
      oreb: sum(lines, 'oreb') + (raw.teamRebO || 0),
      dreb: sum(lines, 'dreb') + (raw.teamRebD || 0),
      reb: sum(lines, 'reb') + (raw.teamRebO || 0) + (raw.teamRebD || 0),
      team_oreb: raw.teamRebO || 0, team_dreb: raw.teamRebD || 0,
      ast: sum(lines, 'ast'), stl: sum(lines, 'stl'), blk: sum(lines, 'blk'),
      tov: raw.toTot != null ? raw.toTot : sum(lines, 'tov'),
      pf: raw.foulTot != null ? raw.foulTot : sum(lines, 'pf'),
      pts_in_paint: raw.paint || 0, fast_break_pts: raw.fast || 0,
      second_chance_pts: raw.sc || 0, pts_off_turnovers: raw.pot || 0,
      bench_pts: raw.bench || 0, biggest_lead: raw.lead || 0
    };
    const block = {
      side: idx === 0 ? 'home' : 'away',
      name: meta.name || title((snap[idx] || {}).name || ''),
      short_name: meta.short_name || null,
      slug: meta.slug || null,
      score: idx === 0 ? g.home_score : g.away_score,
      period_scores: raw.perQ || null
    };
    if (want.teams !== false) block.totals = totals;
    if (want.boxscore !== false) block.players = lines;
    return block;
  };

  const out = {
    feed: { name: feed.name, delivered_for: 'game.final', version: 1 },
    league: league ? { name: league.name, slug: league.slug } : null,
    season: season ? { name: season.name } : null,
    competition: comp ? { name: comp.name, kind: comp.kind } : null
  };

  if (want.game !== false) {
    out.game = {
      id: g.id,
      date: fmtDate(g.tipoff_at, feed.date_style),
      finalised_at: fmtDate(g.finalised_at, feed.date_style),
      status: g.status,
      venue: g.venue || null,
      periods_played: g.period,
      home_score: g.home_score,
      away_score: g.away_score
    };
  }

  if (want.teams !== false || want.boxscore !== false) {
    out.teams = [teamBlock(0), teamBlock(1)];
  }

  if (want.standings && loaded.standings) {
    out.standings = loaded.standings.map((r) => ({
      rank: r.rank, group: r.group_name,
      team: (r.teams && r.teams.name) || null,
      slug: (r.teams && r.teams.slug) || null,
      played: r.gp, won: r.w, lost: r.l,
      pts_for: r.pts_for, pts_against: r.pts_against,
      difference: r.diff, league_points: r.league_points, streak: r.streak
    }));
  }

  if (want.playbyplay && loaded.events) {
    out.play_by_play = loaded.events
      .filter((e) => !hidden.has(e.pid))
      .map((e) => ({
        seq: e.seq, type: e.t, period: e.period, clock: e.clock,
        team: e.team === 0 ? 'home' : e.team === 1 ? 'away' : null,
        player_id: e.pid || null,
        ...(e.payload || {})
      }));
  }

  if (hidden.size) {
    /* Said out loud rather than hidden. A partner whose totals do not add up
       deserves to know why, and "we withhold under-18s" is a better answer
       than a silent discrepancy they chase for a week. */
    out.notice = hidden.size + ' under-18 player(s) withheld under the platform\'s ' +
      'safeguarding policy; team totals include their contribution.';
  }

  return out;
}

/* ------------------------------------------------------------ field map --- */

/** Rename leaf keys, everywhere. Values are untouched. */
export function applyFieldMap(value, map) {
  if (!map || !Object.keys(map).length) return value;
  if (Array.isArray(value)) return value.map((v) => applyFieldMap(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[map[k] || k] = applyFieldMap(v, map);
    return out;
  }
  return value;
}

/* -------------------------------------------------------------- renders --- */

const csvCell = (v) => {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/**
 * CSV is one table or it is not CSV. The table is the box score, because that
 * is what anyone asking for CSV wants; game identity is repeated on every row
 * so a row is self-describing, and each team's totals arrive as a row with the
 * player named TEAM. That is the convention every stats site already reads.
 */
export function toCSV(obj, map) {
  map = map || {};
  const g = obj.game || {};
  const head = [
    'game_id', 'date', 'league', 'competition', 'venue',
    'team', 'side', 'opponent', 'team_score', 'opponent_score', 'result',
    'player', 'jersey', 'starter',
    'minutes', 'pts', 'fgm', 'fga', 'fg2m', 'fg2a', 'fg3m', 'fg3a',
    'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'plus_minus'
  ];
  const teams = obj.teams || [];
  const lines = [head.map((h) => csvCell(map[h] || h)).join(',')];

  teams.forEach((t, i) => {
    const opp = teams[1 - i] || {};
    const common = [
      g.id ?? '', g.date ?? '', (obj.league && obj.league.name) || '',
      (obj.competition && obj.competition.name) || '',
      g.venue ?? '', t.name ?? '', t.side ?? '', opp.name ?? '',
      t.score ?? '', opp.score ?? '',
      t.score == null || opp.score == null ? '' : (t.score > opp.score ? 'W' : 'L')
    ];
    const emit = (who, jersey, starter, s) =>
      lines.push([...common, who, jersey ?? '',
        starter === '' ? '' : (starter ? 'Y' : 'N'),
        s.minutes ?? '', s.pts ?? '', s.fgm ?? '', s.fga ?? '', s.fg2m ?? '', s.fg2a ?? '',
        s.fg3m ?? '', s.fg3a ?? '', s.ftm ?? '', s.fta ?? '', s.oreb ?? '', s.dreb ?? '',
        s.reb ?? '', s.ast ?? '', s.stl ?? '', s.blk ?? '', s.tov ?? '', s.pf ?? '',
        s.plus_minus ?? ''].map(csvCell).join(','));

    (t.players || []).forEach((p) => emit(p.player, p.jersey, p.starter, p));
    if (t.totals) emit('TEAM', '', '', t.totals);
  });

  return lines.join('\r\n') + '\r\n';   // CRLF: RFC 4180, and Excel is fussy
}

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* An XML element name cannot begin with a digit or contain a space, and a
   field map is free text — somebody will eventually map a key to "Total
   Rebounds". Rather than emit a document no parser will read, the name is
   made legal. */
export const xmlName = (k) => {
  const s = String(k).replace(/[^A-Za-z0-9._-]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : '_' + s;
};

export function toXML(value, name = 'epinoia', depth = 0) {
  const ind = '  '.repeat(depth);
  const tag = xmlName(name);
  if (Array.isArray(value)) {
    // <players><player>…</player></players> reads better than repeating the
    // plural, so a plural container names its children in the singular
    const child = /s$/.test(name) ? name.replace(/s$/, '') : 'item';
    return `${ind}<${tag}>\n` +
      value.map((v) => toXML(v, child, depth + 1)).join('\n') +
      `\n${ind}</${tag}>`;
  }
  if (value && typeof value === 'object') {
    return `${ind}<${tag}>\n` +
      Object.entries(value).map(([k, v]) => toXML(v, k, depth + 1)).join('\n') +
      `\n${ind}</${tag}>`;
  }
  return `${ind}<${tag}>${xmlEsc(value)}</${tag}>`;
}

export function render(obj, feed) {
  const map = feed.field_map || {};
  switch (feed.format) {
    case 'csv':
      return { body: toCSV(obj, map), contentType: 'text/csv; charset=utf-8' };
    case 'xml':
      return {
        body: '<?xml version="1.0" encoding="UTF-8"?>\n' +
              toXML(applyFieldMap(obj, map), 'epinoia'),
        contentType: 'application/xml; charset=utf-8'
      };
    default:
      return {
        body: JSON.stringify(applyFieldMap(obj, map), null, 2),
        contentType: 'application/json; charset=utf-8'
      };
  }
}

/* ------------------------------------------------------------ signature --- */

/**
 * HMAC-SHA256 over the exact bytes we send. A partner who verifies this cannot
 * be fed a forged result by anyone who happens to learn their endpoint — which
 * matters more here than for a Discord webhook, because these numbers get
 * republished as fact.
 *
 * WebCrypto, so the same call works in Deno and in Node.
 */
export async function sign(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
