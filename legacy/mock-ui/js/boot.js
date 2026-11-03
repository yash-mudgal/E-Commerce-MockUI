/* ShopMint demo — boot: chart defaults, then start the router once every module has registered its routes. */
(function (A) {
  'use strict';
  if (window.Chart) {
    var d = window.Chart.defaults;
    d.font.family = getComputedStyle(document.body).fontFamily;
    d.font.size = 12;
    d.color = '#64748b';
    d.borderColor = '#eef0f5';
    d.maintainAspectRatio = false;
    d.plugins.legend.labels.boxWidth = 10;
    d.plugins.legend.labels.boxHeight = 10;
    d.plugins.tooltip.padding = 10;
    d.plugins.tooltip.cornerRadius = 8;
    d.animation = { duration: 350 };
  }
  A.router.start();
})(window.App);
