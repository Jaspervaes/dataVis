/**
 * network-map.js
 * ─────────────────────────────────────────────────────────────
 * 3D globe of cross-region music collaborations.
 *
 * Arcs are aggregated routes — by continent ('region' level, the clean
 * overview) or by country ('country' level, more detail). Arc thickness
 * scales with the route's total collaborations. Click an arc to drill
 * into the underlying artist pairs.
 *
 * Data: data/artist-connections.csv (pairwise artist credits from
 * data/fetch_musicbrainz.py); falls back to a placeholder CSV until the
 * real fetch completes. Region anchors are fixed below; country positions
 * come from data/country-coords.json.
 *
 * Uses globe.gl (UMD). Reuses the project's sidebar filters, tooltip
 * helper, and insight-card pattern.
 * ─────────────────────────────────────────────────────────────
 */

import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }    from '../tooltip.js';
import { loadCSV }                 from '../data-loader.js';
import { initStoryMode, fx }       from '../story-mode.js';

const CONNECTIONS_PATH = '../data/artist-connections.csv';
const PLACEHOLDER_PATH = '../data/artist-connections-placeholder.csv';
const COORDS_PATH      = '../data/country-coords.json';
const WORLD_GEO_URL    = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson';

// One anchor per region — region-level arcs run between these points.
const REGION_ANCHORS = {
  'Europe':        { lat: 50,  lon: 10  },
  'North America': { lat: 45,  lon: -100 },
  'Latin America': { lat: -10, lon: -60 },
  'Africa':        { lat: 2,   lon: 20  },
  'Asia':          { lat: 35,  lon: 100 },
  'Oceania':       { lat: -25, lon: 140 },
};

let globe         = null;
let connections   = [];        // raw rows from the CSV
let coords        = {};        // ISO-2 → { name, lat, lon, region }
let world         = null;      // country polygons GeoJSON
let europeOnly    = false;     // "Europe ↔ World only" toggle
let minCollabs    = 1;         // hide routes below this many collaborations
let maxRouteTotal = 1;         // busiest visible route — stroke scales against this
let granularity   = 'region';  // 'region' (overview) | 'country' (detail)
let pinnedArc     = null;      // corridor kept open on click
let spotlightPair = null;      // {a,b} region pair spotlit by an insight-card hover

