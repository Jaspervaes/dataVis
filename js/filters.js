/**
 * filters.js
 * ─────────────────────────────────────────────────────────────
 * Reusable sidebar filter system for The Roots of Rhythm.
 *
 * Reads all filter inputs from the sidebar DOM, maintains a
 * central state object, and fires a 'filters:changed' custom
 * event on window whenever any value changes.
 *
 * Visualization pages import getFilters() for the current
 * state, or listen to 'filters:changed' to react to updates.
 *
 * Usage (in a viz page):
 *   import { initFilters, getFilters } from '../filters.js';
 *   initFilters();
 *   window.addEventListener('filters:changed', (e) => {
 *     const filters = e.detail;
 *     render(filters);
 *   });
 * ─────────────────────────────────────────────────────────────
 */

/** @type {FilterState} */
const _state = {
  decadeRange: [1986, 2025],
  audioFeatures: ['energy', 'valence', 'tempo', 'danceability'],
  crisisTypes: ['economic', 'armed_conflict', 'pandemic'],
  regions: ['europe', 'north america', 'latin america', 'americas', 'africa', 'asia', 'oceania'],
  genres: ['Pop','Hip-Hop','Rock','Electronic','R&B','Latin','Country','Afrobeats'],
};

/**
 * Returns a shallow copy of the current filter state.
 * @returns {FilterState}
 */
export function getFilters() {
  return { ..._state, audioFeatures: [..._state.audioFeatures],
    crisisTypes: [..._state.crisisTypes], regions: [..._state.regions],
    genres: [..._state.genres] };
}

/**
 * Initialise the filter system. Call once per page on DOMContentLoaded.
 * Binds all sidebar inputs and populates the active-pills container.
 */
export function initFilters() {
  _bindDecadeSlider();
  _bindCheckboxGroup('audio-feature', _state.audioFeatures, 'audioFeatures');
  _bindCheckboxGroup('crisis-type',   _state.crisisTypes,   'crisisTypes');
  _bindCheckboxGroup('region',        _state.regions,       'regions');
  _bindCheckboxGroup('genre',         _state.genres,        'genres');
  _bindResetButton();
  _renderPills();
}

// ── Internal ──────────────────────────────────────────────────

function _emit() {
  _renderPills();
  window.dispatchEvent(
    new CustomEvent('filters:changed', { detail: getFilters() })
  );
}

function _bindDecadeSlider() {
  const sliderStart = document.getElementById('filter-decade-start');
  const sliderEnd   = document.getElementById('filter-decade-end');
  const displayEl   = document.getElementById('filter-decade-display');

  if (!sliderStart || !sliderEnd) return;

  const update = () => {
    let start = parseInt(sliderStart.value, 10);
    let end   = parseInt(sliderEnd.value,   10);
    if (start > end) [start, end] = [end, start];
    _state.decadeRange = [start, end];
    if (displayEl) displayEl.textContent = `${start} – ${end}`;
    _emit();
  };

  sliderStart.addEventListener('input', update);
  sliderEnd.addEventListener('input', update);
}

/**
 * @param {string}   groupName   data-filter-group attribute value
 * @param {string[]} defaultArr  reference to the state array
 * @param {string}   stateKey    key in _state to update
 */
function _bindCheckboxGroup(groupName, defaultArr, stateKey) {
  const boxes = document.querySelectorAll(
    `[data-filter-group="${groupName}"]`
  );
  if (!boxes.length) return;

  boxes.forEach(cb => {
    // Set initial checked state from default
    cb.checked = defaultArr.includes(cb.value);
    cb.addEventListener('change', () => {
      const checked = [...document.querySelectorAll(
        `[data-filter-group="${groupName}"]:checked`
      )].map(el => el.value);
      _state[stateKey] = checked;
      _emit();
    });
  });
}

function _bindResetButton() {
  const btn = document.getElementById('btn-reset-filters');
  if (!btn) return;
  btn.addEventListener('click', () => {
    // Reset to defaults
    _state.decadeRange   = [1986, 2025];
    _state.audioFeatures = ['energy', 'valence', 'tempo', 'danceability'];
    _state.crisisTypes   = ['economic', 'armed_conflict', 'pandemic'];
    _state.regions       = ['europe', 'north america', 'latin america', 'americas', 'africa', 'asia', 'oceania'];
    _state.genres        = ['Pop','Hip-Hop','Rock','Electronic','R&B','Latin','Country','Afrobeats'];

    // Re-sync DOM checkboxes
    document.querySelectorAll('[data-filter-group]').forEach(cb => {
      const group = cb.getAttribute('data-filter-group');
      if (group === 'audio-feature') cb.checked = true;
      if (group === 'crisis-type')   cb.checked = true;
      if (group === 'region')        cb.checked = true;
      if (group === 'genre')         cb.checked = true;
    });

    // Re-sync sliders
    const ss = document.getElementById('filter-decade-start');
    const se = document.getElementById('filter-decade-end');
    const sd = document.getElementById('filter-decade-display');
    if (ss) ss.value = 1986;
    if (se) se.value = 2025;
    if (sd) sd.textContent = '1986 – 2025';

    _emit();
  });
}

function _renderPills() {
  const container = document.getElementById('active-pills');
  if (!container) return;

  const pills = [];

  // Decade pill (only if not default)
  const [start, end] = _state.decadeRange;
  if (start !== 1986 || end !== 2025) {
    pills.push({ label: `${start}–${end}`, key: 'decade' });
  }

  // Audio features (show removed ones)
  const allFeatures = ['energy', 'valence', 'tempo', 'danceability'];
  allFeatures.forEach(f => {
    if (!_state.audioFeatures.includes(f)) {
      pills.push({ label: `No ${f}`, key: `af-${f}` });
    }
  });

  container.innerHTML = pills.map(p => `
    <span class="filter-pill" data-pill-key="${p.key}">
      ${p.label}
      <button class="filter-pill-remove" aria-label="Remove filter ${p.label}">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </span>`).join('');

  // Bind remove buttons
  container.querySelectorAll('.filter-pill-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.closest('.filter-pill').dataset.pillKey;
      _removePill(key);
    });
  });
}

function _removePill(key) {
  if (key === 'decade') {
    _state.decadeRange = [1986, 2025];
    const ss = document.getElementById('filter-decade-start');
    const se = document.getElementById('filter-decade-end');
    const sd = document.getElementById('filter-decade-display');
    if (ss) ss.value = 1986;
    if (se) se.value = 2025;
    if (sd) sd.textContent = '1986 – 2025';
  } else if (key.startsWith('af-')) {
    const feat = key.replace('af-', '');
    if (!_state.audioFeatures.includes(feat)) {
      _state.audioFeatures.push(feat);
      const cb = document.querySelector(
        `[data-filter-group="audio-feature"][value="${feat}"]`
      );
      if (cb) cb.checked = true;
    }
  }
  _emit();
}
