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

  /* dates, as dayWords() writes them in en-GB: "Wednesday 2 December", "23 October", "Saturday" */
  const DAY = { sunday: '日曜日', monday: '月曜日', tuesday: '火曜日', wednesday: '水曜日', thursday: '木曜日', friday: '金曜日', saturday: '土曜日' };
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const WDAYS = Object.keys(DAY).join('|');
  const DAYSRC = '(?:' + WDAYS + '),? \\d{1,2} (?:' + MONTHS.join('|') + ')';
  const date = s => {
    const t = String(s).trim();
    let m = /^(\w+),? (\d{1,2}) (\w+)$/.exec(t);
    if (m && DAY[m[1].toLowerCase()] && MONTHS.indexOf(m[3].toLowerCase()) >= 0) return (MONTHS.indexOf(m[3].toLowerCase()) + 1) + '月' + m[2] + '日(' + DAY[m[1].toLowerCase()].charAt(0) + ')';
    m = /^(\d{1,2}) (\w+)$/.exec(t);
    if (m && MONTHS.indexOf(m[2].toLowerCase()) >= 0) return (MONTHS.indexOf(m[2].toLowerCase()) + 1) + '月' + m[1] + '日';
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

  /* {X} a name, {D} a count, {F} a figure, {G} a signed figure (+12.7, −3.5), {W} a count in words, {S} a score or a
     record (88–86, 5–1), {K} a place (third, 11th), {O} a short ordinal (3rd, its number captured), {Y} a day
     ("Wednesday 2 December"), {M} a date ("23 October"), {V} a weekday, {A} games behind, {L} a newsdesk facet, {B} a
     match report facet, {E} a leg of a tie */
  const TOK = {
    X: '([^,;:—]+?)', D: '(\\d+)', F: '(\\d+(?:\\.\\d+)?)', G: '([+−-]?\\d+(?:\\.\\d+)?)', W: '(' + WORDS + ')',
    S: '(\\d+)[–-](\\d+)', K: '(' + Object.keys(PLACE).join('|') + '|\\d+(?:st|nd|rd|th))', O: '(\\d+)(?:st|nd|rd|th)',
    Y: '(' + DAYSRC + ')', M: '(\\d{1,2} (?:' + MONTHS.join('|') + '))', V: '(' + WDAYS + ')', A: '(' + GAMES + ')',
    L: '(' + alt(FACET) + ')', B: '(' + alt(FAC) + ')', E: '(' + LEGS + ')'
  };
  const rx = (src, end) => new RegExp('^(?:' + src.replace(/\{([A-Z])\}/g, (m, k) => TOK[k]) + ')' + (end || '') + '$', 'i');
  const lit = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = (list, s) => { for (const [re, fn] of list) { const m = re.exec(s); if (m) { const o = fn(...m.slice(1)); if (o != null) return o; } } return null; };

  /* the next game, three ways (nextText, whenNext, nextToTry): "Birch City visit on Wednesday 2 December", "away at Ash
     City on ...", "when Birch City visit on ...", "Shiga Lakes, who visit on ..." / ", at home on ..." */
  const NEXT = [
    [new RegExp('^away at (.+?) on (' + DAYSRC + ')$', 'i'), (o, d) => ({ opp: o, home: false, day: date(d) })],
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

  /* ------------------------------------------------------------- templates --- */
  /* [source, (...captures) => Japanese | null], most specific first */
  const RULES = Object.keys(FIXED).map(k => [lit(k), () => FIXED[k]]).concat([
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
  const paragraph = s => {
    const out = [];
    for (const p of String(s).split(BREAK)) { const t = sentence(p); if (t == null) return null; out.push(t); }
    return out.join('');
  };
  /* a line the page joins with " · " (a club's place, record and run; the heads a piece covers; a game's reasons) goes a
     part at a time, each part the newsdesk's own or the engine's whole translation: no template ever reads across one */
  const SEP = ' · ';
  /* ...except a template that is itself such a line (the award races' number and measure) */
  const LINES = COMPILED.filter((r, i) => RULES[i][0].indexOf(SEP) >= 0);
  const whole = s => {
    if (String(s).indexOf(SEP) < 0) return paragraph(s);
    const own = first(LINES, s);
    if (own != null) return own;
    const out = String(s).split(SEP).map(p => { const t = paragraph(p); return t != null ? t : ENG ? ENG(p) : null; });
    return out.indexOf(null) >= 0 ? null : out.join(SEP);
  };
  /* the engine's Q, for a head inside a sentence (a match report's headline is the report pack's) */
  const withQ = (Q, f) => { const was = ENG; ENG = Q; try { return f(); } finally { ENG = was; } };
  const one = (re, fn, src) => (m, T, Q) => {
    if (BREAK.test(m[0]) || (m[0].indexOf(SEP) >= 0 && src.indexOf(SEP) < 0)) return null;
    const e = END.exec(m[0]);
    const k = re.exec(e ? m[0].slice(0, -1) : m[0]);
    return k ? withQ(Q, () => fin(fn(...k.slice(1)), e && e[0])) : null;
  };

  I.register('ja', {
    phrases: {
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
        'the numbers say it turns on': '数字が示す勝負所',
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