// ── Theme-reactive colours (read CSS vars at call time) ───────
function regionColour(region) {
  const root = getComputedStyle(document.documentElement);
  const map = {
    'Europe':        root.getPropertyValue('--acid').trim()      || '#c8f000',
    'North America': root.getPropertyValue('--red').trim()       || '#e5321c',
    'Latin America': '#e07840',  // matches sankey/cultural-flow (no CSS token)
    'Africa':        root.getPropertyValue('--amber').trim()     || '#f0a830',
    'Asia':          root.getPropertyValue('--blue-cool').trim() || '#6aabf0',
    'Oceania':       root.getPropertyValue('--rose').trim()      || '#c47fa0',
  };
  return map[region] || '#7c3aed';
}
function bgColour() {
  const root = getComputedStyle(document.documentElement);
  return root.getPropertyValue('--globe-base').trim()
      || root.getPropertyValue('--bg-base').trim()
      || '#0e0c0a';
}
function atmosphereColour() {
  return getComputedStyle(document.documentElement).getPropertyValue('--globe-atmo').trim() || '#7a6f5e';
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  const container = document.getElementById('viz-container');
  if (!container) return;

  const europeCb = document.getElementById('filter-europe-only');
  if (europeCb) europeCb.addEventListener('change', () => { europeOnly = europeCb.checked; render(); });

  const minSlider  = document.getElementById('filter-min-collabs');
  const minDisplay = document.getElementById('filter-min-collabs-display');
  if (minSlider) minSlider.addEventListener('input', () => {
    minCollabs = parseInt(minSlider.value, 10) || 1;
    if (minDisplay) minDisplay.textContent = `${minCollabs}+`;
    render();
  });

  document.querySelectorAll('input[name="granularity"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      granularity = radio.value;
      // Region totals dwarf country totals. Country level has a long tail of
      // 1-collab routes that clutter the globe, so start it at 30+; region
      // level stays at 1+.
      minCollabs = granularity === 'country' ? 30 : 1;
      updateThresholdSlider();              // rescale max first (may clamp minCollabs)
      if (minSlider)  minSlider.value = minCollabs;
      if (minDisplay) minDisplay.textContent = `${minCollabs}+`;
      render();
    });
  });

  // Browsers restore the radio selection across reloads, so sync `granularity`
  // to whatever is actually checked — otherwise the control and globe disagree.
  const checkedGran = document.querySelector('input[name="granularity"]:checked');
  if (checkedGran) granularity = checkedGran.value;

  let usingPlaceholder = false;
  try {
    const [csv, coordsJson, worldJson] = await Promise.all([
      loadCSV(CONNECTIONS_PATH).catch(() => []),
      fetch(COORDS_PATH).then(r => r.json()),
      fetch(WORLD_GEO_URL).then(r => r.json()),
    ]);
    connections = Array.isArray(csv) ? csv : [];
    coords = coordsJson;
    world  = worldJson;
    if (!connections.length) {
      connections = await loadCSV(PLACEHOLDER_PATH).catch(() => []);
      usingPlaceholder = connections.length > 0;
    }
  } catch (err) {
    console.error('[network-map] data load failed:', err);
    showMessage(container, 'Failed to load data', String(err.message || err));
    return;
  }

  if (!connections.length) {
    showMessage(container, 'No collaboration data yet',
      'Run `python data/fetch_musicbrainz.py` to populate data/artist-connections.csv, then refresh.');
    return;
  }

  togglePlaceholderBadge(usingPlaceholder);

  updateThresholdSlider();  // scale the threshold to the current detail level

  if (typeof window.Globe !== 'function') {
    showMessage(container, 'Globe library failed to load',
      'The globe.gl script did not load (network/CDN issue). Check your connection and refresh.');
    return;
  }

  initGlobe(container);
  render();

  window.addEventListener('filters:changed', render);
  window.addEventListener('themechanged',    () => { restyleGlobe(); render(); });
  window.addEventListener('resize',          sizeGlobe);

  initStoryMode({
    insightsSelector: '#global-collabs-notes',
    eyebrow:   'Chapter 02 · Global Collabs',
    stat:      '308 pairs, 495 songs',
    statLabel: 'The US and UK, the busiest corridor in music',
    body:      "The studio went global. Artists an ocean apart now write together, and Europe sits at the heart of the busiest pipeline in music.",
    next: { href: 'resonance-timeline.html?story=1', label: 'Resonance Timeline', teaser: 'When they collide, how does it feel?' },
    applyPreset() {
      // Drop to country detail so the US–UK corridor reads as its own arc.
      fx.decade(1986, 2025);
      fx.group('region', ['europe', 'north america', 'latin america', 'africa', 'asia', 'oceania']);
      fx.checkbox('filter-europe-only', false);
      fx.radio('granularity', 'country');   // its handler raises the min-collabs floor…
      fx.range('filter-min-collabs', 30);   // …but set it explicitly too, in case the
                                            // radio was already 'country' (then change
                                            // never fires) and the floor stays at 1.
      // Land on the spotlight: dim every arc except the busiest corridor, the
      // US ↔ UK route the walkthrough headline is about. Mirrors hovering the
      // "busiest route" insight card. Runs after the fx.* calls have rendered.
      setGlobeSpotlight({ countryA: 'United States', countryB: 'United Kingdom' });
    },
    clearPreset() {
      setGlobeSpotlight(null);
      fx.radio('granularity', 'region');
      fx.decade(1986, 2025);
      fx.checkbox('filter-europe-only', false);
      fx.group('region', ['europe', 'north america', 'latin america', 'africa', 'asia', 'oceania']);
    },
  });

  // Linked highlighting: hovering a story card spotlights its region corridor
  // on the globe. Cards carry the two region endpoints as data attributes.
  document.querySelectorAll('#global-collabs-notes [data-spotlight-region-a]').forEach(card => {
    const pair = { a: card.dataset.spotlightRegionA, b: card.dataset.spotlightRegionB };
    card.addEventListener('mouseenter', () => setGlobeSpotlight(pair));
    card.addEventListener('mouseleave', () => setGlobeSpotlight(null));
  });
});

