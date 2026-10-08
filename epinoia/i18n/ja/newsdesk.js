'use strict';
/* The "newsdesk" pack, 日本語: the league newsdesk's storylines, briefing and coverage plan (epinoia/narrative.js, drawn by
   newsdesk.js in the 'newsdesk' sentence context). Keys are the English on screen; every language carries the same keys
   (supabase/tests/i18n.test.mjs). The sentences are translated whole, one anchored pattern per template
   (supabase/tests/newsdesk-i18n.test.mjs). Names pass through as the data has them. No other site is named in these
   files.

   Written as Japanese sports desks write: the table in 首位 / 3位, records as 9勝2敗, games behind as ゲーム差, runs as
   5連勝 / 3連敗, a score with a full-width dash (88－86) and the winner first, クラブ for a club, 。 and 、. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;

  /* ---------------------------------------------------------------- pieces --- */
  /* narrative.js spell(): no, one ... twelve, then digits */
  const NUM = { no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const n = w => (w == null ? '' : /^\d/.test(w) ? String(w) : String(NUM[String(w).toLowerCase()]));
  const WORDS = 'no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+';
  /* place(): first ... tenth, then 11th, 12th ... */
  const PLACE = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const rank = k => PLACE[String(k).toLowerCase()] || parseInt(k, 10);
  const place = k => rank(k) + '位';
  const top = k => (rank(k) === 1 ? '首位' : place(k));
  const rec = (w, l) => w + '勝' + l + '敗';
  const sc = (a, b) => a + '－' + b;
  const grp = x => { const m = /^group (.+)$/i.exec(String(x)); return m ? 'グループ' + m[1] : String(x); };
  const ing = g => (g ? grp(g) + 'の' : '');

  /* dates, as dayWords() writes them in en-GB: "Wednesday 2 December", "23 October", "Saturday"; and the newsroom list's
     short day ("8 Oct", "12 Sept") */
  const DAY = { sunday: '日曜日', monday: '月曜日', tuesday: '火曜日', wednesday: '水曜日', thursday: '木曜日', friday: '金曜日', saturday: '土曜日' };
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)';
  const WDAYS = Object.keys(DAY).join('|');
  const DAYSRC = '(?:' + WDAYS + '),? \\d{1,2} (?:' + MONTHS.join('|') + ')';
  const date = s => {
    const t = String(s).trim();
    let m = /^(\w+),? (\d{1,2}) (\w+)$/.exec(t);
    if (m && DAY[m[1].toLowerCase()] && MONTHS.indexOf(m[3].toLowerCase()) >= 0) return (MONTHS.indexOf(m[3].toLowerCase()) + 1) + '月' + m[2] + '日(' + DAY[m[1].toLowerCase()].charAt(0) + ')';
    m = /^(\d{1,2}) (\w+)$/.exec(t);
    if (m && MONTHS.indexOf(m[2].toLowerCase()) >= 0) return (MONTHS.indexOf(m[2].toLowerCase()) + 1) + '月' + m[1] + '日';
    if (m && new RegExp('^' + MON + '$', 'i').test(m[2])) return (MONTHS.findIndex(x => x.slice(0, 3) === m[2].slice(0, 3).toLowerCase()) + 1) + '月' + m[1] + '日';
    return t;
  };
  const wd = s => DAY[String(s).toLowerCase()] || String(s);

  /* gamesWord(): half a game, one game, a game and a half, two and a half games, 13½ games -> 0.5ゲーム ... */
  const GAMES = 'half a game|one game|a game and a half|(?:no|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: and a half)? games|\\d+½? games';
  const gwNum = s => {
    const t = String(s).toLowerCase();
    if (t === 'half a game') return 0.5;
    if (t === 'one game' || t === 'a game') return 1;
    if (t === 'a game and a half') return 1.5;
    let m = /^(\w+)( and a half)? games$/.exec(t);
    if (m && NUM[m[1]] != null) return NUM[m[1]] + (m[2] ? 0.5 : 0);
    m = /^(\d+)(½)? games$/.exec(t);
    return m ? +m[1] + (m[2] ? 0.5 : 0) : null;
  };
  const gw = s => gwNum(s) + 'ゲーム';

  /* the facets: the newsdesk's own (narrative.js FACET) and the match report's (story.js FACET_LABEL), as the ctx table
     and the report pack word them */
  const FACET = { 'shooting': 'シュート', 'the turnover battle': 'ターンオーバーの攻防', 'the offensive glass': 'オフェンスリバウンド', 'getting to the line': 'フリースローの獲得' };
  const FAC = Object.assign({ 'the shots they got': 'シュートの質', 'the shots that fell': 'シュート決定力', 'turnovers': 'ターンオーバー',
    'free-throw shooting': 'フリースローの精度', 'home court': 'ホームコート', 'everything else': 'その他' }, FACET);
  const facet = x => FAC[String(x).toLowerCase()];
  const alt = o => Object.keys(o).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const STAT = { points: '得点', rebounds: 'リバウンド', assists: 'アシスト' };
  const stat = (v, k) => (/^threes$/i.test(k) ? '3Pシュート' + v + '本成功' : v + STAT[String(k).toLowerCase()]);
  /* a two-legged tie's legs: "first leg", "second leg", "third leg", "11th leg" (and the older "leg 3") -> 第N戦 */
  const LEGS = '(?:' + Object.keys(PLACE).join('|') + '|\\d+(?:st|nd|rd|th)) leg|leg \\d+';
  const LEG = l => { const m = /^leg (\d+)$/i.exec(l) || /^(\w+) leg$/i.exec(l); return m ? '第' + rank(m[1]) + '戦' : String(l); };
  /* the award races' number and its measure, as the page draws them in one line (0018 compute_season_awards) */
  const MEASURE = {
    'efficiency per game': '1試合平均貢献度', 'points per game': '1試合平均得点', 'rebounds per game': '1試合平均リバウンド',
    'assists per game': '1試合平均アシスト', 'steals and blocks per game': '1試合平均スティール+ブロック', 'three-point percentage': '3P成功率',
    'points scored per game': '1試合平均得点', 'points allowed per game': '1試合平均失点'
  };

  /* where a rank sits, as the newsroom says it (newsroom.js rankText and rankWord, and the narrower fields they are put
     in): "the best in the league", "the league’s worst", "first in the league", "second-best in the league", "the
     third-quickest in the league", "the most in the league", "fifth among the league’s regulars", "the fourth-best among
     the league’s point guards", "the highest share in the league" */
  const PLW = Object.keys(PLACE).join('|') + '|\\d+(?:st|nd|rd|th)';
  const AMONG = ' (?:in the league|among the (?:league’s )?(?:regulars|point guards|wings|bigs))';
  const RANKS = '(?:the league’s (?:best|worst)|(?:the )?(?:(?:' + PLW + ')-)?(?:best|worst|quickest|slowest|most|fewest|highest share|lowest share)' + AMONG +
    '|(?:last|' + PLW + ')' + AMONG + ')';

  /* {X} a name, {D} a count, {F} a figure, {G} a signed figure (+12.7, −3.5), {W} a count in words, {S} a score or a
     record (88–86, 5–1), {K} a place (third, 11th), {O} a short ordinal (3rd, its number captured), {Y} a day
     ("Wednesday 2 December"), {M} a date ("23 October"), {V} a weekday, {A} games behind, {L} a newsdesk facet, {B} a
     match report facet, {E} a leg of a tie; and for the newsroom's pieces {R} a rank (RANKS), {Z} a short day ("8 Oct"),
     {J} a list of names ("A, B and C"), {N} what a club is built on (NOUN), {T} a turning connective and {C} a cautioning
     one that open a sentence ("Still,", "That said,", "A word of caution:", or a phrase the newsroom learned), {Q} a
     cold spell's predicate ("has hit a rough patch", or a learned one) */
  const TOK = {
    X: '([^,;:—]+?)', D: '(\\d+)', F: '(\\d+(?:\\.\\d+)?)', G: '([+−-]?\\d+(?:\\.\\d+)?)', W: '(' + WORDS + ')',
    S: '(\\d+)[–-](\\d+)', K: '(' + Object.keys(PLACE).join('|') + '|\\d+(?:st|nd|rd|th))', O: '(\\d+)(?:st|nd|rd|th)',
    Y: '(' + DAYSRC + ')', M: '(\\d{1,2} (?:' + MONTHS.join('|') + '))', V: '(' + WDAYS + ')', A: '(' + GAMES + ')',
    L: '(' + alt(FACET) + ')', B: '(' + alt(FAC) + ')', E: '(' + LEGS + ')',
    R: '(' + RANKS + ')', Z: '(\\d{1,2} ' + MON + ')', J: '([^;:—]+?)',
    N: '(transition attack|half-court offence|half-court defence|offensive rebounding|rim protection|ball pressure|ball security)',
    T: '([A-Z][a-z’\']*(?: [a-z’\']+){0,3},)', C: '([A-Z][a-z’\']*(?: [a-z’\']+){0,3}[,:])',
    Q: '((?:has|have|is|are|was|were|had)(?: [a-z’\'-]+){1,6})'
  };
  const rx = (src, end) => new RegExp('^(?:' + src.replace(/\{([A-Z])\}/g, (m, k) => TOK[k]) + ')' + (end || '') + '$', 'i');
  const lit = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = (list, s) => { for (const [re, fn] of list) { const m = re.exec(s); if (m) { const o = fn(...m.slice(1)); if (o != null) return o; } } return null; };

  /* the next game, three ways (nextText, whenNext, nextToTry): "Birch City visit on Wednesday 2 December", "away at Ash
     City on ...", "when Birch City visit on ...", "Shiga Lakes, who visit on ..." / ", at home on ..."; and the
     newsroom's "at home to Ash City on ..." */
  const NEXT = [
    [new RegExp('^away at (.+?) on (' + DAYSRC + ')$', 'i'), (o, d) => ({ opp: o, home: false, day: date(d) })],
    [new RegExp('^at home to (.+?) on (' + DAYSRC + ')$', 'i'), (o, d) => ({ opp: o, home: true, day: date(d) })],
    [new RegExp('^(?:when )?(.+?) visit on (' + DAYSRC + ')$', 'i'), (o, d) => ({ opp: o, home: true, day: date(d) })]
  ];
  const nx = s => first(NEXT, s);
  const vs = t => t.day + '、' + (t.home ? 'ホーム' : 'アウェー') + 'で' + t.opp + 'と対戦';
  const tie = t => t.day + '、' + (t.home ? 'ホーム' : 'アウェー') + 'での' + t.opp + '戦';

  /* a series' or a tie's state (the big picture, the slate's angle) */
  const STATUS = [
    ['{X} through on aggregate against {X}, {S}', (x, y, a, b) => x + 'が合計' + sc(a, b) + 'で' + y + 'を下し勝ち抜け'],
    ['{X} lead {X} by {D} on aggregate', (x, y, d) => x + 'が合計スコアで' + y + 'を' + d + '点リード'],
    ['{X} and {X} level on aggregate', (x, y) => x + 'と' + y + 'は合計スコアで並ぶ'],
    ['{X} v {X} to start', (x, y) => x + ' VS ' + y + 'はこれから'],
    ['{X} through against {X}, {S}', (x, y, a, b) => x + 'が' + y + 'を' + rec(a, b) + 'で下し勝ち抜け'],
    ['{X} and {X}(?: are)? level at {S}', (x, y, a, b) => x + 'と' + y + 'は' + rec(a, b) + 'のタイ'],
    ['{X} lead {X} {S}', (x, y, a, b) => x + 'が' + y + 'を相手に' + rec(a, b) + 'とリード']
  ];
  const STATUS_C = STATUS.map(([src, fn]) => [rx(src), fn]);
  /* a game's angle, its parts joined with "; " (slate() bits) */
  const ANGLE = [
    ['a rivalry', () => 'ライバル対決'],
    ['{O} against {O}', (a, b) => top(a) + 'と' + top(b) + 'の対決'],
    ['the numbers say it turns on {L}', l => '数字の上では' + facet(l) + 'が勝負の鍵'],
    ['a rematch', () => '今季2度目の顔合わせ'],
    ['meeting {W} this season', w => '今季' + n(w) + '度目の顔合わせ'],
    ['game {D} of the series', d => 'シリーズ第' + d + '戦'],
    ['first leg', () => '第1戦'],
    ['(?:game {D}|second leg): (.+)', (d, s) => { const t = first(STATUS_C, s); return t && (d ? '第' + d + '戦' : '第2戦') + '：' + t; }]
  ].map(([src, fn]) => [rx(src), fn]);
  const angle = s => { const out = String(s).split('; ').map(p => first(ANGLE, p)); return out.indexOf(null) >= 0 ? null : out.join('、'); };

  /* a storyline's head inside another sentence ("Feature: <head>."): the newsdesk's own, else a match report's headline
     as the engine reads it (the report pack's) */
  let ENG = null;
  const headline = h => { const own = clause(h); return own != null ? own : (ENG ? ENG(h) : null); };
  /* a bracket's own name for the round ("Qualifiers") as the kicker reads it, when the dictionaries have it whole */
  const label = l => { if (/^the play-offs$/i.test(l)) return 'プレーオフ'; const t = ENG ? ENG(l) : null; return t && !/[A-Za-z]/.test(t) ? t : l; };

  /* the fixed sentences and phrases, whole */
  const FIXED = {
    /* the race, the line, the regular season */
    'Half the league is within a game and a half of first: one week can turn the table over': 'リーグの半数が首位から1.5ゲーム差以内にいる。1週間で順位表がひっくり返ることもある',
    'One result can change who is top': '1試合の結果で首位が入れ替わりうる',
    'The season’s first real separation': '今季初めて、はっきりとした差がついた',
    'A cushion, but not one a bad week cannot erase': '余裕はあるが、悪い1週間で消えてしまう程度のものだ',
    'The regular season set the seeds; from here it is series': 'レギュラーシーズンでシードが決まった。ここからはシリーズの戦いだ',
    'Nobody else is within a game and a half of them': '1.5ゲーム差以内で追うクラブはいない',
    'There is one club within a game and a half of them': '1.5ゲーム差以内で1クラブが追う',
    'Weighed by this league’s own model of what wins': 'このリーグ独自の勝因モデルで重み付けした数字',
    /* runs, slides, the unbeaten and the winless */
    'Nobody else in the league has a winning run this long going': 'リーグでこれほど長い連勝を続けているクラブはほかにない',
    'Nobody else in the league has strung this many together': 'リーグでこれほどの連勝を記録したクラブはほかにない',
    'A run like this changes where a season is heading': 'こうした連勝はシーズンの行方を変える',
    'Nobody has had an easier schedule so far': 'ここまでこれより楽な日程だったクラブはない',
    'It is already their longest run of the season': 'すでに今季最長の連勝だ',
    'The longest losing run in the league right now': '現在リーグ最長の連敗だ',
    'Every defeat now costs ground that is hard to win back': '今は負けるたびに、取り戻しにくい差が広がっていく',
    /* the record against the points */
    'Records built on close finishes tend to drift back towards the points': '接戦の勝利で積み上げた成績は、やがて得失点に見合った水準に戻っていくものだ',
    'They have still been outscored over the season: better than the record is not the same as good': 'それでも今季通算では得失点差がマイナスだ。成績以上の実力があることと、強いことは同じではない',
    /* the players */
    'Nobody guards a scorer in this kind of form with one player': 'これほど好調なスコアラーを1人で守れる選手はいない',
    'A player taking this many minutes is a big part of how a side plays; how they cope without them is the story': 'これだけの出場時間を担う選手は、チームの戦い方の大きな部分を占める。不在の中でどう戦うかが焦点だ',
    'Box plus-minus counts everything in the box score against what a player’s minutes are worth; it is the closest thing the box has to a player’s value': 'BPMはボックススコアのすべての項目を、その選手の出場時間に見合う価値と比べて数える。ボックススコアから読み取れる選手の価値に最も近い数字だ',
    'Box plus-minus counts everything in the box score against what a player’s minutes are worth': 'BPMはボックススコアのすべての項目を、その選手の出場時間に見合う価値と比べて数える指標だ',
    'Points get noticed; the rest of a good night rarely does': '得点は注目されるが、好プレーのそれ以外の部分が注目されることはめったにない',
    'Nobody else aged 21 or under has a role like it': '21歳以下でこれほどの役割を担う選手はほかにいない',
    'The numbers agree: the best box plus-minus of the three the fans liked most': '数字も同じ評価だ。ファンの支持を集めた上位3人の中で最も高いBPMを記録した',
    /* the season's bests and the game of the week (narrative.js ARC_WORDS) */
    'Every other night this season is measured against these now': '今季のほかのすべての試合は、これからこの数字と比べられる',
    'Every other night this season is measured against it now': '今季のほかのすべての試合は、これからこの記録と比べられる',
    'Stolen in the last five minutes': '残り5分からの逆転劇',
    'A big lead thrown away': '大量リードを吐き出した',
    'A comeback': '逆転勝利',
    'It went to overtime': '延長戦にもつれ込んだ',
    'The lead changed hands again and again': '何度もリードが入れ替わった',
    'A lead nearly given away': 'リードを危うく吐き出しかけた',
    'Decided by a single score': '1ポゼッション差の決着',
    'It went to the last shot': '最後のシュートまでもつれた',
    /* the same two twice, the upsets, the play-offs */
    'Two games against the same side in a few days test the adjustments, and only one side made them': '数日のうちに同じ相手と2試合を戦えば修正力が試される。それができたのは一方だけだった',
    'Results like this are where tables get rearranged': 'こうした結果が順位表を塗り替える',
    'Two legs, decided on aggregate': '2試合の合計スコアで勝敗が決まる',
    'In the play-offs every game moves the series': 'プレーオフでは1試合ごとにシリーズが動く',
    /* the schedule, the lens */
    'A record against the league’s best is worth more than the same record against its worst': 'リーグ上位を相手にした成績は、下位を相手にした同じ成績よりも価値がある',
    'The table counts wins; adjusted margins count how well a side has played against whom, and they are the better guide to what comes next': '順位表が数えるのは勝ち星、補正後の得失点差が数えるのは誰を相手にどれだけ戦えたか。今後を占うには後者のほうが確かな指標だ',
    'It is the lens to read every result and every preview through': 'すべての結果とプレビューは、この視点から読み解ける',
    /* what changed, and the week's round-up */
    'Updated with the latest games': '最新の試合結果を反映した',
    'No longer running': 'このストーリーは終了した',
    'The week in the play-offs: every series, where it stands, and what decided each game': '今週のプレーオフ：全シリーズの現状と、各試合の勝負を分けたもの',
    'The week in the league: the results, the table, and the storylines that moved': '今週のリーグ：試合結果、順位表、そして動いたストーリーライン',
    /* the ways to cover it */
    'the race, in a table and a paragraph': '首位争いを順位表と短い解説で',
    'a preview of the next meeting between the contenders': '上位同士の次の直接対決のプレビュー',
    'the run-in: every contender’s remaining games, side by side': '終盤戦：上位各クラブの残り日程を並べて比較',
    'a weekly "state of the race" column': '毎週の「首位争いの現状」コラム',
    'the regular season in review: the table, the turning points, the best players': 'レギュラーシーズンの振り返り：順位表、転機となった試合、ベストプレーヤー',
    'who is in, who is out, and the schedule each has left': '圏内と圏外のクラブ、それぞれの残り日程',
    'a "games that decide it" list from the fixtures': '日程から選ぶ「勝負を決める試合」リスト',
    'what they are playing for now: the seeding': '今後の目標：シード順位',
    'what the rest of the season is for: the young players, next season': '残りのシーズンの意味：若手の起用と来季への準備',
    'how the run was built, game by game': '連勝の軌跡を1試合ずつ',
    'what changed: the numbers before and during it': '何が変わったのか：連勝前と連勝中の数字',
    'what has gone wrong, in the numbers': '何がうまくいっていないのか、数字で検証',
    'the one fixture that could end it': '連敗を止められそうな一戦',
    'what makes them so hard to beat': 'なぜこれほど負けないのか',
    'the fixture most likely to end it': '無敗が止まるとすればこの一戦',
    'where the first win could come from': '初勝利が見込めそうな試合',
    'a data piece: the record against the points': 'データ記事：得失点と成績のずれ',
    'what the close games have in common': '接戦に共通するもの',
    'a data piece: the one number to watch in their games': 'データ記事：このクラブの試合で注目すべき一つの数字',
    'a coach’s-eye preview built on it': 'それを軸にしたコーチ目線のプレビュー',
    'a player feature': '選手特集',
    'a shot chart and a clip from each of the games': '各試合のショットチャートと映像クリップ',
    'what changed: the minutes, and why the coach is giving them': '何が変わったのか：出場時間と、コーチがそれを与える理由',
    'what changed: the role and the shots': '何が変わったのか：役割とシュート',
    'a social post ready for the night it happens': '達成の夜にすぐ出せるSNS投稿',
    'how the rotation has changed without them': '不在の間にローテーションがどう変わったか',
    'a player profile built on the whole line, not the points': '得点だけでなく成績全体から描く選手プロフィール',
    'a "most valuable so far" ranking': '「ここまでの最優秀選手」ランキング',
    'a feature: what they do that the scoring column misses': '特集：得点欄には表れない貢献',
    'where the points could come from: the fixtures ahead': 'どこで白星を拾えるか：今後の日程',
    'the night, in the play-by-play': 'その夜をテキスト速報で振り返る',
    'a graphic of each line': '各記録のグラフィック',
    'the recap, rewritten as a feature with the moments in it': '試合レポートを、勝負所の場面を盛り込んだ特集記事に',
    'the highlights, cut around the finish': '終盤を中心に編集したハイライト',
    'a clip of the finish': '終盤の映像クリップ',
    'the two games as one story: what the losers changed, and why it did not work': '2試合を一つの物語として：敗れた側は何を変え、なぜうまくいかなかったのか',
    'what changed between the two games': '2試合の間に何が変わったか',
    'what the winners did that nobody expected': '勝ったチームが見せた、誰も予想しなかったこと',
    'how the tie was won, leg by leg': '勝ち抜けまでの道のりを1試合ずつ',
    'a preview of the next leg: what the side behind has to change': '次戦のプレビュー：追う側は何を変えるべきか',
    'how the series was won, game by game': 'シリーズ突破までを1試合ずつ',
    'a series preview: the regular-season meetings and the facet it turns on': 'シリーズプレビュー：レギュラーシーズンの対戦と勝負の鍵',
    'a game-by-game series tracker': '1試合ごとのシリーズ経過',
    'the matchup to watch on each side': '両チームの注目マッチアップ',
    'a data piece: the records that the schedule explains': 'データ記事：日程の強さで説明できる成績',
    'the run of fixtures ahead, by strength': '今後の対戦相手を強さ順に',
    'a power ranking built on adjusted margins, beside the table': '補正後の得失点差によるパワーランキングを順位表と並べて',
    'the night, in the numbers': 'その夜を数字で振り返る',
    'a feature on the player and the minutes the club is giving them': '選手と、クラブが与えている出場時間についての特集',
    'the fans’ pick against the numbers’ pick, side by side': 'ファンの選択と数字の選択を並べて比較',
    'an explainer for new readers': '新しい読者向けの解説',
    'a recurring "the number that matters" box': '定期コーナー「注目の数字」',
    /* the threads under a fixture (narrative.js threadsOf) */
    'Two of the clubs at the top meet': '上位クラブ同士の対戦',
    'Two of the clubs fighting for the line meet': 'プレーオフ圏を争うクラブ同士の対戦',
    /* the closer: its figures, its why, its ways to cover it */
    'points in clutch time': 'クラッチタイムの得点',
    'close finishes': '接戦の試合数',
    'share of the club’s': 'チーム得点に占める割合',
    'Points at the end of close games are the ones a season turns on': '接戦終盤の得点こそが、シーズンを左右する',
    'the closer: a feature built on the last four minutes': '勝負強さ：最後の4分間を軸にした特集',
    'a clip of every basket in clutch time': 'クラッチタイムの全得点シーンの映像クリップ',
    /* the questions to ask that need no figure */
    'What has to change to end the run': '連敗を止めるには何を変える必要がありますか',
    'Much the same minutes and many more points: what is different': '出場時間はほぼ同じなのに、得点は大きく増えています。何が違うのですか',
    'Two defeats to the same side in a few days: what did they do that you could not answer': '数日のうちに同じ相手に2敗しました。相手の何に対応できなかったのですか',
    'By the margins, adjusted for whom you have played, you are the best side in the league: do you believe it': '対戦相手を考慮した得失点差では、リーグ最強のチームです。そう思いますか',
    'You have scored 20 or more in every game this season: what is working': '今季は全試合で20得点以上を記録しています。何がうまくいっているのですか',
    /* the page's own words around the sentences (newsdesk.js): the badges, the card's foot, the slate's figures */
    'New': '新着',
    'Updated': '更新',
    'Resolved': '完結',
    'finished': '終了',
    'the player': '選手',
    'the game ↗': '試合 ↗',
    'what is at stake': '注目度',
    'the season’s numbers:': '今季の数字：',
    'watch:': '注目：'
  };

  /* ====================================================== the newsroom's pieces === */
  /* THE NEWSROOM (newsroom.js) writes whole pieces beside the storylines - the week's games to watch, a player gone cold,
     the MVP case, a young talent, what a club is built on, a run or a slide from the inside, the best five, the shot
     clock, a star missing - and the game to watch's card. One pattern per template, its branches in it. A slot the
     newsroom may fill from the style it learned (the connective that turns or cautions at the head of a sentence, the
     predicate of a cold spell) is read by what it is for, so a sentence with a learned phrase still comes back whole;
     the question headlines it learns are its own and stay as written. */

  /* a rank, said (RANKS): リーグトップ, リーグ2位, リーグワースト2位, リーグ最下位, リーグ最速, リーグで3番目に速い,
     リーグの主力選手で5位, リーグのポイントガードで4位 */
  const GROUP = { 'regulars': '主力選手', 'point guards': 'ポイントガード', 'wings': 'ウイング', 'bigs': 'ビッグマン' };
  const RWORD = {
    'best': (k, a) => a + (k ? k + '位' : 'トップ'),
    'worst': (k, a) => a + 'ワースト' + (k ? k + '位' : ''),
    'quickest': (k, a, b) => (k ? b + k + '番目に速い' : a + '最速'),
    'slowest': (k, a, b) => b + (k ? k + '番目に遅い' : '最も遅い'),
    'most': (k, a, b) => (k ? b + k + '番目に多い' : a + '最多'),
    'fewest': (k, a, b) => (k ? b + k + '番目に少ない' : a + '最少'),
    'highest share': (k, a, b) => b + (k ? k + '番目に高い割合' : '最も高い割合'),
    'lowest share': (k, a, b) => b + (k ? k + '番目に低い割合' : '最も低い割合')
  };
  const rankJa = s => {
    const t = String(s).toLowerCase().replace(/^the /, '');
    const lg = /^league’s (best|worst)$/.exec(t);
    if (lg) return RWORD[lg[1]](null, 'リーグ');
    const m = /^(.+?) (?:in the league|among the (league’s )?(regulars|point guards|wings|bigs))$/.exec(t);
    if (!m) return null;
    /* before a noun (リーグトップ, 主力選手で2位), before a verb (リーグで2番目に速い) */
    const a = m[3] ? (m[2] ? 'リーグの' : '') + GROUP[m[3]] + 'で' : 'リーグ', b = m[3] ? a : 'リーグで';
    const w = /^(?:(\w+)-)?(best|worst|quickest|slowest|most|fewest|highest share|lowest share)$/.exec(m[1]);
    if (w) { const k = w[1] ? rank(w[1]) : null; return w[1] && !k ? null : RWORD[w[2]](k, a, b); }
    if (m[1] === 'last') return a + '最下位';
    const k = rank(m[1]);
    return k ? a + k + '位' : null;
  };
  /* every rank a sentence carries, said, or null when one cannot be (an empty slot stays empty) */
  const rks = (...rs) => { const o = rs.map(r => (r == null ? '' : rankJa(r))); return o.indexOf(null) >= 0 ? null : o; };

  /* the connectives that open a sentence (newsroom.js BOOK turn and caveat, and the contrasts its style can learn), each
     its own; one it learned that is not here, by its job: a turn (とはいえ), a caution (ただし) */
  const TURN = { 'still': 'それでも、', 'even so': 'それでも、', 'that said': 'とはいえ、', 'for all that': 'それでも、', 'then again': 'もっとも、',
    'however': 'しかし、', 'yet': 'だが、', 'nevertheless': 'それでも、', 'nonetheless': 'それでも、', 'on the other hand': '一方で、',
    'despite that': 'それでも、', 'all the same': 'それでも、', 'mind you': 'もっとも、', 'by contrast': '対照的に、' };
  const turnJa = c => TURN[String(c).replace(/[,:]$/, '').toLowerCase()] || 'とはいえ、';
  const CAVEAT = { 'that said': 'とはいえ、', 'a word of caution': 'ただし、', 'the caveat': '注意点もある。', 'one note of caution': '一つ注意しておきたい。' };
  const cavJa = c => CAVEAT[String(c).replace(/[,:]$/, '').toLowerCase()] || 'ただし、';
  /* a cold spell's predicate (BOOK cold, or one the style learned): what it says, or that he is struggling */
  const COLD = { 'has gone cold': '急失速し', 'has hit a rough patch': '苦しい時期を迎え', 'is struggling for form': '調子を落とし', 'has lost his touch': 'シュートタッチを失い' };
  const coldJa = c => COLD[String(c).toLowerCase().replace(/\bher\b/, 'his')] || '不振に陥り';

  /* a club's last result (resultText): "a 92–70 home win over X", "an 81–79 defeat at X" - a defeat says the side's own
     score first (76－78で敗れた) */
  const RESULT = '{S} (home win over|win at|home defeat to|defeat at) {X}';
  const resJa = (a, b, k, opp, verb) => { const won = /win/i.test(k);
    return (/^home/i.test(k) ? 'ホーム' : 'アウェー') + 'で' + opp + 'に' + (won ? sc(a, b) : sc(b, a)) + 'で' + (won ? verb[0] : verb[1]); };
  /* a club with its record and place, as the week's pick has them: "Northside (5–1, first)" */
  const sideJa = (x, p) => {
    if (!p) return x;
    const it = p.split(', ').map(q => { const m = /^(\d+)[–-](\d+)$/.exec(q); return m ? rec(m[1], m[2]) : rank(q) ? top(q) : null; });
    return it.indexOf(null) >= 0 ? null : x + '（' + it.join('、') + '）';
  };
  const listJa = s => String(s).split(/, | and /).join('、');
  /* the league by its name ("the Test League"), or, a league without one, "the league" */
  const lg = l => (/^league$/i.test(String(l)) ? 'リーグ' : l);
  /* what a club is built on (FACETS noun), a spot on the floor, a situation, a factor of a run, a factor of the on/off */
  const NOUN = { 'transition attack': 'ファストブレイク', 'half-court offence': 'ハーフコートオフェンス', 'half-court defence': 'ハーフコートディフェンス',
    'offensive rebounding': 'オフェンスリバウンド', 'rim protection': 'ゴール下の守り', 'ball pressure': 'ボールへのプレッシャー', 'ball security': 'ボールセキュリティ' };
  const noun = k => NOUN[String(k).toLowerCase()];
  const SPOT = { 'the point': 'ポイントガード', 'the wing': 'ウイング', 'the big spot': 'ビッグマン' };
  const SITJ = { 'transition': 'ファストブレイク', 'the half court': 'ハーフコート', 'second chances': 'セカンドチャンス', 'points off turnovers': 'ターンオーバー後', 'after timeouts': 'タイムアウト明け' };
  const FACTOR = { 'shooting': 'シュート', 'ball security': 'ボールセキュリティ', 'the offensive glass': 'オフェンスリバウンド', 'their defence': 'ディフェンス' };
  const FF = { 'effective shooting': 'EFG%', 'turnover rate': 'ターンオーバー率', 'offensive rebounding': 'オフェンスリバウンド率' };

  /* what a club does, as one clause (FACETS clause, and the next opponent's number that meets it): its subject a club,
     or "They" / "them" when the piece has named it already */
  const subj = s => (/^(?:they|them)$/i.test(s) ? '' : s + 'の');
  const CLAUSE = [
    ['{X} score {F} points a chance in transition', (s, v) => subj(s) + 'ファストブレイクでの得点は1チャンスあたり' + v + '点'],
    ['{X} score {F} (?:points )?a chance in the half court', (s, v) => subj(s) + 'ハーフコートでの得点は1チャンスあたり' + v + '点'],
    ['{X} allow {F} (?:points )?a chance in the half court', (s, v) => subj(s) + 'ハーフコートでの失点は1チャンスあたり' + v + '点'],
    ['{X} allow {F} a chance in transition', (s, v) => subj(s) + 'ファストブレイクでの失点は1チャンスあたり' + v + '点'],
    ['{X} rebound {F}% of their own misses', (s, v) => subj(s) + 'オフェンスリバウンド率は' + v + '%'],
    ['{X} give up {F}% of their opponents’ misses', (s, v) => (/^they$/i.test(s) ? '' : s + 'が') + '許す相手のオフェンスリバウンド率は' + v + '%'],
    ['opponents make {F}% of their shots at the rim against {X}', (v, s) => (/^them$/i.test(s) ? '' : s + 'に対する') + '相手のゴール下成功率は' + v + '%'],
    ['{X} take {F}% of their shots there', (s, v) => subj(s) + 'ゴール下シュートの割合は' + v + '%'],
    ['{X} force a turnover on {F}% of (?:their opponents’ )?possessions', (s, v) => subj(s) + '相手ターンオーバー率は' + v + '%'],
    ['{X} turn it over on {F}% of their possessions', (s, v) => subj(s) + 'ターンオーバー率は' + v + '%']
  ].map(([src, fn]) => [rx(src), fn]);
  const clJa = s => first(CLAUSE, s);
  /* what changed in a run (factorsOver say): its figure, then before it ("(51.8% before)"; pieces written before
     2026-10-08 keep "(51.8 before)") */
  const SAY = [
    ['shot {F}% effective \\({F}%? before\\)', (a, b) => 'EFG% ' + a + '%（以前は' + b + '%）'],
    ['turned it over on {F}% of possessions \\({F}%? before\\)', (a, b) => 'ターンオーバー率' + a + '%（以前は' + b + '%）'],
    ['rebounded {F}% of their own misses \\({F}%? before\\)', (a, b) => 'オフェンスリバウンド率' + a + '%（以前は' + b + '%）'],
    ['(?:held opponents to|let opponents shoot) {F}% effective(?: shooting)? \\({F}%? before\\)', (a, b) => '相手のEFG% ' + a + '%（以前は' + b + '%）']
  ].map(([src, fn]) => [rx(src), fn]);
  const sayJa = s => first(SAY, s);
  /* where a player's shots come from (shotProfile), and the situation that suits him, when one does */
  const TAIL = '(?:, and (?:he|she) is at (?:his|her) most dangerous in transition \\({F}% effective shooting, against {F}% in the half court\\)' +
    '|, and (?:he|she) is more efficient in the half court \\({F}% effective\\) than on the break \\({F}%\\))?';
  const tailJa = (t, h, h2, t2) => (t ? '。最も怖いのはファストブレイクで、EFG%は' + t + '%（ハーフコートでは' + h + '%）'
    : h2 ? '。ハーフコートの方が効率が良く、EFG%は' + h2 + '%（ファストブレイクでは' + t2 + '%）' : '');

  /* the newsroom's fixed words: the card and the page around the pieces, the reasons' titles, the sentences with no
     figure in them, the figures' labels */
  const NEWS_FIXED = {
    'From the newsdesk': 'ニュースデスクより',
    'Written by the newsdesk from the league’s own numbers: every figure here is from the games': 'リーグ自身の数字をもとにニュースデスクが書いた記事です。数字はすべて実際の試合のものです',
    'Game to watch this week': '今週の注目カード',
    'Where it will be decided': '勝負の分かれ目',
    'Players to watch': '注目選手',
    'The game’s preview': 'この試合の見どころ',
    'Read the week’s games to watch': '今週の注目カードの記事を読む',
    'Follow this game': 'この試合をフォロー',
    'Following this game': 'この試合をフォロー中',
    'won': '勝ち',
    'lost': '負け',
    'A clash of tempos': 'ペースのぶつかり合い',
    'The mismatch inside': 'インサイドのミスマッチ',
    'Strength on strength inside': 'インサイドの強み同士の激突',
    'Space to shoot': '3Pを打つスペース',
    'Something has to give from three': '3Pの矛と盾',
    'Open court': 'オープンコートの攻防',
    'The battle of the boards': 'リバウンドの攻防',
    'Look after the ball': 'ボールを大事に',
    'The heavyweights at the point': 'ポイントガードの大物対決',
    'The heavyweights at the wing': 'ウイングの大物対決',
    'The heavyweights at the big spot': 'ビッグマンの大物対決',
    'The point': 'ポイントガードの攻防',
    'The wing': 'ウイングの攻防',
    'The big spot': 'ビッグマンの攻防',
    'Form going in': '直近の勢い',
    'The rivalry': 'ライバル対決',
    'Something has to give': 'どちらかが折れるしかない',
    'Whoever sets the pace will be playing their own game': 'ペースを握った方が、自分たちのバスケットに持ち込める',
    'Two speeds meet here': '対照的なペースのチーム同士の対戦だ',
    'Every long rebound is an invitation': '長いリバウンドは一つ残らず速攻の合図になる',
    'It has the look of a night a hot hand from the arc decides': '3Pの当たりが勝負を決める夜になりそうだ',
    'Second chances could be the difference': 'セカンドチャンスが勝敗を分けるかもしれない',
    'Every loose pass will cost them': '不用意なパスは一つ残らず失点につながる',
    'The table and the numbers say one thing, the mood around the two clubs another': '順位表と数字が示すものと、両クラブを取り巻く空気は別物だ',
    'Their first meeting of the season': '今季初対戦',
    'Where this week’s biggest games will be won and lost, according to the numbers': '数字で見る、今週の大一番の勝負所',
    'What has changed, and what has not': '何が変わり、何が変わっていないのか',
    'The shots are not falling': 'シュートが決まっていない',
    'That points to a shooting slump rather than a change of role': '役割の変化ではなく、シュートの不振を示している',
    'Four games are four games': '4試合は4試合にすぎない',
    'The team numbers say the same thing': 'チームの数字も同じことを示している',
    'The team numbers are more even': 'チームの数字はもう少し拮抗している',
    'That is the mark of a deep side as much as of one player': 'それは一人の選手の力であると同時に、層の厚いチームの証でもある',
    'One number does not fit': '一つだけ当てはまらない数字がある',
    'Voters will ask about that': '投票者はそこを問うだろう',
    'Here is what the detail says': 'その中身を詳しく見ていく',
    'How they do it, who does it and what it is worth': 'その方法と担い手、そしてその価値を探る',
    'Where it goes wrong, and what it costs': 'どこでつまずき、何を失っているのか',
    'Every good side has something it can lean on': '良いチームには必ず拠り所がある',
    'last four': '直近4試合',
    'shooting, last four': 'FG（直近4試合）',
    'minutes, last four': '出場時間（直近4試合）',
    'team, last four': 'チーム成績（直近4試合）',
    'box plus-minus': 'BPM',
    'points, rebounds, assists': '得点 / リバウンド / アシスト',
    'on/off, per 100': 'オン・オフ（100ポゼッションあたり）',
    'per 36': '36分あたり',
    'per 40': '40分あたり',
    'together': '同時出場',
    'late-clock points a chance': 'ショットクロック終盤の1チャンスあたり得点',
    'late chances': 'ショットクロック終盤のチャンス数',
    'average possession': '平均ポゼッション時間',
    'wins in a row': '連勝',
    'defeats in a row': '連敗',
    'share of the club’s value': 'クラブ内の価値の割合',
    'league rank': 'リーグ順位',
    'league average': 'リーグ平均',
    'transition points a chance': 'ファストブレイクの1チャンスあたり得点',
    'half-court points a chance': 'ハーフコートの1チャンスあたり得点',
    'half-court points a chance allowed': 'ハーフコートの1チャンスあたり失点',
    'offensive rebound rate': 'オフェンスリバウンド率',
    'opponents’ shooting at the rim': '相手のゴール下成功率',
    'turnovers forced': '相手のターンオーバー率',
    'turnover rate': 'ターンオーバー率',
    'ball security': 'ボールセキュリティ',
    'their defence': 'ディフェンス',
    'possessions per 40': '40分あたりのポゼッション',
    'of their shots at the rim': 'ゴール下シュートの割合',
    'allowed at the rim': '相手のゴール下成功率',
    'of their shots from three': '3Pシュートの割合',
    'allowed from three': '相手の3P成功率',
    'of their chances in transition': 'ファストブレイクの割合',
    'allowed a chance on the break': 'ファストブレイクの1チャンスあたり失点',
    'of their misses rebounded': 'オフェンスリバウンド率',
    'offensive rebounds allowed': '相手のオフェンスリバウンド率'
  };

  const NEWS = [
    /* ---- a day as the list prints it, the card's form and on/off, the figures with a word in them ---- */
    ['{Z}', d => date(d)],
    ['form ([WL]+)', f => { const w = (f.match(/w/gi) || []).length; return '直近' + f.length + '試合で' + rec(w, f.length - w); }],
    ['{G} on', g => 'オン ' + g],
    ['{G} off', g => 'オフ ' + g],
    ['{X}, box plus-minus', p => p + 'のBPM'],
    ['{X}, in the table', x => x + 'の順位'],
    ['{G} \\({K}\\)', (g, k) => g + '（' + place(k) + '）'],
    ['{F}% \\(was {F}%\\)', (a, b) => a + '%（以前は' + b + '%）'],

    /* ---- the week's games to watch (fWatch), and the season's lean on a game (leanText) ---- */
    ['{X} v {X} heads the week’s games to watch', (a, b) => a + ' VS ' + b + 'が今週の注目カードの筆頭'],
    ['the week ahead: {X} v {X} and the games that matter', (a, b) => '今週の展望：' + a + ' VS ' + b + 'ほか注目の試合'],
    ['games to watch: {X} v {X} leads a big week', (a, b) => '注目の試合：' + a + ' VS ' + b + 'を筆頭に大一番が続く'],
    ['the {W} games worth your time this week, and where the numbers say each will be decided', w => '今週見逃せない' + n(w) + '試合と、数字が示すそれぞれの勝負所'],
    ['{Y} brings the pick of the week: {X}(?: \\(([^)]*)\\))? host {X}(?: \\(([^)]*)\\))?', (d, a, ap, b, bp) => {
      const A = sideJa(a, ap), B = sideJa(b, bp);
      return A && B ? date(d) + 'は今週一番の注目カード。' + A + 'が' + B + 'をホームに迎える' : null;
    }],
    ['on the season’s numbers it is close to a toss-up', () => '今季の数字ではほぼ互角'],
    ['the season’s numbers make {X} slightly better, by about {F} points', (x, f) => '今季の数字では' + x + 'がわずかに優位で、その差は約' + f + '点'],
    ['the season’s numbers make {X} about {F} points better', (x, f) => '今季の数字では' + x + 'が約' + f + '点上回る'],
    ['the season’s numbers make {X} clear favourites, by about {F} points', (x, f) => '今季の数字では' + x + 'がはっきりと優位で、その差は約' + f + '点'],
    ['keep an eye on {X} \\((.+)\\)', (p, l) => { const t = clause(l); return t && '注目は' + p + '（' + t + '）'; }],

    /* ---- why a game will go the way it goes (reasons): each clash with both sides' figures and their ranks ---- */
    ['{X} want this game played fast, {F} possessions per 40, {R}; {X} want it slow, at {F}, {R}', (a, f, r, b, g, q) => { const R = rks(r, q);
      return R && a + 'は速い展開に持ち込みたいチームで、40分あたり' + f + 'ポゼッションは' + R[0] + '。一方の' + b + 'は遅い展開を望み、' + g + 'ポゼッションは' + R[1]; }],
    ['{X} play at {F} possessions per 40 \\({R}\\), {X} at {F} \\({R}\\): the side that drags the game to its tempo has most of the work done', (a, f, r, b, g, q) => { const R = rks(r, q);
      return R && a + 'は40分あたり' + f + 'ポゼッション（' + R[0] + '）、' + b + 'は' + g + 'ポゼッション（' + R[1] + '）。自分たちのテンポに引き込んだ方が、仕事の大半を終えたも同然だ'; }],
    ['{X} live at the rim, {F}% of their shots, {R}, and {X} have been one of the league’s softest touches there: opponents make {F}% at the rim against them \\({R}\\)', (a, p, r, b, q, s) => { const R = rks(r, s);
      return R && a + 'はゴール下を主戦場とし、シュートの' + p + '%がゴール下（' + R[0] + '）。対する' + b + 'はリーグでも屈指のゴール下の弱さで、相手のゴール下成功率は' + q + '%（' + R[1] + '）'; }],
    ['if {X} get into the paint, it is their game', x => x + 'がペイントに入り込めば、試合の主導権を握る'],
    ['(nobody has|few sides have) been easier to score on inside than {X} \\({F}% allowed at the rim(?:, {R})?\\), and few go there as often as {X} \\({F}% of their shots\\)', (k, d, p, r, o, q) => { const R = rks(r);
      return R && d + 'ほどゴール下で簡単に得点を許しているチームは' + (/^nobody/i.test(k) ? 'なく' : '少なく') + '（相手のゴール下成功率' + p + '%' + (r ? '、' + R[0] : '') + '）、' + o + 'ほど頻繁にゴール下を攻めるチームも少ない（シュートの' + q + '%）'; }],
    ['that is the matchup {X} will hunt', x => x + 'が狙ってくるのはそこだ'],
    ['{X} go to the rim more than almost anybody \\({F}% of their shots, {R}\\), and {X} protect it better than almost anybody \\({F}% allowed, {R}\\)', (a, p, r, b, q, s) => { const R = rks(r, s);
      return R && a + 'はゴール下を攻める頻度でリーグ屈指（シュートの' + p + '%、' + R[0] + '）、' + b + 'はゴール下の守りでリーグ屈指だ（相手の成功率' + q + '%、' + R[1] + '）'; }],
    ['{X} take {F}% of their shots from three, {R}, and {X} have let opponents make {F}% from deep \\({R}\\)', (a, p, r, b, q, s) => { const R = rks(r, s);
      return R && a + 'はシュートの' + p + '%が3P（' + R[0] + '）で、' + b + 'は相手に3Pを' + q + '%決められている（' + R[1] + '）'; }],
    ['{X} shoot more threes than almost anybody \\({F}% of their shots\\), and {X} defend the arc as well as anybody: opponents make {F}% from three against them, {R}', (a, p, b, q, r) => { const R = rks(r);
      return R && a + 'は3Pの多さでリーグ屈指（シュートの' + p + '%）、' + b + 'は3P守備でリーグ屈指だ。相手の3P成功率は' + q + '%で、' + R[0]; }],
    ['{X} get {F}% of their chances on the break, {R}, and {X} have been one of the easiest sides in the league to run on: {F} points a chance allowed in transition \\({R}\\)', (a, p, r, b, f, s) => { const R = rks(r, s);
      return R && a + 'はチャンスの' + p + '%がファストブレイク（' + R[0] + '）で、' + b + 'はリーグでも走られやすいチームの一つだ。ファストブレイクでの失点は1チャンスあたり' + f + '点（' + R[1] + '）'; }],
    ['{X} want to run \\({F}% of their chances in transition, {R}\\), and {X} get back as well as anybody \\({F} points a chance allowed on the break, {R}\\)', (a, p, r, b, f, s) => { const R = rks(r, s);
      return R && a + 'は走りたいチーム（チャンスの' + p + '%がファストブレイク、' + R[0] + '）で、' + b + 'は戻りの速さでリーグ屈指だ（ファストブレイクでの失点は1チャンスあたり' + f + '点、' + R[1] + '）'; }],
    ['if {X} have to play in the half court, the game changes', x => x + 'がハーフコートでの攻撃を強いられれば、試合の様相は変わる'],
    /* (pieces written before 2026-10-08 say "give up 41.5% of theirs") */
    ['{X} rebound {F}% of their own misses, {R}, and {X} give up (?:offensive rebounds on {F}% of opponents’ misses|{F}% of theirs) \\({R}\\)', (a, p, r, b, q, q0, s) => { const R = rks(r, s);
      return R && a + 'は自分たちのミスの' + p + '%をオフェンスリバウンドで拾い（' + R[0] + '）、' + b + 'は相手のミスの' + (q || q0) + '%でオフェンスリバウンドを許している（' + R[1] + '）'; }],
    ['{X} turn it over on {F}% of their possessions \\({R}\\), and {X} force turnovers on {F}% \\({R}\\)', (a, p, r, b, q, s) => { const R = rks(r, s);
      return R && a + 'はポゼッションの' + p + '%でターンオーバーを犯し（' + R[0] + '）、' + b + 'は相手のポゼッションの' + q + '%でターンオーバーを誘発している（' + R[1] + '）'; }],
    ['the matchup of the night may be at (the point|the wing|the big spot): {X} \\({G} box plus-minus, {R}\\) against {X} \\({G}, {R}\\)', (s, a, g, r, b, h, q) => { const R = rks(r, q);
      return R && 'この夜最大の見どころは、' + SPOT[s.toLowerCase()] + '同士のマッチアップかもしれない。' + a + '（BPM ' + g + '、' + R[0] + '）対' + b + '（' + h + '、' + R[1] + '）'; }],
    ['at (the point|the wing|the big spot), {X} has been one of the league’s most valuable (point guards|wings|bigs): {G} box plus-minus(?: and {F} VORP)?, {R}', (s, p, grp, g, v, r) => { const R = rks(r);
      return R && SPOT[s.toLowerCase()] && p + 'はリーグで最も価値の高い' + GROUP[grp.toLowerCase()] + 'の一人だ。BPM ' + g + (v ? '、VORP ' + v : '') + 'で、' + R[0]; }],
    ['across from (?:him|her), {X}’s? {X} is at {G}', (t, p, g) => '対する' + t + 'の' + p + 'はBPM ' + g],
    ['it is the matchup {X} will want', t => t + 'が望むマッチアップだ'],
    ['{X} have won {W} in a row and {X} {W}: one of those runs ends here', (a, w, b, v) => a + 'は' + n(w) + '連勝中、' + b + 'も' + n(v) + '連勝中。どちらかの連勝がここで止まる'],
    ['{X} come in on {W} straight wins; {X} have lost {W} in a row', (a, w, b, v) => a + 'は' + n(w) + '連勝中、' + b + 'は' + n(v) + '連敗中でこの一戦を迎える'],
    ['can {X} slow them down', x => x + 'は相手の足を止められるか'],
    ['{X} and {X} are rivals, and nobody needs the table to tell them what this one means', (a, b) => a + 'と' + b + 'はライバル同士。この一戦の意味を順位表に教えてもらう必要はない'],
    ['{X} won the last meeting, {S}', (x, a, b) => '前回の対戦は' + x + 'が' + sc(a, b) + 'で勝利'],
    /* a club's player whose minutes swing it most (onOffLine) */
    ['with {X} on the floor, {X} have outscored opponents by {G} points per 100 possessions; without (?:him|her), {G}', (p, t, a, b) =>
      p + 'の出場時、' + t + 'は100ポゼッションあたり相手を' + (/^[−-]/.test(a) ? a.slice(1) + '点下回る' : a.replace(/^\+/, '') + '点上回る') + '。不在時は' + b],
    ['{X} are {F} points per 100 possessions better with {X} on the floor \\({G}\\) than without (?:him|her) \\({G}\\)', (t, f, p, a, b) =>
      t + 'は' + p + 'の出場時（' + a + '）の方が、不在時（' + b + '）より100ポゼッションあたり' + f + '点良い'],

    /* ---- a player gone cold (fSlump), and where a player's shots come from (shotProfile) ---- */
    ['what has happened to {X}', p => p + 'に何が起きているのか'],
    ['searching for {X}', p => '本来の' + p + 'はどこへ'],
    ['{X}’s? quiet spell, in numbers', p => '数字で見る' + p + 'の沈黙'],
    ['{X} {Q} — and {X} (?:have|has) noticed', (p, c, t) => p + 'が' + coldJa(c) + '、' + t + 'も異変に気づいている'],
    ['{F} points a game in (?:his|her) last four, down from {F}', (a, b) => '直近4試合は1試合平均' + a + '得点で、それまでの' + b + '得点から落ち込んでいる'],
    ['{X} had {D} points?(?: on {D}-of-{D} shooting)? in {X}’s? ' + RESULT + ' on {Y}', (p, pts, m, a, t, x, y, k, o, d) =>
      date(d) + '、' + t + 'が' + resJa(x, y, k, o, ['勝った', '敗れた']) + '試合で、' + p + 'は' + pts + '得点' + (a ? '（FG ' + m + '/' + a + '）' : '') + 'だった'],
    ['{X} had {D} points? last time out', (p, d) => p + 'は前の試合で' + d + '得点だった'],
    ['it was the fourth game in a row well short of (?:his|her) standard', () => '本来の水準を大きく下回る試合は、これで4試合連続だ'],
    ['through {W} games (?:he|she) had averaged {F} points(?:, {R})?; over the last four it is {F}', (w, a, r, b) => { const R = rks(r);
      return R && 'それまでの' + n(w) + '試合は1試合平均' + a + '得点' + (r ? '（' + R[0] + '）' : '') + 'だったが、直近4試合は' + b + '得点だ'; }],
    ['(?:he|she) is {D}-of-{D} from the field across the four \\({F}%\\)(?:, against {F}% before)?(?:; from three, {D} of {D}(?: after {F}% earlier in the season)?)?',
      (m, a, p, bp, m3, a3, bp3) => 'この4試合のFGは' + a + '本中' + m + '本（' + p + '%）' + (bp ? '、それ以前は' + bp + '%だった' : '') +
        (a3 ? '。3Pは' + a3 + '本中' + m3 + '本' + (bp3 ? 'で、シーズン序盤は' + bp3 + '%だった' : '') : '')],
    ['it is not a question of opportunity: (?:he|she) has played {F} minutes a game over the four, against {F} before(?:, and (?:his|her) shot attempts are steady at {F} a game)?',
      (a, b, s) => '出場機会の問題ではない。この4試合の出場時間は1試合平均' + a + '分で、それ以前は' + b + '分' + (s ? '、シュート試投数も1試合' + s + '本と変わっていない' : 'だった')],
    ['the minutes have moved too: {F} a game over the four, against {F} before', (a, b) => '出場時間も変わっている。この4試合は1試合平均' + a + '分で、それ以前は' + b + '分だった'],
    ['{X} have still been better with (?:him|her) this season: {G} points per 100 possessions when (?:he|she) plays, {G} when (?:he|she) sits',
      (t, a, b) => 'それでも今季の' + t + 'は、この選手がいる時の方が良い。出場時は100ポゼッションあたり' + a + '、ベンチにいる時は' + b],
    ['the season’s on/off numbers were already against (?:him|her): {X} are {G} per 100 possessions with (?:him|her) and {G} without',
      (t, a, b) => '今季のオン・オフの数字は、もともとこの選手に不利だった。' + t + 'は出場時が100ポゼッションあたり' + a + '、不在時が' + b],
    ['{X} have gone {S} in those four games', (t, a, b) => t + 'はこの4試合を' + rec(a, b) + 'で終えている'],
    ['{X}’s? true shooting for the season is {F}%(?:, {R})?, and that is the standard (?:he|she) will be measured against', (s, p, r) => { const R = rks(r);
      return R && s + 'の今季のTS%は' + p + '%' + (r ? '（' + R[0] + '）' : '') + '。評価の物差しになるのはこの数字だ'; }],
    ['(most|much) of (?:his|her) work is at the rim: {F}% of (?:his|her) shots come there, {R}' + TAIL, (k, p, r, t, h, h2, t2) => { const R = rks(r);
      return R && (/^most/i.test(k) ? 'プレーの大半' : 'プレーの多く') + 'はゴール下で、シュートの' + p + '%がゴール下（' + R[0] + '）' + tailJa(t, h, h2, t2); }],
    ['(?:he|she) lives behind the arc: {F}% of (?:his|her) shots are threes' + TAIL, (p, t, h, h2, t2) => '主戦場は3Pラインの外で、シュートの' + p + '%が3P' + tailJa(t, h, h2, t2)],
    ['over the season (?:his|her) shots split {F}% at the rim, {F}% from mid-range and {F}% from three' + TAIL, (a, b, c, t, h, h2, t2) =>
      '今季のシュート分布はゴール下が' + a + '%、ミドルレンジが' + b + '%、3Pが' + c + '%' + tailJa(t, h, h2, t2)],

    /* ---- the MVP case (fMvp) ---- */
    ['is {X} the best player in the {X}', (p, l) => p + 'は' + lg(l) + '最高の選手か'],
    ['the case for {X}', p => p + 'がMVPにふさわしい理由'],
    ['{X} and the MVP question', p => p + 'とMVP争い'],
    ['nobody in the {X} is doing more than {X}', (l, p) => lg(l) + 'で' + p + '以上の働きをしている選手はいない'],
    ['{G} box plus-minus, {X} {K} in the table(?:, and an? {F}-point on/off swing)?: the numbers behind the case', (g, t, k, s) =>
      'BPM ' + g + '、' + t + 'は' + top(k) + (s ? '、オン・オフの差は' + s + '点' : '') + '。MVP候補としての根拠を数字で見る'],
    ['in {D} games this season, nobody in the {X} has been more productive by box plus-minus than {X}', (g, l, p) => '今季の' + g + '試合で、BPMにおいて' + p + 'を上回る選手は' + lg(l) + 'にいない'],
    ['nobody in the {X} has been more productive this season, by box plus-minus, than {X}', (l, p) => '今季、BPMで' + p + 'を上回る選手は' + lg(l) + 'にいない'],
    ['(?:his|her) {G} leads the league, {F} clear of {X}', (g, f, p) => 'BPM ' + g + 'はリーグトップで、2番手の' + p + 'に' + f + 'の差をつけている'],
    ['(?:he|she) is averaging {F} points, {F} rebounds and {F} assists in {F} minutes, on {F}% true shooting(?:, while using {F}% of {X}’s? possessions when (?:he|she) is on the floor)?',
      (p, r, a, m, ts, u, t) => '1試合平均' + m + '分の出場で' + p + '得点' + r + 'リバウンド' + a + 'アシスト、TS%は' + ts + '%' + (u ? '。出場中は' + t + 'のポゼッションの' + u + '%を担っている' : '')],
    /* off the floor, "by N" after a side that outscored them with him, "they outscore opponents by N" after one outscored */
    ['with (?:him|her) on the floor {X} have (outscored opponents|been outscored) by {F} points per 100 possessions; without (?:him|her), (?:(?:by|they outscore opponents by) {F}|they are outscored by {F})',
      (t, k, a, b, c) => '出場時の' + t + 'は100ポゼッションあたり相手を' + a + '点' + (/been/i.test(k) ? '下回り' : '上回り') + '、不在時は' + (b != null ? b + '点上回る' : c + '点下回る')],
    ['that swing is {R}', r => { const R = rks(r); return R && 'その差は' + R[0]; }],
    ['most of it shows in {X}’s? (effective shooting|turnover rate|offensive rebounding): {F}% with (?:him|her), {F}% without', (t, k, a, b) =>
      'その差の多くは' + t + 'の' + FF[k.toLowerCase()] + 'に表れている。出場時は' + a + '%、不在時は' + b + '%'],
    ['in the half court, where most of a game is played, (?:he|she) has scored {F} points a game on {F}% effective shooting', (a, b) => '試合の大半を占めるハーフコートでは、1試合平均' + a + '得点、EFG%は' + b + '%'],
    ['at the other end, opponents have made {F}% at the rim with (?:him|her) on the floor and {F}% without', (a, b) => '守備では、出場時の相手のゴール下成功率が' + a + '%、不在時は' + b + '%'],
    ['{T} {X} has a case of (?:his|her) own: {G} box plus-minus for {X}(?:, {K} in the table)?', (c, p, g, t, k) => turnJa(c) + p + 'にも十分な根拠がある。' + t + 'でBPM ' + g + (k ? '、チームは' + top(k) : '')],
    ['next for {X} and {X}: (.+)', (s, t, r) => { const x = nx(r); return x && s + 'と' + t + 'の次戦は' + vs(x); }],

    /* ---- a young talent (fProspect) ---- */
    ['is {X} the real thing', p => p + 'は本物か'],
    ['{D} and already among the {X}’s? best: {X}', (a, l, p) => a + '歳にして' + lg(l) + '屈指の存在、' + p],
    ['how good is {X}', p => p + 'はどれほどの選手なのか'],
    ['at {D}, {X} is (?:(the league’s best player)|{K} in the league) by box plus-minus', (a, p, best, k) => a + '歳の' + p + 'は、BPMで' + (best ? 'リーグ最高の選手' : 'リーグ' + place(k)) + 'だ'],
    ['{X} is (\\d{2})', (p, a) => p + 'は' + a + '歳'],
    ['of the {D} players who have played 14 or more minutes a game in the {X} this season, (?:(none) has a better box plus-minus|only (one) has a better box plus-minus(, and that player is older)?|only {W} have a better box plus-minus(, and every one of them is older)?)',
      (d, l, none, single, o1, w, o2) => '今季' + lg(l) + 'で1試合平均14分以上出場している' + d + '人のうち、' + (none ? 'BPMで上回る選手は一人もいない'
        : single ? 'BPMで上回るのは1人だけ' + (o1 ? 'で、その選手は年上だ' : 'だ') : 'BPMで上回るのは' + n(w) + '人だけ' + (o2 ? 'で、全員が年上だ' : 'だ'))],
    ['per 36 minutes (?:he|she) is producing {F} points, {F} rebounds and {F} assists, on {F}% true shooting(?: \\(the regulars’ average is {F}%\\))?',
      (p, r, a, ts, avg) => '36分あたりに換算すると' + p + '得点' + r + 'リバウンド' + a + 'アシスト、TS%は' + ts + '%' + (avg ? '（主力選手の平均は' + avg + '%）' : '')],
    ['(?:he|she) is using {F}% of {X}’s? possessions while on the floor(, a lead role at any age|, and doing it without needing the ball)?', (u, t, k) =>
      !k ? '出場中は' + t + 'のポゼッションの' + u + '%を使っている' : /lead/i.test(k) ? '出場中は' + t + 'のポゼッションの' + u + '%を担っている。年齢を問わず主役級の役割だ'
        : '出場中に使う' + t + 'のポゼッションは' + u + '%だけで、ボールを多く持たずに結果を出している'],
    ['{X} are {F} points per 100 possessions better with (?:him|her) on the floor', (t, f) => t + 'はこの選手の出場時、100ポゼッションあたり' + f + '点良くなる'],
    ['the one number against (?:him|her): {X} have been {F} points per 100 possessions better without (?:him|her)', (t, f) => '唯一の不安材料は、' + t + 'がこの選手の不在時の方が100ポゼッションあたり' + f + '点良いことだ'],
    ['{C} the sample is {W} games and {D} minutes — enough to notice, not yet enough to be sure', (c, w, d) => cavJa(c) + 'サンプルは' + n(w) + '試合、' + d + '分にすぎない。注目には値するが、確信するにはまだ足りない'],

    /* ---- what a club is built on (identityPiece): the headlines by facet and by which way it cuts ---- */
    ['how {X} became the {X}’s? most dangerous team on the break', (t, l) => t + 'はいかにして' + lg(l) + 'で最も危険な速攻のチームになったのか'],
    ['{X} are at their best in transition', t => t + 'が最も輝くのはファストブレイク'],
    ['run with {X} at your peril', t => t + 'と走り合うのは危険だ'],
    ['{X} cannot get anything going on the break', t => t + '、ファストブレイクで活路を見いだせず'],
    ['inside {X}’s? half-court offence', t => t + 'のハーフコートオフェンスを解剖'],
    ['{X} have the {X}’s? best half-court offence', (t, l) => t + 'は' + lg(l) + '最高のハーフコートオフェンスを持つ'],
    ['{X}’s? half-court problem', t => t + 'のハーフコートの課題'],
    ['where {X}’s? offence gets stuck', t => t + 'のオフェンスはどこで停滞しているのか'],
    ['why nobody can score against {X} in the half court', t => 'なぜハーフコートで' + t + 'から得点できないのか'],
    ['the half-court wall: inside {X}’s? defence', t => 'ハーフコートの壁：' + t + 'のディフェンスを解剖'],
    ['where {X} are leaking points', t => t + 'はどこで失点しているのか'],
    ['{X} cannot get stops in the half court', t => t + '、ハーフコートで守り切れず'],
    ['{X} and the art of the second chance', t => t + 'とセカンドチャンスの技術'],
    ['why {X} keep getting a second shot', t => 'なぜ' + t + 'は何度もセカンドチャンスを得るのか'],
    ['{X} are not getting second chances', t => t + '、セカンドチャンスを得られず'],
    ['why nobody gets to the rim against {X}', t => 'なぜ' + t + '相手には誰もゴール下までたどり着けないのか'],
    ['why the rim is closed against {X}', t => 'なぜ' + t + '相手にはゴール下が閉ざされるのか'],
    ['{X} have made the paint a no-go area', t => t + 'はペイントを侵入不能の領域にした'],
    ['{X} cannot protect the rim', t => t + '、ゴール下を守れず'],
    ['the open door: {X} and the rim', t => '開いたままの扉：' + t + 'とゴール下'],
    ['{X}’s? defence lives on turnovers', t => t + 'のディフェンスはターンオーバーで生きる'],
    ['ball-hawks: how {X} force the turnovers', t => 'ボールハンター：' + t + 'はいかにしてターンオーバーを奪うのか'],
    ['{X} are not forcing turnovers', t => t + '、ターンオーバーを奪えず'],
    ['{X} do not give the ball away', t => t + 'はボールを失わない'],
    ['safe hands: inside {X}’s? ball security', t => '確かな手：' + t + 'のボールセキュリティを解剖'],
    ['{X}’s? turnover trouble', t => t + 'のターンオーバー問題'],
    ['the numbers behind {X}’s? turnover problem', t => '数字で見る' + t + 'のターンオーバー問題'],
    /* ...the standfirst, the hook, the number and what it is worth, who carries it, the other side of them */
    ['(.+?), {R}, against a league average of {F}(%?)', (c, r, avg, pct) => { const t = clJa(c), R = rks(r); return t && R ? t + 'で、' + R[0] + '。リーグ平均は' + avg + (pct ? '%' : '点') : null; }],
    ['(.+?), {R}', (c, r) => { const t = clJa(c), R = rks(r); return t && R ? t + 'で、' + R[0] : null; }],
    ['the numbers behind {X}’s? {N}, {R}', (t, k, r) => { const R = rks(r); return R && '数字で見る' + t + 'の' + noun(k) + '（' + R[0] + '）'; }],
    ['inside {X}’s? {N}, {R}, and what it costs them', (t, k, r) => { const R = rks(r); return R && t + 'の' + noun(k) + '（' + R[0] + '）を解剖、その代償とは'; }],
    ['{X} are {S}(?:, {K} in the table)?, and one number (explains a good deal of it|goes a long way to explaining it)', (t, a, b, k, how) =>
      t + 'は' + rec(a, b) + (k ? 'で' + top(k) : '') + '。' + (/explains/i.test(how) ? 'その成績の多くを一つの数字が説明している' : 'その理由の多くを一つの数字が物語っている')],
    ['there is one thing {X} \\({S}(?:, {K} in the table)?\\) do (better than anybody|as well as almost anybody) in the {X}', (t, a, b, k, how, l) =>
      t + '（' + rec(a, b) + (k ? '、' + top(k) : '') + '）には、' + lg(l) + 'で' + (/better/i.test(how) ? '誰よりも' : 'ほぼ誰にも負けないほど') + 'うまくできることが一つある'],
    ['ask what {X} are built on and the numbers give a clear answer: their {N}', (t, k) => t + 'の土台は何か。数字の答えは明快で、それは' + noun(k) + 'だ'],
    ['for {X} \\({S}(?:, {K} in the table)?\\) it is their {N}', (t, a, b, k, x) => t + '（' + rec(a, b) + (k ? '、' + top(k) : '') + '）にとって、それは' + noun(x) + 'だ'],
    ['look past the {S} record and one part of {X}’s? game stands out from the rest of the {X}', (a, b, t, l) => rec(a, b) + 'という成績の裏で、' + t + 'のプレーには' + lg(l) + 'の中で際立つ部分がある'],
    ['for {X} \\({S}(?:, {K} in the table)?\\), one number keeps coming back', (t, a, b, k) => t + '（' + rec(a, b) + (k ? '、' + top(k) : '') + '）については、繰り返し浮かび上がる数字がある'],
    ['if {X} \\({S}(?:, {K} in the table)?\\) want to know where their season is going wrong, their {N} is the place to start', (t, a, b, k, x) =>
      t + '（' + rec(a, b) + (k ? '、' + top(k) : '') + '）が今季のつまずきの原因を探るなら、まず見るべきは' + noun(x) + 'だ'],
    ['(against them, )?{F}% of the shots (?:opponents|they) take in (transition|the half court|second chances|points off turnovers|after timeouts) come at the rim(?:, where {F}% go in)?(?:; {F}% are threes(?:, made at {F}%)?)?',
      (ag, p, s, rp, p3, p3p) => SITJ[s.toLowerCase()] + 'で' + (ag ? '相手が' : '') + '放つシュートの' + p + '%がゴール下' + (rp ? 'で、成功率は' + rp + '%' : '') +
        (p3 ? '。3Pは' + p3 + '%' + (p3p ? 'で、成功率は' + p3p + '%' : '') : '')],
    ['(what they do with them is another matter|and they make them count): {F} points a game off turnovers, at {F} a chance(?:, {R})?', (k, a, b, r) => { const R = rks(r);
      return R && (/another/i.test(k) ? '奪った後の攻撃は別問題だ。' : 'そしてそれを得点に結びつけている。') + 'ターンオーバーからの得点は1試合平均' + a + '点、1チャンスあたり' + b + '点' + (r ? '（' + R[0] + '）' : ''); }],
    ['most of the damage is (in the half court|on the break), where {F}% of their chances end in a turnover against {F}% (?:on the break|in the half court)', (k, a, b) =>
      '傷が深いのは' + (/half/i.test(k) ? 'ハーフコート' : 'ファストブレイク') + 'で、チャンスの' + a + '%がターンオーバーで終わっている（' + (/half/i.test(k) ? 'ファストブレイク' : 'ハーフコート') + 'では' + b + '%）'],
    ['opponents score {F} points a game off them', a => '相手はそこから1試合平均' + a + '点を挙げている'],
    ['opponents have mostly stopped trying: only {F}% of their shots against them come at the rim, (?:the lowest share in the league|{K}-lowest in the league)', (p, k) =>
      '相手はゴール下を攻めることをほぼ諦めている。ゴール下のシュートはわずか' + p + '%で、' + (k ? 'リーグで' + rank(k) + '番目に低い割合' : 'リーグで最も低い割合')],
    ['opponents keep coming, {F}% of their shots at the rim, one of the highest shares in the league; they just do not finish', p => '相手はそれでも攻めてくる。シュートの' + p + '%がゴール下と、リーグでも高い割合だが、決め切れていない'],
    ['opponents still take {F}% of their shots at the rim against them, about the league’s norm \\({F}%\\); they just make fewer', (p, a) => '相手はリーグ平均（' + a + '%）並みの' + p + '%のシュートをゴール下で放っているが、決める数は少ない'],
    ['against the league’s average return, that is worth about {F} points a game (to them|against them)', (f, k) => 'リーグ平均と比べると、1試合あたり約' + f + '点の' + (/against/i.test(k) ? 'マイナス' : 'プラス') + 'になっている'],
    ['in this league, one standard step on {L} has been worth about {F} points a game(, by the league’s own model of what wins)?', (l, f, m) =>
      'このリーグでは、' + facet(l) + 'で標準偏差1つ分上回ると1試合あたり約' + f + '点の価値がある' + (m ? '（リーグ独自の勝因モデルによる）' : '')],
    ['{X} \\({F} a game\\) and {X} \\({F}\\) score the most of it', (a, x, b, y) => a + '（1試合平均' + x + '点）と' + b + '（' + y + '点）が、その得点の多くを挙げている'],
    ['{X} \\({F} (offensive rebounds|steals|turnovers|blocks) a game\\) and {X} \\({F}\\) (lead the charge on the glass|do the most to take it away|give it away the most|do most of the shot-blocking)', (a, x, k, b, y, what) =>
      a + '（1試合平均' + x + ({ 'offensive rebounds': 'オフェンスリバウンド', 'steals': 'スティール', 'turnovers': 'ターンオーバー', 'blocks': 'ブロック' })[k.toLowerCase()] + '）と' + b + '（' + y + '）' +
        ({ 'lead the charge on the glass': 'がリバウンドの先頭に立っている', 'do the most to take it away': 'がボール奪取の中心だ', 'give it away the most': 'が最もボールを失っている',
           'do most of the shot-blocking': 'がブロックの大半を担っている' })[what.toLowerCase()]],
    ['the anchor is {X}: opponents make {F}% at the rim with (?:him|her) on the floor and {F}% without', (p, a, b) => '守備の要は' + p + '。出場時の相手のゴール下成功率は' + a + '%、不在時は' + b + '%'],
    ['{T} there is another side to them: (.+?), {R}', (c, x, r) => { const t = clJa(x), R = rks(r); return t && R ? turnJa(c) + '別の顔もある。' + t + 'で、' + R[0] : null; }],
    ['it is not all bad: (.+?), {R}', (x, r) => { const t = clJa(x), R = rks(r); return t && R ? '悪いことばかりではない。' + t + 'で、' + R[0] : null; }],

    /* ---- a run and a slide, from the inside (fRun) ---- */
    ['inside {X}’s? {W}-game winning run', (t, w) => t + 'の' + n(w) + '連勝を解剖'],
    ['how {X} won {W} in a row', (t, w) => t + 'はいかにして' + n(w) + '連勝したのか'],
    ['what is behind {X}’s? run', t => t + 'の連勝の裏にあるもの'],
    ['what has gone wrong at {X}', t => t + 'はどこで歯車が狂ったのか'],
    ['{X}’s? slide, in numbers', t => '数字で見る' + t + 'の失速'],
    ['{W} straight defeats: inside {X}’s? slump', (w, t) => n(w) + '連敗：' + t + 'の不振を解剖'],
    ['{W} straight (wins|defeats), by an average of {F} points', (w, k, f) => n(w) + (/^wins/i.test(k) ? '連勝' : '連敗') + '、平均' + f + '点差'],
    ['the numbers say it comes down to (shooting|ball security|the offensive glass|their defence)', k => '数字が示す鍵は' + FACTOR[k.toLowerCase()]],
    ['{X} have (won|lost) {W} in a row, the latest an? ' + RESULT + ' on {Y}', (t, wl, w, a, b, k, o, d) =>
      t + 'が' + n(w) + (/^won/i.test(wl) ? '連勝' : '連敗') + '。直近は' + date(d) + '、' + resJa(a, b, k, o, ['勝利した', '敗れた'])],
    ['(in the run|in the slide) they have (.+?)(?:, and (.+))?', (k, x, y) => { const s = [x, y].filter(Boolean).map(sayJa);
      return s.indexOf(null) >= 0 ? null : (/run/i.test(k) ? '連勝中' : '連敗中') + 'の数字は、' + s.join('、'); }],
    ['they are scoring {F} and allowing {F} a game in it, against {F} and {F} before', (a, b, c, d) => 'この間の1試合平均は' + a + '得点・' + b + '失点で、それ以前は' + c + '得点・' + d + '失点だった'],
    ['{X} has averaged {F} points in the run, (up|down) from {F} before', (p, a, k, b) => p + 'はこの間1試合平均' + a + '得点で、それ以前の' + b + '得点から' + (/up/i.test(k) ? '伸ばしている' : '落としている')],
    ['the five on the floor most in the replayed games, {J}, have (?:outscored opponents by {D}|been outscored by {D}) in {D} minutes together', (l, a, b, m) =>
      '詳しく分析した試合で最も長くコートに立った5人（' + listJa(l) + '）は、' + m + '分間で' + (a ? a + '点上回っている' : b + '点下回っている')],
    ['{T} {W} of the {W} were decided by five points or fewer', (c, a, b) => turnJa(c) + n(b) + '試合のうち' + n(a) + '試合は5点差以内の接戦だった'],
    ['the run is on the line (.+)', r => { const t = nx(r); return t && '連勝が次に懸かるのは' + tie(t); }],
    ['the next chance to stop it: (.+)', r => { const t = nx(r); return t && '連敗を止める次のチャンスは' + tie(t); }],

    /* ---- the best five (fFive) ---- */
    ['the five who are winning games for {X}', t => t + 'に勝利をもたらしている5人'],
    ['{X}’s? best five, by the numbers', t => '数字で見る' + t + 'のベスト5'],
    ['inside the {X}’s? most effective lineup', l => lg(l) + 'で最も効果的なラインナップを解剖'],
    ['{J}: \\+{D} in {D} minutes together over the last fortnight', (l, pm, m) => listJa(l) + '：直近2週間、' + m + '分間の同時出場で+' + pm],
    ['over the last fortnight, in {W} replayed games, {J} have shared the floor for {D} minutes for {X} and outscored opponents by {D}, {D} points to {D}', (w, l, m, t, pm, pf, pa) =>
      '直近2週間に詳しく分析した' + n(w) + '試合で、' + listJa(l) + 'は' + t + 'で' + m + '分間同時にコートに立ち、' + sc(pf, pa) + 'と' + pm + '点上回った'],
    ['that is {G} points per 40 minutes(?:, against {G} per 40 for the club as a whole in the same games)?', (a, b) => '40分あたりに換算すると' + a + '点' + (b ? '。同じ試合でのチーム全体は40分あたり' + b + '点' : '')],
    ['they have played {D}% of the club’s minutes in those games together( — an argument for more)?', (d, more) =>
      'この5人が同時にコートに立ったのは、それらの試合でのチームの出場時間の' + d + '%' + (more ? '。もっと起用すべきだという根拠になる' : '')],
    ['{C} {D} minutes is a small sample, and a lineup’s numbers move quickly', (c, d) => cavJa(c) + d + '分はサンプルとして小さく、ラインナップの数字はすぐに動く'],

    /* ---- the shot clock (fClock) ---- */
    ['{X} are the {X}’s? late-clock specialists', (t, l) => t + 'は' + lg(l) + '屈指のショットクロック終盤のスペシャリスト'],
    ['beat the clock: how {X} score when time runs short', t => '時間との勝負：' + t + 'はショットクロック終盤にどう得点するのか'],
    ['{F} points a chance when the shot clock is past 16 seconds, the best in the league over the last fortnight', f => 'ショットクロックが16秒を過ぎてからの得点は1チャンスあたり' + f + '点で、直近2週間のリーグトップ'],
    ['when the shot clock runs down, the {X} scores {F} points a chance', (l, f) => 'ショットクロック終盤の得点は、' + lg(l) + '全体で1チャンスあたり' + f + '点'],
    ['{X} score {F}: over the last fortnight’s replayed games they have taken {D} first chances past 16 seconds of the clock, and nobody has done more with them', (t, f, d) =>
      t + 'は' + f + '点。直近2週間に詳しく分析した試合で、ショットクロック16秒以降のファーストチャンスを' + d + '回迎え、誰よりもそれを得点に結びつけている'],
    ['earlier in the clock they score {F} a chance, so a long possession costs them (?:(nothing at all)|{F} a chance, against {F} for the league as a whole)', (e, z, c, lg) =>
      'ショットクロック序盤の得点は1チャンスあたり' + e + '点。' + (z ? '長いポゼッションになっても何も失っていない' : '長いポゼッションで1チャンスあたり' + c + '点を失っており、リーグ全体では' + lg + '点だ')],
    ['their possessions last {F} seconds on average, (?:among the (longest|shortest) in the league|{K} in the league by length)', (f, ls, k) =>
      'ポゼッションの平均時間は' + f + '秒で、' + (k ? 'リーグで' + rank(k) + '番目の長さ' : /longest/i.test(ls) ? 'リーグでも最も長い部類' : 'リーグでも最も短い部類')],
    ['{C} it is {D} possessions, not a season — a few late threes either way would move it', (c, d) => cavJa(c) + 'これは' + d + 'ポゼッションの話で、シーズン全体ではない。終盤の3Pが数本違えば数字は動く'],

    /* ---- a star missing (fAbsence) ---- */
    ['{X} without {X}: what the numbers say they are missing', (t, p) => p + '不在の' + t + '：数字が示す欠けているもの'],
    ['how much is {X} worth to {X}', (p, t) => p + 'は' + t + 'にとってどれほどの価値があるのか'],
    ['the {X}-shaped hole in {X}’s? side', (s, t) => t + 'に空いた' + s + 'の穴'],
    ['{X} are learning to live without {X}', (t, p) => t + 'は' + p + 'のいない戦いに慣れつつある'],
    ['{X} has missed {X}’s? last {W} games, suspended', (p, t, w) => p + 'は出場停止で' + t + 'の直近' + n(w) + '試合を欠場'],
    ['by box plus-minus and minutes, (?:he|she) carries {D}% of what the club’s players are worth', d => 'BPMと出場時間で見ると、この選手はクラブの選手全体の価値の' + d + '%を担っている'],
    ['{X} have played {W} games without {X}(, who is serving a suspension)?, and gone {S} in them', (t, w, p, s, a, b) =>
      t + 'は' + p + (s ? '（出場停止中）' : '') + 'を欠いて' + n(w) + '試合を戦い、' + rec(a, b)],
    ['put how good a player has been together with how much of the game (?:he|she) plays, and {X} accounts for {D}% of {X}’s? value this season, (?:the (most) of anybody on the club|the (second)-most on the club|{K} on the club)',
      (p, d, t, most, second, k) => '選手としての質と出場時間を掛け合わせると、' + p + 'は今季の' + t + 'の価値の' + d + '%を占める。' +
        'クラブで' + (most ? '最も' : (second ? 2 : rank(k)) + '番目に') + '大きい割合だ'],
    ['(?:his|her) box plus-minus is {G} in {F} minutes a game(?:, {R})?', (g, m, r) => { const R = rks(r); return R && 'BPMは1試合平均' + m + '分の出場で' + g + (r ? '（' + R[0] + '）' : ''); }],
    ['the team numbers (say the same|soften it): {X} have been {G} per 100 possessions with (?:him|her) on the floor and {G} without(, a side used to coping)?', (k, t, a, b, used) =>
      (/same/i.test(k) ? 'チームの数字も同じだ。' : 'チームの数字はその印象を和らげる。') + t + 'はこの選手の出場時が100ポゼッションあたり' + a + '、不在時が' + b + (used ? 'で、不在への対応に慣れたチームだ' : '')],
    ['in the games without (?:him|her), {X} have scored {F} and allowed {F} a game, against {F} and {F} with (?:him|her)', (t, a, b, c, d) =>
      'この選手を欠いた試合で、' + t + 'は1試合平均' + a + '得点・' + b + '失点。出場した試合では' + c + '得点・' + d + '失点だった'],
    ['{X} has taken on the most of the minutes: {F} a game without {X}, up from {F}', (p, a, s, b) => '最も出場時間を増やしたのは' + p + '。' + s + '不在の試合では1試合平均' + a + '分で、以前の' + b + '分から増えている']
  ];

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Japanese | null], most specific first: the storylines' fixed sentences, the newsroom's
     (fixed, then each template), then the storylines' templates */
  const RULES = Object.keys(FIXED).map(k => [lit(k), () => FIXED[k]]).concat(Object.keys(NEWS_FIXED).map(k => [lit(k), () => NEWS_FIXED[k]]), NEWS, [
    /* ---- the race at the top (and the regular season over) ---- */
    ['{X} finish top(?: in {X})? at {S}', (x, g, a, b) => x + 'が' + rec(a, b) + 'で' + (g ? grp(g) + 'の' : 'レギュラーシーズン') + '首位'],
    ['{X} cannot be caught(?: in {X})?', (x, g) => x + 'の' + (g ? grp(g) : '') + '首位が確定'],
    ['nobody has broken away yet(?: in {X})?', g => (g ? grp(g) + 'では' : '') + 'まだ抜け出したクラブはない'],
    ['a crowded top(?: in {X})?: {D} clubs within (a game|a game and a half) of first', (g, d, w) => ing(g) + '首位争いは大混戦、' + d + 'クラブが首位から' + gw(w) + '差以内'],
    ['{W} clubs within (a game|a game and a half) of the top(?: in {X})?', (w, h, g) => n(w) + 'クラブが' + ing(g) + '首位から' + gw(h) + '差以内にひしめく'],
    ['{X} and {X} level at the top(?: in {X})?', (x, y, g) => x + 'と' + y + 'が' + ing(g) + '首位に並ぶ'],
    ['{X} (pull clear|lead)(?: in {X})?, {A} ahead', (x, k, g, a) => x + 'が' + ing(g) + (/pull/i.test(k) ? '首位を独走' : '首位') + '、2位に' + gw(a) + '差'],
    ['{X} are {S}, {A} clear of {X}', (x, a, b, g, y) => x + 'は' + rec(a, b) + 'で、' + y + 'に' + gw(g) + '差をつけている'],
    ['{X} are {S}, level with {X} on the record', (x, a, b, y) => x + 'は' + rec(a, b) + 'で、' + y + 'と勝敗で並んでいる'],
    ['{A} clear of {X}', (g, y) => y + 'に' + gw(g) + '差をつけた'],
    ['level with {X} on the record; the table puts them first', y => '勝敗では' + y + 'と並んだが、順位では上回った'],
    ['nobody else can reach their {W} wins now, with {W} games? left', (w, l) => '残り' + n(l) + '試合となり、もう' + n(w) + '勝に届くクラブはない'],
    ['with {W} games? left, only {X} can still catch them', (l, x) => '残り' + n(l) + '試合で、まだ追いつく可能性があるのは' + x + 'だけだ'],
    ['with {W} games? left, {W} clubs can still catch them', (l, c) => '残り' + n(l) + '試合で、まだ' + n(c) + 'クラブに追いつく可能性がある'],
    /* early in the season: "Seven games into a 40-game season" or "It is early: four games in", then the margins */
    ['(?:{W} games? into an? {D}-game season|it is early: {W} games? in), the table is a first draft(?:; by the margins, {X} (are the best side as well|have been the best side so far), at {G} a game)?',
      (a, d, e, x, k, g) => (d ? '全' + d + '試合のうち' + n(a) + '試合を終えた段階で' : 'まだ' + n(e) + '試合を終えたばかりで') + '、順位表はまだ暫定的なものにすぎない' +
        (!x ? '' : /as well/i.test(k) ? '。得失点差で見ても、1試合平均' + g + '点の' + x + 'が最も強い' : '。得失点差で見れば、ここまで最も強いのは1試合平均' + g + '点の' + x + 'だ')],
    ['their points for and against suggest about {W} wins, not {W}: the record is running ahead of the play',
      (a, b) => '得失点から見れば' + n(a) + '勝前後が妥当で、' + n(b) + '勝は出来すぎだ。成績が内容を上回っている'],
    ['the contenders meet on {Y}: {X} v {X}', (d, x, y) => date(d) + 'に上位同士が直接対決。' + x + ' VS ' + y],
    ['next for {X}: (.+)', (x, r) => { const t = nx(r); return t && x + 'の次戦は' + vs(t); }],
    ['next: (.+)', r => { const t = nx(r); return t && '次戦は' + vs(t); }],
    ['the next chance: (.+)', r => { const t = nx(r); return t && '次のチャンスは' + tie(t); }],
    ['next to try: {X}, (who visit|at home) on {Y}', (x, k, d) => '次に挑むのは、' + date(d) + (/visit/i.test(k) ? 'に乗り込んでくる' : 'にホームで待ち受ける') + x],
    ['it goes on the line (.+)', r => { const t = nx(r); return t && '連勝が次に懸かるのは' + tie(t); }],
    ['the run goes on the line (.+)', r => { const t = nx(r); return t && '記録が次に懸かるのは' + tie(t); }],
    ['watch it next (.+)', r => { const t = nx(r); return t && '次の注目は' + tie(t); }],
    ['it could come (.+)', r => { const t = nx(r); return t && '達成は' + tie(t) + 'になるかもしれない'; }],

    /* ---- the line, through and out ---- */
    ['the fight for {K}(?: in {X})?: {X} hold it, {X} (?:{A} behind|level)', (k, g, x, y, a) => ing(g) + top(k) + '争い：' + x + 'がその座を守り、' + y + (a ? 'が' + gw(a) + '差で追う' : 'が同率で並ぶ')],
    ['{W} clubs? within a game and a half of {K}', (w, k) => top(k) + 'から1.5ゲーム差以内に' + n(w) + 'クラブがいる'],
    ['only the top {W}(?: in {X})? go through(, and the line moves every week)?', (w, g, t) => ing(g) + '上位' + n(w) + 'クラブだけが勝ち上がる' + (t ? '。そのラインは毎週動く' : '')],
    ['last season’s play-offs took the top {W}(?:; (if this season’s are the same, the line moves every week|whatever this season’s format, nobody can push them out of the top {W} now))?',
      (w, t, w2) => '昨季のプレーオフには上位' + n(w) + 'クラブが進出した' + (!t ? '' : /^if/i.test(t) ? '。今季も同じなら、そのラインは毎週動く' : '。今季の方式がどうであれ、もう' + n(w2) + '位以内から押し出されることはない')],
    ['{X} are sure of a top-{W} finish(?: in {X})?', (x, w, g) => x + 'の' + (g ? grp(g) + 'での' : '') + n(w) + '位以内が確定'],
    ['{X} can no longer finish in the top {W}(?: in {X})?', (x, w, g) => x + 'の' + (g ? grp(g) + 'での' : '') + n(w) + '位以内の可能性が消滅'],
    ['{S}, {O}, with {W} games? left', (a, b, o, w) => rec(a, b) + 'で' + top(o) + '、' + (+n(w) ? '残り' + n(w) + '試合' : '全日程を終えている')],
    ['{S}, {O}; even {W} more wins? would leave them short', (a, b, o, w) => rec(a, b) + 'で' + top(o) + '。残り' + n(w) + '試合' + (+n(w) === 1 ? 'に勝っても' : 'を全勝しても') + '届かない'],
    ['{S}, {O}; their regular season is over', (a, b, o) => rec(a, b) + 'で' + top(o) + '。レギュラーシーズンの全日程を終えている'],

    /* ---- runs and slides ---- */
    ['{X} have won {W} in a row', (x, w) => x + 'が' + n(w) + '連勝'],
    ['{X} have lost {W} straight', (x, w) => x + 'が' + n(w) + '連敗'],
    ['up to {K} at {S}', (k, a, b) => rec(a, b) + 'で' + top(k) + 'に浮上'],
    ['{K} at {S}', (k, a, b) => rec(a, b) + 'で' + top(k)],
    ['the run started {M}', d => '連勝は' + date(d) + 'から始まった'],
    ['the last win was {W} games ago', w => '最後の勝利は' + n(w) + '試合前'],
    ['it has taken them from {K} to {K}', (a, b) => place(a) + 'から' + place(b) + 'まで順位を上げた'],
    ['it has dropped them from {K} to {K}', (a, b) => place(a) + 'から' + place(b) + 'に順位を落とした'],
    ['all {W} by ten points or more', w => n(w) + '試合すべてが10点差以上だった'],
    ['none of the {W} came against a side above them in the table', w => n(w) + '勝はいずれも、順位が上の相手から挙げたものではない'],
    ['only {W} clubs? (?:has|have) had an easier schedule so far', w => 'ここまでこれより楽な日程だったのは' + n(w) + 'クラブだけだ'],
    ['{W} of their defeats this season were by five or fewer: the margins are small', w => '今季の敗戦のうち' + n(w) + '試合は5点差以内。差はわずかだ'],
    ['what changed: {L}, worth {G} points a game to them in the run against {G} before it',
      (l, a, b) => '変わったのは' + facet(l) + '。この間は1試合あたり' + a + '点分、それ以前は' + b + '点分の価値だった'],
    ['what changed: {L}, before the run and during it', l => '何が変わったのか：連勝前と連勝中の' + facet(l)],
    ['what has gone wrong: {L}, in the numbers', l => '何がうまくいっていないのか：数字で見る' + facet(l)],
    ['{L}, a game', l => facet(l) + '（1試合あたり）'],

    /* ---- the unbeaten and the winless ---- */
    ['{X} are still perfect at {S}', (x, a, b) => x + 'が' + (+b ? rec(a, b) : '開幕' + a + '連勝') + 'で無敗を守る'],
    ['average margin {G}(?:; {S} on the road)?', (g, a, b) => '平均得失点差' + g + (a != null ? '、アウェーでは' + rec(a, b) : '')],
    ['(the last unbeaten side in the league|one of {W} sides still unbeaten)(?:(, and nobody has got closer than {W} points)|; their closest win was by {W})?',
      (k, w, far, f, c) => (w ? '無敗を続ける' + n(w) + 'クラブのひとつ' : 'リーグで唯一の無敗クラブ') +
        (far ? 'で、' + n(f) + '点差より詰め寄った相手はいない' : c ? '。最も接戦だった試合は' + n(c) + '点差の勝利' : 'だ')],
    ['{X} are still looking for a first win, {S}', (x, a, b) => x + 'はいまだ未勝利、' + rec(a, b)],
    ['their closest defeat was by {W}', w => '最も惜しかった敗戦は' + n(w) + '点差'],

    /* ---- the record against the points ---- */
    ['{X} are winning more than their points say they should', x => x + 'は得失点の内容以上に勝っている'],
    ['{X} are (even )?better than {S}', (x, e, a, b) => (e ? x + 'は' + rec(a, b) + 'でも、実力はそれ以上' : x + 'の実力は' + rec(a, b) + '以上')],
    ['points for and against say about {W} wins from {W} games; they have {W}', (e, g, w) => '得失点から見れば' + n(g) + '試合で' + n(e) + '勝前後が妥当だが、実際は' + n(w) + '勝'],
    ['they have been outscored by {F} a game and still win; records built on close finishes tend to drift back towards the points',
      f => '1試合平均' + f + '点の得失点差マイナスでも勝っている。接戦の勝利で積み上げた成績は、やがて得失点に見合った水準に戻っていくものだ'],
    ['they outscore opponents by {F} a game, and a side that does that usually gets the wins in the end', f => '1試合平均' + f + '点相手を上回っており、そうしたチームには最終的に勝ち星もついてくるものだ'],
    ['they have been outscored by only {F} a game; {S} in games decided by five or fewer is where the wins went',
      (f, a, b) => '得失点差は1試合平均わずか' + f + '点のマイナス。5点差以内の試合で' + rec(a, b) + 'と、勝ち星はそこで失われた'],
    ['they have been outscored by only {F} a game, which is the record of a side nearer the middle', f => '得失点差は1試合平均わずか' + f + '点のマイナスで、本来なら中位クラスの成績だ'],
    ['closing out tight games is a skill too: they are {S} in them', (a, b) => '接戦を勝ち切るのも実力のうちだ。接戦では' + rec(a, b)],

    /* ---- what wins for them ---- */
    ['{X} live and die by {L}, even for this league', (x, l) => x + 'の勝敗は' + facet(l) + '次第。このリーグの中でも際立っている'],
    ['{X} win and lose on {L}', (x, l) => x + 'の勝敗を分けるのは' + facet(l)],
    ['in their wins {L} has been worth {G} points a game to them; in their defeats, {G}', (l, a, b) => '勝った試合では' + facet(l) + 'が1試合あたり' + a + '点分、負けた試合では' + b + '点分だった'],
    ['every club here rises and falls with {L}; for {X} the swing between wins and defeats is {F} points a game, against {F} for a typical club',
      (l, x, a, b) => 'このリーグではどのクラブも' + facet(l) + 'で浮き沈みするが、' + x + 'は勝ちと負けの差が1試合あたり' + a + '点で、平均的なクラブの' + b + '点を上回る'],
    ['most clubs here rise and fall with {L}; {X}’s? results turn on {L}, a swing of {F} points a game between their wins and their defeats, against {F} for a typical club',
      (l, x, l2, a, b) => 'このリーグの多くのクラブは' + facet(l) + 'で浮き沈みするが、' + x + 'の結果を左右するのは' + facet(l2) + '。勝ちと負けの差は1試合あたり' + a + '点で、平均的なクラブは' + b + '点だ'],
    ['{L} swings their results more than it does for most clubs here', l => facet(l) + 'が、ほかの多くのクラブ以上に結果を左右する'],
    ['{L} separates their wins from their defeats', l => facet(l) + 'が勝敗を分ける'],

    /* ---- the players ---- */
    ['{X} has scored 20 or more in all {W} games this season', (p, w) => p + 'が今季全' + n(w) + '試合で20得点以上'],
    ['{X} has scored 20 or more in {W} straight games', (p, w) => p + 'が' + n(w) + '試合連続20得点以上'],
    ['{F} points a game(?: for {X})?, with a high of {D}', (f, x, d) => (x ? x + 'で' : '') + '1試合平均' + f + '得点、最多は' + d + '得点'],
    ['{F} points a game over the run(?: for {X})?, against {F} for the season', (a, x, b) => (x ? x + 'で' : '') + 'この期間は1試合平均' + a + '得点、シーズン平均は' + b + '得点'],
    ['the league’s top scorer, at {F} a game, and nobody has found an answer yet', f => '1試合平均' + f + '得点のリーグ得点王で、まだ誰も止める手立てを見つけられていない'],
    ['over the run, {X} has scored {D}% of {X}’s? points', (p, d, x) => 'この期間、' + p + 'は' + x + 'の得点の' + d + '%を挙げている'],
    ['{X} is scoring {F} a game over the last five(?: for {X})?', (p, f, x) => (x ? x + 'の' : '') + p + 'が直近5試合で1試合平均' + f + '得点'],
    ['up from {F} before that', f => 'それ以前は' + f + '得点だった'],
    ['the minutes explain most of it: up from {F} to {F} a game', (a, b) => '主な理由は出場時間で、1試合平均' + a + '分から' + b + '分に増えている'],
    ['much the same minutes \\({F} a game against {F}\\), many more points: the shots are falling, or the role has changed',
      (a, b) => '出場時間はほぼ同じ（1試合平均' + a + '分、以前は' + b + '分）なのに、得点は大きく増えた。シュートが決まっているか、役割が変わったかだ'],
    ['{X} is {W} points? from {D} this season', (p, w, d) => p + 'が今季通算' + d + '得点まであと' + n(w) + '点'],
    ['nobody in the league has reached {D} yet', d => 'リーグでまだ誰も' + d + '得点に到達していない'],
    ['{F} a game(?: for {X})?; {W} games? so far', (f, x, w) => (x ? x + 'で' : '') + '1試合平均' + f + '得点、ここまで' + n(w) + '試合'],
    ['{X} has not played in {X}’s? last {W} games', (p, x, w) => p + 'が' + x + 'の直近' + n(w) + '試合に出場していない'],
    ['before that: {F} minutes and {F} points a game', (a, b) => 'それまでは1試合平均' + a + '分出場、' + b + '得点'],
    ['{X} are {S} without them', (x, a, b) => x + 'は不在の間' + rec(a, b)],
    ['{X} leads the league in box plus-minus', p => p + 'がBPMでリーグトップ'],
    /* the specific whys: the best player's margin over the next, the quiet one's two ranks, the next best night and team
       record, how often the lens's facet decided a game */
    ['{F} clear of {X}, the next best', (f, p) => '2番手の' + p + 'を' + f + '上回る'],
    ['only {W} players? in the league (?:has|have) a better box plus-minus; {W} score more', (a, b) => 'BPMで上回る選手はリーグに' + n(a) + '人しかいないが、得点では' + n(b) + '人が上回る'],
    ['the next best is {D}, by {X}', (d, p) => '次点は' + p + 'の' + d],
    ['the next best this season is {D}, {X} against {X}', (d, x, y) => '今季の次点は、' + x + 'が' + y + '戦で記録した' + d],
    ['game by game, it has been the facet that decided {D}% of the results here', d => '試合ごとに見ると、このリーグの試合結果の' + d + '%がこの要素で決まっている'],
    /* the award races: "18 · efficiency per game · minimum 13 games", one line on the page */
    ['{F} · (' + alt(MEASURE) + ')(?: · minimum {D} games)?', (v, m, d) => v + ' · ' + MEASURE[m.toLowerCase()] + (d ? ' · ' + d + '試合以上出場' : '')],
    ['{G} BPM on {F} points, {F} rebounds and {F} assists(?: in {F} minutes)? a game(?: for {X})?',
      (g, p, r, a, m, x) => (x ? x + 'で' : '') + '1試合平均' + (m ? m + '分の出場で' : '') + p + '得点' + r + 'リバウンド' + a + 'アシスト、BPMは' + g],
    ['{X} is one of the league’s best players on {F} points a game', (p, f) => p + 'は1試合平均' + f + '得点ながらリーグ屈指の選手'],
    ['{G} BPM, {O} in the league, {O} in scoring(?:, for {X})?', (g, a, b, x) => 'BPMは' + g + 'でリーグ' + a + '位、得点では' + b + '位' + (x ? '（' + x + '）' : '')],
    ['{X}, {D}, is the best young player in the league by the numbers', (p, a) => a + '歳の' + p + 'が数字の上でリーグ最高の若手'],
    ['nobody else aged 21 or under with a real role comes close: {X} is next, at {G}', (p, g) => '21歳以下で主力級の役割を担う選手に、肩を並べる者はいない。次点は' + p + 'の' + g],
    ['the fans’ player of the week: {X}', p => 'ファン投票の週間最優秀選手：' + p],
    ['{D}% of the vote from {D} ballots(?:; {F} points a game that week)?', (a, b, f) => b + '票中' + a + '%を獲得' + (f ? '、その週は1試合平均' + f + '得点' : '')],
    ['the numbers had another week in mind: {X}’s BPM was {G}, against {G}', (p, a, b) => '数字は別の選手を推していた。' + p + 'のBPMは' + a + 'で、こちらは' + b + 'だった'],
    ['{X}’s {W} (points|rebounds|assists|threes) (are|equal) the most in a game this season', (p, w, k, eq) => p + 'の' + stat(n(w), k) + 'が今季1試合最多' + (/equal/i.test(eq) ? 'タイ' : '')],
    ['for {X}, {Y}', (x, d) => date(d) + '、' + x + 'での記録'],
    ['{X} won it at the death', p => p + 'が土壇場で決勝点を決めた'],
    ['{X} put them ahead for good late on', p => p + 'が終盤に勝ち越し点を決め、そのまま逃げ切った'],

    /* ---- the foot of the table ---- */
    ['{X} are bottom at {S}, (?:{A} behind {X}|level with {X})', (x, a, b, g, y, y2) => x + 'が' + rec(a, b) + 'で最下位、' + (g ? y + 'と' + gw(g) + '差' : y2 + 'と並ぶ')],
    ['their last five: ([WL](?: [WL])*)', s => '直近5試合：' + s.split(' ').map(c => (/w/i.test(c) ? '○' : '●')).join('')],

    /* ---- the same two twice, the upsets ---- */
    ['{X} sweep {X}', (x, y) => x + 'が' + y + 'に連勝'],
    ['wins of {S} on {V} and {S} on {V}', (a, b, d1, c, e, d2) => wd(d1) + 'に' + sc(a, b) + '、' + wd(d2) + 'に' + sc(c, e) + 'で勝利'],
    ['{X} are {K}, {X} {K}', (x, k, y, k2) => x + 'は' + top(k) + '、' + y + 'は' + top(k2)],
    ['two wins over a side {W} places above them in the table', w => '順位で' + n(w) + 'つ上の相手から2勝を挙げた'],
    ['{X} and {X} split their two games', (x, y) => x + 'と' + y + 'の2連戦は1勝1敗'],
    ['{X} won {S} on {V}; {X} answered {S} on {V}', (x, a, b, d1, y, c, e, d2) => wd(d1) + 'は' + x + 'が' + sc(a, b) + 'で勝ち、' + wd(d2) + 'は' + y + 'が' + sc(c, e) + 'でやり返した'],
    ['{X} won one of them at the death', p => 'うち1試合は' + p + 'が土壇場で決めた'],
    ['{X} turned an? {W}-point defeat into an? {W}-point win', (x, a, b) => x + 'は' + n(a) + '点差の敗戦から、' + n(b) + '点差の勝利へと立て直した'],
    ['it ended {X}’s? run of {W} straight wins', (x, w) => x + 'の連勝を' + n(w) + 'で止めた'],
    ['the season’s numbers made {X} clear favourites, by about {W} points', (x, w) => '今季の数字では' + x + 'が約' + n(w) + '点差で勝つ本命だった'],
    ['{W} places separate them in the table', w => '両チームの順位は' + n(w) + 'つ離れている'],
    ['{X} \\({O}\\) beat {X} \\({O}\\)', (x, a, y, b) => x + '（' + a + '位）が' + y + '（' + b + '位）を破った'],
    ['{X}(?:, {O},)? beat {X}(?:, {O},)? {S}', (x, a, y, b, c, d) => x + (a ? '（' + a + '位）' : '') + 'が' + y + (b ? '（' + b + '位）' : '') + 'に' + sc(c, d) + 'で勝利'],
    ['the season’s numbers had {X} by about {W} before the tip', (x, w) => '試合前、今季の数字では' + x + 'が約' + n(w) + '点差で有利とされていた'],
    ['{B} (?:was|were) worth about {D} points to them', (l, d) => facet(l) + 'で約' + d + '点分の差をつけた'],
    /* a series' edge, said of the side (narrative.js EDGE) */
    ['{X} (shoot better|look after the ball better|own the offensive glass|get to the line more), worth about {W} points? a game', (x, k, w) =>
      x + 'は' + ({ 'shoot better': 'シュートで上回り', 'look after the ball better': 'ターンオーバーが少なく', 'own the offensive glass': 'オフェンスリバウンドで優位に立ち', 'get to the line more': 'フリースローを多く獲得し' })[k] + '、1試合あたり約' + n(w) + '点分の差'],

    /* ---- the play-offs: a two-legged tie ---- */
    ['{X} go through on aggregate, {S}', (x, a, b) => x + 'が合計' + sc(a, b) + 'で勝ち抜け'],
    ['{X} take an? {W}-point lead into the {E} against {X}', (x, w, l, y) => x + 'が' + y + 'を' + n(w) + '点リードして' + LEG(l) + 'へ'],
    ['{X} and {X} are level after the {E}', (x, y, l) => x + 'と' + y + 'は' + LEG(l) + 'を終えて合計スコアで並ぶ'],
    ['{X} v {X}: the {E} is on (?:{Y}|its way)', (x, y, l, d) => x + ' VS ' + y + '：' + LEG(l) + (d ? 'は' + date(d) : 'が近づく')],
    ['decided by {W} points? over {W} legs', (d, l) => n(l) + '試合合計' + n(d) + '点差の決着'],
    ['{X} won the {E} by {W} and still went out', (x, l, w) => x + 'は' + LEG(l) + 'を' + n(w) + '点差で制しながら敗退した'],
    ['{X} won (both legs|every leg)', (x, k) => x + 'は' + (/both/i.test(k) ? '2試合とも' : 'すべての試合で') + '勝利した'],
    ['decided on aggregate: a lead of {W} points? is (close to decisive|a cushion, not a certainty|next to nothing) with a leg to play',
      (d, k) => '合計スコアで決まる対戦で、' + (+n(d) ? '1試合を残しての' + n(d) + '点のリードは' + ({ 'close to decisive': 'ほぼ決定的だ', 'a cushion, not a certainty': '余裕ではあるが、安泰ではない', 'next to nothing': 'ないも同然だ' })[k.toLowerCase()] : '1試合を残して両チームは並んでいる')],
    ['{E}: {Y}, with {X} at home', (l, d, x) => LEG(l) + 'は' + date(d) + '、' + x + 'のホームで行われる'],
    ['((?:first leg|leg \\d+): .+ \\d+–\\d+ .+)', s => {
      const leg = new RegExp('^(' + LEGS + '): (.+?) (\\d+)–(\\d+) (.+)$', 'i');
      const it = s.split('; ').map(p => { const m = leg.exec(p); return m ? LEG(m[1]) + '：' + m[2] + ' ' + sc(m[3], m[4]) + ' ' + m[5] : null; });
      return it.indexOf(null) >= 0 ? null : it.join('、');
    }],

    /* ---- the play-offs: a series ---- */
    ['{X} are through, {S} against {X}', (x, a, b, y) => x + 'が' + y + 'を' + rec(a, b) + 'で下し勝ち抜け'],
    ['{X} v {X}: the series starts (?:{Y}|soon)', (x, y, d) => x + ' VS ' + y + '：シリーズは' + (d ? date(d) + 'に開幕' : 'まもなく開幕')],
    ['{X} take game 1 against {X}', (x, y) => x + 'が' + y + 'とのシリーズ初戦を制す'],
    ['game {D}: {X} won {S} (at home|on the road)', (d, x, a, b, w) => '第' + d + '戦は' + x + 'が' + sc(a, b) + 'で' + (/home/i.test(w) ? 'ホーム' : 'アウェー') + '勝利'],
    ['{X} finished {K} in the regular season, {X} {K}', (x, k, y, k2) => 'レギュラーシーズンは' + x + 'が' + top(k) + '、' + y + 'が' + top(k2)],
    ['{X} are one win from going through, in a best of {W}', (x, w) => (Math.floor(+n(w) / 2) + 1) + '戦先勝方式で、' + x + 'は勝ち抜けまであと1勝'],
    ['the lower seed has the lead: {X} finished {W} places above them', (x, w) => '下位シードがリードしている。レギュラーシーズンでは' + x + 'が' + n(w) + 'つ上の順位だった'],
    ['game {D} was decided by {W} points?', (d, w) => '第' + d + '戦は' + n(w) + '点差の決着だった'],
    ['{X} won their only regular-season meeting', x => 'レギュラーシーズン唯一の対戦は' + x + 'が勝利'],
    ['{X} won (both|all {W}) of their regular-season meetings', (x, k, w) => 'レギュラーシーズンの対戦は' + x + 'の' + (w ? n(w) : 2) + '戦全勝'],
    ['they split their regular-season meetings {S}', (a, b) => 'レギュラーシーズンの対戦は' + rec(a, b) + 'と星を分け合った'],
    ['game {D} is on {Y}, with {X} at home', (d, dy, x) => '第' + d + '戦は' + date(dy) + '、' + x + 'のホームで行われる']
  ]).concat(STATUS).concat([

    /* ---- the schedule so far, by the adjusted numbers ---- */
    ['{X}’s? {S} has come against the hardest schedule in the league', (x, a, b) => x + 'の' + rec(a, b) + 'は、リーグで最も厳しい日程で挙げたもの'],
    ['their opponents so far average {G} points per 100 possessions, adjusted; the easiest schedule has been {X}’s? \\({G}\\)',
      (g, x, h) => 'ここまでの対戦相手の調整NETRTGは平均' + g + '。最も楽な日程だったのは' + x + '（' + h + '）'],
    ['against the schedule they have played, their margins rank {K} in the league: the record undersells them',
      k => '対戦相手の強さを考慮すると、得失点差はリーグ' + (rank(k) === 1 ? 'トップ' : place(k)) + '。成績は実力を過小評価している'],
    ['by the margins, adjusted for the schedule, {X} are the best side in the league', x => '日程の強さを補正した得失点差では、' + x + 'がリーグ最強'],
    ['{G} points per 100 possessions against the opponents they have had; they are {K} in the table at {S}',
      (g, k, a, b) => 'これまでの対戦相手を考慮した調整NETRTGは' + g + '。順位表では' + rec(a, b) + 'で' + top(k)],
    ['the table is what decides the season, and {X} are top of it', x => 'シーズンを決めるのは順位表で、その首位は' + x + 'だ'],

    /* ---- the season's team records ---- */
    ['{X}’s? {D}-point win over {X} is the biggest of the season', (x, d, y) => x + 'が' + y + 'に' + d + '点差で勝利、今季最大の点差'],
    ['{X}’s? {D} (points|threes) against {X} are the most (?:points|threes) in a game this season',
      (x, d, k, y) => x + 'が' + y + '戦で' + (/points/i.test(k) ? '挙げた' + d + '得点' : '決めた3Pシュート' + d + '本') + 'は今季1試合最多'],

    /* ---- what wins here ---- */
    ['{L} decides more games in this league than anything else', l => 'このリーグで最も勝敗を左右するのは' + facet(l)],
    ['one standard step better than the average club at {L} is worth about {F} points a game here; at {L}, {F}',
      (l, a, l2, b) => facet(l) + 'で平均的なクラブを標準偏差1つ分上回ると、このリーグでは1試合あたり約' + a + '点の価値がある。' + facet(l2) + 'では' + b + '点'],

    /* ---- what changed, how it ended ---- */
    ['now {W} straight \\(was {W}\\)', (a, b) => n(a) + '連勝に伸びた（前回は' + n(b) + '連勝）'],
    ['now {W} defeats in a row', w => n(w) + '連敗となった'],
    ['now {W} straight 20-point games', w => n(w) + '試合連続20得点以上となった'],
    ['the gap at the top is now {A}', a => (gwNum(a) ? '首位と2位の差は' + gw(a) + 'になった' : '首位と2位の差がなくなった')],
    ['the gap at the line is now {A}', a => (gwNum(a) ? '圏内と圏外の差は' + gw(a) + 'になった' : '圏内と圏外の差がなくなった')],
    ['now {S}', (a, b) => (+b ? rec(a, b) : '開幕' + a + '連勝') + 'となった'],
    ['now {W} points? away', w => 'あと' + n(w) + '点となった'],
    ['on aggregate, now {S}', (a, b) => '合計スコアは' + sc(a, b) + 'となった'],
    ['the series is now {S}', (a, b) => 'シリーズは' + rec(a, b) + 'となった'],
    ['ended at {W} by {X}, {S}', (w, x, a, b) => x + 'に' + sc(a, b) + 'で敗れ、連勝は' + n(w) + 'で止まった'],
    ['ended with a win over {X}, {S}', (x, a, b) => x + 'に' + sc(a, b) + 'で勝ち、連敗を止めた'],
    ['the first win came against {X}, {S}', (x, a, b) => '今季初勝利は' + x + '戦、' + sc(a, b) + 'だった'],
    ['{X} ended it, {S}', (x, a, b) => x + 'に' + sc(a, b) + 'で敗れ、無敗が止まった'],

    /* ---- the closer, a suspension, a storyline's timeline ---- */
    ['{X} scored {D} points in clutch time this week', (p, d) => p + 'が今週のクラッチタイムで' + d + '得点'],
    ['that is {D} of {X}’s? {D} points in the closing minutes of a close game they (won|lost)',
      (a, x, b, k) => '接戦の終盤に' + x + 'が挙げた' + b + '得点のうち' + a + '得点。試合は' + (/won/i.test(k) ? '勝利' : '敗戦') + 'だった'],
    ['that is {D} of {X}’s? {D} points in the closing minutes of {W} close games; they (won|lost) (both|all {W}|{W})',
      (a, x, b, g, wl, k, all, w) => {
        const won = /won/i.test(wl);
        const how = /^both$/i.test(k) ? '2試合とも' + (won ? '勝利した' : '敗れた') : all ? n(all) + '試合すべてに' + (won ? '勝利した' : '敗れた')
          : won ? (+n(w) ? n(w) + '勝した' : '1勝もできなかった') : n(w) + '敗した';
        return '接戦' + n(g) + '試合の終盤に' + x + 'が挙げた' + b + '得点のうち' + a + '得点。' + how;
      }],
    ['when the game is on the line, the ball goes to {X}', p => '勝負どころでは、ボールは' + p + 'に託される'],
    ['{X} is suspended(?:, with {W} games? left to serve)?', (p, w) => p + 'が出場停止' + (w ? '、残り' + n(w) + '試合' : '')],
    ['out of {X}’s? last {W} games(?:: a suspension of {W} games?)?', (x, w, s) => x + 'の直近' + n(w) + '試合を欠場' + (s ? '（' + n(s) + '試合の出場停止）' : '')],
    ['the suspension runs to {M}; {X} are without {F} minutes and {F} points a game', (d, x, a, b) => '出場停止は' + date(d) + 'まで。それまで' + x + 'は1試合平均' + a + '分、' + b + '得点を欠く'],
    ['until it is served, {X} are without {F} minutes and {F} points a game', (x, a, b) => '出場停止が明けるまで、' + x + 'は1試合平均' + a + '分、' + b + '得点を欠く'],
    ['opened: (.+)', h => { const t = headline(h); return t && '開始：' + t; }],

    /* ---- the questions to ask (to a club's coach, or to a player by name) ---- */
    ['{X}’s? coach', x => x + 'のヘッドコーチ'],
    ['does the table mean anything yet, {W} games? in', w => n(w) + '試合を終えた段階で、順位表にもう意味はありますか'],
    ['with {W} games? left, is first place yours to lose', w => '残り' + n(w) + '試合、首位の座は自分たち次第ですか'],
    ['you are sure of a top-{W} finish: what are you playing for now', w => n(w) + '位以内が確定しました。ここからは何のために戦いますか'],
    ['with the top {W} out of reach, what is the rest of the season for', w => n(w) + '位以内の可能性がなくなった今、残りのシーズンをどう位置づけますか'],
    /* the run's question and the slide's share their opening; the ending says which run it is */
    ['in the run, {L} has been worth {G} points a game to you, against {G} before it: (what changed|is that the first thing to fix)',
      (l, a, b, k) => (/changed/i.test(k) ? '連勝中' : '連敗中') + '、' + facet(l) + 'の価値は1試合あたり' + a + '点分で、それ以前は' + b + '点分でした。' +
        (/changed/i.test(k) ? '何が変わったのですか' : 'まずそこを修正すべきですか')],
    ['what has changed in the last {W} games', w => '直近' + n(w) + '試合で何が変わりましたか'],
    ['none of the {W} wins came against a side above you in the table: what will the run tell you about this team',
      w => n(w) + '勝はいずれも順位が上の相手から挙げたものではありません。この連勝はチームについて何を教えてくれますか'],
    ['nobody has got closer than {W} points: what has made you so hard to beat', w => 'どの相手も' + n(w) + '点差より詰め寄れていません。なぜこれほど負けないのですか'],
    ['your closest win was by {W}: which game nearly got away', w => '最も接戦だった勝利は' + n(w) + '点差でした。どの試合が危なかったですか'],
    ['your opponents so far have been among the weakest in the league: how much does {S} prove',
      (a, b) => 'ここまでの対戦相手はリーグでも弱い部類です。' + (+b ? rec(a, b) : '開幕' + a + '連勝') + 'はどれだけの証明になりますか'],
    ['your closest defeat was by {W}: what has been missing at the end of games', w => '最も惜しかった敗戦は' + n(w) + '点差でした。試合終盤に何が足りないのでしょうか'],
    ['you are {S} in games decided by five or fewer: how much of that is skill, and how much will last',
      (a, b) => '5点差以内の試合で' + rec(a, b) + 'です。そのうちどれだけが実力で、どれだけ続くと思いますか'],
    ['your points for and against say about {W} wins, not {W}: where have the close games gone',
      (a, b) => '得失点から見れば' + n(a) + '勝前後が妥当で、' + n(b) + '勝ではありません。接戦はどこで落としたのでしょうか'],
    ['your results swing with {L} more than almost anyone else’s here: is that a plan or a problem',
      l => 'このリーグのほぼどのクラブよりも、結果が' + facet(l) + 'に左右されています。それは狙いですか、それとも課題ですか'],
    ['your results turn on {L} more than on anything else: is that by design', l => '結果を何よりも左右しているのは' + facet(l) + 'です。それは意図したものですか'],
    ['you have scored 20 or more in {W} straight games: what has changed', w => n(w) + '試合連続で20得点以上です。何が変わったのですか'],
    ['{X} has scored {D}% of your points over the run: what happens when teams take that away',
      (p, d) => 'この期間、' + p + 'がチーム得点の' + d + '%を挙げています。相手にそこを封じられたらどうしますか'],
    ['{X}’s? minutes have gone from {F} to {F} a game: what has earned them', (p, a, b) => p + 'の出場時間が1試合平均' + a + '分から' + b + '分に増えました。何が評価されたのですか'],
    ['how do you cover {X}’s? {F} minutes while the suspension runs', (p, f) => '出場停止の間、' + p + 'の1試合平均' + f + '分をどう埋めますか'],
    ['how has the rotation changed without {X}', p => p + 'の不在でローテーションはどう変わりましたか'],
    ['you lead the league in box plus-minus on {F} points a game: what part of your game do people miss',
      f => '1試合平均' + f + '得点ながら、BPMでリーグトップです。見落とされがちなのはプレーのどの部分ですか'],
    ['{X} ranks {O} in the league by box plus-minus on {F} points a game: what does the box score miss',
      (p, o, f) => p + 'は1試合平均' + f + '得点ながら、BPMでリーグ' + o + '位です。ボックススコアには何が表れていないのでしょうか'],
    ['{X} scored {D} of your {D} points in the closing minutes: does the ball always go to {X} at the end',
      (p, a, b, p2) => '試合終盤のチーム' + b + '得点のうち' + a + '得点を' + p + 'が挙げています。最後は必ず' + p2 + 'にボールを託すのですか'],
    ['the season’s numbers had {X} by about {W}: what did you do that they did not expect',
      (x, w) => '今季の数字では' + x + 'が約' + n(w) + '点差で有利とされていました。相手の想定を上回ったのは何ですか'],
    ['what did you see in {X} that the table did not', x => '順位表には表れない、' + x + 'のどこに勝機を見ていましたか'],
    ['you are {W} points? down going into the second leg: how do you approach it', w => n(w) + '点のビハインドで第2戦を迎えます。どう臨みますか'],
    ['you finished {W} places above them and lost game {D}: what changes for the next one',
      (w, d) => 'レギュラーシーズンでは' + n(w) + 'つ上の順位でしたが、第' + d + '戦を落としました。次の試合に向けて何を変えますか'],
    ['game {D} came down to {W} points?: what decides the next one', (d, w) => '第' + d + '戦は' + n(w) + '点差の決着でした。次の試合を分けるのは何ですか'],
    ['you lost game {D} by {W}: what has to change', (d, w) => '第' + d + '戦は' + n(w) + '点差で敗れました。何を変える必要がありますか'],
    ['what did game {D} teach you about this matchup', d => '第' + d + '戦で、この対戦について何がわかりましたか'],
    ['you have played the hardest schedule in the league: how much better is this team than {S}',
      (a, b) => 'リーグで最も厳しい日程を戦ってきました。このチームの実力は' + rec(a, b) + 'よりどれだけ上ですか'],
    ['{X} is {D} and already among your best: how big will the role get', (p, d) => p + 'は' + d + '歳にしてすでにチームの主力です。役割はどこまで大きくなりますか'],

    /* ---- the threads under a fixture (narrative.js threadsOf) ---- */
    ['{X}’s? run of {W} straight wins is on the line', (x, w) => x + 'の' + n(w) + '連勝が懸かる'],
    ['{X} have lost {W} straight: a chance to end it', (x, w) => x + 'は' + n(w) + '連敗中。連敗を止めるチャンス'],
    ['{X} put their unbeaten record on the line', x => x + 'の無敗記録が懸かる'],
    ['{X} go looking for a first win again', x => x + 'が再び今季初勝利を目指す'],
    ['{X}’s? run of {W} straight 20-point games is on the line', (p, w) => p + 'の' + n(w) + '試合連続20得点以上が懸かる'],
    ['{X} needs {W} points? for {D} this season', (p, w, d) => p + 'は今季通算' + d + '得点まであと' + n(w) + '点'],
    ['{X} has missed {X}’s? last {W} games', (p, x, w) => p + 'は' + x + 'の直近' + n(w) + '試合を欠場'],
    ['{X}’s? results turn on {L}', (x, l) => x + 'の勝敗は' + facet(l) + '次第'],
    ['{X} comes in scoring {F} a game over the last five', (p, f) => p + 'は直近5試合で平均' + f + '得点'],

    /* ---- the coverage plan: the big picture ---- */
    ['{W} games? into an? {D}-game regular season, with {W} games? left for most clubs', (a, d, l) => '全' + d + '試合のレギュラーシーズンのうち' + n(a) + '試合を消化。多くのクラブは残り' + n(l) + '試合'],
    ['(?:in {X}, )?{X} finished the regular season top at {S}(?:, {A} clear of {X}|, level with {X})',
      (g, x, a, b, h, y, y2) => (g ? grp(g) + 'では' : '') + x + 'が' + rec(a, b) + 'でレギュラーシーズン首位。' + (h ? y + 'に' + gw(h) + '差をつけた' : y2 + 'と同じ成績だった')],
    ['(?:in {X}, )?{X} lead at {S}(?:, {A} clear of {X}|, level with {X})',
      (g, x, a, b, h, y, y2) => (g ? grp(g) + 'では' : '') + x + 'が' + rec(a, b) + 'で首位、' + (h ? y + 'に' + gw(h) + '差' : y2 + 'と並んでいる')],
    ['there are {W} clubs within a game and a half of them', w => '1.5ゲーム差以内で' + n(w) + 'クラブが追う'],
    ['across {D} games, home sides have won {D}% and games average {F} points between the two sides; {D}% have been decided by five or fewer',
      (g, h, p, c) => g + '試合でホームチームの勝率は' + h + '%、両チーム合計の平均得点は' + p + '点。' + c + '%の試合が5点差以内で決着している'],
    ['what wins here, in points a game for being one standard step better than the average club: (.+)', l => {
      const it = l.split(/, | and /).map(s => { const m = new RegExp('^(' + alt(FACET) + ') (\\d+(?:\\.\\d+)?)$', 'i').exec(s); return m ? facet(m[1]) + ' ' + m[2] : null; });
      return it.indexOf(null) >= 0 ? null : 'このリーグの勝因（平均的なクラブを標準偏差1つ分上回った場合の1試合あたりの価値）：' + it.join('、');
    }],
    ['game by game, {L} has been the deciding facet {D}% of the time(?:, {L} {D}%)?', (l, a, l2, b) => '試合ごとに見ると、勝敗を分けた要素は' + facet(l) + 'が' + a + '%' + (l2 ? '、' + facet(l2) + 'が' + b + '%' : '')],

    /* ---- the slate, the recaps, the clubs, the notes, the calendar ---- */
    ['by about {F}', f => '約' + f + '点差で優位'],
    ['meetings this season: {S}', (a, b) => '今季の対戦：' + rec(a, b)],
    ['(, )?{F} ppg (over the last five|so far)', (c, f, k) => (c ? '、' : '') + (/five/i.test(k) ? '直近5試合で平均' : 'ここまで平均') + f + '得点'],
    ['fans: {D}% {X} \\({D} picks\\)', (p, x, k) => 'ファン予想：' + x + ' ' + p + '%（' + k + '件）'],
    ['{B} decided it, about {D} points', (l, d) => '勝負を分けたのは' + facet(l) + '、約' + d + '点分'],
    ['([+−-]?\\d+(?:\\.\\d+)?) wins against what their points say', v => '得失点から見た期待値比 ' + v + '勝'],
    ['(one win|{F} wins) (more|fewer) than their points say', (k, f, m) => '得失点から見た期待値より' + (f || 1) + '勝' + (/more/i.test(m) ? '多い' : '少ない')],
    ['close games {S}', (a, b) => '接戦 ' + rec(a, b)],
    ['{X} are {S} in games decided by five or fewer; {X} {S}', (x, a, b, y, c, d) => '5点差以内の試合で' + x + 'は' + rec(a, b) + '、' + y + 'は' + rec(c, d)],
    ['{X} are {S} at home', (x, a, b) => x + 'はホームで' + rec(a, b)],
    ['{X} are {S} away from home', (x, a, b) => x + 'はアウェーで' + rec(a, b)],
    ['{D} at {X} v {X}, {Y}', (d, x, y, dy) => date(dy) + 'の' + x + ' VS ' + y + 'に' + d + '人が来場'],
    ['{D} points, by {X} against {X}', (d, x, y) => x + 'が' + y + '戦で記録した' + d + '得点'],
    ['worth about {F} points a game here, beyond the four factors', f => '4ファクターとは別に、このリーグでは1試合あたり約' + f + '点の価値がある'],
    ['the side most fans picked has won {D} of the last {D} games with ten or more picks \\({D}%\\)',
      (a, b, p) => '予想が10件以上集まった直近' + b + '試合で、ファンの多数派が選んだ側が勝ったのは' + a + '試合（' + p + '%）'],
    ['preview: {X} v {X}(?: — (.+))?', (x, y, a) => { const t = a ? angle(a) : ''; return t == null ? null : 'プレビュー：' + x + ' VS ' + y + (a ? ' — ' + t : ''); }],
    ['recap after the game: {X} v {X}', (x, y) => '試合後にレポート：' + x + ' VS ' + y],
    ['feature: (.+)', h => { const t = headline(h); return t && '特集：' + t; }],
    ['data piece: (.+)', h => { const t = headline(h); return t && 'データ記事：' + t; }],
    ['updated {D} hours? ago', d => d + '時間前に更新'],
    ['updated {D} days? ago', d => d + '日前に更新'],

    /* ---- the site's significance reasons for a game (0202_game_significance.sql; the fixed ones are in the table) ---- */
    ['{D}-point game(?:: {X})?', (d, p) => (p ? p + 'が' + d + '得点' : d + '得点の活躍')],
    ['decided by {D} points?', d => d + '点差の決着'],
    ['(triple-double|double-double)(?:: {X})?', (k, p) => (p ? p + 'が' : '') + (/^triple/i.test(k) ? 'トリプルダブル' : 'ダブルダブル')],
    ['20-20 game(?:: {X})?', p => (p ? p + 'が' : '') + '20得点20リバウンド'],
    ['season high: {D} points', d => '今季リーグ最多：' + d + '得点'],
    ['upset: {O} beat {O}', (a, b) => '番狂わせ：' + a + '位が' + b + '位を破る'],
    ['(top-of-the-table clash|top-three clash|table-top rivals): {O} v {O}',
      (k, a, b) => ({ 'top-of-the-table clash': '首位攻防', 'top-three clash': '上位3クラブの対決', 'table-top rivals': '上位対決' })[k.toLowerCase()] + '：' + top(a) + ' VS ' + top(b)],
    ['{D} overtimes', d => d + '度の延長戦'],

    /* ---- a day, a place word; a club's place, record and run on the slate ("1st · 5–1 · W5", a part at a time) ---- */
    ['{Y}', d => date(d)],
    ['(' + Object.keys(PLACE).join('|') + ')', k => place(k)],
    ['{O}', o => place(o)],
    ['{S}', (a, b) => rec(a, b)],
    ['([WL])(\\d+)', (k, d) => d + (/w/i.test(k) ? '連勝' : '連敗')],

    /* ---- the figures beside a storyline (its numbers' values): the words in them ---- */
    ['([WL](?: [WL])*)', s => s.split(' ').map(c => (/w/i.test(c) ? '○' : '●')).join('')],
    ['{G} in the run, {G} before', (a, b) => '期間中' + a + '、それ以前' + b],
    ['{F} ppg', f => '平均' + f + '得点'],
    ['{F} pts', f => f + '点'],
    ['{F} \\(was {F}\\)', (a, b) => a + '（以前は' + b + '）'],
    ['{G} \\({O}\\)', (g, o) => g + '（' + place(o) + '）'],
    ['{D} — {X} \\(shared\\)', (d, p) => d + ' — ' + p + '（タイ記録）'],
    ['{B}, about {D} points?', (l, d) => facet(l) + '、約' + d + '点分'],
    ['{L} \\({X}, about {F} points?\\)', (l, x, f) => facet(l) + '（' + x + '、約' + f + '点分）'],
    ['{X}’s? {D}-point win over {X}', (x, d, y) => x + 'が' + y + 'に' + d + '点差で勝利'],
    ['{X}’s? {D} (points|threes) against {X}', (x, d, k, y) => x + 'が' + y + '戦で' + (/points/i.test(k) ? '挙げた' + d + '得点' : '決めた3Pシュート' + d + '本')],

    /* ---- the composites: a game's angle, a series' state after its label, the site's reasons joined with "; " ---- */
    ['(.+)', s => angle(s)],
    ['(.+?): (.+)', (l, s) => {
      const out = s.split('; ').map(p => first(STATUS_C, p));
      return out.indexOf(null) >= 0 ? null : label(l) + '：' + out.join('。');
    }],
    ['(.+; .+)', s => {
      /* each reason the newsdesk's own, or a fixed one from the table (which has no name in it) */
      const out = s.split('; ').map(p => { const t = clause(p); if (t != null) return t; const e = ENG ? ENG(p) : null; return e && !/[A-Za-z]/.test(e) ? e : null; });
      return out.indexOf(null) >= 0 ? null : out.join('、');
    }]
  ]);

  const COMPILED = RULES.map(([src, fn]) => [rx(src), fn]);
  function clause(s) { return first(COMPILED, s); }

  /* a sentence's full stop is read off and given back as 。; a paragraph goes a sentence at a time, every sentence or
     none (the engine's own split, so a name at the end of a template never swallows the sentence after it) */
  const BREAK = /(?<!(?:^|[\s(])(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)\.)(?<=[.!?])\s+(?=[A-Z0-9“"‘'(+−])/;
  const END = /[.?]$/;
  const fin = (out, mark) => (out == null ? null : out + (mark && !/[。！？]$/.test(out) ? (mark === '?' ? '？' : '。') : ''));
  const sentence = s => { const e = END.exec(s); return fin(clause(e ? s.slice(0, -1) : s), e && e[0]); };
  /* ...but a break after an abbreviation in a name ("C.B. Al-Qazeres Extremadura", "Pol. Maloste") is no break: a piece
     that ends in one and does not translate on its own runs on into the next, as the one sentence it was */
  const ABBR = /(?:^|[\s(])(?:(?:[A-Z]\.){2,}|[A-Z][A-Za-z]{0,3}\.)$/;
  const pieces = s => {
    const ps = String(s).split(BREAK), out = [];
    for (let i = 0; i < ps.length; i++) {
      let p = ps[i];
      while (i + 1 < ps.length && ABBR.test(p) && clause(p.slice(0, -1)) == null) p += ' ' + ps[++i];
      out.push(p);
    }
    return out;
  };
  const paragraph = s => {
    const out = [];
    for (const p of pieces(s)) { const t = sentence(p); if (t == null) return null; out.push(t); }
    return out.join('');
  };
  /* a line the page joins with " · " (a club's place, record and run; the heads a piece covers; a game's reasons) goes a
     part at a time, each part the newsdesk's own or the engine's whole translation (a part with no letters, a time
     "19:30", needs no words): no template ever reads across one */
  const SEP = ' · ';
  /* ...except a template that is itself such a line (the award races' number and measure) */
  const LINES = COMPILED.filter((r, i) => RULES[i][0].indexOf(SEP) >= 0);
  const whole = s => {
    if (String(s).indexOf(SEP) < 0) return paragraph(s);
    const own = first(LINES, s);
    if (own != null) return own;
    const out = String(s).split(SEP).map(p => { const t = paragraph(p); return t != null ? t : !/[A-Za-z]/.test(p) ? p : ENG ? ENG(p) : null; });
    return out.indexOf(null) >= 0 ? null : out.join(SEP);
  };
  /* the engine's Q, for a head inside a sentence (a match report's headline is the report pack's) */
  const withQ = (Q, f) => { const was = ENG; ENG = Q; try { return f(); } finally { ENG = was; } };
  const one = (re, fn, src) => (m, T, Q) => {
    if (pieces(m[0]).length > 1 || (m[0].indexOf(SEP) >= 0 && src.indexOf(SEP) < 0)) return null;
    const e = END.exec(m[0]);
    const k = re.exec(e ? m[0].slice(0, -1) : m[0]);
    return k ? withQ(Q, () => fin(fn(...k.slice(1)), e && e[0])) : null;
  };

  I.register('ja', {
    /* the newsroom's kickers, everywhere: the news page prints a piece's kicker in its byline, outside the newsdesk's
       context ("League · 8 Oct · Under the microscope"); and the news page's word for a piece that is gone */
    phrases: {
      'Games to watch': '注目カード',
      'Under the microscope': '徹底検証',
      'The MVP race': 'MVPレース',
      'What makes them tick': '強さの源泉',
      'The problem': '課題',
      'Inside the run': '連勝の内幕',
      'Inside the slide': '連敗の内幕',
      'Lineup lab': 'ラインナップ分析',
      'The shot clock': 'ショットクロック',
      'The missing piece': '欠けたピース',
      'That piece is no longer on the newsdesk.': 'この記事はニュースデスクに掲載されていません。'
    },

    ctx: {
      /* the fixed words around the sentences: the figures' labels, the plan's items, the site's reasons for a game */
      newsdesk: {
        'The race': '首位争い',
        'Upset': '番狂わせ',
        'the biggest win': '最大点差の勝利',
        'the most points': '最多得点',
        'the most threes': '最多3P成功',
        'BPM': 'BPM',
        'adjusted net': '調整NETRTG',
        'against': '平均失点',
        'age': '年齢',
        'aggregate': '合計スコア',
        'assists': 'アシスト',
        'average margin': '平均得失点差',
        'ballots': '投票数',
        'before': 'それ以前',
        'clubs within a game and a half': '1.5ゲーム差以内のクラブ',
        'expected wins': '期待勝利数',
        'games left': '残り試合',
        'games missed': '欠場試合数',
        'home court': 'ホームコート',
        'in games decided by five or fewer': '5点差以内の試合',
        'in the run': '期間中',
        'last five': '直近5試合',
        'leader': '首位',
        'leaders, adjusted net': '首位クラブの調整NETRTG',
        'leader’s last five': '首位クラブの直近5試合',
        'margin in the run': '期間中の平均点差',
        'minutes before': 'それ以前の出場時間',
        'minutes': '出場時間',
        'next best': '2番手',
        'next': '2位',
        'opponents, adjusted net': '対戦相手の調整NETRTG',
        'place': '順位',
        'points before': 'それ以前の得点',
        'points for, a game': '平均得点',
        'points': '得点',
        'rebounds': 'リバウンド',
        'record without': '不在時の成績',
        'record': '成績',
        'regular season': 'レギュラーシーズン',
        'run': '連続記録',
        'season high': 'シーズンハイ',
        'season': 'シーズン',
        'seeds': 'シード',
        'series': 'シリーズ',
        'share of the club’s points in the run': '期間中のチーム得点に占める割合',
        'share': '得票率',
        'shooting': 'シュート',
        'the turnover battle': 'ターンオーバーの攻防',
        'the offensive glass': 'オフェンスリバウンド',
        'getting to the line': 'フリースローの獲得',
        'the game': '試合',
        'the highlights': 'ハイライト',
        'the edge': '優位',
        'the two games': '2試合のスコア',
        'their adjusted net': '自クラブの調整NETRTG',
        'what decided it': '勝負を分けた要素',
        'what decided the second': '2試合目を分けた要素',
        'what made it stand out': '注目点',
        'a full preview the day before': '前日のフルプレビュー',
        'a live thread': 'ライブ速報',
        'a series preview the day before': '前日のシリーズプレビュー',
        'a short preview': '短いプレビュー',
        'the recap': '試合レポート',
        'the recap and the numbers that decided it': '試合レポートと勝負を分けた数字',
        'the recap if it surprises': '番狂わせなら試合レポート',
        'the recap, and where the series stands': '試合レポートとシリーズの現状',
        'Overtime': '延長戦',
        'Double overtime': '2度の延長戦',
        'Playoff game': 'プレーオフの試合',
        'Playoff tie': 'プレーオフの対戦',
        'Playoff final': 'プレーオフ決勝',
        'Playoff semi-final': 'プレーオフ準決勝',
        'Playoff quarter-final': 'プレーオフ準々決勝',
        'Final': '決勝',
        'Semi-final': '準決勝',
        'Quarter-final': '準々決勝',
        'Knockout tie': 'トーナメントの対戦',
        'Cup final': 'カップ戦決勝',
        'Cup semi-final': 'カップ戦準決勝',
        'Cup quarter-final': 'カップ戦準々決勝',
        'Cup tie': 'カップ戦の対戦'
      }
    },

    /* one per template (the full stop or question mark is read off, then the template is matched without it), and last
       the composite: a paragraph a sentence at a time, a " · " line a part at a time */
    ctxPatterns: {
      newsdesk: COMPILED.map(([re, fn], i) => [rx(RULES[i][0], '[.?]?'), one(re, fn, RULES[i][0])])
        .concat([[/^[\s\S]*[A-Za-z][\s\S]*$/, (m, T, Q) => withQ(Q, () => whole(m[0]))]])
    },
    sentences: ['newsdesk']
  }, 'newsdesk');
})();
