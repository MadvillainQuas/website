'use strict';
/* The "newsdesk" pack, Español: the league newsdesk's storylines, briefing and coverage plan (epinoia/narrative.js, drawn
   by newsdesk.js in the 'newsdesk' sentence context). Keys are the English on screen; every language carries the same
   keys (supabase/tests/i18n.test.mjs). The sentences are translated whole, one anchored pattern per template
   (supabase/tests/newsdesk-i18n.test.mjs). Names pass through as the data has them. No other site is named in these
   files. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;

  I.register('es', {
    phrases: {
    },

    ctx: {
      /* the fixed words around the sentences: the figures' labels, the plan's items, the site's reasons for a game */
      newsdesk: {
        'The race': 'La carrera',
        'Upset': 'Sorpresa',
        'the biggest win': 'la victoria más amplia',
        'the most points': 'más puntos',
        'the most threes': 'más triples',
        'BPM': 'BPM',
        'adjusted net': 'neto ajustado',
        'against': 'en contra, por partido',
        'age': 'edad',
        'aggregate': 'global',
        'assists': 'asistencias',
        'average margin': 'diferencia media',
        'ballots': 'votos',
        'before': 'antes',
        'clubs within a game and a half': 'equipos a partido y medio o menos',
        'expected wins': 'victorias esperadas',
        'games left': 'partidos restantes',
        'games missed': 'partidos sin jugar',
        'home court': 'factor cancha',
        'in games decided by five or fewer': 'en partidos decididos por cinco o menos',
        'in the run': 'en la racha',
        'last five': 'últimos cinco',
        'leader': 'líder',
        'leaders, adjusted net': 'neto ajustado del líder',
        'leader’s last five': 'últimos cinco del líder',
        'margin in the run': 'diferencia media en la racha',
        'minutes before': 'minutos antes',
        'minutes': 'minutos',
        'next best': 'el siguiente',
        'next': 'segundo',
        'opponents, adjusted net': 'neto ajustado de los rivales',
        'place': 'puesto',
        'points before': 'puntos antes',
        'points for, a game': 'a favor, por partido',
        'points': 'puntos',
        'rebounds': 'rebotes',
        'record without': 'balance en su ausencia',
        'record': 'balance',
        'regular season': 'liga regular',
        'run': 'racha',
        'season high': 'máximo de la temporada',
        'season': 'temporada',
        'seeds': 'cabezas de serie',
        'series': 'serie',
        'share of the club’s points in the run': 'porcentaje de los puntos del equipo en la racha',
        'share': 'porcentaje',
        'shooting': 'el tiro',
        'the turnover battle': 'las pérdidas',
        'the offensive glass': 'el rebote ofensivo',
        'getting to the line': 'la llegada a la línea de tiros libres',
        'the game': 'el partido',
        'the highlights': 'el resumen',
        'the numbers say it turns on': 'según los números, se decide en',
        'the two games': 'los dos partidos',
        'their adjusted net': 'su neto ajustado',
        'what decided it': 'lo que lo decidió',
        'what decided the second': 'lo que decidió el segundo',
        'what made it stand out': 'lo más destacado',
        'a full preview the day before': 'una previa completa la víspera',
        'a live thread': 'un directo',
        'a series preview the day before': 'una previa de la serie la víspera',
        'a short preview': 'una previa breve',
        'the recap': 'la crónica',
        'the recap and the numbers that decided it': 'la crónica y los números que lo decidieron',
        'the recap if it surprises': 'la crónica si hay sorpresa',
        'the recap, and where the series stands': 'la crónica y cómo va la serie',
        'Overtime': 'Prórroga',
        'Double overtime': 'Doble prórroga',
        'Playoff game': 'Partido de playoff',
        'Playoff tie': 'Eliminatoria de playoff',
        'Playoff final': 'Final de playoff',
        'Playoff semi-final': 'Semifinal de playoff',
        'Playoff quarter-final': 'Cuartos de final de playoff',
        'Final': 'Final',
        'Semi-final': 'Semifinal',
        'Quarter-final': 'Cuartos de final',
        'Knockout tie': 'Eliminatoria',
        'Cup final': 'Final de copa',
        'Cup semi-final': 'Semifinal de copa',
        'Cup quarter-final': 'Cuartos de final de copa',
        'Cup tie': 'Eliminatoria de copa'
      }
    },

    ctxPatterns: {
      newsdesk: []
    },
    sentences: ['newsdesk']
  }, 'newsdesk');
})();
