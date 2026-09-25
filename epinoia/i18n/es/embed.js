'use strict';
/* Español: the embeds (the fixture strip, the box score, the table and leaders, the shop, the
   notification window) and the gallery where a club copies them. A widget on another site speaks
   Spanish when its snippet carries data-lang="es". Keys are the English on screen;
   ja/embed.js carries the same keys. */
(function () {
  const I = window.EpinoiaI18n;
  if (!I) return;
  I.register('es', {
    phrases: {
      /* ---- the gallery ---- */
      'Four widgets any site can carry — a club\'s own page, a local paper, a school newsletter. One line each, no account, no key to manage. They update themselves, and a light theme is there for sites that are not dark. Copy a snippet and paste it where you want the widget to appear.': 'Cuatro widgets que cualquier web puede llevar: la página de un club, un periódico local, el boletín de un colegio. Una línea cada uno, sin cuenta y sin claves que gestionar. Se actualizan solos, y hay un tema claro para las webs que no son oscuras. Copia un fragmento y pégalo donde quieras que aparezca el widget.',
      'theme': 'Tema',
      'accent': 'Acento',
      'second': 'Secundario',
      'reset colours': 'Restablecer colores',
      'Fixture strip': 'Tira de partidos',
      'Live games first, then what is coming, then what has finished. Refreshes itself every minute. Best across the full width of a page.': 'Primero los partidos en directo, luego los próximos y después los terminados. Se actualiza solo cada minuto. Queda mejor a todo el ancho de la página.',
      'copy': 'Copiar',
      'select and copy': 'selecciona y copia',
      'One game: teams, score, clock, date, venue, the quarter breakdown and the leading scorer each side. Goes live on its own during a game.': 'Un partido: equipos, marcador, reloj, fecha, pabellón, los parciales y el máximo anotador de cada equipo. Pasa a directo solo durante el partido.',
      'standings': 'Clasificación',
      'The table as it stands, top to bottom, linking through to the full league page.': 'La clasificación tal como está, de arriba abajo, con enlace a la página completa de la liga.',
      'Any of points, rebounds, assists, steals, blocks, true shooting, effective field goal or minutes per game. Two-game minimum, so one big night does not top a season.': 'Puntos, rebotes, asistencias, recuperaciones, tapones, tiro verdadero, tiro de campo efectivo o minutos por partido. Mínimo de dos partidos, para que una gran noche no encabece una temporada.',
      'effective FG': 'Tiro de campo efectivo (eFG%)',
      'Notification button': 'Botón de notificaciones',
      'A button for any page of your own website: on a club page it follows that club (on a player page, that player; on a match page, that game — the console makes those). Visitors need no Epinoia account: the button opens a small Epinoia window where they allow notifications, and reminders, lineups, half-time and full-time scores arrive on their phone.': 'Un botón para cualquier página de tu propia web: en la página de un club sigue a ese club (en la de un jugador, a ese jugador; en la de un partido, a ese partido; eso se hace desde la consola). Los visitantes no necesitan cuenta de Epinoia: el botón abre una pequeña ventana de Epinoia donde permiten las notificaciones, y los recordatorios, los quintetos y los marcadores al descanso y al final les llegan al móvil.',
      'for': 'Para',
      'one club': 'un club',
      'visitors pick clubs': 'los visitantes eligen clubes',
      'Widgets are iframes: your stylesheet and ours cannot reach each other.': 'Los widgets son iframes: tu hoja de estilos y la nuestra no se afectan entre sí.',
      'A widget speaks English unless its snippet says otherwise: data-lang="ja" for Japanese, data-lang="es" for Spanish.': 'Un widget sale en inglés salvo que el fragmento diga otra cosa: data-lang="ja" para japonés, data-lang="es" para español.',
      'no leagues yet': 'todavía no hay ligas',

      /* ---- the fixture strip ---- */
      'Loading fixtures': 'Cargando partidos',
      'scroll right': 'desplazar a la derecha',
      'Fixture': 'Partido',
      'in progress': 'en juego',
      'watch ↗': 'ver ↗',
      'lineups ↗': 'quintetos ↗',
      'preview ↗': 'previa ↗',
      'Fixtures unavailable': 'Partidos no disponibles',
      'No fixtures': 'No hay partidos',
      'fixtures, table and statistics': 'calendario, clasificación y estadísticas',

      /* ---- the box score ---- */
      'full box score ↗': 'Estadísticas completas ↗',
      'date TBC': 'Fecha por confirmar',
      'TOT': 'Total',
      'No game specified': 'No se ha indicado ningún partido',
      'Game not found': 'Partido no encontrado',
      'Could not load this game': 'No se pudo cargar este partido',

      /* ---- the table and the leaders ---- */
      'full table ↗': 'Ver completo ↗',
      'No competition yet': 'Todavía no hay competición',
      'No games played yet': 'Todavía no se ha jugado ningún partido',
      'No statistics yet': 'Todavía no hay estadísticas',

      /* ---- the shop ---- */
      'Shop': 'Tienda',
      'more ↗': 'Más ↗',
      'No such league.': 'No existe esa liga.',
      'Nothing in the shop yet. Products appear here as soon as the league publishes them.': 'Todavía no hay nada en la tienda. Los productos aparecen aquí en cuanto la liga los publica.',
      'Could not load the shop.': 'No se pudo cargar la tienda.',
      'switch to dark': 'Cambiar a oscuro',
      'switch to light': 'Cambiar a claro',

      /* ---- the notification window ---- */
      'Stop notifications': 'Desactivar notificaciones',
      'Close this window': 'Cerrar esta ventana',
      'No account needed. Epinoia keeps this browser’s push address and what it follows, and nothing about you; turning notifications off deletes it.': 'No hace falta cuenta. Epinoia guarda la dirección push de este navegador y lo que sigue, y nada sobre ti; al desactivar las notificaciones se borra.',
      'Half-time': 'Descanso',
      'Full-time result': 'Resultado final',
      'Player lines at half-time and full time': 'Números de los jugadores al descanso y al final',
      'League news': 'Noticias de la liga',
      'Choose the clubs you want to hear about. Reminders, lineups and scores arrive on this device.': 'Elige los clubes de los que quieres saber. Los recordatorios, los quintetos y los marcadores llegan a este dispositivo.',
      'Notifications are off. You can close this window.': 'Las notificaciones están desactivadas. Puedes cerrar esta ventana.',
      'That could not be saved just now. Try again in a minute.': 'No se ha podido guardar ahora. Vuelve a intentarlo en un minuto.',
      'Notifications are blocked for Epinoia in this browser’s settings. Allow them there, then try again.': 'Las notificaciones de Epinoia están bloqueadas en los ajustes de este navegador. Permítelas ahí y vuelve a intentarlo.',
      'Notifications are blocked for Epinoia in this browser’s settings. Allow them there, then reload this window.': 'Las notificaciones de Epinoia están bloqueadas en los ajustes de este navegador. Permítelas ahí y vuelve a cargar esta ventana.',
      'This browser cannot receive notifications.': 'Este navegador no puede recibir notificaciones.',
      'This browser cannot receive notifications. On a phone, use Chrome, Samsung Internet or Firefox.': 'Este navegador no puede recibir notificaciones. En un móvil, usa Chrome, Samsung Internet o Firefox.',
      'Notifications were not allowed. Try again and choose Allow when the browser asks.': 'No se han permitido las notificaciones. Vuelve a intentarlo y elige Permitir cuando el navegador lo pregunte.',
      'Notifications are on.': 'Las notificaciones están activadas.',
      'Notifications are on. You can close this window.': 'Las notificaciones están activadas. Puedes cerrar esta ventana.',
      'Notifications could not be turned on just now. Try again in a minute.': 'No se han podido activar las notificaciones ahora. Vuelve a intentarlo en un minuto.',
      'A test was sent a moment ago. Try again in a minute.': 'Se ha enviado una prueba hace un momento. Vuelve a intentarlo en un minuto.',
      'A test is on its way': 'La prueba va de camino',
      'The test reached this device.': 'La prueba ha llegado a este dispositivo.',
      'The test reached this device but was not allowed to show: check this browser’s notification settings.': 'La prueba ha llegado a este dispositivo, pero no se ha podido mostrar: revisa los ajustes de notificaciones de este navegador.',
      'The test has not arrived yet. It can take up to a minute.': 'La prueba aún no ha llegado. Puede tardar hasta un minuto.',
      'The test could not be sent just now.': 'No se ha podido enviar la prueba ahora.',
      'This link does not name a league.': 'Este enlace no indica ninguna liga.',
      'This link names something Epinoia does not know.': 'Este enlace indica algo que Epinoia no conoce.'
    },

    ctx: {
      status: {
        'FT': 'Final',
        'LINEUPS IN': 'Quintetos confirmados'
      },
      standings: {
        'CONF': 'Conf.',
        'OVR': 'Total',
        'PCT': '% V'
      }
    },

    units: {
      'item': '{n} producto',
      'items': '{n} productos'
    },

    patterns: [
      [/^Epinoia (box score|fixtures|table|standings|leaders|shop)$/, (m, T, Q) => { const x = Q(m[1]); return x == null ? null : x.charAt(0).toUpperCase() + x.slice(1) + ' · Epinoia'; }],
      [/^(PPG|RPG|APG|SPG|BPG|TS%|eFG%|MPG) leaders$/, m => 'Líderes en ' + ({ PPG: 'puntos', RPG: 'rebotes', APG: 'asistencias', SPG: 'recuperaciones', BPG: 'tapones', 'TS%': 'TS%', 'eFG%': 'eFG%', MPG: 'minutos' })[m[1]]],
      [/^Notifications for (.+)$/, (m, T) => 'Notificaciones de ' + T(m[1])],
      [/^Notifications from (.+)$/, (m, T) => 'Notificaciones de ' + T(m[1])],
      [/^Stop notifications for (.+)$/, (m, T) => 'Desactivar las notificaciones de ' + T(m[1])],
      [/^Tip-off reminders, lineups, the half-time and full-time scores and league news for (.+), on this device\.$/,
      (m, T) => 'Recordatorios antes del salto inicial, quintetos, marcadores al descanso y al final y noticias de la liga de ' + T(m[1]) + ', en este dispositivo.'],
      [/^Reminders before (.+) plays, whether they start, and their line at half-time and full time, on this device\.$/,
      (m, T) => 'Recordatorios antes de que juegue ' + T(m[1]) + ', si sale de titular y sus números al descanso y al final, en este dispositivo.'],
      [/^The reminders, the lineups, and the half-time and final score of (.+), on this device\.$/,
      (m, T) => 'Los recordatorios, los quintetos y los marcadores al descanso y final de ' + T(m[1]) + ', en este dispositivo.'],
      [/^On iPhone and iPad, notifications from a website need it on your Home Screen\. Open prophesyscouting\.co\.uk\/epinoia in Safari, tap Share, then Add to Home Screen, and follow (.+) from there\.$/,
      (m, T) => 'En iPhone y iPad, las notificaciones de una web necesitan que esté en la pantalla de inicio. Abre prophesyscouting.co.uk/epinoia en Safari, toca Compartir y luego Añadir a pantalla de inicio, y sigue a ' + T(m[1]) + ' desde ahí.']
    ]
  }, 'embed');
})();
