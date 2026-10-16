'use strict';
/* The "manager" pack, Español. Keys are the English on screen; every language carries the same keys
   (supabase/tests/i18n.test.mjs). No other site is named in these files. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;
  I.register('es', {
    phrases: {
      'Manager mode is for members': 'El modo Manager es para socios',
      'Draft a squad from the players of every league on EPINOIA within your budget, set your lineups and tactics, and play the real clubs on the real calendar. Every game is simulated from the players’ own numbers.': 'Forma una plantilla con jugadores de todas las ligas de EPINOIA dentro de tu presupuesto, define tus quintetos y tu táctica, y juega contra los clubes reales en el calendario real. Cada partido se simula con los números de los propios jugadores.',
      'See the leaderboards': 'Ver las clasificaciones',
      'Manager pass': 'Pase Manager',
      'EPINOIA Manager: every league, every season': 'EPINOIA Manager: todas las ligas, todas las temporadas'
    },
    /* the paid door (0279): the price and the tier's name pass through */
    patterns: [
      [/^Play for ([£€$][\d.,]+) a month$/, m => 'Jugar por ' + m[1] + ' al mes'],
      [/^Play for ([£€$][\d.,]+) a year$/, m => 'Jugar por ' + m[1] + ' al año'],
      [/^Also included in (.+) membership\.$/, m => 'También incluido en el plan de socio ' + m[1] + '.']
    ]
  }, 'manager');
})();