// ── Globe setup ──────────────────────────────────────────────
function initGlobe(container) {
  globe = window.Globe()(container)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor(atmosphereColour())
    .atmosphereAltitude(0.15)
    .globeImageUrl(null);

  // globe.gl clears the container on mount, so move the insight HUD in now.
  const hud = document.getElementById('insight-overlay');
  if (hud) container.appendChild(hud);

  const mat = globe.globeMaterial();
  mat.color.set(bgColour());
  mat.emissive.set(bgColour());
  mat.emissiveIntensity = 0.08;

  globe
    .polygonsData(world ? world.features : [])
    .polygonCapColor(polygonColour)
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => 'rgba(255,255,255,0.10)')
    .polygonAltitude(0.005);

  if (typeof globe.onGlobeClick === 'function') globe.onGlobeClick(() => clearPin());

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;

  // Disable wheel zoom so OrbitControls skips preventDefault and native page
  // scroll works. Ctrl/Meta re-enables zoom (standard map pattern).
  controls.enableZoom = false;
  const setZoom = on => { if (globe) globe.controls().enableZoom = on; };
  document.addEventListener('keydown', e => { if (e.key === 'Control' || e.key === 'Meta') setZoom(true);  });
  document.addEventListener('keyup',   e => { if (e.key === 'Control' || e.key === 'Meta') setZoom(false); });
  window.addEventListener('blur', () => setZoom(false));

  // Show hint on first scroll-without-Ctrl over the globe.
  container.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) showScrollHint(container);
  }, { passive: true });

  sizeGlobe();
}

function polygonColour(d) {
  const iso = isoFromFeature(d);
  const region = coords[iso]?.region;
  if (!region) return 'rgba(150, 145, 135, 0.10)';  // no data → neutral grey
  return rgbaWithAlpha(regionColour(region), 0.18);
}

function sizeGlobe() {
  if (!globe) return;
  const container = document.getElementById('viz-container');
  if (!container) return;
  const rect = container.getBoundingClientRect();
  globe.width(rect.width).height(rect.height);
}

function restyleGlobe() {
  if (!globe) return;
  const mat = globe.globeMaterial();
  mat.color.set(bgColour());
  mat.emissive.set(bgColour());
  globe.atmosphereColor(atmosphereColour());
}

// ── Arc appearance (selection- and layer-aware) ───────────────
function baseOf(d) { return d.isPulse ? d.base : d; }

// True when an insight card (or the walkthrough) is spotlighting this corridor.
// A pair with countryA/countryB targets one specific country corridor (e.g.
// United States ↔ United Kingdom); otherwise it matches a whole region pair.
function arcMatchesSpotlight(c) {
  if (!spotlightPair) return false;
  const { a, b, countryA, countryB } = spotlightPair;
  if (countryA && countryB) {
    return (c.countryA === countryA && c.countryB === countryB) ||
           (c.countryA === countryB && c.countryB === countryA);
  }
  return (c.regionA === a && c.regionB === b) || (c.regionA === b && c.regionB === a);
}

function arcColour(d) {
  const real = baseOf(d);
  let alpha;
  if (pinnedArc)                  alpha = real === pinnedArc ? (d.isPulse ? 1.0 : 0.95) : 0.05;
  else if (spotlightPair)         alpha = arcMatchesSpotlight(real) ? (d.isPulse ? 1.0 : 0.9) : 0.05;
  else                            alpha = d.isPulse ? 0.95 : 0.62;
  return [rgbaWithAlpha(d.cAhex, alpha), rgbaWithAlpha(d.cBhex, alpha)];
}

function arcStrokeFor(d) {
  const c = baseOf(d);
  // Map [1 .. maxRouteTotal] → [1.0 .. 6.5] px on a sqrt curve.
  const frac = maxRouteTotal > 1 ? Math.sqrt((c.totalCollabs - 1) / (maxRouteTotal - 1)) : 0;
  const base = 1.0 + frac * 5.5;
  if (c === pinnedArc) return base + 1.5;
  if (!pinnedArc && arcMatchesSpotlight(c)) return base + 1.5;
  return base;
}

