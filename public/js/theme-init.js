// Runs before first paint so the page never flashes the wrong theme.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('spark:settings') || '{}');
    if (s.theme === 'light' || s.theme === 'dark') document.documentElement.setAttribute('data-theme', s.theme);
  } catch (e) {}
})();
