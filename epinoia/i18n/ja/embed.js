'use strict';
/* 日本語: the embeds (the fixture strip, the box score, the table and leaders, the shop, the
   notification window) and the gallery where a club copies them. A widget on another site speaks
   Japanese when its snippet carries data-lang="ja". Keys are the English on screen;
   es/embed.js carries the same keys. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;
  I.register('ja', {
    phrases: {
      /* ---- the gallery ---- */
      'Four widgets any site can carry — a club\'s own page, a local paper, a school newsletter. One line each, no account, no key to manage. They update themselves, and a light theme is there for sites that are not dark. Copy a snippet and paste it where you want the widget to appear.': '4つのウィジェットは、クラブの公式ページ、地元の新聞、学校のお便りなど、どんなサイトにも載せられます。それぞれ1行で、アカウントも管理するキーも不要。自動で更新され、暗くないサイト向けにライトテーマもあります。スニペットをコピーして、ウィジェットを表示したい場所に貼り付けてください。',
      'theme': 'テーマ',
      'accent': 'アクセント',
      'second': '第2色',
      'reset colours': '色をリセット',
      'Fixture strip': '日程バー',
      'Live games first, then what is coming, then what has finished. Refreshes itself every minute. Best across the full width of a page.': '試合中の試合を先頭に、これからの試合、終わった試合の順。1分ごとに自動更新。ページの全幅で使うのがおすすめです。',
      'copy': 'コピー',
      'select and copy': '選択してコピーしてください',
      'One game: teams, score, clock, date, venue, the quarter breakdown and the leading scorer each side. Goes live on its own during a game.': '1試合分: チーム、スコア、時計、日付、会場、クォーターごとの得点、両チームの最多得点者。試合中は自動でライブになります。',
      'standings': '順位表',
      'The table as it stands, top to bottom, linking through to the full league page.': '現在の順位表を上から下まで。リーグの全体ページへのリンク付き。',
      'Any of points, rebounds, assists, steals, blocks, true shooting, effective field goal or minutes per game. Two-game minimum, so one big night does not top a season.': '得点、リバウンド、アシスト、スティール、ブロック、シュート効率（TS%）、有効シュート率（EFG%）、出場時間の1試合平均から選べます。最低2試合なので、1試合の大活躍だけでシーズンのトップにはなりません。',
      'effective FG': '有効シュート率（EFG%）',
      'Notification button': '通知ボタン',
      'A button for any page of your own website: on a club page it follows that club (on a player page, that player; on a match page, that game — the console makes those). Visitors need no Epinoia account: the button opens a small Epinoia window where they allow notifications, and reminders, lineups, half-time and full-time scores arrive on their phone.': 'あなたのサイトのどのページにも置けるボタン。クラブのページならそのクラブをフォローします（選手のページならその選手、試合のページならその試合。これらは管理画面で作れます）。訪問者にEpinoiaのアカウントは不要で、ボタンを押すと小さなEpinoiaのウィンドウが開き、そこで通知を許可すると、リマインダー、スターティングメンバー、ハーフタイムと試合終了のスコアがスマホに届きます。',
      'for': '対象',
      'one club': '1つのクラブ',
      'visitors pick clubs': '訪問者がクラブを選ぶ',
      'Widgets are iframes: your stylesheet and ours cannot reach each other.': 'ウィジェットはiframeなので、あなたのサイトのスタイルシートとEpinoiaのものは互いに影響しません。',
      'A widget speaks English unless its snippet says otherwise: data-lang="ja" for Japanese, data-lang="es" for Spanish.': 'スニペットで指定しない限り、ウィジェットは英語で表示されます。日本語は data-lang="ja"、スペイン語は data-lang="es"。',
      'no leagues yet': 'リーグはまだありません',

      /* ---- the fixture strip ---- */
      'Loading fixtures': '試合を読み込み中',
      'scroll right': '右へスクロール',
      'Fixture': '試合',
      'in progress': '試合中',
      'watch ↗': '見る ↗',
      'lineups ↗': 'スタメン ↗',
      'preview ↗': '見どころ ↗',
      'Fixtures unavailable': '試合情報を取得できません',
      'No fixtures': '試合はありません',
      'fixtures, table and statistics': '日程・結果、順位表、成績',

      /* ---- the box score ---- */
      'full box score ↗': 'ボックススコアを見る ↗',
      'date TBC': '日程未定',
      'TOT': '計',
      'No game specified': '試合が指定されていません',
      'Game not found': '試合が見つかりません',
      'Could not load this game': 'この試合を読み込めませんでした',

      /* ---- the table and the leaders ---- */
      'full table ↗': '全体を見る ↗',
      'No competition yet': '大会はまだありません',
      'No games played yet': 'まだ試合が行われていません',
      'No statistics yet': '成績はまだありません',

      /* ---- the shop ---- */
      'Shop': 'ショップ',
      'more ↗': 'もっと見る ↗',
      'No such league.': 'そのリーグはありません。',
      'Nothing in the shop yet. Products appear here as soon as the league publishes them.': 'ショップにはまだ何もありません。リーグが公開するとすぐに商品がここに表示されます。',
      'Could not load the shop.': 'ショップを読み込めませんでした。',
      'switch to dark': 'ダークに切り替え',
      'switch to light': 'ライトに切り替え',

      /* ---- the notification window ---- */
      'Stop notifications': '通知を停止',
      'Close this window': 'このウィンドウを閉じる',
      'No account needed. Epinoia keeps this browser’s push address and what it follows, and nothing about you; turning notifications off deletes it.': 'アカウントは不要です。Epinoiaが保存するのはこのブラウザのプッシュ用アドレスとフォロー内容だけで、あなたについての情報は何も保存しません。通知をオフにすると削除されます。',
      'Half-time': 'ハーフタイム',
      'Full-time result': '試合結果',
      'Player lines at half-time and full time': 'ハーフタイムと試合終了時の選手成績',
      'League news': 'リーグのお知らせ',
      'Choose the clubs you want to hear about. Reminders, lineups and scores arrive on this device.': '通知を受け取りたいクラブを選んでください。リマインダー、スターティングメンバー、スコアがこの端末に届きます。',
      'Notifications are off. You can close this window.': '通知はオフです。このウィンドウは閉じて構いません。',
      'That could not be saved just now. Try again in a minute.': '今は保存できませんでした。1分後にもう一度お試しください。',
      'Notifications are blocked for Epinoia in this browser’s settings. Allow them there, then try again.': 'このブラウザの設定でEpinoiaの通知がブロックされています。設定で許可してから、もう一度お試しください。',
      'Notifications are blocked for Epinoia in this browser’s settings. Allow them there, then reload this window.': 'このブラウザの設定でEpinoiaの通知がブロックされています。設定で許可してから、このウィンドウを再読み込みしてください。',
      'This browser cannot receive notifications.': 'このブラウザでは通知を受け取れません。',
      'This browser cannot receive notifications. On a phone, use Chrome, Samsung Internet or Firefox.': 'このブラウザでは通知を受け取れません。スマホではChrome、Samsung Internet、Firefoxを使ってください。',
      'Notifications were not allowed. Try again and choose Allow when the browser asks.': '通知が許可されませんでした。もう一度試して、ブラウザに聞かれたら「許可」を選んでください。',
      'Notifications are on.': '通知はオンです。',
      'Notifications are on. You can close this window.': '通知はオンです。このウィンドウは閉じて構いません。',
      'Notifications could not be turned on just now. Try again in a minute.': '今は通知をオンにできませんでした。1分後にもう一度お試しください。',
      'A test was sent a moment ago. Try again in a minute.': 'テストは少し前に送信しました。1分後にもう一度お試しください。',
      'A test is on its way': 'テストを送信中',
      'The test reached this device.': 'テストがこの端末に届きました。',
      'The test reached this device but was not allowed to show: check this browser’s notification settings.': 'テストはこの端末に届きましたが、表示が許可されていません。このブラウザの通知設定を確認してください。',
      'The test has not arrived yet. It can take up to a minute.': 'テストはまだ届いていません。最大1分かかることがあります。',
      'The test could not be sent just now.': '今はテストを送信できませんでした。',
      'This link does not name a league.': 'このリンクにはリーグが指定されていません。',
      'This link names something Epinoia does not know.': 'このリンクの指定先はEpinoiaにありません。'
    },

    ctx: {
      status: {
        'FT': 'FINAL',
        'LINEUPS IN': 'スタメン発表'
      },
      standings: {
        'CONF': '地区',
        'OVR': '通算',
        'PCT': '勝率'
      }
    },

    units: {
      'item': '{n}点',
      'items': '{n}点'
    },

    patterns: [
      [/^Epinoia (box score|fixtures|table|standings|leaders|shop)$/, (m, T, Q) => { const x = Q(m[1]); return x == null ? null : 'Epinoia ' + x; }],
      [/^(PPG|RPG|APG|SPG|BPG|TS%|eFG%|MPG) leaders$/, m => ({ PPG: '得点', RPG: 'リバウンド', APG: 'アシスト', SPG: 'スティール', BPG: 'ブロック', 'TS%': 'TS%', 'eFG%': 'EFG%', MPG: '出場時間' })[m[1]] + 'ランキング'],
      [/^Notifications for (.+)$/, (m, T) => T(m[1]) + 'の通知'],
      [/^Notifications from (.+)$/, (m, T) => T(m[1]) + 'からの通知'],
      [/^Stop notifications for (.+)$/, (m, T) => T(m[1]) + 'の通知を停止'],
      [/^Tip-off reminders, lineups, the half-time and full-time scores and league news for (.+), on this device\.$/,
      (m, T) => 'この端末で、' + T(m[1]) + 'の試合開始前のリマインダー、スターティングメンバー、ハーフタイムと試合終了のスコア、リーグのお知らせを受け取れます。'],
      [/^Reminders before (.+) plays, whether they start, and their line at half-time and full time, on this device\.$/,
      (m, T) => 'この端末で、' + T(m[1]) + 'の試合前のリマインダー、先発かどうか、ハーフタイムと試合終了時の成績を受け取れます。'],
      [/^The reminders, the lineups, and the half-time and final score of (.+), on this device\.$/,
      (m, T) => 'この端末で、' + T(m[1]) + 'のリマインダー、スターティングメンバー、ハーフタイムと最終スコアを受け取れます。'],
      [/^On iPhone and iPad, notifications from a website need it on your Home Screen\. Open prophesyscouting\.co\.uk\/epinoia in Safari, tap Share, then Add to Home Screen, and follow (.+) from there\.$/,
      (m, T) => 'iPhoneとiPadでは、Webサイトからの通知を受け取るにはホーム画面への追加が必要です。Safariでprophesyscouting.co.uk/epinoiaを開き、共有 → ホーム画面に追加をタップしてから、そこで' + T(m[1]) + 'をフォローしてください。']
    ]
  }, 'embed');
})();