// Base line solid; pulse = a short bright segment travelling along it (motion, no gap).
function arcDashLengthFor(d)  { return d.isPulse ? 0.12 : 1; }
function arcDashGapFor(d)     { return d.isPulse ? 0.88 : 0; }
function arcDashAnimateFor(d) {
  if (!d.isPulse) return 0;
  const t = baseOf(d).totalCollabs;
  return 3500 + (10 - Math.min(t, 10)) * 300;
}

function refreshArcStyles() {
  if (!globe) return;
  globe
    .arcColor(arcColour)
    .arcStroke(arcStrokeFor)
    .arcDashLength(arcDashLengthFor)
    .arcDashGap(arcDashGapFor)
    .arcDashAnimateTime(arcDashAnimateFor);
}

// ── Linked highlighting: spotlight a region corridor from an insight card ──
// Hovering a Global-Collabs story card dims every arc except the ones on its
// region corridor (e.g. Europe ↔ North America), so the card and the globe
// read as one view (mirrors the genre-forecast brushing pattern). A pinned
// arc takes precedence. pair = {a, b} region names | null.
function setGlobeSpotlight(pair) {
  spotlightPair = pair;
  // If nothing on screen matches (e.g. that corridor is below the threshold
  // or hidden at this granularity), don't blank the whole globe — just no-op.
  if (pair && globe) {
    const arcs = globe.arcsData() || [];
    if (!arcs.some(d => arcMatchesSpotlight(baseOf(d)))) spotlightPair = null;
  }
  refreshArcStyles();
}

// ── Render ────────────────────────────────────────────────────
function render() {
  if (!globe) return;
  const filters   = getFilters();
  const pairs     = filterPairs(connections, filters);
  const corridors = buildCorridors(pairs, granularity);

  maxRouteTotal = corridors.reduce((m, c) => Math.max(m, c.totalCollabs), 1);

  const pulseArcs = corridors.map(a => ({ ...a, isPulse: true, base: a }));
  const arcs = [...corridors, ...pulseArcs];

  updateSubtitle();
  clearPin({ silent: true });

  globe
    .arcsData(arcs)
    .arcStartLat(d => d.startLat)
    .arcStartLng(d => d.startLng)
    .arcEndLat(d   => d.endLat)
    .arcEndLng(d   => d.endLng)
    .arcColor(arcColour)
    .arcAltitudeAutoScale(0.6)
    .arcStroke(arcStrokeFor)
    .arcDashLength(arcDashLengthFor)
    .arcDashGap(arcDashGapFor)
    .arcDashAnimateTime(arcDashAnimateFor)
    .arcsTransitionDuration(500)
    .onArcHover(handleArcHover)
    .onArcClick(handleArcClick);

  globe.polygonCapColor(polygonColour);

  updateInsightCards(pairs);
}

// ── Data shaping ──────────────────────────────────────────────
function filterPairs(rows, filters) {
  const activeRegions = new Set(filters.regions); // lowercase
  const [yStart, yEnd] = filters.decadeRange;

  const pairs = [];
  for (const r of rows) {
    const region  = String(r.region || '').toLowerCase();
    const cregion = String(r.collab_region || '').toLowerCase();
    if (!activeRegions.has(region) || !activeRegions.has(cregion)) continue;
    if (europeOnly && ((region === 'europe') === (cregion === 'europe'))) continue;

    const yr = Number(r.year);
    if (Number.isFinite(yr) && (yr < yStart || yr > yEnd)) continue;

    const a = coords[r.country];
    const b = coords[r.collab_country];
    if (!a || !b) continue;

    pairs.push({
      count:        Math.max(1, Number(r.collaboration_count) || 1),
      year:         Number.isFinite(yr) ? yr : null,
      artist:       r.artist_name,
      collaborator: r.collaborator_name,
      country:      a.name,    collabCountry: b.name,
      countryCode:  r.country, collabCode:    r.collab_country,
      region:       r.region,  collabRegion:  r.collab_region,
      a, b,
    });
  }
  return pairs;
}

