(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EXIT_DELAY = 230;

  function enter() {
    document.documentElement.classList.add('page-transition-ready');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.add('page-transition-in');
        document.documentElement.classList.remove('page-transition-out');
      });
    });
  }

  function isInternalNavigation(link) {
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return false;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin && url.href !== window.location.href;
  }

  window.smoothNavigate = function smoothNavigate(url) {
    if (!url) return;
    if (reduceMotion) {
      window.location.href = url;
      return;
    }
    document.documentElement.classList.add('page-transition-out');
    document.documentElement.classList.remove('page-transition-in');
    window.setTimeout(() => { window.location.href = url; }, EXIT_DELAY);
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!isInternalNavigation(link)) return;
    event.preventDefault();
    window.smoothNavigate(link.href);
  }, { passive: false });

  window.addEventListener('pageshow', enter);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enter, { once: true });
  else enter();
})();
