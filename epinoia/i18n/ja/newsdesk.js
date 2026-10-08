'use strict';
/* The "newsdesk" pack, 日本語: the league newsdesk's storylines, briefing and coverage plan (epinoia/narrative.js, drawn by
   newsdesk.js in the 'newsdesk' sentence context). Keys are the English on screen; every language carries the same keys
   (supabase/tests/i18n.test.mjs). The sentences are translated whole, one anchored pattern per template
   (supabase/tests/newsdesk-i18n.test.mjs). Names pass through as the data has them. No other site is named in these
   files. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;

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
        'adjusted net': '補正ネットレーティング',
        'against': '平均失点',
        'age': '年齢',
        'aggregate': '合計スコア',
        'assists': 'アシスト',
        'average margin': '平均得失点差',
        'ballots': '投票数',
        'before': 'それ以前',
        'clubs within a game and a half': '1.5ゲーム差以内のチーム',
        'expected wins': '期待勝利数',
        'games left': '残り試合',
        'games missed': '欠場試合数',
        'home court': 'ホームコート',
        'in games decided by five or fewer': '5点差以内の試合',
        'in the run': '期間中',
        'last five': '直近5試合',
        'leader': '首位',
        'leaders, adjusted net': '首位チームの補正ネットレーティング',
        'leader’s last five': '首位チームの直近5試合',
        'margin in the run': '期間中の平均点差',
        'minutes before': 'それ以前の出場時間',
        'minutes': '出場時間',
        'next best': '2番手',
        'next': '2位',
        'opponents, adjusted net': '対戦相手の補正ネットレーティング',
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
        'their adjusted net': '自チームの補正ネットレーティング',
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
        'Knockout tie': 'ノックアウトの対戦',
        'Cup final': 'カップ戦決勝',
        'Cup semi-final': 'カップ戦準決勝',
        'Cup quarter-final': 'カップ戦準々決勝',
        'Cup tie': 'カップ戦の対戦'
      }
    },

    ctxPatterns: {
      newsdesk: []
    },
    sentences: ['newsdesk']
  }, 'newsdesk');
})();