// Aggregate pairs into corridors — by continent ('region') or country.
// Cross-region only at region level (a self-arc has nowhere to go).
function buildCorridors(pairs, level) {
  const map = new Map();
  for (const p of pairs) {
    let id1, id2, name1, name2, reg1, reg2, pos1, pos2;

    if (level === 'region') {
      if (p.region === p.collabRegion) continue;
      id1 = name1 = reg1 = p.region;       pos1 = REGION_ANCHORS[p.region];
      id2 = name2 = reg2 = p.collabRegion; pos2 = REGION_ANCHORS[p.collabRegion];
    } else {
      id1 = p.countryCode; name1 = p.country;       reg1 = p.region;       pos1 = p.a;
      id2 = p.collabCode;  name2 = p.collabCountry;  reg2 = p.collabRegion; pos2 = p.b;
    }
    if (!pos1 || !pos2) continue;

    if (String(id1) > String(id2)) {
      [id1, id2]     = [id2, id1];
      [name1, name2] = [name2, name1];
      [reg1, reg2]   = [reg2, reg1];
      [pos1, pos2]   = [pos2, pos1];
    }
    const key = `${id1}|${id2}`;

    let c = map.get(key);
    if (!c) {
      c = {
        startLat: pos1.lat, startLng: pos1.lon,
        endLat:   pos2.lat, endLng:   pos2.lon,
        cAhex: regionColour(reg1), cBhex: regionColour(reg2),
        countryA: name1, countryB: name2,
        regionA:  reg1,  regionB:  reg2,
        level,
        totalCollabs: 0, pairCount: 0, pairs: [],
      };
      map.set(key, c);
    }
    c.totalCollabs += p.count;
    c.pairCount    += 1;
    c.pairs.push(p);
  }

  const corridors = [];
  for (const c of map.values()) {
    if (c.totalCollabs < minCollabs) continue;
    c.pairs.sort((x, y) => y.count - x.count);
    corridors.push(c);
  }
  return corridors;
}

// Largest single route total for the given level — used to scale the slider.
// Mirrors buildCorridors: region level is cross-region only; country level
// includes intra-region country pairs too.
function computeMaxCorridorTotal(rows, level) {
  const totals = new Map();
  for (const r of rows) {
    const ra = String(r.region || ''), rb = String(r.collab_region || '');
    if (!ra || !rb) continue;
    let key;
    if (level === 'region') {
      if (ra === rb) continue;
      key = [ra, rb].sort().join('|');
    } else {
      if (!coords[r.country] || !coords[r.collab_country]) continue;
      key = [r.country, r.collab_country].sort().join('|');
    }
    totals.set(key, (totals.get(key) || 0) + Math.max(1, Number(r.collaboration_count) || 1));
  }
  let mx = 1;
  for (const v of totals.values()) if (v > mx) mx = v;
  return mx;
}

// Rescale the "minimum collaborations" slider to the current detail level.
function updateThresholdSlider() {
  const slider  = document.getElementById('filter-min-collabs');
  const display = document.getElementById('filter-min-collabs-display');
  if (!slider) return;
  const maxTotal = computeMaxCorridorTotal(connections, granularity);
  slider.max = Math.max(2, Math.min(maxTotal, 200));
  if (minCollabs > Number(slider.max)) {       // clamp a stale region-scale threshold
    minCollabs = 1;
    slider.value = 1;
    if (display) display.textContent = '1+';
  }
}

// ── Hover / click ─────────────────────────────────────────────
function handleArcHover(arcRaw) {
  const container = document.getElementById('viz-container');
  if (container) container.style.cursor = arcRaw ? 'pointer' : 'grab';
  if (!arcRaw) { tooltip.hide(); return; }

  const c = baseOf(arcRaw);
  const top = c.pairs[0];
  const ev = window._lastGlobeMouse || { clientX: 0, clientY: 0 };
  const placeRows = c.level === 'region' ? [] : [
    { label: c.regionA, value: c.countryA, color: regionColour(c.regionA) },
    { label: c.regionB, value: c.countryB, color: regionColour(c.regionB) },
  ];
  tooltip.show(ev, tooltipHtml(
    `${c.countryA} ↔ ${c.countryB}`,
    [
      ...placeRows,
      { label: 'Collaborations', value: c.totalCollabs },
      { label: 'Artist pairs',   value: c.pairCount },
      ...(top ? [{ label: 'Top pair', value: `${top.artist} × ${top.collaborator}` }] : []),
      { label: '', value: 'Click to see artists' },
    ],
  ));
}

