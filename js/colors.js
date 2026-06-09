/**
 * colors.js — single source of truth for categorical colours.
 *
 * Every chart colour comes from the four families defined in
 * css/variables.css (regions, genres, crises, audio features). This module
 * resolves those CSS custom properties to hex for the active theme.
 *
 * Why resolve to hex instead of returning `var(--token)`? CSS custom
 * properties are unreliable in SVG `fill`/`stroke` *presentation attributes*
 * across browsers. The theme class is applied to <html> before any page
 * script runs, so resolving at render time always matches the active theme.
 * Pages that support live theme toggling re-render on the `themechanged`
 * event, which re-runs these lookups.
 *
 * Usage:
 *   import { regionColor, genreColor, crisisColor, featureColor } from '../colors.js';
 *   regionColor('North America')  // canonical hex for the active theme
 */

const MUTED = '#7c3aed';  // last-resort fallback — loud on purpose, so a miss is visible

function cssVar(token) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || MUTED;
}

// ── Label → canonical key normalisation ──────────────────────────────────────
// Pages historically used many spellings for the same category. Normalise to a
// single key, then map that key to its CSS token.

const REGION_ALIASES = {
  europe:        'europe',
  northamerica:  'northamerica',
  us:            'northamerica',
  usa:           'northamerica',
  latinamerica:  'latinamerica',
  latam:         'latinamerica',
  africa:        'africa',
  africame:      'africa',   // genre-forecast hitlist used "Africa/ME"
  asia:          'asia',
  oceania:       'oceania',
};

const REGION_TOKENS = {
  europe:       '--region-europe',
  northamerica: '--region-north-america',
  latinamerica: '--region-latin-america',
  africa:       '--region-africa',
  asia:         '--region-asia',
  oceania:      '--region-oceania',
};

const CRISIS_ALIASES = {
  economic:      'economic',
  armedconflict: 'conflict',
  conflict:      'conflict',
  pandemic:      'pandemic',
};

const CRISIS_TOKENS = {
  economic: '--crisis-economic',
  conflict: '--crisis-conflict',
  pandemic: '--crisis-pandemic',
};

// Genre and feature keys already match their token suffix once stripped
// (Hip-Hop → hiphop → --genre-hiphop, R&B → rnb → --genre-rnb).
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Public accessors ─────────────────────────────────────────────────────────

export function regionColor(label) {
  const key = REGION_ALIASES[slug(label)];
  return key ? cssVar(REGION_TOKENS[key]) : MUTED;
}

export function genreColor(label) {
  return cssVar(`--genre-${slug(label)}`);
}

export function crisisColor(type) {
  const key = CRISIS_ALIASES[slug(type)];
  return key ? cssVar(CRISIS_TOKENS[key]) : MUTED;
}

export function featureColor(name) {
  return cssVar(`--feature-${slug(name)}`);
}

/**
 * Build a {label: hex} map for the active theme — convenient for charts that
 * want a lookup object. Pass the labels a page actually uses.
 */
export function regionColorMap(labels) {
  return Object.fromEntries(labels.map(l => [l, regionColor(l)]));
}
export function genreColorMap(labels) {
  return Object.fromEntries(labels.map(l => [l, genreColor(l)]));
}

export { MUTED };
