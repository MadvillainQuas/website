'use strict';
/* MANAGER - the last script on the page: everything above it has loaded (deferred, in order), so the app starts */
(function (root) {
  const go = () => { if (root.Mgr && root.Mgr.app && root.Mgr.app.start) root.Mgr.app.start(); };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', go); else go();
})(typeof globalThis !== 'undefined' ? globalThis : self);