document.addEventListener('mousemove', e => {
  window._lastGlobeMouse = e;
  if (document.getElementById('d3-tooltip')?.classList.contains('visible')) tooltip.move(e);
});

function handleArcClick(arcRaw) {
  if (!arcRaw) return;
  const c = baseOf(arcRaw);
  pinnedArc = c;
  tooltip.hide();
  if (globe) globe.controls().autoRotate = false;
  refreshArcStyles();
  showPinnedPanel(c);
}

function clearPin({ silent = false } = {}) {
  pinnedArc = null;
  hidePinnedPanel();
  if (globe) {
    globe.controls().autoRotate = true;
    if (!silent) refreshArcStyles();
  }
}

// ── Drill-down panel ──────────────────────────────────────────
function ensurePanel() {
  const container = document.getElementById('viz-container');
  if (!container) return null;
  let panel = document.getElementById('arc-detail-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'arc-detail-panel';
    panel.className = 'arc-detail-panel';
    container.appendChild(panel);
  }
  return panel;
}

const detailRow = (label, value, color) => `
  <div class="tooltip-row">
    <span>${label}</span>
    <span class="tooltip-value" style="color:${color || 'var(--text-primary)'}">${value}</span>
  </div>`;

// Level 1: the route — total + ranked list of artist pairs (each click-through).
function showPinnedPanel(c) {
  const panel = ensurePanel();
  if (panel) { renderRouteCard(panel, c); panel.style.display = 'block'; }
}

function renderRouteCard(panel, c) {
  const placeRows = c.level === 'region' ? '' : `
    ${detailRow(c.regionA, c.countryA, regionColour(c.regionA))}
    ${detailRow(c.regionB, c.countryB, regionColour(c.regionB))}`;

  const MAX = 8;
  const shown = c.pairs.slice(0, MAX);
  const pairRows = shown.map((p, i) => `
    <div class="tooltip-row pair-row" data-i="${i}" role="button" tabindex="0">
      <span>${p.artist} × ${p.collaborator}</span>
      <span class="tooltip-value">${p.count}</span>
    </div>`).join('');
  const more = c.pairCount > MAX
    ? `<div class="arc-detail-more">+${c.pairCount - MAX} more pair${c.pairCount - MAX === 1 ? '' : 's'}</div>`
    : '';

  panel.innerHTML = `
    <button class="arc-detail-close" aria-label="Close">&times;</button>
    <div class="tooltip-title">${c.countryA} ↔ ${c.countryB}</div>
    <div class="tooltip-divider"></div>
    ${placeRows}
    ${detailRow('Total collaborations', c.totalCollabs)}
    ${detailRow('Artist pairs', c.pairCount)}
    <div class="tooltip-divider"></div>
    <div class="arc-detail-subhead">Who's collaborating <span class="arc-detail-hint">— click a pair</span></div>
    ${pairRows}
    ${more}`;
  panel.querySelector('.arc-detail-close')?.addEventListener('click', e => { e.stopPropagation(); clearPin(); });
  panel.querySelectorAll('.pair-row').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); renderPairCard(panel, c, shown[Number(el.dataset.i)]); });
  });
}

// Level 2: a single collaboration — clean from/to detail, with a back link.
function renderPairCard(panel, c, p) {
  if (!p) return;
  panel.innerHTML = `
    <button class="arc-detail-close" aria-label="Close">&times;</button>
    <button class="arc-detail-back">‹ Back to route</button>
    <div class="tooltip-title">${p.artist} × ${p.collaborator}</div>
    <div class="tooltip-divider"></div>
    ${detailRow('From', `${p.country} (${p.region})`, regionColour(p.region))}
    ${detailRow('To',   `${p.collabCountry} (${p.collabRegion})`, regionColour(p.collabRegion))}
    ${detailRow('Collaborations', p.count)}
    ${p.year ? detailRow('First year', p.year) : ''}`;
  panel.querySelector('.arc-detail-close')?.addEventListener('click', e => { e.stopPropagation(); clearPin(); });
  panel.querySelector('.arc-detail-back')?.addEventListener('click', e => { e.stopPropagation(); renderRouteCard(panel, c); });
}

function hidePinnedPanel() {
  const panel = document.getElementById('arc-detail-panel');
  if (panel) panel.style.display = 'none';
}

