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
    nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const n = w => (w == null ? '' : /^\d/.test(w) ? String(w) : String(NUM[String(w).toLowerCase()]));
  const WORDS = 'no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+';
  const PCT = {
    'better than nine games in ten': 'por encima de nueve de cada diez partidos',
    'better than nine weeks in ten': 'por encima de nueve de cada diez semanas',
    'among the best in the league': 'entre lo mejor de la liga',
    'at the very top of the league': 'en lo más alto de la liga',
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
    'hard to place': 'en un punto difícil de situar'
  };
  const FREQ = {
    'a share few sides in this league ever reach': 'un porcentaje que pocos equipos de esta liga alcanzan',
    'more than most sides manage': 'más que la mayoría de equipos',
    'as few as any side in this league gets': 'tan pocas como el que menos en esta liga',
    'fewer than most sides get': 'menos que la mayoría de equipos'
  };
  const alt = o => Object.keys(o).sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const TOK = {
    X: '([^,;:—]+?)', L: '(.+?)', N: '((?!and )(?:(?! and | for | of )[^,;:—()])+?)', D: '(\\d+)', F: '(-?\\d+(?:\\.\\d+)?)', W: '(' + WORDS + ')',
    S: '(\\d+)[–-](\\d+)', O: '(first|second|third|fourth|\\d+th)', M: '(\\d+:\\d{2})',
    T: '((?:(?:,| and) (?:' + WORDS + ') (?:rebounds|assists|steals|blocks))*)',
    P: '(their|[^,;:—]+?’s?)', Q: '(' + alt(PCT) + ')', R: '(' + alt(FREQ) + ')',
    V: '(in transition|on second chances|off turnovers)'
  };
  const rx = (src, end) => new RegExp('^(?:' + src.replace(/\{([A-Z])\}/g, (m, k) => TOK[k]) + ')' + (end || '') + '$', 'i');

  const sc = (a, b) => a + '-' + b;
  const ORD = { first: 'el primer cuarto', second: 'el segundo cuarto', third: 'el tercer cuarto', fourth: 'el último cuarto' };
  const OT = ['la prórroga', 'la segunda prórroga', 'la tercera prórroga', 'la cuarta prórroga'];
  const ord = o => ORD[String(o).toLowerCase()] || OT[parseInt(o, 10) - 5] || 'la prórroga';
  const ROLE = { 'the winners': 'el vencedor', 'the losers': 'el perdedor' };
  /* a subject: they is dropped (the verb carries it), a role becomes words, a club is itself */
  const who = x => { const k = String(x).toLowerCase(); return k === 'they' ? '' : (ROLE[k] || String(x)); };
  const sv = (x, v) => { const w = who(x); return w ? w + ' ' + v : v; };
  /* "y" becomes "e" before an i- sound */
  const yy = b => (/^(i|hi)(?![aeiouáéíóú])/i.test(String(b)) ? ' e ' : ' y ');
  const list = xs => (xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + yy(xs[xs.length - 1]) + xs[xs.length - 1]);
  const names = x => list(String(x).split(/, | and /));
  const pl = (k, a, b) => (Number(k) === 1 ? a : b);
  const STAT = { points: ['punto', 'puntos'], rebounds: ['rebote', 'rebotes'], assists: ['asistencia', 'asistencias'],
    steals: ['recuperación', 'recuperaciones'], blocks: ['tapón', 'tapones'] };
  const stat = (k, c) => c + ' ' + pl(c, ...STAT[k]);
  const line = (pts, t) => { const parts = [stat('points', pts)]; String(t || '').replace(/(\w+) (rebounds|assists|steals|blocks)/gi, (m, w, k) => { parts.push(stat(k.toLowerCase(), n(w))); return m; }); return list(parts); };
  const own = (p, mine, noun) => (/^their$/i.test(p) ? mine : noun + ' de ' + who(String(p).replace(/’s?$/, '')));
  const DAY = { sunday: 'el domingo', monday: 'el lunes', tuesday: 'el martes', wednesday: 'el miércoles', thursday: 'el jueves', friday: 'el viernes', saturday: 'el sábado' };
  const PART = { morning: 'por la mañana', afternoon: 'por la tarde', evening: 'por la noche' };
  const WHERE = { 'in transition': 'al contraataque', 'on second chances': 'en segundas oportunidades', 'off turnovers': 'tras pérdida' };
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

  /* "On Saturday evening at The Arena, in front of 312 in Division One", in any of its parts */
  const DL = /^(?:on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (morning|afternoon|evening))?)?(?:(?:^| )at ([^,]+?))?(?:(?:^|,? )in front of (\d+))?(?: in ([^,]+?))?$/i;
  const dl = s => {
    const m = DL.exec(String(s).trim());
    if (!m || !(m[1] || m[3] || m[4] || m[5])) return null;
    return { day: m[1], part: m[2], venue: m[3], crowd: m[4], comp: m[5] && m[5].replace(/^the /i, '') };
  };
  /* "el sábado por la noche en The Arena, ante 312 espectadores" (+ "en partido de X") */
  const where = (d, comp) => {
    if (!d) return '';
    const parts = [];
    const when = d.day ? DAY[d.day.toLowerCase()] + (d.part ? ' ' + PART[d.part.toLowerCase()] : '') : '';
    if (when) parts.push(when + (d.venue ? ' en ' + d.venue : ''));
    else if (d.venue) parts.push('en ' + d.venue);
    if (d.crowd) parts.push('ante ' + d.crowd + ' espectadores');
    if (comp !== false && d.comp) parts.push('en partido de ' + d.comp);
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
    [rx('{N} came off the bench for {D}{T}'), (p, d, t) => p + ' salió del banquillo con ' + line(d, t)],
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
  const roughClub = c => { const m = /^(.+?)’s? (.+)$/.exec(c); if (!m) return null; const it = items(m[2], ROUGH); return it ? { t: list(it) + ' en ' + m[1], many: it.length > 1 } : null; };

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Spanish | null]; {X} a name or a subject, {D} a count, {F} a
     figure, {W} a count in words, {S} a score, {O} a period, {M} a clock, {T} the rest of a
     stat line, {L} a list of names, {P} a possessive, {Q} a percentile phrase, {R} a share phrase, {V} a situation */
  const RULES = [
    /* ---- the opening sentence, with its dateline ---- */
    ['((?:on|at|in front of) .+ beat .+)', s => {
      const re = /, /g;
      let m;
      while ((m = re.exec(s))) {
        const d = dl(s.slice(0, m.index));
        const t = /^(.+?) beat (.+?) (\d+)[–-](\d+)(?: in ([^,]+))?$/i.exec(s.slice(m.index + 2));
        if (d && t && !/^in front of /i.test(t[1])) {
          return where(d, false) + ', ' + t[1] + ' ganó a ' + t[2] + ' por ' + sc(t[3], t[4]) + (t[5] ? ' en partido de ' + t[5].replace(/^the /i, '') : '');
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
    ['it turned on an? {D}–0 burst in the {O}, and the game did not come back',
      (d, o) => 'todo cambió con un parcial de ' + sc(d, 0) + ' en ' + ord(o) + ', y el partido ya no volvió'],
    ['an? {D}–0 run in the {O} did the damage, and the game never really came back',
      (d, o) => 'un parcial de ' + sc(d, 0) + ' en ' + ord(o) + ' hizo el daño, y el partido ya nunca volvió a igualarse'],
    ['the gap opened during an? {D}–0 run in the {O}', (d, o) => 'la brecha se abrió con un parcial de ' + sc(d, 0) + ' en ' + ord(o)],
    ['the biggest swing was an? {D}–0 run in the {O} from {X}', (d, o, x) => 'el mayor parcial fue un ' + sc(d, 0) + ' de ' + x + ' en ' + ord(o)],
    ['the longest run of the game was {X}’s? {D}–0 in the {O}', (x, d, o) => 'la mayor racha del partido fue el ' + sc(d, 0) + ' de ' + x + ' en ' + ord(o)],
    ['{X} took the period {S}', (x, a, b) => sv(x, 'se llevó ese cuarto por ' + sc(a, b))],
    ['{X} had already taken the {O} {S}', (x, o, a, b) => sv(x, 'ya se había llevado ' + ord(o) + ' por ' + sc(a, b))],
    ['{X} won the {O} {S}', (x, o, a, b) => sv(x, 'ganó ' + ord(o) + ' por ' + sc(a, b))],
    ['{X} were in front at every break', x => sv(x, 'iba por delante al final de cada cuarto')],
    ['{X} were {S} up early', (x, a, b) => sv(x, 'empezó ganando ' + sc(a, b))],
    ['the lead had changed {D} times? before that', d => 'antes de eso, el liderato había cambiado de manos ' + d + ' ' + pl(d, 'vez', 'veces')],
    ['there were {D} lead changes?(?: and the scores were level {W} times)?, so neither side ever properly settled',
      (d, w) => 'hubo ' + d + ' ' + pl(d, 'cambio', 'cambios') + ' de líder' + (w ? ' y el marcador estuvo igualado ' + n(w) + ' veces' : '') + ', así que ninguno de los dos llegó a asentarse'],
    ['the scores were level {W} times', w => 'el marcador estuvo igualado ' + n(w) + ' veces'],

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
    ['it was played at speed — {F} possessions per 40', f => 'se jugó a mucho ritmo: ' + f + ' posesiones por cada 40 minutos'],
    ['it was a slow, half-court game at {F} possessions per 40', f => 'fue un partido lento, de ataque posicional, con ' + f + ' posesiones por cada 40 minutos'],
    ['{X} finished on {D} against a season average of {F}', (x, d, f) => sv(x, 'terminó con ' + d + ' puntos, cuando su media de la temporada es de ' + f)],
    ['{X} were held to {D}, well short of the {F} they usually manage', (x, d, f) => sv(x, 'se quedó en ' + d + ' puntos, muy lejos de los ' + f + ' que suele anotar')],

    /* ---- where the points came from ---- */
    ['{X} (had|have) the edge {V}: {D} points? from {D} chances?(?:, {F} a time)?, against {X}’s? {D}',
      (x, t, v, p, c, r, y, o) => sv(x, (/^had$/i.test(t) ? 'dominó ' : 'domina ') + WHERE[v.toLowerCase()]) + ': ' + stat('points', p) + ' en ' + c + ' ' +
        pl(c, 'oportunidad', 'oportunidades') + (r ? ', ' + r + ' por acción' : '') + ', frente a los ' + o + ' de ' + y],
    ['{V} it (?:was|is) {S} to {X}( so far)?, from {D} chances?(?:, {F} a time)?',
      (v, a, b, x, far, c, r) => WHERE[v.toLowerCase()] + ', ' + sc(a, b) + ' para ' + x + (far ? ' hasta ahora' : '') + ', en ' + c + ' ' +
        pl(c, 'oportunidad', 'oportunidades') + (r ? ', ' + r + ' por acción' : '')],
    ['they (got|are getting) {D}% of their chances that way, {R}', (t, d, r) => 'el ' + d + '% de sus oportunidades ' + (/^got$/i.test(t) ? 'llegaron' : 'están llegando') + ' así, ' + freq(r)],
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
    ['from the floor it was {D}% to {D}% in {X}’s? favour', (a, b, x) => 'en tiros de campo, ' + a + '% contra ' + b + '% a favor de ' + who(x)],
    ['{X} shot {D}% from the field to {D}%', (x, a, b) => sv(x, 'tiró con un ' + a + '% en tiros de campo') + ', por el ' + b + '% del rival'],
    ['{X} made {D} of {D} from three', (x, a, b) => sv(x, 'anotó ' + a + ' de ' + b + ' triples')],
    ['{X} went {D} of {D} from three', (x, a, b) => sv(x, 'se quedó en ' + a + ' de ' + b + ' en triples')],
    ['{X} made only {D} of {D} free throws', (x, a, b) => sv(x, 'solo anotó ' + a + ' de ' + b + ' tiros libres')],
    ['{X} won the boards {S}', (x, a, b) => sv(x, 'ganó la batalla del rebote por ' + sc(a, b))],
    ['{X} scored {D} on the break to {D}', (x, a, b) => sv(x, 'anotó ' + stat('points', a) + ' al contraataque, por ' + b + ' del rival')],
    ['{X} gave the ball away {D} times', (x, d) => sv(x, 'perdió ' + d + ' ' + pl(d, 'balón', 'balones'))],
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
    ['{X} forced the ball loose all night — their opponents coughed it up on {F}% of possessions', (x, a) => sv(x, 'forzó pérdidas toda la noche') + ': el rival perdió el balón en el ' + a + '% de sus posesiones'],
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
    ['across every minute they shared, {X}’s? five from that swing were ([+-]?\\d+) in {M}', (x, pm, m) => 'en todos los minutos que compartieron, el quinteto de ' + x + ' de ese tramo fue ' + pm + ' en ' + m],
    ['{P} strongest group — {L} — was ([+-]?\\d+) across {M}', (p, f, pm, m) => own(p, 'su mejor quinteto', 'el mejor quinteto') + ' (' + names(f) + ') fue ' + pm + ' en ' + m],
    ['(at the other end of it, |at the other end, |the reverse was true at the other end: ){X} lost {D} points in {M} with {L} out there — the combination that cost them most',
      (pre, x, d, m, f) => (/reverse/i.test(pre) ? 'al contrario, ' : 'en el otro lado, ') + sv(x, 'perdió ' + stat('points', d) + ' en ' + m + ' con ' + names(f) + ' en pista') + ': la combinación que más le costó'],

    /* ---- the performances ---- */
    ['{X} led {X} with {D} points{T}(, a season high)?(, a triple-double)?',
      (p, x, d, t, hi, td) => p + ' lideró a ' + x + ' con ' + line(d, t) + (hi ? ', su mejor marca de la temporada' : '') + (td ? ', con triple-doble' : '')],
    ['{X} top-scored for {X} with {D}{T}(, a triple-double)?', (p, x, d, t, td) => p + ' fue el máximo anotador de ' + x + ' con ' + line(d, t) + (td ? ', con triple-doble' : '')],
    ['{X} had {D} points{T} from {X}(, a triple-double)?', (x, d, t, p, td) => x + ' contó con ' + line(d, t) + ' de ' + p + (td ? ', con triple-doble' : '')],
    ['{X} answered with {D}{T}(, a triple-double)? for {X}', (p, d, t, td, x) => p + ' respondió con ' + line(d, t) + (td ? ', con triple-doble' : '') + ' en ' + x],
    ['for {X}, {X} had {D}{T}(, a triple-double)?', (x, p, d, t, td) => 'en ' + x + ', ' + p + ' firmó ' + line(d, t) + (td ? ', con triple-doble' : '')],
    ['{X} finished with {D}{T}(, a triple-double)? for {X}', (p, d, t, td, x) => p + ' terminó con ' + line(d, t) + (td ? ', con triple-doble' : '') + ' en ' + x],
    ['{X} had a triple-double for {X}: (.+)', (p, x, l) => {
      const parts = l.split(/, | and /).map(s => { const m = /^(\d+) (points|rebounds|assists|steals|blocks)$/i.exec(s); return m ? stat(m[2].toLowerCase(), m[1]) : null; });
      return parts.indexOf(null) >= 0 ? null : p + ' firmó un triple-doble en ' + x + ': ' + list(parts);
    }],
    ['(.+?)(, well up on his usual)?', (s, up) => {
      /* "A added 14 and B 12 for X": "en X, A aportó 14 puntos y B, 12" */
      const one = t => { let m = rx('{N} added {D}').exec(t); if (m) return m[1] + ' aportó ' + stat('points', m[2]); m = rx('{N} {D}').exec(t); return m ? m[1] + ', ' + m[2] : null; };
      if (!/ added \d/.test(s)) return null;
      const cs = byClub(s, one);
      return cs && clubs(cs) + (up ? ', muy por encima de su media' : '');
    }],
    ['(.+)', s => { const cs = byClub(s, t => first(DEED, t)); return cs && clubs(cs); }],
    ['(.+)', s => { const cs = byClub(s, t => first(SPECIAL, t)); return cs && clubs(cs); }],
    ['it was a long night for (.+?)(?:, and for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : null; return x && (!b || y) ? 'fue una noche larga para ' + x.t + (y ? ', y también para ' + y.t : '') : null; }],
    ['little went right for (.+?)(?:, or for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : null; return x && (!b || y) ? 'nada funcionó para ' + x.t + (y ? ', ni para ' + y.t : '') : null; }],
    ['(.+?) never got going(?:, and neither did (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : null; return x && (!b || y) ? x.t + ' no ' + (x.many ? 'llegaron' : 'llegó') + ' a entrar en el partido' + (y ? ', y tampoco ' + y.t : '') : null; }],
    ['{X} lost {L} to fouls(?:, and {X} lost {L} the same way)?', (x, a, y, b) => x + ' perdió a ' + names(a) + ' por faltas' + (y ? ',' + yy(y) + y + ' perdió a ' + names(b) + ' de la misma manera' : '')],

    /* ---- the scout's note ---- */
    ['{X} won this on (.+?) before anything else: they were {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && x + ' ganó este partido ante todo en ' + lab(l) + ': estuvo ' + pct(q) + ', mientras que ' + y + ' estuvo ' + pct(r)],
    ['{X} have had the better of (.+?) more than anything: they have been {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && x + ' domina sobre todo en ' + lab(l) + ': está ' + pct(q) + ', mientras que ' + y + ' está ' + pct(r)],
    ['the widest gap between them was (.+?), and it went {X}’s? way — they were {Q} there, {X} {Q} — but it was not enough',
      (l, x, q, y, r) => lab(l) && 'la mayor diferencia entre ambos estuvo en ' + lab(l) + ', y fue para ' + x + ': estuvo ' + pct(q) + ', mientras que ' + y + ' estuvo ' + pct(r) + ', pero no le bastó'],
    ['the widest gap so far is (.+?), and it favours {X}(, who trail)?: they have been {Q} there, {X} {Q}',
      (l, x, tr, q, y, r) => lab(l) && 'la mayor diferencia hasta ahora está en ' + lab(l) + ', y favorece a ' + x + (tr ? ', que va por detrás' : '') + ': está ' + pct(q) + ', mientras que ' + y + ' está ' + pct(r)],
    ['the other gaps (worth the film room|to watch after the break): (.+)', (w, l) => {
      const it = l.split(/\) and /).map((s, i, a) => (i < a.length - 1 ? s + ')' : s)).map(s => {
        const m = /^(.+?) \((.*?), (\d+) percentile points clear\)$/.exec(s);
        return m && lab(m[1]) ? lab(m[1]) + ' (' + (m[2] || '—') + ', ' + m[3] + ' puntos de percentil de ventaja)' : null;
      });
      return it.indexOf(null) >= 0 ? null : (/film/i.test(w) ? 'otras diferencias para la sala de vídeo: ' : 'otras diferencias a vigilar tras el descanso: ') + list(it);
    }],
    ['{X} (came out ahead|are ahead) on (.+?), and with no league scales built for this competition yet those are the two sides against each other rather than against anybody else',
      (x, t, l) => labs(l) && x + (/came/i.test(t) ? ' salió por delante en ' : ' va por delante en ') + labs(l) + '; como aún no hay escalas de liga para esta competición, es una comparación entre los dos equipos y no con el resto'],
    ['{X} (had|have had) the better of (.+?) — (?:the part of their game that did not cost them|something to build on after the break)',
      (x, t, l) => labs(l) && x + (/^had$/i.test(t) ? ' fue mejor en ' + labs(l) + ': la parte de su juego que no le costó el partido' : ' está siendo mejor en ' + labs(l) + ': algo sobre lo que construir tras el descanso')],
    ['{X} (?:did their best work|are doing their best work) on (.+?), where they (were|have been) {Q}(?:, with (.+?) not far behind)?',
      (x, l, t, q, r) => lab(l) && (!r || labs(r)) && 'lo mejor de ' + x + (/^were$/i.test(t) ? ' estuvo en ' : ' está en ') + lab(l) + ', donde ' + (/^were$/i.test(t) ? 'estuvo ' : 'está ') + pct(q) + (r ? ', con ' + labs(r) + ' no muy lejos' : '')],
    ['what they will (?:still want back|want to tighten) starts with (.+?), where they (were|have been) {Q}(?:; (.+?) (?:lagged too|are lagging too))?',
      (l, t, q, r) => lab(l) && (!r || labs(r)) && 'lo que ' + (/^were$/i.test(t) ? 'querrá recuperar' : 'querrá ajustar') + ' empieza por ' + lab(l) + ', donde ' + (/^were$/i.test(t) ? 'estuvo ' : 'está ') + pct(q) +
        (r ? '; ' + labs(r) + ' también ' + (/^were$/i.test(t) ? (many(labs(r)) ? 'se quedaron' : 'se quedó') : (many(labs(r)) ? 'se están' : 'se está') + ' quedando') + ' atrás' : '')],
    ['{X} (also struggled|are also struggling) with (.+?)', (x, t, l) => labs(l) && sv(x, (/struggled/i.test(t) ? 'también sufrió en ' : 'también está sufriendo en ') + labs(l))],
    ['if there is one thing to take into the week, it is (.+?): {X} were {Q} there, further behind the league than anything else in their game',
      (l, y, q) => lab(l) && 'si hay algo que llevarse a la semana de trabajo, ' + (many(lab(l)) ? 'son ' : 'es ') + lab(l) + ': ' + y + ' estuvo ' + pct(q) + ', más por detrás de la liga que en cualquier otro aspecto de su juego'],
    ['the one thing to fix at the break is (.+?): {X} have been {Q} there, further behind the league than anything else in their game',
      (l, y, q) => lab(l) && 'lo que hay que corregir en el descanso ' + (many(lab(l)) ? 'son ' : 'es ') + lab(l) + ': ' + y + ' está ' + pct(q) + ', más por detrás de la liga que en cualquier otro aspecto de su juego'],

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
    ['a {M} stretch swung it by {D}', (m, d) => 'un tramo de ' + m + ' inclinó el partido por ' + stat('points', d)],
    ['the shooting went {X}’s? way, {F}% eFG to {F}%', (x, a, b) => 'el tiro fue para ' + x + ': ' + a + '% de eFG% frente a ' + b + '%'],
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
    ['on the season so far there is almost nothing between them: {X} at {F} net points per 100 possessions, {X} at {F}',
      (x, a, y, b) => 'en lo que va de temporada apenas hay diferencia entre ambos: ' + x + ', con un net rating de ' + a + ' por cada 100 posesiones' + yy(y) + y + ', con ' + b],
    ['{X} have been the better team (by a distance|clearly|narrowly) — {F} net points per 100 against {F} for {X}',
      (x, h, a, b, y) => x + ' ha sido ' + ({ 'by a distance': 'con diferencia', clearly: 'claramente', narrowly: 'por poco' })[h.toLowerCase()] + ' el mejor equipo: net rating de ' + a + ' frente a ' + b + ' de ' + y],
    ['the matchup to watch is {X}’s? (shooting|turnovers|offensive glass|free throws) against {X}’s?: on (effective field goal %|turnover rate|offensive rebound %|free throw rate) {X} post {F}% where {X} concede {F}%',
      (x, l, y, f, x2, a, y2, b) => 'el duelo a vigilar: ' + lab(l) + ' de ' + x + ' frente a la defensa de ' + y + '. En ' +
        ({ 'effective field goal %': 'eFG%', 'turnover rate': 'porcentaje de pérdidas', 'offensive rebound %': 'porcentaje de rebote ofensivo', 'free throw rate': 'ratio de tiros libres' })[f.toLowerCase()] +
        ', ' + x + ' firma un ' + a + '% y ' + y + ' concede un ' + b + '%'],
    ['they want different games: {X} have played at {F} possessions per 40 to {X}’s? {F}, so whoever sets the tempo has already won something',
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
    ['{F} net', f => 'Net ' + f]
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
  const BREAK = /(?<=[.!?])\s+(?=[A-Z0-9“"‘'(])/;
  const sentence = s => (BREAK.test(s) ? null : finish(clause(s.replace(/\.$/, ''), new Map()), s));
  const one = (re, fn) => m => {
    if (BREAK.test(m[0])) return null;
    const k = re.exec(m[0].replace(/\.$/, ''));
    return k ? finish(fn(...k.slice(1)), m[0]) : null;
  };

  /* the headlines and standfirsts also travel on news cards outside any report container */
  const HEADLINE = RULES.filter(r => /overwhelm|outlast|steal it late|overturn|come from behind|pull away|triple-double carries|sees off| edge | tie | beat |level at|lead /.test(r[0]))
    .map(([src, fn]) => [rx(src, '\\.?'), one(rx(src), fn)]);
  const STANDFIRST = [/settled it/, /stretch swung/, /shooting went/, /possessions decided/, /offensive glass belonged/, /whistle sent/,
    /down with five minutes left$/, /nearly went/, /then it was not/, /with five to play$/, /trailed by \{D\} at the break/, /tight throughout/,
    /point margin/, /^full time$/, /twenty minutes/, /won both quarters/, /took over in the second/, /built the lead/, /lead by \{D\}$/]
    .map(k => RULES.find(r => k.test(r[0]))).filter(Boolean).map(([src, fn]) => [rx(src), fn]);

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
      'the same club in other leagues and competitions': 'El mismo club en otras ligas y competiciones'
    },

    ctxPatterns: {
      /* one per template (the full stop is read off, then the template is matched without it),
         and last the composite: a sentence the writer joined from several templates */
      report: COMPILED.map(([re, fn], i) => [rx(RULES[i][0], '\\.?'), one(re, fn)])
        .concat([[/^[\s\S]*[A-Za-z][\s\S]*$/, m => sentence(m[0])]])
    },
    sentences: ['report'],

    /* outside the report container: the report's headline and standfirst on a news card, and
       the injury page's counts */
    patterns: HEADLINE.concat([
      [/^[A-Z][^]*\.$/, m => {
        const parts = m[0].split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
        const out = parts.map(p => finish(first(STANDFIRST, p.replace(/\.$/, '')), p));
        return out.indexOf(null) >= 0 ? null : out.join(' ');
      }],
      [/^(\d+) players? out( so far)?$/i, m => m[1] + ' ' + pl(m[1], 'jugador', 'jugadores') + ' de baja' + (m[2] ? ' (por ahora)' : '')],
      [/^(\d+) out$/i, m => m[1] + ' ' + pl(m[1], 'baja', 'bajas')],
      [/^Mark (.+) as released — they leave the injury report and the game previews$/, m => 'Marcar a ' + m[1] + ' como desvinculado: sale del informe de bajas y de las previas']
    ])
  }, 'report');
})();
