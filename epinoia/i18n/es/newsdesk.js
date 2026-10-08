'use strict';
/* The "newsdesk" pack, Español: the league newsdesk's storylines, briefing and coverage plan (epinoia/narrative.js, drawn
   by newsdesk.js in the 'newsdesk' sentence context). Keys are the English on screen; every language carries the same
   keys (supabase/tests/i18n.test.mjs). The sentences are translated whole, one anchored pattern per template
   (supabase/tests/newsdesk-i18n.test.mjs). Names pass through as the data has them. No other site is named in these
   files.

   Written as the Spanish basketball press writes: a club is a singular subject ("Ash City encadena cinco victorias
   consecutivas"), the table's own words (líder, colista, balance, racha, liga regular, playoff, serie, eliminatoria,
   ida y vuelta, global), records and scores with a hyphen ("5-1"), dates as "el miércoles 2 de diciembre", no gendered
   pronoun for a player ("en su ausencia"). A count the English spells stays a word ("five" → "cinco"), digits stay
   digits; the engine and tidy() write the decimal comma. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;

  /* ---------------------------------------------------------------- pieces --- */
  const NUM = { no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const WORDS = 'no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+';
  const val = w => (/^\d/.test(String(w)) ? parseInt(w, 10) : NUM[String(w).toLowerCase()]);
  const ES = ['ningún', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce'];
  /* a count as the English said it: a word stays a word, digits stay digits; one and none agree with a feminine noun */
  const nw = (w, fem) => { const s = String(w); if (/^\d/.test(s)) return s; const v = val(s); return fem && v <= 1 ? (v ? 'una' : 'ninguna') : ES[v]; };
  const pl = (k, a, b) => (Number(k) === 1 ? a : b);
  /* with its noun: "cinco partidos", "un partido", "ningún partido", "13 partidos" */
  const cnt = (w, one, many, fem) => nw(w, fem) + ' ' + (val(w) === 1 || (val(w) === 0 && !/^\d/.test(String(w))) ? one : many);
  /* "about five wins": unas cinco victorias, una victoria */
  const wins = (w, about) => (val(w) === 1 ? 'una victoria' : val(w) === 0 ? 'ninguna victoria' : (about ? 'unas ' : '') + nw(w, true) + ' victorias');

  /* a place in the table as the English said it: a word stays a word ("third" → "tercero", "tercer" before a noun), the
     short form stays short ("3rd", "11th" → "3.º", "11.º") */
  const PLACES = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ORDES = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];
  const ordv = k => { const i = PLACES.indexOf(String(k).toLowerCase()); return i > 0 ? i : parseInt(k, 10); };
  const pos = (k, noun) => {
    const v = ordv(k);
    if (PLACES.indexOf(String(k).toLowerCase()) < 0) return v + '.º';
    return noun && (v === 1 || v === 3) ? ORDES[v].slice(0, -1) : ORDES[v];
  };
  /* said of a club on its own, first in the table is the leader */
  const place = k => (ordv(k) === 1 ? 'líder' : pos(k));
  /* a game of a series: "el segundo partido"; a meeting: "tercer enfrentamiento" */
  const GORD = ['', 'primer', 'segundo', 'tercer', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];
  const gameOrd = (d, art) => { const v = val(d); const t = v >= 1 && v <= 10 ? GORD[v] + ' partido' : 'partido ' + v; return art === false ? t : 'el ' + t; };
  const nth = w => { const v = val(w); return v >= 1 && v <= 10 ? GORD[v] : v + '.º'; };

  /* games behind: "half a game" → medio partido, "a game and a half" → un partido y medio, "13½ games" → 13 partidos y medio */
  const HALVES = { 'half a game': 'medio partido', 'one game': 'un partido', 'a game and a half': 'un partido y medio' };
  const gw = s => {
    const t = String(s).toLowerCase();
    if (HALVES[t]) return HALVES[t];
    let m = /^(no|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)( and a half)? games$/.exec(t);
    if (m) return m[1] === 'no' ? 'ningún partido' : nw(m[1]) + ' partidos' + (m[2] ? ' y medio' : '');
    m = /^(\d+)(½)? games$/.exec(t);
    return m ? m[1] + ' partidos' + (m[2] ? ' y medio' : '') : null;
  };
  const GAMES = '(half a game|one game|a game and a half|(?:no|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: and a half)? games|\\d+½? games)';

  /* dates as the newsdesk writes them (en-GB): "Wednesday 2 December" → "miércoles 2 de diciembre" ("el" in a sentence),
     "23 October" → "23 de octubre", "Sunday" → "el domingo" */
  const DAYS = { sunday: 'domingo', monday: 'lunes', tuesday: 'martes', wednesday: 'miércoles', thursday: 'jueves', friday: 'viernes', saturday: 'sábado' };
  const MONTHS = { january: 'enero', february: 'febrero', march: 'marzo', april: 'abril', may: 'mayo', june: 'junio', july: 'julio',
    august: 'agosto', september: 'septiembre', october: 'octubre', november: 'noviembre', december: 'diciembre' };
  const fecha = s => { const m = /^(\w+),? (\d{1,2}) (\w+)$/.exec(String(s)); const d = m && DAYS[m[1].toLowerCase()], mo = m && MONTHS[m[3].toLowerCase()]; return d && mo ? d + ' ' + m[2] + ' de ' + mo : null; };
  const el = s => 'el ' + fecha(s);
  const dia = s => { const m = /^(\d{1,2}) (\w+)$/.exec(String(s)); return m[1] + ' de ' + MONTHS[m[2].toLowerCase()]; };
  const wday = s => 'el ' + DAYS[String(s).toLowerCase()];
  const DAYRX = Object.keys(DAYS).join('|'), MONRX = Object.keys(MONTHS).join('|');

  /* the newsdesk's facets, in the words its own labels print (ctx.newsdesk), and the match report's ledger facets */
  const FAC = { 'shooting': 'el tiro', 'the turnover battle': 'las pérdidas', 'the offensive glass': 'el rebote ofensivo',
    'getting to the line': 'la llegada a la línea de tiros libres' };
  const RFAC = Object.assign({}, FAC, { 'the shots they got': 'la calidad de tiro', 'the shots that fell': 'el acierto en el tiro',
    'turnovers': 'las pérdidas', 'free-throw shooting': 'el acierto en tiros libres', 'free throws': 'los tiros libres',
    'home court': 'el factor cancha', 'everything else': 'todo lo demás' });
  const fac = l => FAC[String(l).toLowerCase()];
  const rfac = l => RFAC[String(l).toLowerCase()] || null;
  /* a plural label takes a plural verb: "las pérdidas deciden" */
  const many = t => /^(los|las) /.test(t);
  const vb = (t, one, more) => (many(t) ? more : one);
  const alt = o => Object.keys(o).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  /* "Group A" is el Grupo A ("del Grupo A"); a group with a name of its own keeps it */
  const grp = g => { const m = /^group (.+)$/i.exec(String(g)); return m ? 'el Grupo ' + m[1] : String(g); };
  const de = x => (/^el /.test(x) ? 'del ' + x.slice(3) : 'de ' + x);
  const enG = g => (g ? ' en ' + grp(g) : '');
  const deG = g => (g ? ' ' + de(grp(g)) : '');
  /* the award races' measures (compute_season_awards), after the value: "23.4 · points per game · minimum 5 games" */
  const DETAIL = { 'efficiency per game': 'valoración por partido', 'points per game': 'puntos por partido', 'rebounds per game': 'rebotes por partido',
    'assists per game': 'asistencias por partido', 'steals and blocks per game': 'recuperaciones y tapones por partido',
    'three-point percentage': 'porcentaje de triples', 'points scored per game': 'puntos anotados por partido', 'points allowed per game': 'puntos encajados por partido' };
  const detail = p => { const m = /^minimum (\d+) games?$/i.exec(p); return m ? 'mínimo ' + m[1] + ' ' + pl(m[1], 'partido', 'partidos') : DETAIL[String(p).toLowerCase()] || null; };

  const sc = (a, b) => a + '-' + b;
  /* "y" becomes "e" before an i- sound */
  const yy = b => (/^(i|hi)(?![aeiouáéíóú])/i.test(String(b)) ? ' e ' : ' y ');
  const list = xs => (xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + yy(xs[xs.length - 1]) + xs[xs.length - 1]);
  /* "about six points": unos 6 puntos, alrededor de 1,2 puntos, cerca de un punto */
  const abt = w => { const v = String(w); return /\./.test(v) ? 'alrededor de ' + v + ' puntos' : Number(v) === 1 ? 'cerca de un punto' : 'unos ' + v + ' puntos'; };
  const cap = s => String(s).replace(/^([¡¿"“«(]*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase());
  const WL = s => (String(s).toUpperCase() === 'W' ? 'V' : 'D');

  /* ------------------------------------------------------------- the tokens --- */
  /* {X} a club or a player, {P} a possessive ("Ash City’s", "Sendai 89ers’"), {W} a count in words or digits, {D} digits,
     {F} a figure (signed with + or −, decimals), {S} a score or a record, {K} a place (third, 11th, 3rd), {G} games behind,
     {L} a facet of the newsdesk, {R} a facet of the match report, {Y} a date, {Z} a day and month, {V} a weekday, {H} a
     group ("in Group A") */
  const TOK = {
    X: '([^,;:—]+?)', P: '([^,;:—]+?)’s?', W: '(' + WORDS + ')', D: '(\\d+)', F: '([+−-]?\\d+(?:\\.\\d+)?)',
    S: '(\\d+)[–-](\\d+)', K: '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th))',
    G: GAMES, L: '(' + alt(FAC) + ')', R: '(' + alt(RFAC) + ')',
    Y: '((?:' + DAYRX + '),? \\d{1,2} (?:' + MONRX + '))', Z: '(\\d{1,2} (?:' + MONRX + '))', V: '(' + DAYRX + ')',
    H: '(?: in (.+?))?'
  };
  const rx = (src, end) => new RegExp('^(?:' + src.replace(/\{([A-Z])\}/g, (m, k) => TOK[k]) + ')' + (end || '') + '$', 'i');
  const first = (rules, s) => { for (const [re, fn] of rules) { const m = re.exec(s); if (m) { const o = fn(...m.slice(1)); if (o != null) return o; } } return null; };

  /* what comes next, after "Next:" ("Birch City visit on Wednesday 2 December" / "away at Fir City on …") and at the end
     of a sentence ("when Birch City visit on …" / "away at Fir City on …") */
  const NEXT = [
    [rx('away at {X} on {Y}'), (x, d) => 'visita a ' + x + ' ' + el(d)],
    [rx('{X} visit on {Y}'), (x, d) => 'recibe a ' + x + ' ' + el(d)]
  ];
  const WHEN = [
    [rx('away at {X} on {Y}'), (x, d) => el(d) + ', en la pista de ' + x],
    [rx('when {X} visit on {Y}'), (x, d) => el(d) + ', con la visita de ' + x]
  ];
  const nx = s => first(NEXT, s);
  const when = s => first(WHEN, s);

  /* where a series or a tie stands (the big picture, the slate): "Damson City lead Ash City 1–0" */
  const STATUS = [
    [rx('{X} through on aggregate against {X}, {S}'), (x, y, a, b) => x + ' ha eliminado a ' + y + ' con un global de ' + sc(a, b)],
    [rx('{X} through against {X}, {S}'), (x, y, a, b) => x + ' ha eliminado a ' + y + ' (' + sc(a, b) + ')'],
    [rx('{X} lead {X} by {D} on aggregate'), (x, y, d) => x + ' aventaja en ' + d + ' a ' + y + ' en el global'],
    [rx('{X} and {X} level on aggregate'), (x, y) => x + yy(y) + y + ' igualan en el global'],
    [rx('{X} v {X} to start'), (x, y) => x + ' vs ' + y + ', por empezar'],
    [rx('{X} lead {X} {S}'), (x, y, a, b) => x + ' va ganando ' + sc(a, b) + ' a ' + y],
    [rx('{X} and {X} level at {S}'), (x, y, a, b) => x + yy(y) + y + ' igualan la serie ' + sc(a, b)]
  ];
  const status = s => first(STATUS, s);

  /* a leg of a tie: "first leg" → la ida, "second leg" → la vuelta, "leg 3" → el partido 3 */
  const legEs = (l, art) => { const t = String(l).toLowerCase(); const m = /^leg (\d+)$/.exec(t);
    return m ? (art ? 'el partido ' : 'partido ') + m[1] : (art ? 'la ' : '') + (t === 'first leg' ? 'ida' : 'vuelta'); };
  const LEG = rx('(first leg|second leg|leg \\d+): {X} {S} {X}');
  const legs = s => { const out = s.split('; ').map(p => { const m = LEG.exec(p); return m ? legEs(m[1]) + ': ' + m[2] + ' ' + sc(m[3], m[4]) + ' ' + m[5] : null; });
    return out.indexOf(null) >= 0 ? null : out.join('; '); };

  /* the slate's angle for a game, its bits joined with "; " (the series first, then the places, the facet, the meetings) */
  const BIT = [
    [rx('game {D} of the series'), d => gameOrd(d, false) + ' de la serie'],
    [rx('game {D}: (.+)'), (d, st) => { const t = status(st); return t && gameOrd(d, false) + ': ' + t; }],
    [rx('first leg'), () => 'ida'],
    [rx('second leg: (.+)'), st => { const t = status(st); return t && 'vuelta: ' + t; }],
    [rx('{K} against {K}'), (a, b) => pos(a) + ' contra ' + pos(b)],
    [rx('the numbers say it turns on {L}'), l => 'según los números, se decide en ' + fac(l)],
    [rx('a rematch'), () => 'revancha'],
    [rx('meeting {W} this season'), w => nth(w) + ' enfrentamiento de la temporada']
  ];
  const angle = s => { const out = s.split('; ').map(p => first(BIT, p)); if (out.indexOf(null) >= 0) return null; const t = out.join('; '); return /^[A-Z]/.test(s) ? cap(t) : t; };

  /* the engine's own translator for a piece another pack writes (a match report's headline inside "Feature: …") */
  const QS = [];
  const engine = s => { const q = QS[QS.length - 1]; return q ? q(s) : null; };

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Spanish | null, 'dot' when only a sentence with its full stop is meant] */
  const RULES = [
    /* ---- the race at the top ---- */
    ['{X} finish top{H} at {S}', (x, g, a, b) => x + ' acaba líder' + deG(g) + ' con ' + sc(a, b)],
    ['{G} clear of {X}', (w, x) => 'con ' + gw(w) + ' de ventaja sobre ' + x],
    ['level with {X} on the record; the table puts them first', x => 'mismo balance que ' + x + '; la clasificación le da el primer puesto'],
    ['the regular season set the seeds; from here it is series', () => 'la liga regular ha decidido los cabezas de serie; a partir de aquí, mandan las series'],
    ['{X} cannot be caught{H}', (x, g) => 'nadie puede alcanzar ya a ' + x + enG(g)],
    ['nobody has broken away yet{H}', g => 'nadie se ha escapado todavía' + enG(g)],
    ['a crowded top{H}: {D} clubs within (a game|a game and a half) of first',
      (g, d, w) => 'una cabeza muy apretada' + enG(g) + ': ' + d + ' equipos a ' + (/half/i.test(w) ? 'partido y medio' : 'un partido') + ' o menos del primero'],
    ['{W} clubs within (a game|a game and a half) of the top{H}',
      (n, w, g) => cnt(n, 'equipo', 'equipos') + ' a ' + (/half/i.test(w) ? 'partido y medio' : 'un partido') + ' o menos del liderato' + deG(g)],
    ['{X} and {X} level at the top{H}', (x, y, g) => x + yy(y) + y + ' comparten el liderato' + deG(g)],
    ['{X} (pull clear|lead){H}, {G} ahead', (x, k, g, w) => x + (/pull/i.test(k) ? ' se escapa en cabeza' + deG(g) : g ? ' lidera ' + grp(g) : ' lidera') + ', con ' + gw(w) + ' de ventaja'],
    ['nobody else can reach their {W} wins now, with {W} games? left',
      (w, l) => 'nadie más puede llegar ya a ' + (val(w) === 1 ? 'su victoria' : 'sus ' + wins(w)) + ', a falta de ' + cnt(l, 'partido', 'partidos')],
    ['with {W} games? left, only {X} can still catch them', (l, x) => 'a falta de ' + cnt(l, 'partido', 'partidos') + ', solo ' + x + ' puede alcanzar todavía al líder'],
    ['with {W} games? left, {W} clubs can still catch them', (l, n) => 'a falta de ' + cnt(l, 'partido', 'partidos') + ', ' + nw(n) + ' equipos pueden alcanzar todavía al líder'],
    ['(?:{W} games? into an? {D}-game season|it is early: {W} games? in), the table is a first draft(?:; by the margins, {X} (are the best side as well|have been the best side so far), at {F} a game)?',
      (a, d, e, x, k, f) => (a ? 'tras ' + cnt(a, 'partido', 'partidos') + ' de una temporada de ' + d : 'es pronto: tras ' + cnt(e, 'partido', 'partidos')) +
        ', la clasificación es solo un primer borrador' +
        (x ? '; por diferencia de puntos, ' + x + (/well/i.test(k) ? ' también es el mejor equipo' : ' ha sido el mejor equipo hasta ahora') + ', con ' + f + ' por partido' : '')],
    ['half the league is within a game and a half of first: one week can turn the table over',
      () => 'media liga está a partido y medio o menos del primero: una sola semana puede darle la vuelta a la clasificación'],
    ['one result can change who is top', () => 'un solo resultado puede cambiar al líder'],
    ['the season’s first real separation', () => 'la primera brecha seria de la temporada'],
    ['a cushion, but not one a bad week cannot erase', () => 'es un colchón, pero una mala semana puede borrarlo'],
    ['{X} are {S}, {G} clear of {X}', (x, a, b, w, y) => x + ' tiene un balance de ' + sc(a, b) + ', con ' + gw(w) + ' de ventaja sobre ' + y],
    ['{X} are {S}, level with {X} on the record', (x, a, b, y) => x + ' tiene un balance de ' + sc(a, b) + ', el mismo que ' + y],
    ['their points for and against suggest about {W} wins, not {W}: the record is running ahead of the play',
      (a, b) => 'sus puntos a favor y en contra apuntan a ' + wins(a, true) + ', no a ' + nw(b, true) + ': el balance va por delante del juego'],
    ['the contenders meet on {Y}: {X} v {X}', (d, x, y) => 'los aspirantes se enfrentan ' + el(d) + ': ' + x + ' vs ' + y],
    ['next for {X}: (.+)', (x, t) => { const n = nx(t); return n && 'próximo partido de ' + x + ': ' + n; }],
    ['the race, in a table and a paragraph', () => 'la carrera, en una tabla y un párrafo'],
    ['a preview of the next meeting between the contenders', () => 'una previa del próximo duelo entre los aspirantes'],
    ['the run-in: every contender’s remaining games, side by side', () => 'la recta final: los partidos que le quedan a cada aspirante, uno junto a otro'],
    ['a weekly "state of the race" column', () => 'una columna semanal sobre «el estado de la carrera»'],
    ['the regular season in review: the table, the turning points, the best players', () => 'la liga regular, repasada: la clasificación, los puntos de inflexión, los mejores jugadores'],

    /* ---- the line, and who is through or out of it ---- */
    ['the fight for {K}{H}: {X} hold it, {X} (?:{G} behind|level)',
      (k, g, x, y, w) => 'la pelea por el ' + pos(k, true) + ' puesto' + deG(g) + ': lo tiene ' + x + ', con ' + y + (w ? ' a ' + gw(w) : ' empatado')],
    ['{W} clubs? within a game and a half of {K}', (n, k) => cnt(n, 'equipo', 'equipos') + ' a partido y medio o menos del ' + pos(k, true) + ' puesto'],
    ['only the top {W}{H} go through(, and the line moves every week)?',
      (n, g, mv) => (val(n) === 1 ? 'solo el primero' + deG(g) + ' se clasifica' : 'solo los ' + nw(n) + ' primeros' + deG(g) + ' se clasifican') +
        (mv ? ', y la línea de corte se mueve cada semana' : '')],
    ['last season’s play-offs took the top {W}(?:(; if this season’s are the same, the line moves every week)|; whatever this season’s format, nobody can push them out of the top {W} now)?',
      (n, same, n2) => 'el playoff de la temporada pasada fue para los ' + nw(n) + ' primeros' +
        (same ? '; si este año es igual, la línea de corte se mueve cada semana' : n2 ? '; sea cual sea el formato de este año, ya nadie puede sacarlo de los ' + nw(n2) + ' primeros' : '')],
    ['{X} are sure of a top-{W} finish{H}', (x, n, g) => x + ' tiene asegurado acabar entre los ' + nw(n) + ' primeros' + deG(g)],
    ['{S}, {K}, with {W} games? left', (a, b, k, l) => sc(a, b) + ', ' + pos(k) + ', ' + (val(l) === 0 ? 'sin partidos por jugar' : 'a falta de ' + cnt(l, 'partido', 'partidos'))],
    ['{X} can no longer finish in the top {W}{H}', (x, n, g) => x + ' ya no puede acabar entre los ' + nw(n) + ' primeros' + deG(g)],
    ['{S}, {K}; even {W} more wins? would leave them short',
      (a, b, k, n) => sc(a, b) + ', ' + pos(k) + '; ni siquiera ' + (val(n) === 1 ? 'una victoria más le bastaría' : nw(n, true) + ' victorias más le bastarían')],
    ['{S}, {K}; their regular season is over', (a, b, k) => sc(a, b) + ', ' + pos(k) + '; su liga regular ha terminado'],
    ['who is in, who is out, and the schedule each has left', () => 'quién está dentro, quién está fuera y el calendario que le queda a cada uno'],
    ['a "games that decide it" list from the fixtures', () => 'una lista de «partidos decisivos» a partir del calendario'],
    ['what they are playing for now: the seeding', () => 'lo que se juega ahora: su puesto como cabeza de serie'],
    ['what the rest of the season is for: the young players, next season', () => 'para qué sirve el resto de la temporada: los jóvenes, la próxima temporada'],

    /* ---- runs and slides ---- */
    ['{X} have won {W} in a row', (x, w) => x + ' encadena ' + nw(w, true) + ' victorias consecutivas'],
    ['up to {K} at {S}', (k, a, b) => 'ya es ' + place(k) + ', con ' + sc(a, b)],
    ['the run started {Z}', d => 'la racha empezó el ' + dia(d)],
    ['it has taken them from {K} to {K}', (a, b) => 'le ha llevado del ' + pos(a) + ' al ' + pos(b, true) + ' puesto'],
    ['it has dropped them from {K} to {K}', (a, b) => 'le ha hecho caer del ' + pos(a) + ' al ' + pos(b, true) + ' puesto'],
    ['nobody else in the league has a winning run this long going', () => 'nadie más en la liga tiene ahora mismo una racha de victorias tan larga'],
    ['all {W} by ten points or more', w => 'las ' + nw(w, true) + ', por diez puntos o más'],
    ['nobody else in the league has strung this many together', () => 'nadie más en la liga ha encadenado tantas seguidas'],
    ['a run like this changes where a season is heading', () => 'una racha así cambia el rumbo de una temporada'],
    ['none of the {W} came against a side above them in the table', w => 'ninguna de las ' + nw(w, true) + ' llegó ante un rival que estuviera por encima en la clasificación'],
    ['nobody has had an easier schedule so far', () => 'nadie ha tenido un calendario más fácil hasta ahora'],
    ['only {W} clubs? (?:has|have) had an easier schedule so far', n => 'solo ' + cnt(n, 'equipo ha', 'equipos han') + ' tenido un calendario más fácil hasta ahora'],
    ['(?:it|the run) goes on the line (.+)', t => { const w = when(t); return w && 'la racha se pone en juego ' + w; }],
    ['it is already their longest run of the season', () => 'ya es su racha más larga de la temporada'],
    ['what changed: {L}, worth {F} points a game to them in the run against {F} before it',
      (l, a, b) => 'qué ha cambiado: ' + fac(l) + ', que le ' + vb(fac(l), 'ha', 'han') + ' valido ' + a + ' puntos por partido durante la racha, frente a ' + b + ' antes de ella'],
    ['{L}, a game', l => fac(l) + ', por partido'],
    ['how the run was built, game by game', () => 'cómo se construyó la racha, partido a partido'],
    ['what changed: {L}, before the run and during it', l => 'qué ha cambiado: ' + fac(l) + ', antes y durante la racha'],
    ['what changed: the numbers before and during it', () => 'qué ha cambiado: los números antes y durante la racha'],
    ['{X} have lost {W} straight', (x, w) => x + ' encadena ' + nw(w, true) + ' derrotas consecutivas'],
    ['{K} at {S}', (k, a, b) => pos(k) + ', con ' + sc(a, b)],
    ['the last win was {W} games ago', w => 'su última victoria fue hace ' + cnt(w, 'partido', 'partidos')],
    ['the longest losing run in the league right now', () => 'la racha de derrotas más larga de la liga en este momento'],
    ['every defeat now costs ground that is hard to win back', () => 'cada derrota cuesta ahora un terreno difícil de recuperar'],
    ['{W} of their defeats this season were by five or fewer: the margins are small',
      w => nw(w, true) + ' de sus derrotas esta temporada fueron por cinco puntos o menos: los márgenes son pequeños'],
    ['the next chance: (.+)', t => { const n = nx(t); return n && 'la próxima oportunidad: ' + n; }],
    ['what has gone wrong: {L}, in the numbers', l => 'qué ha fallado: ' + fac(l) + ', en números'],
    ['what has gone wrong, in the numbers', () => 'qué ha fallado, en números'],
    ['the one fixture that could end it', () => 'el partido que podría cortar la racha'],

    /* ---- the unbeaten and the winless ---- */
    ['{X} are still perfect at {S}', (x, a, b) => x + ' sigue invicto con ' + sc(a, b)],
    ['average margin {F}(?:; {S} on the road)?', (f, a, b) => 'diferencia media de ' + f + (a ? '; ' + sc(a, b) + ' a domicilio' : '')],
    ['(the last unbeaten side in the league|one of {W} sides still unbeaten)(?:, and nobody has got closer than {W} points|; their closest win was by {W})?',
      (k, n, c, w) => (n ? 'uno de los ' + nw(n) + ' equipos que siguen invictos' : 'el último invicto de la liga') +
        (c ? ', y nadie se ha quedado a menos de ' + cnt(c, 'punto', 'puntos') : w ? '; su victoria más ajustada fue por ' + cnt(w, 'punto', 'puntos') : '')],
    ['next to try: {X}, (who visit|at home) on {Y}', (x, k, d) => 'el próximo en intentarlo: ' + x + (/who/i.test(k) ? ', que visita su pista ' : ', en su pista, ') + el(d)],
    ['what makes them so hard to beat', () => 'por qué cuesta tanto ganarle'],
    ['the fixture most likely to end it', () => 'el partido con más papeletas para acabar con su imbatibilidad'],
    ['{X} are still looking for a first win, {S}', (x, a, b) => x + ' sigue buscando su primera victoria (' + sc(a, b) + ')'],
    ['their closest defeat was by {W}', w => 'su derrota más ajustada fue por ' + cnt(w, 'punto', 'puntos')],
    ['where the first win could come from', () => 'dónde podría llegar la primera victoria'],

    /* ---- the record against the points ---- */
    ['{X} are winning more than their points say they should', x => x + ' gana más de lo que dicen sus puntos'],
    ['{X} are (even )?better than {S}', (x, e, a, b) => x + ' es ' + (e ? 'incluso ' : '') + 'mejor que su ' + sc(a, b)],
    ['points for and against say about {W} wins from {W} games; they have {W}',
      (a, g, w) => 'los puntos a favor y en contra apuntan a ' + wins(a, true) + ' en ' + cnt(g, 'partido', 'partidos') + '; lleva ' + nw(w, true)],
    ['they have been outscored by {F} a game and still win; records built on close finishes tend to drift back towards the points',
      f => 'encaja ' + f + ' puntos más de los que anota por partido y aun así gana; los balances construidos en finales ajustados tienden a volver hacia lo que dicen los puntos'],
    ['records built on close finishes tend to drift back towards the points', () => 'los balances construidos en finales ajustados tienden a volver hacia lo que dicen los puntos'],
    ['they outscore opponents by {F} a game, and a side that does that usually gets the wins in the end',
      f => 'anota ' + f + ' puntos más que sus rivales por partido, y un equipo que hace eso suele acabar sumando las victorias'],
    ['they have been outscored by only {F} a game; {S} in games decided by five or fewer is where the wins went',
      (f, a, b) => 'solo encaja ' + f + ' puntos más de los que anota por partido; su ' + sc(a, b) + ' en partidos decididos por cinco puntos o menos es donde se le fueron las victorias'],
    ['they have been outscored by only {F} a game, which is the record of a side nearer the middle',
      f => 'solo encaja ' + f + ' puntos más de los que anota por partido, lo propio de un equipo más cerca de la zona media'],
    ['closing out tight games is a skill too: they are {S} in them', (a, b) => 'cerrar partidos igualados también es una habilidad: va ' + sc(a, b) + ' en ellos'],
    ['they have still been outscored over the season: better than the record is not the same as good',
      () => 'aun así, en el conjunto de la temporada ha encajado más de lo que ha anotado: ser mejor que su balance no es lo mismo que ser bueno'],
    ['next: (.+)', t => { const n = nx(t); return n && 'próximo partido: ' + n; }],
    ['a data piece: the record against the points', () => 'una pieza de datos: el balance frente a los puntos'],
    ['what the close games have in common', () => 'qué tienen en común los partidos igualados'],

    /* ---- what wins for them, and what wins here ---- */
    ['{X} live and die by {L}, even for this league', (x, l) => x + ' vive y muere con ' + fac(l) + ', incluso para lo que es esta liga'],
    ['{X} win and lose on {L}', (x, l) => x + ' gana o pierde según ' + fac(l)],
    ['in their wins {L} has been worth {F} points a game to them; in their defeats, {F}',
      (l, a, b) => 'en sus victorias, ' + fac(l) + ' le ' + vb(fac(l), 'ha', 'han') + ' valido ' + a + ' puntos por partido; en sus derrotas, ' + b],
    ['every club here rises and falls with {L}; for {X} the swing between wins and defeats is {F} points a game, against {F} for a typical club',
      (l, x, a, b) => 'todos los equipos de esta liga suben y bajan con ' + fac(l) + '; para ' + x + ', la diferencia entre victorias y derrotas es de ' + a + ' puntos por partido, frente a ' + b + ' de un equipo típico'],
    ['most clubs here rise and fall with {L}; {P} results turn on {L}, a swing of {F} points a game between their wins and their defeats, against {F} for a typical club',
      (l, x, l2, a, b) => 'la mayoría de los equipos de esta liga suben y bajan con ' + fac(l) + '; los resultados de ' + x + ' dependen de ' + fac(l2) +
        ', con una diferencia de ' + a + ' puntos por partido entre sus victorias y sus derrotas, frente a ' + b + ' de un equipo típico'],
    ['watch it next (.+)', t => { const w = when(t); return w && 'habrá que fijarse en ello ' + w; }],
    ['a data piece: the one number to watch in their games', () => 'una pieza de datos: la cifra que hay que mirar en sus partidos'],
    ['a coach’s-eye preview built on it', () => 'una previa con mirada de entrenador construida a partir de ella'],
    ['{L} swings their results more than it does for most clubs here', l => fac(l) + ' ' + vb(fac(l), 'pesa', 'pesan') + ' más en sus resultados que en los de la mayoría de equipos de esta liga'],
    ['{L} separates their wins from their defeats', l => fac(l) + ' ' + vb(fac(l), 'marca', 'marcan') + ' la diferencia entre sus victorias y sus derrotas'],
    ['{L} decides more games in this league than anything else', l => fac(l) + ' ' + vb(fac(l), 'decide', 'deciden') + ' más partidos en esta liga que cualquier otra cosa'],
    ['one standard step better than the average club at {L} is worth about {F} points a game here; at {L}, {F}',
      (l, a, l2, b) => 'estar una desviación típica por encima del equipo medio en ' + fac(l) + ' vale unos ' + a + ' puntos por partido aquí; en ' + fac(l2) + ', ' + b],
    ['it is the lens to read every result and every preview through', () => 'es la lente con la que leer cada resultado y cada previa'],
    ['an explainer for new readers', () => 'un artículo explicativo para nuevos lectores'],
    ['a recurring "the number that matters" box', () => 'un recuadro fijo de «la cifra que importa»'],

    /* ---- the players ---- */
    ['{X} has scored 20 or more in (?:all {W} games this season|{W} straight games)',
      (p, a, w) => (a ? p + ' ha anotado 20 puntos o más en los ' + nw(a) + ' partidos de la temporada' : p + ' suma ' + cnt(w, 'partido', 'partidos') + ' seguidos con 20 puntos o más')],
    ['{F} points a game(?: for {X})?, with a high of {D}', (f, x, d) => f + ' puntos por partido' + (x ? ' en ' + x : '') + ', con un máximo de ' + d],
    ['{F} points a game over the run(?: for {X})?, against {F} for the season',
      (a, x, b) => a + ' puntos por partido' + (x ? ' en ' + x : '') + ' durante la racha, frente a ' + b + ' en toda la temporada'],
    ['the league’s top scorer, at {F} a game, and nobody has found an answer yet', f => 'el máximo anotador de la liga, con ' + f + ' por partido, y nadie ha encontrado todavía la respuesta'],
    ['over the run, {X} has scored {D}% of {P} points', (p, d, x) => 'durante la racha, ' + p + ' ha anotado el ' + d + '% de los puntos de ' + x],
    ['nobody guards a scorer in this kind of form with one player', () => 'a un anotador en esta forma no se le defiende con un solo jugador'],
    ['a player feature', () => 'un reportaje sobre el jugador'],
    ['a shot chart and a clip from each of the games', () => 'una carta de tiro y un vídeo de cada uno de los partidos'],
    ['{X} is scoring {F} a game over the last five(?: for {X})?', (p, f, x) => p + ' promedia ' + f + ' puntos en los últimos cinco partidos' + (x ? ' con ' + x : '')],
    ['up from {F} before that', f => 'antes promediaba ' + f],
    ['the minutes explain most of it: up from {F} to {F} a game', (a, b) => 'los minutos lo explican casi todo: ha pasado de ' + a + ' a ' + b + ' por partido'],
    ['much the same minutes \\({F} a game against {F}\\), many more points: the shots are falling, or the role has changed',
      (a, b) => 'casi los mismos minutos (' + a + ' por partido frente a ' + b + '), muchos más puntos: o los tiros están entrando, o su papel ha cambiado'],
    ['what changed: the minutes, and why the coach is giving them', () => 'qué ha cambiado: los minutos, y por qué se los está dando el entrenador'],
    ['what changed: the role and the shots', () => 'qué ha cambiado: el papel y los tiros'],
    ['{X} is {W} points? from {D} this season', (p, w, d) => 'a ' + p + ' le ' + (val(w) === 1 ? 'falta un punto' : 'faltan ' + nw(w) + ' puntos') + ' para los ' + d + ' esta temporada'],
    ['nobody in the league has reached {D} yet', d => 'nadie en la liga ha llegado todavía a los ' + d + ' puntos'],
    ['{F} a game(?: for {X})?; {W} games? so far', (f, x, w) => f + ' puntos por partido' + (x ? ' en ' + x : '') + '; ' + cnt(w, 'partido', 'partidos') + ' hasta ahora'],
    ['it could come (.+)', t => { const w = when(t); return w && 'podría llegar ' + w; }],
    ['a social post ready for the night it happens', () => 'una publicación para redes lista para la noche en que llegue'],
    ['{X} has not played in {P} last {W} games', (p, x, w) => p + ' no ha jugado los ' + nw(w) + ' últimos partidos de ' + x],
    ['before that: {F} minutes and {F} points a game', (a, b) => 'hasta entonces: ' + a + ' minutos y ' + b + ' puntos por partido'],
    ['{X} are {S} without them', (x, a, b) => x + ' va ' + sc(a, b) + ' en su ausencia'],
    ['a player taking this many minutes is a big part of how a side plays; how they cope without them is the story',
      () => 'un jugador con tantos minutos es una parte importante de cómo juega un equipo; la historia es cómo se las arregla el equipo en su ausencia'],
    ['how the rotation has changed without them', () => 'cómo ha cambiado la rotación en su ausencia'],
    ['{X} leads the league in box plus-minus', p => p + ' lidera la liga en box plus-minus'],
    ['{F} BPM on {F} points, {F} rebounds and {F} assists (?:in {F} minutes )?a game(?: for {X})?',
      (f, a, b, c, m, x) => f + ' de BPM con ' + a + ' puntos, ' + b + ' rebotes y ' + c + ' asistencias' + (m ? ' en ' + m + ' minutos' : '') + ' por partido' + (x ? ' en ' + x : '')],
    ['box plus-minus counts everything in the box score against what a player’s minutes are worth; it is the closest thing the box has to a player’s value',
      () => 'el box plus-minus mide todo lo que recoge la estadística frente a lo que valen los minutos de un jugador; es lo más parecido que tiene la estadística al valor de un jugador'],
    ['a player profile built on the whole line, not the points', () => 'un perfil del jugador construido con toda su línea estadística, no solo con los puntos'],
    ['a "most valuable so far" ranking', () => 'una clasificación de «los más valiosos hasta ahora»'],
    ['{X} is one of the league’s best players on {F} points a game', (p, f) => p + ' está entre lo mejor de la liga con solo ' + f + ' puntos por partido'],
    ['{F} BPM, {K} in the league, {K} in scoring(?:, for {X})?', (f, a, b, x) => f + ' de BPM, ' + pos(a) + ' de la liga, ' + pos(b) + ' en anotación' + (x ? ', en ' + x : '')],
    ['points get noticed; the rest of a good night rarely does', () => 'los puntos se ven; el resto de una buena noche, casi nunca'],
    ['a feature: what they do that the scoring column misses', () => 'un reportaje: lo que hace y no recoge la columna de puntos'],
    ['{X}, {D}, is the best young player in the league by the numbers', (p, d) => p + ', ' + d + ' años, es el mejor talento joven de la liga según los números'],
    ['nobody else aged 21 or under with a real role comes close: {X} is next, at {F}', (p, f) => 'nadie más de 21 años o menos con un papel real se le acerca: le sigue ' + p + ', con ' + f],
    ['nobody else aged 21 or under has a role like it', () => 'nadie más de 21 años o menos tiene un papel así'],
    ['a feature on the player and the minutes the club is giving them', () => 'un reportaje sobre el jugador y los minutos que le está dando el club'],

    /* ---- the foot of the table ---- */
    ['{X} are bottom at {S}, (?:{G} behind|level with) {X}', (x, a, b, w, y) => x + ' es colista con ' + sc(a, b) + ', ' + (w ? 'a ' + gw(w) + ' de ' + y : 'empatado con ' + y)],
    ['their last five: ((?:[WL] ?){1,5})', s => 'sus últimos cinco: ' + s.trim().split(/\s+/).map(WL).join(' ')],
    ['where the points could come from: the fixtures ahead', () => 'de dónde podrían llegar los puntos: los próximos partidos'],

    /* ---- the season's best nights, and the team records ---- */
    ['{X}’s {W} (points|rebounds|assists|threes) (are|equal) the most in a game this season', (p, w, k, e) => {
      const f = /^assists$/i.test(k), one = val(w) === 1;
      const noun = { points: ['punto', 'puntos'], rebounds: ['rebote', 'rebotes'], assists: ['asistencia', 'asistencias'], threes: ['triple', 'triples'] }[k.toLowerCase()];
      const what = one ? (f ? 'la única ' : 'el único ') + noun[0] : (f ? 'las ' : 'los ') + nw(w, f) + ' ' + noun[1];
      return what + ' de ' + p + (/^equal$/i.test(e) ? (one ? ' iguala' : ' igualan') : (one ? ' es' : ' son')) + ' la mejor marca en un partido esta temporada';
    }],
    ['for {X}, {Y}', (x, d) => 'con ' + x + ', ' + el(d)],
    ['every other night this season is measured against (these|it) now', k => 'desde ahora, cualquier otra noche de la temporada se mide con ' + (/these/i.test(k) ? 'estas marcas' : 'esta')],
    ['the night, in the play-by-play', () => 'la noche, jugada a jugada'],
    ['a graphic of each line', () => 'un gráfico de cada línea estadística'],
    ['the night, in the numbers', () => 'la noche, en números'],
    ['{P} {D}-point win over {X} is the biggest of the season', (x, d, y) => 'la victoria de ' + x + ' por ' + d + ' puntos ante ' + y + ' es la más amplia de la temporada'],
    ['{P} {D} points against {X} are the most points in a game this season', (x, d, y) => 'los ' + d + ' puntos de ' + x + ' ante ' + y + ' son la mayor anotación en un partido esta temporada'],
    ['{P} {D} threes against {X} are the most threes in a game this season', (x, d, y) => 'los ' + d + ' triples de ' + x + ' ante ' + y + ' son la mayor cifra de triples en un partido esta temporada'],

    /* ---- the game of the week ---- */
    ['stolen in the last five minutes', () => 'un partido robado en los últimos cinco minutos'],
    ['a big lead thrown away', () => 'una gran ventaja desperdiciada'],
    ['a comeback', () => 'una remontada'],
    ['it went to overtime', () => 'hubo prórroga'],
    ['the lead changed hands again and again', () => 'el liderato cambió de manos una y otra vez'],
    ['a lead nearly given away', () => 'una ventaja que estuvo a punto de esfumarse'],
    ['decided by a single score', () => 'decidido por una sola canasta'],
    ['it went to the last shot', () => 'se decidió en el último tiro'],
    ['{X} won it at the death', p => p + ' lo ganó en el último suspiro'],
    ['{X} put them ahead for good late on', p => p + ' puso a su equipo por delante de forma definitiva en el tramo final'],
    ['the recap, rewritten as a feature with the moments in it', () => 'la crónica, reescrita como reportaje con sus momentos clave'],
    ['the highlights, cut around the finish', () => 'el resumen, montado en torno al final'],
    ['a clip of the finish', () => 'un vídeo del final'],

    /* ---- the same two twice: a sweep, a split ---- */
    ['{X} sweep {X}', (x, y) => 'doble victoria de ' + x + ' ante ' + y],
    ['wins of {S} on {V} and {S} on {V}', (a, b, d1, c, e, d2) => 'victorias por ' + sc(a, b) + ' ' + wday(d1) + ' y por ' + sc(c, e) + ' ' + wday(d2)],
    ['{X} are {K}, {X} {K}', (x, a, y, b) => x + ' es ' + place(a) + '; ' + y + ', ' + place(b)],
    ['two wins over a side {W} places above them in the table', w => 'dos victorias ante un rival que está ' + nw(w) + ' puestos por encima en la clasificación'],
    ['two games against the same side in a few days test the adjustments, and only one side made them',
      () => 'dos partidos contra el mismo rival en pocos días ponen a prueba los ajustes, y solo uno de los dos supo hacerlos'],
    ['the two games as one story: what the losers changed, and why it did not work', () => 'los dos partidos como una sola historia: qué cambió el perdedor y por qué no funcionó'],
    ['{X} and {X} split their two games', (x, y) => x + yy(y) + y + ' se reparten sus dos partidos'],
    ['{X} won {S} on {V}; {X} answered {S} on {V}', (x, a, b, d1, y, c, e, d2) => x + ' ganó ' + sc(a, b) + ' ' + wday(d1) + '; ' + y + ' respondió con un ' + sc(c, e) + ' ' + wday(d2)],
    ['{X} won one of them at the death', p => p + ' decidió uno de ellos en el último suspiro'],
    ['{X} turned a {W}-point defeat into a {W}-point win', (x, a, b) => x + ' convirtió una derrota por ' + cnt(a, 'punto', 'puntos') + ' en una victoria por ' + cnt(b, 'punto', 'puntos')],
    ['what changed between the two games', () => 'qué cambió entre un partido y otro'],

    /* ---- the upsets ---- */
    ['it ended {P} run of {W} straight wins', (x, w) => 'acabó con la racha de ' + nw(w, true) + ' victorias seguidas de ' + x],
    ['the season’s numbers made {X} clear favourites, by about {W} points', (x, w) => 'los números de la temporada hacían claro favorito a ' + x + ', por unos ' + nw(w) + ' puntos'],
    ['{W} places separate them in the table', w => nw(w) + ' puestos los separan en la clasificación'],
    ['results like this are where tables get rearranged', () => 'resultados así son los que reordenan una clasificación'],
    ['{X}, {K}, beat {X}, {K}, {S}', (x, a, y, b, s1, s2) => x + ', ' + pos(a) + ', gana a ' + y + ', ' + pos(b) + ' (' + sc(s1, s2) + ')'],
    ['{X} \\({K}\\) beat {X} \\({K}\\)', (x, a, y, b) => x + ' (' + pos(a) + ') ganó a ' + y + ' (' + pos(b) + ')'],
    ['{X} beat {X} {S}', (x, y, a, b) => x + ' ganó a ' + y + ' por ' + sc(a, b), 'dot'],
    ['the season’s numbers had {X} by about {W} before the tip', (x, w) => 'antes del salto inicial, los números de la temporada daban ganador a ' + x + ' por unos ' + nw(w) + ' puntos'],
    ['{R} (?:was|were) worth about {D} points? to them', (l, d) => { const f = rfac(l); return f && f + ' le ' + vb(f, 'valió', 'valieron') + ' ' + abt(d); }],
    ['what the winners did that nobody expected', () => 'lo que hizo el vencedor y nadie esperaba'],

    /* ---- the play-offs: a tie over two legs ---- */
    ['((?:first leg|leg 1): .+)', s => legs(s)],
    ['{X} go through on aggregate, {S}', (x, a, b) => x + ' pasa la eliminatoria con un global de ' + sc(a, b)],
    ['decided by {W} points? over {W} legs',
      (d, n) => (val(d) === 0 ? 'decidida sin diferencia en el global' : 'decidida por ' + cnt(d, 'punto', 'puntos')) + (val(n) === 2 ? ' entre la ida y la vuelta' : ' en ' + nw(n) + ' partidos')],
    ['{X} won the (first leg|second leg|leg \\d+) by {W} and still went out', (x, l, w) => x + ' ganó ' + legEs(l, true) + ' por ' + cnt(w, 'punto', 'puntos') + ' y aun así quedó eliminado'],
    ['{X} won (both legs|every leg)', (x, k) => x + (/both/i.test(k) ? ' ganó la ida y la vuelta' : ' ganó todos los partidos')],
    ['{X} take a {W}-point lead into the (second leg|leg \\d+) against {X}', (x, w, l, y) => x + ' afronta ' + legEs(l, true) + ' ante ' + y + ' con ' + cnt(w, 'punto', 'puntos') + ' de ventaja'],
    ['{X} and {X} are level after the (first leg|leg \\d+)', (x, y, l) => x + yy(y) + y + ' llegan igualados tras ' + legEs(l, true)],
    ['decided on aggregate: a lead of {W} points? is (close to decisive|a cushion, not a certainty|next to nothing) with a leg to play',
      (w, k) => 'se decide en el global: ' + (val(w) === 0 ? 'nadie tiene ventaja y queda un partido por jugar'
        : 'con un partido por jugar, una ventaja de ' + cnt(w, 'punto', 'puntos') + ' es ' + { 'close to decisive': 'casi decisiva', 'a cushion, not a certainty': 'un colchón, no una garantía', 'next to nothing': 'casi nada' }[k.toLowerCase()])],
    ['(second leg|leg \\d+): {Y}, with {X} at home', (l, d, x) => legEs(l) + ': ' + fecha(d) + ', en la pista de ' + x],
    ['{X} v {X}: the (first leg|leg 1) is on (?:{Y}|(its way))', (x, y, l, d, way) => x + ' vs ' + y + ': ' + legEs(l, true) + (way ? ' está al caer' : ' se juega ' + el(d))],
    ['two legs, decided on aggregate', () => 'ida y vuelta, con el global como juez'],
    ['how the tie was won, leg by leg', () => 'cómo se ganó la eliminatoria, partido a partido'],
    ['a preview of the next leg: what the side behind has to change', () => 'una previa del siguiente partido: qué tiene que cambiar el que va por detrás'],

    /* ---- the play-offs: a series ---- */
    ['{X} are through, {S} against {X}', (x, a, b, y) => x + ' pasa de ronda: ' + sc(a, b) + ' ante ' + y],
    ['{X} v {X}: the series starts (?:{Y}|(soon))', (x, y, d, soon) => x + ' vs ' + y + ': la serie empieza ' + (soon ? 'pronto' : el(d))],
    ['{X} take game 1 against {X}', (x, y) => x + ' se lleva el primer partido ante ' + y],
    ['{X} lead {X} {S}', (x, y, a, b) => x + ' va ganando ' + sc(a, b) + ' a ' + y],
    ['{X} and {X} are level at {S}', (x, y, a, b) => x + yy(y) + y + ' igualan la serie ' + sc(a, b)],
    ['{X} are one win from going through, in a best of {W}', (x, w) => 'a ' + x + ' le falta una victoria para pasar, en una serie al mejor de ' + nw(w)],
    ['the lower seed has the lead: {X} finished {W} places? above them', (x, w) => 'el peor clasificado va por delante: ' + x + ' acabó ' + cnt(w, 'puesto', 'puestos') + ' por encima'],
    ['game {D} was decided by {W} points?', (d, w) => gameOrd(d) + ' se decidió por ' + cnt(w, 'punto', 'puntos')],
    ['{X} won their only regular-season meeting', x => x + ' ganó el único enfrentamiento de la liga regular'],
    ['{X} won (both|all {W}) of their regular-season meetings', (x, k, w) => x + ' ganó los ' + (w ? nw(w) : 'dos') + ' enfrentamientos de la liga regular'],
    ['they split their regular-season meetings {S}', (a, b) => 'se repartieron los enfrentamientos de la liga regular (' + sc(a, b) + ')'],
    ['in the play-offs every game moves the series', () => 'en el playoff, cada partido mueve la serie'],
    ['game {D}: {X} won {S} (at home|on the road)', (d, x, a, b, h) => gameOrd(d, false) + ': ' + x + ' ganó ' + sc(a, b) + (/home/i.test(h) ? ' en casa' : ' a domicilio')],
    ['{X} finished {K} in the regular season, {X} {K}', (x, a, y, b) => x + ' acabó ' + pos(a) + ' en la liga regular; ' + y + ', ' + pos(b)],
    ['game {D} is on {Y}, with {X} at home', (d, dt, x) => gameOrd(d) + ' es ' + el(dt) + ', en la pista de ' + x],
    ['how the series was won, game by game', () => 'cómo se ganó la serie, partido a partido'],
    ['a series preview: the regular-season meetings and the facet it turns on', () => 'una previa de la serie: los enfrentamientos de la liga regular y la faceta que la decide'],
    ['a game-by-game series tracker', () => 'un seguimiento de la serie partido a partido'],
    ['the matchup to watch on each side', () => 'el duelo a vigilar en cada equipo'],

    /* ---- the schedule so far ---- */
    ['{P} {S} has come against the hardest schedule in the league', (x, a, b) => 'el ' + sc(a, b) + ' de ' + x + ' ha llegado ante el calendario más duro de la liga'],
    ['their opponents so far average {F} points per 100 possessions, adjusted; the easiest schedule has been {P} \\({F}\\)',
      (a, x, b) => 'sus rivales tienen hasta ahora un neto ajustado medio de ' + a + ' puntos por 100 posesiones; el calendario más fácil ha sido el de ' + x + ' (' + b + ')'],
    ['against the schedule they have played, their margins rank {K} in the league: the record undersells them',
      k => 'teniendo en cuenta el calendario que ha jugado, su diferencia de puntos es ' + (ordv(k) === 1 ? 'la mejor' : 'la ' + pos(k).replace(/o$/, 'a') + ' mejor') + ' de la liga: el balance no le hace justicia'],
    ['a record against the league’s best is worth more than the same record against its worst', () => 'un balance ante los mejores de la liga vale más que el mismo balance ante los peores'],
    ['a data piece: the records that the schedule explains', () => 'una pieza de datos: los balances que explica el calendario'],
    ['the run of fixtures ahead, by strength', () => 'los próximos partidos, según la fuerza del rival'],
    ['by the margins, adjusted for the schedule, {X} are the best side in the league', x => 'por diferencia de puntos, ajustada al calendario, ' + x + ' es el mejor equipo de la liga'],
    ['{F} points per 100 possessions against the opponents they have had; they are {K} in the table at {S}',
      (f, k, a, b) => f + ' puntos por 100 posesiones frente a los rivales que ha tenido; es ' + place(k) + ' en la clasificación con ' + sc(a, b)],
    ['the table counts wins; adjusted margins count how well a side has played against whom, and they are the better guide to what comes next',
      () => 'la clasificación cuenta victorias; la diferencia ajustada mide lo bien que ha jugado un equipo y contra quién, y es mejor guía de lo que viene'],
    ['the table is what decides the season, and {X} are top of it', x => 'la clasificación es lo que decide la temporada, y ' + x + ' es líder'],
    ['a power ranking built on adjusted margins, beside the table', () => 'un power ranking basado en la diferencia ajustada, junto a la clasificación'],

    /* ---- the fans' vote ---- */
    ['the fans’ player of the week: {X}', p => 'la elección de la afición esta semana: ' + p],
    ['{D}% of the vote from {D} ballots(?:; {F} points a game that week)?', (p, n, f) => 'el ' + p + '% de los ' + n + ' votos emitidos' + (f ? '; ' + f + ' puntos por partido esa semana' : '')],
    ['the numbers had another week in mind: {P} BPM was {F}, against {F}', (x, a, b) => 'los números apuntaban a otro nombre: el BPM de ' + x + ' fue de ' + a + ', frente a ' + b],
    ['the numbers agree: the best box plus-minus of the three the fans liked most', () => 'los números coinciden: el mejor box plus-minus de los tres favoritos de la afición'],
    ['the fans’ pick against the numbers’ pick, side by side', () => 'la elección de la afición frente a la de los números, una junto a otra'],

    /* ---- what changed since the last build, and how a storyline ended ---- */
    ['now {W} straight \\(was {W}\\)', (a, b) => 'ya son ' + nw(a, true) + ' seguidas (eran ' + nw(b, true) + ')'],
    ['now {W} defeats in a row', w => 'ya son ' + nw(w, true) + ' derrotas seguidas'],
    ['now {W} straight 20-point games', w => 'ya son ' + cnt(w, 'partido', 'partidos') + ' seguidos con 20 puntos o más'],
    ['the gap (at the top|at the line) is now {G}', (k, w) => (/top/i.test(k) ? 'la diferencia en cabeza' : 'la diferencia en la línea de corte') +
      (gw(w) === 'ningún partido' ? ' ha desaparecido' : ' es ahora de ' + gw(w))],
    ['now {S}', (a, b) => 'ahora, ' + sc(a, b)],
    ['now {W} points away', w => 'ahora ' + (val(w) === 1 ? 'le falta un punto' : 'le faltan ' + nw(w) + ' puntos')],
    ['the series is now {S}', (a, b) => 'la serie va ahora ' + sc(a, b)],
    ['on aggregate, now {S}', (a, b) => 'en el global, ahora ' + sc(a, b)],
    ['updated with the latest games', () => 'actualizada con los últimos partidos'],
    ['ended at {W} by {X}, {S}', (w, x, a, b) => 'se cortó en ' + wins(w) + ': ' + x + ' ganó ' + sc(a, b)],
    ['ended with a win over {X}, {S}', (x, a, b) => 'se acabó con una victoria ante ' + x + ' (' + sc(a, b) + ')'],
    ['{X} ended it, {S}', (x, a, b) => x + ' le endosó su primera derrota (' + sc(a, b) + ')'],
    ['the first win came against {X}, {S}', (x, a, b) => 'la primera victoria llegó ante ' + x + ' (' + sc(a, b) + ')'],
    ['no longer running', () => 'ya no sigue en marcha'],

    /* ---- the storylines a game touches (the slate's threads) ---- */
    ['{P} run of {W} straight wins is on the line', (x, w) => 'está en juego la racha de ' + nw(w, true) + ' victorias seguidas de ' + x],
    ['{X} have lost {W} straight: a chance to end it', (x, w) => x + ' encadena ' + nw(w, true) + ' derrotas consecutivas: una oportunidad para cortar la racha'],
    ['{X} put their unbeaten record on the line', x => x + ' pone en juego su imbatibilidad'],
    ['{X} go looking for a first win again', x => x + ' vuelve a buscar su primera victoria'],
    ['{P} run of {W} straight 20-point games is on the line', (p, w) => 'está en juego la racha de ' + p + ': ' + cnt(w, 'partido', 'partidos') + ' seguidos con 20 puntos o más'],
    ['{X} needs {W} points? for {D} this season', (p, w, d) => 'a ' + p + ' le ' + (val(w) === 1 ? 'falta un punto' : 'faltan ' + nw(w) + ' puntos') + ' para los ' + d + ' esta temporada'],
    ['{X} has missed {P} last {W} games', (p, x, w) => p + ' se ha perdido los ' + nw(w) + ' últimos partidos de ' + x],
    ['two of the clubs at the top meet', () => 'se enfrentan dos de los equipos de cabeza'],
    ['two of the clubs fighting for the line meet', () => 'se enfrentan dos de los equipos que pelean por la línea de corte'],
    ['{P} results turn on {L}', (x, l) => 'los resultados de ' + x + ' dependen de ' + fac(l)],
    ['{X} comes in scoring {F} a game over the last five', (p, f) => p + ' llega promediando ' + f + ' puntos en los últimos cinco partidos'],

    /* ---- a suspension the league has recorded (said as the reason, and nothing else is) ---- */
    ['{X} is suspended(?:, with {W} games? left to serve)?',
      (p, w) => p + ' cumple sanción' + (w ? ': le ' + (val(w) === 1 ? 'queda un partido' : 'quedan ' + cnt(w, 'partido', 'partidos')) + ' por cumplir' : '')],
    ['out of {P} last {W} games(?:: a suspension of {W} games?)?', (x, w, k) => 'fuera de los ' + nw(w) + ' últimos partidos de ' + x + (k ? ' por una sanción de ' + cnt(k, 'partido', 'partidos') : '')],
    ['(?:the suspension runs to {Z}; |until it is served, ){X} are without {F} minutes and {F} points a game',
      (d, x, a, b) => (d ? 'la sanción dura hasta el ' + dia(d) + '; ' : 'mientras dure la sanción, ') + x + ' se queda sin ' + a + ' minutos y ' + b + ' puntos por partido'],

    /* ---- the closer: the week's points in clutch time ---- */
    ['{X} scored {D} points in clutch time this week', (p, d) => p + ' suma ' + d + ' puntos en los minutos decisivos esta semana'],
    ['that is {D} of {P} {D} points in the closing minutes of (?:a close game they (won|lost)|{W} close games; they won (both|all {W}|{W}))',
      (a, x, b, r, n, k, all, w) => 'son ' + a + ' de los ' + b + ' puntos de ' + x + ' en los minutos finales de ' +
        (r ? 'un partido igualado que ' + (/won/i.test(r) ? 'ganó' : 'perdió')
          : cnt(n, 'partido igualado', 'partidos igualados') + '; ' + (/^both$/i.test(k) ? 'ganó los dos' : all ? 'ganó los ' + nw(all)
            : val(w) === 0 ? 'no ganó ninguno' : val(w) === 1 ? 'ganó uno' : 'ganó ' + nw(w)))],
    ['when the game is on the line, the ball goes to {X}', p => 'cuando el partido está en juego, el balón va para ' + p],
    ['points at the end of close games are the ones a season turns on', () => 'los puntos al final de los partidos igualados son los que deciden una temporada'],
    ['points in clutch time', () => 'puntos en los minutos decisivos'],
    ['close finishes', () => 'finales igualados'],
    ['share of the club’s', () => 'porcentaje del equipo'],
    ['the closer: a feature built on the last four minutes', () => 'el jugador decisivo: un reportaje construido sobre los cuatro últimos minutos'],
    ['a clip of every basket in clutch time', () => 'un vídeo de cada canasta en los minutos decisivos'],

    /* ---- questions to ask, to a club's coach ("Ash City’s coach") or to a player by name: "ustedes" for the club, "usted"
       for the person; each rule writes the opening "¿" where the question starts (the "?" is put back after) ---- */
    ['{P} coach', x => 'entrenador de ' + x],
    ['does the table mean anything yet, {W} games? in', w => '¿significa algo ya la clasificación, tras ' + cnt(w, 'partido', 'partidos')],
    ['with {W} games? left, is first place yours to lose', w => 'a falta de ' + cnt(w, 'partido', 'partidos') + ', ¿el primer puesto ya solo depende de ustedes'],
    ['you are sure of a top-{W} finish: what are you playing for now', n => 'tienen asegurado acabar entre los ' + nw(n) + ' primeros: ¿qué se juegan ahora'],
    ['with the top {W} out of reach, what is the rest of the season for', n => 'con los ' + nw(n) + ' primeros puestos ya fuera de su alcance, ¿para qué sirve el resto de la temporada'],
    ['your {L} has been worth {F} points a game in the run, against {F} before it: what changed',
      (l, a, b) => fac(l) + ' les ' + vb(fac(l), 'ha', 'han') + ' valido ' + a + ' puntos por partido durante la racha, frente a ' + b + ' antes: ¿qué ha cambiado'],
    ['what has changed in the last {W} games', w => '¿qué ha cambiado en los ' + nw(w) + ' últimos partidos'],
    ['none of the {W} wins came against a side above you in the table: what will the run tell you about this team',
      w => 'ninguna de las ' + nw(w, true) + ' victorias ha llegado ante un rival por encima en la clasificación: ¿qué les dirá la racha sobre este equipo'],
    ['your {L} has gone from {F} points a game to {F} in the run: is that the first thing to fix',
      (l, a, b) => fac(l) + ' ' + vb(fac(l), 'ha', 'han') + ' pasado de ' + a + ' puntos por partido a ' + b + ' durante la racha: ¿es lo primero que hay que corregir'],
    ['what has to change to end the run', () => '¿qué tiene que cambiar para cortar la racha'],
    ['nobody has got closer than {W} points: what has made you so hard to beat', w => 'nadie se ha quedado a menos de ' + cnt(w, 'punto', 'puntos') + ': ¿qué les hace tan difíciles de batir'],
    ['your closest win was by {W}: which game nearly got away', w => 'su victoria más ajustada fue por ' + cnt(w, 'punto', 'puntos') + ': ¿qué partido estuvo a punto de escapárseles'],
    ['your opponents so far have been among the weakest in the league: how much does {S} prove',
      (a, b) => 'hasta ahora sus rivales han estado entre los más flojos de la liga: ¿cuánto demuestra ese ' + sc(a, b)],
    ['your closest defeat was by {W}: what has been missing at the end of games', w => 'su derrota más ajustada fue por ' + cnt(w, 'punto', 'puntos') + ': ¿qué les ha faltado en los finales de partido'],
    ['you are {S} in games decided by five or fewer: how much of that is skill, and how much will last',
      (a, b) => 'van ' + sc(a, b) + ' en partidos decididos por cinco puntos o menos: ¿cuánto de eso es mérito y cuánto durará'],
    ['your points for and against say about {W} wins, not {W}: where have the close games gone',
      (a, b) => 'sus puntos a favor y en contra apuntan a ' + wins(a, true) + ', no a ' + nw(b, true) + ': ¿dónde se les han ido los partidos igualados'],
    ['your results swing with {L} more than almost anyone else’s here: is that a plan or a problem', l => 'sus resultados dependen de ' + fac(l) + ' más que los de casi nadie en esta liga: ¿es un plan o un problema'],
    ['your results turn on {L} more than on anything else: is that by design', l => 'sus resultados dependen de ' + fac(l) + ' más que de cualquier otra cosa: ¿es algo buscado'],
    ['you have scored 20 or more in every game this season: what is working', () => 'ha anotado 20 puntos o más en todos los partidos de la temporada: ¿qué está funcionando'],
    ['you have scored 20 or more in {W} straight games: what has changed', w => 'lleva ' + cnt(w, 'partido', 'partidos') + ' seguidos con 20 puntos o más: ¿qué ha cambiado'],
    ['{X} has scored {D}% of your points over the run: what happens when teams take that away',
      (p, d) => p + ' ha anotado el ' + d + '% de sus puntos durante la racha: ¿qué pasa cuando los rivales se lo quitan'],
    ['{P} minutes have gone from {F} to {F} a game: what has earned them', (p, a, b) => 'los minutos de ' + p + ' han pasado de ' + a + ' a ' + b + ' por partido: ¿cómo se los ha ganado'],
    ['much the same minutes and many more points: what is different', () => 'casi los mismos minutos y muchos más puntos: ¿qué ha cambiado'],
    ['how do you cover {P} {F} minutes while the suspension runs', (p, f) => '¿cómo van a cubrir los ' + f + ' minutos de ' + p + ' mientras dure la sanción'],
    ['how has the rotation changed without {X}', p => '¿cómo ha cambiado la rotación sin ' + p],
    ['you lead the league in box plus-minus on {F} points a game: what part of your game do people miss',
      f => 'lidera la liga en box plus-minus con ' + f + ' puntos por partido: ¿qué parte de su juego pasa desapercibida'],
    ['{X} ranks {K} in the league by box plus-minus on {F} points a game: what does the box score miss',
      (p, k, f) => p + ' es ' + pos(k) + ' de la liga en box plus-minus con ' + f + ' puntos por partido: ¿qué no recoge la estadística'],
    ['{X} scored {D} of your {D} points in the closing minutes: does the ball always go to {X} at the end',
      (p, a, b, q) => p + ' anotó ' + a + ' de sus ' + b + ' puntos en los minutos finales: ¿el balón va siempre a ' + q + ' al final'],
    ['two defeats to the same side in a few days: what did they do that you could not answer', () => 'dos derrotas ante el mismo rival en pocos días: ¿qué hicieron que ustedes no supieron contrarrestar'],
    ['the season’s numbers had {X} by about {W}: what did you do that they did not expect',
      (x, w) => 'los números de la temporada daban favorito a ' + x + ' por unos ' + nw(w) + ' puntos: ¿qué hicieron ustedes que ellos no esperaban'],
    ['what did you see in {X} that the table did not', x => '¿qué vieron en ' + x + ' que la clasificación no veía'],
    ['you are {W} points? down going into the second leg: how do you approach it', w => 'llegan a la vuelta con ' + cnt(w, 'punto', 'puntos') + ' de desventaja: ¿cómo la afrontan'],
    ['you finished {W} places? above them and lost game {D}: what changes for the next one',
      (w, d) => 'acabaron ' + cnt(w, 'puesto', 'puestos') + ' por encima y perdieron ' + gameOrd(d) + ': ¿qué cambia para el siguiente'],
    ['game {D} came down to {W} points?: what decides the next one', (d, w) => gameOrd(d) + ' se decidió por ' + cnt(w, 'punto', 'puntos') + ': ¿qué decidirá el siguiente'],
    ['you lost game {D} by {W}: what has to change', (d, w) => 'perdieron ' + gameOrd(d) + ' por ' + cnt(w, 'punto', 'puntos') + ': ¿qué tiene que cambiar'],
    ['what did game {D} teach you about this matchup', d => '¿qué les enseñó ' + gameOrd(d) + ' sobre este emparejamiento'],
    ['you have played the hardest schedule in the league: how much better is this team than {S}',
      (a, b) => 'han jugado el calendario más duro de la liga: ¿cuánto mejor que su ' + sc(a, b) + ' es este equipo'],
    ['by the margins, adjusted for whom you have played, you are the best side in the league: do you believe it',
      () => 'por diferencia de puntos, ajustada a los rivales que han tenido, son el mejor equipo de la liga: ¿se lo creen'],
    ['{X} is {D} and already among your best: how big will the role get', (p, d) => p + ' tiene ' + d + ' años y ya está entre sus mejores jugadores: ¿hasta dónde crecerá su papel'],

    /* ---- the award races: the value and its measure ---- */
    ['{F}((?: · [^·]+)+)', (f, rest) => { const it = rest.split(' · ').slice(1).map(detail); return it.indexOf(null) >= 0 ? null : f + ' · ' + it.join(' · '); }],

    /* ---- the big picture ---- */
    ['{W} games? into an? {D}-game regular season, with {W} games? left for most clubs',
      (a, d, l) => 'tras ' + cnt(a, 'partido', 'partidos') + ' de una liga regular de ' + d + ', a la mayoría de equipos ' +
        (val(l) === 1 ? 'le queda un partido' : val(l) === 0 ? 'no le queda ningún partido' : 'le quedan ' + cnt(l, 'partido', 'partidos'))],
    ['(?:in (.+?), )?{X} finished the regular season top at {S}, (?:{G} clear of|level with) {X}',
      (g, x, a, b, w, y) => (g ? 'en ' + grp(g) + ', ' : '') + x + ' acabó la liga regular como líder con ' + sc(a, b) + ', ' + (w ? 'con ' + gw(w) + ' de ventaja sobre ' + y : 'empatado con ' + y)],
    ['(?:in (.+?), )?{X} lead at {S}, (?:{G} clear of|level with) {X}',
      (g, x, a, b, w, y) => (g ? 'en ' + grp(g) + ', ' : '') + x + ' es líder con ' + sc(a, b) + ', ' + (w ? 'con ' + gw(w) + ' de ventaja sobre ' + y : 'empatado con ' + y)],
    ['there (?:is one club|are {W} clubs) within a game and a half of them', n => 'hay ' + (n ? cnt(n, 'equipo', 'equipos') : 'un equipo') + ' a partido y medio o menos del líder'],
    ['nobody else is within a game and a half of them', () => 'nadie más está a partido y medio o menos del líder'],
    ['across {D} games, home sides have won {D}% and games average {F} points between the two sides; {D}% have been decided by five or fewer',
      (n, h, p, c) => 'en ' + n + ' partidos, los locales han ganado el ' + h + '% y la media es de ' + p + ' puntos entre los dos equipos; el ' + c + '% se ha decidido por cinco puntos o menos'],
    ['what wins here, in points a game for being one standard step better than the average club: (.+)', l => {
      const it = l.split(/, | and /).map(s => { const m = /^(.+) (\d+(?:\.\d+)?)$/.exec(s); return m && fac(m[1]) ? fac(m[1]) + ' ' + m[2] : null; });
      return it.indexOf(null) >= 0 ? null : 'lo que gana aquí, en puntos por partido por estar una desviación típica por encima del equipo medio: ' + list(it);
    }],
    ['weighed by this league’s own model of what wins', () => 'ponderado con el modelo propio de esta liga sobre lo que gana partidos'],
    ['game by game, {L} has been the deciding facet {D}% of the time(?:, {L} {D}%)?',
      (l, p, l2, p2) => 'partido a partido, ' + fac(l) + ' ' + vb(fac(l), 'ha', 'han') + ' sido la faceta decisiva el ' + p + '% de las veces' + (l2 ? ', y ' + fac(l2) + ', el ' + p2 + '%' : '')],

    /* ---- the recaps worth writing, and the site's reasons a game stood out ---- */
    ['{R} decided it, about {D} points?', (l, d) => { const f = rfac(l); return f && f + ' ' + vb(f, 'decidió', 'decidieron') + ' el partido: ' + abt(d); }],
    ['top-of-the-table clash: {K} v {K}', (a, b) => 'duelo en la cabeza: ' + pos(a) + ' contra ' + pos(b)],
    ['top-three clash: {K} v {K}', (a, b) => 'duelo entre los tres primeros: ' + pos(a) + ' contra ' + pos(b)],
    ['table-top rivals: {K} v {K}', (a, b) => 'rivales de la zona alta: ' + pos(a) + ' contra ' + pos(b)],
    ['upset: {K} beat {K}', (a, b) => 'sorpresa: el ' + pos(a) + ' ganó al ' + pos(b)],
    ['triple-double(?:: (.+))?', p => 'triple-doble' + (p ? ': ' + p : '')],
    ['double-double(?:: (.+))?', p => 'doble-doble' + (p ? ': ' + p : '')],
    ['20-20 game(?:: (.+))?', p => '20 puntos y 20 rebotes' + (p ? ': ' + p : '')],
    ['{D}-point game(?:: (.+))?', (d, p) => 'partido de ' + d + ' puntos' + (p ? ': ' + p : '')],
    ['season high: {D} points', d => 'máximo de la temporada: ' + d + ' puntos'],
    ['decided by {D} points?', d => 'decidido por ' + d + ' ' + pl(d, 'punto', 'puntos')],
    ['{D} overtimes', d => d + ' prórrogas'],

    /* ---- the data notes ---- */
    ['{X} are {S} in games decided by five or fewer; {X} {S}', (x, a, b, y, c, d) => x + ' va ' + sc(a, b) + ' en partidos decididos por cinco puntos o menos; ' + y + ', ' + sc(c, d)],
    ['{X} are {S} at home', (x, a, b) => x + ' va ' + sc(a, b) + ' en casa'],
    ['{X} are {S} away from home', (x, a, b) => x + ' va ' + sc(a, b) + ' a domicilio'],
    ['{D} at {X} v {X}, {Y}', (n, x, y, d) => n + ' espectadores en el ' + x + ' vs ' + y + ', ' + el(d)],
    ['{D} points, by {X} against {X}', (n, x, y) => n + ' puntos, de ' + x + ' ante ' + y],
    ['worth about {F} points a game here, beyond the four factors', f => 'vale ' + abt(f) + ' por partido aquí, más allá de los cuatro factores'],
    ['the side most fans picked has won {D} of the last {D} games with ten or more picks \\({D}%\\)',
      (a, b, p) => 'el equipo más elegido por la afición ha ganado ' + a + ' de los últimos ' + b + ' partidos con diez o más pronósticos (' + p + '%)'],

    /* ---- the calendar ---- */
    ['preview: {X} v {X}(?: — (.+))?', (x, y, a) => { if (!a) return 'previa: ' + x + ' vs ' + y; const t = angle(a); return t && 'previa: ' + x + ' vs ' + y + ' — ' + t; }],
    ['recap after the game: {X} v {X}', (x, y) => 'crónica tras el partido: ' + x + ' vs ' + y],
    /* the plan's features, and a storyline's timeline ("Opened: <its head>.") */
    ['(feature|data piece|opened): (.+)', (k, h) => {
      const t = inner(h) || engine(h);
      return t && ({ feature: 'reportaje: ', 'data piece': 'pieza de datos: ', opened: 'se abre: ' })[k.toLowerCase()] + (/^[A-Z]/.test(h) ? cap(t) : t);
    }],
    ['the week in the play-offs: every series, where it stands, and what decided each game', () => 'la semana en el playoff: cada serie, cómo va y qué decidió cada partido'],
    ['the week in the league: the results, the table, and the storylines that moved', () => 'la semana en la liga: los resultados, la clasificación y las historias que se movieron'],

    /* ---- the slate's figures and the clubs' lines (newsdesk.js) ---- */
    ['{K} · {S}(?: · ([WL])(\\d+))?', (k, a, b, r, n) => pos(k) + ' · ' + sc(a, b) + (r ? ' · ' + WL(r) + n : '')],
    ['{S} · ([WL])(\\d+)', (a, b, r, n) => sc(a, b) + ' · ' + WL(r) + n],
    ['(, )?{F} ppg (over the last five|so far)', (c, f, k) => (c || '') + f + ' puntos por partido ' + (/five/i.test(k) ? 'en los últimos cinco' : 'hasta ahora')],
    ['the season’s numbers(:?)', c => 'los números de la temporada' + c],
    ['by about {F}', f => 'por unos ' + f + ' puntos'],
    ['meetings this season: {S}', (a, b) => 'enfrentamientos esta temporada: ' + sc(a, b)],
    ['fans: {D}% (.+) \\({D} picks\\)', (p, x, n) => 'afición: ' + p + '% ' + x + ' (' + n + ' pronósticos)'],
    ['watch(:?)', c => 'a seguir' + c],
    ['the game ↗', () => 'el partido ↗'],
    ['what is at stake', () => 'lo que está en juego'],
    ['(?:(one win)|{F} wins) (more|fewer) than their points say', (o, f, k) => (o ? 'una victoria' : f + ' victorias') + ' ' + (/more/i.test(k) ? 'más' : 'menos') + ' de lo que dicen sus puntos'],
    ['{F} wins against what their points say', f => f + ' ' + (Math.abs(parseFloat(f.replace('−', '-'))) === 1 ? 'victoria' : 'victorias') + ' frente a lo que dicen sus puntos'],
    ['close games {S}', (a, b) => 'partidos igualados: ' + sc(a, b)],
    ['{K}', k => pos(k)],
    ['{Y}', d => fecha(d)],
    /* a storyline's badge and its age */
    ['new', () => 'nueva'],
    ['updated', () => 'actualizada'],
    ['resolved|finished', () => 'terminada'],
    ['updated {D} (hours?|days?) ago', (d, u) => 'actualizada hace ' + d + ' ' + (/hour/i.test(u) ? pl(d, 'hora', 'horas') : pl(d, 'día', 'días'))],

    /* ---- composites: a game's angle on the slate; every series in one line ---- */
    ['([^;]*[A-Za-z][^;]*(?:; [^;]+)*)', s => angle(s)],
    ['([^:;]+): ([^;]+(?:; [^;]+)*)', (lab, l) => {
      const it = l.split('; ').map(status);
      if (it.indexOf(null) >= 0) return null;
      const t = /^the play-offs$/i.test(lab) ? 'playoff' : (engine(lab) || lab);
      return t + ': ' + it.join('; ');
    }]
  ];

  /* ------------------------------------------------------------ the engine side --- */
  const COMPILED = RULES.map(r => ({ re: rx(r[0]), outer: rx(r[0], '[.?]?'), fn: r[1], dot: r[2] === 'dot' }));
  /* a template inside another ("Feature: <a storyline's head>."): any rule but the full-stop ones */
  function inner(s) {
    for (const r of COMPILED) {
      if (r.dot) continue;
      const m = r.re.exec(s);
      if (m) { const o = r.fn(...m.slice(1)); if (o != null) return o; }
    }
    return null;
  }
  /* "de el" is "del", "a el" is "al"; the decimal comma; a capital where the English starts a sentence (a capital or a
     figure: "47% of the vote…" is "El 47% de los votos…") */
  const tidy = (s, whole) => {
    const t = String(s).replace(/(^|[\s(])de el (?=[a-záéíóúñ])/g, '$1del ').replace(/(^|[\s(])a el (?=[a-záéíóúñ])/g, '$1al ')
      .replace(/(\d)\.(\d)/g, '$1,$2');
    return /^[^A-Za-z0-9]*[A-Z0-9]/.test(whole) ? cap(t) : t;
  };
  /* a paragraph is left for the engine to split, so a name at the end of a template never swallows the next sentence */
  const BREAK = /(?<!(?:^|[\s(])(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.)(?<=[.!?])\s+(?=[A-Z0-9“"‘'(])/;
  /* the sentence's own mark is read off and put back: a full stop, or a question's "?" (the rule writes the opening "¿"
     where the question starts) */
  const wrap = r => (m, T, Q) => {
    const whole = m[0];
    if (BREAK.test(whole)) return null;
    const end = /[.?]$/.test(whole) ? whole.slice(-1) : '';
    if (r.dot && end !== '.') return null;
    const k = r.re.exec(end ? whole.slice(0, -1) : whole);
    if (!k) return null;
    QS.push(Q);
    try {
      const out = r.fn(...k.slice(1));
      return out == null ? null : tidy(out, whole) + end;
    } finally { QS.pop(); }
  };

  I.register('es', {
    phrases: {
    },

    ctx: {
      /* the fixed words around the sentences: the figures' labels, the plan's items, the site's reasons for a game */
      newsdesk: {
        'The race': 'La carrera',
        'Upset': 'Sorpresa',
        'the biggest win': 'la victoria más amplia',
        'the most points': 'más puntos',
        'the most threes': 'más triples',
        'BPM': 'BPM',
        'adjusted net': 'neto ajustado',
        'against': 'en contra, por partido',
        'age': 'edad',
        'aggregate': 'global',
        'assists': 'asistencias',
        'average margin': 'diferencia media',
        'ballots': 'votos',
        'before': 'antes',
        'clubs within a game and a half': 'equipos a partido y medio o menos',
        'expected wins': 'victorias esperadas',
        'games left': 'partidos restantes',
        'games missed': 'partidos sin jugar',
        'home court': 'factor cancha',
        'in games decided by five or fewer': 'en partidos decididos por cinco o menos',
        'in the run': 'en la racha',
        'last five': 'últimos cinco',
        'leader': 'líder',
        'leaders, adjusted net': 'neto ajustado del líder',
        'leader’s last five': 'últimos cinco del líder',
        'margin in the run': 'diferencia media en la racha',
        'minutes before': 'minutos antes',
        'minutes': 'minutos',
        'next best': 'el siguiente',
        'next': 'segundo',
        'opponents, adjusted net': 'neto ajustado de los rivales',
        'place': 'puesto',
        'points before': 'puntos antes',
        'points for, a game': 'a favor, por partido',
        'points': 'puntos',
        'rebounds': 'rebotes',
        'record without': 'balance en su ausencia',
        'record': 'balance',
        'regular season': 'liga regular',
        'run': 'racha',
        'season high': 'máximo de la temporada',
        'season': 'temporada',
        'seeds': 'cabezas de serie',
        'series': 'serie',
        'share of the club’s points in the run': 'porcentaje de los puntos del equipo en la racha',
        'share': 'porcentaje',
        'shooting': 'el tiro',
        'the turnover battle': 'las pérdidas',
        'the offensive glass': 'el rebote ofensivo',
        'getting to the line': 'la llegada a la línea de tiros libres',
        'the game': 'el partido',
        'the highlights': 'el resumen',
        'the numbers say it turns on': 'según los números, se decide en',
        'the two games': 'los dos partidos',
        'their adjusted net': 'su neto ajustado',
        'what decided it': 'lo que lo decidió',
        'what decided the second': 'lo que decidió el segundo',
        'what made it stand out': 'lo más destacado',
        'a full preview the day before': 'una previa completa la víspera',
        'a live thread': 'un directo',
        'a series preview the day before': 'una previa de la serie la víspera',
        'a short preview': 'una previa breve',
        'the recap': 'la crónica',
        'the recap and the numbers that decided it': 'la crónica y los números que lo decidieron',
        'the recap if it surprises': 'la crónica si hay sorpresa',
        'the recap, and where the series stands': 'la crónica y cómo va la serie',
        'Overtime': 'Prórroga',
        'Double overtime': 'Doble prórroga',
        'Playoff game': 'Partido de playoff',
        'Playoff tie': 'Eliminatoria de playoff',
        'Playoff final': 'Final de playoff',
        'Playoff semi-final': 'Semifinal de playoff',
        'Playoff quarter-final': 'Cuartos de final de playoff',
        'Final': 'Final',
        'Semi-final': 'Semifinal',
        'Quarter-final': 'Cuartos de final',
        'Knockout tie': 'Eliminatoria',
        'Cup final': 'Final de copa',
        'Cup semi-final': 'Semifinal de copa',
        'Cup quarter-final': 'Cuartos de final de copa',
        'Cup tie': 'Eliminatoria de copa'
      }
    },

    /* one pattern per template (the full stop is read off, then the template is matched without it) */
    ctxPatterns: {
      newsdesk: COMPILED.map(r => [r.outer, wrap(r)])
    },
    sentences: ['newsdesk']
  }, 'newsdesk');
})();