// ── Insight cards ─────────────────────────────────────────────
function updateInsightCards(pairs) {
  const cross = pairs.filter(p => p.region !== p.collabRegion);

  const europeOut = new Map();
  const partnerCounts = new Map();
  for (const p of cross) {
    const aEu = p.region === 'Europe';
    const bEu = p.collabRegion === 'Europe';
    if (aEu !== bEu) {
      const euName      = aEu ? p.artist : p.collaborator;
      const foreignName = aEu ? p.collaborator : p.artist;
      europeOut.set(euName, (europeOut.get(euName) || 0) + p.count);
      partnerCounts.set(foreignName, (partnerCounts.get(foreignName) || 0) + p.count);
    }
  }
  const topEuro    = pickTop(europeOut);
  const topPartner = pickTop(partnerCounts);

  setCard('card-collabs',    formatNum(pairs.length),  'Collaborations shown');
  setCard('card-cross',      formatNum(cross.length),  'Cross-region pairs');
  setCard('card-top-artist', topEuro?.name || '—',
          topEuro    ? `${formatNum(topEuro.count)} cross-region links`    : 'Top European exporter');
  setCard('card-hub',        topPartner?.name || '—',
          topPartner ? `${formatNum(topPartner.count)} links with Europe` : 'Most-connected partner abroad');
}

function pickTop(map) {
  let best = null;
  for (const [name, count] of map) if (!best || count > best.count) best = { name, count };
  return best;
}

function setCard(id, value, desc) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = el.querySelector('.insight-card-value');
  const d = el.querySelector('.insight-card-desc');
  if (v) v.textContent = value;
  if (d) d.textContent = desc;
}

// ── Helpers ───────────────────────────────────────────────────
function isoFromFeature(feature) {
  const p = feature?.properties || {};
  return p.ISO_A2 || p.ISO_A2_EH || p.iso_a2 || p.WB_A2 || '';
}

function rgbaWithAlpha(hex, alpha) {
  if (!hex) return `rgba(124, 58, 237, ${alpha})`;
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  let r, g, b;
  if (m6)      { r = parseInt(m6[1],16); g = parseInt(m6[2],16); b = parseInt(m6[3],16); }
  else if (m3) { r = parseInt(m3[1]+m3[1],16); g = parseInt(m3[2]+m3[2],16); b = parseInt(m3[3]+m3[3],16); }
  else         { return hex; }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatNum(n) { return new Intl.NumberFormat('en-GB').format(n); }

function togglePlaceholderBadge(show) {
  const badge = document.getElementById('placeholder-badge');
  if (badge) badge.style.display = show ? '' : 'none';
}

// Sub-line reflects the active detail level (continents vs countries).
function updateSubtitle() {
  const sub = document.getElementById('page-sub');
  if (!sub) return;
  sub.textContent = granularity === 'region'
    ? 'Each arc links two continents; its thickness is the number of artist collaborations that cross between them. Click an arc to see which artists.'
    : 'Each arc links two countries; its thickness is the number of artist collaborations between them. Click an arc to see which artists.';
}

function showMessage(container, title, desc) {
  container.innerHTML = `
    <div class="empty-state" style="min-height:360px;">
      <p class="empty-state-title">${title}</p>
      <p class="empty-state-desc">${desc}</p>
    </div>`;
}

let _scrollHintTimer = null;
function showScrollHint(container) {
  let hint = container.querySelector('.globe-scroll-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'globe-scroll-hint';
    hint.textContent = 'Hold Ctrl to zoom';
    hint.style.cssText = [
      'position:absolute', 'bottom:16px', 'right:50%', 'transform:translateX(50%)',
      'z-index:6', 'padding:5px 12px',
      'font-family:var(--font-mono)', 'font-size:11px',
      'letter-spacing:var(--tracking-wide)', 'text-transform:uppercase',
      'color:var(--text-secondary)', 'background:var(--bg-elevated)',
      'border:1px solid var(--border)',
      'opacity:0', 'transition:opacity 0.2s ease', 'pointer-events:none',
    ].join(';');
    container.appendChild(hint);
  }
  hint.style.opacity = '1';
  clearTimeout(_scrollHintTimer);
  _scrollHintTimer = setTimeout(() => { hint.style.opacity = '0'; }, 1800);
}
