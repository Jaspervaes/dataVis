/**
 * theme-toggle.js
 * Manages the light/dark mode state for The Roots of Rhythm.
 * Persistence via localStorage.
 */

(function() {
  const THEME_KEY = 'ror-theme-preference';
  const LIGHT_MODE = 'light-mode';

  // Apply preference immediately to prevent flash
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === LIGHT_MODE) {
    document.documentElement.classList.add(LIGHT_MODE);
  }

  function toggleTheme() {
    const isLight = document.documentElement.classList.toggle(LIGHT_MODE);
    localStorage.setItem(THEME_KEY, isLight ? LIGHT_MODE : 'dark-mode');
    
    // Dispatch event for any other components that need to know (like D3 charts)
    window.dispatchEvent(new CustomEvent('themechanged', { detail: { theme: isLight ? 'light' : 'dark' } }));
  }

  // Wait for DOM to attach listener to button
  document.addEventListener('DOMContentLoaded', () => {
    const toggleBtns = document.querySelectorAll('.theme-toggle');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', toggleTheme);
    });
  });

  // Expose toggle globally just in case
  window.toggleTheme = toggleTheme;
})();
