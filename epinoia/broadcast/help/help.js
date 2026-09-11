'use strict';
/* the way back to the control room keeps the game it came from */
(function () {
  var g = new URLSearchParams(location.search).get('g');
  var a = document.getElementById('backToControl');
  if (g && a) a.href = '../control/?g=' + encodeURIComponent(g);
})();
