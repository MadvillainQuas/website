'use strict';
/* The "manager" pack, 日本語. Keys are the English on screen; every language carries the same keys
   (supabase/tests/i18n.test.mjs). No other site is named in these files. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;
  I.register('ja', {
    phrases: {
      'Manager mode is for members': 'マネージャーモードは会員向けです',
      'Draft a squad from the players of every league on EPINOIA within your budget, set your lineups and tactics, and play the real clubs on the real calendar. Every game is simulated from the players’ own numbers.': 'EPINOIAの全リーグの選手から予算内でチームを編成し、ラインナップと戦術を決めて、実在のクラブと実際の日程で戦います。すべての試合は選手自身の数値からシミュレートされます。',
      'See the leaderboards': 'ランキングを見る',
      'Manager pass': 'マネージャーパス',
      'EPINOIA Manager: every league, every season': 'EPINOIA Manager：全リーグ、全シーズン'
    },
    /* the paid door (0279): the price and the tier's name pass through */
    patterns: [
      [/^Play for ([£€$][\d.,]+) a month$/, m => '月額' + m[1] + 'でプレイ'],
      [/^Play for ([£€$][\d.,]+) a year$/, m => '年額' + m[1] + 'でプレイ'],
      [/^Also included in (.+) membership\.$/, m => m[1] + '会員プランにも含まれています。']
    ]
  }, 'manager');
})();
