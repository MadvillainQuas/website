'use strict';
/* THE CONTACT PAGE MOVED (2026-10-06): the form is now the Contact tab of the learn page (learn/?t=contact), with "Contact / learn more"
   in the rail. An old link, a bookmark or a ?topic=api|privacy from another page lands there with its topic kept. */
(function () {
  const q = new URLSearchParams(location.search);
  const to = new URL('../learn/', location.href);
  to.searchParams.set('t', 'contact');
  const topic = q.get('topic');
  if (topic) to.searchParams.set('topic', topic);
  to.hash = 'contact';
  location.replace(to.href);
}());
