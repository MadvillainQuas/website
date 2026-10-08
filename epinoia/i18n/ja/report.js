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
    /* the writer's reviser drops "very" as a filler */
    'at the top of the league': 'リーグトップクラス',
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
    'second to none in the league': 'リーグで誰にも引けを取らない水準',
    'in the league’s top tenth': 'リーグ上位1割の水準',
    'in the league’s top quarter': 'リーグ上位4分の1の水準',
    'clearly better than the league’s usual': 'リーグの標準をはっきり上回る水準',
    'a little better than the league’s usual': 'リーグの標準をわずかに上回る水準',
    'just above the league’s average': 'リーグ平均をわずかに上回る水準',
    'no different from the league’s usual': 'リーグの標準と変わらない水準',
    'neither better nor worse than usual here': 'このリーグの標準どおりの水準',
    'a little worse than the league’s usual': 'リーグの標準をわずかに下回る水準',
    'just below the league’s average': 'リーグ平均をわずかに下回る水準',
    'in the league’s bottom quarter': 'リーグ下位4分の1の水準',
    'clearly worse than the league’s usual': 'リーグの標準をはっきり下回る水準',
    'in the league’s bottom tenth': 'リーグ下位1割の水準',
    'as poor as it gets in the league': 'リーグで最も苦しい水準',
    'hard to place': '評価の難しい数字'
  };
  const FREQ = {
    'a share few sides in this league ever reach': 'リーグでもほとんど見られない割合だ',
    'more than most sides manage': '多くのチームを上回る割合だ',
    'as few as any side in this league gets': 'リーグで最も少ない水準だ',
    'fewer than most sides get': '多くのチームより少ない',
    /* three a band (2026-10-08) */
    'as high a share as this league sees': 'リーグでも最高水準の割合だ',
    'a share almost nobody here matches': 'ほとんどのチームが及ばない割合だ',
    'more than three sides in four get': '4チーム中3チームを上回る割合だ',
    'above what most sides here get': 'リーグの多くのチームを上回る割合だ',
    'about as few as this league sees': 'リーグでも最少クラスだ',
    'about as low as this league goes': 'リーグでも最も低い水準だ',
    'fewer than three sides in four get': '4チーム中3チームより少ない',
    'below what most sides here get': 'リーグの多くのチームより少ない'
  };
  const alt = o => Object.keys(o).sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  /* A POSSESSIVE AS THE WRITER LEAVES IT: its reviser takes the apostrophe off a name that ends in a number, as if it were
     a decade ("Nanterre 92s 15 points"), so every "’s?" in a template also takes that */
  const POSS = '(?:’s?|(?<=\\d)s)';
  const TOK = {
    /* a name may carry a colon with no space after it ("Igokea M:tel"); a colon and a space ends it */
    X: '((?:[^,;:—]|:(?!\\s))+?)', L: '(.+?)', N: '((?!and )(?:(?! and | for | of )[^,;:—()])+?)', D: '(\\d+)', F: '(-?\\d+(?:\\.\\d+)?)', W: '(' + WORDS + ')',
    S: '(\\d+)[–-](\\d+)', O: '(first|second|third|fourth|\\d+th)', M: '(\\d+:\\d{2})',
    T: '((?:(?:,| and) (?:' + WORDS + ') (?:rebounds|assists|steals|blocks))*)',
    P: '(their|[^,;:—]+?' + POSS + ')', Q: '(' + alt(PCT) + ')', R: '(' + alt(FREQ) + ')',
    V: '(in transition|on second chances|off turnovers)',
    K: '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th))', H: '(\\d+\\.\\d+|' + WORDS + ')',
    Y: '((?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),? \\d{1,2} (?:january|february|march|april|may|june|july|august|september|october|november|december))',
    A: '(all but (?:\\d+ seconds?|(?:' + WORDS + ') minutes?))'
  };
  const rx = (src, end) => new RegExp('^(?:' + src.replace(/’s\?/g, POSS).replace(/\{([A-Z])\}/g, (m, k) => TOK[k]) + ')' + (end || '') + '$', 'i');

  const sc = (a, b) => a + '－' + b;
  const ORD = { first: '第1クォーター', second: '第2クォーター', third: '第3クォーター', fourth: '第4クォーター' };
  const ord = o => ORD[String(o).toLowerCase()] || ('延長第' + (parseInt(o, 10) - 4) + 'ピリオド');
  const dur = m => { const [a, b] = String(m).split(':').map(Number); return a ? a + '分' + (b ? b + '秒' : '') : b + '秒'; };
  const ROLE = { 'the winners': '勝ったチーム', 'the losers': '敗れたチーム' };
  /* a subject: they is dropped, a role becomes words, a club is itself */
  const who = x => { const k = String(x).toLowerCase(); return k === 'they' ? '' : (ROLE[k] || String(x)); };
  const S = (x, p) => { const w = who(x); return w ? w + (p == null ? 'は' : p) : ''; };
  const own = x => { if (/^their$/i.test(x)) return ''; const w = String(x).replace(/’s?$|(?<=\d)s$/, ''); return who(w) + 'の'; };
  /* "all but 20 seconds", "all but three minutes" of a game: 20秒を除く */
  const allBut = a => { const m = /^all but (\S+) (second|minute)s?$/i.exec(String(a)); return m ? n(m[1]) + (/^second/i.test(m[2]) ? '秒' : '分') + 'を除く' : ''; };
  const names = x => String(x).split(/, | and /).join('、');
  const STAT = { points: '得点', rebounds: 'リバウンド', assists: 'アシスト', steals: 'スティール', blocks: 'ブロック' };
  const tail = t => { let o = ''; String(t || '').replace(/(\w+) (rebounds|assists|steals|blocks)/gi, (m, w, k) => { o += n(w) + STAT[k.toLowerCase()]; return m; }); return o; };
  const line = (pts, t) => pts + '得点' + tail(t);
  /* a season high rides on the points, the rest of the line after it: "シーズンハイの27得点に7リバウンド" */
  const hl = (hi, pts, t) => (hi ? 'シーズンハイの' + pts + '得点' + (t ? 'に' + tail(t) : '') : line(pts, t));
  const DAY = { sunday: '日曜日', monday: '月曜日', tuesday: '火曜日', wednesday: '水曜日', thursday: '木曜日', friday: '金曜日', saturday: '土曜日' };
  const PART = { morning: '午前', afternoon: '午後', evening: '夜' };
  const WHERE = { 'in transition': 'ファストブレイク', 'on second chances': 'セカンドチャンス', 'off turnovers': '相手のターンオーバーからの攻撃' };
  const ZONE_JA = { 'at the rim': 'ゴール下', 'from mid-range': 'ミドルレンジ', 'from three': '3P' };
  /* a player's share of the points a situation brought: ファストブレイクからのチーム19得点 */
  const SITPTS = { 'in transition': 'ファストブレイクからの', 'on second chances': 'セカンドチャンスからの', 'off turnovers': '相手のターンオーバーからの' };

  /* the measures the scout's note and the weekly report name */
  const LAB = {
    'shooting': 'シュート', 'turnovers': 'ターンオーバー', 'the offensive glass': 'オフェンスリバウンド',
    'offensive glass': 'オフェンスリバウンド', 'free throws': 'フリースロー',
    'shooting from the field': 'フィールドゴール', 'looking after the ball': 'ボールの管理',
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

  /* the game in its season (2026-10-07): a place in the table ("third" 3位, "first" 首位 where it
     is the top), a record (9勝2敗, as the standings say 勝 and the game pages 敗), a group, the day
     of the next game (the writer's "Saturday 17 October" read back as 10月17日(土), the way the
     site prints a date) */
  const PLACE = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const rank = k => PLACE[String(k).toLowerCase()] || parseInt(k, 10);
  const place = k => rank(k) + '位';
  const top = k => (rank(k) === 1 ? '首位' : place(k));
  const rec = (w, l) => w + '勝' + l + '敗';
  const grp = x => { const m = /^group (.+)$/i.exec(String(x)); return m ? 'グループ' + m[1] : String(x); };
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const date = s => { const m = /^(\w+),? (\d+) (\w+)$/.exec(String(s)); return m ? (MONTHS.indexOf(m[3].toLowerCase()) + 1) + '月' + m[2] + '日(' + DAY[m[1].toLowerCase()].charAt(0) + ')' : String(s); };
  const SHOT = { three: '3Pシュート', 'free throw': 'フリースロー', basket: 'シュート' };
  const stat = (d, k) => (/^threes$/i.test(k) ? '3Pシュート' + d + '本成功' : d + STAT[k.toLowerCase()]);

  /* the value ledger's facets (story.js FACET_LABEL) and the preview's (preview.js FACET_W); the
     rest are the scout's labels */
  const FAC = {
    'the shots they got': 'シュートの質', 'the quality of their shots': 'シュートの質',
    'the shots that fell': 'シュート決定力', 'shot-making': 'シュート決定力',
    'the shooting': 'シュート', 'the turnover battle': 'ターンオーバーの攻防',
    'free-throw shooting': 'フリースローの精度', 'the free throws': 'フリースロー'
  };
  const fac = x => (Object.prototype.hasOwnProperty.call(FAC, String(x).toLowerCase()) ? FAC[String(x).toLowerCase()] : lab(x));
  /* what the facet was worth: "about seven of the twelve points between them", "about six points,
     more than the whole margin", "about four points" */
  const WORTH = [
    [rx('about {W} of the {W} points between them'), (a, b) => '両チームの' + n(b) + '点差のうち約' + n(a) + '点分に相当した'],
    /* "six of the six" as the reviser writes it */
    [rx('about all {W} points between them'), a => '両チームの' + n(a) + '点差のほぼすべてに相当した'],
    [rx('about {W} points?, more than the whole margin'), a => '約' + n(a) + '点分に相当し、最終的な点差をも上回った'],
    [rx('about {W} points?'), a => '約' + n(a) + '点分に相当した']
  ];
  const BY = {
    'by this league’s own model of what wins': 'このリーグ独自の勝因モデルで見ると',
    'weighed the way this league’s games are decided': 'このリーグの勝敗の決まり方で重み付けすると',
    'on what decides games in this league': 'このリーグで勝敗を左右する要素から見ると',
    'counted factor by factor': '要素ごとに数えると',
    'facet by facet': '要素別に見ると',
    'weighing each facet at its usual value': '各要素を標準的な重みで換算すると'
  };
  /* "four points on shooting, two on turnovers and one on free throws" -> シュートで4点、ターンオーバーで2点、フリースローで1点 */
  const factorPts = s => items(s, t => { const m = rx('{W}(?: points?)? on (.+?)').exec(t); return m && lab(m[2]) ? lab(m[2]) + 'で' + n(m[1]) + '点' : null; });
  const RATES = '(in this league|at this game’s make rates)';
  const rates = r => (/league/i.test(r) ? 'このリーグの成功率で換算すると' : 'この試合の成功率で換算すると');
  /* the facet that decided it, after the ledger's "By this league's own model of what wins, " */
  const LEAD = [
    [rx('the shots {X} got decided it: ' + RATES + ' their attempts were worth {D}% eFG and {X}’s? {D}%, (.+)'), (x, r, a, y, b, v) => {
      const t = first(WORTH, v);
      return t && '勝負を分けたのは' + x + 'が得たシュートの質だった。' + rates(r) + '、試投の価値はEFG%で' + x + 'が' + a + '%、' + y + 'が' + b + '%となり、' + t;
    }],
    [rx('it came down to making shots: {X} hit {D}% eFG on shots that usually go at {D}% ' + RATES + ', worth (.+)'), (x, a, b, r, v) => {
      const t = first(WORTH, v);
      return t && '勝負を分けたのはシュートを決め切る力だった。' + x + 'のEFG%は' + a + '%で、' + (/league/i.test(r) ? 'このリーグなら通常' : 'この試合の成功率なら') + b + '%のシュートだった。その差は' + t;
    }],
    [rx('the free throws decided it: {X} made {W} of {W}, worth (.+) against the usual rate'), (x, a, b, v) => {
      const t = first(WORTH, v);
      return t && '勝負を分けたのはフリースローだった。' + x + 'は' + n(b) + '本中' + n(a) + '本を成功させ、通常の成功率と比べて' + t;
    }],
    [rx('(.+?) decided it, worth (.+?)(?: to {X})?'), (l, v, x) => {
      const f = fac(l), t = first(WORTH, v);
      return f && t ? '勝負を分けたのは' + f + 'で、' + (x ? x + 'にとって' : '') + t : null;
    }]
  ];
  /* the preview's matchup, valued: "Most of that is the shooting: expect X to shoot about 53% eFG to 51%" */
  const OPEN = [
    [rx('(.+?) alone is worth more than that'), l => fac(l) && fac(l) + 'だけでそれ以上の価値がある'],
    [rx('most of that is (.+?)'), l => fac(l) && 'その大半は' + fac(l) + 'によるもの'],
    [rx('the biggest part is (.+?)'), l => fac(l) && '最も大きいのは' + fac(l)]
  ];
  const EXPECT = [
    [rx('expect {X} to shoot about {D}% eFG to {D}%'), (x, a, b) => x + 'のEFG%は約' + a + '%、相手は' + b + '%と予想され'],
    [rx('{X} should turn it over on about {D}% of possessions to {D}%'), (x, a, b) => x + 'のターンオーバー率は約' + a + '%、相手は' + b + '%と見込まれ'],
    [rx('{X} should get about {D}% of their misses back to {D}%'), (x, a, b) => x + 'のオフェンスリバウンド率は約' + a + '%、相手は' + b + '%と見込まれ'],
    [rx('{X} should get to the line more, about {D} free throws per hundred shots to {D}'),
      (x, a, b) => x + 'はより多くフリースローを得る見込みで、シュート100本あたり約' + a + '本、相手は' + b + '本となり']
  ];
  /* the scout's closing line, three ways round the same judgement */
  const BEHIND = '(?:, further behind the league than anything else in their game|, the furthest from the league anything in their game was|, and nothing else in their game sat further behind the league)';

  /* HOW EACH SIDE COMES IN (preview.js valuedParas, 2026-10-08): its last game, said from its own end - a win 92－70, a
     defeat the side's score first (72－83で敗れた) - home or away, against whom, and whoever carried it ("with 31 from X",
     "despite 25 from X", "30 points and 11 rebounds from X") */
  const CARRIED = '(?:,? (with|despite) {D}(?: points and {D} (rebounds|assists))? from {X})?';
  const vsJa = (home, opp) => (home ? 'ホーム' : 'アウェー') + (opp ? 'の' + opp + '戦' : 'ゲーム') + 'に';
  const scoreJa = (won, a, b) => (won ? sc(a, b) : sc(b, a));
  const carriedJa = (k, pts, more, stat, p) => (k ? '。その試合では' + p + 'が' + pts + '得点' + (more ? more + STAT[stat.toLowerCase()] : '') +
    'を挙げ' + (/^with$/i.test(k) ? 'た' : 'たが、及ばなかった') : '');
  /* a run's latest game: ", the latest 90–60 at Bristol Flyers with 31 from X" */
  const LATEST = rx('{S}( at home to {X}| at home| at {X}| away)' + CARRIED);
  const latestJa = (won, s) => {
    if (!s) return '';
    const m = LATEST.exec(s);
    if (!m) return null;
    const [, a, b, where, toOpp, atOpp, k, pts, more, stat, p] = m;
    return '。直近の試合は' + vsJa(/^ at home/i.test(where), toOpp || atOpp) + scoreJa(won, a, b) + 'で' + (won ? '勝利した' : '敗れた') + carriedJa(k, pts, more, stat, p);
  };
  const HOMEAWAY = { 'at home': 'ホーム', 'away': 'アウェー', 'on the road': 'アウェー' };

  /* "On Saturday evening at The Arena, in front of 312 in Division One", in any of its parts */
  /* a venue may carry its town after a comma ("Rocher, Nyon"), but never "in front of" */
  const DL = /^(?:on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (morning|afternoon|evening))?)?(?:(?:^| )at ([^,]+?(?:, (?!in front of )[^,]+?)?))?(?:(?:^|,? )in front of (\d+))?(?: in ([^,]+?))?$/i;
  const dl = s => {
    const m = DL.exec(String(s).trim());
    if (!m || !(m[1] || m[3] || m[4] || m[5])) return null;
    /* the town after a venue's comma has a capital: ", and they led by 15" is the next clause, not a place */
    if (m[3] && /, [a-z]/.test(m[3])) return null;
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
    [rx('{N} came off the bench for (a season-high )?{D}{T}'), (p, hi, d, t) => p + 'がベンチから' + hl(hi, d, t)],
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
  const roughClub = c => { const m = /^(.+?)(?:’s?|(?<=\d)s) (.+)$/.exec(c); if (!m) return null; const it = items(m[2], ROUGH); return it ? m[1] + 'の' + it.join('、') : null; };

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Japanese | null]; {X} a name or a subject, {D} a count, {F} a
     figure, {W} a count in words, {S} a score, {O} a period, {M} a clock, {T} the rest of a
     stat line, {L} a list of names, {P} a possessive, {Q} a percentile phrase, {R} a share phrase, {V} a situation,
     {K} a place in the table, {H} points that may be a half (1.5), {Y} a day ("Saturday 17 October") */
  const RULES = [
    /* ---- the opening sentence, with its dateline ---- */
    ['((?:on|at|in front of) .+ beat .+)', s => {
      const re = /, /g;
      let m;
      while ((m = re.exec(s))) {
        const d = dl(s.slice(0, m.index));
        const t = /^(.+?) beat (.+?) (\d+)[–-](\d+)(?: in ([^,]+))?$/i.exec(s.slice(m.index + 2));
        /* the winners' name has no comma in it: a comma before it belongs to the venue ("at Site Sportif, Fribourg, ...") */
        if (d && t && !/^in front of /i.test(t[1]) && t[1].indexOf(',') < 0) {
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
    ['it (?:still )?was not enough', () => 'それでも届かなかった'],
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
    ['it turned on an? {D}–0 burst in the {O}, and (?:the game did not come back|the other side never got back into it)',
      (d, o) => ord(o) + 'の' + sc(d, 0) + 'のランで流れが変わり、その後相手が追いつくことはなかった'],
    ['an? {D}–0 run in the {O} did the damage(, and the game never (?:really )?came back)?',
      (d, o, t) => ord(o) + 'の' + sc(d, 0) + 'のランが決定打となった' + (t ? '。その後、試合がもつれることはなかった' : '')],
    /* the reviser drops "really" as a filler */
    ['the game never (?:really )?came back', () => 'その後、試合がもつれることはなかった'],
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

    /* ---- who was in front, and for how long (story.js factTimeLed) ---- */
    ['{X} led from the first basket to the last', x => S(x) + '先制点から試合終了まで一度もリードを譲らなかった'],
    ['it was wire to wire for {X}: never behind, and never level after the first basket',
      x => x + 'が最初から最後までリードを守った。一度もリードを許さず、先制点の後は同点にもされなかった'],
    ['{X} never gave up the lead after the first basket', x => S(x) + '先制点の後は一度もリードを譲らなかった'],
    ['{X} never trailed', x => S(x) + '一度もリードを許さなかった'],
    ['at no point was {X} behind', x => x + 'は一度もリードを許さなかった'],
    ['{X} led for {A} of it and still lost', (x, a) => S(x) + allBut(a) + 'すべての時間でリードしながら敗れた'],
    ['for {A} of the game it was {X}’s?, and they lost it anyway', (a, x) => allBut(a) + 'すべての時間で' + x + 'がリードしていたが、それでも敗れた'],
    ['{X} were in front for {W} of the {W} minutes( and still lost)?',
      (x, a, b, lost) => S(x) + n(b) + '分のうち' + n(a) + '分間' + (lost ? 'リードしながら敗れた' : 'リードしていた')],
    ['for {W} of the {W} minutes it was {X}’s? game, and they lost it anyway', (a, b, x) => n(b) + '分のうち' + n(a) + '分間は' + x + 'のペースだったが、それでも敗れた'],
    ['{X} led for most of it, {W} of the {W} minutes(, and it was not enough)?',
      (x, a, b, t) => S(x) + n(b) + '分のうち' + n(a) + '分間とほとんどの時間でリードした' + (t ? 'が、勝利には届かなかった' : '')],
    ['{X} were in front for {A} of the game', (x, a) => S(x) + allBut(a) + 'すべての時間でリードしていた'],
    ['it was {X}’s? game from the start, in front for (?:{A} of it|{W} of the {W} minutes)',
      (x, a, m, t) => '序盤から' + x + 'のペースで、' + (a ? allBut(a) + 'すべての時間で' : n(t) + '分のうち' + n(m) + '分間') + 'リードしていた'],

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
    ['it was played at speed(?: —|,) {F} possessions per 40(?:, (quicker|slower) than this league’s usual {D})?',
      (f, k, d) => 'ハイペースな展開で、40分あたりのポゼッション数は' + f + (k ? '（リーグ平均の' + d + 'より' + (/^quicker$/i.test(k) ? '速い' : '遅い') + '）' : '')],
    ['it was a slow, half-court game at {F} possessions per 40(?:, (quicker|slower) than this league’s usual {D})?',
      (f, k, d) => 'ハーフコート中心のスローな展開で、40分あたりのポゼッション数は' + f + (k ? '（リーグ平均の' + d + 'より' + (/^quicker$/i.test(k) ? '速い' : '遅い') + '）' : '')],
    ['{X} finished on {D} against a season average of {F}', (x, d, f) => S(x) + '今季平均' + f + '得点のところ' + d + '得点を記録した'],
    ['{X} were held to {D}, well short of the {F} they usually manage', (x, d, f) => S(x) + d + '得点に抑えられ、平均の' + f + '得点を大きく下回った'],

    /* ---- where the points came from ---- */
    ['{X} (had|have) the edge {V}: {D} points? from {D} chances?(?:,(?: at)? {F} (?:a time|points? a chance|points? each))?, against {X}’s? {D}',
      (x, t, v, p, c, r, y, o) => S(x) + WHERE[v.toLowerCase()] + 'で優位に' + (/^had$/i.test(t) ? '立った' : '立っている') + '。' +
        c + '回のチャンスで' + p + '得点' + (r ? '（1回あたり' + r + '点）' : '') + '、' + y + 'は' + o + '得点'],
    ['{V} it (?:was|is) {S} to {X}( so far)?, from {D} chances?(?:,(?: at)? {F} (?:a time|points? a chance|points? each))?',
      (v, a, b, x, far, c, r) => WHERE[v.toLowerCase()] + 'では' + (far ? 'ここまで' : '') + x + 'が' + sc(a, b) + 'と上回り、' +
        c + '回のチャンス' + (r ? 'で1回あたり' + r + '点' : 'から得点') ],
    ['they (got|are getting) {D}% of their chances that way, {R}', (t, d, r) => 'チャンス全体の' + d + '%がこの形で、' + freq(r)],
    /* the glass and the line, with the other side named (2026-10-08: it was "for the other side", and none of these was
       translated) */
    ['{X} won the ball back on {W} of their {W} misses, against {W} of {W} for {X}',
      (x, a, b, c, d, y) => S(x) + '自らのシュートミス' + n(b) + '本のうち' + n(a) + '本でボールを取り返し、' + (who(y) || y) + 'は' + n(d) + '本中' + n(c) + '本だった'],
    ['misses were not the end of it for {X}: {W} of {W} came back to them, to {W} of {W} for {X}',
      (x, a, b, c, d, y) => S(x, 'の') + 'ミスはそれで終わらなかった。' + n(b) + '本のミスのうち' + n(a) + '本が手元に戻り、' + (who(y) || y) + 'は' + n(d) + '本中' + n(c) + '本だった'],
    ['{X} got {W} of their {W} misses (at the rim|from mid-range|from three) back, against {W} of {W} for {X}',
      (x, a, b, z, c, d, y) => S(x) + ZONE_JA[z.toLowerCase()] + 'のミス' + n(b) + '本のうち' + n(a) + '本を取り返し、' + (who(y) || y) + 'は' + n(d) + '本中' + n(c) + '本だった'],
    ['the second shots came (at the rim|from mid-range|from three) for {X}: {W} of {W} misses came back, to {W} of {W} for {X}',
      (z, x, a, b, c, d, y) => S(x, 'の') + 'セカンドチャンスは' + ZONE_JA[z.toLowerCase()] + 'から生まれた。' + n(b) + '本のミスのうち' + n(a) + '本を取り返し、' + (who(y) || y) + 'は' + n(d) + '本中' + n(c) + '本だった'],
    ['{X} got to the line far more often — {D} free throws for every hundred shots, against {D}',
      (x, a, b) => S(x) + 'ずっと多くフリースローを獲得した。シュート100本あたり' + a + '本で、相手は' + b + '本'],
    ['{X} lived at the line, drawing {D} free-throw attempts per hundred field goals to {D}',
      (x, a, b) => S(x) + 'フリースローラインに立ち続け、フィールドゴール100本あたり' + a + '本のフリースローを得た（相手は' + b + '本）'],
    ['the whistle was kind to {X}: {D} free throws per hundred shots, against {D} for {X}',
      (x, a, b, y) => '笛は' + (who(x) || 'このチーム') + 'に味方した。シュート100本あたりのフリースローは' + a + '本、' + (who(y) || y) + 'は' + b + '本だった'],
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
    ['{X} turned it over {D} times', (x, d) => S(x) + d + '本のターンオーバーを犯した'],
    ['{X} coughed it up {D} times', (x, d) => S(x) + d + '回ボールを失った'],
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
    /* the same, and the passing, as the writer words them now */
    ['{X} defended better, allowing {F} points per 100 possessions where the other side allowed {F}',
      (x, a, b) => S(x) + '守備で上回り、100ポゼッションあたりの失点は' + a + '（相手は' + b + '）だった'],
    ['{X} moved it well: {W} of their {W} baskets came off a pass, against {W} of {W} for {X}',
      (x, a, b, c, d, y) => S(x) + 'ボールがよく回り、' + n(b) + '本のフィールドゴールのうち' + n(a) + '本がアシストから生まれた（' + (who(y) || y) + 'は' + n(d) + '本中' + n(c) + '本）'],
    ['{X} had to make more of their own shots, with {D} of their points from baskets nobody set up',
      (x, d) => S(x) + '個人で打開する場面が多く、' + d + '得点がアシストのないフィールドゴールによるものだった'],
    ['{X} forced the ball loose all night — their opponents coughed it up on {F}% of possessions', (x, a) => S(x) + '試合を通じてボールを奪い続け、相手のターンオーバー率は' + a + '%に達した'],
    ['{X} had their hands on the ball all night — their opponents turned it over on {F}% of possessions', (x, a) => S(x) + '試合を通じて相手のボールに手を伸ばし続け、相手のターンオーバー率は' + a + '%に達した'],
    ['{X} kept taking it away — their opponents gave it up on {F}% of possessions', (x, a) => S(x) + 'ボールを奪い続け、相手は' + a + '%のポゼッションでボールを失った'],
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
    /* the stretch the standfirst has already timed, the five that played it, and each side's best and worst group, as
       the writer words them now */
    ['it came with {L} on the floor for {X}, together for the whole of it',
      (f, x) => 'その間コートにいたのは' + x + 'の' + names(f) + 'で、最初から最後まで同じ5人だった'],
    ['it was {X}’s? worst stretch: {L} were on the floor(?:, and the other side outscored them by {D} in that time)?',
      (x, f, d) => x + 'にとって最も苦しい時間帯だった。コートにいたのは' + names(f) + (d ? 'で、その間に相手に' + d + '点上回られた' : 'だった')],
    /* ...and with the stretch named again (2026-10-08), its length left to the standfirst that gave it */
    ['the (?:{M} )?stretch that swung it came with {L} on the floor for {X}, together for the whole of it',
      (m, f, x) => '勝負を分けた' + (m ? dur(m) + 'の' : '') + '時間帯にコートにいたのは' + x + 'の' + names(f) + 'で、最初から最後まで同じ5人だった'],
    ['the (?:{M} )?stretch that swung it was {X}’s? worst: {L} were on the floor(?:, and the other side outscored them by {D} in that time)?',
      (m, x, f, d) => '勝負を分けた' + (m ? dur(m) + 'の' : '') + '時間帯は' + x + 'にとって最も苦しい時間だった。コートにいたのは' + names(f) + (d ? 'で、その間に相手に' + d + '点上回られた' : 'だった')],
    /* the second half of either, when the reviser has cut it at ", and" */
    ['the other side outscored them by {D} in that time', d => 'その間に相手に' + d + '点上回られた'],
    ['over every minute those five shared, {X} (outscored the opposition|were outscored) by {D} in {M}',
      (x, k, d, m) => 'この5人が共にコートに立った' + dur(m) + 'で、' + S(x) + d + (/^outscored/i.test(k) ? '点上回った' : '点下回った')],
    ['{P} strongest group, {L}, (outscored the other side|was outscored) by {D} in {M}',
      (p, f, k, d, m) => own(p) + '最も機能したユニット（' + names(f) + '）は' + dur(m) + 'で' + d + (/^outscored/i.test(k) ? '点上回った' : '点下回った')],
    ['(the other end of it was ugly for|it went the other way for|the worst of it fell on) {X}, who were outscored by {D} in {M} with {L} out there',
      (pre, x, d, m, f) => (/ugly/i.test(pre) ? '一方、' + x + 'は苦しい時間帯もあり、' : /other way/i.test(pre) ? '反対に、' + x + 'は' : '最も痛手を負ったのは' + x + 'で、') +
        names(f) + 'がコートにいた' + dur(m) + 'で' + d + '点下回った'],

    /* ---- how the ball moved, the play types and the rebounds, the shot clock: the tabs, said ---- */
    ['the most productive pairing was {X} to {X} for {X}: {W} baskets worth {W} points(, every one of them a three)?',
      (a, b, x, c, p, all3) => x + 'で最も得点を生んだのは' + a + 'から' + b + 'へのパスで、' + n(c) + '本のバスケットで' + n(p) + '得点' + (all3 ? '、すべて3Pシュートだった' : 'を挙げた')],
    ['{X} found {X} {W} times for {X}, {W} points in all( and all of them threes)?',
      (a, b, c, x, p, all3) => x + 'の' + a + 'が' + b + 'へのアシストを' + n(c) + '本通し、合計' + n(p) + '得点' + (all3 ? '（すべて3P）' : '') + 'を生んだ'],
    ['for {X}, {X} and {X} connected {W} times, worth {W} points', (x, a, b, c, p) => x + 'では' + a + 'と' + b + 'のコンビが' + n(c) + '回つながり、' + n(p) + '得点を生んだ'],
    ['{X} set up {W} of {X}’s? {W} assisted baskets, finding {W} different scorers',
      (p, a, x, b, c) => x + 'の' + p + 'がアシストによるチームのバスケット' + n(b) + '本のうち' + n(a) + '本を演出し、' + n(c) + '人に得点させた'],
    ['{X} scored {D} points off assists for {X}', (p, d, x) => x + 'の' + p + 'はアシストから' + d + '得点を挙げた'],
    ['{X} scored {W} of {X}’s? {W} points {V}', (p, a, x, b, v) => x + 'の' + p + 'は' + SITPTS[v.toLowerCase()] + 'チーム' + n(b) + '得点のうち' + n(a) + '得点を挙げた'],
    ['neither side found the mid-range: {X} made {W} of {W} from there, {X} {W} of {W}',
      (x, a, b, y, c, d) => '両チームともミドルレンジが決まらず、' + x + 'は' + n(b) + '本中' + n(a) + '本、' + y + 'は' + n(d) + '本中' + n(c) + '本にとどまった'],
    ['{X} could not buy a mid-range basket, {W} of {W} from there', (x, a, b) => S(x) + 'ミドルレンジがまったく決まらず、' + n(b) + '本中' + n(a) + '本にとどまった'],
    ['{X} were the more patient side, taking {F} seconds a possession to {F} for {X}',
      (x, a, b, y) => S(x) + 'よりじっくりと攻め、1ポゼッションあたり' + a + '秒をかけた（' + (who(y) || y) + 'は' + b + '秒）'],
    ['{X} used the clock: {F} seconds a possession, against {F} for {X}',
      (x, a, b, y) => S(x) + '時間をかけて攻め、1ポゼッションあたり' + a + '秒を使った（' + (who(y) || y) + 'は' + b + '秒）'],
    ['{X} were sharper early in the clock: in the first eight seconds they scored {F} points? a chance, {X} {F}',
      (x, a, y, b) => S(x) + 'ショットクロック序盤の攻撃で上回り、最初の8秒間の1チャンスあたりの得点は' + a + '点（' + (who(y) || y) + 'は' + b + '点）だった'],
    ['{X} ran the clock down and paid for it: {W} of their {W} chances went past {D} seconds(?:, and they scored {F} a time there against {F} overall)?',
      (x, a, b, s, e, f) => S(x) + 'ショットクロックを使い切る攻撃が裏目に出た。' + n(b) + '回のチャンスのうち' + n(a) + '回が' + s + '秒を過ぎ' +
        (e ? '、その場面の1回あたりの得点は' + e + '点（全体では' + f + '点）だった' : 'た')],
    /* ...and its second half, when the reviser has cut it at ", and" */
    ['they scored {F} a time there against {F} overall', (a, b) => 'その場面の1回あたりの得点は' + a + '点（全体では' + b + '点）だった'],

    /* ---- the performances ---- */
    ['{X} led {X} with (a season-high )?{D} points{T}(, a season high)?(, well clear of their usual)?(, a triple-double)?',
      (p, x, sh, d, t, hi, up, td) => x + 'は' + p + 'が' + (up ? '平均を大きく上回る' : '') + hl(sh, d, t) + (hi ? '（今季最多）' : '') + (td ? 'のトリプルダブル' : '') + 'でチームをけん引した'],
    ['{X} top-scored for {X} with (a season-high )?{D}{T}(, a triple-double)?', (p, x, sh, d, t, td) => x + 'は' + p + 'がチーム最多' + (sh ? 'となる' : 'の') + hl(sh, d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} had (a season-high )?{D} points{T} from {X}(, a triple-double)?', (x, sh, d, t, p, td) => x + 'は' + p + 'が' + hl(sh, d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} answered with (a season-high )?{D}{T}(, a triple-double)? for {X}', (p, sh, d, t, td, x) => x + 'は' + p + 'が' + hl(sh, d, t) + (td ? 'のトリプルダブル' : '') + 'で応戦した'],
    ['for {X}, {X} had (a season-high )?{D}{T}(, a triple-double)?', (x, p, sh, d, t, td) => x + 'は' + p + 'が' + hl(sh, d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} finished with (a season-high )?{D}{T}(, a triple-double)? for {X}', (p, sh, d, t, td, x) => x + 'の' + p + 'は' + hl(sh, d, t) + (td ? 'のトリプルダブル' : '') + 'を記録した'],
    ['{X} had a triple-double for {X}: (.+)', (p, x, l) => {
      const parts = l.split(/, | and /).map(s => { const m = /^(\d+) (points|rebounds|assists|steals|blocks)$/i.exec(s); return m ? m[1] + STAT[m[2].toLowerCase()] : null; });
      return parts.indexOf(null) >= 0 ? null : x + 'の' + p + 'がトリプルダブルを達成。' + parts.join('');
    }],
    ['(.+?)(, well up on (?:his|their) usual)?', (s, up) => {
      /* "A added 14 and B 12 for X", "A added a season-high 19 for X" */
      const one = t => { const m = rx('{N} added (a season-high )?{D}').exec(t) || rx('{N} (a season-high )?{D}').exec(t); return m ? m[1] + 'が' + (m[2] ? 'シーズンハイの' : '') + m[3] + '得点' : null; };
      if (!/ added (?:a season-high )?\d/.test(s)) return null;
      const cs = byClub(s, one);
      return cs && clubs(cs) + (up ? '（平均を大きく上回る数字）' : '');
    }],
    ['(.+)', s => { const cs = byClub(s, t => first(DEED, t)); return cs && clubs(cs); }],
    ['(.+)', s => { const cs = byClub(s, t => first(SPECIAL, t)); return cs && clubs(cs); }],
    ['it was a long night for (.+?)(?:, and for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : ''; return x && y != null ? x + (y ? '、' + y : '') + 'にとっては長い夜となった' : null; }],
    ['little went right for (.+?)(?:, or for (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : ''; return x && y != null ? x + (y ? '、' + y : '') + 'は何をやってもうまくいかなかった' : null; }],
    ['(.+?) never got going(?:, and neither did (.+))?', (a, b) => { const x = roughClub(a), y = b ? roughClub(b) : ''; return x && y != null ? x + 'は最後まで波に乗れず' + (y ? '、' + y + 'も同様だった' : '') : null; }],
    ['{X} lost {L} to fouls(?:, and {X} lost {L} the same way)?', (x, a, y, b) => x + 'は' + names(a) + 'がファウルアウト' + (y ? '、' + y + 'も' + names(b) + 'がファウルアウトとなった' : 'となった')],

    /* ---- the game in its season, the value ledger, the moments (2026-10-07) ---- */
    /* the streaks and the top of the table: 連勝/連敗, 首位, 今季初黒星, 番狂わせ */
    ['{X} had won their first {W} games; this was their first defeat', (x, w) => S(x) + '開幕から' + n(w) + '連勝していたが、これが今季初黒星となった'],
    ['it was the first defeat of the season for {X}, after {W} straight wins', (x, w) => x + 'にとっては' + n(w) + '連勝の後の今季初黒星となった'],
    ['the win takes {X} top(?: in {X})?, at {S}', (x, g, a, b) => 'この勝利で' + x + 'は' + rec(a, b) + 'とし、' + (g ? grp(g) + 'の' : '') + '首位に浮上した'],
    ['{X} go top(?: in {X})? with it, {S}', (x, g, a, b) => S(x) + 'これで' + rec(a, b) + 'とし、' + (g ? grp(g) + 'の' : '') + '首位に立った'],
    ['{X} lose top spot with the defeat', x => S(x) + 'この敗戦で首位から陥落した'],
    ['the defeat costs {X} first place', x => 'この敗戦で' + x + 'は首位の座を明け渡した'],
    ['{X} stay top(?: in {X})? at {S}', (x, g, a, b) => S(x) + rec(a, b) + 'で' + (g ? grp(g) + 'の' : '') + '首位を守った'],
    ['it keeps {X} top(?: in {X})?', (x, g) => 'これで' + x + 'は' + (g ? grp(g) + 'の' : '') + '首位を守った'],
    ['{X} climb to {K}(?: in {X})?', (x, k, g) => S(x) + (g ? grp(g) + 'の' : '') + place(k) + 'に浮上した'],
    ['the win lifts {X} to {K}(?: in {X})?', (x, k, g) => 'この勝利で' + x + 'は' + (g ? grp(g) + 'の' : '') + place(k) + 'に浮上した'],
    ['{X} started the night {K} in the table and beat the side in {K}', (x, a, b) => '試合前の時点で' + place(a) + 'だった' + (who(x) ? x + 'が、' : 'が、') + place(b) + 'の相手を破った'],
    ['on the table this was an upset: {X} were {K}, {X} {K}', (x, a, y, b) => '順位で見れば番狂わせだった。試合前の時点で' + x + 'は' + place(a) + '、' + y + 'は' + place(b) + 'だった'],
    ['on the season’s numbers this should have been {X}’s? game by about {W} points?', (x, w) => '今季の数字からすれば、' + x + 'が約' + n(w) + '点差で勝つはずの試合だった'],
    ['the season’s four factors had {X} about {W} points? better going in', (x, w) => '試合前の時点で、今季の4ファクターでは' + x + 'が約' + n(w) + '点上回っていた'],
    ['it ended {X}’s? run of {W} straight wins', (x, w) => 'これで' + x + 'の連勝は' + n(w) + 'で止まった'],
    ['{X} had won {W} in a row coming in', (x, w) => S(x) + 'この試合まで' + n(w) + '連勝中だった'],
    ['it ended a run of {W} straight defeats for {X}', (w, x) => 'これで' + x + 'は連敗を' + n(w) + 'で止めた'],
    ['{X} had lost {W} in a row before this', (x, w) => S(x) + 'この試合まで' + n(w) + '連敗中だった'],
    ['it is {W} wins in a row for {X}', (w, x) => x + 'はこれで' + n(w) + '連勝となった'],
    ['{X} have (now )?won {W} straight(?:, the latest (.+))?', (x, now, w, l) => {
      const t = latestJa(true, l);
      return t == null ? null : S(x) + (now ? 'これで' + n(w) + '連勝となった' : n(w) + '連勝中') + t;
    }],
    ['{X} have now lost {W} straight', (x, w) => S(x) + 'これで' + n(w) + '連敗となった'],
    ['that is {W} defeats in a row for {X}', (w, x) => x + 'はこれで' + n(w) + '連敗となった'],
    ['it was {X}’s? first win of the season, at the {K} attempt', (x, k) => x + 'にとっては' + rank(k) + '試合目での今季初勝利となった'],
    ['{X} are off the mark at last, at the {K} attempt', (x, k) => S(x) + rank(k) + '試合目にしてようやく今季初勝利を挙げた'],
    ['{X} are still unbeaten, {S}', (x, a, b) => S(x) + rec(a, b) + 'で無敗をキープしている'],
    ['nobody has beaten {X} yet: {D} games, {D} wins', (x, a, b) => x + 'はいまだ負け知らず。' + a + '戦' + b + '勝だ'],
    ['{X} are still looking for a first win, {W} games in', (x, w) => S(x) + n(w) + '試合を終えて、まだ今季初勝利を挙げられていない'],
    ['it is {W} games and no wins for {X}', (w, x) => x + 'は' + n(w) + '試合を戦ってまだ勝利がない'],
    /* the records the night set, the club's own and the league's */
    ['{X}’s? {D} points (are|equal) the most any side has scored in this league this season',
      (x, d, eq) => x + 'の' + d + '得点は、今季このリーグで1チームが1試合に挙げた最多得点' + (/^equal$/i.test(eq) ? 'に並んだ' : 'となった')],
    ['{X}’s? {D}-(point win|rebound edge) (is|equals) the widest in this league this season',
      (x, d, k, eq) => x + (/^point/i.test(k) ? 'の' + d + '点差での勝利は、今季リーグ最大の点差' : 'のリバウンド' + d + '本差は、今季リーグ最大の差') + (/^equals$/i.test(eq) ? 'に並んだ' : 'となった')],
    ['{X}’s? {D} (threes|assists) (are|equal) the most by any side in a game this season',
      (x, d, k, eq) => x + 'の' + stat(d, k) + 'は、今季の1試合チーム最多' + (/^equal$/i.test(eq) ? 'に並んだ' : 'となった')],
    ['{X}’s? {D} points were their most of the season', (x, d) => x + 'の' + d + '得点は今季チーム最多だった'],
    ['{X} had not scored {D} all season', (x, d) => S(x, 'が') + '今季' + d + '得点を挙げたのはこれが初めてだった'],
    ['{X} have not allowed fewer all season than the {D} they gave up here', (x, d) => S(x, 'が') + 'この試合で許した' + d + '失点は今季最少だった'],
    ['{X}’s? {D} is the fewest {X} have allowed this season', (x, d, y) => y + 'が' + x + 'に許した' + d + '得点は、今季最少失点だった'],
    /* the meetings, the crowd, the fans' picks, the schedule */
    ['{X} have won all {W} meetings this season', (x, w) => S(x) + '今季の対戦で' + n(w) + '戦全勝となった'],
    ['{X} had won the last meeting {S}; this was {X}’s? reply', (x, a, b, y) => '前回の対戦では' + x + 'が' + sc(a, b) + 'で勝利しており、' + y + 'が雪辱を果たした'],
    /* ...and the halves of either, when the reviser has cut it at its semicolon */
    ['{X} had won their first {W} games', (x, w) => S(x) + '開幕から' + n(w) + '連勝していた'],
    ['this was their first defeat', () => 'これが今季初黒星となった'],
    ['{X} had won the last meeting {S}', (x, a, b) => '前回の対戦では' + S(x, 'が') + sc(a, b) + 'で勝利していた'],
    ['this was {X}’s? reply', x => x + 'が雪辱を果たした'],
    ['the season series(?: between them)? is level at {S}', (a, b) => '今季の対戦成績は' + rec(a, b) + 'の五分だ'],
    ['the season series is {S} to {X}', (a, b, x) => '今季の対戦成績は' + x + 'の' + rec(a, b)],
    ['the crowd of {D} was {X}’s? biggest of the season', (d, x) => '入場者数' + d + '人は、' + x + 'の今季最多だった'],
    ['only {D}% of the {D} fans who picked a winner had gone with {X}', (a, b, x) => '勝敗予想に参加した' + b + '人のファンのうち、' + x + 'の勝利を予想したのはわずか' + a + '%だった'],
    ['{X} were playing for the second time in two days', x => S(x) + '2日連続の試合だった'],
    /* where both stand, and what comes next */
    ['(in the league, )?{X} are {K}(?: in {X})? at {S}, {X} {K}(?: in {X})? at {S}',
      (lg, x, k, g, a, b, y, k2, g2, c, d) => (lg ? 'リーグ全体では、' : '') + S(x) + (g ? grp(g) + 'で' : '') + rec(a, b) + 'の' + top(k) + '、' +
        y + 'は' + (g2 ? grp(g2) + 'で' : '') + rec(c, d) + 'の' + top(k2)],
    /* the day or the place can be cut off by the reviser when the sentence before said it ("Hapoel Midtown Jerusalem are
       next for Recoletas Salud San Pablo Burgos.") */
    ['the two meet again on {Y}(?:, at {X}’s? place)?', (dy, x) => '両チームは' + date(dy) + 'に' + (x ? x + 'のホームで' : '') + '再び対戦する'],
    ['next for {X}: {X} at home on {Y}', (x, o, dy) => x + 'の次戦は' + date(dy) + '、ホームでの' + o + '戦'],
    ['{X} host {X} next(?:, on {Y})?', (x, o, dy) => S(x) + '次戦、' + (dy ? date(dy) + 'に' : '') + 'ホームで' + o + 'と対戦する'],
    ['{X} are next for {X}(?:, at home on {Y})?', (o, x, dy) => x + 'の次の相手は' + o + (dy ? 'で、' + date(dy) + 'にホームで対戦する' : '')],
    ['next for {X}: away at {X} on {Y}', (x, o, dy) => x + 'の次戦は' + date(dy) + '、アウェーでの' + o + '戦'],
    ['{X} go to {X} next(?:, on {Y})?', (x, o, dy) => S(x) + '次戦、' + (dy ? date(dy) + 'に' : '') + 'アウェーで' + o + 'と対戦する'],
    ['a trip to {X} is next for {X}(?:, on {Y})?', (o, x, dy) => x + 'の次戦は' + (dy ? date(dy) + '、' : '') + o + 'とのアウェーゲーム'],

    /* the moment, and the shape of the scoring */
    ['{X}’s? (three|free throw|basket) with {W} seconds? left( in overtime)? won it for {X}',
      (p, k, w, ot, x) => (ot ? '延長' : '') + '残り' + n(w) + '秒、' + p + 'の' + SHOT[k.toLowerCase()] + 'が決勝点となり、' + x + 'が勝利した'],
    ['{X}’s? (three|free throw|basket) with (?:{W} seconds?|{M}) left( in overtime)? put {X} ahead for good',
      (p, k, w, m, ot, x) => (ot ? '延長' : '') + '残り' + (w ? n(w) + '秒' : dur(m)) + '、' + p + 'の' + SHOT[k.toLowerCase()] + 'で' + x + 'が勝ち越し、そのまま逃げ切った'],
    ['{X} scored {W} of {X}’s? {W} points in the last five minutes', (p, a, x, b) => p + 'は最後の5分間で' + x + 'の' + n(b) + '得点のうち' + n(a) + '得点を挙げた'],
    ['{X} hit a three at the (?:(half-time)|{O}-quarter) buzzer for {X}', (p, h, o, x) => x + 'の' + p + 'が' + (h ? '前半' : ord(o)) + '終了のブザーと同時に3Pシュートを決めた'],
    ['it was a low-scoring grind, {D} points between the two sides', d => '両チーム合計' + d + '得点にとどまる、ロースコアの消耗戦だった'],
    ['points were hard to come by: {D} between the two sides', d => '得点が伸び悩み、両チーム合計' + d + '得点にとどまった'],
    ['it was a shootout, {D} points between the two sides', d => '両チーム合計' + d + '得点の打ち合いだった'],
    ['neither defence held: {D} points between them', d => 'どちらの守備も持ちこたえられず、両チーム合計' + d + '得点の打ち合いとなった'],

    /* what decided it, in points: the facet worth most first, then what came next and what the
       losers won back, then the margin against the season's expectation, then what is left over */
    ['(' + alt(BY) + '), (.+)', (b, s) => { const t = first(LEAD, s); return t && BY[b.toLowerCase()] + '、' + t; }],
    ['next came (.+?), worth {W} more', (l, w) => fac(l) && '次に大きかったのは' + fac(l) + 'で、さらに' + n(w) + '点分に相当した'],
    ['(.+?) added about {W} points?', (l, w) => fac(l) && fac(l) + 'でさらに約' + n(w) + '点を上積みした'],
    ['{X} won about {W} points? back on (.+?)', (x, w, l) => fac(l) && S(x) + fac(l) + 'で約' + n(w) + '点分を取り返した'],
    ['no single facet decided this: on the league’s own weights nothing was worth more than a point or two either way(, and the margin was made in the margins)?',
      t => '勝負を決めた単一の要素はなかった。リーグ独自の重み付けでは、どの要素もどちらかに1、2点を超える価値はな' + (t ? 'く、点差は細かな積み重ねから生まれた' : 'かった')],
    ['the margin was made in the margins', () => '点差は細かな積み重ねから生まれた'],
    ['{X} got the better shots, worth about {W} points?, but {X} made more of theirs, about {W} points? the other way',
      (x, a, y, b) => 'シュートの質では' + S(x, 'が') + '上回って約' + n(a) + '点分を得たが、決定力では' + y + 'が上回り、約' + n(b) + '点分を取り返した'],
    ['before the tip, the season’s numbers had almost nothing between them(?:; {X} won by {W})?',
      (x, w) => '試合前の今季成績では両チームにほとんど差はなかった' + (w ? '。結果は' + S(x, 'が') + n(w) + '点差で勝利した' : '')],
    ['{X} won by {W}', (x, w) => '結果は' + S(x, 'が') + n(w) + '点差で勝利した'],
    ['before the tip, the season’s numbers made {X} about {W} points? better: {X} won this as the underdogs',
      (x, w, y) => '試合前の今季成績では' + x + 'が約' + n(w) + '点上回ると見られていたが、' + y + 'が下馬評を覆して勝利した'],
    ['before the tip, the season’s numbers made {X} about {W} points? better', (x, w) => '試合前の今季成績では、' + x + 'が約' + n(w) + '点上回ると見られていた'],
    ['they beat that by {W} points?', w => '結果はその予想を' + n(w) + '点上回った'],
    ['that is roughly how it went', () => 'ほぼ予想どおりの結果となった'],
    ['they won by less than that', () => '実際の点差はそれを下回った'],
    ['home court is worth about {F} points? in this league, and it was {X}’s?', (f, x) => 'このリーグのホームコートアドバンテージは約' + f + '点分で、この試合では' + x + 'がその恩恵を受けた'],
    ['home court is worth about {F}(?: points?)? in this league', f => 'このリーグのホームコートアドバンテージは約' + f + '点'],
    ['it was {X}’s?', x => 'この試合では' + x + 'がその恩恵を受けた'],
    ['the last {W} points of the margin are in no facet at all: the part of a game no factor measures', w => '点差のうち最後の' + n(w) + '点分はどの要素にも表れない。数字では測れない部分だ'],
    ['on these facets alone {X} would have won by more(?:; {W} points? went back to {X} in what no factor measures)?',
      (x, w, y) => 'これらの要素だけなら' + x + 'はもっと大差で勝っていた' + (w ? '。数字では測れない部分で' + n(w) + '点が' + y + 'に戻った' : '')],
    ['{W} points? went back to {X} in what no factor measures', (w, y) => '数字では測れない部分で' + n(w) + '点が' + y + 'に戻った'],
    /* a game the ledger cannot weigh (report.js sectionFactors): the four factors in points, both sides */
    ['weighed by what wins in this league(?: \\(built on {D} of its games\\))?, the four factors were worth about {W} points? to {X}',
      (g, w, x) => 'このリーグの勝敗を決める要素で重み付けすると' + (g ? '（' + g + '試合のデータに基づく）' : '') + '、4ファクターは' + x + 'にとって約' + n(w) + '点分の価値があった'],
    ['by this league’s own win model(?: \\(built on {D} of its games\\))?, {X} came out roughly {W} points? ahead on the four factors',
      (g, x, w) => 'このリーグ独自の勝敗モデルでは' + (g ? '（' + g + '試合のデータに基づく）' : '') + '、' + S(x) + '4ファクターで約' + n(w) + '点上回った'],
    ['put through what decides games in this league(?: \\(built on {D} of its games\\))?, the four factors make it about {W} points? to {X}',
      (g, w, x) => 'このリーグで勝敗を左右する要素に当てはめると' + (g ? '（' + g + '試合のデータに基づく）' : '') + '、4ファクターでは' + x + 'が約' + n(w) + '点上回る計算だ'],
    ['add up the four factors and the game was worth about {W} points? to {X}', (w, x) => '4ファクターを合計すると、' + x + 'が約' + n(w) + '点上回る計算になる'],
    ['weighed factor by factor, {X} came out roughly {W} points? ahead', (x, w) => '要素ごとに見ると、' + S(x) + '約' + n(w) + '点上回った'],
    ['the four factors alone make it about {W} points? to {X}', (w, x) => '4ファクターだけで見ると、' + x + 'が約' + n(w) + '点上回る'],
    ['the biggest gain came from (.+?), worth {W} points?(?:, then (.+?) at {W})?(?:; {X} won {W} back on (.+?))?', (a, w, b, w2, y, w3, c) =>
      lab(a) && (!b || lab(b)) && (!c || lab(c)) ? '最も大きかったのは' + lab(a) + 'で' + n(w) + '点分' + (b ? '、次いで' + lab(b) + 'の' + n(w2) + '点分' : '') +
        (y ? '。' + S(y) + lab(c) + 'で' + n(w3) + '点を取り返した' : '') : null],
    ['{X} won {W} back on (.+?)', (x, w, l) => lab(l) && S(x) + lab(l) + 'で' + n(w) + '点を取り返した'],
    ['the four factors cancelled out: neither side came out more than {W} points? ahead on them', w => '4ファクターは相殺し合い、どちらも' + n(w) + '点を超えて上回ることはなかった'],
    ['{X} gained (.+?)(?:, and gave back (.+?)| and gave nothing back)', (x, g, l) => {
      const gs = factorPts(g), ls = l ? factorPts(l) : [];
      return gs && ls ? S(x) + gs.join('、') + 'を稼ぎ、' + (l ? ls.join('、') + 'を失った' : '失った要素はなかった') : null;
    }],
    ['{X} gained nothing on any factor and gave up (.+?)', (x, l) => { const ls = factorPts(l); return ls && S(x) + 'どの要素でも上回れず、' + ls.join('、') + 'を失った'; }],
    ['gave back (.+?)', l => { const ls = factorPts(l); return ls && ls.join('、') + 'を失った'; }],
    ['the scoreboard margin was {W} points?', w => '実際の点差は' + n(w) + '点だった'],
    ['the final margin was {W} points?, close to what the factors say', w => '最終点差は' + n(w) + '点で、4ファクターの示す数字に近かった'],
    ['the final margin was {W} points?, (more|less) than the factors alone account for',
      (w, k) => '最終点差は' + n(w) + '点で、4ファクターだけで説明できる差より' + (/^more$/i.test(k) ? '大きかった' : '小さかった')],
    ['the scoreboard told a different story: {X} won by {W} points?', (x, w) => '実際のスコアは違った。' + x + 'が' + n(w) + '点差で勝利した'],

    /* the night against the season: season highs, records, runs, returns, milestones, BPM */
    ['{X}’s? {D} (points|rebounds|assists|steals|blocks|threes)(?: for {X})? (were|equalled) the most by anyone in a game in this league this season',
      (p, d, k, x, eq) => (x ? x + 'の' : '') + p + 'が記録した' + stat(d, k) + 'は、今季リーグにおける1試合の個人最多' + (/^equalled$/i.test(eq) ? 'に並んだ' : 'となった')],
    ['{X} matched their season high of {D} (points|rebounds|assists|steals|blocks|threes) for {X}', (p, d, k, x) => x + 'の' + p + 'はシーズンハイに並ぶ' + stat(d, k) + 'を記録した'],
    ['{X}’s? {D} (points|rebounds|assists|steals|blocks|threes) for {X} were a season high, {W} more than their best before',
      (p, d, k, x, w) => x + 'の' + p + 'は' + stat(d, k) + 'でシーズンハイを更新し、それまでの最多を' + n(w) + (/^points$/i.test(k) ? '点' : '本') + '上回った'],
    /* a verb straight after a club's name is made plural by the writer's reviser ("for Harbour Bay were"), so these take either */
    ['{X} (?:has|have) now scored 20 or more in {W} straight games for {X}', (p, w, x) => x + 'の' + p + 'はこれで' + n(w) + '試合連続の20得点以上となった'],
    ['{X} (?:was|were) back for {X} after missing {W} games?, and played {W} minutes?', (p, x, a, b) => x + 'の' + p + 'が' + n(a) + '試合の欠場から復帰し、' + n(b) + '分間プレーした'],
    ['{X}’s? points took their season total past {D} for {X}', (p, d, x) => x + 'の' + p + 'はこの試合で今季通算' + d + '得点を突破した'],
    ['by box plus-minus the best game on the floor was {X}’s? for {X}, ([+-]?\\d+(?:\\.\\d+)?)', (p, x, v) => 'BPMで見ると、コート上で最高の試合をしたのは' + x + 'の' + p + '（' + v + '）だった'],
    ['{X}’s? game for {X} (?:was|were) the best on the floor by box plus-minus, ([+-]?\\d+(?:\\.\\d+)?)', (p, x, v) => 'BPMで見ると、コート上で最高の試合をしたのは' + x + 'の' + p + '（' + v + '）だった'],
    ['box plus-minus rates {X} of {X} as the best player on the floor, at ([+-]?\\d+(?:\\.\\d+)?)', (p, x, v) => 'BPMでは' + x + 'の' + p + 'がコート上で最も優れた選手と評価された（' + v + '）'],

    /* ---- the scout's note ---- */
    ['{X} won this on (.+?) (?:before anything else|above all): they were {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && S(x, 'が') + '何よりも上回ったのは' + lab(l) + '。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だった'],
    ['(.+?) was where {X} won it: they were {Q} there, {X} {Q}',
      (l, x, q, y, r) => lab(l) && x + 'が勝負を決めたのは' + lab(l) + 'だった。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だった'],
    ['{X} have had the better of (.+?) more than anything: they have been {Q} there, {X} {Q}',
      (x, l, q, y, r) => lab(l) && x + 'が最も上回っているのは' + lab(l) + '。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だ'],
    ['the widest gap between them was (.+?), and it went {X}’s? way — they were {Q} there, {X} {Q} — but it was not enough',
      (l, x, q, y, r) => lab(l) && '両チームの差が最も大きかったのは' + lab(l) + 'で、' + x + 'が上回った。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だったが、勝利には届かなかった'],
    /* ...and its two halves, when the reviser has cut it at ", and" */
    ['the widest gap between them was (.+?)', l => lab(l) && '両チームの差が最も大きかったのは' + lab(l) + 'だった'],
    ['it went {X}’s? way — they were {Q} there, {X} {Q} — but it was not enough',
      (x, q, y, r) => x + 'が上回った。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だったが、勝利には届かなかった'],
    ['the widest gap so far is (.+?), and it favours {X}(, who trail)?: they have been {Q} there, {X} {Q}',
      (l, x, tr, q, y, r) => lab(l) && 'ここまで最も差が大きいのは' + lab(l) + 'で、' + (tr ? 'リードを許している' : '') + x + 'が上回っている。' + pct(q) + 'で、' + y + 'は' + pct(r) + 'だ'],
    ['(the other gaps worth the film room|two more for the film room|further down the list|the other gaps to watch after the break): (.+)', (w, list) => {
      const it = list.split(/\) and /).map((s, i, a) => (i < a.length - 1 ? s + ')' : s)).map(s => {
        const m = /^(.+?) \((.*?), (\d+) percentile points (?:clear|ahead)\)$/.exec(s);
        return m && lab(m[1]) ? lab(m[1]) + '（' + (m[2] || '—') + '、' + m[3] + 'パーセンタイル差）' : null;
      });
      return it.indexOf(null) >= 0 ? null : (/film/i.test(w) ? 'ビデオで確認したいその他の差：' : /break/i.test(w) ? '後半に向けて注目すべきその他の差：' : 'そのほかの差：') + it.join('、');
    }],
    ['{X} (came out ahead|are ahead) on (.+?), and with no league scales built for this competition yet those are the two sides against each other rather than against anybody else',
      (x, t, l) => labs(l) && x + 'は' + labs(l) + 'で' + (/came/i.test(t) ? '上回った' : '上回っている') + '。この大会にはまだリーグの基準データがないため、あくまで両チーム同士の比較だ'],
    ['{X} (had|have had) the better of (.+?) — (?:the part of their game that did not cost them|something to build on after the break)',
      (x, t, l) => labs(l) && x + 'は' + labs(l) + 'で' + (/^had$/i.test(t) ? '上回った。敗因とはならなかった部分だ' : '上回っている。後半に向けた好材料だ')],
    /* the same, as the writer now words it (no scales: the two sides against each other) */
    ['{X} (came out ahead|are ahead) on (.+?)', (x, t, l) => labs(l) && S(x) + labs(l) + 'で' + (/came/i.test(t) ? '上回った' : '上回っている')],
    ['there is no league scale for this competition yet, so that is a comparison of the two sides with each other', () => 'この大会にはまだリーグの基準データがないため、あくまで両チーム同士の比較だ'],
    ['{X} (had|have had) the better of (.+?), (?:which is where they can take some credit|something to build on after the break)',
      (x, t, l) => labs(l) && S(x) + labs(l) + 'で' + (/^had$/i.test(t) ? '上回った。その点は評価できる' : '上回っている。後半に向けた好材料だ')],
    ['{X} (?:did their best work|are doing their best work) on (.+?), where they (were|have been) {Q}(?:, with (.+?) not far behind)?',
      (x, l, t, q, r) => (lab(l) && (!r || labs(r)) ? x + 'が' + (/^were$/i.test(t) ? '最も良かった' : '最も良い') + 'のは' + lab(l) + 'で、' + pct(q) + (/^were$/i.test(t) ? 'だった' : 'だ') + (r ? '。' + labs(r) + 'もそれに続いた' : '') : null)],
    ['what they will (?:still want back|want to tighten) starts with (.+?), where they (were|have been) {Q}(?:; (.+?) (?:lagged too|are lagging too))?',
      (l, t, q, r) => (lab(l) && (!r || labs(r)) ? '課題はまず' + lab(l) + 'で、' + pct(q) + (/^were$/i.test(t) ? 'だった' : 'だ') + (r ? '。' + labs(r) + 'も' + (/^were$/i.test(t) ? '物足りなかった' : '物足りない') : '') : null)],
    /* each side in turn after the game, three frames each (2026-10-07) */
    ['(.+?) (?:was|were) {X}’s? strongest suit: they were {Q} there(?:, with (.+?) not far behind)?',
      (l, x, q, r) => (lab(l) && (!r || labs(r)) ? x + 'の最大の武器は' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'もそれに続いた' : '') : null)],
    /* two more ways into each side's best and worst (2026-10-08): five a side, picked by the game */
    ['for {X}, the high point was (.+?): they were {Q} there(?:, with (.+?) not far behind)?',
      (x, l, q, r) => (lab(l) && (!r || labs(r)) ? x + 'の最大の見せ場は' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'もそれに続いた' : '') : null)],
    ['{X} did nothing better than (.+?): they were {Q} there(?:, with (.+?) not far behind)?',
      (x, l, q, r) => (lab(l) && (!r || labs(r)) ? S(x, 'が') + '最も得意としたのは' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'もそれに続いた' : '') : null)],
    ['(.+?) held them back: they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => (lab(l) && (!r || labs(r)) ? lab(l) + 'が足かせとなり、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'も物足りなかった' : '') : null)],
    ['the trouble was (.+?): they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => (lab(l) && (!r || labs(r)) ? '問題は' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'も物足りなかった' : '') : null)],
    ['{X} were at their best on (.+?): they were {Q} there(?:, with (.+?) close behind)?',
      (x, l, q, r) => (lab(l) && (!r || labs(r)) ? S(x, 'が') + '最も良かったのは' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'もそれに続いた' : '') : null)],
    ['nothing went better for {X} than (.+?): they were {Q} there(?:, with (.+?) not far behind)?',
      (x, l, q, r) => (lab(l) && (!r || labs(r)) ? x + 'にとって最もうまくいったのは' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'もそれに続いた' : '') : null)],
    ['the weak spot was (.+?), where they were {Q}(?:; (.+?) lagged too)?',
      (l, q, r) => (lab(l) && (!r || labs(r)) ? '弱点は' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'も物足りなかった' : '') : null)],
    ['(.+?) let them down: they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => (lab(l) && (!r || labs(r)) ? lab(l) + 'が足を引っ張り、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'も物足りなかった' : '') : null)],
    ['where they came up short was (.+?): they were {Q} there(?:; (.+?) lagged too)?',
      (l, q, r) => (lab(l) && (!r || labs(r)) ? '伸び悩んだのは' + lab(l) + 'で、' + pct(q) + 'だった' + (r ? '。' + labs(r) + 'も物足りなかった' : '') : null)],
    ['{X} (also struggled|are also struggling) with (.+?)', (x, t, l) => labs(l) && S(x) + labs(l) + 'でも' + (/struggled/i.test(t) ? '苦戦した' : '苦戦している')],
    ['{X} had trouble with (.+?) too', (x, l) => labs(l) && S(x) + labs(l) + 'でも苦しんだ'],
    ['{X} fell short on (.+?) as well', (x, l) => labs(l) && S(x) + labs(l) + 'でも後れを取った'],
    ['if there is one thing to take into the week, it is (.+?): {X} were {Q} there(' + BEHIND + ')?',
      (l, y, q, bh) => lab(l) && '今週に持ち込む課題を一つ挙げるなら' + lab(l) + '。' + S(y) + pct(q) + (bh ? 'で、チームの中で最もリーグに後れを取っている部分だ' : 'だった')],
    ['the one thing for {X} to take into the week is (.+?): they were {Q} there(' + BEHIND + ')?',
      (y, l, q, bh) => lab(l) && y + 'が今週に持ち込むべき課題は' + lab(l) + '。' + pct(q) + (bh ? 'で、チームの中で最もリーグに後れを取っている部分だ' : 'だった')],
    ['the monday work for {X} starts with (.+?): they were {Q} there(' + BEHIND + ')?',
      (y, l, q, bh) => lab(l) && y + 'が月曜日の練習でまず取り組むべきは' + lab(l) + '。' + pct(q) + (bh ? 'で、チームの中で最もリーグに後れを取っている部分だ' : 'だった')],
    ['nothing else in their game sat further behind the league', () => 'チームの中でこれ以上リーグに後れを取っている部分はなかった'],
    ['(.+?) lagged too', l => labs(l) && labs(l) + 'も物足りなかった'],
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
    /* the season around it, a record, the moment (2026-10-07) */
    ['{X} hand {X} their first defeat of the season', (x, y) => x + 'が' + y + 'に今季初黒星をつける'],
    ['{X} go top with {S} win over {X}', (x, a, b, y) => x + 'が' + y + 'に' + sc(a, b) + 'で勝利し首位浮上'],
    ['{X} stun {X} {S}', (x, y, a, b) => x + 'が' + y + 'を' + sc(a, b) + 'で破る番狂わせ'],
    ['{X} end {X}’s? {D}-game winning run', (x, y, d) => x + 'が' + y + 'の連勝を' + d + 'で止める'],
    ['{X} end {D}-game losing run against {X}', (x, d, y) => x + 'が' + y + 'に勝利し連敗を' + d + 'で止める'],
    ['{X} off the mark at last against {X}', (x, y) => x + 'が' + y + 'に勝利し待望の今季初白星'],
    ['{X} make it {D} straight with {S} win over {X}', (x, d, a, b, y) => x + 'が' + y + 'に' + sc(a, b) + 'で勝利し' + d + '連勝'],
    ['{X} stay perfect with {S} win over {X}', (x, a, b, y) => x + 'が' + y + 'に' + sc(a, b) + 'で勝利し無敗を守る'],
    ['underdogs {X} beat {X} {S}', (x, y, a, b) => x + 'が下馬評を覆し' + y + 'に' + sc(a, b) + 'で勝利'],
    ['{X}’s? league season-best {D} carries {X} past {X}', (p, d, x, y) => p + 'が今季リーグ最多の' + d + '得点、' + x + 'が' + y + 'を下す'],
    ['{X}’s? league season-best {D} is not enough for {X}', (p, d, x) => p + 'が今季リーグ最多の' + d + '得点も、' + x + 'は及ばず'],
    ['{X} wins it for {X} at the death against {X}', (p, x, y) => p + 'が土壇場で決勝点、' + x + 'が' + y + 'に勝利'],
    ['(.+?) alone (?:was|were) worth {D} points? to {X}', (l, d, x) => fac(l) && x + 'は' + fac(l) + 'だけで' + d + '点分を稼いだ'],
    /* the lede's other angles (report.js ledeAngles): a run, a stat the winners won, a player's night; the headline, and
       the standfirst's line for each */
    ['{X} blow it open with an? {D}–0 run to beat {X}', (x, d, y) => x + 'が' + sc(d, 0) + 'のランで突き放し' + y + 'に勝利'],
    ['{X} beat {X} {S} after an? {D}–0 run in the {O}', (x, y, a, b, d, o) => x + 'が' + ord(o) + 'の' + sc(d, 0) + 'のランで' + y + 'に' + sc(a, b) + 'で勝利'],
    ['{X} win the boards {S} to beat {X}', (x, a, b, y) => x + 'がリバウンドで' + sc(a, b) + 'と圧倒し' + y + 'に勝利'],
    ['{X} own the paint, {S}, to beat {X}', (x, a, b, y) => x + 'がペイントエリアを' + sc(a, b) + 'と制し' + y + 'に勝利'],
    ['{X} run {X} ragged, {D} fast-break points to {D}', (x, y, a, b) => x + 'がファストブレイクで' + y + 'を圧倒、速攻からの得点は' + a + '対' + b],
    ['{X} lean on an? {S} bench edge to beat {X}', (x, a, b, y) => x + 'がベンチポイント' + sc(a, b) + 'で優位に立ち' + y + 'に勝利'],
    ['{X} score {D} points off turnovers to beat {X}', (x, d, y) => x + 'が相手のターンオーバーから' + d + '得点を挙げ' + y + 'に勝利'],
    ['{X} live off second chances, {S}, to beat {X}', (x, a, b, y) => x + 'がセカンドチャンスからの得点で' + sc(a, b) + 'と上回り' + y + 'に勝利'],
    ['{X} hit {D} threes to beat {X}', (x, d, y) => x + 'が3Pシュート' + d + '本を沈め' + y + 'に勝利'],
    ['{X} pick {X} clean, {D} steals to {D}', (x, y, a, b) => x + 'が' + a + 'スティールで' + y + 'を圧倒（相手は' + b + '）'],
    ['{X} share it, {D} assists to {D}, to beat {X}', (x, a, b, y) => x + 'が' + a + 'アシスト（相手は' + b + '）とボールを回し' + y + 'に勝利'],
    ['{X} out-shoot {X} {F}% to {F}% eFG', (x, y, a, b) => x + 'がシュートで' + y + 'を上回る（EFG% ' + a + '%対' + b + '%）'],
    ['{X} posts a triple-double in defeat for {X}', (p, x) => p + 'がトリプルダブルも、' + x + 'は敗戦'],
    ['{X} scores {D} as {X} beat {X}', (p, d, x, y) => p + 'が' + d + '得点、' + x + 'が' + y + 'に勝利'],
    ['{X} hits {D} to lift {X} past {X}', (p, d, x, y) => p + 'が' + d + '得点の活躍、' + x + 'が' + y + 'を下す'],
    ['{X}’s? {D} is not enough for {X}', (p, d, x) => p + 'が' + d + '得点も、' + x + 'は及ばず'],
    ['{X} outscored them {S} in the paint', (x, a, b) => S(x) + 'ペイントエリアで' + sc(a, b) + 'と上回った'],
    ['{P} bench outscored theirs {S}', (p, a, b) => own(p) + 'ベンチ陣は相手ベンチを' + sc(a, b) + 'と上回った'],
    ['{X} scored {D} points off turnovers to {D}', (x, a, b) => S(x) + '相手のターンオーバーから' + a + '得点を挙げた（相手は' + b + '得点）'],
    ['{X} took the second chances {S}', (x, a, b) => S(x) + 'セカンドチャンスからの得点で' + sc(a, b) + 'と上回った'],
    ['{X} made {D} threes to {D}', (x, a, b) => S(x) + '3Pシュートを' + a + '本成功させた（相手は' + b + '本）'],
    ['{X} had {D} (steals|assists) to {D}', (x, a, k, b) => S(x) + a + STAT[k.toLowerCase()] + 'を記録した（相手は' + b + '）'],
    ['{X} shot {F}% eFG to {F}%', (x, a, b) => S(x) + 'EFG%で' + a + '%対' + b + '%と上回った'],
    ['{X} had a triple-double for {X}', (p, x) => x + 'の' + p + 'がトリプルダブルを達成した'],
    ['{X} scored {D}( in defeat)? for {X}(?: on {W} of {W} shooting)?(?:, adding (.+))?', (p, d, lost, x, a, b, add) => {
      const more = add ? tail(add) : '';
      if (add && !more) return null;
      return x + 'の' + p + 'は' + (lost ? '敗れたものの' : '') + d + '得点' + more + (a ? '（FG' + n(a) + '/' + n(b) + '）' : '') + 'を記録した';
    }],
    ['{X} beat {X} {S}', (x, y, a, b) => (/^(on|at|in front of) /i.test(x) ? null : x + 'が' + y + 'に' + sc(a, b) + 'で勝利')],
    ['an? {D}–0 run in the {O} settled it', (d, o) => ord(o) + 'の' + sc(d, 0) + 'のランが勝負を決めた'],
    ['an? {M} stretch swung it by {D}', (m, d) => dur(m) + 'の時間帯で点差が' + d + '点動き、勝負が決まった'],
    /* the losers' run or stretch (2026-10-08): told, but it settled nothing */
    ['{X}’s? {D}–0 run in the {O} was not enough', (x, d, o) => x + 'の' + ord(o) + 'の' + sc(d, 0) + 'のランも実らなかった'],
    ['an? {M} stretch worth {D} to {X} was not enough', (m, d, x) => dur(m) + 'の時間帯で' + x + 'が' + d + '点を稼いだが、及ばなかった'],
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
    /* the matchup, valued (2026-10-07): where they stand and how they come in (the table, the runs
       and the meetings are the rules of the report's season section above), what the season's
       numbers expect, the lean and what argues against it, who carries the form */
    ['{K} against {K}: {X} \\({S}\\) host {X} \\({S}\\)', (k, k2, x, a, b, y, c, d) =>
      (rank(k) === rank(k2) ? top(k) + '同士' : top(k) + 'と' + top(k2)) + 'の対決。' + x + '（' + rec(a, b) + '）がホームに' + y + '（' + rec(c, d) + '）を迎える'],
    /* a run, with its latest game when it was recent ("..., the latest 96–71 at home to X despite 25 from Y") */
    ['{X} have lost their last {W}(?:, the latest (.+))?', (x, w, l) => { const t = latestJa(false, l); return t == null ? null : S(x) + n(w) + '連敗中' + t; }],
    ['{X} are unbeaten in {W}(?:, the latest (.+))?', (x, w, l) => { const t = latestJa(true, l); return t == null ? null : S(x) + '開幕から無敗の' + n(w) + '連勝中' + t; }],
    ['{X} are still without a win in {W}(?:, the latest (.+))?',
      (x, w, l) => { const t = latestJa(false, l); return t == null ? null : S(x) + '開幕から' + n(w) + '連敗で、まだ勝利がない' + t; }],
    ['neither has lost yet', () => '両チームともまだ負けがない'],
    ['{X} have won {W} of their last five; {X} {W}', (x, a, y, b) => S(x) + '直近5試合で' + n(a) + '勝、' + y + 'は' + n(b) + '勝'],
    /* how each comes in, outside a run: the home side's sentence, then the visitors' said the other way round */
    ['{X} come in off an? {S} (home win|home defeat|win|defeat)(?: (?:over|to|at) {X}| away from home)?' + CARRIED,
      (x, a, b, what, opp, k, pts, more, stat, p) => {
        const won = /win$/i.test(what);
        return S(x) + '前の試合で' + vsJa(/^home/i.test(what), opp) + scoreJa(won, a, b) + 'で' + (won ? '勝利して' : '敗れて') + 'この一戦を迎える' + carriedJa(k, pts, more, stat, p);
      }],
    ['{X} (?:beat {X}|(won|lost)) {S}( at home to {X}| at home| at {X}| away) last time out' + CARRIED,
      (x, beat, wl, a, b, where, to, at, k, pts, more, stat, p) => {
        const won = !(wl && /^lost$/i.test(wl));
        return S(x) + '前回の試合で' + vsJa(/^ at home/i.test(where), beat || to || at) + scoreJa(won, a, b) + 'で' + (won ? '勝利した' : '敗れた') + carriedJa(k, pts, more, stat, p);
      }],
    ['they met last time out, {X} winning {S} (at home|away)' + CARRIED,
      (x, a, b, h, k, pts, more, stat, p) => '両チームは前回も対戦しており、' + x + 'が' + HOMEAWAY[h.toLowerCase()] + 'で' + sc(a, b) + 'の勝利を収めた' + carriedJa(k, pts, more, stat, p)],
    /* home and away: all one way, or the two halves far apart */
    ['{X} have (won|lost) all {W} (at home|on the road|away)', (x, wl, w, h) => S(x) + HOMEAWAY[h.toLowerCase()] + 'で' + n(w) + '戦全' + (/^won$/i.test(wl) ? '勝' : '敗') + 'だ'],
    ['{X} are {S} (at home|on the road|away) and {S} (at home|on the road|away)',
      (x, a, b, h, c, d, h2) => S(x) + HOMEAWAY[h.toLowerCase()] + 'で' + rec(a, b) + '、' + HOMEAWAY[h2.toLowerCase()] + 'で' + rec(c, d)],
    ['{X} won the only meeting so far, {S}(?:, with {D} from {X})?',
      (x, a, b, d, p) => '今季唯一の対戦では' + x + 'が' + sc(a, b) + 'で勝利している' + (p ? '。その試合では' + p + 'が' + d + '得点を挙げた' : '')],
    ['{X} play for the second time in two days', x => S(x) + '2日連続の試合となる'],
    ['{X} have had {W} days off', (x, w) => S(x) + n(w) + '日間の休養を経て臨む'],
    ['weighed by what wins in this league, the season’s numbers make {X} about {H} points? better here',
      (x, h) => 'このリーグの勝因モデルで重み付けすると、今季の数字ではこの試合は' + x + 'が約' + n(h) + '点上回る'],
    ['on the season’s four factors, {X} are about {H} points? better here', (x, h) => '今季の4ファクターから見ると、この試合は' + x + 'が約' + n(h) + '点上回る'],
    ['(.+?): (.+), worth about {H} points?', (o, w, h) => { const a = first(OPEN, o), b = first(EXPECT, w); return a && b ? a + '。' + b + '、約' + n(h) + '点分に相当する' : null; }],
    ['{X}’s? edge is (.+?), about {H} points? back', (x, l, h) => fac(l) && x + 'の強みは' + fac(l) + 'で、約' + n(h) + '点分を取り返す'],
    ['on these numbers it is close to a toss-up', () => 'この数字では、ほぼ五分五分だ'],
    ['the numbers lean {X}, but not by much: a single run settles games closer than that',
      x => '数字の上ではわずかに' + x + 'が有利だが、その差は大きくない。これより僅差の試合は一度のランで決まる'],
    ['the numbers make {X} clear favourites', x => '数字の上では' + x + 'がはっきりと優位だ'],
    ['on these numbers {X} should win comfortably', x => 'この数字なら、' + x + 'が余裕を持って勝つはずだ'],
    /* if it is close: the games decided by five points or fewer */
    ['in games decided by five points or fewer, {X} are {S} and {X} {S}',
      (x, a, b, y, c, d) => '5点差以内の接戦では、' + x + 'が' + rec(a, b) + '、' + y + 'が' + rec(c, d) + 'だ'],
    ['{X} are {S} in games decided by five points or fewer', (x, a, b) => S(x) + '5点差以内の接戦で' + rec(a, b) + 'だ'],
    ['yes, but {X} come in on {W} straight wins', (x, w) => 'ただし、' + x + 'は' + n(w) + '連勝中でこの試合を迎える'],
    ['yes, but the table has {X} above them', x => 'ただし、順位表では' + x + 'のほうが上だ'],
    ['{X} (?:has|have) scored 20 or more in (?:(every game this season)|each of the last {W}) for {X}',
      (p, all, w, x) => x + 'の' + p + 'は' + (all ? '今季全試合' : '直近' + n(w) + '試合連続') + 'で20得点以上を記録している'],
    ['{X} (?:is|are) averaging {F} over the last three for {X}, up from {F} for the season',
      (p, a, x, b) => x + 'の' + p + 'は直近3試合で平均' + a + '得点と、今季平均の' + b + '得点から調子を上げている'],
    ['{X} leads? {X} with {F} points a game', (p, x, f) => x + 'では' + p + 'が1試合平均' + f + '得点でチームトップ'],
    ['{X} of {X} needs? {W} for {D} points this season', (p, x, w, d) => x + 'の' + p + 'は今季通算' + d + '得点まであと' + n(w) + '点'],
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
  /* the sentence without its full stop, unless the stop is the last of a name's initials ("... to Valencia B.C."): that
     one stays on the name */
  const body = s => (/(?:^|[\s(])(?:[A-Z]\.){2,}$/.test(s) ? s : s.replace(/\.$/, ''));
  /* one sentence at a time: a paragraph is left for the engine to split, so a name at the end
     of a template can never swallow the sentence after it. The break is the engine's own: an
     initial or a title ("J. Anderson", "St. Léonard") does not end a sentence */
  const BREAK = /(?<!(?:^|[\s(])(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.)(?<=[.!?])\s+(?=[A-Z0-9“"‘'(])/;
  /* A BREAK INSIDE A NAME ("Next for Valencia Basket: C.B. Al-Qazeres Extremadura at home ...", "at Pol. Maloste, ..."):
     the engine splits there and, when the piece before will not translate on its own, tries it joined with the next.
     A text with a break in it is one sentence only when every piece before a break ends on initials or a short
     abbreviation (C.B., Pol.) and is no sentence of its own: after a real full stop ("... is 2–1 to Valencia B.C. Neon
     City host ...") the piece before translates, and the text is left for the engine to split */
  const ABBR = /(?:^|[\s(])(?:(?:[A-Z]\.){2,}|[A-Z][A-Za-z]{0,3}\.)$/;
  let lastText = null, lastOne = true;
  const oneSentence = s => {
    if (!BREAK.test(s)) return true;
    if (s !== lastText) {
      lastText = s;
      lastOne = s.split(BREAK).slice(0, -1).every(p => ABBR.test(p) && clause(body(p), new Map()) == null);
    }
    return lastOne;
  };
  const sentence = s => (oneSentence(s) ? finish(clause(body(s), new Map()), s) : null);
  const one = (re, fn) => m => {
    if (!oneSentence(m[0])) return null;
    const k = re.exec(body(m[0]));
    return k ? finish(fn(...k.slice(1)), m[0]) : null;
  };

  /* the headlines and standfirsts also travel on news cards outside any report container */
  const HEADLINE = RULES.filter(r => /overwhelm|outlast|steal it late|overturn|come from behind|pull away|triple-double carries|sees off| edge | tie | beat |level at|lead |their first defeat of the season$|go top with|stun|winning run|losing run against|off the mark at last against|straight with|stay perfect|season-best|at the death|ragged|clean, |out-shoot|triple-double in defeat|to lift|is not enough for/.test(r[0]))
    .map(([src, fn]) => [rx(src, '\\.?'), one(rx(src), fn)]);
  const STANDFIRST = [/settled it/, /stretch swung/, /shooting went/, /possessions decided/, /offensive glass belonged/, /whistle sent/,
    /down with five minutes left$/, /nearly went/, /then it was not/, /with five to play$/, /trailed by \{D\} at the break/, /tight throughout/,
    /point margin/, /^full time$/, /twenty minutes/, /won both quarters/, /took over in the second/, /built the lead/, /lead by \{D\}$/,
    /* the season around it, a record and the moment (2026-10-07): the first of each stakes pair is the standfirst's */
    /this was their first defeat$/, /^the win takes/, /started the night/, /^it ended \{X\}/, /^it ended a run of/, /first win of the season, at the/,
    /^it is \{W\} wins in a row/, /are still unbeaten/, /should have been/, /by anyone in a game/, /seconds\? left\( in overtime\)\? won it for/, /alone \(\?:was\|were\) worth/,
    /won the boards \{S\}$/, /in the paint$/, /bench outscored theirs/, /scored \{D\} on the break/, /points off turnovers to \{D\}$/, /took the second chances/,
    /made \{D\} threes to/, /\(steals\|assists\) to \{D\}$/, /shot \{F\}% eFG to/, /had a triple-double for \{X\}$/, /\( in defeat\)\? for/,
    /run in the \{O\} was not enough$/, /stretch worth \{D\}/]
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
      'no club yet': 'まだクラブはありません',
      'youth': 'ユース',
      'a youth team': 'ユースチーム',
      'the same club in other leagues and competitions': 'このクラブの他のリーグ・大会',
      'What decided it, in points': '勝敗を分けた要素（点数換算）',
      'Form and what comes next': '直近の調子と次戦',
      'Final margin': '最終点差',
      'The season said': 'シーズン成績による予想',
      'Shot quality': 'シュートの質',
      'Shot making': 'シュート決定力',
      'Offensive glass': 'オフェンスリバウンド',
      'Getting to the line': 'フリースロー獲得',
      'Free-throw shooting': 'フリースローの精度',
      'Home court': 'ホームコート',
      'Everything else': 'その他',
      'margin': '点差',
      'next game': '次戦',
      'each facet weighed by this league’s own model of what wins': '各要素はこのリーグ独自の勝因モデルで重み付け',
      'each factor at its usual weight in points per 100 possessions': '各要素は100ポゼッションあたりの標準的な重みで換算',
      'shot quality is what the shots taken are worth at the league’s make rates, shot making the rest': 'シュートの質は打ったシュートをリーグ平均の成功率で換算した値、シュート決定力はその残り',
      'shot quality is what the shots taken are worth at this game’s make rates, shot making the rest': 'シュートの質は打ったシュートをこの試合の成功率で換算した値、シュート決定力はその残り',
      'the rows add up to the final margin, the home side’s minus the away side’s': '各行の合計が最終点差（ホームからアウェーを引いた値）',
      'the last five results, this game last': '直近5試合（右端がこの試合）',
      'record, place in the table and run': '成績・順位・連勝/連敗',
      'the next fixture': '次の試合'
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
        const parts = m[0].split(BREAK), out = [];
        for (let i = 0; i < parts.length; i++) {
          let t = finish(first(STANDFIRST, body(parts[i])), parts[i]);
          /* a break inside a name, as the engine treats it: the piece with the next */
          if (t == null && i + 1 < parts.length && ABBR.test(parts[i])) {
            const j = parts[i] + ' ' + parts[i + 1];
            t = finish(first(STANDFIRST, body(j)), j);
            if (t != null) i++;
          }
          if (t == null) return null;
          out.push(t);
        }
        return out.join('');
      }],
      [/^(\d+) players? out( so far)?$/i, m => m[1] + '人が欠場' + (m[2] ? '（集計中）' : '')],
      [/^(\d+) out$/i, m => m[1] + '人欠場'],
      [/^Mark (.+) as released — they leave the injury report and the game previews$/, m => m[1] + 'を退団扱いにする — 欠場情報と試合の見どころから外れます']
    ])
  }, 'report');
})();
