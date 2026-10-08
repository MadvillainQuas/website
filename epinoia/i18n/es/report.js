'use strict';
/* Español: the generated prose — match and half-time reports, filed report articles, the game
   preview, the injury wire and the weekly report. One anchored pattern per sentence template,
   written as Spanish crónicas write: the winner first in the headline, present tense and the
   score in brackets ("A gana a B (85-74)"), the body in the past, a club as a singular subject,
   stat lines as "29 puntos, 8 rebotes y 5 asistencias", "parcial de 12-0", the box-score words
   (tiros libres, triples, recuperaciones, tapones, pérdidas). Names pass through as the data
   has them; the engine writes the decimal comma. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;

  /* ---------------------------------------------------------------- pieces --- */
  const NUM = { no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19 };
  /* the writer's proofreader spells out a figure that opens a sentence ("Twenty-one points down…"), so the tens too */
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const num = w => { const k = String(w).toLowerCase(), m = /^([a-z]+)(?:-([a-z]+))?$/.exec(k);
    return k in NUM ? NUM[k] : m && TENS[m[1]] != null && (!m[2] || NUM[m[2]] < 10) ? TENS[m[1]] + (m[2] ? NUM[m[2]] : 0) : NaN; };
  const n = w => (w == null ? '' : /^\d/.test(w) ? String(w) : String(num(w)));
  const WORDS = '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|' +
    'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|eleven|twelve|no|one|two|three|four|five|six|seven|eight|nine|ten|\\d+';
  const PCT = {
    'better than nine games in ten': 'por encima de nueve de cada diez partidos',
    'better than nine weeks in ten': 'por encima de nueve de cada diez semanas',
    'among the best in the league': 'entre lo mejor de la liga',
    'at the very top of the league': 'en lo más alto de la liga',
    /* as the page prints it: the writer's reviser cuts "very" as a filler */
    'at the top of the league': 'en lo más alto de la liga',
    'better than three games in four': 'por encima de tres de cada cuatro partidos',
    'better than three weeks in four': 'por encima de tres de cada cuatro semanas',
    'comfortably above the league': 'claramente por encima de la liga',
    'well above the league average': 'muy por encima de la media de la liga',
    'better than most': 'por encima de la mayoría',
    'above the league’s middle': 'en la mitad alta de la liga',
    'on the good side of average': 'algo por encima de la media',
    'about league average': 'en la media de la liga',
    'about average for this league': 'en la media de la liga',
    'in the middle of the league': 'en la zona media de la liga',
    'right on the league average': 'justo en la media de la liga',
    'worse than most': 'por debajo de la mayoría',
    'below the league’s middle': 'en la mitad baja de la liga',
    'on the wrong side of average': 'algo por debajo de la media',
    'worse than three games in four': 'por debajo de tres de cada cuatro partidos',
    'worse than three weeks in four': 'por debajo de tres de cada cuatro semanas',
    'comfortably below the league': 'claramente por debajo de la liga',
    'well below the league average': 'muy por debajo de la media de la liga',
    'worse than nine games in ten': 'por debajo de nueve de cada diez partidos',
    'worse than nine weeks in ten': 'por debajo de nueve de cada diez semanas',
    'among the weakest in the league': 'entre lo más flojo de la liga',
    'near the bottom of the league': 'cerca de lo más bajo de la liga',
    'second to none in the league': 'sin rival en la liga',
    'in the league’s top tenth': 'en el mejor diez por ciento de la liga',
    'in the league’s top quarter': 'en el mejor cuarto de la liga',
    'clearly better than the league’s usual': 'claramente por encima de lo habitual en la liga',
    'a little better than the league’s usual': 'algo por encima de lo habitual en la liga',
    'just above the league’s average': 'justo por encima de la media de la liga',
    'no different from the league’s usual': 'en la línea habitual de la liga',
    'neither better nor worse than usual here': 'en un nivel normal para esta liga',
    'a little worse than the league’s usual': 'algo por debajo de lo habitual en la liga',
    'just below the league’s average': 'justo por debajo de la media de la liga',
    'in the league’s bottom quarter': 'en el peor cuarto de la liga',
    'clearly worse than the league’s usual': 'claramente por debajo de lo habitual en la liga',
    'in the league’s bottom tenth': 'en el peor diez por ciento de la liga',
    'as poor as it gets in the league': 'de lo peor de la liga',
    'hard to place': 'en un punto difícil de situar'
  };
  const FREQ = {
    'a share few sides in this league ever reach': 'un porcentaje que pocos equipos de esta liga alcanzan',
    'more than most sides manage': 'más que la mayoría de equipos',
    'as few as any side in this league gets': 'tan pocas como el que menos en esta liga',
    'fewer than most sides get': 'menos que la mayoría de equipos',
    /* three a band (2026-10-08) */
    'as high a share as this league sees': 'un porcentaje de los más altos de la liga',
    'a share almost nobody here matches': 'un porcentaje que casi nadie iguala aquí',
    'more than three sides in four get': 'más que tres de cada cuatro equipos',
    'above what most sides here get': 'por encima de lo que logra la mayoría de equipos',
    'about as few as this league sees': 'de los porcentajes más bajos de la liga',
    'about as low as this league goes': 'de lo más bajo que se ve en esta liga',
    'fewer than three sides in four get': 'menos que tres de cada cuatro equipos',
    'below what most sides here get': 'por debajo de lo que logra la mayoría de equipos'
  };
  const alt = o => Object.keys(o).sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  /* {X} may hold a colon that is not a clause's ("Igokea M:tel"); {Z} is a club's possessive, which the writer's polish
     makes "Nanterre 92s" after a numeral (its decade rule), as well as "Neon City’s" and "Bakken Bears’" */
  const TOK = {
    X: '((?:[^,;:—]|:(?! ))+?)', L: '(.+?)', Z: '(?:’s?|(?<=\\d)s)', N: '((?!and )(?:(?! and | for | of )[^,;:—()])+?)', D: '(\\d+)', F: '(-?\\d+(?:\\.\\d+)?)', W: '(' + WORDS + ')',
    S: '(\\d+)[–-](\\d+)', O: '(first|second|third|fourth|\\d+th)', M: '(\\d+:\\d{2})',
    T: '((?:(?:,| and) (?:' + WORDS + ') (?:rebounds|assists|steals|blocks))*)',
    P: '(their|[^,;:—]+?(?:’s?|(?<=\\d)s))', Q: '(' + alt(PCT) + ')', R: '(' + alt(FREQ) + ')',
    V: '(in transition|on second chances|off turnovers)',
    K: '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th))', G: '(?: in (.+?))?',
    A: '(\\d+\\.\\d+|' + WORDS + ')',
    Y: '((?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),? \\d{1,2} (?:january|february|march|april|may|june|july|august|september|october|november|december))',
    /* the match writer's own (game/matchwriter.js): where and when ("at home on Saturday"), a period ("third", "first
       half", "overtime"), when in it ("late in"), a spell of minutes, a possessive that may be "their" / "his" / "her",
       and the rest of a player's line after the points ("nine rebounds and four assists") */
    E: '((?:at home|on the road|at .+?)(?: on (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (?:morning|afternoon|evening))?)?)',
    U: '(first half|second half|first|second|third|fourth|overtime|\\d+th)', C: '(early in|midway through|late in|in)',
    I: '(a minute|minute|(?:' + WORDS + ') minutes)', H: '(their|his|her|[^,;:—]+?(?:’s?|(?<=\\d)s))',
    J: '((?:' + WORDS + ') (?:rebounds|assists|steals|blocks)(?:(?:,| and) (?:' + WORDS + ') (?:rebounds|assists|steals|blocks))*)'
  };
  const rx = (src, end) => new RegExp('^(?:' + src.replace(/\{([A-Z])\}/g, (m, k) => TOK[k]) + ')' + (end || '') + '$', 'i');

  const sc = (a, b) => a + '-' + b;
  const ORD = { first: 'el primer cuarto', second: 'el segundo cuarto', third: 'el tercer cuarto', fourth: 'el último cuarto' };
  const OT = ['la prórroga', 'la segunda prórroga', 'la tercera prórroga', 'la cuarta prórroga'];
  const ord = o => ORD[String(o).toLowerCase()] || OT[parseInt(o, 10) - 5] || 'la prórroga';
  const ROLE = { 'the winners': 'el vencedor', 'the losers': 'el perdedor' };
  /* a subject: they / he / she is dropped (the verb carries it), a role becomes words, a club is itself */
  const who = x => { const k = String(x).toLowerCase(); return /^(they|he|she)$/.test(k) ? '' : (ROLE[k] || String(x)); };
  const sv = (x, v) => { const w = who(x); return w ? w + ' ' + v : v; };
  /* "y" becomes "e" before an i- sound */
  const yy = b => (/^(i|hi)(?![aeiouáéíóú])/i.test(String(b)) ? ' e ' : ' y ');
  const list = xs => (xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + yy(xs[xs.length - 1]) + xs[xs.length - 1]);
  const names = x => list(String(x).split(/, | and /));
  const pl = (k, a, b) => (Number(k) === 1 ? a : b);
  /* a count in words or digits with its noun: "three games" -> "3 partidos" */
  const cnt = (w, a, b) => n(w) + ' ' + pl(n(w), a, b);
  const STAT = { points: ['punto', 'puntos'], rebounds: ['rebote', 'rebotes'], assists: ['asistencia', 'asistencias'],
    steals: ['recuperación', 'recuperaciones'], blocks: ['tapón', 'tapones'], threes: ['triple', 'triples'] };
  const stat = (k, c) => c + ' ' + pl(c, ...STAT[k]);
  const los = k => (/^(assists|steals)$/i.test(k) ? 'las' : 'los');
  /* a stat line; "a season-high 27" is the points with its note: "27 puntos (su máxima anotación de la temporada)" */
  const line = (pts, t, hi) => { const parts = [stat('points', pts) + (hi ? ' (su máxima anotación de la temporada)' : '')]; String(t || '').replace(/(\w+) (rebounds|assists|steals|blocks)/gi, (m, w, k) => { parts.push(stat(k.toLowerCase(), n(w))); return m; }); return list(parts); };
  const own = (p, mine, noun) => (/^their$/i.test(p) ? mine : noun + ' de ' + who(String(p).replace(/(?:’s?|(?<=\d)s)$/, '')));
  const DAY = { sunday: 'el domingo', monday: 'el lunes', tuesday: 'el martes', wednesday: 'el miércoles', thursday: 'el jueves', friday: 'el viernes', saturday: 'el sábado' };
  const PART = { morning: 'por la mañana', afternoon: 'por la tarde', evening: 'por la noche' };
  const WHERE = { 'in transition': 'al contraataque', 'on second chances': 'en segundas oportunidades', 'off turnovers': 'tras pérdida' };
  const ZONE_ES = { 'at the rim': 'bajo el aro', 'from mid-range': 'en la media distancia', 'from three': 'en el triple' };
  const LIVED = { 'in transition': 'del contraataque', 'on second chances': 'de las segundas oportunidades', 'off turnovers': 'de las pérdidas rivales' };

  /* the measures the scout's note and the weekly report name */
  const LAB = {
    'shooting': 'el tiro', 'turnovers': 'las pérdidas', 'the offensive glass': 'el rebote ofensivo',
    'offensive glass': 'el rebote ofensivo', 'free throws': 'los tiros libres',
    'shooting from the field': 'el tiro de campo', 'looking after the ball': 'el cuidado del balón',
    'the defensive glass': 'el rebote defensivo', 'getting to the line': 'la llegada a la línea de tiros libres',
    'shooting from three': 'el tiro de tres', 'how much they shot from three': 'el volumen de triples',
    'how much they got to the rim': 'las llegadas al aro', 'getting to the rim': 'las llegadas al aro',
    'finishing at the rim': 'la definición cerca del aro', 'sharing the ball': 'la circulación del balón',
    'assists against turnovers': 'la relación asistencias/pérdidas', 'passing against turning it over': 'la relación asistencias/pérdidas',
    'forcing turnovers': 'las pérdidas forzadas', 'protecting the rim': 'la protección del aro',
    'scoring per possession': 'los puntos por posesión', 'their defence': 'la defensa',
    'scoring efficiency': 'la eficiencia anotadora', 'how much of the offence they took': 'el peso en el ataque',
    'creating for others': 'la creación para los compañeros', 'the mid-range': 'la media distancia',
    'taking the ball off people': 'las recuperaciones', 'blocking shots': 'los tapones',
    'points per possession used': 'los puntos por posesión usada'
  };
  const lab = x => (Object.prototype.hasOwnProperty.call(LAB, String(x).toLowerCase()) ? LAB[String(x).toLowerCase()] : null);
  const labs = x => { const out = String(x).split(/, | and /).map(lab); return out.indexOf(null) >= 0 ? null : list(out); };
  const pct = q => PCT[String(q).toLowerCase()];
  /* a plural label takes a plural verb: "son los tiros libres", "se quedaron atrás" */
  const many = t => /^(los|las) /.test(t) || / [ye] (el|la|los|las) /.test(t);
  const freq = q => FREQ[String(q).toLowerCase()];
  /* "lagged too": "el rebote defensivo también se quedó atrás", plural for a plural label */
  const lagged = t => t + ' también ' + (many(t) ? 'se quedaron' : 'se quedó') + ' atrás';
  /* "all but 20 seconds", "all but two minutes" of a game: "salvo 20 segundos", "salvo 2 minutos" */
  const ALLBUT = '(?:all but (\\d+) seconds|all but (' + WORDS + ') minutes?)';
  const allBut = (s, m) => 'salvo ' + (s ? s + ' segundos' : cnt(m, 'minuto', 'minutos'));
  /* the scout's closing line, its three endings */
  const TAKE = {
    'further behind the league than anything else in their game': 'más por detrás de la liga que en cualquier otro aspecto de su juego',
    'the furthest from the league anything in their game was': 'lo más alejado de la liga de todo su juego',
    'and nothing else in their game sat further behind the league': 'y nada en su juego quedó más por detrás de la liga'
  };

  /* ---- the season around a game: places in the table, groups, dates, points of value ---- */
  /* "third" is tercero, and tercer before a noun ("el tercer puesto"); from the 11th, "11.º" */
  const PLACES = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ORDES = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];
  const ordes = (k, noun) => {
    const i = PLACES.indexOf(String(k).toLowerCase()), v = i > 0 ? i : parseInt(k, 10);
    const w = v >= 1 && v <= 10 ? ORDES[v] : v + '.º';
    return noun && (v === 1 || v === 3) ? w.slice(0, -1) : w;
  };
  /* a place said on its own: first in the table is the leader */
  const place = k => (ordes(k) === 'primero' ? 'líder' : ordes(k));
  /* "Group A" is el Grupo A; a group with a name of its own keeps it */
  const grp = g => { const m = /^group (.+)$/i.exec(String(g)); return m ? 'el Grupo ' + m[1] : /^the table$/i.test(g) ? 'la clasificación' : String(g); };
  const de = x => (/^el /.test(x) ? 'del ' + x.slice(3) : 'de ' + x);
  const ofGrp = g => (g ? ' ' + de(grp(g)) : '');
  /* the writer's date, "Saturday 17 October": "el sábado 17 de octubre" */
  const MONTH = { january: 'enero', february: 'febrero', march: 'marzo', april: 'abril', may: 'mayo', june: 'junio', july: 'julio',
    august: 'agosto', september: 'septiembre', october: 'octubre', november: 'noviembre', december: 'diciembre' };
  const fecha = s => {
    const m = /^(\w+),? (\d{1,2}) (\w+)$/.exec(String(s)), d = m && DAY[m[1].toLowerCase()], mo = m && MONTH[m[3].toLowerCase()];
    return d && mo ? d + ' ' + m[2] + ' de ' + mo : null;
  };
  /* "about six points": unos 6 puntos, alrededor de 1,5 puntos, cerca de un punto */
  const abt = w => { const v = n(w); return /\./.test(v) ? 'alrededor de ' + v + ' puntos' : Number(v) === 1 ? 'cerca de un punto' : 'unos ' + v + ' puntos'; };
  const SHOT = { three: 'el triple', 'free throw': 'el tiro libre', basket: 'la canasta' };
  /* the value ledger's facets (and the preview's), in the words the ledger card prints */
  const FACET = {
    'the shots they got': 'la calidad de tiro', 'the quality of their shots': 'la calidad de sus tiros',
    'the shots that fell': 'el acierto en el tiro', 'shot-making': 'el acierto en el tiro', 'the shooting': 'el tiro',
    'the turnover battle': 'la batalla de las pérdidas', 'free-throw shooting': 'el acierto en tiros libres',
    'home court': 'el factor cancha', 'everything else': 'todo lo demás'
  };
  const fac = x => (Object.prototype.hasOwnProperty.call(FACET, String(x).toLowerCase()) ? FACET[String(x).toLowerCase()] : lab(x));
  /* how the ledger opens: "By this league's own model of what wins, " */
  const BY = {
    'by this league’s own model of what wins': 'según el modelo propio de esta liga sobre lo que gana partidos',
    'weighed the way this league’s games are decided': 'con el peso que tiene cada faceta en los partidos de esta liga',
    'on what decides games in this league': 'atendiendo a lo que decide los partidos en esta liga',
    'counted factor by factor': 'sumando factor a factor',
    'facet by facet': 'faceta a faceta',
    'weighing each facet at its usual value': 'dando a cada faceta su valor habitual'
  };

  /* "On Saturday evening at The Arena, in front of 312 in Division One", in any of its parts (a venue may carry its town
     after a comma: "at Rocher, Nyon") */
  const DL = /^(?:on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (morning|afternoon|evening))?)?(?:(?:^| )at (.+?))?(?:(?:^|,? )in front of (\d+))?(?: in ([^,]+?))?$/i;
  const dl = s => {
    const m = DL.exec(String(s).trim());
    if (!m || !(m[1] || m[3] || m[4] || m[5])) return null;
    /* a comma in a venue is its town's ("Rocher, Nyon"), never a clause the venue swallowed (", and they led by…") */
    if (m[3] && /,(?! \p{Lu})/u.test(m[3])) return null;
    return { day: m[1], part: m[2], venue: m[3], crowd: m[4], comp: m[5] && m[5].replace(/^the /i, '') };
  };
  /* "en partido de la Liga Femenina Endesa": a league or a cup takes its article, as the press writes it; any other name
     is left bare */
  const ofComp = c => 'en partido de ' + (/league|liga|liiga|lega|ligue|cup|copa|coupe|champions/i.test(c) ? 'la ' : '') + c;
  /* "el sábado por la noche en The Arena, ante 312 espectadores" (+ "en partido de X") */
  const where = (d, comp) => {
    if (!d) return '';
    const parts = [];
    const when = d.day ? DAY[d.day.toLowerCase()] + (d.part ? ' ' + PART[d.part.toLowerCase()] : '') : '';
    if (when) parts.push(when + (d.venue ? ' en ' + d.venue : ''));
    else if (d.venue) parts.push('en ' + d.venue);
    if (d.crowd) parts.push('ante ' + d.crowd + ' espectadores');
    if (comp !== false && d.comp) parts.push(ofComp(d.comp));
    return parts.join(', ');
  };
  const nameWhere = s => {
    const re = / (?:on|at|in front of|in) |, in front of /gi;
    let m;
    while ((m = re.exec(s))) {
      const d = dl(s.slice(m.index).replace(/^,? /, ''));
      if (d) return [s.slice(0, m.index), d];
    }
    return [s, null];
  };

  /* ---- a list parser for the sentences that group players by club ---- */
  function items(s, one) {
    const whole = one(s);
    if (whole != null) return [whole];
    const re = /, | and /g;
    let m;
    while ((m = re.exec(s))) {
      const a = one(s.slice(0, m.index));
      if (a == null) continue;
      const b = items(s.slice(m.index + m[0].length), one);
      if (b) return [a].concat(b);
    }
    return null;
  }
  /* "<items> for <club>", once or joined with "; " / " and " */
  function byClub(s, one) {
    const clause = c => { const m = /^(.+) for (.+)$/.exec(c); if (!m) return null; const it = items(m[1], one); return it ? { club: m[2], it } : null; };
    if (s.indexOf('; ') >= 0) { const cs = s.split('; ').map(clause); return cs.indexOf(null) >= 0 ? null : cs; }
    const c = clause(s);
    if (c) return [c];
    const re = / and /g;
    let m;
    while ((m = re.exec(s))) {
      const a = clause(s.slice(0, m.index)), b = a && clause(s.slice(m.index + 5));
      if (a && b) return [a, b];
    }
    return null;
  }
  const clubs = cs => cs.map(c => 'en ' + c.club + ', ' + list(c.it)).join('; ');

  const DEED = [
    [rx('{N} came off the bench for (a season-high )?{D}{T}'), (p, sh, d, t) => p + ' salió del banquillo con ' + line(d, t, sh)],
    [rx('{N} scored {W} straight points in the {O}'), (p, w, o) => p + ' anotó ' + n(w) + ' puntos seguidos en ' + ord(o)],
    [rx('{N} pulled down {D} rebounds'), (p, d) => p + ' capturó ' + stat('rebounds', d)],
    [rx('{N} went {D} of {D} from the line'), (p, a, b) => p + ' anotó ' + a + ' de ' + b + ' tiros libres'],
    [rx('{N} came within a rebound or two of a triple-double'), p => p + ' se quedó a un par de rebotes del triple-doble']
  ];
  const each = p => names(p);
  const SPECIAL = [
    [rx('{L} each had {W} assists'), (p, w) => each(p) + ' repartieron ' + stat('assists', n(w)) + ' cada uno'],
    [rx('{L} each hit {W} from three'), (p, w) => each(p) + ' anotaron ' + n(w) + ' ' + pl(n(w), 'triple', 'triples') + ' cada uno'],
    [rx('{L} each finished with {W} (steals|blocks)(?: and {W} (steals|blocks))?'), (p, a, k, b, k2) => each(p) + ' terminaron con ' + stat(k.toLowerCase(), n(a)) + (b ? ' y ' + stat(k2.toLowerCase(), n(b)) : '') + ' cada uno'],
    [rx('{N} had {W} assists'), (p, w) => p + ' repartió ' + stat('assists', n(w))],
    [rx('{N} hit {W} from three'), (p, w) => p + ' anotó ' + n(w) + ' ' + pl(n(w), 'triple', 'triples')],
    [rx('{N} finished with {W} (steals|blocks)(?: and {W} (steals|blocks))?'), (p, a, k, b, k2) => p + ' terminó con ' + stat(k.toLowerCase(), n(a)) + (b ? ' y ' + stat(k2.toLowerCase(), n(b)) : '')]
  ];
  const first = (list, s) => { for (const [re, fn] of list) { const m = re.exec(s); if (m) { const o = fn(...m.slice(1)); if (o != null) return o; } } return null; };
  /* "Toby Ashworth (five of twelve)" */
  const ROUGH = s => {
    const m = /^([^()]+?) \(([^()]+)\)$/.exec(s);
    if (!m) return null;
    let k;
    const note = /^scoreless$/i.test(m[2]) ? 'sin anotar'
      : (k = new RegExp('^(' + WORDS + ') of (' + WORDS + ')$', 'i').exec(m[2])) ? n(k[1]) + ' de ' + n(k[2]) + ' en tiros de campo'
      : (k = new RegExp('^missed all (' + WORDS + ')$', 'i').exec(m[2])) ? '0 de ' + n(k[1]) + ' en tiros de campo'
      : (k = new RegExp('^(' + WORDS + ') turnovers$', 'i').exec(m[2])) ? n(k[1]) + ' ' + pl(n(k[1]), 'pérdida', 'pérdidas') : null;
    return note == null ? null : m[1] + ' (' + note + ')';
  };
  /* "Derby Trailblazers’ A (…) and B (…)" -> { text: "A (…) y B (…) en Derby Trailblazers", many } */
  const roughClub = c => { const m = /^(.+?)(?:’s?|(?<=\d)s) (.+)$/.exec(c); if (!m) return null; const it = items(m[2], ROUGH); return it ? { t: list(it) + ' en ' + m[1], many: it.length > 1 } : null; };

  /* what a facet was worth: "about seven of the twelve points between them", "about six points, more than the whole
     margin", "about four points to Neon City" */
  const WORTH = [
    [rx('about {W} of the {W} points between them'), (a, b) => 'unos ' + n(a) + ' de los ' + n(b) + ' puntos de diferencia'],
    /* the writer's grammar makes "six of the six" "all six" */
    [rx('about all {W} points between them'), a => 'prácticamente los ' + n(a) + ' puntos de diferencia'],
    [rx('about {A} points?, more than the whole margin'), a => abt(a) + ', más que toda la diferencia final'],
    [rx('about {A} points?(?: to {X})?'), (a, x) => abt(a) + (x ? ' a favor de ' + x : '')]
  ];
  /* the ledger's first sentence, after its opening (BY) */
  const LEAD = [
    [rx('the shots {X} got decided it: (in this league|at this game’s make rates) their attempts were worth {D}% eFG and {X}{Z} {D}%, (.+)'),
      (x, r, a, y, b, v) => { const w = first(WORTH, v); return w && 'la calidad de los tiros de ' + x + ' decidió el partido: ' + (/league/i.test(r) ? 'con los porcentajes de esta liga' : 'con los porcentajes de este partido') +
        ', sus intentos valían un ' + a + '% de eFG% y los de ' + y + ', un ' + b + '%, lo que supuso ' + w; }],
    [rx('it came down to making shots: {X} hit {D}% eFG on shots that usually go at {D}% (in this league|at this game’s make rates), worth (.+)'),
      (x, a, b, r, v) => { const w = first(WORTH, v); return w && 'todo se redujo al acierto: ' + x + ' tiró con un ' + a + '% de eFG% en tiros que ' + (/league/i.test(r) ? 'en esta liga' : 'con los porcentajes de este partido') +
        ' suelen entrar al ' + b + '%, lo que valió ' + w; }],
    [rx('the free throws decided it: {X} made {W} of {W}, worth (.+) against the usual rate'),
      (x, a, b, v) => { const w = first(WORTH, v); return w && 'los tiros libres decidieron el partido: ' + x + ' anotó ' + n(a) + ' de ' + n(b) + ', lo que, frente al porcentaje habitual, valió ' + w; }],
    [rx('(.+?) decided it, worth (.+)'), (l, v) => { const f = fac(l), w = first(WORTH, v); return f && w && f + (many(f) ? ' decidieron' : ' decidió') + ' el partido: ' + (many(f) ? 'valieron ' : 'valió ') + w; }]
  ];
  /* the preview: who carried a side's last game, "with 31 from X" in a win, "despite 20 from X" in a defeat (",
     with …" after a sentence, " with …" inside a run's latest game): ", con 31 puntos de X", ", pese a los 20 puntos de X" */
  const CARRY = c => '(?:' + c + ' (with|despite) {D}(?: points and {D} (rebounds|assists))? from {X})?';
  const carry = (k, d, e, s, p) => (!k ? '' : (/^with$/i.test(k) ? ', con ' : ', pese a los ') + stat('points', d) + (e ? ' y ' + stat(s.toLowerCase(), e) : '') + ' de ' + p);
  /* where it was: "at home", "at home to X", "at X", "away" */
  const ubi = w => { let m; return /^at home$/i.test(w) ? ' en casa' : /^away$/i.test(w) ? ' a domicilio' : (m = /^at home to (.+)$/i.exec(w)) ? ' en casa ante ' + m[1] : (m = /^at (.+)$/i.exec(w)) ? ' en la pista de ' + m[1] : null; };
  const HA = { 'at home': 'en casa', 'on the road': 'a domicilio', away: 'a domicilio' };
  /* the preview: what the season's numbers expect of the facet the game turns on */
  const EXPECT = [
    [rx('expect {X} to shoot about {D}% eFG to {D}%'), (x, a, b) => 'se espera que ' + x + ' tire con un ' + a + '% de eFG%, frente a un ' + b + '%'],
    [rx('{X} should turn it over on about {D}% of possessions to {D}%'), (x, a, b) => x + ' debería perder el balón en torno al ' + a + '% de sus posesiones, frente al ' + b + '%'],
    [rx('{X} should get about {D}% of their misses back to {D}%'), (x, a, b) => x + ' debería recuperar en torno al ' + a + '% de sus fallos, frente al ' + b + '%'],
    [rx('{X} should get to the line more, about {D} free throws per hundred shots to {D}'), (x, a, b) => x + ' debería ir más a la línea, con unos ' + a + ' tiros libres por cada cien tiros frente a ' + b]
  ];

  /* ---- the match report as one piece (game/matchwriter.js): its values said in Spanish ---- */
  /* where and when the lede puts the game, after the score: "at home on Saturday" -> "el sábado en casa", "on the road"
     -> "a domicilio", "at The Arena on Saturday afternoon" -> "el sábado por la tarde en The Arena" (a comma in a venue is
     its town's, never a clause the venue swallowed) */
  const wd = s => {
    const m = /^(?:(at home)|(on the road)|at (.+?))(?: on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (morning|afternoon|evening))?)?$/i.exec(String(s));
    if (!m || (m[3] && /,(?! \p{Lu})/u.test(m[3]))) return null;
    const when = m[4] ? DAY[m[4].toLowerCase()] + (m[5] ? ' ' + PART[m[5].toLowerCase()] : '') + ' ' : '';
    return when + (m[1] ? 'en casa' : m[2] ? 'a domicilio' : 'en ' + m[3]);
  };
  /* a period as the writer names it ("third", "first half", "overtime") and when in it: "al final del tercer cuarto" */
  const per = o => (/half$/i.test(o) ? (/^first/i.test(o) ? 'la primera parte' : 'la segunda parte') : ord(o));
  const WHEN = { 'early in': 'al principio de ', 'midway through': 'a mitad de ', 'late in': 'al final de ', in: 'en ' };
  const inP = (c, o) => WHEN[String(c).toLowerCase()] + per(o);
  /* "six minutes", "a minute": 6 minutos, un minuto */
  const mins = s => (/minute$/i.test(s) ? 'un minuto' : cnt(String(s).replace(/ minutes$/i, ''), 'minuto', 'minutos'));
  /* a possessive: the owner ("Neon City’s"), or null for a pronoun ("their", "his", "her" -> "su") */
  const ownr = h => (/^(their|his|her)$/i.test(h) ? null : who(String(h).replace(/(?:’s?|(?<=\d)s)$/, '')));
  const su = (h, art, noun) => { const o = ownr(h); return o ? art + ' ' + noun + ' de ' + o : 'su ' + noun; };
  /* "nine rebounds and four assists": 9 rebotes y 4 asistencias */
  const stats = s => list(String(s).split(/, | and /).map(x => { const m = /^(\S+) (rebounds|assists|steals|blocks)$/i.exec(x); return stat(m[2].toLowerCase(), n(m[1])); }));
  /* a player named beside another ("He and Bo Lind"): él, ella */
  const pers = x => ({ he: 'él', she: 'ella', they: 'ellos' })[String(x).toLowerCase()] || x;
  /* an ordinal before a feminine noun: "su sexta víctima", "su 11.ª víctima" */
  const ordF = k => { const w = ordes(k); return /o$/.test(w) ? w.slice(0, -1) + 'a' : w.replace(/º$/, 'ª'); };
  const WHAT = { 'a three': 'con un triple', 'free throws': 'desde la línea de tiros libres', 'a basket': 'con una canasta', three: 'con un triple', basket: 'con una canasta' };
  const NX = { host: 'recibe a ', 'go to': 'visita a ' };
  const REG = { 'four quarters': 'tras los cuatro cuartos', 'two halves': 'tras las dos partes' };
  /* a score at the end of regulation: "empate a 76" */
  const tie = (a, b) => (a === b ? 'empate a ' + a : sc(a, b));


  /* ---- the match report as one piece (game/matchwriter.js, 2026-10-08) ----
     Every option of every slot of the writer's phrasebook. A club or a player opens a sentence by name or, after a
     sentence about the same one, as "They" / "He" / "She", which Spanish drops (sv: the verb carries it, a club singular
     as everywhere in this pack). The lede's "at home on Saturday" comes after the score: "el sábado en casa" (wd). */
  /* the lede: the result and the one thing that matters most about it */
  const MW_LEDE = [
    ['{X} won it for {X} with {W} seconds? left, (a three|free throws|a basket) to beat {X} {S}',
      (p, x, w, k, y, a, b) => sv(p, 'dio el triunfo a ' + x + ' ' + WHAT[k.toLowerCase()] + ' a falta de ' + cnt(w, 'segundo', 'segundos')) + ': ' + sc(a, b) + ' ante ' + y],
    ['{X} beat {X} {S}, and {X} decided it with {W} seconds? on the clock',
      (x, y, a, b, p, w) => sv(x, 'ganó a ' + y + ' por ' + sc(a, b)) + ', y ' + p + ' lo decidió a falta de ' + cnt(w, 'segundo', 'segundos')],
    ['{X} needed overtime, but they got there, beating {X} {S} {E}',
      (x, y, a, b, e) => wd(e) && sv(x, 'necesitó la prórroga, pero lo consiguió: ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['it took an extra period to separate them, and {X} were the stronger in it, beating {X} {S}',
      (x, y, a, b) => 'hizo falta una prórroga para separarlos, y en ella fue mejor ' + x + ', que ganó a ' + y + ' por ' + sc(a, b)],
    ['{X} beat {X} {S} after overtime {E}', (x, y, a, b, e) => wd(e) && sv(x, 'ganó a ' + y + ' por ' + sc(a, b) + ' tras la prórroga, ' + wd(e))],
    ['{X} came from {W} points down to beat {X} {S} {E}',
      (x, w, y, a, b, e) => wd(e) && sv(x, 'remontó ' + cnt(w, 'punto', 'puntos') + ' de desventaja para ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['{W} points down at one stage, {X} still beat {X} {S}', (w, x, y, a, b) => sv(x, 'llegó a perder de ' + n(w) + ', pero aun así ganó a ' + y + ' por ' + sc(a, b))],
    ['{X} let an? {W}-point lead slip, and {X} took the game {S}',
      (y, w, x, a, b) => sv(y, 'dejó escapar una ventaja de ' + cnt(w, 'punto', 'puntos')) + ', y ' + x + ' se llevó el partido por ' + sc(a, b)],
    ['{X} stole it late, beating {X} {S} after trailing with five minutes to play',
      (x, y, a, b) => sv(x, 'se llevó el partido en el tramo final') + ': ' + sc(a, b) + ' ante ' + y + ', después de ir por detrás a cinco minutos del final'],
    ['{X} had it in their hands with five minutes left; {X} took it from them, {S}',
      (y, x, a, b) => sv(y, 'lo tenía en la mano a cinco minutos del final') + '; ' + x + ' se lo arrebató, ' + sc(a, b)],
    ['{X} have their first win of the season', x => sv(x, 'ya tiene su primera victoria de la temporada')],
    ['at the {K} attempt they beat {X} {S} {E}', (k, y, a, b, e) => wd(e) && 'al ' + ordes(k, true) + ' intento, ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)],
    ['it took {X} {W} games?, but they are off the mark: an? {S} win over {X} {E}',
      (x, w, a, b, y, e) => wd(e) && sv(x, 'necesitó ' + cnt(w, 'partido', 'partidos') + ', pero ya ha estrenado su casillero') + ': ' + sc(a, b) + ' ante ' + y + ' ' + wd(e)],
    ['{X} are up and running', x => sv(x, 'por fin arranca')],
    ['an? {S} win over {X} {E} was their first of the season', (a, b, y, e) => wd(e) && 'el ' + sc(a, b) + ' ante ' + y + ', ' + wd(e) + ', fue su primera victoria de la temporada'],
    ['{X} are unbeaten no more', x => (who(x) ? 'se acabó la imbatibilidad de ' + who(x) : 'se acabó su imbatibilidad')],
    ['{X} beat them {S} {E}, their first defeat in {W} games?',
      (x, a, b, e, w) => wd(e) && sv(x, 'le ganó por ' + sc(a, b) + ' ' + wd(e)) + ': su primera derrota en ' + cnt(w, 'partido', 'partidos')],
    ['{X} handed {X} their first defeat of the season, {S} {E}',
      (x, y, a, b, e) => wd(e) && sv(x, 'le endosó a ' + y + ' su primera derrota de la temporada') + ', ' + sc(a, b) + ' ' + wd(e)],
    ['{X} brought {X}{Z} winning run to an end at {W}, beating them {S} {E}',
      (x, y, w, a, b, e) => wd(e) && sv(x, 'cortó en ' + n(w) + ' la racha de victorias de ' + y + ' al ganarle por ' + sc(a, b) + ' ' + wd(e))],
    ['{X} had won {W} in a row', (x, w) => sv(x, 'llevaba ' + n(w) + ' victorias seguidas')],
    ['{X} stopped them, {S}, {E}', (x, a, b, e) => wd(e) && sv(x, 'cortó la racha') + ': ' + sc(a, b) + ', ' + wd(e)],
    ['{X}, {K} in the table, beat {K}-placed {X} {S} {E}', (x, k, j, y, a, b, e) => wd(e) && (who(x) ? who(x) + ', ' : '') + (place(k) === 'líder' ? 'líder de la clasificación' : ordes(k) + ' en la clasificación') + ', ganó al ' +
      (place(j) === 'líder' ? 'líder' : ordes(j, true) + ' clasificado') + ', ' + y + ', por ' + sc(a, b) + ' ' + wd(e)],
    ['the table said {X}; the game said {X}, {S} winners {E}', (y, x, a, b, e) => wd(e) && 'la clasificación decía ' + y + '; la pista dijo ' + x + ', que ganó por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} are top of the table after beating {X} {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'es líder tras ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['an? {S} win over {X} {E} took {X} to the top', (a, b, y, e, x) => wd(e) && 'el ' + sc(a, b) + ' ante ' + y + ', ' + wd(e) + ', aupó a ' + x + ' al liderato'],
    ['{X} ended a run of {W} straight defeats by beating {X} {S} {E}',
      (x, w, y, a, b, e) => wd(e) && sv(x, 'cortó una racha de ' + n(w) + ' derrotas seguidas al ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['the losing run is over for {X}: they beat {X} {S} {E}', (x, y, a, b, e) => wd(e) && 'se acabó la mala racha para ' + x + ': ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} made it {W} wins in a row, beating {X} {S} {E}',
      (x, w, y, a, b, e) => wd(e) && sv(x, 'enlazó ' + n(w) + ' victorias seguidas al ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['that is {W} straight wins for {X}, who beat {X} {S} {E}',
      (w, x, y, a, b, e) => wd(e) && 'son ya ' + n(w) + ' victorias seguidas para ' + x + ', que ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} are still perfect: {X} became their {K} victims, beaten {S} {E}',
      (x, y, k, a, b, e) => wd(e) && sv(x, 'sigue con el pleno') + ': ' + y + ' fue su ' + ordF(k) + ' víctima, ' + sc(a, b) + ' ' + wd(e)],
    ['{X} stay unbeaten after an? {S} win over {X} {E}', (x, a, b, y, e) => wd(e) && sv(x, 'sigue invicto tras ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['{X} scored {D} points as {X} beat {X} {S} {E}',
      (p, d, x, y, a, b, e) => wd(e) && sv(p, 'anotó ' + stat('points', d) + ' en el triunfo de ' + x + ' sobre ' + y + ' por ' + sc(a, b) + ', ' + wd(e))],
    ['{X} put up {D} points, and {X} beat {X} {S} {E}',
      (p, d, x, y, a, b, e) => wd(e) && sv(p, 'firmó ' + stat('points', d)) + ' y ' + x + ' ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} took {X} apart, winning {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'pasó por encima de ' + y) + ': ' + sc(a, b) + ' ' + wd(e)],
    ['this one was over long before the end: {X} beat {X} {S} {E}',
      (x, y, a, b, e) => wd(e) && 'el partido estuvo decidido mucho antes del final: ' + x + ' ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} were in a different class, beating {X} {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'estuvo un escalón por encima y ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['{X} edged {X} {S} {E} in a game that was never more than a few baskets either way',
      (x, y, a, b, e) => wd(e) && sv(x, 'se impuso a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)) + ', en un partido en el que la diferencia nunca pasó de unas pocas canastas'],
    ['{X} held on to beat {X} {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'aguantó para ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['there was almost nothing between them, but {X} had just enough, beating {X} {S} {E}',
      (x, y, a, b, e) => wd(e) && 'apenas hubo diferencias entre ambos, pero ' + x + ' tuvo lo justo para ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} were {W} up at one point and had to hang on, but they beat {X} {S} {E}',
      (x, w, y, a, b, e) => wd(e) && sv(x, 'llegó a ganar de ' + n(w) + ' y tuvo que sufrir, pero acabó ganando a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['{X} let most of an? {W}-point lead slip before beating {X} {S} {E}',
      (x, w, y, a, b, e) => wd(e) && sv(x, 'dejó escapar casi toda una ventaja de ' + cnt(w, 'punto', 'puntos') + ' antes de ganar a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['an? {W}[–-]0 run in the {U} took the game away from {X}, and {X} won it {S} {E}',
      (w, o, y, x, a, b, e) => wd(e) && 'un parcial de ' + sc(n(w), 0) + ' en ' + per(o) + ' dejó sin opciones a ' + y + ', y ' + x + ' ganó por ' + sc(a, b) + ' ' + wd(e)],
    ['{X} beat {X} {S} {E}, and an? {W}[–-]0 run in the {U} was where they won it',
      (x, y, a, b, e, w, o) => wd(e) && sv(x, 'ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e)) + ', y la clave fue un parcial de ' + sc(n(w), 0) + ' en ' + per(o)],
    ['{X} won on the road, beating {X} {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'ganó a domicilio') + ': ' + sc(a, b) + ' ante ' + y + ' ' + wd(e)],
    ['{X} went to {X} and came away with an? {S} win', (x, y, a, b) => sv(x, 'visitó a ' + y + ' y se llevó la victoria por ' + sc(a, b))],
    ['{X} beat {X} {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'ganó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
    ['{X} were {D}-point winners over {X} {E}', (x, d, y, e) => wd(e) && sv(x, 'ganó por ' + cnt(d, 'punto', 'puntos') + ' a ' + y + ' ' + wd(e))],
    ['{X} saw off {X} {S} {E}', (x, y, a, b, e) => wd(e) && sv(x, 'despachó a ' + y + ' por ' + sc(a, b) + ' ' + wd(e))],
  ];

  /* the hook: why, in one line ("parcial de 12-0", "tirar del carro", "a remolque") */
  const MW_HOOK = [
    ['an? {W}[–-]0 run {C} the {U} broke it open for {X}', (w, c, o, x) => 'un parcial de ' + sc(n(w), 0) + ' ' + inP(c, o) + ' rompió el partido a favor de ' + x],
    ['the damage was done {C} the {U}, when {X} scored {W} unanswered points', (c, o, x, w) => 'el daño llegó ' + inP(c, o) + ', cuando ' + x + ' anotó ' + n(w) + ' puntos sin respuesta'],
    ['{X} scored {W} points in a row {C} the {U}, and {X} never recovered',
      (x, w, c, o, y) => sv(x, 'anotó ' + n(w) + ' puntos seguidos ' + inP(c, o)) + ', y ' + y + ' ya no se recuperó'],
    ['they won it in an? {I} spell of the {U}, outscoring {X} by {W} in that time',
      (i, o, y, w) => 'lo ganó en un tramo de ' + mins(i) + ' ' + de(per(o)) + ', en el que superó a ' + y + ' por ' + cnt(w, 'punto', 'puntos')],
    ['{X} led the way with {D} points', (p, d) => sv(p, 'tiró del carro con ' + stat('points', d))],
    ['{X} was the difference, with {D} points', (p, d) => sv(p, 'marcó la diferencia, con ' + stat('points', d))],
    ['{X} did the most damage, with {D} points', (p, d) => sv(p, 'fue quien más daño hizo, con ' + stat('points', d))],
    ['{X} were {W} up at half-time and never let {X} back in', (x, w, y) => sv(x, 'ganaba de ' + n(w) + ' al descanso y no dejó volver a ' + y)],
    ['it was effectively over by the break, with {X} {W} points clear', (x, w) => 'al descanso el partido estaba prácticamente decidido, con ' + x + ' ' + n(w) + ' puntos arriba'],
    ['{X} were in front for almost all of it', x => sv(x, 'fue por delante casi todo el partido')],
    ['{X} led from early on and were never caught', x => sv(x, 'mandó desde muy pronto y nadie le dio alcance')],
    ['{X} were the better side for most of the {W} minutes', (x, w) => sv(x, 'fue mejor durante la mayor parte de los ' + n(w) + ' minutos')],
    ['{X} were rarely in danger', x => sv(x, 'apenas pasó apuros')],
    ['{X} were chasing it for most of the night', x => sv(x, 'fue a remolque durante casi todo el partido')],
    ['it took an extra period to separate them', () => 'hizo falta una prórroga para separarlos'],
    ['forty minutes were not enough to settle it', () => 'cuarenta minutos no bastaron para decidirlo'],
    ['{X} pulled away after half-time', x => sv(x, 'se escapó tras el descanso')],
    ['the second half was where {X} won it', x => x + ' ganó el partido en la segunda parte'],
    ['{X} were {W} up at one point, and needed every bit of it', (x, w) => sv(x, 'llegó a ganar de ' + n(w) + ', y necesitó hasta el último punto de esa renta')],
    ['{X} came back from {W} down and nearly made it', (x, w) => sv(x, 'llegó a perder de ' + n(w) + ' y casi completa la remontada')],
    ['it was settled in the last few minutes', () => 'se decidió en los últimos minutos'],
    ['it came down to the closing minutes', () => 'todo se decidió en los minutos finales'],
    ['it was in the balance until the closing minutes', () => 'el partido estuvo en el aire hasta los minutos finales'],
    ['neither side was ever far ahead', () => 'ninguno de los dos llegó a escaparse en el marcador'],
    ['there was never much in it', () => 'nunca hubo mucha diferencia'],
  ];
  /* where it leaves them */
  const MW_STAKES = [
    ['{X} are still waiting for a first win, {W} games? in', (x, w) => sv(x, 'sigue esperando su primera victoria tras ' + cnt(w, 'partido', 'partidos'))],
    ['{X} have now lost {W} in a row', (x, w) => sv(x, 'suma ya ' + n(w) + ' derrotas consecutivas')],
    ['that is {W} straight defeats for {X}', (w, x) => 'son ya ' + n(w) + ' derrotas seguidas para ' + x],
    ['{X} move up to {K}', (x, k) => sv(x, 'sube al ' + ordes(k, true) + ' puesto')],
    ['{X} stay top, at {S}', (x, a, b) => sv(x, 'sigue líder, con un balance de ' + sc(a, b))],
    ['it keeps {X} at the top of the table', x => 'el resultado mantiene a ' + x + ' en lo más alto de la clasificación'],
    ['their {W} points were their most of the season', w => 'esos ' + n(w) + ' puntos fueron su mejor anotación de la temporada'],
    ['{X} have not allowed fewer than {W} points all season', (x, w) => sv(x, 'no ha encajado menos de ' + cnt(w, 'punto', 'puntos') + ' en toda la temporada')],
    ['that is {W} wins in a row for {X}', (w, x) => 'son ya ' + n(w) + ' victorias seguidas para ' + x],
    /* (the plural is the season pattern's, above: "it is five games and no wins") */
    ['it is (?:one|1) game and no wins for {X}', x => sv(x, 'suma 1 partido sin conocer la victoria')]
  ];
  /* the rest of the body */
  const MW_BODY = [
    /* the flow: the start, the break, the turn, the peak, the finish */
    ['{X} made the faster start and were {W} up after the first quarter, {S}',
      (x, w, a, b) => sv(x, 'salió más rápido y ganaba de ' + n(w) + ' al final del primer cuarto') + ' (' + sc(a, b) + ')'],
    ['{X} took the first quarter {S} and set the tone', (x, a, b) => sv(x, 'se llevó el primer cuarto por ' + sc(a, b) + ' y marcó el tono')],
    ['the first quarter belonged to {X}, {S}', (x, a, b) => 'el primer cuarto fue para ' + x + ', ' + sc(a, b)],
    ['{X} took the first quarter {S}', (x, a, b) => sv(x, 'se llevó el primer cuarto por ' + sc(a, b))],
    ['it was {S} to {X} after the first quarter', (a, b, x) => 'tras el primer cuarto, ' + sc(a, b) + ' para ' + x],
    ['{X} edged the first quarter {S}', (x, a, b) => sv(x, 'ganó por poco el primer cuarto, ' + sc(a, b))],
    ['there was little in it early on(?:,|:) {S}(?: to {X})? after the first quarter',
      (a, b, x) => 'poca diferencia al principio: ' + sc(a, b) + (x ? ' para ' + x : '') + ' tras el primer cuarto'],
    ['there was nothing between them after the first quarter, {S}', (a, b) => 'no hubo diferencias tras el primer cuarto: ' + sc(a, b)],
    ['it was level after the first quarter, {S}', (a, b) => 'el primer cuarto acabó igualado: ' + sc(a, b)],
    ['it was level at half-time, {S}', (a, b) => 'se llegó al descanso con igualdad en el marcador: ' + sc(a, b)],
    ['nothing separated them at the break: {S}', (a, b) => 'nada los separaba al descanso: ' + sc(a, b)],
    ['by half-time {X} were {W} clear, {S}', (x, w, a, b) => 'al descanso, ' + x + ' ya ganaba de ' + n(w) + ' (' + sc(a, b) + ')'],
    ['{X} went in at the break {W} points up, {S}', (x, w, a, b) => sv(x, 'se fue al descanso ' + n(w) + ' puntos arriba, ' + sc(a, b))],
    ['the lead was {W} at half-time, {S}', (w, a, b) => 'al descanso la ventaja era de ' + cnt(w, 'punto', 'puntos') + ', ' + sc(a, b)],
    ['then it turned', () => 'entonces el partido cambió'],
    ['{X} were {W} down at one point, and they clawed it back', (x, w) => sv(x, 'llegó a perder de ' + n(w) + ', pero remontó')],
    ['{X} were {W} up at one stage and could not hold it', (x, w) => sv(x, 'llegó a ganar de ' + n(w) + ' y no supo mantener la ventaja')],
    ['{X} led by {W} at one stage', (x, w) => sv(x, 'llegó a mandar de ' + n(w))],
    ['at one point {X} were {W} points up', (x, w) => 'en un momento dado, ' + x + ' ganaba de ' + cnt(w, 'punto', 'puntos')],
    ['{X} came out after the break a different side and won the second half by {W}', (x, w) => sv(x, 'salió del descanso transformado y ganó la segunda parte por ' + n(w))],
    ['the second half was all {X}: they won it by {W}', (x, w) => 'la segunda parte fue toda de ' + x + ': la ganó por ' + n(w)],
    /* the run that decided it, told from the score it started at, or as the answer to a lead cut */
    ['the game turned {C} the {U}: from {S}, {X} scored {W} unanswered points',
      (c, o, a, b, x, w) => 'el partido cambió ' + inP(c, o) + ': desde el ' + sc(a, b) + ', ' + sv(x, 'anotó ' + n(w) + ' puntos sin respuesta')],
    ['{C} the {U} it was {S}; then {X} scored {W} in a row, and that was the game',
      (c, o, a, b, x, w) => inP(c, o) + ' el marcador era ' + sc(a, b) + '; entonces ' + sv(x, 'anotó ' + n(w) + ' puntos seguidos') + ', y ahí se acabó el partido'],
    ['at {S} {C} the {U}, {X} put together the {W}[–-]0 run that decided it',
      (a, b, c, o, x, w) => 'con ' + sc(a, b) + ' ' + inP(c, o) + ', ' + sv(x, 'firmó el parcial de ' + sc(n(w), 0) + ' que decidió el partido')],
    ['{X} cut it to {W} {C} the {U}, but {X} answered with {W} straight points to lead {S}, and that settled it',
      (y, g, c, o, x, w, a, b) => sv(y, 'redujo la diferencia a ' + n(g) + ' ' + inP(c, o)) + ', pero ' + x + ' respondió con ' + n(w) + ' puntos seguidos para ponerse ' + sc(a, b) + ', y eso lo decidió'],
    ['with the lead down to {W} at {S}, {X} scored the next {W} points {C} the {U}, and the game was gone',
      (g, a, b, x, w, c, o) => 'con la ventaja reducida a ' + cnt(g, 'punto', 'puntos') + ' (' + sc(a, b) + '), ' + sv(x, 'anotó los ' + n(w) + ' puntos siguientes ' + inP(c, o)) + ', y el partido quedó sentenciado'],
    ['the second half was where {X} pulled clear, winning it by {W}', (x, w) => x + ' se escapó en la segunda parte, que ganó por ' + n(w)],
    ['{X} kept pushing after the break and won the second half by {W}', (x, w) => sv(x, 'siguió apretando tras el descanso y ganó la segunda parte por ' + n(w))],
    /* a run of ten to fifteen, said with the score it moved ("del 45-48 al 57-48"): a gap in a close second half, a side
       put ahead, a lead stretched, or - by the side that lost - a game made close again */
    ['the second half started close, but an? {W}[–-]0 run by {X} {C} the {U} opened a gap',
      (w, x, c, o) => 'la segunda parte empezó igualada, pero un parcial de ' + sc(n(w), 0) + ' de ' + x + ' ' + inP(c, o) + ' abrió brecha'],
    ['it stayed close after the break until {X} scored {W} in a row {C} the {U}, taking it from {S} to {S}',
      (x, w, c, o, a, b, d, e) => 'el partido siguió igualado tras el descanso hasta que ' + x + ' anotó ' + n(w) + ' puntos seguidos ' + inP(c, o) + ' para pasar del ' + sc(a, b) + ' al ' + sc(d, e)],
    ['there was little in it early in the second half; a gap only opened {C} the {U}, off the back of an? {W}[–-]0 run by {X}',
      (c, o, w, x) => 'hubo poca diferencia al principio de la segunda parte; la brecha solo se abrió ' + inP(c, o) + ', gracias a un parcial de ' + sc(n(w), 0) + ' de ' + x],
    ['{X} were behind until {W} unanswered points {C} the {U} turned {S} into {S}',
      (x, w, c, o, a, b, d, e) => sv(x, 'iba por detrás hasta que ' + n(w) + ' puntos sin respuesta ' + inP(c, o) + ' convirtieron el ' + sc(a, b) + ' en un ' + sc(d, e))],
    ['trailing {S}, {X} went in front {C} the {U} with {W} straight points, to {S}',
      (a, b, x, c, o, w, d, e) => 'con ' + sc(a, b) + ' en contra, ' + sv(x, 'se puso por delante ' + inP(c, o) + ' con ' + n(w) + ' puntos seguidos, hasta el ' + sc(d, e))],
    ['{X} went in front {C} the {U}, scoring {W} in a row to turn {S} into {S}',
      (x, c, o, w, a, b, d, e) => sv(x, 'se puso por delante ' + inP(c, o) + ' con ' + n(w) + ' puntos seguidos, que convirtieron el ' + sc(a, b) + ' en un ' + sc(d, e))],
    ['an? {W}[–-]0 run {C} the {U} put {X} ahead, {S}', (w, c, o, x, a, b) => 'un parcial de ' + sc(n(w), 0) + ' ' + inP(c, o) + ' puso por delante a ' + x + ': ' + sc(a, b)],
    ['{X} stretched their lead {C} the {U} with an? {W}[–-]0 run that made it {S}',
      (x, c, o, w, a, b) => sv(x, 'amplió su ventaja ' + inP(c, o) + ' con un parcial de ' + sc(n(w), 0) + ' que dejó el marcador en ' + sc(a, b))],
    ['{W} straight points {C} the {U} took {X} from {S} to {S}', (w, c, o, x, a, b, d, e) => 'un parcial de ' + sc(n(w), 0) + ' ' + inP(c, o) + ' llevó a ' + x + ' del ' + sc(a, b) + ' al ' + sc(d, e)],
    ['{X} cut it to {S} with an? {W}[–-]0 run {C} the {U}, but {X} steadied',
      (x, a, b, w, c, o, y) => sv(x, 'se acercó hasta el ' + sc(a, b) + ' con un parcial de ' + sc(n(w), 0) + ' ' + inP(c, o)) + ', pero ' + y + ' se rehízo'],
    ['{X} made a game of it {C} the {U}, scoring {W} in a row to get within {W}, but could not go on with it',
      (x, c, o, w, k) => sv(x, 'metió emoción al partido ' + inP(c, o) + ' con ' + n(w) + ' puntos seguidos para ponerse a ' + cnt(k, 'punto', 'puntos')) + ', pero no pudo completar la remontada'],
    /* a drought without a field goal: "sin anotar en juego" */
    ['{X} went {I} without a field goal in the {U}, and the game went with it',
      (x, i, o) => sv(x, 'pasó ' + mins(i) + ' sin anotar en juego en ' + per(o)) + ', y con ello se le escapó el partido'],
    ['a spell of {I} without a field goal in the {U} cost {X} dearly', (i, o, x) => 'una sequía de ' + mins(i) + ' sin anotar en juego en ' + per(o) + ' le costó caro a ' + x],
    ['at its widest the gap was {W}', w => 'la máxima diferencia llegó a ser de ' + cnt(w, 'punto', 'puntos')],
    ['{X} went on to lead by as many as {W}', (x, w) => sv(x, 'llegó a ir ganando de ' + n(w))],
    ['at one point {X} were {W} clear', (x, w) => 'en un momento dado, ' + x + ' llegó a escaparse de ' + n(w)],
    ['it went to the wire, and {X} won it with {W} seconds? left', (p, w) => 'el partido se decidió al final, y ' + p + ' lo ganó a falta de ' + cnt(w, 'segundo', 'segundos')],
    ['with {W} seconds? left it was still anyone’s, until {X} settled it with an? (three|basket)',
      (w, p, k) => 'a falta de ' + cnt(w, 'segundo', 'segundos') + ' el partido seguía abierto, hasta que ' + p + ' lo decidió ' + WHAT[k.toLowerCase()]],
    ['it was {S} after (four quarters|two halves), and {X} won the extra period {S}',
      (a, b, r, x, c, d) => REG[r.toLowerCase()] + ' se llegó con ' + tie(a, b) + ', y ' + x + ' ganó la prórroga por ' + sc(c, d)],
    ['at {S} after (four quarters|two halves) it went to overtime, where {X} were the stronger, {S}',
      (a, b, r, x, c, d) => 'con ' + tie(a, b) + ' ' + REG[r.toLowerCase()] + ', el partido se fue a la prórroga, donde ' + x + ' fue superior: ' + sc(c, d)],
    ['it was {S} after (four quarters|two halves) and took {W} overtimes to settle',
      (a, b, r, w) => REG[r.toLowerCase()] + ' se llegó con ' + tie(a, b) + ', y hicieron falta ' + n(w) + ' prórrogas para resolverlo'],
    ['the decisive basket was {X}’s? three with {M} left', (p, m) => 'la canasta decisiva fue el triple de ' + p + ' a falta de ' + m],
    ['{H} three with {M} to play put {X} ahead for good', (h, m, x) => su(h, 'el', 'triple') + ' a falta de ' + m + ' puso a ' + x + ' por delante de forma definitiva'],
    ['{X} put {X} ahead for good with {M} to play', (p, x, m) => sv(p, 'puso a ' + x + ' por delante de forma definitiva a falta de ' + m)],
    ['with {M} left, {X} scored the basket that put {X} in front for good',
      (m, p, x) => 'a falta de ' + m + ', ' + p + ' anotó la canasta que puso a ' + x + ' por delante de forma definitiva'],
    ['it was {S} with five minutes left, and it stayed that close almost to the end',
      (a, b) => 'a falta de cinco minutos el marcador era ' + sc(a, b) + ', y siguió así de igualado casi hasta el final'],
    ['with five minutes to go it was {S}, anybody’s game', (a, b) => 'a cinco minutos del final, ' + sc(a, b) + ': cualquiera podía ganar'],
    ['{X} were {W} up with five minutes left and very nearly let it go: {X} cut it to {W}',
      (x, w, y, m) => sv(x, 'ganaba de ' + n(w) + ' a falta de cinco minutos y estuvo a punto de dejarlo escapar') + ': ' + y + ' redujo la diferencia a ' + n(m)],
    ['an? {W}-point lead with five to play shrank to {W} by the end, but {X} held on',
      (w, m, x) => 'una ventaja de ' + cnt(w, 'punto', 'puntos') + ' a cinco minutos del final se quedó en ' + n(m) + ', pero ' + x + ' aguantó'],
    ['it was {S} with five minutes left; {X} won the last five minutes {S}',
      (a, b, x, c, d) => 'a falta de cinco minutos el marcador era ' + sc(a, b) + '; ' + x + ' ganó los últimos cinco minutos por ' + sc(c, d)],
    ['with five minutes to go it was still {S}, and then {X} pulled away', (a, b, x) => 'a cinco minutos del final aún era ' + sc(a, b) + ', y entonces ' + x + ' se escapó'],
    ['{X} made {W} late free throws to close it out', (x, w) => sv(x, 'anotó ' + n(w) + ' tiros libres en el tramo final para cerrar el partido')],
    ['at the line late on, {X} made {W} to see it through', (x, w) => 'desde la línea en los últimos minutos, ' + x + ' anotó ' + n(w) + ' para sentenciar'],
    ['{X} never got back within single figures', x => sv(x, 'nunca volvió a ponerse a menos de diez puntos')],
    ['{X} never got close enough to make {X} nervous', (y, x) => sv(y, 'nunca se acercó lo suficiente para poner nervioso a ' + x)],
    ['from there {X} were chasing a game that had gone', y => 'a partir de ahí, ' + y + ' persiguió un partido que ya se le había ido'],
    ['{X} led for all but (a minute|{W} minutes) of the {W}', (x, a, w, t) => sv(x, 'mandó en el marcador todo el partido salvo ' + (w ? n(w) : 'uno') + ' de los ' + n(t) + ' minutos')],
    /* the why: how it was won, and the counterpoint when it was ugly */
    ['{X} made {X} pay for their mistakes: {X} turned it over {D} times, and {X} scored {D} points off those turnovers',
      (x, y, y2, t, x2, p) => sv(x, 'castigó los errores de ' + y) + ': ' + y2 + ' perdió ' + t + ' balones, y ' + x2 + ' anotó ' + stat('points', p) + ' tras esas pérdidas'],
    ['the turnovers told the story', () => 'las pérdidas lo explican todo'],
    ['{X} gave the ball away {D} times and {X} turned that into {D} points', (y, t, x, p) => sv(y, 'perdió el balón ' + t + ' veces') + ' y ' + x + ' lo convirtió en ' + stat('points', p)],
    ['{X} were careless with the ball, {D} turnovers in all, and {X} cashed in for {D} points',
      (y, t, x, p) => sv(y, 'no cuidó el balón') + ': ' + t + ' pérdidas en total, y ' + x + ' sacó ' + stat('points', p) + ' de ellas'],
    ['{X} turned it over {D} times, {X} only {W}', (y, t, x, w) => sv(y, 'perdió ' + t + ' balones') + '; ' + x + ', solo ' + n(w)],
    ['{X} looked after the ball far better: {W} turnovers to {X}{Z} {D}', (x, w, y, t) => sv(x, 'cuidó mucho mejor el balón') + ': ' + cnt(w, 'pérdida', 'pérdidas') + ' por las ' + t + ' de ' + y],
    ['{H} defence was all over them, with {W} steals and {W} blocks', (h, s, b) => su(h, 'la', 'defensa') + ' asfixió al rival: ' + stat('steals', n(s)) + ' y ' + stat('blocks', n(b))],
    ['defensively {X} were relentless: {W} steals, {W} blocked shots', (x, s, b) => 'en defensa, ' + x + ' fue implacable: ' + stat('steals', n(s)) + ' y ' + stat('blocks', n(b))],
    ['{X} defended well all night, and {X} shot {D}% from the field', (x, y, p) => sv(x, 'defendió bien toda la noche') + ', y ' + y + ' se quedó en un ' + p + '% en tiros de campo'],
    ['{X} could not find a way through, shooting {D}% from the field', (y, p) => sv(y, 'no encontró el camino') + ': ' + p + '% en tiros de campo'],
    ['{X} owned the offensive glass, getting {W} of their own misses back and turning them into {D} second-chance points',
      (x, w, d) => sv(x, 'dominó el rebote ofensivo') + ': recuperó ' + n(w) + ' de sus propios fallos y los convirtió en ' + d + ' puntos de segunda oportunidad'],
    ['second chances made the difference: {X} grabbed {W} offensive rebounds and scored {D} points from them',
      (x, w, d) => 'las segundas oportunidades marcaron la diferencia: ' + x + ' capturó ' + n(w) + ' rebotes ofensivos y sacó ' + stat('points', d) + ' de ellos'],
    ['on the boards it was {S} to {X}', (a, b, x) => 'en el rebote, ' + sc(a, b) + ' para ' + x],
    ['{X} did their damage inside, outscoring {X} {S} in the paint', (x, y, a, b) => sv(x, 'hizo daño por dentro') + ': superó a ' + y + ' por ' + sc(a, b) + ' en puntos en la zona'],
    ['most of it came close to the basket: {X} won the points in the paint {S}', (x, a, b) => 'casi todo llegó cerca del aro: ' + x + ' ganó ' + sc(a, b) + ' en puntos en la zona'],
    ['{X} were on fire from deep, making {W} of {D} threes', (x, m, a) => sv(x, 'estuvo inspirado desde el perímetro') + ': ' + n(m) + ' de ' + a + ' en triples'],
    ['the threes kept falling for {X}: {W} of {D}', (x, m, a) => 'los triples no dejaron de entrar para ' + x + ': ' + n(m) + ' de ' + a],
    ['{X} shot the lights out from three, {W} of {D}', (x, m, a) => sv(x, 'se salió desde el triple') + ': ' + n(m) + ' de ' + a],
    ['{X} got to the free-throw line {D} times to {X}{Z} {D}', (x, a, y, b) => sv(x, 'lanzó ' + a + ' tiros libres, por los ' + b + ' de ' + y)],
    ['{X} lived at the free-throw line, with {D} attempts to {X}{Z} {D}', (x, a, y, b) => sv(x, 'vivió en la línea de tiros libres') + ': ' + a + ' intentos por los ' + b + ' de ' + y],
    ['{X} ran whenever they could and won the fast-break points {S}', (x, a, b) => sv(x, 'corrió siempre que pudo y ganó ' + sc(a, b) + ' en puntos al contraataque')],
    ['in transition it was no contest: {S} on the break to {X}', (a, b, x) => 'en transición no hubo color: ' + sc(a, b) + ' al contraataque para ' + x],
    ['the bench made the difference, outscoring {X}{Z} {S}', (y, a, b) => 'el banquillo marcó la diferencia: superó al de ' + y + ' por ' + sc(a, b)],
    ['{X} got far more from their bench: {S}', (x, a, b) => sv(x, 'sacó mucho más de su banquillo') + ': ' + sc(a, b)],
    ['{X} moved the ball well, with {D} assists on {D} baskets', (x, a, f) => sv(x, 'movió bien el balón') + ': ' + a + ' asistencias en ' + f + ' canastas'],
    ['the ball moved: {D} of {X}{Z} {D} baskets were assisted', (a, x, f) => 'el balón circuló: ' + a + ' de las ' + f + ' canastas de ' + x + ' llegaron tras asistencia'],
    ['it was not pretty', () => 'no fue un partido bonito'],
    ['{X} made {W} of {D} threes and {W} of {D} free throws, and won anyway',
      (x, m, a, f, t) => sv(x, 'anotó ' + n(m) + ' de ' + a + ' triples y ' + n(f) + ' de ' + t + ' tiros libres, y aun así ganó')],
    /* the two halves of a concession, each said on its own ("Although a, b" / "a. Still, b": the joins below) */
    ['{X} made only {W} of {D} threes and {W} of {D} free throws', (x, m, a, f, t) => sv(x, 'solo anotó ' + n(m) + ' de ' + a + ' triples y ' + n(f) + ' de ' + t + ' tiros libres')],
    ['{X} made only {W} of their {D} threes', (x, m, a) => sv(x, 'solo anotó ' + n(m) + ' de sus ' + a + ' triples')],
    ['(?:still|even so), {X} won anyway', x => 'aun así, ' + sv(x, 'ganó')],
    ['{X} won anyway', x => sv(x, 'ganó igualmente')],
    ['{X} won by {W}', (x, w) => sv(x, 'ganó por ' + cnt(w, 'punto', 'puntos'))],
    ['it was not a night for shooting: {X} made {W} of {D} from three and won anyway',
      (x, m, a) => 'no fue una noche de acierto: ' + x + ' anotó ' + n(m) + ' de ' + a + ' en triples y aun así ganó'],
    ['{X} made only {W} of their {D} free throws, and it did not matter', (x, f, t) => sv(x, 'solo anotó ' + n(f) + ' de sus ' + t + ' tiros libres, y no importó')],
    ['{X} were poor at the free-throw line, {W} of {D}, and it did not matter', (x, f, t) => sv(x, 'estuvo flojo en los tiros libres') + ', ' + n(f) + ' de ' + t + ', y no importó'],
    ['neither side could buy a three: {X} made {W} of {D}, {X} {W} of {D}',
      (x, m, a, y, m2, a2) => 'ninguno de los dos dio con el triple: ' + x + ' anotó ' + n(m) + ' de ' + a + ',' + yy(y) + y + ', ' + n(m2) + ' de ' + a2],
    ['it was a poor night from deep for both: {W} of {D} for {X}, {W} of {D} for {X}',
      (m, a, x, m2, a2, y) => 'mala noche desde el triple para ambos: ' + n(m) + ' de ' + a + ' para ' + x + ' y ' + n(m2) + ' de ' + a2 + ' para ' + y],
    /* the stars: the line, the shooting, the night against the season, the second scorer, the specialist (a player's
       words that do not take a gender where Spanish can avoid one: "fue lo mejor", "la referencia", "eficaz") */
    ['{X} had a triple-double for {X}: {D} points{T}', (p, x, d, t) => sv(p, 'firmó un triple-doble para ' + x) + ': ' + line(d, t)],
    ['{X} filled the sheet with a triple-double, {D} points{T}', (p, d, t) => sv(p, 'llenó la hoja de estadísticas con un triple-doble') + ': ' + line(d, t)],
    ['{X} was the best player on the floor, with {D} points{T}', (p, d, t) => sv(p, 'fue lo mejor del partido, con ' + line(d, t))],
    ['{X} led everyone with {D} points{T}', (p, d, t) => sv(p, 'fue la referencia del partido, con ' + line(d, t))],
    ['{X} carried {X}: {D} points{T}', (p, x, d, t) => sv(p, 'se echó a ' + x + ' a la espalda') + ': ' + line(d, t)],
    ['{X} top-scored for {X} with {D} points{T}', (p, x, d, t) => sv(p, 'lideró la anotación de ' + x + ' con ' + line(d, t))],
    ['{X} was {X}{Z} top scorer, with {D} points{T}', (p, x, d, t) => sv(p, 'fue quien más anotó en ' + x + ', con ' + line(d, t))],
    ['{X} also had {J}', (p, r) => sv(p, 'sumó además ' + stats(r))],
    ['besides the points, {X} had {J}', (p, r) => 'además de los puntos, ' + p + ' aportó ' + stats(r)],
    ['{X} made {W} of {D} shots', (p, m, a) => sv(p, 'acertó en ' + n(m) + ' de sus ' + a + ' tiros de campo')],
    ['{X} was efficient, (too, )?making {W} of {D} shots', (p, too, m, a) => sv(p, too ? 'además fue eficaz' : 'fue eficaz') + ': ' + n(m) + ' de ' + a + ' en tiros de campo'],
    ['and (?:he|she|they) did it efficiently, on {D}-of-{D} shooting', (m, a) => 'y lo hizo con eficacia: ' + m + ' de ' + a + ' en tiros de campo'],
    ['it was the best scoring night of (?:his|her|their) career here', () => 'fue la mejor noche anotadora de su carrera en esta liga'],
    ['no game of (?:his|her|hers|their|theirs) in this league has brought more points', () => 'nunca había anotado tanto en un partido de esta liga'],
    ['that is well above the {F} (?:he|she|they) had been averaging', f => 'es una cifra muy superior a los ' + f + ' puntos que promediaba'],
    ['{X} had been averaging {F}', (x, f) => sv(x, 'venía promediando ' + f + ' puntos')],
    ['{X} (scored|had) {D} points for {X}', (p, k, d, x) => sv(p, (/^had$/i.test(k) ? 'sumó ' : 'anotó ') + stat('points', d) + ' con ' + x)],
    ['{X} added {D} points{T} off the bench', (p, d, t) => sv(p, 'aportó ' + line(d, t) + ' desde el banquillo')],
    ['off the bench, {X} chipped in {D} points', (p, d) => 'desde el banquillo, ' + p + ' aportó ' + stat('points', d)],
    ['{X} gave {X} {D} points from the bench', (p, x, d) => sv(p, 'dio a ' + x + ' ' + stat('points', d) + ' desde el banquillo')],
    ['{X} added {D} points{T}', (p, d, t) => sv(p, 'añadió ' + line(d, t))],
    ['{X} chipped in with {D} points', (p, d) => sv(p, 'contribuyó con ' + stat('points', d))],
    ['{X} contributed {D} points', (p, d) => sv(p, 'aportó ' + stat('points', d))],
    ['{X} blocked {W} shots at the other end', (p, w) => sv(p, 'colocó ' + stat('blocks', n(w)) + ' en defensa')],
    ['at the other end, {X} blocked {W} shots', (p, w) => 'en defensa, ' + p + ' colocó ' + stat('blocks', n(w))],
    ['{X} pulled down {W} rebounds', (p, w) => sv(p, 'capturó ' + stat('rebounds', n(w)))],
    ['{X} was a force on the boards with {W} rebounds', (p, w) => sv(p, 'dominó bajo los tableros con ' + stat('rebounds', n(w)))],
    ['{X} had {W} steals', (p, w) => sv(p, 'firmó ' + stat('steals', n(w)))],
    ['{X} picked {W} pockets', (p, w) => sv(p, 'robó ' + n(w) + ' balones')],
    ['{X} ran the offence, setting up {W} of {X}{Z} {D} assisted baskets',
      (p, w, x, d) => sv(p, 'dirigió el ataque y asistió en ' + n(w) + ' de las ' + d + ' canastas asistidas de ' + x)],
    ['much of it went through {X}, who set up {W} of {X}{Z} {D} assisted baskets',
      (p, w, x, d) => 'buena parte del juego pasó por ' + p + ', que asistió en ' + n(w) + ' de las ' + d + ' canastas asistidas de ' + x],
    ['{X} handed out {W} assists', (p, w) => sv(p, 'repartió ' + stat('assists', n(w)))],
    ['{X} ran the show with {W} assists', (p, w) => sv(p, 'dirigió el juego con ' + stat('assists', n(w)))],
    ['{X} were {D} points better with {X} on the floor', (x, d, p) => sv(x, 'fue ' + d + ' puntos mejor con ' + p + ' en pista')],
    ['with {X} on the court, {X} won by {D}', (p, x, d) => 'con ' + p + ' en pista, ' + x + ' ganó por ' + d],
    /* the other side: who carried them and what went wrong */
    ['{X} had {D} points{T}', (p, d, t) => sv(p, 'firmó ' + line(d, t))],
    ['for {X}, {X} (had|scored) {D} points{T}', (x, p, k, d, t) => 'en ' + x + ', ' + p + (/^had$/i.test(k) ? ' firmó ' : ' anotó ') + line(d, t)],
    ['{X} did what (?:he|she|they) could for {X}, with {D} points{T}', (p, x, d, t) => sv(p, 'hizo lo que pudo por ' + x + ', con ' + line(d, t))],
    ['{H} best was {X}, with {D} points{T}', (h, p, d, t) => (ownr(h) ? 'lo mejor de ' + ownr(h) : 'lo mejor de los suyos') + ' fue ' + p + ', con ' + line(d, t)],
    ['but {X} \\((\\d+) of (\\d+)\\) and {X} \\((\\d+) of (\\d+)\\) never found their range',
      (p, a, b, q, c, d) => 'pero ' + p + ' (' + a + ' de ' + b + ')' + yy(q) + q + ' (' + c + ' de ' + d + ') nunca encontraron el acierto'],
    ['{X} needed more from {X} and {X}, who shot (\\d+) of (\\d+) and (\\d+) of (\\d+)',
      (x, p, q, a, b, c, d) => sv(x, 'necesitaba más de ' + p + yy(q) + q) + ', que se quedaron en ' + a + ' de ' + b + ' y ' + c + ' de ' + d + ' en tiros de campo'],
    ['{X} struggled, making (\\d+) of (\\d+)', (p, a, b) => sv(p, 'no tuvo su día') + ': ' + a + ' de ' + b + ' en tiros de campo'],
    ['it was a hard night for {X}, (\\d+) of (\\d+) from the field', (p, a, b) => 'noche difícil para ' + p + ', con ' + a + ' de ' + b + ' en tiros de campo'],
    ['(both )?{X} and {X} (both )?fouled out', (b1, p, q, b2) => (b1 ? 'tanto ' + pers(p) + ' como ' + q : pers(p) + yy(q) + q) + ' se marcharon' + (b2 ? ' los dos' : '') + ' por faltas'],
    ['{X} fouled out', p => sv(p, 'se marchó por faltas')],
    ['{X} kept themselves in it on the offensive glass, with {D} second-chance points', (x, d) => sv(x, 'resistió gracias al rebote ofensivo, con ' + d + ' puntos de segunda oportunidad')],
    ['second chances kept {X} going: {D} points from them', (x, d) => 'las segundas oportunidades sostuvieron a ' + x + ': ' + stat('points', d)],
    /* the five that won it */
    ['{H} best spell came with {L} on the floor: they won those {I} by {D}',
      (h, f, i, d) => su(h, 'el', 'mejor tramo') + ' llegó con ' + names(f) + ' en pista: ganaron esos ' + mins(i) + ' por ' + d],
    ['the group that did it was {L}, plus {D} in {I} together', (f, d, i) => 'el quinteto que lo hizo fue el de ' + names(f) + ': +' + d + ' en ' + mins(i) + ' juntos'],
    /* what next: the table, the next games ("recibe a", "visita a") */
    ['{X} are {K} at {S}; {X} are {K} at {S}', (x, k, a, b, y, j, c, d) => sv(x, 'es ' + place(k) + ' con ' + sc(a, b)) + '; ' + y + ', ' + place(j) + ' con ' + sc(c, d)],
    ['{X} move to {S}, {K} in the table; {X} are {K} at {S}',
      (x, a, b, k, y, j, c, d) => sv(x, 'pasa a ' + sc(a, b) + ', ' + (place(k) === 'líder' ? 'líder de la clasificación' : place(k) + ' en la clasificación')) + '; ' + y + ' es ' + place(j) + ' con ' + sc(c, d)],
    ['the two meet again on {Y}', d => fecha(d) && 'los dos equipos se volverán a ver las caras ' + fecha(d)],
    ['they do it all again on {Y}', d => fecha(d) && 'repetirán duelo ' + fecha(d)],
    ['{X} (host|go to) {X} on {Y}; {X} (host|go to) {X} the same day',
      (x, k, y, d, x2, k2, y2) => fecha(d) && sv(x, NX[k.toLowerCase()] + y + ' ' + fecha(d)) + '; ' + x2 + ' ' + NX[k2.toLowerCase()] + y2 + ' ese mismo día'],
    ['next up, on {Y}: {X} (host|go to) {X}, {X} (host|go to) {X}',
      (d, x, k, y, x2, k2, y2) => fecha(d) && 'lo próximo, ' + fecha(d) + ': ' + x + ' ' + NX[k.toLowerCase()] + y + yy(x2) + x2 + ' ' + NX[k2.toLowerCase()] + y2],
    ['{X} (host|go to) {X} on {Y}, and {X} (host|go to) {X} on {Y}',
      (x, k, y, d, x2, k2, y2, d2) => fecha(d) && fecha(d2) && sv(x, NX[k.toLowerCase()] + y + ' ' + fecha(d)) + ',' + yy(x2) + x2 + ' ' + NX[k2.toLowerCase()] + y2 + ' ' + fecha(d2)],
    ['next for {X}: they (host|go to) {X} on {Y}', (x, k, y, d) => fecha(d) && 'próximo partido de ' + x + ': ' + NX[k.toLowerCase()] + y + ' ' + fecha(d)],
    ['{X} (host|go to) {X} on {Y}', (x, k, y, d) => fecha(d) && sv(x, NX[k.toLowerCase()] + y + ' ' + fecha(d))]
  ];
  /* the headline (matchwriter.js headlineOf): present tense, the winner first, the score in brackets */
  const MW_HEAD = [
    ['{X} wins it late for {X} against {X}', (p, x, y) => p + ' da la victoria a ' + x + ' en el último suspiro ante ' + y],
    ['{X} settles it at the death as {X} beat {X}', (p, x, y) => p + ' decide en el último suspiro y ' + x + ' gana a ' + y],
    ['{X} come from {W} down to beat {X}', (x, w, y) => x + ' remonta ' + cnt(w, 'punto', 'puntos') + ' y gana a ' + y],
    ['{X} steal it late against {X}', (x, y) => x + ' le arrebata el triunfo a ' + y + ' en el final'],
    ['{X} off the mark at last with (?:an? )?{S} win over {X}', (x, a, b, y) => x + ' estrena por fin su casillero de victorias ante ' + y + ' (' + sc(a, b) + ')'],
    ['first win of the season for {X}, {S} over {X}', (x, a, b, y) => 'primera victoria de la temporada para ' + x + ' ante ' + y + ' (' + sc(a, b) + ')'],
    ['{X} hand {X} their first defeat', (x, y) => x + ' le endosa a ' + y + ' su primera derrota'],
    ['{X} end {X}{Z} winning run', (x, y) => x + ' corta la racha de victorias de ' + y],
    ['{X} end losing run against {X}', (x, y) => x + ' rompe su racha de derrotas ante ' + y],
    ['{X} make it {W} in a row against {X}', (x, w, y) => x + ' encadena ' + n(w) + ' victorias seguidas al ganar a ' + y],
    ['{X} overwhelm {X} {S}', (x, y, a, b) => x + ' arrolla a ' + y + ' (' + sc(a, b) + ')'],
    ['{X} pull clear of {X} with (?:an? )?{D}[–-]0 run', (x, y, d) => x + ' se escapa ante ' + y + ' con un parcial de ' + sc(d, 0)],
    ['{X}’s? {D} leads {X} past {X}', (p, d, x, y) => 'los ' + d + ' puntos de ' + p + ' dan a ' + x + ' la victoria ante ' + y]
  ];
  const MW = [].concat(MW_LEDE, MW_HOOK, MW_STAKES, MW_BODY, MW_HEAD);

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Spanish | null]; {X} a name or a subject, {D} a count, {F} a
     figure, {W} a count in words, {S} a score, {O} a period, {M} a clock, {T} the rest of a
     stat line, {L} a list of names, {P} a possessive, {Q} a percentile phrase, {R} a share phrase, {V} a situation,
     {K} a place in the table, {G} a group of the table (optional), {A} an amount of points (1.5 too), {Y} a date */
  const RULES = [
    /* ---- the opening sentence, with its dateline ---- */
    ['((?:on|at|in front of) .+ beat .+)', s => {
      const re = /, /g;
      let m;
      while ((m = re.exec(s))) {
        const d = dl(s.slice(0, m.index));
        const t = /^(.+?) beat (.+?) (\d+)[–-](\d+)(?: in ([^,]+))?$/i.exec(s.slice(m.index + 2));
        if (d && t && !/^in front of /i.test(t[1])) {
          return where(d, false) + ', ' + t[1] + ' ganó a ' + t[2] + ' por ' + sc(t[3], t[4]) + (t[5] ? ' ' + ofComp(t[5].replace(/^the /i, '')) : '');
        }
      }
      return null;
    }],
    ['{X} took this {S}(?: (.+))?', (x, a, b, r) => { const d = r ? dl(r) : null; if (r && !d) return null; return sv(x, 'se impuso por ' + sc(a, b)) + (d ? ' ' + where(d) : ''); }],
    ['it finished {S} to (.+)', (a, b, r) => { const [x, d] = nameWhere(r); if (/[,;:—]/.test(x)) return null; return (a === b ? 'el partido terminó en empate a ' + a : 'el partido terminó ' + sc(a, b) + ' para ' + x) + (d ? ' ' + where(d) : ''); }],
    ['{X} came through {S}', (x, a, b) => sv(x, 'sacó adelante el partido por ' + sc(a, b))],
    ['this was over early', () => 'el partido se decidió pronto'],
    ['{X} won it {S}', (x, a, b) => sv(x, 'ganó por ' + sc(a, b))],
    ['{X} had trailed by {D}, which makes this the sort of result that says more about the second half than the first',
      (x, d) => sv(x, 'llegó a perder de ' + d) + ', lo que convierte este resultado en uno que dice más de la segunda parte que de la primera'],
    ['{X} led by as many as {D}', (x, d) => (/ have$/i.test(x) ? null : sv(x, 'llegó a tener ' + d + ' puntos de ventaja'))],
    ['it was never close', () => 'nunca hubo partido'],
    ['it took everything they had', () => 'tuvo que darlo todo'],
    ['were rarely troubled', () => 'apenas pasó apuros'],
    ['it still was not enough', () => 'aun así no le bastó'],
    ['it did not last', () => 'no le duró'],

    /* ---- the half ---- */
    ['it did not look that way at the break, when {X} led {S}', (x, a, b) => 'al descanso no lo parecía, cuando ' + x + ' ganaba ' + sc(a, b)],
    ['{X} went in {D} down at half-time, {S}, and won the second half by {D}',
      (x, d, a, b, e) => sv(x, 'se fue al descanso perdiendo de ' + d + ' (' + sc(a, b) + ') y ganó la segunda parte por ' + e)],
    ['the sides went in level at {D} apiece', d => 'los dos equipos se fueron al descanso empatados a ' + d],
    ['{X} had the game won by half-time, {S} at the break', (x, a, b) => sv(x, 'tenía el partido ganado al descanso') + ': ' + sc(a, b)],
    ['it was {S} to {X} at half-time', (a, b, x) => 'al descanso, ' + sc(a, b) + ' para ' + x],
    ['{X} led {S} at the break', (x, a, b) => sv(x, 'ganaba ' + sc(a, b) + ' al descanso')],
    ['the half-time score was {S}, {X} in front', (a, b, x) => 'al descanso el marcador era ' + sc(a, b) + ', con ' + x + ' por delante'],
    ['{X} won the second half by {D}', (x, d) => (/ trailed by /i.test(x) ? null : sv(x, 'ganó la segunda parte por ' + d))],
    ['it took (?:overtime|{D} overtimes): {S} after forty minutes, and {X} won the extra periods? {S}',
      (k, a, b, x, c, d) => (k ? 'hicieron falta ' + k + ' prórrogas' : 'hizo falta una prórroga') + ': ' + sc(a, b) + ' tras cuarenta minutos, y ' +
        sv(x, 'ganó ' + (k ? 'las prórrogas' : 'la prórroga') + ' por ' + sc(c, d))],

    /* ---- the run, the quarter, the lead ---- */
    ['the decisive spell was an? {D}–0 run in the {O}, long enough to turn a close game into a lead that held',
      (d, o) => 'el tramo decisivo fue un parcial de ' + sc(d, 0) + ' en ' + ord(o) + ', suficiente para convertir un partido igualado en una ventaja que ya no se perdió'],
    ['it turned on an? {D}–0 burst in the {O}, and (the game did not come back|the other side never got back into it)',
      (d, o, k) => 'todo cambió con un parcial de ' + sc(d, 0) + ' en ' + ord(o) + (/other side/i.test(k) ? ', y el rival ya no volvió a meterse en el partido' : ', y el partido ya no volvió')],
    /* one sentence or two ("… did the damage. The game never really came back."), and "really" cut as a filler */
    ['an? {D}–0 run in the {O} did the damage(, and the game never (?:really )?came back)?',
      (d, o, k) => 'un parcial de ' + sc(d, 0) + ' en ' + ord(o) + ' hizo el daño' + (k ? ', y el partido ya nunca volvió a igualarse' : '')],
    ['the game never (?:really )?came back', () => 'el partido ya nunca volvió a igualarse'],
    /* after a run by the side that lost: "It was not enough, and the losers won the fourth 26–16." */
    ['it was not enough', () => 'no le bastó'],
    ['the gap opened during an? {D}–0 run in the {O}', (d, o) => 'la brecha se abrió con un parcial de ' + sc(d, 0) + ' en ' + ord(o)],
    ['the biggest swing was an? {D}–0 run in the {O} from {X}', (d, o, x) => 'el mayor parcial fue un ' + sc(d, 0) + ' de ' + x + ' en ' + ord(o)],
    ['the longest run of the game was {X}{Z} {D}–0 in the {O}', (x, d, o) => 'la mayor racha del partido fue el ' + sc(d, 0) + ' de ' + x + ' en ' + ord(o)],
    ['{X} took the period {S}', (x, a, b) => sv(x, 'se llevó ese cuarto por ' + sc(a, b))],
    ['{X} had already taken the {O} {S}', (x, o, a, b) => sv(x, 'ya se había llevado ' + ord(o) + ' por ' + sc(a, b))],
    ['{X} won the {O} {S}', (x, o, a, b) => sv(x, 'ganó ' + ord(o) + ' por ' + sc(a, b))],
    ['{X} were in front at every break', x => sv(x, 'iba por delante al final de cada cuarto')],
    ['{X} were {S} up early', (x, a, b) => sv(x, 'empezó ganando ' + sc(a, b))],
    ['the lead had changed {D} times? before that', d => 'antes de eso, el liderato había cambiado de manos ' + d + ' ' + pl(d, 'vez', 'veces')],
    ['there were {D} lead changes?(?: and the scores were level {W} times)?, so neither side ever properly settled',
      (d, w) => 'hubo ' + d + ' ' + pl(d, 'cambio', 'cambios') + ' de líder' + (w ? ' y el marcador estuvo igualado ' + n(w) + ' veces' : '') + ', así que ninguno de los dos llegó a asentarse'],
    ['the scores were level {W} times', w => 'el marcador estuvo igualado ' + n(w) + ' veces'],
    /* who was in front, and for how long: "all but 20 seconds" is "salvo 20 segundos" */
    ['{X} led from the first basket to the last', x => sv(x, 'mandó en el marcador de la primera canasta a la última')],
    ['it was wire to wire for {X}: never behind, and never level after the first basket',
      x => x + ' lideró de principio a fin: nunca fue por detrás, y tras la primera canasta no volvió a haber empate'],
    ['{X} never gave up the lead after the first basket', x => sv(x, 'no soltó el liderato desde la primera canasta')],
    ['{X} never trailed', x => sv(x, 'nunca fue por detrás en el marcador')],
    ['at no point was {X} behind', x => x + ' no fue por detrás en ningún momento'],
    ['{X} led for ' + ALLBUT + ' of it and still lost', (x, s, m) => sv(x, 'mandó en el marcador todo el partido ' + allBut(s, m) + ', y aun así perdió')],
    ['for ' + ALLBUT + ' of the game it was {X}{Z}, and they lost it anyway', (s, m, x) => sv(x, 'mandó en el marcador todo el partido ' + allBut(s, m) + ', y aun así lo perdió')],
    ['{X} were in front for {W} of the {W} minutes and still lost', (x, a, b) => sv(x, 'fue por delante ' + n(a) + ' de los ' + n(b) + ' minutos, y aun así perdió')],
    ['for {W} of the {W} minutes it was {X}{Z} game, and they lost it anyway', (a, b, x) => 'durante ' + n(a) + ' de los ' + n(b) + ' minutos el partido fue de ' + x + ', y aun así lo perdió'],
    ['{X} led for most of it, {W} of the {W} minutes, and it was not enough', (x, a, b) => sv(x, 'mandó casi todo el partido, ' + n(a) + ' de los ' + n(b) + ' minutos, y no le bastó')],
    ['{X} were in front for ' + ALLBUT + ' of the game', (x, s, m) => sv(x, 'fue por delante todo el partido ' + allBut(s, m))],
    ['it was {X}{Z} game from the start, in front for ' + ALLBUT + ' of it', (x, s, m) => 'el partido fue de ' + x + ' desde el principio: por delante todo el encuentro ' + allBut(s, m)],
    ['{X} were in front for {W} of the {W} minutes', (x, a, b) => sv(x, 'fue por delante ' + n(a) + ' de los ' + n(b) + ' minutos')],
    ['it was {X}{Z} game from the start, in front for {W} of the {W} minutes', (x, a, b) => 'el partido fue de ' + x + ' desde el principio: por delante ' + n(a) + ' de los ' + n(b) + ' minutos'],

    /* ---- the finish ---- */
    ['{X} were {W} down with five minutes left and outscored {X} {S} from there',
      (x, w, y, a, b) => sv(x, 'perdía de ' + n(w) + ' a falta de cinco minutos') + ' y desde ahí le endosó un ' + sc(a, b) + ' a ' + y],
    ['it was (?:level|a {W}-point game) with five minutes to play, and {X} finished it {S}',
      (w, x, a, b) => 'a falta de cinco minutos ' + (w ? 'la diferencia era de ' + stat('points', n(w)) : 'el partido estaba empatado') + ', y ' + x + ' lo cerró con un ' + sc(a, b)],
    ['five minutes out it was (?:level|a {W}-point game)(?:, {X} ahead)?, and the last five went {S} to {X}',
      (w, x, a, b, y) => 'a cinco minutos del final ' + (w ? 'la diferencia era de ' + stat('points', n(w)) + (x ? ', con ' + x + ' por delante' : '') : 'había empate') + ', y los últimos cinco minutos fueron ' + sc(a, b) + ' para ' + y],
    ['it was still (?:level|a {W}-point game) with five minutes left before {X} closed it out {S}',
      (w, x, a, b) => 'a falta de cinco minutos ' + (w ? 'la diferencia seguía siendo de ' + stat('points', n(w)) : 'seguía el empate') + ', hasta que ' + x + ' lo cerró con un ' + sc(a, b)],
    ['the margin was (?:nothing|only {W}) with five to play, and then {X} finished {S}',
      (w, x, a, b) => 'a falta de cinco minutos ' + (w ? 'la diferencia era de solo ' + stat('points', n(w)) : 'no había diferencia') + ', y entonces ' + x + ' cerró con un ' + sc(a, b)],
    ['{X} led by {W} with five minutes to go and had to hang on, {X} taking the last five {S}',
      (x, w, y, a, b) => sv(x, 'ganaba de ' + n(w) + ' a falta de cinco minutos y tuvo que aguantar') + ', con ' + y + ' llevándose los últimos cinco minutos por ' + sc(a, b)],
    ['the last five minutes went {S} to {X}', (a, b, x) => 'los últimos cinco minutos fueron ' + sc(a, b) + ' para ' + x],
    ['{X} scored the last {W} points of the game', (x, w) => sv(x, 'anotó los últimos ' + stat('points', n(w)) + ' del partido')],
    ['{X} went {W} of {W} from the line in the last two minutes to see it out',
      (x, a, b) => sv(x, 'anotó ' + n(a) + ' de ' + n(b) + ' tiros libres en los dos últimos minutos para cerrar el partido')],
    ['{X} missed {W} of {W} free throws in the last two minutes, in a game they lost by {D}',
      (x, a, b, d) => sv(x, 'falló ' + n(a) + ' de ' + n(b) + ' tiros libres en los dos últimos minutos, en un partido que perdió por ' + d)],

    /* ---- tempo and the season ---- */
    ['it was played at speed(?: —|,) {F} possessions per 40(?:, quicker than this league’s usual {D})?',
      (f, d) => 'se jugó a mucho ritmo: ' + f + ' posesiones por cada 40 minutos' + (d ? ', por encima de las ' + d + ' habituales en esta liga' : '')],
    ['it was a slow, half-court game at {F} possessions per 40(?:, slower than this league’s usual {D})?',
      (f, d) => 'fue un partido lento, de ataque posicional, con ' + f + ' posesiones por cada 40 minutos' + (d ? ', por debajo de las ' + d + ' habituales en esta liga' : '')],
    ['{X} finished on {D} against a season average of {F}', (x, d, f) => sv(x, 'terminó con ' + d + ' puntos, cuando su media de la temporada es de ' + f)],
    ['{X} were held to {D}, well short of the {F} they usually manage', (x, d, f) => sv(x, 'se quedó en ' + d + ' puntos, muy lejos de los ' + f + ' que suele anotar')],

    /* ---- the game in its season, the value ledger, the moments (2026-10-07) ---- */
    /* why it matters and what it means: runs made and ended, the top of the table, upsets, the meetings, the next game.
       The table's words are its own: líder, liderato, puesto, balance (9-2), racha */
    ['{X} had won their first {W} games; this was their first defeat', (x, w) => sv(x, 'había ganado sus ' + n(w) + ' primeros partidos') + '; esta fue su primera derrota'],
    ['it was the first defeat of the season for {X}, after {W} straight wins', (x, w) => 'fue la primera derrota de la temporada para ' + x + ', tras ' + n(w) + ' victorias seguidas'],
    ['the win takes {X} top{G}, at {S}', (x, g, a, b) => 'la victoria aúpa a ' + x + ' al liderato' + ofGrp(g) + ', con un balance de ' + sc(a, b)],
    ['{X} go top{G} with it, {S}', (x, g, a, b) => sv(x, 'se pone líder' + ofGrp(g) + ' con este triunfo') + ' (' + sc(a, b) + ')'],
    ['{X} lose top spot with the defeat', x => sv(x, 'pierde el liderato con la derrota')],
    ['the defeat costs {X} first place', x => 'la derrota le cuesta el liderato a ' + x],
    ['{X} stay top{G} at {S}', (x, g, a, b) => sv(x, 'sigue líder' + ofGrp(g) + ', con un balance de ' + sc(a, b))],
    ['it keeps {X} top{G}', (x, g) => 'el resultado mantiene a ' + x + ' en lo más alto ' + (g ? de(grp(g)) : 'de la clasificación')],
    ['{X} climb to {K}{G}', (x, k, g) => sv(x, 'sube al ' + ordes(k, true) + ' puesto' + ofGrp(g))],
    ['the win lifts {X} to {K}{G}', (x, k, g) => 'la victoria eleva a ' + x + ' hasta el ' + ordes(k, true) + ' puesto' + ofGrp(g)],
    ['{X} started the night {K} in the table and beat the side in {K}',
      (x, a, b) => sv(x, 'llegaba en el ' + ordes(a, true) + ' puesto de la clasificación y ganó al ' + (place(b) === 'líder' ? 'líder' : ordes(b, true) + ' clasificado'))],
    ['on the table this was an upset: {X} were {K}, {X} {K}', (x, a, y, b) => 'según la clasificación, fue una sorpresa: ' + x + ' era ' + place(a) + yy(y) + y + ', ' + place(b)],
    ['on the season’s numbers this should have been {X}{Z} game by about {A} points?', (x, a) => 'por los números de la temporada, este partido debía haber sido para ' + x + ' por ' + abt(a)],
    ['the season’s four factors had {X} about {A} points? better going in', (x, a) => 'los cuatro factores de la temporada daban a ' + x + ' ' + abt(a) + ' de ventaja antes del partido'],
    ['it ended a run of {W} straight defeats for {X}', (w, x) => sv(x, 'rompió así una racha de ' + n(w) + ' derrotas seguidas')],
    ['it ended {X}{Z} run of {W} straight wins', (x, w) => 'así se cortó la racha de ' + n(w) + ' victorias seguidas de ' + x],
    ['{X} had won {W} in a row coming in', (x, w) => sv(x, 'llegaba con ' + n(w) + ' victorias seguidas')],
    ['{X} had lost {W} in a row before this', (x, w) => sv(x, 'venía de perder ' + n(w) + ' partidos seguidos')],
    ['it is {W} wins in a row for {X}', (w, x) => 'son ya ' + n(w) + ' victorias seguidas para ' + x],
    ['that is {W} defeats in a row for {X}', (w, x) => 'son ya ' + n(w) + ' derrotas seguidas para ' + x],
    /* "have now won five straight" in the report; "have won four straight" in the preview */
    ['{X} have (now )?(won|lost) {W} straight', (x, now, k, w) => sv(x, (now ? 'suma ya ' : 'encadena ') + n(w) + (/won/i.test(k) ? ' victorias' : ' derrotas') + (now ? ' consecutivas' : ' seguidas'))],
    ['it was {X}{Z} first win of the season, at the {K} attempt', (x, k) => 'fue la primera victoria de la temporada para ' + x + ', al ' + ordes(k, true) + ' intento'],
    ['{X} are off the mark at last, at the {K} attempt', (x, k) => sv(x, 'estrena por fin su casillero de victorias, al ' + ordes(k, true) + ' intento')],
    ['{X} are still unbeaten, {S}', (x, a, b) => sv(x, 'sigue invicto') + ' (' + sc(a, b) + ')'],
    ['nobody has beaten {X} yet: {D} games, {D} wins', (x, a, b) => 'nadie ha ganado todavía a ' + x + ': ' + cnt(a, 'partido', 'partidos') + ', ' + cnt(b, 'victoria', 'victorias')],
    ['{X} are still looking for a first win, {W} games in', (x, w) => sv(x, 'sigue buscando su primera victoria tras ' + cnt(w, 'partido', 'partidos'))],
    ['it is {W} games and no wins for {X}', (w, x) => sv(x, 'suma ' + cnt(w, 'partido', 'partidos') + ' sin conocer la victoria')],
    ['{X}{Z} {D} points (are|equal) the most any side has scored in this league this season',
      (x, d, e) => 'los ' + d + ' puntos de ' + x + (/^equal$/i.test(e) ? ' igualan' : ' son') + ' la mayor anotación de un equipo en esta liga esta temporada'],
    ['{X}{Z} {D}-point win (is|equals) the widest in this league this season',
      (x, d, e) => 'la victoria de ' + x + ' por ' + d + ' puntos ' + (/^equals$/i.test(e) ? 'iguala' : 'es') + ' la más amplia de esta liga esta temporada'],
    ['{X}{Z} {D} (threes|assists) (are|equal) the most by any side in a game this season',
      (x, d, k, e) => los(k) + ' ' + stat(k.toLowerCase(), d) + ' de ' + x + (/^equal$/i.test(e) ? ' igualan' : ' son') + ' la mejor marca de un equipo en un partido esta temporada'],
    ['{X}{Z} {D}-rebound edge (is|equals) the widest in this league this season',
      (x, d, e) => 'la diferencia de ' + d + ' rebotes a favor de ' + x + ' ' + (/^equals$/i.test(e) ? 'iguala' : 'es') + ' la mayor de esta liga esta temporada'],
    ['{X}{Z} {D} points were their most of the season', (x, d) => 'los ' + d + ' puntos de ' + x + ' fueron su mejor anotación de la temporada'],
    ['{X} had not scored {D} all season', (x, d) => sv(x, 'no había anotado ' + d + ' puntos en toda la temporada')],
    ['{X} have not allowed fewer all season than the {D} they gave up here', (x, d) => sv(x, 'no había encajado tan pocos puntos en toda la temporada como los ' + d + ' de este partido')],
    ['{X}{Z} {D} is the fewest {X} have allowed this season', (y, d, x) => 'los ' + d + ' puntos de ' + y + ' son lo mínimo que ha encajado ' + x + ' esta temporada'],
    ['{X} have won all {W} meetings this season', (x, w) => sv(x, 'ha ganado los ' + n(w) + ' enfrentamientos de esta temporada')],
    ['{X} had won the last meeting {S}; this was {X}{Z} reply', (y, a, b, x) => sv(y, 'había ganado el último enfrentamiento') + ' (' + sc(a, b) + '); esta fue la respuesta de ' + x],
    ['the season series (between them )?is level at {S}', (bt, a, b) => 'los enfrentamientos de esta temporada' + (bt ? ' entre ambos' : '') + ' están igualados (' + sc(a, b) + ')'],
    ['the season series is {S} to {X}', (a, b, x) => 'los enfrentamientos de esta temporada van ' + sc(a, b) + ' para ' + x],
    ['the crowd of {D} was {X}{Z} biggest of the season', (d, x) => 'los ' + d + ' espectadores fueron la mejor entrada de la temporada en casa de ' + x],
    ['only {D}% of the {D} fans who picked a winner had gone with {X}', (p, d, x) => 'solo el ' + p + '% de los ' + d + ' aficionados que hicieron su pronóstico se había decantado por ' + x],
    ['{X} were playing for the second time in two days', x => sv(x, 'jugaba por segunda vez en dos días')],
    ['(in the league, )?{X} are {K}{G} at {S}, {X} {K}{G} at {S}', (lg, x, a, g, s1, s2, y, b, h, s3, s4) =>
      (lg ? 'en la liga, ' : '') + x + ' es ' + place(a) + ofGrp(g) + ' con ' + sc(s1, s2) + ',' + yy(y) + y + ', ' + place(b) + ofGrp(h) + ' con ' + sc(s3, s4)],
    ['the two meet again on {Y}, at {X}{Z} place', (d, x) => fecha(d) && 'los dos equipos se volverán a ver las caras ' + fecha(d) + ', en casa de ' + x],
    ['next for {X}: {X} at home on {Y}', (x, y, d) => fecha(d) && 'próximo partido de ' + x + ': recibe a ' + y + ' ' + fecha(d)],
    ['next for {X}: away at {X} on {Y}', (x, y, d) => fecha(d) && 'próximo partido de ' + x + ': visita a ' + y + ' ' + fecha(d)],
    /* the date can be cut by the writer's reviser when the sentence before ended on the same one ("…are next for X.") */
    ['{X} host {X} next(?:, on {Y})?', (x, y, d) => (d && !fecha(d) ? null : sv(x, 'recibe a ' + y + ' en su próximo partido' + (d ? ', ' + fecha(d) : '')))],
    ['{X} are next for {X}(?:, at home on {Y})?', (y, x, d) => (d && !fecha(d) ? null : 'el próximo rival de ' + x + ' es ' + y + (d ? ', que visitará su pista ' + fecha(d) : ''))],
    ['{X} go to {X} next(?:, on {Y})?', (x, y, d) => (d && !fecha(d) ? null : sv(x, 'visita a ' + y + ' en su próximo partido' + (d ? ', ' + fecha(d) : '')))],
    ['a trip to {X} is next for {X}(?:, on {Y})?', (y, x, d) => (d && !fecha(d) ? null : 'lo próximo para ' + x + ' es la visita a ' + y + (d ? ', ' + fecha(d) : ''))],
    /* the moments: the basket that won it, the one that put them ahead for good, the closer, a three at the buzzer
       ("sobre la bocina") */
    ['{X}’s? (three|free throw|basket) with {W} seconds? left( in overtime)? won it for {X}',
      (p, k, w, ot, x) => SHOT[k.toLowerCase()] + ' de ' + p + ' a falta de ' + cnt(w, 'segundo', 'segundos') + (ot ? ' para el final de la prórroga' : '') + ' dio la victoria a ' + x],
    ['{X}’s? (three|free throw|basket) with (?:{W} seconds?|{M}) left( in overtime)? put {X} ahead for good',
      (p, k, w, m, ot, x) => SHOT[k.toLowerCase()] + ' de ' + p + ' a falta de ' + (m || cnt(w, 'segundo', 'segundos')) + (ot ? ' para el final de la prórroga' : '') + ' puso a ' + x + ' por delante de forma definitiva'],
    ['{X} scored {W} of {X}{Z} {W} points in the last five minutes', (p, a, x, b) => p + ' anotó ' + n(a) + ' de los ' + n(b) + ' puntos de ' + x + ' en los últimos cinco minutos'],
    ['{X} hit a three at the (?:(half-time)|{O}-quarter) buzzer for {X}', (p, h, o, x) => p + ' anotó un triple sobre la bocina ' + (h ? 'del descanso' : de(ord(o))) + ' para ' + x],
    /* the shape of it */
    ['it was a low-scoring grind, {D} points between the two sides', d => 'fue un partido trabado y de poca anotación: ' + d + ' puntos entre los dos equipos'],
    ['points were hard to come by: {D} between the two sides', d => 'costó mucho anotar: ' + d + ' puntos entre los dos equipos'],
    ['it was a shootout, {D} points between the two sides', d => 'fue un festival anotador: ' + d + ' puntos entre los dos equipos'],
    ['neither defence held: {D} points between them', d => 'ninguna defensa aguantó: ' + d + ' puntos entre ambos'],
    /* what decided it, in points: the facet worth most (LEAD), what came next, what the losers won back, the split
       shooting, the season's expectation before the tip, home court and what no facet measures */
    ['(' + alt(BY) + '), (.+)', (b, s) => { const t = first(LEAD, s); return t && BY[b.toLowerCase()] + ', ' + t; }],
    ['no single facet decided this: on the league’s own weights nothing was worth more than a point or two either way, and the margin was made in the margins',
      () => 'ninguna faceta decidió este partido por sí sola: con los pesos propios de la liga, nada valió más de uno o dos puntos en ningún sentido, y la diferencia se fraguó en los detalles'],
    ['next came (.+?), worth {W} more', (l, w) => { const f = fac(l); return f && 'después ' + (many(f) ? 'llegaron ' : 'llegó ') + f + ', que ' + (many(f) ? 'sumaron ' : 'sumó ') + cnt(w, 'punto', 'puntos') + ' más'; }],
    ['(.+?) added about {A} points?', (l, a) => { const f = fac(l); return f && f + (many(f) ? ' sumaron ' : ' sumó ') + abt(a); }],
    ['{X} won about {A} points? back on (.+?)', (x, a, l) => { const f = fac(l); return f && sv(x, 'recuperó ' + abt(a) + ' en el apartado ' + de(f)); }],
    ['{X} got the better shots, worth about {A} points?, but {X} made more of theirs, about {A} points? the other way',
      (x, a, y, b) => sv(x, 'tuvo mejores tiros, por valor de ' + abt(a)) + ', pero ' + y + ' acertó más con los suyos: ' + abt(b) + ' en sentido contrario'],
    ['before the tip, the season’s numbers had almost nothing between them; {X} won by {W}',
      (x, w) => 'antes del salto inicial, los números de la temporada apenas separaban a los dos equipos; ' + sv(x, 'ganó por ' + n(w))],
    ['before the tip, the season’s numbers made {X} about {A} points? better(?:: {X} won this as the underdogs)?',
      (x, a, y) => 'antes del salto inicial, los números de la temporada daban a ' + x + ' ' + abt(a) + ' de ventaja' + (y ? ': ' + sv(y, 'ganó contra pronóstico') : '')],
    ['{X} beat that by {A} points?', (x, a) => sv(x, 'superó esa previsión en ' + cnt(a, 'punto', 'puntos'))],
    ['{X} won by less than that', x => sv(x, 'ganó por menos de lo previsto')],
    ['that is roughly how it went', () => 'y así fue, más o menos'],
    ['home court is worth about {F}(?: points?)? in this league(?:, and it was {X}{Z})?', (f, x) => 'el factor cancha vale ' + abt(f) + ' en esta liga' + (x ? ', y estaba del lado de ' + x : '')],
    ['the last {W} points of the margin are in no facet at all: the part of a game no factor measures',
      w => 'los últimos ' + n(w) + ' puntos de la diferencia no están en ninguna faceta: son la parte del juego que ningún factor mide'],
    ['on these facets alone {X} would have won by more; {W} points went back to {X} in what no factor measures',
      (x, w, y) => 'solo por estas facetas, ' + sv(x, 'habría ganado por más') + '; ' + n(w) + ' puntos fueron a parar a ' + y + ' en lo que ningún factor mide'],
    /* the four factors in points, when no ledger can be built (no possessions, or a tie): the total, where it came from,
       each side's gains and losses, and the scoreboard against it */
    ['(weighed by what wins in this league|by this league’s own win model|put through what decides games in this league)(?: \\(built on {D} of its games\\))?, (.+)', (o, k, s) => {
      const open = { 'weighed by what wins in this league': 'según lo que gana partidos en esta liga', 'by this league’s own win model': 'según el modelo de victoria de esta liga',
        'put through what decides games in this league': 'pasados por lo que decide los partidos en esta liga' }[o.toLowerCase()] + (k ? ' (con ' + k + ' de sus partidos como base)' : '');
      let m;
      if ((m = rx('the four factors were worth about {A} points? to {X}').exec(s))) return open + ', los cuatro factores valieron ' + abt(m[1]) + ' a ' + (who(m[2]) || m[2]);
      if ((m = rx('{X} came out roughly {A} points? ahead on the four factors').exec(s))) return open + ', ' + sv(m[1], 'salió con ' + abt(m[2]) + ' de ventaja en los cuatro factores');
      if ((m = rx('the four factors make it about {A} points? to {X}').exec(s))) return open + ', los cuatro factores dan ' + abt(m[1]) + ' a ' + (who(m[2]) || m[2]);
      return null;
    }],
    ['add up the four factors and the game was worth about {A} points? to {X}', (a, x) => 'sumando los cuatro factores, el partido valió ' + abt(a) + ' a ' + (who(x) || x)],
    ['weighed factor by factor, {X} came out roughly {A} points? ahead', (x, a) => 'factor a factor, ' + sv(x, 'salió con ' + abt(a) + ' de ventaja')],
    ['the four factors alone make it about {A} points? to {X}', (a, x) => 'solo los cuatro factores ya dan ' + abt(a) + ' a ' + (who(x) || x)],
    ['the biggest gain came from (.+?), worth {W} points?(?:, then (.+?) at {W})?', (l, w, l2, w2) => {
      const f = fac(l), f2 = l2 ? fac(l2) : null;
      return f && (!l2 || f2) && 'la mayor ganancia llegó en ' + f + ', con ' + cnt(w, 'punto', 'puntos') + (l2 ? ', y después en ' + f2 + ', con ' + n(w2) : '');
    }],
    ['{X} won {W} back on (.+?)', (x, w, l) => { const f = fac(l); return f && sv(x, 'recuperó ' + n(w) + ' en ' + f); }],
    ['{X} gained (nothing on any factor and gave up (.+)|(.+?)(?:, and gave back (.+)| and gave nothing back))', (x, all, up, gains, back) => {
      const facts = s => { const it = String(s).split(/, | and /).map(t => { const m = new RegExp('^(' + WORDS + ')(?: points?)? on (.+)$', 'i').exec(t); return m && fac(m[2]) ? n(m[1]) + (/ points?/i.test(t) ? ' ' + pl(n(m[1]), 'punto', 'puntos') : '') + ' en ' + fac(m[2]) : null; }); return it.indexOf(null) >= 0 ? null : list(it); };
      if (up) { const u = facts(up); return u && sv(x, 'no ganó nada en ningún factor y cedió ' + u); }
      const g = facts(gains), b = back ? facts(back) : '';
      return g && b != null && sv(x, 'ganó ' + g + (back ? ', y cedió ' + b : ' y no cedió nada'));
    }],
    ['the scoreboard margin was {W} points?', w => 'la diferencia en el marcador fue de ' + cnt(w, 'punto', 'puntos')],
    ['the final margin was {W} points?(, close to what the factors say|, (more|less) than the factors alone account for)?',
      (w, t, k) => 'la diferencia final fue de ' + cnt(w, 'punto', 'puntos') + (!t ? '' : k ? ', ' + (/more/i.test(k) ? 'más' : 'menos') + ' de lo que explican los factores por sí solos' : ', cerca de lo que dicen los factores')],
    ['the scoreboard told a different story: {X} won by {W} points?', (x, w) => 'el marcador contó otra historia: ' + sv(x, 'ganó por ' + cnt(w, 'punto', 'puntos'))],
    ['the four factors cancelled out: neither side came out more than {W} points? ahead on them',
      w => 'los cuatro factores se anularon: ninguno de los dos sacó más de ' + cnt(w, 'punto', 'puntos') + ' de ventaja en ellos'],

    /* ---- where the points came from ---- */
    /* (the writer's polish makes "1.00 points" singular: "1.00 point a chance") */
    ['{X} (had|have) the edge {V}: {D} points? from {D} chances?(?:,(?: at)? {F} (?:a time|points? a chance|points? each))?, against {X}{Z} {D}',
      (x, t, v, p, c, r, y, o) => sv(x, (/^had$/i.test(t) ? 'dominó ' : 'domina ') + WHERE[v.toLowerCase()]) + ': ' + stat('points', p) + ' en ' + c + ' ' +
        pl(c, 'oportunidad', 'oportunidades') + (r ? ', ' + r + ' por acción' : '') + ', frente a los ' + o + ' de ' + y],
    ['{V} it (?:was|is) {S} to {X}( so far)?, from {D} chances?(?:,(?: at)? {F} (?:a time|points? a chance|points? each))?',
      (v, a, b, x, far, c, r) => WHERE[v.toLowerCase()] + ', ' + sc(a, b) + ' para ' + x + (far ? ' hasta ahora' : '') + ', en ' + c + ' ' +
        pl(c, 'oportunidad', 'oportunidades') + (r ? ', ' + r + ' por acción' : '')],
    ['they (got|are getting) {D}% of their chances that way, {R}', (t, d, r) => 'el ' + d + '% de sus oportunidades ' + (/^got$/i.test(t) ? 'llegaron' : 'están llegando') + ' así, ' + freq(r)],
    /* the glass and the line, with the other side named (2026-10-08: it was "for the other side", and none of these was
       translated) */
    ['{X} won the ball back on {W} of their {W} misses, against {W} of {W} for {X}',
      (x, a, b, c, d, y) => sv(x, 'recuperó el balón en ' + n(a) + ' de sus ' + n(b) + ' fallos') + ', frente a ' + n(c) + ' de ' + n(d) + ' de ' + (who(y) || y)],
    ['misses were not the end of it for {X}: {W} of {W} came back to them, to {W} of {W} for {X}',
      (x, a, b, c, d, y) => 'los fallos no fueron el final para ' + (who(x) || 'ellos') + ': ' + n(a) + ' de ' + n(b) + ' volvieron a sus manos, por ' + n(c) + ' de ' + n(d) + ' de ' + (who(y) || y)],
    ['{X} got {W} of their {W} misses (at the rim|from mid-range|from three) back, against {W} of {W} for {X}',
      (x, a, b, z, c, d, y) => sv(x, 'recuperó ' + n(a) + ' de sus ' + n(b) + ' fallos ' + ZONE_ES[z.toLowerCase()]) + ', frente a ' + n(c) + ' de ' + n(d) + ' de ' + (who(y) || y)],
    ['the second shots came (at the rim|from mid-range|from three) for {X}: {W} of {W} misses came back, to {W} of {W} for {X}',
      (z, x, a, b, c, d, y) => 'las segundas opciones llegaron ' + ZONE_ES[z.toLowerCase()] + ' para ' + (who(x) || x) + ': ' + n(a) + ' de ' + n(b) + ' fallos volvieron a sus manos, por ' + n(c) + ' de ' + n(d) + ' de ' + (who(y) || y)],
    ['{X} got to the line far more often — {D} free throws for every hundred shots, against {D}',
      (x, a, b) => sv(x, 'fue mucho más a la línea') + ': ' + a + ' tiros libres por cada cien tiros, frente a ' + b],
    ['{X} lived at the line, drawing {D} free-throw attempts per hundred field goals to {D}',
      (x, a, b) => sv(x, 'vivió en la línea de tiros libres') + ', con ' + a + ' intentos por cada cien tiros de campo, por ' + b + ' del rival'],
    ['the whistle was kind to {X}: {D} free throws per hundred shots, against {D} for {X}',
      (x, a, b, y) => 'el silbato sonrió a ' + (who(x) || x) + ': ' + a + ' tiros libres por cada cien tiros, frente a ' + b + ' de ' + (who(y) || y)],
    ['in the half court, where most of any game is played, {X} scored {F} points a chance to {F}',
      (x, a, b) => 'en ataque posicional, donde se juega la mayor parte de cualquier partido, ' + sv(x, 'anotó ' + a + ' puntos por oportunidad') + ', frente a ' + b],
    ['{X} were the better set offence — {F} points a chance in the half court against {F}',
      (x, a, b) => sv(x, 'fue mejor en ataque posicional') + ': ' + a + ' puntos por oportunidad, frente a ' + b],
    ['in the half court {X} are getting {F} points a chance to {F}', (x, a, b) => 'en ataque posicional, ' + sv(x, 'está anotando ' + a + ' puntos por oportunidad') + ', frente a ' + b],
    ['{X} have been the better set offence, {F} a chance in the half court against {F}',
      (x, a, b) => sv(x, 'ha sido mejor en ataque posicional') + ': ' + a + ' por oportunidad, frente a ' + b],
    ['{X} (lived|are living) {V}: {D}% of their chances (?:came|have come) that way, {R}',
      (x, t, v, d, r) => sv(x, (/^lived$/i.test(t) ? 'vivió ' : 'vive ') + LIVED[v.toLowerCase()]) + ': el ' + d + '% de sus oportunidades ' + (/^lived$/i.test(t) ? 'llegaron' : 'han llegado') + ' así, ' + freq(r)],
    ['out of timeouts {X} (were|have been) sharp: {W} points? from {W} possessions',
      (x, t, p, c) => 'tras tiempo muerto, ' + sv(x, (/^were$/i.test(t) ? 'estuvo' : 'está') + ' acertado') + ': ' + stat('points', n(p)) + ' en ' + n(c) + ' ' + pl(n(c), 'posesión', 'posesiones')],
    ['{X} (got|are getting) nothing out of their timeouts, {W} points? from {W} possessions',
      (x, t, p, c) => sv(x, (/^got$/i.test(t) ? 'no sacó' : 'no está sacando') + ' nada de sus tiempos muertos') + ': ' + stat('points', n(p)) + ' en ' + n(c) + ' ' + pl(n(c), 'posesión', 'posesiones')],

    /* ---- the box score, said ---- */
    ['from the floor it was {D}% to {D}% in {X}{Z} favour', (a, b, x) => 'en tiros de campo, ' + a + '% contra ' + b + '% a favor de ' + who(x)],
    ['{X} shot {D}% from the field to {D}%', (x, a, b) => sv(x, 'tiró con un ' + a + '% en tiros de campo') + ', por el ' + b + '% del rival'],
    ['{X} made {D} of {D} from three', (x, a, b) => sv(x, 'anotó ' + a + ' de ' + b + ' triples')],
    ['{X} went {D} of {D} from three', (x, a, b) => sv(x, 'se quedó en ' + a + ' de ' + b + ' en triples')],
    ['{X} made only {D} of {D} free throws', (x, a, b) => sv(x, 'solo anotó ' + a + ' de ' + b + ' tiros libres')],
    ['{X} won the boards {S}', (x, a, b) => sv(x, 'ganó la batalla del rebote por ' + sc(a, b))],
    ['{X} scored {D} on the break to {D}', (x, a, b) => sv(x, 'anotó ' + stat('points', a) + ' al contraataque, por ' + b + ' del rival')],
    ['{X} gave the ball away {D} times', (x, d) => sv(x, 'perdió ' + d + ' ' + pl(d, 'balón', 'balones'))],
    ['{X} turned it over {D} times', (x, d) => sv(x, 'cometió ' + d + ' ' + pl(d, 'pérdida', 'pérdidas'))],
    ['{X} coughed it up {D} times', (x, d) => sv(x, 'regaló ' + d + ' ' + pl(d, 'balón', 'balones'))],
    ['{X} went {M} without a field goal in the {O}', (x, m, o) => sv(x, 'estuvo ' + m + ' sin anotar en juego en ' + ord(o))],
    ['{X} shot it better, {F}% eFG against {F}%', (x, a, b) => sv(x, 'tiró mejor') + ': ' + a + '% de eFG% frente a ' + b + '%'],
    ['{X} were the sharper side from the floor — {F}% eFG to {F}%', (x, a, b) => sv(x, 'fue más certero en el tiro') + ': ' + a + '% de eFG% por ' + b + '%'],
    ['the shooting decided it: {X} at {F}% eFG, their opponents at {F}%', (x, a, b) => 'el tiro decidió el partido: ' + (who(x) ? who(x) + ', con un ' : 'un ') + a + '% de eFG%, y su rival, con un ' + b + '%'],
    ['{X} looked after the ball, giving it up on {F}% of their possessions against {F}%', (x, a, b) => sv(x, 'cuidó el balón') + ': lo perdió en el ' + a + '% de sus posesiones, frente al ' + b + '%'],
    ['{X} were far the more careful side, an? {F}% turnover rate to {F}%', (x, a, b) => sv(x, 'fue mucho más cuidadoso con el balón') + ': ' + a + '% de pérdidas frente a ' + b + '%'],
    ['possessions were the difference — {X} turned it over on {F}% of theirs, their opponents on {F}%',
      (x, a, b) => 'las posesiones marcaron la diferencia: ' + sv(x, 'perdió el balón en el ' + a + '% de las suyas') + ' y su rival en el ' + b + '%'],
    ['{X} owned the offensive glass, rebounding {F}% of their own misses to {F}%', (x, a, b) => sv(x, 'dominó el rebote ofensivo') + ': capturó el ' + a + '% de sus fallos, por el ' + b + '% del rival'],
    ['{X} kept possessions alive — {F}% of their misses came back to them, against {F}%', (x, a, b) => sv(x, 'mantuvo vivas sus posesiones') + ': recuperó el ' + a + '% de sus fallos, frente al ' + b + '%'],
    ['the second shots went one way: {X} recovered {F}% of their own misses to {F}%', (x, a, b) => 'las segundas opciones fueron para un solo lado: ' + sv(x, 'recuperó el ' + a + '% de sus fallos') + ', por el ' + b + '% del rival'],
    ['{X} got to the line far more often — {D} free throws for every hundred shots, against {D}', (x, a, b) => sv(x, 'fue mucho más a la línea') + ': ' + a + ' tiros libres por cada cien tiros, frente a ' + b],
    ['{X} lived at the line, drawing {D} free-throw attempts per hundred field goals to {D}', (x, a, b) => sv(x, 'vivió en la línea de tiros libres') + ': ' + a + ' intentos por cada cien tiros de campo, por ' + b + ' del rival'],
    ['the whistle paid {X}: {D} free throws per hundred shots, their opponents {D}', (x, a, b) => 'el arbitraje favoreció a ' + (who(x) || 'este equipo') + ': ' + a + ' tiros libres por cada cien tiros, por ' + b + ' del rival'],
    ['they had the better of (.+?) too', l => { const t = labs(l); return t && 'también dominó en ' + t; }],
    ['(.+?) went their way as well', l => { const t = labs(l); return t && 'también dominó en ' + t; }],
    ['{X} took the game outside — {F}% of their shots came from three, against {F}%(?:, and made {F}% of them)?',
      (x, a, b, c) => sv(x, 'apostó por el exterior') + ': el ' + a + '% de sus tiros fueron triples, frente al ' + b + '%' + (c ? ', y anotó el ' + c + '%' : '')],
    ['{X} went inside — {F}% of their attempts came at the rim, against {F}%(?:, and made {F}% of them)?',
      (x, a, b, c) => sv(x, 'atacó por dentro') + ': el ' + a + '% de sus intentos fueron cerca del aro, frente al ' + b + '%' + (c ? ', y anotó el ' + c + '%' : '')],
    ['{X} moved it well, assisting on {F}% of their field goals', (x, a) => sv(x, 'movió bien el balón') + ': el ' + a + '% de sus canastas fueron asistidas'],
    ['{X} defended better, giving up {F} points per 100 possessions to {F}', (x, a, b) => sv(x, 'defendió mejor') + ': encajó ' + a + ' puntos por cada 100 posesiones, frente a ' + b],
    ['{X} defended better, allowing {F} points per 100 possessions where the other side allowed {F}',
      (x, a, b) => sv(x, 'defendió mejor') + ': encajó ' + a + ' puntos por cada 100 posesiones, por ' + b + ' del rival'],
    /* how the baskets came: off a pass, or made alone */
    ['{X} moved it well: {W} of their {W} baskets came off a pass, against {W} of {W} for {X}',
      (x, a, b, c, d, y) => sv(x, 'movió bien el balón') + ': ' + n(a) + ' de sus ' + n(b) + ' canastas fueron asistidas, por ' + n(c) + ' de ' + n(d) + ' de ' + (who(y) || y)],
    ['{X} had to make more of their own shots, with {D} of their points from baskets nobody set up',
      (x, d) => sv(x, 'tuvo que generarse más sus propios tiros') + ': ' + d + ' de sus puntos llegaron en canastas sin asistencia'],
    ['{X} forced the ball loose all night — their opponents coughed it up on {F}% of possessions', (x, a) => sv(x, 'forzó pérdidas toda la noche') + ': el rival perdió el balón en el ' + a + '% de sus posesiones'],
    ['{X} had their hands on the ball all night — their opponents turned it over on {F}% of possessions', (x, a) => sv(x, 'metió la mano toda la noche') + ': el rival perdió el balón en el ' + a + '% de sus posesiones'],
    ['{X} kept taking it away — their opponents gave it up on {F}% of possessions', (x, a) => sv(x, 'no dejó de robar') + ': el rival perdió el balón en el ' + a + '% de sus posesiones'],
    ['{P} hands were everywhere: {D} steals? and {D} blocks?', (p, s, b) => own(p, 'sus manos', 'las manos') + ' estuvieron en todas partes: ' + stat('steals', s) + ' y ' + stat('blocks', b)],
    ['both sides lived off second chances — {D} points for {X}, {D} for {X}', (a, x, b, y) => 'los dos equipos vivieron de las segundas oportunidades: ' + stat('points', a) + ' para ' + x + ' y ' + b + ' para ' + y],
    ['turnovers were punished at both ends: {D} points off them for {X}, {D} for {X}', (a, x, b, y) => 'las pérdidas se castigaron en ambos lados: ' + stat('points', a) + ' tras pérdida para ' + x + ' y ' + b + ' para ' + y],
    ['{P} bench put up {D} to {D}', (p, a, b) => own(p, 'su banquillo', 'el banquillo') + ' aportó ' + stat('points', a) + ', por ' + b + ' del rival'],
    ['{X} turned giveaways into {D} points', (x, d) => sv(x, 'convirtió las pérdidas rivales en ' + stat('points', d))],
    ['{X} scored {D} in the paint to {D}', (x, a, b) => sv(x, 'anotó ' + stat('points', a) + ' en la zona, por ' + b + ' del rival')],
    ['{X} found {D} second-chance points', (x, d) => sv(x, 'sumó ' + stat('points', d) + ' de segunda oportunidad')],
    ['the whistle fell one way: {X} were called for {D} fouls to {D}', (x, a, b) => 'el arbitraje fue en una sola dirección: a ' + (who(x) || 'este equipo') + ' le pitaron ' + a + ' faltas, por ' + b + ' del rival'],

    /* ---- on the floor ---- */
    ['the five who did it: {L} for {X}, together for the whole of that swing', (f, x) => 'los cinco que lo hicieron: ' + names(f) + ', de ' + x + ', juntos durante todo ese tramo'],
    ['the damage was done with {L} on the floor for {X}, a group outscored by {D} in that time', (f, x, d) => 'el daño llegó con ' + names(f) + ' en pista por parte de ' + x + ', un quinteto que perdió ese tramo por ' + d],
    ['the game turned inside a single {M} spell with {L} on the floor for {X}: they (gained|were outscored by) {D} points in that stretch alone',
      (m, f, x, g, d) => 'el partido cambió en un solo tramo de ' + m + ' con ' + names(f) + ' en pista por parte de ' + x + ': ' + (/^gained$/i.test(g) ? 'ganó' : 'perdió') + ' ese tramo por ' + stat('points', d)],
    ['nothing else in the game moved the scoreboard as far in as little time', () => 'ningún otro momento del partido movió tanto el marcador en tan poco tiempo'],
    ['across every minute they shared, {X}{Z} five from that swing were ([+-]?\\d+) in {M}', (x, pm, m) => 'en todos los minutos que compartieron, el quinteto de ' + x + ' de ese tramo fue ' + pm + ' en ' + m],
    ['{P} strongest group — {L} — was ([+-]?\\d+) across {M}', (p, f, pm, m) => own(p, 'su mejor quinteto', 'el mejor quinteto') + ' (' + names(f) + ') fue ' + pm + ' en ' + m],
    ['(at the other end of it, |at the other end, |the reverse was true at the other end: ){X} lost {D} points in {M} with {L} out there — the combination that cost them most',
      (pre, x, d, m, f) => (/reverse/i.test(pre) ? 'al contrario, ' : 'en el otro lado, ') + sv(x, 'perdió ' + stat('points', d) + ' en ' + m + ' con ' + names(f) + ' en pista') + ': la combinación que más le costó'],
    /* the deciding stretch once the standfirst has given its size, each side's best group and the other's worst
       (2026-10-08: none of these was translated); a five is a list of surnames, the Spanish list joins them */
    ['it came with {L} on the floor for {X}, together for the whole of it', (f, x) => 'llegó con ' + names(f) + ' en pista por parte de ' + x + ', juntos durante todo el tramo'],
    ['it was {X}{Z} worst stretch: {L} were on the floor(, and the other side outscored them by {D} in that time)?',
      (x, f, k, d) => 'fue el peor tramo de ' + x + ': ' + names(f) + ' estaban en pista' + (k ? ', y el rival los superó por ' + stat('points', d) + ' en ese tiempo' : '')],
    /* the same two with the stretch named, not "It" (2026-10-08) */
    ['the stretch that swung it came with {L} on the floor for {X}, together for the whole of it',
      (f, x) => 'el tramo que decidió el partido llegó con ' + names(f) + ' en pista por parte de ' + x + ', juntos de principio a fin'],
    ['the stretch that swung it was {X}{Z} worst: {L} were on the floor(, and the other side outscored them by {D} in that time)?',
      (x, f, k, d) => 'el tramo que decidió el partido fue el peor de ' + x + ': ' + names(f) + ' estaban en pista' + (k ? ', y el rival los superó por ' + stat('points', d) + ' en ese tiempo' : '')],
    ['the other side outscored them by {D} in that time', d => 'el rival los superó por ' + stat('points', d) + ' en ese tiempo'],
    ['over every minute those five shared, {X} (outscored the opposition|were outscored) by {D} in {M}',
      (x, k, d, m) => 'en todos los minutos que compartieron esos cinco, ' + sv(x, (/^outscored/i.test(k) ? 'superó al rival por ' : 'perdió por ') + stat('points', d) + ' en ' + m)],
    ['(?:(their)|{X}{Z}) strongest group, {L}, (outscored the other side|was outscored) by {D} in {M}',
      (t, x, f, k, d, m) => (t ? 'su mejor quinteto' : 'el mejor quinteto de ' + x) + ' (' + names(f) + ') ' + (/^outscored/i.test(k) ? 'superó al rival por ' : 'perdió por ') + stat('points', d) + ' en ' + m],
    ['(the other end of it was ugly for|it went the other way for|the worst of it fell on) {X}, who were outscored by {D} in {M} with {L} out there',
      (o, x, d, m, f) => ({ 'the other end of it was ugly for': 'en el otro lado, lo pasó mal ' + x, 'it went the other way for': 'al revés le fue a ' + x,
        'the worst of it fell on': 'lo peor se lo llevó ' + x })[o.toLowerCase()] + ', que perdió por ' + stat('points', d) + ' en ' + m + ' con ' + names(f) + ' en pista'],

    /* ---- how the ball moved, the play types, the shot clock (2026-10-08) ---- */
    /* the passer and the scorer: "la conexión", "asistió 3 veces a" */
    ['the most productive pairing was {X} to {X} for {X}: {W} baskets worth {W} points(, every one of them a three)?',
      (a, b, x, c, p, t3) => 'la conexión más productiva fue la de ' + a + ' con ' + b + ' en ' + x + ': ' + cnt(c, 'canasta', 'canastas') + ' por valor de ' + cnt(p, 'punto', 'puntos') + (t3 ? ', todas de tres' : '')],
    ['{X} found {X} {W} times for {X}, {W} points in all( and all of them threes)?',
      (a, b, c, x, p, t3) => a + ' asistió ' + cnt(c, 'vez', 'veces') + ' a ' + b + ' en ' + x + ', ' + cnt(p, 'punto', 'puntos') + ' en total' + (t3 ? ', todos de triple' : '')],
    ['for {X}, {X} and {X} connected {W} times, worth {W} points',
      (x, a, b, c, p) => 'en ' + x + ', ' + a + yy(b) + b + ' conectaron ' + cnt(c, 'vez', 'veces') + ', por valor de ' + cnt(p, 'punto', 'puntos')],
    ['{X} set up {W} of {X}{Z} {W} assisted baskets, finding {W} different scorers',
      (p, a, x, b, c) => p + ' repartió ' + n(a) + ' de las ' + n(b) + ' asistencias de ' + x + ', a ' + n(c) + ' anotadores distintos'],
    ['{X} scored {D} points off assists for {X}', (p, d, x) => p + ' anotó ' + stat('points', d) + ' tras asistencia con ' + x],
    /* who scored a side's points in transition, on second chances, off turnovers; the mid-range */
    ['{X} scored {W} of {X}{Z} {W} points {V}', (p, a, x, b, v) => p + ' anotó ' + n(a) + ' de los ' + n(b) + ' puntos de ' + x + ' ' + WHERE[v.toLowerCase()]],
    ['neither side found the mid-range: {X} made {W} of {W} from there, {X} {W} of {W}',
      (x, a, b, y, c, d) => 'ninguno de los dos encontró la media distancia: ' + x + ' anotó ' + n(a) + ' de ' + n(b) + ' desde ahí,' + yy(y) + y + ', ' + n(c) + ' de ' + n(d)],
    ['{X} could not buy a mid-range basket, {W} of {W} from there', (x, a, b) => sv(x, 'estuvo negado en la media distancia') + ': ' + n(a) + ' de ' + n(b) + ' desde ahí'],
    /* how long each side kept the ball, and what the early and the late shots were worth; the late one is often two
       sentences once the writer's reviser has split it ("…went past 17 seconds. They scored 0.43 a time there…") */
    ['{X} were the more patient side, taking {F} seconds a possession to {F} for {X}',
      (x, a, b, y) => sv(x, 'fue el equipo más paciente') + ': ' + a + ' segundos por posesión, por ' + b + ' de ' + (who(y) || y)],
    ['{X} used the clock: {F} seconds a possession, against {F} for {X}',
      (x, a, b, y) => sv(x, 'agotó más el reloj') + ': ' + a + ' segundos por posesión, frente a ' + b + ' de ' + (who(y) || y)],
    ['{X} were sharper early in the clock: in the first eight seconds they scored {F} points? a chance, {X} {F}',
      (x, a, y, b) => sv(x, 'estuvo más acertado al principio de la posesión') + ': en los primeros ocho segundos anotó ' + a + ' puntos por oportunidad, y ' + (who(y) || y) + ', ' + b],
    ['{X} ran the clock down and paid for it: {W} of their {W} chances went past {D} seconds(?:, and they scored {F} a time there against {F} overall)?',
      (x, a, b, s, c, e) => sv(x, 'apuró las posesiones y lo pagó') + ': ' + n(a) + ' de sus ' + n(b) + ' posesiones pasaron de los ' + s + ' segundos' +
        (c ? ', y en ellas anotó ' + c + ' puntos por posesión, frente a ' + e + ' en el global del partido' : '')],
    ['{X} scored {F} a time there against {F} overall', (x, a, b) => sv(x, 'en ellas anotó ' + a + ' puntos por posesión, frente a ' + b + ' en el global del partido')],

    /* ---- the performances ---- */
    ['{X} led {X} with (a season-high )?{D} points{T}(, a season high)?(, well clear of their usual)?(, a triple-double)?',
      /* "led the way", "led everyone" are not a club (the match writer's, below) */
      (p, x, sh, d, t, hi, up, td) => (/^(?:the way|everyone)$/i.test(x) ? null
        : sv(p, 'lideró a ' + x + ' con ' + line(d, t, sh)) + (hi ? ', su mejor marca de la temporada' : '') + (up ? ', muy por encima de su media' : '') + (td ? ', con triple-doble' : ''))],
    ['{X} top-scored for {X} with (a season-high )?{D}{T}(, a triple-double)?', (p, x, sh, d, t, td) => p + ' fue el máximo anotador de ' + x + ' con ' + line(d, t, sh) + (td ? ', con triple-doble' : '')],
    /* with a season high the player leads, so "su" is theirs and not the club's */
    ['{X} had (a season-high )?{D} points{T} from {X}(, a triple-double)?', (x, sh, d, t, p, td) => (sh ? p + ' firmó con ' + x + ' ' + line(d, t, sh)
      : x + ' contó con ' + line(d, t) + ' de ' + p) + (td ? ', con triple-doble' : '')],
    ['{X} answered with (a season-high )?{D}{T}(, a triple-double)? for {X}', (p, sh, d, t, td, x) => p + ' respondió con ' + line(d, t, sh) + (td ? ', con triple-doble' : '') + ' en ' + x],
    ['for {X}, {X} had (a season-high )?{D}{T}(, a triple-double)?', (x, p, sh, d, t, td) => 'en ' + x + ', ' + p + ' firmó ' + line(d, t, sh) + (td ? ', con triple-doble' : '')],
    ['{X} finished with (a season-high )?{D}{T}(, a triple-double)? for {X}', (p, sh, d, t, td, x) => p + ' terminó con ' + line(d, t, sh) + (td ? ', con triple-doble' : '') + ' en ' + x],
    ['{X} had a triple-double for {X}: (.+)', (p, x, l) => {
      const parts = l.split(/, | and /).map(s => { const m = /^(\d+) (points|rebounds|assists|steals|blocks)$/i.exec(s); return m ? stat(m[2].toLowerCase(), m[1]) : null; });
      return parts.indexOf(null) >= 0 ? null : p + ' firmó un triple-doble en ' + x + ': ' + list(parts);
    }],
    ['(.+?)(, well up on (?:his|their) usual)?', (s, up) => {
      /* "A added 14 and B 12 for X": "en X, A aportó 14 puntos y B, 12" (a season high carries its note) */
      const HI = ' (su máxima anotación de la temporada)';
      const one = t => { let m = rx('{N} added (a season-high )?{D}').exec(t); if (m) return m[1] + ' aportó ' + stat('points', m[3]) + (m[2] ? HI : ''); m = rx('{N} (a season-high )?{D}').exec(t); return m ? m[1] + ', ' + m[3] + (m[2] ? HI : '') : null; };
      if (!/ added (?:a season-high )?\d/.test(s)) return null;
      const cs = byClub(s, one);
      return cs && clubs(cs) + (up ? ', muy por encima de su media' : '');
    }],
    ['(.+)', s => { const cs = byClub(s, t => first(DEED, t)); return cs && clubs(cs); }],
    ['(.+)', s => { const cs = byClub(s, t => first(SPECIAL, t)); return cs && clubs(cs); }],
    ['it was a long night for (.+?)(?:, and for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : null; return x && (!b || y) ? 'fue una noche larga para ' + x.t + (y ? ', y también para ' + y.t : '') : null; }],
    ['little went right for (.+?)(?:, or for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : null; return x && (!b || y) ? 'nada funcionó para ' + x.t + (y ? ', ni para ' + y.t : '') : null; }],
    ['(.+?) never got going(?:, and neither did (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : null; return x && (!b || y) ? x.t + ' no ' + (x.many ? 'llegaron' : 'llegó') + ' a entrar en el partido' + (y ? ', y tampoco ' + y.t : '') : null; }],
    ['{X} lost {L} to fouls(?:, and {X} lost {L} the same way)?', (x, a, y, b) => x + ' perdió a ' + names(a) + ' por faltas' + (y ? ',' + yy(y) + y + ' perdió a ' + names(b) + ' de la misma manera' : '')],
    /* the night against the season: the league's best, a season high, a run of big nights, a return, a milestone, and
       box plus-minus's player of the game (the stat's own name, as the advanced stats keep theirs) */
    ['{X}’s? {D} (points|rebounds|assists|steals|blocks|threes)(?: for {X})? (were|equalled) the most by anyone in a game in this league this season',
      (p, d, k, x, e) => los(k) + ' ' + stat(k.toLowerCase(), d) + ' de ' + p + (x ? ' con ' + x : '') + (/^equalled$/i.test(e) ? ' igualaron' : ' fueron') + ' la mejor marca individual de la temporada en esta liga'],
    ['{X} matched their season high of {D} (points|rebounds|assists|steals|blocks|threes) for {X}', (p, d, k, x) => p + ' igualó con ' + x + ' su mejor marca de la temporada: ' + stat(k.toLowerCase(), d)],
    ['{X}’s? {D} (points|rebounds|assists|steals|blocks|threes) for {X} were a season high, {W} more than their best before',
      (p, d, k, x, w) => los(k) + ' ' + stat(k.toLowerCase(), d) + ' de ' + p + ' con ' + x + ' fueron su mejor marca de la temporada, ' + n(w) + ' más que su máximo anterior'],
    ['{X} has now scored 20 or more in {W} straight games for {X}', (p, w, x) => p + ' encadena ya ' + n(w) + ' partidos seguidos de 20 o más puntos con ' + x],
    ['{X} was back for {X} after missing {W} games, and played {W} minutes',
      (p, x, a, b) => p + ' reapareció con ' + x + ' tras perderse ' + cnt(a, 'partido', 'partidos') + ' y jugó ' + cnt(b, 'minuto', 'minutos')],
    ['{X}’s? points took their season total past {D} for {X}', (p, d, x) => p + ' ya suma más de ' + d + ' puntos esta temporada con ' + x],
    ['by box plus-minus the best game on the floor was {X}’s? for {X}, ([+-]?\\d+(?:\\.\\d+)?)', (p, x, v) => 'según el box plus-minus, el mejor partido en pista fue el de ' + p + ', de ' + x + ', con un ' + v],
    ['{X}’s? game for {X} (?:was|were) the best on the floor by box plus-minus, ([+-]?\\d+(?:\\.\\d+)?)', (p, x, v) => 'el partido de ' + p + ' con ' + x + ' fue el mejor en pista según el box plus-minus: ' + v],
    ['box plus-minus rates {X} of {X} as the best player on the floor, at ([+-]?\\d+(?:\\.\\d+)?)', (p, x, v) => 'según el box plus-minus, ' + p + ', de ' + x + ', fue quien mejor jugó sobre la pista, con un ' + v],

    /* ---- the scout's note ---- */
    ['{X} won this on (.+?) (before anything else|above all): they were {Q} there, {X} {Q}',
      (x, l, b, q, y, r) => lab(l) && x + ' ganó este partido ' + (/above/i.test(b) ? 'sobre todo' : 'ante todo') + ' en ' + lab(l) + ': estuvo ' + pct(q) + ', mientras que ' + y + ' estuvo ' + pct(r)],
    ['(.+?) was where {X} won it: they were {Q} there, {X} {Q}',
      (l, x, q, y, r) => lab(l) && 'fue en ' + lab(l) + ' donde ' + x + ' ganó el partido: estuvo ' + pct(q) + ', mientras que ' + y + ' estuvo ' + pct(r)],
    ['{X} have had the better of (.+?) more than anything: they have been {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && x + ' domina sobre todo en ' + lab(l) + ': está ' + pct(q) + ', mientras que ' + y + ' está ' + pct(r)],
    ['the widest gap between them was (.+?), and it went {X}{Z} way — they were {Q} there, {X} {Q} — but it was not enough',
      (l, x, q, y, r) => lab(l) && 'la mayor diferencia entre ambos estuvo en ' + lab(l) + ', y fue para ' + x + ': estuvo ' + pct(q) + ', mientras que ' + y + ' estuvo ' + pct(r) + ', pero no le bastó'],
    ['the widest gap so far is (.+?), and it favours {X}(, who trail)?: they have been {Q} there, {X} {Q}',
      (l, x, tr, q, y, r) => lab(l) && 'la mayor diferencia hasta ahora está en ' + lab(l) + ', y favorece a ' + x + (tr ? ', que va por detrás' : '') + ': está ' + pct(q) + ', mientras que ' + y + ' está ' + pct(r)],
    /* the same two, split in two by the writer's reviser at their ", and" */
    ['the widest gap (between them was|so far is) (.+?)', (t, l) => lab(l) && 'la mayor diferencia ' + (/so far/i.test(t) ? 'hasta ahora está en ' : 'entre ambos estuvo en ') + lab(l)],
    ['it went {X}{Z} way — they were {Q} there, {X} {Q} — but it was not enough',
      (x, q, y, r) => 'cayó del lado de ' + x + ': estuvo ' + pct(q) + ', mientras que ' + y + ' estuvo ' + pct(r) + ', pero no le bastó'],
    ['it favours {X}(, who trail)?: they have been {Q} there, {X} {Q}',
      (x, tr, q, y, r) => 'favorece a ' + x + (tr ? ', que va por detrás' : '') + ': está ' + pct(q) + ', mientras que ' + y + ' está ' + pct(r)],
    ['(the other gaps worth the film room|the other gaps to watch after the break|two more for the film room|further down the list): (.+)', (w, l) => {
      const it = l.split(/\) and /).map((s, i, a) => (i < a.length - 1 ? s + ')' : s)).map(s => {
        const m = /^(.+?) \((.*?), (\d+) percentile points (?:clear|ahead)\)$/.exec(s);
        return m && lab(m[1]) ? lab(m[1]) + ' (' + (m[2] || '—') + ', ' + m[3] + ' puntos de percentil de ventaja)' : null;
      });
      const open = { 'the other gaps worth the film room': 'otras diferencias para la sala de vídeo: ', 'the other gaps to watch after the break': 'otras diferencias a vigilar tras el descanso: ',
        'two more for the film room': 'dos más para la sala de vídeo: ', 'further down the list': 'más abajo en la lista: ' }[w.toLowerCase()];
      return it.indexOf(null) >= 0 ? null : open + list(it);
    }],
    ['{X} (came out ahead|are ahead) on (.+?), and with no league scales built for this competition yet those are the two sides against each other rather than against anybody else',
      (x, t, l) => labs(l) && x + (/came/i.test(t) ? ' salió por delante en ' : ' va por delante en ') + labs(l) + '; como aún no hay escalas de liga para esta competición, es una comparación entre los dos equipos y no con el resto'],
    ['{X} (had|have had) the better of (.+?) — (?:the part of their game that did not cost them|something to build on after the break)',
      (x, t, l) => labs(l) && x + (/^had$/i.test(t) ? ' fue mejor en ' + labs(l) + ': la parte de su juego que no le costó el partido' : ' está siendo mejor en ' + labs(l) + ': algo sobre lo que construir tras el descanso')],
    /* the same comparison as the writer now puts it, the caveat a sentence of its own */
    ['{X} (came out ahead|are ahead) on (.+?)', (x, t, l) => labs(l) && sv(x, (/came/i.test(t) ? 'salió por delante en ' : 'va por delante en ') + labs(l))],
    ['there is no league scale for this competition yet, so that is a comparison of the two sides with each other',
      () => 'aún no hay escala de liga para esta competición, así que es una comparación entre los dos equipos'],
    ['{X} (had|have had) the better of (.+?), (?:which is where they can take some credit|something to build on after the break)',
      (x, t, l) => labs(l) && sv(x, /^had$/i.test(t) ? 'fue mejor en ' + labs(l) + ', y ahí puede sacar algo positivo' : 'está siendo mejor en ' + labs(l) + ', algo sobre lo que construir tras el descanso')],
    ['{X} (?:did their best work|are doing their best work) on (.+?), where they (were|have been) {Q}(?:, with (.+?) not far behind)?',
      (x, l, t, q, r) => lab(l) && (!r || labs(r)) && 'lo mejor de ' + x + (/^were$/i.test(t) ? ' estuvo en ' : ' está en ') + lab(l) + ', donde ' + (/^were$/i.test(t) ? 'estuvo ' : 'está ') + pct(q) + (r ? ', con ' + labs(r) + ' no muy lejos' : '')],
    ['what they will (?:still want back|want to tighten) starts with (.+?), where they (were|have been) {Q}(?:; (.+?) (?:lagged too|are lagging too))?',
      (l, t, q, r) => lab(l) && (!r || labs(r)) && 'lo que ' + (/^were$/i.test(t) ? 'querrá recuperar' : 'querrá ajustar') + ' empieza por ' + lab(l) + ', donde ' + (/^were$/i.test(t) ? 'estuvo ' : 'está ') + pct(q) +
        (r ? '; ' + labs(r) + ' también ' + (/^were$/i.test(t) ? (many(labs(r)) ? 'se quedaron' : 'se quedó') : (many(labs(r)) ? 'se están' : 'se está') + ' quedando') + ' atrás' : '')],
    /* each side's best and worst, three ways into each (2026-10-07) */
    ['(.+?) (?:was|were) {X}{Z} strongest suit: they were {Q} there(?:, with (.+?) not far behind)?',
      (l, x, q, r) => lab(l) && (!r || labs(r)) && lab(l) + (many(lab(l)) ? ' fueron' : ' fue') + ' el punto fuerte de ' + x + ': ahí estuvo ' + pct(q) + (r ? ', con ' + labs(r) + ' no muy lejos' : '')],
    /* two more ways into each side's best and worst (2026-10-08): five a side, picked by the game */
    ['for {X}, the high point was (.+?): they were {Q} there(?:, with (.+?) not far behind)?',
      (x, l, q, r) => lab(l) && (!r || labs(r)) && 'para ' + x + ', lo mejor ' + (many(lab(l)) ? 'fueron ' : 'fue ') + lab(l) + ': estuvo ' + pct(q) + (r ? ', con ' + labs(r) + ' no muy lejos' : '')],
    ['{X} did nothing better than (.+?): they were {Q} there(?:, with (.+?) not far behind)?',
      (x, l, q, r) => lab(l) && (!r || labs(r)) && sv(x, 'no hizo nada mejor que ' + lab(l)) + ': estuvo ' + pct(q) + (r ? ', con ' + labs(r) + ' no muy lejos' : '')],
    ['(.+?) held them back: they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => lab(l) && (!r || labs(r)) && lab(l) + (many(lab(l)) ? ' le lastraron' : ' le lastró') + ': ahí estuvo ' + pct(q) + (r ? '; ' + lagged(labs(r)) : '')],
    ['the trouble was (.+?): they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => lab(l) && (!r || labs(r)) && 'el problema ' + (many(lab(l)) ? 'fueron ' : 'fue ') + lab(l) + ': estuvo ' + pct(q) + (r ? '; ' + lagged(labs(r)) : '')],
    ['{X} were at their best on (.+?): they were {Q} there(?:, with (.+?) close behind)?',
      (x, l, q, r) => lab(l) && (!r || labs(r)) && sv(x, 'dio lo mejor de sí en ' + lab(l)) + ': estuvo ' + pct(q) + (r ? ', con ' + labs(r) + ' muy cerca' : '')],
    ['nothing went better for {X} than (.+?): they were {Q} there(?:, with (.+?) not far behind)?',
      (x, l, q, r) => lab(l) && (!r || labs(r)) && 'nada le salió mejor a ' + x + ' que ' + lab(l) + ': estuvo ' + pct(q) + (r ? ', con ' + labs(r) + ' no muy lejos' : '')],
    ['the weak spot was (.+?), where they were {Q}(?:; (.+?) lagged too)?',
      (l, q, r) => lab(l) && (!r || labs(r)) && 'el punto débil fue ' + lab(l) + ', donde estuvo ' + pct(q) + (r ? '; ' + lagged(labs(r)) : '')],
    ['(.+?) let them down: they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => lab(l) && (!r || labs(r)) && lab(l) + (many(lab(l)) ? ' le fallaron' : ' le falló') + ': ahí estuvo ' + pct(q) + (r ? '; ' + lagged(labs(r)) : '')],
    ['where they came up short was (.+?): they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => lab(l) && (!r || labs(r)) && 'donde más flojeó fue en ' + lab(l) + ': estuvo ' + pct(q) + (r ? '; ' + lagged(labs(r)) : '')],
    ['{X} (also struggled|are also struggling) with (.+?)', (x, t, l) => labs(l) && sv(x, (/struggled/i.test(t) ? 'también sufrió en ' : 'también está sufriendo en ') + labs(l))],
    ['{X} had trouble with (.+?) too', (x, l) => labs(l) && sv(x, 'también tuvo problemas con ' + labs(l))],
    ['{X} fell short on (.+?) as well', (x, l) => labs(l) && sv(x, 'también flojeó en ' + labs(l))],
    /* the closing line's ending is cut by the writer's reviser when an earlier sentence said the same, and its third
       ending can be split off as a sentence of its own ("Nothing else in their game sat further behind the league.") */
    ['if there is one thing to take into the week, it is (.+?): {X} were {Q} there(?:, (' + alt(TAKE) + '))?',
      (l, y, q, k) => lab(l) && 'si hay algo que llevarse a la semana de trabajo, ' + (many(lab(l)) ? 'son ' : 'es ') + lab(l) + ': ' + y + ' estuvo ' + pct(q) + (k ? ', ' + TAKE[k.toLowerCase()] : '')],
    ['the one thing for {X} to take into the week is (.+?): they were {Q} there(?:, (' + alt(TAKE) + '))?',
      (y, l, q, k) => lab(l) && 'lo que ' + y + ' debe llevarse a la semana de trabajo ' + (many(lab(l)) ? 'son ' : 'es ') + lab(l) + ': estuvo ' + pct(q) + (k ? ', ' + TAKE[k.toLowerCase()] : '')],
    ['the monday work for {X} starts with (.+?): they were {Q} there(?:, (' + alt(TAKE) + '))?',
      (y, l, q, k) => lab(l) && 'el trabajo del lunes para ' + y + ' empieza por ' + lab(l) + ': estuvo ' + pct(q) + (k ? ', ' + TAKE[k.toLowerCase()] : '')],
    ['nothing else in their game sat further behind the league', () => 'nada en su juego quedó más por detrás de la liga'],
    ['the one thing to fix at the break is (.+?): {X} have been {Q} there(, further behind the league than anything else in their game)?',
      (l, y, q, k) => lab(l) && 'lo que hay que corregir en el descanso ' + (many(lab(l)) ? 'son ' : 'es ') + lab(l) + ': ' + y + ' está ' + pct(q) + (k ? ', más por detrás de la liga que en cualquier otro aspecto de su juego' : '')],
    /* "…; the defensive glass and free throws lagged too", split off at its semicolon */
    ['(.+?) lagged too', l => labs(l) && lagged(labs(l))],
    ['(.+?) are lagging too', l => labs(l) && labs(l) + ' también se ' + (many(labs(l)) ? 'están' : 'está') + ' quedando atrás'],

    /* ---- the half-time report ---- */
    ['{X} had the best spell of the half, an? {D}–0 run in the {O}', (x, d, o) => sv(x, 'firmó el mejor tramo de la primera parte') + ', un parcial de ' + sc(d, 0) + ' en ' + ord(o)],
    ['{X} have led by as many as {D}(, and have given most of it back|, and all of it has gone)?',
      (x, d, t) => sv(x, 'ha llegado a tener ' + d + ' puntos de ventaja') + (!t ? '' : /most/i.test(t) ? ', pero ha devuelto la mayor parte' : ', pero la ha perdido por completo')],
    ['the lead has already changed hands {D} times', d => 'el liderato ya ha cambiado de manos ' + d + ' ' + pl(d, 'vez', 'veces')],
    ['{X} are shooting {D}% from the field to {D}%', (x, a, b) => sv(x, 'tira con un ' + a + '% en tiros de campo') + ', por el ' + b + '% del rival'],
    ['{X} are the sharper side, {F}% eFG to {F}%', (x, a, b) => sv(x, 'está más acertado') + ': ' + a + '% de eFG% frente a ' + b + '%'],
    ['{X} are looking after the ball, turning it over on {F}% of possessions to {F}%', (x, a, b) => sv(x, 'está cuidando el balón') + ': lo pierde en el ' + a + '% de sus posesiones, frente al ' + b + '%'],
    ['{X} own the offensive glass so far, getting {F}% of their misses back to {F}%', (x, a, b) => sv(x, 'domina el rebote ofensivo hasta ahora') + ': recupera el ' + a + '% de sus fallos, frente al ' + b + '%'],
    ['{X} are living at the line, {D} free throws per hundred shots to {D}', (x, a, b) => sv(x, 'vive en la línea de tiros libres') + ': ' + a + ' tiros libres por cada cien tiros, frente a ' + b],
    ['(.+ has \\d+ for .+)', s => {
      const one = rx('{N} has {D} for {N}(?: on {W} of {W} shooting)?{T}(?:, with {N} on {D})?');
      const out = s.split('; ').map(p => {
        const m = one.exec(p);
        if (!m) return null;
        return m[1] + ' lleva ' + line(m[2], m[6]) + (m[4] ? ' con ' + n(m[4]) + ' de ' + n(m[5]) + ' en tiros de campo' : '') + ' en ' + m[3] + (m[7] ? ', con ' + m[7] + ' en ' + m[8] : '');
      });
      return out.indexOf(null) >= 0 ? null : out.join('; ');
    }],
    ['foul trouble to watch: (.+?)(, among others)?', (l, more) => {
      const it = items(l, t => { const m = rx('{N} of {N} with {W}').exec(t); return m ? m[1] + ' (' + m[2] + ') con ' + n(m[3]) : null; });
      return it && 'problemas de faltas a vigilar: ' + list(it) + (more ? ', entre otros' : '');
    }],
    ['twenty minutes in there is nothing between them: {X} took the first quarter {S} and {X} answered with the second, {S}',
      (x, a, b, y, c, d) => 'tras veinte minutos no hay nada entre ambos: ' + x + ' se llevó el primer cuarto (' + sc(a, b) + ')' + yy(y) + y + ' respondió en el segundo (' + sc(c, d) + ')'],
    ['twenty minutes in there is nothing between them', () => 'tras veinte minutos no hay nada entre ambos'],
    ['{X} have won both quarters, {S} and {S}', (x, a, b, c, d) => x + ' ha ganado los dos cuartos, ' + sc(a, b) + ' y ' + sc(c, d)],
    ['{X} (were level|trailed) after one and took over in the second, winning it {S}',
      (x, t, a, b) => x + ' terminó el primer cuarto ' + (/level/i.test(t) ? 'igualado' : 'por detrás') + ' y tomó el mando en el segundo, que ganó por ' + sc(a, b)],
    ['{X} built the lead in the first quarter, {S}, and {X} have been chipping at it since',
      (x, a, b, y) => x + ' construyó su ventaja en el primer cuarto (' + sc(a, b) + '), y desde entonces ' + y + ' la ha ido recortando'],
    ['{X} built the lead in the first quarter, {S}, and have held on to it since', (x, a, b) => x + ' construyó su ventaja en el primer cuarto (' + sc(a, b) + ') y la ha mantenido desde entonces'],
    ['{X} lead by {D}', (x, d) => x + ' gana de ' + d],

    /* ---- the headline and the standfirst ---- */
    /* the season around it and the moment, when it is the biggest thing about the night (2026-10-07); before the plain
       "beat", which would leave "Underdogs" in English */
    ['{X} hand {X} their first defeat of the season', (x, y) => x + ' le endosa a ' + y + ' su primera derrota de la temporada'],
    ['{X} go top with {S} win over {X}', (x, a, b, y) => x + ' gana a ' + y + ' (' + sc(a, b) + ') y se pone líder'],
    ['{X} stun {X} {S}', (x, y, a, b) => x + ' da la sorpresa ante ' + y + ' (' + sc(a, b) + ')'],
    ['{X} end {X}{Z} {D}-game winning run', (x, y, d) => x + ' corta la racha de ' + d + ' victorias de ' + y],
    ['{X} end {D}-game losing run against {X}', (x, d, y) => x + ' rompe su racha de ' + d + ' derrotas ante ' + y],
    ['{X} off the mark at last against {X}', (x, y) => x + ' estrena por fin su casillero de victorias ante ' + y],
    ['{X} make it {D} straight with {S} win over {X}', (x, d, a, b, y) => x + ' suma ' + d + ' victorias seguidas tras ganar a ' + y + ' (' + sc(a, b) + ')'],
    ['{X} stay perfect with {S} win over {X}', (x, a, b, y) => x + ' sigue invicto tras ganar a ' + y + ' (' + sc(a, b) + ')'],
    ['underdogs {X} beat {X} {S}', (x, y, a, b) => x + ' gana contra pronóstico a ' + y + ' (' + sc(a, b) + ')'],
    ['{X}’s? league season-best {D} carries {X} past {X}', (p, d, x, y) => 'los ' + d + ' puntos de ' + p + ', máxima anotación de la liga esta temporada, dan a ' + x + ' la victoria ante ' + y],
    ['{X}’s? league season-best {D} is not enough for {X}', (p, d, x) => 'los ' + d + ' puntos de ' + p + ', máxima anotación de la liga esta temporada, no le bastan a ' + x],
    ['{X} wins it for {X} at the death against {X}', (p, x, y) => p + ' da la victoria a ' + x + ' en el último suspiro ante ' + y],
    ['(.+?) alone (was|were) worth {D} points? to {X}', (l, v, d, x) => { const f = fac(l); return f && 'solo ' + f + ' ya le ' + (many(f) ? 'valieron ' : 'valió ') + stat('points', d) + ' a ' + x; }],
    /* a run, a stat or a night, when it is the sharpest thing the game did (the lede's angles): headline, then standfirst */
    ['{X} blow it open with an? {D}–0 run to beat {X}', (x, d, y) => x + ' rompe el partido con un parcial de ' + sc(d, 0) + ' y gana a ' + y],
    ['{X} beat {X} {S} after an? {D}–0 run in the {O}', (x, y, a, b, d, o) => x + ' gana a ' + y + ' (' + sc(a, b) + ') tras un parcial de ' + sc(d, 0) + ' en ' + ord(o)],
    ['{X} win the boards {S} to beat {X}', (x, a, b, y) => x + ' gana la batalla del rebote (' + sc(a, b) + ') y se impone a ' + y],
    ['{X} own the paint, {S}, to beat {X}', (x, a, b, y) => x + ' domina la zona (' + sc(a, b) + ') y gana a ' + y],
    ['{X} run {X} ragged, {D} fast-break points to {D}', (x, y, a, b) => x + ' pasa por encima de ' + y + ' al contraataque (' + a + ' puntos por ' + b + ')'],
    ['{X} lean on an? {S} bench edge to beat {X}', (x, a, b, y) => x + ' se apoya en su banquillo (' + sc(a, b) + ') para ganar a ' + y],
    ['{X} score {D} points off turnovers to beat {X}', (x, d, y) => x + ' castiga las pérdidas con ' + d + ' puntos y gana a ' + y],
    ['{X} live off second chances, {S}, to beat {X}', (x, a, b, y) => x + ' vive de las segundas oportunidades (' + sc(a, b) + ') y gana a ' + y],
    ['{X} hit {D} threes to beat {X}', (x, d, y) => x + ' gana a ' + y + ' con ' + d + ' triples'],
    ['{X} pick {X} clean, {D} steals to {D}', (x, y, a, b) => x + ' le roba la cartera a ' + y + ': ' + a + ' recuperaciones por ' + b],
    ['{X} share it, {D} assists to {D}, to beat {X}', (x, a, b, y) => x + ' reparte el juego (' + a + ' asistencias por ' + b + ') y gana a ' + y],
    ['{X} out-shoot {X} {D}% to {D}% eFG', (x, y, a, b) => x + ' supera en el tiro a ' + y + ' (' + a + '% a ' + b + '% de eFG%)'],
    ['{X} posts a triple-double in defeat for {X}', (p, x) => 'el triple-doble de ' + p + ' no evita la derrota de ' + x],
    ['{X} scores {D} as {X} beat {X}', (p, d, x, y) => p + ' anota ' + d + ' puntos y ' + x + ' gana a ' + y],
    ['{X} hits {D} to lift {X} past {X}', (p, d, x, y) => p + ' anota ' + d + ' puntos y da a ' + x + ' la victoria ante ' + y],
    ['{X}{Z} {D} is not enough for {X}', (p, d, x) => 'los ' + d + ' puntos de ' + p + ' no le bastan a ' + x],
    ['{X} outscored them {S} in the paint', (x, a, b) => sv(x, 'se impuso en la zona por ' + sc(a, b))],
    ['{X}{Z} bench outscored theirs {S}', (x, a, b) => 'el banquillo de ' + x + ' superó al banquillo rival por ' + sc(a, b)],
    ['{X} scored {D} points off turnovers to {D}', (x, a, b) => sv(x, 'anotó ' + stat('points', a) + ' tras pérdida, por ' + b + ' del rival')],
    ['{X} took the second chances {S}', (x, a, b) => sv(x, 'ganó la batalla de las segundas oportunidades por ' + sc(a, b))],
    ['{X} made {D} threes to {D}', (x, a, b) => sv(x, 'anotó ' + stat('threes', a) + ', por ' + b + ' del rival')],
    ['{X} had {D} (steals|assists) to {D}', (x, a, k, b) => sv(x, (/^steals$/i.test(k) ? 'firmó ' : 'repartió ') + stat(k.toLowerCase(), a) + ', por ' + b + ' del rival')],
    ['{X} shot {D}% eFG to {D}%', (x, a, b) => sv(x, 'tiró con un ' + a + '% de eFG%, por el ' + b + '% del rival')],
    ['{X} had a triple-double for {X}', (p, x) => p + ' firmó un triple-doble con ' + x],
    ['{X} scored {D} (for|in defeat for) {X}(?: on {W} of {W} shooting)?(?:, adding (.+))?', (p, d, k, x, a, b, l) => {
      const add = l ? l.split(/, and |, | and /).map(s => { const m = new RegExp('^(' + WORDS + ') (rebounds|assists|steals|blocks)$', 'i').exec(s); return m ? stat(m[2].toLowerCase(), n(m[1])) : null; }) : [];
      if (add.indexOf(null) >= 0) return null;
      return p + ' anotó ' + stat('points', d) + (/defeat/i.test(k) ? ' en la derrota de ' : ' con ') + x + (a ? ', con ' + n(a) + ' de ' + n(b) + ' en tiros de campo' : '') + (add.length ? ', y sumó ' + list(add) : '');
    }],
    ['{X} and {X} level at {S} at the half', (x, y, a, b) => x + yy(y) + y + ' llegan igualados al descanso (' + sc(a, b) + ')'],
    ['{X} edge {X} {S} at the break', (x, y, a, b) => x + ' manda por la mínima ante ' + y + ' al descanso (' + sc(a, b) + ')'],
    ['{X} lead {X} by {D} at the half', (x, y, d) => x + ' aventaja en ' + d + ' puntos a ' + y + ' al descanso'],
    ['{X} lead {X} {S} at the half', (x, y, a, b) => x + ' gana a ' + y + ' al descanso (' + sc(a, b) + ')'],
    ['{X} and {X} tie {S}', (x, y, a, b) => x + yy(y) + y + ' empatan (' + sc(a, b) + ')'],
    ['{X} outlast {X} in overtime, {S}', (x, y, a, b) => x + ' supera a ' + y + ' en la prórroga (' + sc(a, b) + ')'],
    ['{X} steal it late from {X}, {S}', (x, y, a, b) => x + ' le arrebata el triunfo a ' + y + ' en el final (' + sc(a, b) + ')'],
    ['{X} overturn {D} to beat {X}', (x, d, y) => x + ' remonta ' + d + ' puntos y gana a ' + y],
    ['{X} come from behind to beat {X} {S}', (x, y, a, b) => x + ' remonta y gana a ' + y + ' (' + sc(a, b) + ')'],
    ['{X} pull away late from {X}, {S}', (x, y, a, b) => x + ' se escapa al final ante ' + y + ' (' + sc(a, b) + ')'],
    ['{X}’s? triple-double carries {X}', (p, x) => 'el triple-doble de ' + p + ' lleva a ' + x + ' a la victoria'],
    ['{X} overwhelm {X}, {S}', (x, y, a, b) => x + ' arrolla a ' + y + ' (' + sc(a, b) + ')'],
    ['{X} edge {X} {S}', (x, y, a, b) => x + ' gana por la mínima a ' + y + ' (' + sc(a, b) + ')'],
    ['{X}’s? {D} sees off {X}', (p, d, y) => 'los ' + d + ' puntos de ' + p + ' tumban a ' + y],
    ['{X} beat {X} {S}', (x, y, a, b) => (/^(on|at|in front of) /i.test(x) ? null : x + ' gana a ' + y + ' (' + sc(a, b) + ')')],
    ['an? {D}–0 run in the {O} settled it', (d, o) => 'un parcial de ' + sc(d, 0) + ' en ' + ord(o) + ' decidió el partido'],
    ['an? {M} stretch swung it by {D}', (m, d) => 'un tramo de ' + m + ' inclinó el partido por ' + stat('points', d)],
    /* the run or the stretch of the side that lost (2026-10-08): it settled nothing */
    ['{X}{Z} {D}–0 run in the {O} was not enough', (x, d, o) => 'a ' + x + ' no le bastó su parcial de ' + sc(d, 0) + ' en ' + ord(o)],
    ['an? {M} stretch worth {D} to {X} was not enough', (m, d, x) => 'a ' + x + ' no le bastó un tramo de ' + m + ' en el que sacó ' + stat('points', d) + ' de ventaja'],
    ['the shooting went {X}{Z} way, {F}% eFG to {F}%', (x, a, b) => 'el tiro fue para ' + x + ': ' + a + '% de eFG% frente a ' + b + '%'],
    ['possessions decided it: {F}% turnover rate for {X}, {F}% against', (a, x, b) => 'las posesiones decidieron: ' + a + '% de pérdidas para ' + x + ', ' + b + '% para su rival'],
    ['the offensive glass belonged to {X}, {F}% to {F}%', (x, a, b) => 'el rebote ofensivo fue de ' + x + ': ' + a + '% frente a ' + b + '%'],
    ['the whistle sent {X} to the line far more often', x => x + ' fue mucho más a menudo a la línea de tiros libres'],
    ['{X} were {D} down with five minutes left', (x, d) => x + ' perdía de ' + d + ' a falta de cinco minutos'],
    ['a {D}-point lead with five to play nearly went', d => 'una ventaja de ' + stat('points', d) + ' a falta de cinco minutos estuvo a punto de esfumarse'],
    ['it was {S} with five minutes left, and then it was not', (a, b) => 'a falta de cinco minutos iba ' + sc(a, b) + ', y de ahí en adelante dejó de haber partido'],
    ['it was {S} with five to play', (a, b) => 'a falta de cinco minutos iba ' + sc(a, b)],
    ['{X} trailed by {D} at the break and won the second half by {D}', (x, d, e) => x + ' perdía de ' + d + ' al descanso y ganó la segunda parte por ' + e],
    ['it stayed tight throughout', () => 'el partido estuvo igualado de principio a fin'],
    ['a {D}-point margin', d => 'una diferencia de ' + stat('points', d)],
    ['full time', () => 'final del partido'],

    /* ---- the preview ---- */
    /* the matchup, valued (2026-10-07): where they stand and how they come in, what the season's numbers expect, the lean
       and what argues against it, who carries the form; the table, the runs and the meetings are the report's own rules */
    ['{K} against {K}: {X} \\({S}\\) host {X} \\({S}\\)', (a, b, x, s1, s2, y, s3, s4) => 'el ' + ordes(a) + ' contra el ' + ordes(b) + ': ' + x + ' (' + sc(s1, s2) + ') recibe a ' + y + ' (' + sc(s3, s4) + ')'],
    ['{X} are unbeaten in {W}', (x, w) => sv(x, 'no conoce la derrota en ' + cnt(w, 'partido', 'partidos'))],
    ['{X} are still without a win in {W}', (x, w) => sv(x, 'sigue sin ganar tras ' + cnt(w, 'partido', 'partidos'))],
    ['{X} have lost their last {W}', (x, w) => sv(x, Number(n(w)) === 1 ? 'perdió su último partido' : 'ha perdido sus ' + n(w) + ' últimos partidos')],
    ['neither has lost yet', () => 'ninguno de los dos ha perdido todavía'],
    ['{X} have won {W} of their last five; {X} {W}', (x, a, y, b) => sv(x, 'ha ganado ' + n(a) + ' de sus últimos cinco partidos') + '; ' + y + ', ' + (Number(n(b)) === 0 ? 'ninguno' : n(b))],
    ['{X} won the only meeting so far, {S}(?:, with {D} from {X})?', (x, a, b, d, p) => sv(x, 'ganó el único precedente de la temporada') + ' (' + sc(a, b) + ')' + (d ? ', con ' + stat('points', d) + ' de ' + p : '')],
    /* how each comes in (2026-10-08): its last game, said "llega tras ganar…" or, for the second of two, "en su último
       partido, … ganó…"; a run's latest game; the two meeting last time out; home and away; close games */
    ['{X} come in off an? {S} (home win|win|home defeat|defeat)(?: (?:over|at|to) {X}| away from home)?' + CARRY(','),
      (x, a, b, what, y, k, d, e, s, p) => {
        const won = /win/i.test(what), home = /home/i.test(what);
        const where = home ? (y ? (won ? ' en casa a ' : ' en casa ante ') + y : ' en casa') : (y ? ' en la pista de ' + y : ' a domicilio');
        return sv(x, 'llega tras ' + (won ? 'ganar' : 'perder') + where + ' por ' + sc(a, b)) + carry(k, d, e, s, p);
      }],
    ['{X} (beat {X}|won|lost) {S} (at home to .+?|at home|at .+?|away) last time out' + CARRY(','), (x, v, y, a, b, w, k, d, e, s, p) => {
      const u = ubi(w);
      return u && 'en su último partido, ' + sv(x, (/^lost$/i.test(v) ? 'perdió' : 'ganó') + (y ? ' en casa a ' + y : u) + ' por ' + sc(a, b)) + carry(k, d, e, s, p);
    }],
    /* a run and its latest game: "…, la última por 90-60 en la pista de X" (a run of wins), "el último" (of games) */
    ['(.+?), the latest {S} (at home to .+?|at home|at .+?|away)' + CARRY(''), (r, a, b, w, k, d, e, s, p) => {
      const t = first(COMPILED, r), u = ubi(w);
      return t && u && t + ', ' + (/ won .+ straight$/i.test(r) ? 'la última' : 'el último') + ' por ' + sc(a, b) + u + carry(k, d, e, s, p);
    }],
    ['they met last time out, {X} winning {S} (at home|away)' + CARRY(''),
      (x, a, b, w, k, d, e, s, p) => 'los dos se enfrentaron en su último partido: ' + sv(x, 'ganó por ' + sc(a, b) + ' ' + HA[w.toLowerCase()]) + carry(k, d, e, s, p)],
    ['{X} have (won|lost) all {W} (at home|on the road)', (x, k, w, h) => sv(x, 'ha ' + (/won/i.test(k) ? 'ganado' : 'perdido') + ' sus ' + n(w) + ' partidos ' + HA[h.toLowerCase()])],
    ['{X} are {S} (at home|on the road|away) and {S} (at home|on the road|away)',
      (x, a, b, h, c, d, h2) => sv(x, 'tiene un balance de ' + sc(a, b) + ' ' + HA[h.toLowerCase()] + ' y de ' + sc(c, d) + ' ' + HA[h2.toLowerCase()])],
    ['in games decided by five points or fewer, {X} are {S} and {X} {S}',
      (x, a, b, y, c, d) => 'en los partidos decididos por cinco puntos o menos, ' + x + ' tiene un balance de ' + sc(a, b) + yy(y) + y + ', de ' + sc(c, d)],
    ['{X} are {S} in games decided by five points or fewer', (x, a, b) => sv(x, 'tiene un balance de ' + sc(a, b) + ' en los partidos decididos por cinco puntos o menos')],
    ['{X} play for the second time in two days; {X} have had {W} days off', (x, y, w) => sv(x, 'juega por segunda vez en dos días') + '; ' + y + ' ha tenido ' + cnt(w, 'día', 'días') + ' de descanso'],
    ['weighed by what wins in this league, the season’s numbers make {X} about {A} points? better here',
      (x, a) => 'según lo que gana partidos en esta liga, los números de la temporada dan a ' + x + ' ' + abt(a) + ' de ventaja en este partido'],
    ['on the season’s four factors, {X} are about {A} points? better here', (x, a) => 'según los cuatro factores de la temporada, ' + sv(x, 'parte con ' + abt(a) + ' de ventaja')],
    ['(?:(most of that is|the biggest part is) (.+?)|(.+?) alone is worth more than that): (.+), worth about {A} points?', (o, f1, f2, w, a) => {
      const f = fac(f1 || f2), t = first(EXPECT, w);
      if (!f || !t) return null;
      return (!o ? 'solo ' + f + ' ya vale más que eso' : /most/i.test(o) ? 'la mayor parte de esa ventaja está en ' + f : 'lo que más pesa es ' + f) + ': ' + t + ', lo que vale ' + abt(a);
    }],
    ['{X}{Z} edge is (.+?), about {A} points? back', (x, l, a) => { const f = fac(l); return f && 'la ventaja de ' + x + ' está en ' + f + ', que le devuelve ' + abt(a); }],
    ['on these numbers it is close to a toss-up', () => 'con estos números, es casi un cara o cruz'],
    ['the numbers lean {X}, but not by much: a single run settles games closer than that', x => 'los números se inclinan por ' + x + ', pero no por mucho: un solo parcial decide partidos más igualados que este'],
    ['the numbers make {X} clear favourites', x => 'para los números, ' + x + ' es claro favorito'],
    ['on these numbers {X} should win comfortably', x => 'con estos números, ' + sv(x, 'debería ganar con comodidad')],
    ['yes, but {X} come in on {W} straight wins', (x, w) => 'sí, pero ' + sv(x, 'llega con ' + n(w) + ' victorias seguidas')],
    ['yes, but the table has {X} above them', x => 'sí, pero la clasificación sitúa a ' + x + ' por encima'],
    ['{X} has scored 20 or more in (every game this season|each of the last {W}) for {X}',
      (p, e, w, x) => p + ' ha anotado 20 o más puntos en ' + (w ? 'cada uno de los últimos ' + cnt(w, 'partido', 'partidos') : 'todos los partidos de esta temporada') + ' con ' + x],
    ['{X} is averaging {F} over the last three for {X}, up from {F} for the season',
      (p, a, x, b) => p + ' promedia ' + a + ' puntos en los tres últimos partidos con ' + x + ', por encima de los ' + b + ' de su media de la temporada'],
    ['{X} leads {X} with {F} points a game', (p, x, f) => p + ' lidera la anotación de ' + x + ' con ' + f + ' puntos por partido'],
    ['{N} of {X} needs {W} for {D} points this season', (p, x, w, d) => 'a ' + p + ', de ' + x + ', ' + (Number(n(w)) === 1 ? 'le falta 1 punto' : 'le faltan ' + n(w) + ' puntos') + ' para llegar a ' + d + ' esta temporada'],
    ['on the season so far there is almost nothing between them: {X} at {F} net points per 100 possessions, {X} at {F}',
      (x, a, y, b) => 'en lo que va de temporada apenas hay diferencia entre ambos: ' + x + ', con un net rating de ' + a + ' por cada 100 posesiones' + yy(y) + y + ', con ' + b],
    ['{X} have been the better team (by a distance|clearly|narrowly) — {F} net points per 100 against {F} for {X}',
      (x, h, a, b, y) => x + ' ha sido ' + ({ 'by a distance': 'con diferencia', clearly: 'claramente', narrowly: 'por poco' })[h.toLowerCase()] + ' el mejor equipo: net rating de ' + a + ' frente a ' + b + ' de ' + y],
    ['the matchup to watch is {X}{Z} (shooting|turnovers|offensive glass|free throws) against {X}{Z}: on (effective field goal %|turnover rate|offensive rebound %|free throw rate) {X} post {F}% where {X} concede {F}%',
      (x, l, y, f, x2, a, y2, b) => 'el duelo a vigilar: ' + lab(l) + ' de ' + x + ' frente a la defensa de ' + y + '. En ' +
        ({ 'effective field goal %': 'eFG%', 'turnover rate': 'porcentaje de pérdidas', 'offensive rebound %': 'porcentaje de rebote ofensivo', 'free throw rate': 'ratio de tiros libres' })[f.toLowerCase()] +
        ', ' + x + ' firma un ' + a + '% y ' + y + ' concede un ' + b + '%'],
    ['they want different games: {X} have played at {F} possessions per 40 to {X}{Z} {F}, so whoever sets the tempo has already won something',
      (x, a, y, b) => 'quieren partidos distintos: ' + x + ' juega a ' + a + ' posesiones por cada 40 minutos' + yy(y) + y + ' a ' + b + ', así que quien imponga el ritmo tendrá mucho ganado'],
    ['{X} live behind the arc — {F}% of their shots are threes(?:, at {F}%)? — which makes this a game that can swing quickly either way',
      (x, s, a) => x + ' vive del triple: el ' + s + '% de sus tiros son triples' + (a ? ', con un ' + a + '% de acierto' : '') + ', así que este partido puede girar rápido hacia cualquier lado'],
    ['{X} have looked after the ball far better — an? {F} point gap in turnover rate is possessions handed over, and that is usually the game',
      (x, f) => x + ' ha cuidado mucho mejor el balón: ' + f + ' puntos de diferencia en porcentaje de pérdidas son posesiones regaladas, y eso suele decidir el partido'],
    ['{X} is the one to watch for {X} — (.+)', (p, x, b) => {
      const bits = b.split(' and ').map(s => { let m;
        return (m = /^scoring at (-?[\d.]+)% true shooting$/i.exec(s)) ? 'anota con un ' + m[1] + '% de TS%'
          : (m = /^(-?[\d.]+) assists for every turnover$/i.exec(s)) ? m[1] + ' asistencias por cada pérdida'
          : (m = /^(-?[\d.]+)% from three on real volume$/i.exec(s)) ? m[1] + '% en triples con volumen real'
          : (m = /^(-?[\d.]+) rebounds a game$/i.exec(s)) ? m[1] + ' rebotes por partido' : null; });
      return bits.indexOf(null) >= 0 ? null : 'el jugador a seguir en ' + x + ' es ' + p + ': ' + list(bits);
    }],
    ['neither club has a finished game in this season’s records yet, so there is nothing to read into', () => 'ninguno de los dos clubes tiene aún un partido terminado esta temporada, así que no hay nada que analizar'],
    ['this preview fills itself in as results come through', () => 'esta previa se completa sola a medida que llegan los resultados'],
    ['early days — {X} have {D} games? on the board and {X} {D}', (x, a, y, b) => 'es pronto: ' + x + ' lleva ' + a + ' ' + pl(a, 'partido', 'partidos') + yy(y) + y + ', ' + b],
    ['rate statistics this early describe the schedule more than the teams, so take the shape below lightly', () => 'tan pronto, los porcentajes describen más el calendario que a los equipos, así que conviene tomar con cautela lo que sigue'],
    ['confirmed at the table', () => 'confirmado en la mesa'],
    ['tip-off is (.+)', t => 'el salto inicial es a las ' + t],
    ['tipped off at (.+)', t => 'el partido empezó a las ' + t],
    ['worked out from the box scores: players each club was using who have not taken the floor since', () => 'calculado a partir de las estadísticas: jugadores que cada club venía utilizando y que no han vuelto a pisar la pista desde entonces'],
    ['nobody files this, and it clears itself the moment they play', () => 'nadie lo comunica, y se borra solo en cuanto vuelven a jugar'],
    ['nobody missing', () => 'sin bajas'],

    /* ---- the injury wire ---- */
    ['(out|did not play) for the last (?:game|{D} games)', (w, d) => (/^out$/i.test(w) ? 'baja en ' : 'no jugó en ') + (d ? 'los últimos ' + d + ' partidos' : 'el último partido')],
    ['{F} minutes last time out', f => f + ' minutos en su último partido'],
    ['{F} minutes a game', f => f + ' minutos por partido'],
    ['{D} of the club’s last {D}, {F} minutes a game', (a, b, f) => a + (Number(b) === 1 ? ' del último partido' : ' de los últimos ' + b + ' partidos') + ' del club, ' + f + ' minutos por partido'],
    ['long-term', () => 'baja de larga duración'],
    ['{X} is released — off the report and the previews', x => x + ' queda desvinculado: fuera del informe de bajas y de las previas'],

    /* ---- the weekly report ---- */
    ['{X} played (?:one game|{D} games)(?: \\((\\d+)-(\\d+)\\))? this week', (x, d, w, l) => ({ 'this team': 'este equipo', 'this player': 'este jugador' }[x.toLowerCase()] || x) + ' jugó ' + (d ? d + ' partidos' : '1 partido') + ' esta semana' + (w != null ? ' (' + w + '-' + l + ')' : '')],
    ['read against every other (game|run of games) in this league, here is where the week sat',
      g => 'comparada con cualquier otro ' + (/^game$/i.test(g) ? 'partido' : 'tramo de partidos') + ' de esta liga, así quedó la semana'],
    ['there are no league scales built for this competition yet, so these are the week’s own numbers with nothing to read them against',
      () => 'todavía no hay escalas de liga para esta competición, así que estas son las cifras de la semana sin nada con qué compararlas'],
    ['(.+?) was {Q} — the part of the week that needs no fixing, only repeating', (l, q) => lab(l) && lab(l) + ' estuvo ' + pct(q) + ': la parte de la semana que no hay que corregir, solo repetir'],
    ['(.+?) was {Q}, and it is the furthest behind the league of anything here — the one to take into Tuesday',
      (l, q) => lab(l) && lab(l) + ' estuvo ' + pct(q) + ', y es lo que más se aleja de la liga de todo lo que hay aquí: lo que hay que llevarse al entrenamiento del martes'],
    ['nothing in the week stood out in either direction: every measure landed in the middle of the league', () => 'nada destacó esta semana en ningún sentido: todas las métricas quedaron en la zona media de la liga'],
    ['that is a week to build on rather than to react to', () => 'es una semana sobre la que construir, no a la que reaccionar'],
    ['for shape rather than score: (.+)', l => {
      const it = l.split(', ').map(s => { const m = /^(.+?) was (\d+)(?:st|nd|rd|th) percentile$/i.exec(s); return m && lab(m[1]) ? lab(m[1]) + ', percentil ' + m[2] : null; });
      return it.indexOf(null) >= 0 ? null : 'como estilo y no como nota: ' + it.join('; ');
    }],
    ['neither answer is the right one; it is worth knowing which one you chose', () => 'ninguna respuesta es la correcta; conviene saber cuál se eligió'],
    ['one game is one game', () => 'un partido es solo un partido'],
    ['the scales already pull a single night back towards the league, but treat everything above as a question for next week rather than an answer',
      () => 'las escalas ya acercan una sola noche a la media de la liga, pero todo lo anterior es una pregunta para la próxima semana, no una respuesta'],
    ['no games in this window yet — the report fills in as soon as one is played', () => 'todavía no hay partidos en este periodo: el informe se completa en cuanto se juegue uno'],
    ['the week could not be read just now', () => 'no se ha podido leer la semana en este momento'],
    ['try again in a moment', () => 'inténtalo de nuevo en un momento'],
    ['(.+)', l => labs(l)],

    /* ---- the filed article, and the report's cards ---- */
    ['written automatically from the play-by-play the moment this game was finalised', () => 'crónica escrita automáticamente a partir de las jugadas en el momento en que se cerró el partido'],
    ['every number above is computed from the same replay that draws the box score: (\\S+)', u => 'cada cifra de arriba sale de la misma reconstrucción que genera las estadísticas: ' + u],
    ['{D}/{D} fg', (a, b) => 'TC ' + a + '/' + b],
    ['{F}% TS', f => 'TS% ' + f + '%'],
    ['{D}/{D} 3pt', (a, b) => 'T3 ' + a + '/' + b],
    ['{F} net', f => 'Net ' + f],

    ...MW_LEDE, ...MW_HOOK, ...MW_STAKES, ...MW_BODY, ...MW_HEAD
  ];

  /* ---- clauses that hang off a sentence, and the joins between two ---- */
  const TAILS = [
    [/^(.+), and it was never close$/i, a => a + ', y nunca hubo partido'],
    [/^(.+), and it took everything they had$/i, a => a + ', y tuvo que darlo todo'],
    [/^(.+), and were rarely troubled$/i, a => a + ', y apenas pasó apuros'],
    [/^(.+), pulling clear when it mattered$/i, a => a + ', escapándose cuando más importaba'],
    [/^(.+), on a night that could have gone either way$/i, a => a + ', en una noche que pudo caer de cualquier lado'],
    [/^(.+), but only just$/i, a => a + ', aunque por muy poco'],
    [/^(.+), and it did not last$/i, a => a + ', pero no le duró'],
    [/^(.+), and it still was not enough$/i, a => a + ', y aun así no le bastó'],
    [/^(.+), the period that separated them$/i, a => a + ', el cuarto que marcó la diferencia'],
    [new RegExp('^(.+), helped by an? (\\d+)–0 run in the ' + TOK.O + '$', 'i'), (a, d, o) => a + ', con la ayuda de un parcial de ' + sc(d, 0) + ' en ' + ord(o)],
    [/^(.+), and had the better of (.+?) too$/i, (a, l) => labs(l) && a + ', y también dominó en ' + labs(l)],
    [/^(.+), with (.+?) going the same way$/i, (a, l) => labs(l) && a + ', y también dominó en ' + labs(l)]
  ];
  const PREFIX = [
    [/^even so, (.+)$/i, b => 'aun así, ' + b],
    [/^still, (.+)$/i, b => 'aun así, ' + b],
    [/^in turn, (.+)$/i, b => 'a su vez, ' + b],
    [/^from there, (.+)$/i, b => 'a partir de ahí, ' + b]
  ];
  const JOINS = [
    [', which is why ', (a, b) => a + ', y por eso ' + b],
    [', and ', (a, b) => a + ',' + yy(b) + b],
    [', but ', (a, b) => a + ', pero ' + b],
    [', though ', (a, b) => a + ', aunque ' + b],
    [', so ', (a, b) => a + ', así que ' + b],
    ['; ', (a, b) => a + '; ' + b]
  ];

  const COMPILED = RULES.map(([src, fn]) => [rx(src), fn]);
  function clause(s, memo) {
    if (memo.has(s)) return memo.get(s);
    memo.set(s, null);
    let out = first(COMPILED, s);
    for (const [re, fn] of PREFIX) {
      if (out != null) break;
      const m = re.exec(s);
      if (m) { const b = clause(m[1], memo); if (b != null) out = fn(b); }
    }
    /* a concession said up front, "Although a, b" / "Even though a, b": "aunque a, b" (the comma that splits them is the
       first one at which both halves translate) */
    const fr = out == null ? /^(?:although|even though) (.+)$/i.exec(s) : null;
    for (let i = fr ? fr[1].indexOf(', ') : -1; out == null && i > 0; i = fr[1].indexOf(', ', i + 1)) {
      const a = clause(fr[1].slice(0, i), memo), b = a != null ? clause(fr[1].slice(i + 2), memo) : null;
      if (b != null) out = 'aunque ' + a + ', ' + b;
    }
    for (const [re, fn] of TAILS) {
      if (out != null) break;
      const m = re.exec(s);
      if (m) { const a = clause(m[1], memo); if (a != null) out = fn(a, ...m.slice(2)); }
    }
    if (out == null) {
      /* the rightmost join first: "A, and it still was not enough, and B" is (A + tail) and B */
      const at = [];
      JOINS.forEach(([c, fn]) => { let i = s.indexOf(c); while (i > 0) { at.push([i, c, fn]); i = s.indexOf(c, i + 1); } });
      at.sort((x, y) => y[0] - x[0]);
      for (const [i, c, fn] of at) {
        const a = clause(s.slice(0, i), memo);
        if (a == null) continue;
        const b = clause(s.slice(i + c.length), memo);
        if (b != null) { out = fn(a, b); break; }
      }
    }
    memo.set(s, out);
    return out;
  }
  /* "de el vencedor" is "del vencedor"; the decimal comma is written here (the engine leaves a
     figure just before a full stop alone); a capital where the English had one */
  const tidy = (s, whole) => {
    const t = s.replace(/(^|[\s(])de el (?=[a-záéíóúñ])/g, '$1del ').replace(/(^|[\s(])a el (?=[a-záéíóúñ])/g, '$1al ')
      .replace(/(\d)\.(\d)/g, '$1,$2');
    return /^[^A-Za-z]*[A-Z]/.test(whole) ? t.replace(/^([¡¿"“(]*)(\p{Ll})/u, (m, a, b) => a + b.toUpperCase()) : t;
  };
  const finish = (out, whole) => (out == null ? null : tidy(out, whole) + (/\.$/.test(whole) ? '.' : ''));
  /* one sentence at a time: a paragraph is left for the engine to split, so a name at the end
     of a template can never swallow the sentence after it */
  /* the engine's own sentence break: an initial or a title is not the end of a sentence ("P. Reynal Pons", "Site Sportif
     St. Léonard"), so a sentence with one in it is still one sentence here */
  const BREAK = /(?<!(?:^|[\s(])(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.)(?<=[.!?])\s+(?=[A-Z0-9“"‘'(])/;
  const sentence = s => (BREAK.test(s) ? null : finish(clause(s.replace(/\.$/, ''), new Map()), s));
  /* A NAME WITH FULL STOPS IN IT IS NOT TWO SENTENCES: "Valencia B.C.", "C.B. Al-Qazeres", "Pol. Maloste" end a sentence
     to the splitter. Each piece of a paragraph is tried on its own, and a piece that will not translate is tried again
     with the next one or two joined on; the paragraph comes back whole or not at all (the engine then goes sentence by
     sentence). `tr` translates one sentence, or null. */
  const pieces = (parts, tr) => {
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      let t = null, j = i;
      for (; j < parts.length && j < i + 3 && t == null; j++) t = tr(parts.slice(i, j + 1).join(' '));
      if (t == null) return null;
      out.push(t);
      i = j - 1;
    }
    return out.join(' ');
  };
  const paragraph = s => { const parts = s.split(BREAK); return parts.length < 2 ? null : pieces(parts, p => finish(clause(p.replace(/\.$/, ''), new Map()), p)); };
  const one = (re, fn) => m => {
    if (BREAK.test(m[0])) return null;
    const k = re.exec(m[0].replace(/\.$/, ''));
    return k ? finish(fn(...k.slice(1)), m[0]) : null;
  };

  /* the headlines and standfirsts also travel on news cards outside any report container */
  const HEADLINE = RULES.filter(r => MW.indexOf(r) < 0 && /overwhelm|outlast|steal it late|overturn|come from behind|pull away|triple-double carries|sees off| edge | tie | beat |level at|lead |\{X\} (?:hand|stun|end) |go top with|off the mark at last against|straight with|stay perfect|season-best|at the death|ragged|clean, \{D\} steals|out-shoot|triple-double in defeat|to lift|\{Z\} \{D\} is not enough/.test(r[0]))
    .concat(MW_HEAD).map(([src, fn]) => [rx(src, '\\.?'), one(rx(src), fn)]);
  /* (the season around it, the moment and a facet's worth lead standfirsts too, 2026-10-07) */
  const STANDFIRST = [/settled it/, /stretch swung/, /shooting went/, /possessions decided/, /offensive glass belonged/, /whistle sent/,
    /down with five minutes left$/, /nearly went/, /then it was not/, /with five to play$/, /trailed by \{D\} at the break/, /tight throughout/,
    /point margin/, /^full time$/, /twenty minutes/, /won both quarters/, /took over in the second/, /built the lead/, /lead by \{D\}$/,
    /had won their first/, /^the win takes/, /started the night/, /^it ended \{X\}/, /^it ended a run of/, /first win of the season, at the/,
    /^it is \{W\} wins in a row/, /are still unbeaten/, /should have been/, /alone \(was\|were\) worth/, /won it for \{X\}$/, /by anyone in a game/,
    /* the lede's stat and player lines (2026-10-08) */
    /won the boards \{S\}$/, /on the break to \{D\}$/, /outscored them \{S\} in the paint/, /bench outscored theirs/, /points off turnovers to \{D\}$/,
    /took the second chances/, /made \{D\} threes to/, /had \{D\} \(steals\|assists\) to/, /shot \{D\}% eFG to/, /had a triple-double for \{X\}$/, /\(for\|in defeat for\)/,
    /run in the \{O\} was not enough/, /stretch worth \{D\} to \{X\} was not enough/,
    /* the match writer's standfirst (2026-10-08): its hook, then where it leaves them (some of those said by the season
       patterns above) */
    /^the win lifts/, /lose top spot/, /games and no wins/, /^\{X\} have \(now \)\?\(won/]
    .map(k => RULES.find(r => k.test(r[0]))).filter(Boolean).concat(MW_HOOK, MW_STAKES).map(([src, fn]) => [rx(src), fn]);

  I.register('es', {
    phrases: {
      'Scoring by period': 'Parciales',
      'Who was on the floor': 'Quién estaba en pista',
      'Leading lines': 'Actuaciones destacadas',
      'The two sides, measure by measure': 'Los dos equipos, métrica a métrica',
      'Against every other game in this league': 'Frente al resto de partidos de la liga',
      'deciding stretch': 'tramo decisivo',
      'best group': 'mejor quinteto',
      'toughest minutes': 'minutos más duros',
      'half-time report': 'informe del descanso',
      'generated from the play-by-play': 'generada a partir de las jugadas',
      'The first half': 'La primera parte',
      'Where it is being decided': 'Dónde se está decidiendo',
      'Who has it going': 'Quién está en racha',
      'The story so far': 'Lo que va de temporada',
      'Reading the week': 'Leyendo la semana',
      'keep doing': 'mantener',
      'work on': 'a mejorar',
      'the last seven days': 'los últimos siete días',
      'no percentile scales are built for this competition yet, so these are the two sides against each other rather than against the league':
        'aún no hay escalas de percentiles para esta competición, así que se comparan los dos equipos entre sí y no con la liga',
      'the bar is the percentile — how this game compares with real games in this competition': 'la barra es el percentil — cómo se compara este partido con los partidos reales de esta competición',
      'grey rows are a style, not a score': 'las filas grises son un estilo, no una nota',
      'the bar is the percentile against real games in this competition': 'la barra es el percentil frente a partidos reales de esta competición',
      'Written from the event log: every number above is computed from the same replay that draws the box score below.':
        'Escrita a partir del registro de jugadas: cada cifra de arriba sale de la misma reconstrucción que genera las estadísticas de abajo.',
      'Written from the first half’s event log. This tab goes when the third quarter starts, and the full match report arrives when the game is final.':
        'Escrita a partir del registro de jugadas de la primera parte. Esta pestaña desaparece al empezar el tercer cuarto, y la crónica completa llega cuando termina el partido.',
      'competitions & seasons': 'Competiciones y temporadas',
      'the same club in other competitions': 'El mismo club en otras competiciones',
      'all seasons': 'Todas las temporadas',
      'you are here': 'estás aquí',
      'no competition yet': 'Aún sin competición',
      'women': 'femenino',
      'a women\'s team': 'equipo femenino',
      'other profiles': 'Otros perfiles',
      'the same player in other competitions': 'El mismo jugador en otras competiciones',
      'no club yet': 'Aún sin club',
      'youth': 'juvenil',
      'a youth team': 'equipo juvenil',
      'the same club in other leagues and competitions': 'El mismo club en otras ligas y competiciones',
      'What decided it, in points': 'Lo que lo decidió, en puntos',
      'Form and what comes next': 'Forma y próximo partido',
      'Final margin': 'Diferencia final',
      'The season said': 'Lo que decía la temporada',
      'Shot quality': 'Calidad de tiro',
      'Shot making': 'Acierto en el tiro',
      'Offensive glass': 'Rebote ofensivo',
      'Getting to the line': 'Llegada a la línea de tiros libres',
      'Free-throw shooting': 'Acierto en tiros libres',
      'Home court': 'Factor cancha',
      'Everything else': 'Todo lo demás',
      'margin': 'diferencia',
      'next game': 'próximo partido',
      'each facet weighed by this league’s own model of what wins': 'cada faceta ponderada con el modelo propio de esta liga sobre lo que gana partidos',
      'each factor at its usual weight in points per 100 possessions': 'cada factor con su peso habitual en puntos por 100 posesiones',
      'shot quality is what the shots taken are worth at the league’s make rates, shot making the rest': 'la calidad de tiro es lo que valen los tiros intentados con los porcentajes de la liga; el acierto, el resto',
      'shot quality is what the shots taken are worth at this game’s make rates, shot making the rest': 'la calidad de tiro es lo que valen los tiros intentados con los porcentajes de este partido; el acierto, el resto',
      'the rows add up to the final margin, the home side’s minus the away side’s': 'las filas suman la diferencia final, la del local menos la del visitante',
      'the last five results, this game last': 'los cinco últimos resultados, este partido el último',
      'record, place in the table and run': 'balance, puesto en la clasificación y racha',
      'the next fixture': 'el próximo partido'
    },

    ctxPatterns: {
      /* one per template (the full stop is read off, then the template is matched without it),
         and last the composite: a sentence the writer joined from several templates */
      report: COMPILED.map(([re, fn], i) => [rx(RULES[i][0], '\\.?'), one(re, fn)])
        .concat([[/^[\s\S]*[A-Za-z][\s\S]*$/, m => sentence(m[0]) || paragraph(m[0])]])
    },
    sentences: ['report'],

    /* outside the report container: the report's headline and standfirst on a news card, and
       the injury page's counts */
    patterns: HEADLINE.concat([
      [/^[A-Z][^]*\.$/, m => {
        return pieces(m[0].split(BREAK), p => finish(first(STANDFIRST, p.replace(/\.$/, '')), p));
      }],
      [/^(\d+) players? out( so far)?$/i, m => m[1] + ' ' + pl(m[1], 'jugador', 'jugadores') + ' de baja' + (m[2] ? ' (por ahora)' : '')],
      [/^(\d+) out$/i, m => m[1] + ' ' + pl(m[1], 'baja', 'bajas')],
      [/^Mark (.+) as released — they leave the injury report and the game previews$/, m => 'Marcar a ' + m[1] + ' como desvinculado: sale del informe de bajas y de las previas']
    ])
  }, 'report');
})();
