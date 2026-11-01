// Apply before loading CSS so a saved dark theme never flashes a light page.
(() => {
  'use strict';
  const key = 'nexo.theme';
  const valid = (value) => ['light', 'dark', 'system'].includes(value);
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';

  function readPreference() {
    try {
      const saved = localStorage.getItem(key);
      return valid(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161618' : '#f6f7f5');
    const select = document.querySelector('#theme-select');
    if (select) select.value = preference;
    document.querySelector('#theme-icon use')?.setAttribute('href', `/icons.svg#${{ light: 'sun', dark: 'moon', system: 'monitor' }[preference]}`);
  }

  preference = readPreference();
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelector('#theme-select')?.addEventListener('change', (event) => {
      if (!valid(event.target.value)) return;
      preference = event.target.value;
      // Browsers may block storage; switching still works for this page.
      try { localStorage.setItem(key, preference); } catch { /* Keep the in-memory preference. */ }
      apply();
    });
  });
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) { preference = readPreference(); apply(); }
  });
})();
