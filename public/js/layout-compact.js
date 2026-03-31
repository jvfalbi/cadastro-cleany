/**
 * Ativa html.layout-compact para menu gaveta em viewports largos com toque
 * (ex.: iPhone em “site para computador”). Em telas estreitas o CSS já trata via @media.
 * Arquivo externo: compatível com Content-Security-Policy sem 'unsafe-inline'.
 */
(function () {
  function syncLayoutCompact() {
    var w = document.documentElement.clientWidth || window.innerWidth || 0;
    var touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
    var narrow = w <= 1024;
    var compact = narrow || (touch && w <= 1200);
    document.documentElement.classList.toggle('layout-compact', compact);
  }
  syncLayoutCompact();
  window.addEventListener('resize', syncLayoutCompact, { passive: true });
  window.addEventListener('orientationchange', function () {
    setTimeout(syncLayoutCompact, 250);
  });
})();
