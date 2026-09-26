'use strict';
/* 日本語: the generated prose — match and half-time reports, filed report articles, the game
   preview, the injury wire and the weekly report. One anchored pattern per sentence template,
   written as Japanese match reports write: the winner first ("AがBに85－74で勝利"), a stat line
   run together ("27得点14リバウンド"), a full-width dash in prose scores, 。 and 、, box-score
   letters for the rates (EFG%, TS%, NETRTG). Names pass through as the data has them. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;

  /* ---------------------------------------------------------------- pieces --- */
  const NUM = { no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const n = w => (w == null ? '' : /^\d/.test(w) ? String(w) : String(NUM[String(w).toLowerCase()]));
  const WORDS = 'no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+';
  const PCT = {
    'better than nine games in ten': '10試合中9試合を上回る水準',
    'better than nine weeks in ten': '10週中9週を上回る水準',
    'among the best in the league': 'リーグ屈指の水準',
    'at the very top of the league': 'リーグトップクラス',
    'better than three games in four': '4試合中3試合を上回る水準',
    'better than three weeks in four': '4週中3週を上回る水準',
    'comfortably above the league': 'リーグ平均を大きく上回る水準',
    'well above the league average': 'リーグ平均をはっきり上回る水準',
    'better than most': '多くを上回る水準',
    'above the league’s middle': 'リーグ中位より上',
    'on the good side of average': '平均をやや上回る水準',
    'about league average': 'ほぼリーグ平均',
    'about average for this league': 'ほぼリーグ平均',
    'in the middle of the league': 'リーグの中位',
    'right on the league average': 'リーグ平均どおり',
    'worse than most': '多くを下回る水準',
    'below the league’s middle': 'リーグ中位より下',
    'on the wrong side of average': '平均をやや下回る水準',
    'worse than three games in four': '4試合中3試合を下回る水準',
    'worse than three weeks in four': '4週中3週を下回る水準',
    'comfortably below the league': 'リーグ平均を大きく下回る水準',
    'well below the league average': 'リーグ平均をはっきり下回る水準',
    'worse than nine games in ten': '10試合中9試合を下回る水準',
    'worse than nine weeks in ten': '10週中9週を下回る水準',
    'among the weakest in the league': 'リーグ最低レベル',
    'near the bottom of the league': 'リーグ最下位に近い水準',
    'hard to place': '評価の難しい数字'
  };
  const FREQ = {
    'a share few sides in this league ever reach': 'リーグでもほとんど見られない割合だ',
    'more than most sides manage': '多くのチームを上回る割合だ',
    'as few as any side in this league gets': 'リーグで最も少ない水準だ',
    'fewer than most sides get': '多くのチームより少ない'
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

  const sc = (a, b) => a + '－' + b;
  const ORD = { first: '第1クォーター', second: '第2クォーター', third: '第3クォーター', fourth: '第4クォーター' };
  const ord = o => ORD[String(o).toLowerCase()] || ('延長第' + (parseInt(o, 10) - 4) + 'ピリオド');
  const dur = m => { const [a, b] = String(m).split(':').map(Number); return a ? a + '分' + (b ? b + '秒' : '') : b + '秒'; };
  const ROLE = { 'the winners': '勝ったチーム', 'the losers': '敗れたチーム' };
  /* a subject: they is dropped, a role becomes words, a club is itself */
  const who = x => { const k = String(x).toLowerCase(); return k === 'they' ? '' : (ROLE[k] || String(x)); };
  const S = (x, p) => { const w = who(x); return w ? w + (p == null ? 'は' : p) : ''; };
  const own = x => { if (/^their$/i.test(x)) return ''; const w = String(x).replace(/’s?$/, ''); return who(w) + 'の'; };
  const names = x => String(x).split(/, | and /).join('、');
  const STAT = { points: '得点', rebounds: 'リバウンド', assists: 'アシスト', steals: 'スティール', blocks: 'ブロック' };
  const tail = t => { let o = ''; String(t || '').replace(/(\w+) (rebounds|assists|steals|blocks)/gi, (m, w, k) => { o += n(w) + STAT[k.toLowerCase()]; return m; }); return o; };
  const line = (pts, t) => pts + '得点' + tail(t);
  const DAY = { sunday: '日曜日', monday: '月曜日', tuesday: '火曜日', wednesday: '水曜日', thursday: '木曜日', friday: '金曜日', saturday: '土曜日' };
  const PART = { morning: '午前', afternoon: '午後', evening: '夜' };
  const WHERE = { 'in transition': 'ファストブレイク', 'on second chances': 'セカンドチャンス', 'off turnovers': '相手のターンオーバーからの攻撃' };

  /* the measures the scout's note and the weekly report name */
  const LAB = {
    'shooting': 'シュート', 'turnovers': 'ターンオーバー', 'the offensive glass': 'オフェンスリバウンド',
    'offensive glass': 'オフェンスリバウンド', 'free throws': 'フリースロー',
    'shooting from the field': 'フィールドゴール', 'looking after the ball': 'ターンオーバーの少なさ',
    'the defensive glass': 'ディフェンスリバウンド', 'getting to the line': 'フリースローの獲得',
    'shooting from three': '3Pシュート', 'how much they shot from three': '3P試投の多さ',
    'how much they got to the rim': 'ゴール下へのアタックの多さ', 'getting to the rim': 'ゴール下へのアタック',
    'finishing at the rim': 'ゴール下のフィニッシュ', 'sharing the ball': 'ボールシェア',
    'assists against turnovers': 'アシスト/ターンオーバー比', 'passing against turning it over': 'アシスト/ターンオーバー比',
    'forcing turnovers': 'ターンオーバーの誘発', 'protecting the rim': 'リムプロテクト',
    'scoring per possession': 'ポゼッションあたりの得点', 'their defence': 'ディフェンス',
    'scoring efficiency': '得点効率', 'how much of the offence they took': '攻撃への関与度',
    'creating for others': '味方へのチャンスメイク', 'the mid-range': 'ミドルレンジ',
    'taking the ball off people': 'スティール', 'blocking shots': 'ブロックショット',
    'points per possession used': '使用ポゼッションあたりの得点'
  };
  const lab = x => (Object.prototype.hasOwnProperty.call(LAB, String(x).toLowerCase()) ? LAB[String(x).toLowerCase()] : null);
  const labs = x => { const out = String(x).split(/, | and /).map(lab); return out.indexOf(null) >= 0 ? null : out.join('、'); };
  const pct = q => PCT[String(q).toLowerCase()];
  const freq = q => FREQ[String(q).toLowerCase()];

  /* "On Saturday evening at The Arena, in front of 312 in Division One", in any of its parts */
  const DL = /^(?:on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (morning|afternoon|evening))?)?(?:(?:^| )at ([^,]+?))?(?:(?:^|,? )in front of (\d+))?(?: in ([^,]+?))?$/i;
  const dl = s => {
    const m = DL.exec(String(s).trim());
    if (!m || !(m[1] || m[3] || m[4] || m[5])) return null;
    return { day: m[1], part: m[2], venue: m[3], crowd: m[4], comp: m[5] && m[5].replace(/^the /i, '') };
  };
  const where = d => {
    if (!d) return '';
    const when = d.day ? DAY[d.day.toLowerCase()] + (d.part ? 'の' + PART[d.part.toLowerCase()] : '') : '';
    let out = '';
    if (when) out += when + (d.venue ? '、' : 'に');
    if (d.venue) out += d.venue + 'で';
    if (out) out += '行われた' + (d.comp ? d.comp + 'の' : '') + '試合は、';
    else if (d.comp) out += d.comp + 'の試合は、';
    if (d.crowd) out += '観衆' + d.crowd + '人の前で';
    return out;
  };
  /* a club name followed by a dateline: the shortest name that leaves a dateline behind it */
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
  const clubs = cs => cs.map(c => c.club + 'では' + c.it.join('、')).join('。');

  const DEED = [
    [rx('{N} came off the bench for {D}{T}'), (p, d, t) => p + 'がベンチから' + line(d, t)],
    [rx('{N} scored {W} straight points in the {O}'), (p, w, o) => p + 'が' + ord(o) + 'に' + n(w) + '連続得点'],
    [rx('{N} pulled down {D} rebounds'), (p, d) => p + 'が' + d + 'リバウンド'],
    [rx('{N} went {D} of {D} from the line'), (p, a, b) => p + 'がフリースロー' + b + '本中' + a + '本成功'],
    [rx('{N} came within a rebound or two of a triple-double'), p => p + 'があと一歩でトリプルダブル']
  ];
  const each = p => names(p).replace(/、([^、]+)$/, 'と$1');
  const SPECIAL = [
    [rx('{L} each had {W} assists'), (p, w) => each(p) + 'がそれぞれ' + n(w) + 'アシスト'],
    [rx('{L} each hit {W} from three'), (p, w) => each(p) + 'がそれぞれ3Pシュートを' + n(w) + '本成功'],
    [rx('{L} each finished with {W} (steals|blocks)(?: and {W} (steals|blocks))?'), (p, a, k, b, k2) => each(p) + 'がそれぞれ' + n(a) + STAT[k.toLowerCase()] + (b ? n(b) + STAT[k2.toLowerCase()] : '')],
    [rx('{N} had {W} assists'), (p, w) => p + 'が' + n(w) + 'アシスト'],
    [rx('{N} hit {W} from three'), (p, w) => p + 'が3Pシュートを' + n(w) + '本成功'],
    [rx('{N} finished with {W} (steals|blocks)(?: and {W} (steals|blocks))?'), (p, a, k, b, k2) => p + 'が' + n(a) + STAT[k.toLowerCase()] + (b ? n(b) + STAT[k2.toLowerCase()] : '')]
  ];
  const first = (list, s) => { for (const [re, fn] of list) { const m = re.exec(s); if (m) { const o = fn(...m.slice(1)); if (o != null) return o; } } return null; };
  /* "Toby Ashworth (five of twelve)" */
  const ROUGH = s => {
    const m = /^([^()]+?) \(([^()]+)\)$/.exec(s);
    if (!m) return null;
    let k;
    const note = /^scoreless$/i.test(m[2]) ? '無得点'
      : (k = new RegExp('^(' + WORDS + ') of (' + WORDS + ')$', 'i').exec(m[2])) ? 'FG' + n(k[1]) + '/' + n(k[2])
      : (k = new RegExp('^missed all (' + WORDS + ')$', 'i').exec(m[2])) ? 'FG0/' + n(k[1])
      : (k = new RegExp('^(' + WORDS + ') turnovers$', 'i').exec(m[2])) ? n(k[1]) + 'ターンオーバー' : null;
    return note == null ? null : m[1] + '（' + note + '）';
  };
  const roughClub = c => { const m = /^(.+?)’s? (.+)$/.exec(c); if (!m) return null; const it = items(m[2], ROUGH); return it ? m[1] + 'の' + it.join('、') : null; };

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Japanese | null]; {X} a name or a subject, {D} a count, {F} a
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
          if (t[5]) d.comp = t[5].replace(/^the /i, '');
          return where(d) + t[1] + 'が' + t[2] + 'を' + sc(t[3], t[4]) + 'で下した';
        }
      }
      return null;
    }],
    ['{X} took this {S}(?: (.+))?', (x, a, b, r) => { const d = r ? dl(r) : null; if (r && !d) return null; return where(d) + S(x, 'が') + sc(a, b) + 'で勝利した'; }],
    ['it finished {S} to (.+)', (a, b, r) => { const [x, d] = nameWhere(r); if (/[,;:—]/.test(x)) return null; return where(d) + sc(a, b) + (a === b ? 'の同点で試合を終えた' : 'で' + x + 'が勝利した'); }],
    ['{X} came through {S}', (x, a, b) => S(x, 'が') + sc(a, b) + 'で勝ち切った'],
    ['this was over early', () => '早々に勝負は決していた'],
    ['{X} won it {S}', (x, a, b) => S(x, 'が') + sc(a, b) + 'で勝利した'],
    ['{X} had trailed by {D}, which makes this the sort of result that says more about the second half than the first',
      (x, d) => S(x) + '最大' + d + '点のビハインドを背負っていた。前半よりも後半が物語る試合だった'],
    ['{X} led by as many as {D}', (x, d) => (/ have$/i.test(x) ? null : S(x) + '最大' + d + '点のリードを奪った')],
    ['it was never close', () => '終始危なげない試合だった'],
    ['it took everything they had', () => '総力を振り絞っての勝利だった'],
    ['were rarely troubled', () => 'ほとんど危なげなかった'],
    ['it still was not enough', () => 'それでも届かなかった'],
    ['it did not last', () => '長くは続かなかった'],

    /* ---- the half ---- */
    ['it did not look that way at the break, when {X} led {S}', (x, a, b) => 'ハーフタイムの時点ではそうは見えず、' + x + 'が' + sc(a, b) + 'とリードしていた'],
    ['{X} went in {D} down at half-time, {S}, and won the second half by {D}',
      (x, d, a, b, e) => S(x) + sc(a, b) + 'と' + d + '点ビハインドで前半を折り返したが、後半を' + e + '点上回った'],
    ['the sides went in level at {D} apiece', d => '前半は' + sc(d, d) + 'の同点で折り返した'],
    ['{X} had the game won by half-time, {S} at the break', (x, a, b) => S(x) + '前半のうちに勝負を決めていた。ハーフタイムのスコアは' + sc(a, b)],
    ['it was {S} to {X} at half-time', (a, b, x) => '前半を終えて' + sc(a, b) + 'で' + x + 'がリード'],
    ['{X} led {S} at the break', (x, a, b) => S(x, 'が') + sc(a, b) + 'とリードして前半を折り返した'],
    ['the half-time score was {S}, {X} in front', (a, b, x) => '前半のスコアは' + sc(a, b) + 'で' + x + 'がリード'],
    ['{X} won the second half by {D}', (x, d) => (/ trailed by /i.test(x) ? null : S(x) + '後半を' + d + '点上回った')],
    ['it took (?:overtime|{D} overtimes): {S} after forty minutes, and {X} won the extra periods? {S}',
      (k, a, b, x, c, d) => (k ? k + '度の' : '') + '延長戦にもつれ込んだ。40分を終えて' + sc(a, b) + '、延長は' + S(x, 'が') + sc(c, d) + 'で制した'],

    /* ---- the run, the quarter, the lead ---- */
    ['the decisive spell was an? {D}–0 run in the {O}, long enough to turn a close game into a lead that held',
      (d, o) => '勝負を分けたのは' + ord(o) + 'の' + sc(d, 0) + 'のランで、接戦を最後まで守り切るリードに変えた'],
    ['it turned on an? {D}–0 burst in the {O}, and the game did not come back',
      (d, o) => ord(o) + 'の' + sc(d, 0) + 'のランで流れが変わり、その後試合が振り出しに戻ることはなかった'],
    ['an? {D}–0 run in the {O} did the damage, and the game never really came back',
      (d, o) => ord(o) + 'の' + sc(d, 0) + 'のランが決定打となり、その後試合がもつれることはなかった'],
    ['the gap opened during an? {D}–0 run in the {O}', (d, o) => ord(o) + 'の' + sc(d, 0) + 'のランで点差が開いた'],
    ['the biggest swing was an? {D}–0 run in the {O} from {X}', (d, o, x) => '最大のランは' + ord(o) + 'に' + x + 'が記録した' + sc(d, 0) + 'だった'],
    ['the longest run of the game was {X}’s? {D}–0 in the {O}', (x, d, o) => 'この試合最長のランは' + ord(o) + 'の' + x + 'による' + sc(d, 0) + 'だった'],
    ['{X} took the period {S}', (x, a, b) => S(x) + 'そのクォーターを' + sc(a, b) + 'で制した'],
    ['{X} had already taken the {O} {S}', (x, o, a, b) => S(x) + 'すでに' + ord(o) + 'を' + sc(a, b) + 'で取っていた'],
    ['{X} won the {O} {S}', (x, o, a, b) => S(x) + ord(o) + 'を' + sc(a, b) + 'で制した'],
    ['{X} were in front at every break', x => S(x) + 'すべてのクォーター終了時にリードしていた'],
    ['{X} were {S} up early', (x, a, b) => S(x) + '序盤に' + sc(a, b) + 'とリードした'],
    ['the lead had changed {D} times? before that', d => 'それまでにリードは' + d + '回入れ替わっていた'],
    ['there were {D} lead changes?(?: and the scores were level {W} times)?, so neither side ever properly settled',
      (d, w) => 'リードチェンジは' + d + '回' + (w ? '、同点は' + n(w) + '回' : '') + 'を数え、どちらも主導権を握りきれなかった'],
    ['the scores were level {W} times', w => '同点は' + n(w) + '回を数えた'],

    /* ---- the finish ---- */
    ['{X} were {W} down with five minutes left and outscored {X} {S} from there',
      (x, w, y, a, b) => S(x) + '残り5分で' + n(w) + '点を追っていたが、そこから' + y + 'を' + sc(a, b) + 'と圧倒した'],
    ['it was (?:level|a {W}-point game) with five minutes to play, and {X} finished it {S}',
      (w, x, a, b) => '残り5分で' + (w ? n(w) + '点差' : '同点') + 'の展開だったが、' + x + 'が最後を' + sc(a, b) + 'で締めた'],
    ['five minutes out it was (?:level|a {W}-point game)(?:, {X} ahead)?, and the last five went {S} to {X}',
      (w, x, a, b, y) => '残り5分の時点で' + (w ? (x ? x + 'が' + n(w) + '点リード' : n(w) + '点差') : '同点') + '、最後の5分間は' + sc(a, b) + 'で' + y + 'が上回った'],
    ['it was still (?:level|a {W}-point game) with five minutes left before {X} closed it out {S}',
      (w, x, a, b) => '残り5分の時点ではまだ' + (w ? n(w) + '点差' : '同点') + 'だったが、' + x + 'が' + sc(a, b) + 'で試合を締めくくった'],
    ['the margin was (?:nothing|only {W}) with five to play, and then {X} finished {S}',
      (w, x, a, b) => '残り5分の点差は' + (w ? 'わずか' + n(w) + '点' : 'ゼロ') + '。そこから' + x + 'が' + sc(a, b) + 'で締めた'],
    ['{X} led by {W} with five minutes to go and had to hang on, {X} taking the last five {S}',
      (x, w, y, a, b) => S(x) + '残り5分で' + n(w) + '点リードしていたが、最後の5分間を' + y + 'に' + sc(a, b) + 'で取られ、辛うじて逃げ切った'],
    ['the last five minutes went {S} to {X}', (a, b, x) => '最後の5分間は' + sc(a, b) + 'で' + x + 'が上回った'],
    ['{X} scored the last {W} points of the game', (x, w) => S(x) + '試合最後の' + n(w) + '点を連取した'],
    ['{X} went {W} of {W} from the line in the last two minutes to see it out',
      (x, a, b) => S(x) + '残り2分でフリースローを' + n(b) + '本中' + n(a) + '本決めて逃げ切った'],
    ['{X} missed {W} of {W} free throws in the last two minutes, in a game they lost by {D}',
      (x, a, b, d) => S(x) + '残り2分でフリースローを' + n(b) + '本中' + n(a) + '本落とし、' + d + '点差で敗れた'],

    /* ---- tempo and the season ---- */
    ['it was played at speed — {F} possessions per 40', f => 'ハイペースな展開で、40分あたりのポゼッション数は' + f],
    ['it was a slow, half-court game at {F} possessions per 40', f => 'ハーフコート中心のスローな展開で、40分あたりのポゼッション数は' + f],
    ['{X} finished on {D} against a season average of {F}', (x, d, f) => S(x) + '今季平均' + f + '得点のところ' + d + '得点を記録した'],
    ['{X} were held to {D}, well short of the {F} they usually manage', (x, d, f) => S(x) + d + '得点に抑えられ、平均の' + f + '得点を大きく下回った'],

    /* ---- where the points came from ---- */
    ['{X} (had|have) the edge {V}: {D} points? from {D} chances?(?:, {F} a time)?, against {X}’s? {D}',
      (x, t, v, p, c, r, y, o) => S(x) + WHERE[v.toLowerCase()] + 'で優位に' + (/^had$/i.test(t) ? '立った' : '立っている') + '。' +
        c + '回のチャンスで' + p + '得点' + (r ? '（1回あたり' + r + '点）' : '') + '、' + y + 'は' + o + '得点'],
    ['{V} it (?:was|is) {S} to {X}( so far)?, from {D} chances?(?:, {F} a time)?',
      (v, a, b, x, far, c, r) => WHERE[v.toLowerCase()] + 'では' + (far ? 'ここまで' : '') + x + 'が' + sc(a, b) + 'と上回り、' +
        c + '回のチャンス' + (r ? 'で1回あたり' + r + '点' : 'から得点') ],
    ['they (got|are getting) {D}% of their chances that way, {R}', (t, d, r) => 'チャンス全体の' + d + '%がこの形で、' + freq(r)],
    ['in the half court, where most of any game is played, {X} scored {F} points a chance to {F}',
      (x, a, b) => '試合の大半を占めるハーフコートでは、' + S(x) + '1チャンスあたり' + a + '点を挙げ、相手は' + b + '点だった'],
    ['{X} were the better set offence — {F} points a chance in the half court against {F}',
      (x, a, b) => S(x) + 'セットオフェンスで上回り、ハーフコートでの1チャンスあたりの得点は' + a + '対' + b],
    ['in the half court {X} are getting {F} points a chance to {F}', (x, a, b) => 'ハーフコートでは' + S(x) + '1チャンスあたり' + a + '点、相手は' + b + '点'],
    ['{X} have been the better set offence, {F} a chance in the half court against {F}',
      (x, a, b) => S(x) + 'ここまでセットオフェンスで上回り、ハーフコートでの1チャンスあたりの得点は' + a + '対' + b],
    ['{X} (lived|are living) {V}: {D}% of their chances (?:came|have come) that way, {R}',
      (x, t, v, d, r) => S(x) + WHERE[v.toLowerCase()] + 'を軸に' + (/^lived$/i.test(t) ? '攻めた' : '攻めている') + '。チャンス全体の' + d + '%がこの形で、' + freq(r)],
    ['out of timeouts {X} (were|have been) sharp: {W} points? from {W} possessions',
      (x, t, p, c) => 'タイムアウト明けの' + (who(x) ? who(x) + 'は' : '攻撃は') + '好調で、' + n(c) + '回のポゼッションで' + n(p) + '得点'],
    ['{X} (got|are getting) nothing out of their timeouts, {W} points? from {W} possessions',
      (x, t, p, c) => S(x) + 'タイムアウト明けに結果を出せず、' + n(c) + '回のポゼッションで' + n(p) + '得点'],

    /* ---- the box score, said ---- */
    ['from the floor it was {D}% to {D}% in {X}’s? favour', (a, b, x) => 'FG成功率は' + a + '%対' + b + '%で' + who(x) + 'が上回った'],
    ['{X} shot {D}% from the field to {D}%', (x, a, b) => S(x) + 'FG成功率' + a + '%で、相手は' + b + '%'],
    ['{X} made {D} of {D} from three', (x, a, b) => S(x) + '3Pシュートを' + b + '本中' + a + '本成功させた'],
    ['{X} went {D} of {D} from three', (x, a, b) => S(x) + '3Pシュートが' + b + '本中' + a + '本と不調だった'],
    ['{X} made only {D} of {D} free throws', (x, a, b) => S(x) + 'フリースローが' + b + '本中' + a + '本にとどまった'],
    ['{X} won the boards {S}', (x, a, b) => S(x) + 'リバウンドで' + sc(a, b) + 'と上回った'],
    ['{X} scored {D} on the break to {D}', (x, a, b) => S(x) + 'ファストブレイクからの得点で' + sc(a, b) + 'と上回った'],
    ['{X} gave the ball away {D} times', (x, d) => S(x) + d + '本のターンオーバーを犯した'],
    ['{X} went {M} without a field goal in the {O}', (x, m, o) => S(x) + ord(o) + 'に' + dur(m) + '間フィールドゴールがなかった'],
    ['{X} shot it better, {F}% eFG against {F}%', (x, a, b) => S(x) + 'シュートで上回り、EFG%は' + a + '%対' + b + '%'],
    ['{X} were the sharper side from the floor — {F}% eFG to {F}%', (x, a, b) => S(x) + 'シュートの精度で上回った。EFG%は' + a + '%対' + b + '%'],
    ['the shooting decided it: {X} at {F}% eFG, their opponents at {F}%', (x, a, b) => 'シュートが勝負を決めた。' + (who(x) ? who(x) + 'の' : '') + 'EFG%は' + a + '%、相手は' + b + '%'],
    ['{X} looked after the ball, giving it up on {F}% of their possessions against {F}%', (x, a, b) => S(x) + 'ボールを大事にし、ターンオーバー率は' + a + '%（相手は' + b + '%）'],
    ['{X} were far the more careful side, an? {F}% turnover rate to {F}%', (x, a, b) => S(x) + 'はるかにミスが少なく、ターンオーバー率は' + a + '%対' + b + '%'],
    ['possessions were the difference — {X} turned it over on {F}% of theirs, their opponents on {F}%',
      (x, a, b) => 'ポゼッションが差となった。' + (who(x) ? who(x) + 'の' : '') + 'ターンオーバー率は' + a + '%、相手は' + b + '%'],
    ['{X} owned the offensive glass, rebounding {F}% of their own misses to {F}%', (x, a, b) => S(x) + 'オフェンスリバウンドを支配し、自らのミスの' + a + '%を回収した（相手は' + b + '%）'],
    ['{X} kept possessions alive — {F}% of their misses came back to them, against {F}%', (x, a, b) => S(x) + '攻撃をつなぎ続けた。ミスの' + a + '%をリバウンドで取り返し、相手は' + b + '%'],
    ['the second shots went one way: {X} recovered {F}% of their own misses to {F}%', (x, a, b) => 'セカンドショットは一方的だった。' + S(x) + '自らのミスの' + a + '%を回収し、相手は' + b + '%'],
    ['{X} got to the line far more often — {D} free throws for every hundred shots, against {D}', (x, a, b) => S(x) + 'はるかに多くフリースローを獲得した。シュート100本あたり' + a + '本（相手は' + b + '本）'],
    ['{X} lived at the line, drawing {D} free-throw attempts per hundred field goals to {D}', (x, a, b) => S(x) + 'フリースローを量産し、FG試投100本あたり' + a + '本（相手は' + b + '本）'],
    ['the whistle paid {X}: {D} free throws per hundred shots, their opponents {D}', (x, a, b) => '笛は' + (who(x) || 'このチーム') + 'に味方した。シュート100本あたりのフリースローは' + a + '本、相手は' + b + '本'],
    ['they had the better of (.+?) too', l => { const t = labs(l); return t && t + 'でも上回った'; }],
    ['(.+?) went their way as well', l => { const t = labs(l); return t && t + 'でも上回った'; }],
    ['{X} took the game outside — {F}% of their shots came from three, against {F}%(?:, and made {F}% of them)?',
      (x, a, b, c) => S(x) + 'アウトサイド中心に攻め、シュートの' + a + '%が3P（相手は' + b + '%）' + (c ? '、成功率は' + c + '%' : '')],
    ['{X} went inside — {F}% of their attempts came at the rim, against {F}%(?:, and made {F}% of them)?',
      (x, a, b, c) => S(x) + 'インサイドを攻め、試投の' + a + '%がゴール下（相手は' + b + '%）' + (c ? '、成功率は' + c + '%' : '')],
    ['{X} moved it well, assisting on {F}% of their field goals', (x, a) => S(x) + 'ボールがよく回り、FG成功の' + a + '%がアシストによるものだった'],
    ['{X} defended better, giving up {F} points per 100 possessions to {F}', (x, a, b) => S(x) + '守備で上回り、100ポゼッションあたりの失点は' + a + '（相手は' + b + '）'],
    ['{X} forced the ball loose all night — their opponents coughed it up on {F}% of possessions', (x, a) => S(x) + '試合を通じてボールを奪い続け、相手のターンオーバー率は' + a + '%に達した'],
    ['{P} hands were everywhere: {D} steals? and {D} blocks?', (p, s, b) => own(p) + '守備では手がよく出て、' + s + 'スティール' + b + 'ブロックを記録した'],
    ['both sides lived off second chances — {D} points for {X}, {D} for {X}', (a, x, b, y) => '両チームともセカンドチャンスから得点を重ねた。' + x + 'が' + a + '得点、' + y + 'が' + b + '得点'],
    ['turnovers were punished at both ends: {D} points off them for {X}, {D} for {X}', (a, x, b, y) => 'ターンオーバーは両チームとも失点に直結し、ターンオーバーからの得点は' + x + 'が' + a + '、' + y + 'が' + b],
    ['{P} bench put up {D} to {D}', (p, a, b) => own(p) + 'ベンチ陣は' + a + '得点を挙げ、相手ベンチは' + b + '得点'],
    ['{X} turned giveaways into {D} points', (x, d) => S(x) + '相手のターンオーバーから' + d + '得点'],
    ['{X} scored {D} in the paint to {D}', (x, a, b) => S(x) + 'ペイントエリアで' + a + '得点（相手は' + b + '得点）'],
    ['{X} found {D} second-chance points', (x, d) => S(x) + 'セカンドチャンスから' + d + '得点'],
    ['the whistle fell one way: {X} were called for {D} fouls to {D}', (x, a, b) => '笛は一方に傾いた。' + (who(x) ? who(x) + 'の' : '') + 'ファウルは' + a + '、相手は' + b],

    /* ---- on the floor ---- */
    ['the five who did it: {L} for {X}, together for the whole of that swing', (f, x) => 'その流れを生んだのは' + x + 'の' + names(f) + 'の5人で、その間ずっと一緒にコートに立っていた'],
    ['the damage was done with {L} on the floor for {X}, a group outscored by {D} in that time', (f, x, d) => x + 'は' + names(f) + 'がコートにいた時間帯に流れを失い、このユニットはその間に' + d + '点下回った'],
    ['the game turned inside a single {M} spell with {L} on the floor for {X}: they (gained|were outscored by) {D} points in that stretch alone',
      (m, f, x, g, d) => '試合はわずか' + dur(m) + 'の時間帯で動いた。コートにいたのは' + x + 'の' + names(f) + 'で、この時間帯だけで' + d + (/^gained$/i.test(g) ? '点を稼いだ' : '点を失った')],
    ['nothing else in the game moved the scoreboard as far in as little time', () => 'これほど短い時間で点差が大きく動いた場面はほかになかった'],
    ['across every minute they shared, {X}’s? five from that swing were ([+-]?\\d+) in {M}', (x, pm, m) => 'その流れを生んだ' + x + 'の5人は、共にコートに立った' + dur(m) + 'で' + pm],
    ['{P} strongest group — {L} — was ([+-]?\\d+) across {M}', (p, f, pm, m) => own(p) + '最も機能したユニット（' + names(f) + '）は' + dur(m) + 'で' + pm],
    ['(at the other end of it, |at the other end, |the reverse was true at the other end: ){X} lost {D} points in {M} with {L} out there — the combination that cost them most',
      (pre, x, d, m, f) => (/reverse/i.test(pre) ? '反対に、' : '一方で、') + S(x) + names(f) + 'がコートにいた' + dur(m) + 'で' + d + '点を失った。最も痛手となった組み合わせだ'],

    /* ---- the performances ---- */
    ['{X} led {X} with {D} points{T}(, a season high)?(, a triple-double)?',
      (p, x, d, t, hi, td) => x + 'は' + p + 'が' + line(d, t) + (hi ? '（今季最多）' : '') + (td ? 'のトリプルダブル' : '') + 'でチームをけん引した'],
    ['{X} top-scored for {X} with {D}{T}(, a triple-double)?', (p, x, d, t, td) => x + 'は' + p + 'がチーム最多の' + line(d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} had {D} points{T} from {X}(, a triple-double)?', (x, d, t, p, td) => x + 'は' + p + 'が' + line(d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} answered with {D}{T}(, a triple-double)? for {X}', (p, d, t, td, x) => x + 'は' + p + 'が' + line(d, t) + (td ? 'のトリプルダブル' : '') + 'で応戦した'],
    ['for {X}, {X} had {D}{T}(, a triple-double)?', (x, p, d, t, td) => x + 'は' + p + 'が' + line(d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} finished with {D}{T}(, a triple-double)? for {X}', (p, d, t, td, x) => x + 'の' + p + 'は' + line(d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} had a triple-double for {X}: (.+)', (p, x, l) => {
      const parts = l.split(/, | and /).map(s => { const m = /^(\d+) (points|rebounds|assists|steals|blocks)$/i.exec(s); return m ? m[1] + STAT[m[2].toLowerCase()] : null; });
      return parts.indexOf(null) >= 0 ? null : x + 'の' + p + 'がトリプルダブルを達成。' + parts.join('');
    }],
    ['(.+?)(, well up on his usual)?', (s, up) => {
      /* "A added 14 and B 12 for X" */
      const one = t => { const m = rx('{N} added {D}').exec(t) || rx('{N} {D}').exec(t); return m ? m[1] + 'が' + m[2] + '得点' : null; };
      if (!/ added \d/.test(s)) return null;
      const cs = byClub(s, one);
      return cs && clubs(cs) + (up ? '（平均を大きく上回る数字）' : '');
    }],
    ['(.+)', s => { const cs = byClub(s, t => first(DEED, t)); return cs && clubs(cs); }],
    ['(.+)', s => { const cs = byClub(s, t => first(SPECIAL, t)); return cs && clubs(cs); }],
    ['it was a long night for (.+?)(?:, and for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : ''; return x && y != null ? x + (y ? '、' + y : '') + 'にとっては長い夜となった' : null; }],
    ['little went right for (.+?)(?:, or for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : ''; return x && y != null ? x + (y ? '、' + y : '') + 'は何をやってもうまくいかなかった' : null; }],
    ['(.+?) never got going(?:, and neither did (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : ''; return x && y != null ? x + 'は最後まで波に乗れず' + (y ? '、' + y + 'も同様だった' : '') : null; }],
    ['{X} lost {L} to fouls(?:, and {X} lost {L} the same way)?', (x, a, y, b) => x + 'は' + names(a) + 'がファウルアウト' + (y ? '、' + y + 'も' + names(b) + 'がファウルアウトとなった' : 'となった')],

    /* ---- the scout's note ---- */
    ['{X} won this on (.+?) before anything else: they were {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && x + 'が何よりも上回ったのは' + lab(l) + '。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だった'],
    ['{X} have had the better of (.+?) more than anything: they have been {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && x + 'が最も上回っているのは' + lab(l) + '。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だ'],
    ['the widest gap between them was (.+?), and it went {X}’s? way — they were {Q} there, {X} {Q} — but it was not enough',
      (l, x, q, y, r) => lab(l) && '両チームの差が最も大きかったのは' + lab(l) + 'で、' + x + 'が上回った。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だったが、勝利には届かなかった'],
    ['the widest gap so far is (.+?), and it favours {X}(, who trail)?: they have been {Q} there, {X} {Q}',
      (l, x, tr, q, y, r) => lab(l) && 'ここまで最も差が大きいのは' + lab(l) + 'で、' + (tr ? 'リードを許している' : '') + x + 'が上回っている。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だ'],
    ['the other gaps (worth the film room|to watch after the break): (.+)', (w, list) => {
      const it = list.split(/\) and /).map((s, i, a) => (i < a.length - 1 ? s + ')' : s)).map(s => {
        const m = /^(.+?) \((.*?), (\d+) percentile points clear\)$/.exec(s);
        return m && lab(m[1]) ? lab(m[1]) + '（' + (m[2] || '—') + '、' + m[3] + 'パーセンタイル差）' : null;
      });
      return it.indexOf(null) >= 0 ? null : (/film/i.test(w) ? 'ビデオで確認したいその他の差：' : '後半に向けて注目すべきその他の差：') + it.join('、');
    }],
    ['{X} (came out ahead|are ahead) on (.+?), and with no league scales built for this competition yet those are the two sides against each other rather than against anybody else',
      (x, t, l) => labs(l) && x + 'は' + labs(l) + 'で' + (/came/i.test(t) ? '上回った' : '上回っている') + '。この大会にはまだリーグの基準データがないため、あくまで両チーム同士の比較だ'],
    ['{X} (had|have had) the better of (.+?) — (?:the part of their game that did not cost them|something to build on after the break)',
      (x, t, l) => labs(l) && x + 'は' + labs(l) + 'で' + (/^had$/i.test(t) ? '上回った。敗因とはならなかった部分だ' : '上回っている。後半に向けた好材料だ')],
    ['{X} (?:did their best work|are doing their best work) on (.+?), where they (were|have been) {Q}(?:, with (.+?) not far behind)?',
      (x, l, t, q, r) => lab(l) && (!r || labs(r)) && x + 'が' + (/^were$/i.test(t) ? '最も良かった' : '最も良い') + 'のは' + lab(l) + 'で、' + pct(q) + (/^were$/i.test(t) ? 'だった' : 'だ') + (r ? '。' + labs(r) + 'もそれに続いた' : '')],
    ['what they will (?:still want back|want to tighten) starts with (.+?), where they (were|have been) {Q}(?:; (.+?) (?:lagged too|are lagging too))?',
      (l, t, q, r) => lab(l) && (!r || labs(r)) && '課題はまず' + lab(l) + 'で、' + pct(q) + (/^were$/i.test(t) ? 'だった' : 'だ') + (r ? '。' + labs(r) + 'も' + (/^were$/i.test(t) ? '物足りなかった' : '物足りない') : '')],
    ['{X} (also struggled|are also struggling) with (.+?)', (x, t, l) => labs(l) && S(x) + labs(l) + 'でも' + (/struggled/i.test(t) ? '苦戦した' : '苦戦している')],
    ['if there is one thing to take into the week, it is (.+?): {X} were {Q} there, further behind the league than anything else in their game',
      (l, y, q) => lab(l) && '今週に持ち込む課題を一つ挙げるなら' + lab(l) + '。' + y + 'は' + pct(q) + 'で、チームの中で最もリーグに後れを取っている部分だ'],
    ['the one thing to fix at the break is (.+?): {X} have been {Q} there, further behind the league than anything else in their game',
      (l, y, q) => lab(l) && 'ハーフタイムで修正すべきは' + lab(l) + '。' + y + 'は' + pct(q) + 'で、チームの中で最もリーグに後れを取っている部分だ'],

    /* ---- the half-time report ---- */
    ['{X} had the best spell of the half, an? {D}–0 run in the {O}', (x, d, o) => '前半最高の時間帯を作ったのは' + (who(x) || 'このチーム') + 'で、' + ord(o) + 'に' + sc(d, 0) + 'のランを見せた'],
    ['{X} have led by as many as {D}(, and have given most of it back|, and all of it has gone)?',
      (x, d, t) => S(x) + '最大' + d + '点リードした' + (!t ? '' : /most/i.test(t) ? 'が、その大半を吐き出した' : 'が、そのリードはすべて消えた')],
    ['the lead has already changed hands {D} times', d => 'リードはすでに' + d + '回入れ替わっている'],
    ['{X} are shooting {D}% from the field to {D}%', (x, a, b) => S(x) + 'FG成功率' + a + '%で、相手は' + b + '%'],
    ['{X} are the sharper side, {F}% eFG to {F}%', (x, a, b) => S(x) + 'シュートの精度で上回っており、EFG%は' + a + '%対' + b + '%'],
    ['{X} are looking after the ball, turning it over on {F}% of possessions to {F}%', (x, a, b) => S(x) + 'ボールを大事にしており、ターンオーバー率は' + a + '%（相手は' + b + '%）'],
    ['{X} own the offensive glass so far, getting {F}% of their misses back to {F}%', (x, a, b) => S(x) + 'ここまでオフェンスリバウンドを支配し、ミスの' + a + '%を取り返している（相手は' + b + '%）'],
    ['{X} are living at the line, {D} free throws per hundred shots to {D}', (x, a, b) => S(x) + 'フリースローを量産しており、シュート100本あたり' + a + '本（相手は' + b + '本）'],
    ['(.+ has \\d+ for .+)', s => {
      const one = rx('{N} has {D} for {N}(?: on {W} of {W} shooting)?{T}(?:, with {N} on {D})?');
      const out = s.split('; ').map(p => {
        const m = one.exec(p);
        if (!m) return null;
        return m[3] + 'では' + m[1] + 'が' + line(m[2], m[6]) + (m[4] ? '（FG' + n(m[4]) + '/' + n(m[5]) + '）' : '') + (m[7] ? '、' + m[7] + 'が' + m[8] + '得点' : '');
      });
      return out.indexOf(null) >= 0 ? null : out.join('。');
    }],
    ['foul trouble to watch: (.+?)(, among others)?', (l, more) => {
      const it = items(l, t => { const m = rx('{N} of {N} with {W}').exec(t); return m ? m[2] + 'の' + m[1] + '（' + n(m[3]) + 'ファウル）' : null; });
      return it && 'ファウルトラブルに注意：' + it.join('、') + (more ? 'ほか' : '');
    }],
    ['twenty minutes in there is nothing between them: {X} took the first quarter {S} and {X} answered with the second, {S}',
      (x, a, b, y, c, d) => '20分を終えて両チームに差はない。' + x + 'が第1クォーターを' + sc(a, b) + 'で取り、' + y + 'が第2クォーターを' + sc(c, d) + 'で取り返した'],
    ['twenty minutes in there is nothing between them', () => '20分を終えて両チームに差はない'],
    ['{X} have won both quarters, {S} and {S}', (x, a, b, c, d) => x + 'が第1、第2クォーターをともに制した（' + sc(a, b) + '、' + sc(c, d) + '）'],
    ['{X} (were level|trailed) after one and took over in the second, winning it {S}',
      (x, t, a, b) => x + 'は第1クォーターを' + (/level/i.test(t) ? '同点' : 'ビハインド') + 'で終えたが、第2クォーターを' + sc(a, b) + 'で制して主導権を握った'],
    ['{X} built the lead in the first quarter, {S}, and {X} have been chipping at it since',
      (x, a, b, y) => x + 'は第1クォーターを' + sc(a, b) + 'としてリードを築き、その後は' + y + 'が差を詰めている'],
    ['{X} built the lead in the first quarter, {S}, and have held on to it since', (x, a, b) => x + 'は第1クォーターを' + sc(a, b) + 'としてリードを築き、その後もリードを保っている'],
    ['{X} lead by {D}', (x, d) => x + 'が' + d + '点リード'],

    /* ---- the headline and the standfirst ---- */
    ['{X} and {X} level at {S} at the half', (x, y, a, b) => x + 'と' + y + 'が' + sc(a, b) + 'の同点で前半を折り返す'],
    ['{X} edge {X} {S} at the break', (x, y, a, b) => x + 'が' + y + 'に' + sc(a, b) + 'とリードして前半終了'],
    ['{X} lead {X} by {D} at the half', (x, y, d) => x + 'が' + y + 'に' + d + '点リードで前半を折り返す'],
    ['{X} lead {X} {S} at the half', (x, y, a, b) => x + 'が' + y + 'を' + sc(a, b) + 'とリードして前半終了'],
    ['{X} and {X} tie {S}', (x, y, a, b) => x + 'と' + y + 'が' + sc(a, b) + 'で引き分け'],
    ['{X} outlast {X} in overtime, {S}', (x, y, a, b) => x + 'が延長戦の末に' + y + 'を' + sc(a, b) + 'で下す'],
    ['{X} steal it late from {X}, {S}', (x, y, a, b) => x + 'が終盤に逆転、' + y + 'に' + sc(a, b) + 'で勝利'],
    ['{X} overturn {D} to beat {X}', (x, d, y) => x + 'が' + d + '点差をひっくり返し' + y + 'に逆転勝利'],
    ['{X} come from behind to beat {X} {S}', (x, y, a, b) => x + 'が' + y + 'に' + sc(a, b) + 'で逆転勝利'],
    ['{X} pull away late from {X}, {S}', (x, y, a, b) => x + 'が終盤に突き放し、' + y + 'に' + sc(a, b) + 'で勝利'],
    ['{X}’s? triple-double carries {X}', (p, x) => p + 'のトリプルダブルで' + x + 'が勝利'],
    ['{X} overwhelm {X}, {S}', (x, y, a, b) => x + 'が' + y + 'に' + sc(a, b) + 'で圧勝'],
    ['{X} edge {X} {S}', (x, y, a, b) => x + 'が' + y + 'に' + sc(a, b) + 'で競り勝つ'],
    ['{X}’s? {D} sees off {X}', (p, d, y) => p + 'が' + d + '得点の活躍、' + y + 'を下す'],
    ['{X} beat {X} {S}', (x, y, a, b) => (/^(on|at|in front of) /i.test(x) ? null : x + 'が' + y + 'に' + sc(a, b) + 'で勝利')],
    ['an? {D}–0 run in the {O} settled it', (d, o) => ord(o) + 'の' + sc(d, 0) + 'のランが勝負を決めた'],
    ['a {M} stretch swung it by {D}', (m, d) => dur(m) + 'の時間帯で点差が' + d + '点動き、勝負が決まった'],
    ['the shooting went {X}’s? way, {F}% eFG to {F}%', (x, a, b) => 'シュートは' + x + 'が上回り、EFG%は' + a + '%対' + b + '%'],
    ['possessions decided it: {F}% turnover rate for {X}, {F}% against', (a, x, b) => 'ポゼッションが勝負を分けた。' + x + 'のターンオーバー率は' + a + '%、相手は' + b + '%'],
    ['the offensive glass belonged to {X}, {F}% to {F}%', (x, a, b) => 'オフェンスリバウンドは' + x + 'が支配し、' + a + '%対' + b + '%'],
    ['the whistle sent {X} to the line far more often', x => x + 'のほうがはるかに多くフリースローを得た'],
    ['{X} were {D} down with five minutes left', (x, d) => x + 'は残り5分で' + d + '点を追っていた'],
    ['a {D}-point lead with five to play nearly went', d => '残り5分での' + d + '点リードが危うく消えかけた'],
    ['it was {S} with five minutes left, and then it was not', (a, b) => '残り5分で' + sc(a, b) + '。そこから一気に差が開いた'],
    ['it was {S} with five to play', (a, b) => '残り5分の時点で' + sc(a, b)],
    ['{X} trailed by {D} at the break and won the second half by {D}', (x, d, e) => x + 'は前半を' + d + '点ビハインドで折り返し、後半を' + e + '点上回った'],
    ['it stayed tight throughout', () => '最後まで接戦が続いた'],
    ['a {D}-point margin', d => d + '点差の決着'],
    ['full time', () => '試合終了'],

    /* ---- the preview ---- */
    ['on the season so far there is almost nothing between them: {X} at {F} net points per 100 possessions, {X} at {F}',
      (x, a, y, b) => '今季ここまで両チームにほとんど差はない。' + x + 'のNETRTGは' + a + '、' + y + 'は' + b],
    ['{X} have been the better team (by a distance|clearly|narrowly) — {F} net points per 100 against {F} for {X}',
      (x, h, a, b, y) => x + 'は' + y + 'を' + ({ 'by a distance': '大きく', clearly: 'はっきりと', narrowly: 'わずかに' })[h.toLowerCase()] + '上回っている。NETRTGは' + a + '対' + b],
    ['the matchup to watch is {X}’s? (shooting|turnovers|offensive glass|free throws) against {X}’s?: on (effective field goal %|turnover rate|offensive rebound %|free throw rate) {X} post {F}% where {X} concede {F}%',
      (x, l, y, f, x2, a, y2, b) => '注目は' + x + 'の' + lab(l) + 'と' + y + 'の守備のマッチアップ。' + x + 'の' +
        ({ 'effective field goal %': 'EFG%', 'turnover rate': 'ターンオーバー率', 'offensive rebound %': 'オフェンスリバウンド率', 'free throw rate': 'FT試投率' })[f.toLowerCase()] +
        'は' + a + '%、' + y + 'が許している数字は' + b + '%'],
    ['they want different games: {X} have played at {F} possessions per 40 to {X}’s? {F}, so whoever sets the tempo has already won something',
      (x, a, y, b) => '両チームが望む展開は異なる。' + x + 'は40分あたり' + a + 'ポゼッション、' + y + 'は' + b + 'で、ペースを握った方が一歩リードする'],
    ['{X} live behind the arc — {F}% of their shots are threes(?:, at {F}%)? — which makes this a game that can swing quickly either way',
      (x, s, a) => x + 'は3Pシュートが主体で、シュートの' + s + '%が3P' + (a ? '（成功率' + a + '%）' : '') + '。どちらにも一気に傾きうる試合だ'],
    ['{X} have looked after the ball far better — an? {F} point gap in turnover rate is possessions handed over, and that is usually the game',
      (x, f) => x + 'のほうがはるかにボールを大事にしている。ターンオーバー率' + f + 'ポイントの差は相手に渡すポゼッションの差で、たいていそれが勝敗を分ける'],
    ['{X} is the one to watch for {X} — (.+)', (p, x, b) => {
      const bits = b.split(' and ').map(s => { let m;
        return (m = /^scoring at (-?[\d.]+)% true shooting$/i.exec(s)) ? 'TS% ' + m[1] + '%の高効率で得点'
          : (m = /^(-?[\d.]+) assists for every turnover$/i.exec(s)) ? 'アシスト/ターンオーバー比' + m[1]
          : (m = /^(-?[\d.]+)% from three on real volume$/i.exec(s)) ? '十分な試投数で3P成功率' + m[1] + '%'
          : (m = /^(-?[\d.]+) rebounds a game$/i.exec(s)) ? '1試合平均' + m[1] + 'リバウンド' : null; });
      return bits.indexOf(null) >= 0 ? null : x + 'の注目選手は' + p + '。' + bits.join('、');
    }],
    ['neither club has a finished game in this season’s records yet, so there is nothing to read into', () => '今季はまだどちらのクラブも試合を終えていないため、読み取れる材料はない'],
    ['this preview fills itself in as results come through', () => 'この見どころは結果が出るたびに自動で更新される'],
    ['early days — {X} have {D} games? on the board and {X} {D}', (x, a, y, b) => 'まだシーズン序盤。' + x + 'は' + a + '試合、' + y + 'は' + b + '試合を終えたところ'],
    ['rate statistics this early describe the schedule more than the teams, so take the shape below lightly', () => 'この時期の率スタッツはチームの実力よりも日程を反映しているため、以下の傾向は参考程度に'],
    ['confirmed at the table', () => 'オフィシャルテーブルで確定'],
    ['tip-off is (.+)', t => 'ティップオフは' + t],
    ['tipped off at (.+)', t => t + 'にティップオフ'],
    ['worked out from the box scores: players each club was using who have not taken the floor since', () => 'ボックススコアから算出：各クラブが起用していたものの、それ以降コートに立っていない選手'],
    ['nobody files this, and it clears itself the moment they play', () => '公式の届け出ではなく、その選手が出場した時点で自動的に消える'],
    ['nobody missing', () => '欠場者なし'],

    /* ---- the injury wire ---- */
    ['(out|did not play) for the last (?:game|{D} games)', (w, d) => '直近' + (d || 1) + '試合' + (/^out$/i.test(w) ? '欠場' : '出場なし')],
    ['{F} minutes last time out', f => '前回出場時' + f + '分'],
    ['{F} minutes a game', f => '1試合平均' + f + '分'],
    ['{D} of the club’s last {D}, {F} minutes a game', (a, b, f) => 'クラブの直近' + b + '試合中' + a + '試合に出場、1試合平均' + f + '分'],
    ['long-term', () => '長期離脱'],
    ['{X} is released — off the report and the previews', x => x + 'は退団扱いとなり、欠場情報と見どころから外れました'],

    /* ---- the weekly report ---- */
    ['{X} played (?:one game|{D} games)(?: \\((\\d+)-(\\d+)\\))? this week', (x, d, w, l) => ({ 'this team': 'このチーム', 'this player': 'この選手' }[x.toLowerCase()] || x) + 'は今週' + (d || 1) + '試合を戦った' + (w != null ? '（' + w + '勝' + l + '敗）' : '')],
    ['read against every other (game|run of games) in this league, here is where the week sat',
      g => 'リーグのほかのすべての' + (/^game$/i.test(g) ? '試合' : '同じ試合数の期間') + 'と比べた、今週の位置づけは以下のとおり'],
    ['there are no league scales built for this competition yet, so these are the week’s own numbers with nothing to read them against',
      () => 'この大会にはまだリーグの基準データがないため、比較対象のない今週の数字のみを示す'],
    ['(.+?) was {Q} — the part of the week that needs no fixing, only repeating', (l, q) => lab(l) && lab(l) + 'は' + pct(q) + '。修正の必要はなく、続けるだけでいい部分だ'],
    ['(.+?) was {Q}, and it is the furthest behind the league of anything here — the one to take into Tuesday',
      (l, q) => lab(l) && lab(l) + 'は' + pct(q) + 'で、ここに挙げた中で最もリーグに後れを取っている。火曜日に持ち込むべき課題だ'],
    ['nothing in the week stood out in either direction: every measure landed in the middle of the league', () => '今週はどちらの方向にも目立つ数字はなく、すべての指標がリーグ中位に収まった'],
    ['that is a week to build on rather than to react to', () => '慌てて手を打つより、土台にすべき一週間だ'],
    ['for shape rather than score: (.+)', l => {
      const it = l.split(', ').map(s => { const m = /^(.+?) was (\d+)(?:st|nd|rd|th) percentile$/i.exec(s); return m && lab(m[1]) ? lab(m[1]) + 'は' + m[2] + 'パーセンタイル' : null; });
      return it.indexOf(null) >= 0 ? null : 'スコアではなくスタイルとして：' + it.join('、');
    }],
    ['neither answer is the right one; it is worth knowing which one you chose', () => 'どちらが正解ということはない。どちらを選んだのかを知っておく価値がある'],
    ['one game is one game', () => '1試合は1試合にすぎない'],
    ['the scales already pull a single night back towards the league, but treat everything above as a question for next week rather than an answer',
      () => 'スケールはすでに1試合の数字をリーグ平均側に補正しているが、上の内容は答えではなく来週への問いとして扱ってほしい'],
    ['no games in this window yet — the report fills in as soon as one is played', () => 'この期間の試合はまだない。試合が行われ次第、レポートが作成される'],
    ['the week could not be read just now', () => '今週のデータを読み込めませんでした'],
    ['try again in a moment', () => 'しばらくしてからもう一度お試しください'],
    ['(.+)', l => labs(l)],

    /* ---- the filed article, and the report's cards ---- */
    ['written automatically from the play-by-play the moment this game was finalised', () => '試合確定と同時に、テキスト速報のデータから自動で作成された記事です'],
    ['every number above is computed from the same replay that draws the box score: (\\S+)', u => '上記の数字はすべて、ボックススコアと同じリプレイから算出されています：' + u],
    ['{D}/{D} fg', (a, b) => 'FG ' + a + '/' + b],
    ['{F}% TS', f => 'TS% ' + f + '%'],
    ['{D}/{D} 3pt', (a, b) => '3P ' + a + '/' + b],
    ['{F} net', f => 'NETRTG ' + f]
  ];

  /* ---- clauses that hang off a sentence, and the joins between two ---- */
  const TAILS = [
    [/^(.+), and it was never close$/i, a => a + '。終始危なげない試合だった'],
    [/^(.+), and it took everything they had$/i, a => a + '。総力を振り絞っての勝利だった'],
    [/^(.+), and were rarely troubled$/i, a => a + '。ほとんど危なげなかった'],
    [/^(.+), pulling clear when it mattered$/i, a => a + '。勝負どころで突き放した'],
    [/^(.+), on a night that could have gone either way$/i, a => a + '。どちらに転んでもおかしくない一戦だった'],
    [/^(.+), but only just$/i, a => a + '。ぎりぎりの勝利だった'],
    [/^(.+), and it did not last$/i, a => a + 'が、長くは続かなかった'],
    [/^(.+), and it still was not enough$/i, a => a + 'が、それでも届かなかった'],
    [/^(.+), the period that separated them$/i, a => a + '。このクォーターが両チームの差となった'],
    [new RegExp('^(.+), helped by an? (\\d+)–0 run in the ' + TOK.O + '$', 'i'), (a, d, o) => a + '。' + ord(o) + 'の' + sc(d, 0) + 'のランが大きかった'],
    [/^(.+), and had the better of (.+?) too$/i, (a, l) => labs(l) && a + '。' + labs(l) + 'でも上回った'],
    [/^(.+), with (.+?) going the same way$/i, (a, l) => labs(l) && a + '。' + labs(l) + 'でも上回った']
  ];
  const PREFIX = [
    [/^even so, (.+)$/i, b => 'それでも、' + b],
    [/^in turn, (.+)$/i, b => 'さらに、' + b],
    [/^from there, (.+)$/i, b => 'そこから、' + b]
  ];
  const JOINS = [
    [', which is why ', (a, b) => a + '。だからこそ' + b],
    [', and ', (a, b) => a + '。' + b],
    [', but ', (a, b) => a + '。だが、' + b],
    [', though ', (a, b) => a + '。ただ、' + b],
    [', so ', (a, b) => a + '。そのため、' + b],
    ['; ', (a, b) => a + '。' + b]
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
  const finish = (out, whole) => (out == null ? null : out + (/\.$/.test(whole) ? '。' : ''));
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

  I.register('ja', {
    phrases: {
      'Scoring by period': 'クォーター別得点',
      'Who was on the floor': 'コート上のメンバー',
      'Leading lines': '主な個人成績',
      'The two sides, measure by measure': '両チームの指標比較',
      'Against every other game in this league': 'リーグ全試合との比較',
      'deciding stretch': '勝負を分けた時間帯',
      'best group': '最も機能したユニット',
      'toughest minutes': '最も苦しんだ時間帯',
      'half-time report': 'ハーフタイムレポート',
      'generated from the play-by-play': 'テキスト速報から自動生成',
      'The first half': '前半',
      'Where it is being decided': '勝負のポイント',
      'Who has it going': '好調な選手',
      'The story so far': 'ここまでの戦い',
      'Reading the week': '今週のデータを読み込み中',
      'keep doing': '継続すること',
      'work on': '改善すること',
      'the last seven days': '直近7日間',
      'no percentile scales are built for this competition yet, so these are the two sides against each other rather than against the league':
        'この大会にはまだパーセンタイルの基準がないため、リーグとの比較ではなく両チーム同士の比較です',
      'the bar is the percentile — how this game compares with real games in this competition': 'バーはパーセンタイル — この大会の実際の試合と比べた位置',
      'grey rows are a style, not a score': 'グレーの行はスタイルであり、評価ではありません',
      'the bar is the percentile against real games in this competition': 'バーはこの大会の実際の試合に対するパーセンタイル',
      'Written from the event log: every number above is computed from the same replay that draws the box score below.':
        'イベントログから作成：上記の数字はすべて、下のボックススコアと同じリプレイから算出されています。',
      'Written from the first half’s event log. This tab goes when the third quarter starts, and the full match report arrives when the game is final.':
        '前半のイベントログから作成。このタブは第3クォーター開始とともに消え、試合終了後に完全なレポートが掲載されます。',
      'competitions & seasons': '大会・シーズン',
      'the same club in other competitions': '同じクラブの他の大会',
      'all seasons': '全シーズン',
      'you are here': '現在地',
      'no competition yet': 'まだ大会はありません',
      'women': '女子',
      'a women\'s team': '女子チーム',
      'other profiles': '他のプロフィール',
      'the same player in other competitions': '他の大会での同じ選手',
      'no club yet': 'まだクラブはありません'
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
        return out.indexOf(null) >= 0 ? null : out.join('');
      }],
      [/^(\d+) players? out( so far)?$/i, m => m[1] + '人が欠場' + (m[2] ? '（集計中）' : '')],
      [/^(\d+) out$/i, m => m[1] + '人欠場'],
      [/^Mark (.+) as released — they leave the injury report and the game previews$/, m => m[1] + 'を退団扱いにする — 欠場情報と試合の見どころから外れます']
    ])
  }, 'report');
})();
