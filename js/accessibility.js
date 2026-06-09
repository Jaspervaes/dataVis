/**
 * accessibility.js
 * Manages color blindness profiles for The Roots of Rhythm.
 * Injects a floating accessibility widget and handles state.
 */

(function() {
  const ACCESSIBILITY_KEY = 'ror-color-blindness-profile';
  
  // Available profiles map to CSS classes defined in variables.css
  const PROFILES = [
    { id: 'default', label: 'Default Vision', class: '' },
    { id: 'protanopia', label: 'Protanopia (Red-Blind)', class: 'theme-protanopia' },
    { id: 'deuteranopia', label: 'Deuteranopia (Green-Blind)', class: 'theme-deuteranopia' },
    { id: 'tritanopia', label: 'Tritanopia (Blue-Blind)', class: 'theme-tritanopia' }
  ];

  // Apply preference immediately to prevent flash
  const savedProfileId = localStorage.getItem(ACCESSIBILITY_KEY) || 'default';
  applyProfile(savedProfileId);

  function applyProfile(profileId) {
    const root = document.documentElement;
    
    // Remove existing profile classes
    PROFILES.forEach(p => {
      if (p.class) root.classList.remove(p.class);
    });

    // Add new profile class
    const profile = PROFILES.find(p => p.id === profileId) || PROFILES[0];
    if (profile.class) {
      root.classList.add(profile.class);
    }
  }

  function setProfile(profileId) {
    localStorage.setItem(ACCESSIBILITY_KEY, profileId);
    applyProfile(profileId);
    
    // Dispatch event so D3 charts know to re-render with new colors
    window.dispatchEvent(new CustomEvent('themechanged', { detail: { profile: profileId } }));
  }

  // Inject the UI widget once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    injectWidgetUI();
    
    // Add event listeners to the injected UI
    const toggleBtn = document.getElementById('a11y-toggle');
    const panel = document.getElementById('a11y-panel');
    
    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
        toggleBtn.setAttribute('aria-expanded', !isExpanded);
        panel.classList.toggle('is-open');
      });
      
      // Close panel when clicking outside
      document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !toggleBtn.contains(e.target)) {
          toggleBtn.setAttribute('aria-expanded', 'false');
          panel.classList.remove('is-open');
        }
      });
    }

    const radios = document.querySelectorAll('input[name="a11y-profile"]');
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        setProfile(e.target.value);
      });
    });
  });

  function injectWidgetUI() {
    // Only inject if it doesn't already exist
    if (document.getElementById('a11y-widget')) return;

    const currentProfileId = localStorage.getItem(ACCESSIBILITY_KEY) || 'default';

    const widgetHTML = `
      <div id="a11y-widget" class="a11y-widget" aria-label="Accessibility Settings">
        <div id="a11y-panel" class="a11y-panel" role="dialog" aria-labelledby="a11y-title">
          <div class="a11y-panel-header">
            <h3 id="a11y-title">Accessibility</h3>
          </div>
          <fieldset class="a11y-fieldset">
            <legend class="sr-only">Select Color Profile</legend>
            ${PROFILES.map(p => `
              <label class="a11y-option">
                <input type="radio" name="a11y-profile" value="${p.id}" ${currentProfileId === p.id ? 'checked' : ''}>
                <span class="a11y-label-text">${p.label}</span>
              </label>
            `).join('')}
          </fieldset>
        </div>
        <button id="a11y-toggle" class="a11y-toggle" aria-expanded="false" aria-controls="a11y-panel" aria-label="Toggle Accessibility Menu">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="10" r="3"></circle>
            <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"></path>
          </svg>
        </button>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', widgetHTML);
  }
})();
