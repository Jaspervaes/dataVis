/**
 * resonance-timeline.js
 * ─────────────────────────────────────────────────────────────
 * Timeline: music valence over time overlaid with global crises.
 *
 * Shows the aggregate emotional tone (Spotify "valence") of
 * charting music across years, highlighting periods of global
 * upheaval with vertical shaded regions.
 *
 * Depends on:
 *   - D3 v7 (global window.d3)
 *   - filters.js  (filter state)
 *   - tooltip.js  (hover tooltips)
 * ─────────────────────────────────────────────────────────────
 */

import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }   from '../tooltip.js';
import { loadCSV, mockSpotifyTracks, mockGlobalCrises } from '../data-loader.js';
import { initStoryMode, fx }      from '../story-mode.js';
import { regionColor, crisisColor, featureColor } from '../colors.js';

// Resolve a CSS custom property live (tracks the active theme).
const cv = (token, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;

const CRISIS_LABELS = {
  economic:      'Economic',
  armed_conflict:'Armed Conflict',
  pandemic:      'Pandemic',
};

// Categorical colours from the shared contract (js/colors.js → variables.css),
// resolved for the active theme and rebuilt on theme change.
const FEATURE_KEYS = ['valence', 'energy', 'tempo', 'danceability'];
const CRISIS_KEYS  = ['economic', 'armed_conflict', 'pandemic'];

let FEATURE_COLORS = {};
let CRISIS_COLORS  = {};
function refreshColors() {
  FEATURE_COLORS = Object.fromEntries(FEATURE_KEYS.map(k => [k, featureColor(k)]));
  CRISIS_COLORS  = Object.fromEntries(CRISIS_KEYS.map(k  => [k, crisisColor(k)]));
}
refreshColors();

const FEATURE_LABELS = {
  valence:      'Valence',
  energy:       'Energy',
  tempo:        'Tempo',
  danceability: 'Danceability',
};

const TEMPO_NORM  = 200;
const FONT_STACK  = 'Inter, system-ui, sans-serif';
const CRISIS_PRIORITY = { pandemic: 3, armed_conflict: 2, economic: 1 };

// ISO-2 country → sidebar region key. Mirrors COUNTRY_TO_REGION in
// data/fetch_musicbrainz.py (lowercased for the JS side).
const COUNTRY_TO_REGION = {
  GB:'europe',DE:'europe',FR:'europe',SE:'europe',NO:'europe',NL:'europe',
  BE:'europe',IT:'europe',ES:'europe',PT:'europe',DK:'europe',FI:'europe',
  PL:'europe',RU:'europe',UA:'europe',IE:'europe',CH:'europe',AT:'europe',
  HU:'europe',CZ:'europe',RO:'europe',GR:'europe',RS:'europe',HR:'europe',
  IS:'europe',LU:'europe',SK:'europe',SI:'europe',LV:'europe',LT:'europe',
  EE:'europe',BA:'europe',MK:'europe',ME:'europe',AL:'europe',BG:'europe',
  CY:'europe',MT:'europe',MD:'europe',BY:'europe',
  US:'north america',CA:'north america',
  MX:'latin america',BR:'latin america',CO:'latin america',
  AR:'latin america',CL:'latin america',PE:'latin america',VE:'latin america',CU:'latin america',
  JM:'latin america',TT:'latin america',DO:'latin america',PA:'latin america',EC:'latin america',
  BO:'latin america',UY:'latin america',PY:'latin america',GT:'latin america',HN:'latin america',
  CR:'latin america',SV:'latin america',NI:'latin america',HT:'latin america',PR:'latin america',
  BS:'latin america',BB:'latin america',GY:'latin america',VC:'latin america',VG:'latin america',
  VI:'latin america',
  NG:'africa',ZA:'africa',GH:'africa',KE:'africa',SN:'africa',CM:'africa',
  TZ:'africa',UG:'africa',ET:'africa',EG:'africa',MA:'africa',TN:'africa',
  CI:'africa',ML:'africa',CD:'africa',AO:'africa',MZ:'africa',ZW:'africa',
  BW:'africa',ZM:'africa',RW:'africa',BJ:'africa',TG:'africa',BF:'africa',
  MW:'africa',DZ:'africa',LY:'africa',
  JP:'asia',KR:'asia',CN:'asia',IN:'asia',ID:'asia',PH:'asia',TH:'asia',
  VN:'asia',MY:'asia',SG:'asia',PK:'asia',BD:'asia',IR:'asia',TR:'asia',
  SA:'asia',AE:'asia',LB:'asia',IL:'asia',IQ:'asia',SY:'asia',KZ:'asia',
  UZ:'asia',MM:'asia',KH:'asia',LK:'asia',HK:'asia',TW:'asia',AM:'asia',
  AU:'oceania',NZ:'oceania',FJ:'oceania',PG:'oceania',
};

let rawTracks       = null;   // pre-aggregated valence-by-year rows (fallback path)
let rawMergedTracks = null;   // datos_merged rows tagged with .region (region path)
let rawCrises = null;
let usingRealCrises  = false;
let usingRealValence = false;
let usingRegionData  = false; // true when merged + artist-country join succeeded
// null = no insight box. Otherwise one of:
//   { type: 'year',    year }
//   { type: 'quarter', year, quarter }   (1..4)
let pinnedPeriod    = null;
let regionFeature   = null;   // which audio feature drives the regional column
let zoomMode        = false;  // magnifier-lens toggle
// Last cursor X (in chart-inner coords) while the mouse is over the chart.
// Survives render() so the lens can re-appear at the same spot after a
// click-pin triggers a full chart rebuild. Cleared on mouseleave.
let lastMouseChartX = null;
// Live chart handle for the insight-card spotlight (linked highlighting).
// Refreshed at the end of every render(); used by setTimelineSpotlight().
let chartCtx = null;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  // ── Region-aware data path ───────────────────────────────
  // If both the source CSV and artist→country lookup load, we can
  // attach a region to each track and apply the sidebar Region filter
  // to the audio-feature curves. Otherwise fall back to the
  // pre-aggregated valence-by-year file (no per-region breakdown).
  const [merged, artistCountries] = await Promise.all([
    loadCSV('../data/datos_merged_1986_2023.csv').catch(() => null),
    loadCSV('../data/artist-countries.csv').catch(() => null),
  ]);

  if (merged && merged.length && artistCountries && artistCountries.length) {
    const artistToRegion = new Map();
    for (const row of artistCountries) {
      const region = COUNTRY_TO_REGION[row.country];
      if (region) artistToRegion.set(row.artist_name, region);
    }
    rawMergedTracks = merged
      .map(t => {
        const region = artistToRegion.get(t.principal_artist_name) || null;
        // Derive quarter from album_release_date when present. Tracks
        // missing a usable date keep quarter=null and are skipped from
        // the quarterly aggregation (but still feed the yearly path).
        let quarter = null;
        const dateStr = t.album_release_date;
        if (dateStr && typeof dateStr === 'string' && dateStr.length >= 7) {
          const month = +dateStr.slice(5, 7);
          if (Number.isFinite(month) && month >= 1 && month <= 12) {
            quarter = Math.ceil(month / 3);
          }
        }
        return { ...t, region, quarter };
      })
      .filter(t => t.region && t.year != null && Number.isFinite(+t.year));
    if (rawMergedTracks.length) {
      usingRegionData  = true;
      usingRealValence = true;
    }
  }

  if (!usingRegionData) {
    const byYear = await loadCSV('../data/valence-by-year.csv').catch(() => null);
    if (byYear && byYear.length) {
      rawTracks = byYear;
      usingRealValence = true;
    } else {
      rawTracks = mockSpotifyTracks(300);
    }
  }

  // ── Crisis data (real) ────────────────────────────────────
  const crisisData = await loadCSV('../data/global-crises.csv').catch(() => null);
  if (crisisData && crisisData.length) {
    rawCrises      = crisisData;
    usingRealCrises = true;
  } else {
    rawCrises = mockGlobalCrises();
  }

  initZoomToggle();
  render();

  window.addEventListener('filters:changed', render);
  window.addEventListener('resize', render);
  window.addEventListener('themechanged', () => { refreshColors(); render(); });
  // Insight cards (separate module) ask us to spotlight a year on hover.
  window.addEventListener('resonance:spotlight', e => setTimelineSpotlight(e.detail));

  initStoryMode({
    insightsSelector: '#story-cards',   // the Peak/Break/Floor cards (injected by resonance-timeline-insights.js); the click-a-year panel sits below them
    eyebrow:   'Chapter 03 · Resonance Timeline',
    stat:      '59.2% → 43.4%',
    statLabel: 'Valence from its 2000 peak to its 2017 floor',
    body:      "As the world grew sadder, the music grew more danceable. People reached for rhythm when joy slipped out of reach.",
    next: { href: 'genre-forecast.html?story=1', label: 'Genre Forecast', teaser: 'So where is all of this heading?' },
    applyPreset() {
      // Isolate the paradox: valence falling while danceability rises.
      fx.decade(1986, 2024);
      fx.group('audio-feature', ['valence', 'danceability']);
    },
    clearPreset() {
      fx.decade(1986, 2024);
      fx.group('audio-feature', ['energy', 'valence', 'tempo', 'danceability']);
    },
  });
});

// ── Zoom-mode toggle button ─────────────────────────────────
function initZoomToggle() {
  const btn = document.getElementById('zoom-toggle');
  if (!btn) return;

  // Quarterly data is only available on the merged + artist-country path.
  // Disable (hide) the toggle when we don't have it so users aren't offered
  // a magnifier that would render an empty lens.
  if (!usingRegionData) {
    btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', () => {
    zoomMode = !zoomMode;
    btn.setAttribute('aria-pressed', String(zoomMode));
    btn.classList.toggle('is-active', zoomMode);
    render();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && zoomMode) {
      zoomMode = false;
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('is-active');
      render();
    }
  });
}

// ── Data preparation ─────────────────────────────────────────
// Quarter is encoded as a fractional year for plotting: 2001 Q3 → 2001.5
// (Q1 → 0.0, Q2 → 0.25, Q3 → 0.5, Q4 → 0.75). Keeps the X axis a single
// numeric scale shared between yearly and quarterly views.
function quarterToFracYear(year, quarter) {
  return year + (quarter - 1) / 4;
}

// Map a pinnedPeriod to the X-axis coordinate where its marker should sit.
// Year pin → integer year. Quarter pin → quarter midpoint (year + (q-1)/4 + 1/8).
function periodToFracYear(period) {
  if (!period) return null;
  if (period.type === 'year') return period.year;
  if (period.type === 'quarter') return period.year + (period.quarter - 1) / 4 + 1 / 8;
  return null;
}

function prepareData(filters) {
  const [start, end] = filters.decadeRange;
  const activeFeatures = filters.audioFeatures
    .filter(f => Object.keys(FEATURE_COLORS).includes(f));

  const seriesByFeature = {};
  const quarterlyByFeature = {};

  // Pre-filter merged tracks once per render (shared across all features).
  let mergedScope = null;
  if (usingRegionData) {
    const regionSet = new Set(filters.regions);
    mergedScope = rawMergedTracks.filter(t => {
      const y = +t.year;
      return y >= start && y <= end && regionSet.has(t.region);
    });
  }

  for (const feature of activeFeatures) {
    let raw;

    if (usingRegionData) {
      const byYear = d3.rollup(
        mergedScope.filter(d => Number.isFinite(+d[feature])),
        v => d3.mean(v, d => {
          const val = +d[feature];
          return feature === 'tempo' ? val / TEMPO_NORM : val;
        }),
        d => +d.year
      );
      raw = Array.from(byYear, ([year, value]) => ({ year, value }))
        .sort((a, b) => a.year - b.year);
    } else if (usingRealValence) {
      raw = rawTracks
        .filter(t => +t.year >= start && +t.year <= end)
        .map(d => {
          let value = +d[feature];
          if (feature === 'tempo') value = value / TEMPO_NORM;
          return { year: +d.year, value };
        })
        .sort((a, b) => a.year - b.year);
    } else {
      const filtered = rawTracks.filter(t =>
        t.year >= start && t.year <= end
      );
      const byYear = d3.rollup(filtered, v => d3.mean(v, d => {
        const val = d[feature] || 0;
        return feature === 'tempo' ? val / TEMPO_NORM : val;
      }), d => d.year);
      raw = Array.from(byYear, ([year, value]) => ({ year, value }))
        .sort((a, b) => a.year - b.year);
    }

    // Smooth with rolling 3-year average
    seriesByFeature[feature] = raw.map((d, i) => {
      const win = raw.slice(Math.max(0, i - 1), i + 2);
      return { year: d.year, value: d3.mean(win, w => w.value) };
    });

    // Quarterly aggregation — only available on the region (merged) path,
    // and only for tracks with a parseable album_release_date.
    if (usingRegionData) {
      const byQuarter = d3.rollup(
        mergedScope.filter(d => d.quarter != null && Number.isFinite(+d[feature])),
        v => ({
          value: d3.mean(v, d => {
            const val = +d[feature];
            return feature === 'tempo' ? val / TEMPO_NORM : val;
          }),
          count: v.length,
        }),
        d => `${+d.year}-${d.quarter}`
      );
      const rawQ = Array.from(byQuarter, ([key, agg]) => {
        const [y, q] = key.split('-').map(Number);
        return { year: y, quarter: q, frac: quarterToFracYear(y, q), value: agg.value, count: agg.count };
      })
      .filter(d => d.count >= 4) // suppress quarters with too-thin samples
      .sort((a, b) => a.frac - b.frac);

      // Rolling 3-quarter smoother — matches the visual cadence of the
      // 3-year smoother on the yearly series.
      quarterlyByFeature[feature] = rawQ.map((d, i) => {
        const win = rawQ.slice(Math.max(0, i - 1), i + 2);
        return { year: d.year, quarter: d.quarter, frac: d.frac, value: d3.mean(win, w => w.value) };
      });
    }
  }

  const crises = rawCrises.filter(c => {
    if (!filters.crisisTypes.includes(c.crisis_type)) return false;
    if (+c.start_year > end || +c.end_year < start) return false;
    if (!c.regions_affected) return true;
    const crisisRegions = c.regions_affected.split('|').map(r => r.trim().toLowerCase());
    return filters.regions.some(r => crisisRegions.includes(r.toLowerCase()));
  });

  return { seriesByFeature, quarterlyByFeature, crises };
}


// ── Render ────────────────────────────────────────────────────
function render() {
  const filters   = getFilters();
  const { seriesByFeature, quarterlyByFeature, crises } = prepareData(filters);
  const container = document.getElementById('viz-container');
  if (!container) return;
  container.innerHTML = '';

  const featureEntries = Object.entries(seriesByFeature);
  const quarterlyEntries = Object.entries(quarterlyByFeature);
  const allPoints = featureEntries.flatMap(([, s]) => s);

  if (allPoints.length < 2) {
    container.innerHTML = `<div class="empty-state">
      <p class="empty-state-title">No data for selected filters</p>
      <p class="empty-state-desc">Try expanding the decade range or selecting more audio features.</p>
    </div>`;
    return;
  }

  // Use valence series as the canonical reference, fall back to first active
  const primaryFeature = seriesByFeature['valence']
    ? 'valence'
    : featureEntries[0][0];
  const series = seriesByFeature[primaryFeature];

  const rect   = container.getBoundingClientRect();
  const width  = rect.width  || 800;
  const height = Math.max(rect.height || 480, 380);

  const margin = { top: 32, right: 96, bottom: 80, left: 56 };
  const innerW = width  - margin.left - margin.right;
  const innerH = height - margin.top  - margin.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('width',  width)
    .attr('height', height)
    .attr('aria-label', 'Line chart showing music valence over time with crisis zones')
    .attr('role', 'img');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // ── Scales ────────────────────────────────────────────────
  const xScale = d3.scaleLinear()
    .domain(d3.extent(series, d => d.year))
    .range([0, innerW]);

  const yScale = d3.scaleLinear()
    .domain([0, 1])
    .range([innerH, 0])
    .nice();

  const [filterStart, filterEnd] = filters.decadeRange;

  // ── Grid ──────────────────────────────────────────────────
  g.append('g')
    .attr('class', 'chart-grid')
    .call(d3.axisLeft(yScale).tickSize(-innerW).tickFormat(''))
    .call(ax => ax.select('.domain').remove());

  // ── Axes ──────────────────────────────────────────────────
  g.append('g')
    .attr('class', 'chart-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickFormat(d3.format('d')).ticks(8));

  g.append('g')
    .attr('class', 'chart-axis')
    .call(d3.axisLeft(yScale).tickFormat(d => `${(d * 100).toFixed(0)}%`).ticks(5));

  // Axis labels
  g.append('text')
    .attr('class', 'chart-axis-label')
    .attr('x',     innerW / 2)
    .attr('y',     innerH + 44)
    .attr('text-anchor', 'middle')
    .text('Year');

  const yLabel = featureEntries.length === 1
    ? `Avg. ${FEATURE_LABELS[featureEntries[0][0]]}${featureEntries[0][0] === 'tempo' ? ' (BPM ÷ 200)' : ' score'}`
    : 'Audio feature score (0–1)';

  g.append('text')
    .attr('class', 'chart-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -42)
    .attr('text-anchor', 'middle')
    .text(yLabel);

  // ── Gradient defs (one per active feature) ───────────────
  const defs = svg.append('defs');
  featureEntries.forEach(([feature]) => {
    const grad = defs.append('linearGradient')
      .attr('id', `gradient-${feature}`)
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    const color = FEATURE_COLORS[feature];
    grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.12);
    grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);
  });

  // ── Area + Line (one per active feature) ─────────────────
  const areaGen = d3.area()
    .x(d => xScale(d.year))
    .y0(innerH)
    .y1(d => yScale(d.value))
    .curve(d3.curveCatmullRom.alpha(0.5));

  const lineGen = d3.line()
    .x(d => xScale(d.year))
    .y(d => yScale(d.value))
    .curve(d3.curveCatmullRom.alpha(0.5));

  // Areas first (behind lines)
  featureEntries.forEach(([feature, fseries]) => {
    g.append('path')
      .datum(fseries)
      .attr('fill', `url(#gradient-${feature})`)
      .attr('d', areaGen);
  });

  // Lines on top (tagged so the insight-card spotlight can dim non-matching ones)
  featureEntries.forEach(([feature, fseries]) => {
    g.append('path')
      .datum(fseries)
      .attr('class', `feature-line feature-line-${feature}`)
      .attr('fill', 'none')
      .attr('stroke', FEATURE_COLORS[feature])
      .attr('stroke-width', 2.5)
      .style('transition', 'opacity 0.15s ease')
      .attr('d', lineGen);
  });

  // ── Direct line labels (end of each line) ────────────────
  const labelPositions = featureEntries.map(([feature, fseries]) => {
    const last = fseries[fseries.length - 1];
    return { feature, y: yScale(last.value) };
  }).sort((a, b) => a.y - b.y);

  // Push apart any labels closer than 14px
  for (let i = 1; i < labelPositions.length; i++) {
    if (labelPositions[i].y - labelPositions[i - 1].y < 14) {
      labelPositions[i].y = labelPositions[i - 1].y + 14;
    }
  }

  labelPositions.forEach(({ feature, y }) => {
    g.append('text')
      .attr('x', innerW + 8)
      .attr('y', y)
      .attr('dy', '0.35em')
      .attr('fill', FEATURE_COLORS[feature])
      .attr('font-size', 11)
      .attr('font-family', FONT_STACK)
      .attr('font-weight', 500)
      .text(FEATURE_LABELS[feature]);
  });

  // ── Interaction: invisible overlay ────────────────────────
  const bisect = d3.bisector(d => d.year).center;

  const focusG = g.append('g').attr('class', 'focus').style('display', 'none');
  focusG.append('line')
    .attr('class', 'focus-line')
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', cv('--text-muted', '#475569'))
    .attr('stroke-dasharray', '4 3')
    .attr('stroke-width', 1);

  // One dot per active feature
  featureEntries.forEach(([feature]) => {
    focusG.append('circle')
      .attr('class', `focus-dot focus-dot-${feature}`)
      .attr('r', 5)
      .attr('fill', FEATURE_COLORS[feature])
      .attr('stroke', cv('--text-primary', '#f1f5f9'))
      .attr('stroke-width', 1.5);
  });

  // Pinned-period vertical marker (separate from the hover focus line).
  // For quarter pins, we drop the marker at the quarter's mid-point so it
  // sits visually inside that quarter on the outer (yearly) scale.
  const pinnedFrac = periodToFracYear(pinnedPeriod);
  if (pinnedFrac != null && pinnedFrac >= filterStart && pinnedFrac <= filterEnd) {
    g.append('line')
      .attr('class', 'pinned-line')
      .attr('x1', xScale(pinnedFrac)).attr('x2', xScale(pinnedFrac))
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', 'var(--acid)')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8);
  }

  // ── Magnifier-lens group (built once per render, shown only in zoomMode) ──
  // Dimensions: a fixed pixel width capped at 45% of chart width so it never
  // dominates. Inside the lens, a 5-year window is stretched to fill the
  // lens width — i.e. true zoom, not just finer data at the same scale.
  // The lens box extends ~22px below the chart bottom so its own year labels
  // sit inside the lens (and visually replace the outer X-axis labels under
  // the lens), preventing the two axes from colliding.
  const LENS_YEAR_SPAN = 5;
  const LENS_W = Math.min(360, Math.max(240, innerW * 0.45));
  const LENS_AXIS_H = 22;
  const LENS_TOTAL_H = innerH + LENS_AXIS_H;
  const lensClipId = `lens-clip-${Math.random().toString(36).slice(2, 8)}`;

  defs.append('clipPath')
    .attr('id', lensClipId)
    .append('rect')
    .attr('class', 'lens-clip-rect')
    .attr('width', LENS_W)
    .attr('height', innerH);

  const lensG = g.append('g')
    .attr('class', 'lens')
    .style('display', 'none')
    .style('pointer-events', 'none');

  // Lens background tint + content (clipped) + axis (in bottom band) + border.
  lensG.append('rect')
    .attr('class', 'lens-bg')
    .attr('width', LENS_W)
    .attr('height', LENS_TOTAL_H);
  // Mask the outer X-axis labels that sit directly under the lens so they
  // don't bleed through. Same bg, drawn over the axis band.
  lensG.append('rect')
    .attr('class', 'lens-axis-mask')
    .attr('y', innerH)
    .attr('width', LENS_W)
    .attr('height', LENS_AXIS_H);
  const lensContentG = lensG.append('g')
    .attr('class', 'lens-content')
    .attr('clip-path', `url(#${lensClipId})`);
  const lensAxisG = lensG.append('g')
    .attr('class', 'lens-axis')
    .attr('transform', `translate(0,${innerH})`);
  lensG.append('rect')
    .attr('class', 'lens-border')
    .attr('width', LENS_W)
    .attr('height', LENS_TOTAL_H);

  // Pre-build line/area generators for the lens (use innerXScale set per frame).
  const innerXScale = d3.scaleLinear().range([0, LENS_W]);
  const lensLineGen = d3.line()
    .x(d => innerXScale(d.frac))
    .y(d => yScale(d.value))
    .curve(d3.curveCatmullRom.alpha(0.5));
  const lensAreaGen = d3.area()
    .x(d => innerXScale(d.frac))
    .y0(innerH)
    .y1(d => yScale(d.value))
    .curve(d3.curveCatmullRom.alpha(0.5));

  // Renders lens contents centered on a cursor X coordinate.
  function renderLens(cursorX) {
    // Center the lens on the cursor along X, clamped so it stays inside the chart.
    const lensX = Math.max(0, Math.min(innerW - LENS_W, cursorX - LENS_W / 2));
    lensG.attr('transform', `translate(${lensX},0)`);

    // Year window covered by the lens, mapped from cursor X (not lens X) so
    // the centre of magnification follows the mouse precisely when not clamped.
    const cursorYear = xScale.invert(cursorX);
    let yStart = cursorYear - LENS_YEAR_SPAN / 2;
    let yEnd   = cursorYear + LENS_YEAR_SPAN / 2;
    // Clamp window to the filter range so we don't display empty space.
    if (yStart < filterStart) { yEnd += (filterStart - yStart); yStart = filterStart; }
    if (yEnd   > filterEnd)   { yStart -= (yEnd - filterEnd);   yEnd   = filterEnd;   }
    innerXScale.domain([yStart, yEnd]);

    // Clear previous lens-content paths and redraw quarterly series in window.
    lensContentG.selectAll('*').remove();

    quarterlyEntries.forEach(([feature, qseries]) => {
      // Include a small padding on each side so the curve enters/exits cleanly.
      const inWindow = qseries.filter(p => p.frac >= yStart - 0.25 && p.frac <= yEnd + 0.25);
      if (inWindow.length < 2) return;
      lensContentG.append('path')
        .attr('class', 'lens-area')
        .attr('fill', `url(#gradient-${feature})`)
        .attr('opacity', 0.7)
        .attr('d', lensAreaGen(inWindow));
      lensContentG.append('path')
        .attr('class', 'lens-line')
        .attr('fill', 'none')
        .attr('stroke', FEATURE_COLORS[feature])
        .attr('stroke-width', 2.25)
        .attr('d', lensLineGen(inWindow));
    });

    // Year labels at each Q1 inside the lens' bottom band. Q2/Q3/Q4 get
    // small unlabelled ticks so the user still sees the quarter cadence.
    const yearTickData = [];
    const quarterTickData = [];
    for (let y = Math.ceil(yStart - 1); y <= Math.floor(yEnd) + 1; y++) {
      for (let q = 1; q <= 4; q++) {
        const frac = y + (q - 1) / 4;
        if (frac < yStart || frac > yEnd) continue;
        if (q === 1) yearTickData.push({ year: y, frac });
        else quarterTickData.push({ year: y, quarter: q, frac });
      }
    }

    const yticks = lensAxisG.selectAll('g.lens-tick-year').data(yearTickData, d => d.year);
    yticks.exit().remove();
    const ytickEnter = yticks.enter().append('g').attr('class', 'lens-tick-year');
    ytickEnter.append('line').attr('y1', 0).attr('y2', 5)
      .attr('stroke', 'currentColor').attr('stroke-width', 1.25).attr('opacity', 0.7);
    ytickEnter.append('text').attr('y', 16).attr('text-anchor', 'middle')
      .attr('font-size', 10).attr('font-family', FONT_STACK)
      .attr('font-weight', 500).attr('fill', 'currentColor');
    const allYTicks = ytickEnter.merge(yticks);
    allYTicks.attr('transform', d => `translate(${innerXScale(d.frac)},0)`);
    allYTicks.select('text').text(d => `${d.year}`);

    const qticks = lensAxisG.selectAll('g.lens-tick-q')
      .data(quarterTickData, d => `${d.year}-${d.quarter}`);
    qticks.exit().remove();
    const qtickEnter = qticks.enter().append('g').attr('class', 'lens-tick-q');
    qtickEnter.append('line').attr('y1', 0).attr('y2', 3)
      .attr('stroke', 'currentColor').attr('stroke-width', 1).attr('opacity', 0.35);
    qtickEnter.merge(qticks)
      .attr('transform', d => `translate(${innerXScale(d.frac)},0)`);

    return { lensX, yStart, yEnd };
  }

  // Compute the quarter under a cursor X (assumes cursorX is in chart-inner coords).
  function quarterUnderCursor(cursorX, lensState) {
    const { lensX, yStart, yEnd } = lensState;
    const xInLens = cursorX - lensX;
    const xClamped = Math.max(0, Math.min(LENS_W, xInLens));
    const frac = yStart + (xClamped / LENS_W) * (yEnd - yStart);
    const year = Math.floor(frac);
    const q = Math.min(4, Math.max(1, Math.floor((frac - year) * 4) + 1));
    return { year, quarter: q };
  }

  // Track the most recent lens state so click can use it (no re-render needed).
  let lensState = null;

  // Re-show the lens at the persisted cursor position when re-rendering
  // mid-interaction (e.g. just clicked to pin a quarter, chart rebuilt).
  // Without this the lens disappears after a click and the user thinks
  // nothing happened.
  if (zoomMode && lastMouseChartX != null
      && lastMouseChartX >= 0 && lastMouseChartX <= innerW) {
    lensState = renderLens(lastMouseChartX);
    lensG.style('display', null);
  }

  g.append('rect')
    .attr('class', 'chart-overlay')
    .attr('width',  innerW)
    .attr('height', innerH)
    .attr('fill',   'transparent')
    .style('cursor', zoomMode ? 'zoom-in' : 'pointer')
    .on('mouseenter', () => {
      if (zoomMode) {
        lensG.style('display', null);
      } else {
        focusG.style('display', null);
      }
    })
    .on('mouseleave', () => {
      lensG.style('display', 'none');
      focusG.style('display', 'none');
      tooltip.hide();
      lastMouseChartX = null;
    })
    .on('click', function(event) {
      try {
        const [mx] = d3.pointer(event);
        lastMouseChartX = mx;
        if (zoomMode) {
          // Click inside the lens pins a quarter; toggle off if it's already pinned.
          const state = lensState || renderLens(mx);
          const { year: yr, quarter: q } = quarterUnderCursor(mx, state);
          const same = pinnedPeriod && pinnedPeriod.type === 'quarter'
            && pinnedPeriod.year === yr && pinnedPeriod.quarter === q;
          pinnedPeriod = same ? null : { type: 'quarter', year: yr, quarter: q };
          render();
          return;
        }
        const yr = Math.round(xScale.invert(mx));
        const same = pinnedPeriod && pinnedPeriod.type === 'year' && pinnedPeriod.year === yr;
        pinnedPeriod = same ? null : { type: 'year', year: yr };
        render();
      } catch (err) {
        console.error('Resonance timeline click handler failed:', err);
      }
    })
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      lastMouseChartX = mx;

      if (zoomMode) {
        lensState = renderLens(mx);
        // Show a quarter-level tooltip pegged to the cursor.
        const { year: yr, quarter: q } = quarterUnderCursor(mx, lensState);
        const featureRows = quarterlyEntries.map(([feature, qseries]) => {
          const pt = qseries.find(p => p.year === yr && p.quarter === q);
          const raw = pt ? pt.value : null;
          const display = raw != null
            ? (feature === 'tempo' ? `${(raw * TEMPO_NORM).toFixed(0)} BPM` : `${(raw * 100).toFixed(1)}%`)
            : '—';
          return { label: FEATURE_LABELS[feature], value: display, color: FEATURE_COLORS[feature] };
        });
        const activeCrises = crises.filter(c => yr >= +c.start_year && yr <= +c.end_year);
        tooltip.show(event, tooltipHtml(`${yr} Q${q}`, [
          ...featureRows,
          ...activeCrises.map(c => ({ label: CRISIS_LABELS[c.crisis_type] || 'Crisis', value: c.crisis_name, color: CRISIS_COLORS[c.crisis_type] })),
        ]));
        tooltip.move(event);
        return;
      }

      const year = xScale.invert(mx);
      const ref  = seriesByFeature[primaryFeature];
      const idx  = bisect(ref, year);
      const d    = ref[idx];
      if (!d) return;

      const x = xScale(d.year);
      focusG.select('.focus-line')
        .attr('transform', `translate(${x},0)`);

      featureEntries.forEach(([feature, fseries]) => {
        const pt = fseries[bisect(fseries, d.year)];
        if (!pt) return;
        focusG.select(`.focus-dot-${feature}`)
          .attr('transform', `translate(${x},${yScale(pt.value)})`);
      });

      const featureRows = featureEntries.map(([feature, fseries]) => {
        const pt = fseries[bisect(fseries, d.year)];
        const raw = pt ? pt.value : null;
        const display = raw != null
          ? (feature === 'tempo' ? `${(raw * TEMPO_NORM).toFixed(0)} BPM` : `${(raw * 100).toFixed(1)}%`)
          : '—';
        return { label: FEATURE_LABELS[feature], value: display, color: FEATURE_COLORS[feature] };
      });

      const activeCrises = crises.filter(c => d.year >= +c.start_year && d.year <= +c.end_year);
      tooltip.show(event, tooltipHtml(`${d.year}`, [
        ...featureRows,
        ...activeCrises.map(c => ({ label: CRISIS_LABELS[c.crisis_type] || 'Crisis', value: c.crisis_name, color: CRISIS_COLORS[c.crisis_type] })),
      ]));
      tooltip.move(event);
    });

  // ── Single unified crisis strip ───────────────────────────
  const STRIP_Y = innerH + 56;
  const STRIP_H = 10;

  const stripG = g.append('g').attr('class', 'crisis-strip');

  // Faint track background
  stripG.append('rect')
    .attr('x', 0).attr('y', STRIP_Y)
    .attr('width', innerW).attr('height', STRIP_H)
    .attr('fill', 'rgba(255,255,255,0.04)').attr('rx', 2);

  // Draw crises lowest-priority first so higher-priority sit on top
  const sortedCrises = [...crises].sort(
    (a, b) => (CRISIS_PRIORITY[a.crisis_type] || 0) - (CRISIS_PRIORITY[b.crisis_type] || 0)
  );

  sortedCrises.forEach(crisis => {
    const x1 = xScale(Math.max(+crisis.start_year, filterStart));
    const x2 = xScale(Math.min(+crisis.end_year,   filterEnd));
    if (x2 <= x1) return;

    stripG.append('rect')
      .attr('x', x1).attr('y', STRIP_Y)
      .attr('width', x2 - x1).attr('height', STRIP_H)
      .attr('fill', CRISIS_COLORS[crisis.crisis_type])
      .attr('opacity', 0.8).attr('rx', 2)
      .on('mouseenter', event => tooltip.show(event, tooltipHtml(crisis.crisis_name, [
        { label: 'Type',   value: CRISIS_LABELS[crisis.crisis_type] },
        { label: 'Period', value: `${crisis.start_year}–${crisis.end_year}` },
      ])))
      .on('mousemove',  event => tooltip.move(event))
      .on('mouseleave', ()    => tooltip.hide());
  });

  // Hand the freshly-drawn chart to the insight-card spotlight. A rebuild
  // wipes any active spotlight; that's fine, it re-fires on the next hover.
  chartCtx = { g, xScale, yScale, seriesByFeature, innerH, filterStart, filterEnd };

  updateInsightCards(series, primaryFeature, crises);
  updateInsightBox(seriesByFeature, quarterlyByFeature, crises, filters, primaryFeature);
  updateBadge();
}

// ── Linked highlighting: spotlight a year/feature from an insight card ──
// The Peak/Break/Floor story cards dispatch `resonance:spotlight` on hover.
// We draw a transient guide + dot at the referenced year and dim the other
// feature lines, so the card and the timeline read as one coordinated view
// (mirrors the genre-forecast brushing pattern). spec = {year, feature} | null.
function setTimelineSpotlight(spec) {
  if (!chartCtx) return;
  const { g, xScale, yScale, seriesByFeature, innerH, filterStart, filterEnd } = chartCtx;

  // Clear any previous spotlight and restore line opacities.
  g.selectAll('.card-spotlight').remove();
  g.selectAll('.feature-line').attr('opacity', 1);

  if (!spec) return;
  const year = +spec.year;
  if (!Number.isFinite(year) || year < filterStart || year > filterEnd) return;

  const fseries = seriesByFeature[spec.feature];
  const hasFeature = !!(fseries && fseries.length);

  // Dim the other lines so the card's feature stands out.
  if (hasFeature) {
    g.selectAll('.feature-line').attr('opacity', function () {
      return this.classList.contains(`feature-line-${spec.feature}`) ? 1 : 0.15;
    });
  }

  const sg = g.append('g').attr('class', 'card-spotlight').style('pointer-events', 'none');
  const x  = xScale(year);

  sg.append('line')
    .attr('x1', x).attr('x2', x)
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', 'var(--acid)')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 3')
    .attr('opacity', 0.9);

  let labelText = String(year);
  if (hasFeature) {
    const pt = fseries.reduce((best, d) =>
      Math.abs(d.year - year) < Math.abs(best.year - year) ? d : best);
    sg.append('circle')
      .attr('cx', x).attr('cy', yScale(pt.value)).attr('r', 6)
      .attr('fill', FEATURE_COLORS[spec.feature] || 'var(--acid)')
      .attr('stroke', cv('--text-primary', '#f1f5f9')).attr('stroke-width', 2);
    labelText = `${FEATURE_LABELS[spec.feature]} ${(pt.value * 100).toFixed(0)}% · ${year}`;
  }

  // Label chip near the top of the guide, kept inside the plot horizontally.
  const labelG = sg.append('g');
  const txt = labelG.append('text')
    .attr('y', -8)
    .attr('text-anchor', 'middle')
    .attr('font-family', FONT_STACK)
    .attr('font-size', 11)
    .attr('font-weight', 600)
    .attr('fill', cv('--text-primary', '#f1f5f9'))
    .text(labelText);
  const bbox = txt.node().getBBox();
  const cx = Math.max(bbox.width / 2 + 2, Math.min(innerW - bbox.width / 2 - 2, x));
  txt.attr('x', cx);
  labelG.insert('rect', 'text')
    .attr('x', cx - bbox.width / 2 - 6).attr('y', bbox.y - 3)
    .attr('width', bbox.width + 12).attr('height', bbox.height + 6)
    .attr('rx', 3)
    .attr('fill', 'rgba(15,23,42,0.92)')
    .attr('stroke', 'var(--acid)').attr('stroke-opacity', 0.5);
}

// ── Insight box (year-detail panel) ───────────────────────────
function updateInsightBox(seriesByFeature, quarterlyByFeature, crises, filters, primaryFeature) {
  const box = document.getElementById('insight-box');
  if (!box) return;

  // ── Empty state ───────────────────────────────────────────
  if (pinnedPeriod == null) {
    box.classList.add('is-empty');
    box.innerHTML = `
      <div class="insight-box-cta">
        <span class="insight-box-cta-arrow" aria-hidden="true">↑</span>
        <span class="insight-box-cta-text">
          <strong>Click any year on the timeline above</strong> to pin a year-detail card here.
        </span>
      </div>`;
    return;
  }

  const isQuarterPin = pinnedPeriod.type === 'quarter';
  const year   = pinnedPeriod.year;
  const quarter = isQuarterPin ? pinnedPeriod.quarter : null;
  const periodLabel = isQuarterPin ? `${year} Q${quarter}` : `${year}`;

  // ── Populated state: rebuild skeleton if needed, then render ──
  box.classList.remove('is-empty');
  if (!document.getElementById('insight-year')) {
    box.innerHTML = `
      <header class="insight-box-header">
        <h2 class="insight-box-title" id="insight-year">—</h2>
        <p class="insight-box-hint">Click again to unpin · click another year to switch.</p>
      </header>
      <div class="insight-box-grid">
        <div class="insight-box-col" id="insight-delta">
          <p class="insight-box-sub" id="insight-delta-sub">VS. BASELINE</p>
          <div class="insight-box-rows" id="insight-delta-rows"></div>
          <div class="insight-box-crises" id="insight-delta-crises"></div>
        </div>
        <div class="insight-box-col" id="insight-region">
          <p class="insight-box-sub" id="insight-region-sub">BY REGION</p>
          <div class="insight-box-tabs" id="insight-region-tabs" role="tablist"></div>
          <div class="insight-box-bars" id="insight-region-bars"></div>
          <div class="insight-box-foot" id="insight-region-foot"></div>
        </div>
      </div>`;
  }

  const titleEl       = document.getElementById('insight-year');
  const deltaSubEl    = document.getElementById('insight-delta-sub');
  const deltaRowsEl   = document.getElementById('insight-delta-rows');
  const deltaCrisesEl = document.getElementById('insight-delta-crises');
  const regionSubEl   = document.getElementById('insight-region-sub');
  const regionBarsEl  = document.getElementById('insight-region-bars');
  const regionFootEl  = document.getElementById('insight-region-foot');

  titleEl.textContent = periodLabel;

  // ── Crisis-delta column ───────────────────────────────────
  // Default baseline: the 3 periods immediately preceding the pinned one.
  // If the year sits inside one or more active crises, pivot the baseline
  // to the 3 years before the *crisis* began — so the comparison answers
  // "how did music change because of this event?" rather than a rolling
  // drift. Highest-priority crisis wins when several overlap.
  // Quarter pins always use the prior-3-quarter baseline (no crisis pivot)
  // because crisis dates are year-precision.
  const overlappingCrises = crises.filter(c => year >= +c.start_year && year <= +c.end_year);
  const headlineCrisis = (!isQuarterPin && overlappingCrises.length)
    ? [...overlappingCrises].sort(
        (a, b) => (CRISIS_PRIORITY[b.crisis_type] || 0) - (CRISIS_PRIORITY[a.crisis_type] || 0)
      )[0]
    : null;

  // For quarter pins, baseline is the 3 prior quarters (as {year, quarter} pairs).
  // For year pins, baseline is the 3 prior years (anchored on crisis start if applicable).
  let baselineLabel;
  let priorQuarters = null;        // populated for quarter pins
  let baselineYears = null;        // populated for year pins
  if (isQuarterPin) {
    priorQuarters = [3, 2, 1].map(off => {
      let y = year, q = quarter - off;
      while (q < 1) { q += 4; y -= 1; }
      return { year: y, quarter: q };
    });
    const first = priorQuarters[0], last = priorQuarters[2];
    baselineLabel = `VS. ${first.year} Q${first.quarter}–${last.year} Q${last.quarter}`;
  } else {
    const baselineAnchor = headlineCrisis ? +headlineCrisis.start_year : year;
    baselineYears = [baselineAnchor - 3, baselineAnchor - 2, baselineAnchor - 1];
    baselineLabel = headlineCrisis
      ? `VS. PRE-CRISIS (${baselineAnchor - 3}–${baselineAnchor - 1})`
      : `VS. ${year - 3}–${year - 1} BASELINE`;
  }
  deltaSubEl.textContent = baselineLabel;

  const featureEntries = Object.entries(seriesByFeature);
  const rowsHtml = featureEntries.map(([feature, fseries]) => {
    let pt, baseline;
    if (isQuarterPin) {
      const qseries = quarterlyByFeature[feature] || [];
      pt = qseries.find(p => p.year === year && p.quarter === quarter);
      const baselinePts = qseries.filter(p =>
        priorQuarters.some(b => b.year === p.year && b.quarter === p.quarter)
      );
      baseline = baselinePts.length ? d3.mean(baselinePts, p => p.value) : null;
    } else {
      pt = fseries.find(p => p.year === year);
      const baselinePts = fseries.filter(p => baselineYears.includes(p.year));
      baseline = baselinePts.length ? d3.mean(baselinePts, p => p.value) : null;
    }
    const isTempo = feature === 'tempo';

    const valueText = pt
      ? (isTempo ? `${(pt.value * TEMPO_NORM).toFixed(0)} BPM` : `${(pt.value * 100).toFixed(1)}%`)
      : '—';

    let deltaText = '—';
    let deltaCls  = 'flat';
    if (pt && baseline != null) {
      const diffPts = (pt.value - baseline) * 100;          // valence/energy/dance: percentage points
      const diffBpm = (pt.value - baseline) * TEMPO_NORM;   // tempo: BPM
      const shown   = isTempo ? diffBpm : diffPts;
      const unit    = isTempo ? ' BPM' : ' pts';
      const arrow   = Math.abs(shown) < 0.5 ? '▬' : (shown > 0 ? '▲' : '▼');
      deltaCls      = Math.abs(shown) < 0.5 ? 'flat' : (shown > 0 ? 'up' : 'down');
      deltaText     = `${arrow} ${Math.abs(shown).toFixed(1)}${unit}`;
    }

    return `
      <div class="insight-row">
        <span class="insight-row-label" style="color:${FEATURE_COLORS[feature]}">${FEATURE_LABELS[feature]}</span>
        <span class="insight-row-value">${valueText}</span>
        <span class="insight-row-delta ${deltaCls}">${deltaText}</span>
      </div>`;
  }).join('');
  deltaRowsEl.innerHTML = rowsHtml || '<p class="insight-empty">No active features.</p>';

  // Active crises overlapping the selected year, respecting current filter.
  deltaCrisesEl.innerHTML = overlappingCrises.length
    ? overlappingCrises.map(c => `
        <span class="insight-crisis-pill" style="color:${CRISIS_COLORS[c.crisis_type]}">
          <span class="insight-crisis-dot" style="background:${CRISIS_COLORS[c.crisis_type]}"></span>
          ${c.crisis_name}
        </span>`).join('')
    : `<span class="insight-empty">No crises active in this ${isQuarterPin ? 'quarter' : 'year'}.</span>`;

  // ── Regional split column ─────────────────────────────────
  if (!usingRegionData) {
    regionSubEl.textContent = 'BY REGION';
    regionBarsEl.innerHTML  = '<p class="insight-empty">Region data not loaded yet. Run data/fetch_artist_countries.py to enable.</p>';
    regionFootEl.innerHTML  = '';
    return;
  }

  // Active audio features = those currently enabled in the sidebar.
  const activeFeatures = filters.audioFeatures
    .filter(f => Object.keys(FEATURE_COLORS).includes(f));

  // Resolve the active region feature. Fall back to primary when the
  // current selection is no longer enabled (e.g. user just unchecked it).
  if (!activeFeatures.includes(regionFeature)) {
    regionFeature = activeFeatures.includes(primaryFeature)
      ? primaryFeature
      : activeFeatures[0] || null;
  }
  const featureForRegion = regionFeature;

  if (!featureForRegion) {
    regionSubEl.textContent = 'BY REGION';
    document.getElementById('insight-region-tabs').innerHTML = '';
    regionBarsEl.innerHTML = '<p class="insight-empty">Enable an audio feature in the sidebar.</p>';
    regionFootEl.innerHTML = '';
    return;
  }

  const featureLabel = FEATURE_LABELS[featureForRegion] || featureForRegion;
  const isTempo      = featureForRegion === 'tempo';
  regionSubEl.textContent = `${featureLabel.toUpperCase()} vs. EUROPE`;

  // Render the segmented tabs (one per active audio feature).
  const tabsEl = document.getElementById('insight-region-tabs');
  tabsEl.innerHTML = activeFeatures.map(f => {
    const isActive = f === featureForRegion;
    return `
      <button type="button"
              class="insight-tab${isActive ? ' is-active' : ''}"
              data-feature="${f}"
              role="tab"
              aria-selected="${isActive}"
              style="--tab-color:${FEATURE_COLORS[f]}">
        ${FEATURE_LABELS[f]}
      </button>`;
  }).join('');
  tabsEl.querySelectorAll('button[data-feature]').forEach(btn => {
    btn.addEventListener('click', () => {
      regionFeature = btn.dataset.feature;
      render();
    });
  });

  const REGION_COLORS = Object.fromEntries(
    ['europe', 'north america', 'latin america', 'africa', 'asia', 'oceania']
      .map(r => [r, regionColor(r)]));
  const REGION_LABELS = {
    europe:           'Europe',
    'north america':  'North America',
    'latin america':  'Latin America',
    africa:           'Africa',
    asia:             'Asia',
    oceania:          'Oceania',
  };

  // filters.js seeds its default state from a shared list and may include
  // region keys this page doesn't model (e.g. the legacy 'americas' bucket
  // that we've now split into north/latin). Drop anything we don't have a
  // label for so it doesn't render as a ghost row.
  const regionsSelected = filters.regions.filter(r => REGION_LABELS[r]);
  const regionStats = regionsSelected.map(region => {
    const tracks = rawMergedTracks.filter(t => {
      if (t.region !== region || +t.year !== year) return false;
      if (isQuarterPin && t.quarter !== quarter) return false;
      return true;
    });
    const valid  = tracks.filter(t => Number.isFinite(+t[featureForRegion]));
    if (!valid.length) return { region, value: null, count: 0 };
    const mean = d3.mean(valid, t => {
      const v = +t[featureForRegion];
      return isTempo ? v / TEMPO_NORM : v;
    });
    return { region, value: mean, count: valid.length };
  });

  // All selected regions are absent → keep box visible but no footer.
  const anyData = regionStats.some(s => s.value != null);
  if (!anyData) {
    regionBarsEl.innerHTML = `<p class="insight-empty">No tracks for ${periodLabel} in the selected regions.</p>`;
    regionFootEl.innerHTML = '';
    return;
  }

  const fmtVal = v => isTempo ? `${(v * TEMPO_NORM).toFixed(0)} BPM` : `${(v * 100).toFixed(1)}%`;
  const fmtDelta = d => {
    const shown = isTempo ? d * TEMPO_NORM : d * 100;
    const unit  = isTempo ? ' BPM' : ' pts';
    const arrow = Math.abs(shown) < 0.5 ? '▬' : (shown > 0 ? '▲' : '▼');
    const cls   = Math.abs(shown) < 0.5 ? 'flat' : (shown > 0 ? 'up' : 'down');
    return { html: `${arrow} ${Math.abs(shown).toFixed(1)}${unit}`, cls };
  };

  // Europe is the anchor; if it's not in the selected regions (shouldn't
  // happen now that the checkbox is locked, but guard anyway), fall back
  // to the old absolute-value rendering.
  const europeStat = regionStats.find(s => s.region === 'europe');
  const others     = regionStats.filter(s => s.region !== 'europe');

  if (!europeStat || europeStat.value == null) {
    regionBarsEl.innerHTML = regionStats.map(s => {
      const valTxt = s.value == null ? '<span class="insight-na-tag">no data</span>' : fmtVal(s.value);
      return `
        <div class="insight-bar-row${s.value == null ? ' is-empty' : ''}">
          <span class="insight-bar-label">${REGION_LABELS[s.region]}</span>
          <span class="insight-bar-value">${valTxt}</span>
        </div>`;
    }).join('');
    regionFootEl.innerHTML = `<span class="insight-empty">No European tracks for ${periodLabel} — showing absolute values.</span>`;
    return;
  }

  // Europe row: shown first as the explicit baseline (absolute value).
  const europeRowHtml = `
    <div class="insight-bar-row" style="border-bottom:1px solid var(--border, rgba(255,255,255,0.08));padding-bottom:0.4rem;margin-bottom:0.2rem;">
      <span class="insight-bar-label" style="font-weight:600;color:${REGION_COLORS.europe}">${REGION_LABELS.europe}</span>
      <span class="insight-bar-value">${fmtVal(europeStat.value)} <span style="opacity:0.55;font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;margin-left:0.35em;">baseline</span></span>
    </div>`;

  // Other regions: signed delta vs. Europe.
  const otherRowsHtml = others.map(s => {
    if (s.value == null) {
      return `
        <div class="insight-bar-row is-empty" title="No tracks attributed to this region for ${periodLabel}">
          <span class="insight-bar-label">${REGION_LABELS[s.region]}</span>
          <span class="insight-row-delta flat"><span class="insight-na-tag">no data</span></span>
        </div>`;
    }
    const { html, cls } = fmtDelta(s.value - europeStat.value);
    return `
      <div class="insight-bar-row">
        <span class="insight-bar-label" style="color:${REGION_COLORS[s.region]}">${REGION_LABELS[s.region]}</span>
        <span class="insight-row-delta ${cls}">${html}</span>
      </div>`;
  }).join('');

  regionBarsEl.innerHTML = europeRowHtml + otherRowsHtml;

  // Footer: closest / furthest from Europe (by absolute gap).
  const presentOthers = others.filter(s => s.value != null);
  if (presentOthers.length) {
    const byGap   = [...presentOthers].sort(
      (a, b) => Math.abs(a.value - europeStat.value) - Math.abs(b.value - europeStat.value)
    );
    const closest = byGap[0];
    const furthest = byGap[byGap.length - 1];
    regionFootEl.innerHTML = `
      <span><span class="insight-foot-label">Closest to Europe</span><span class="insight-foot-value">${REGION_LABELS[closest.region]}</span></span>
      <span><span class="insight-foot-label">Furthest</span><span class="insight-foot-value">${REGION_LABELS[furthest.region]}</span></span>
    `;
  } else {
    regionFootEl.innerHTML = '';
  }
}

// ── Insight cards ─────────────────────────────────────────────
function updateInsightCards(series, feature, crises) {
  if (!series.length) return;
  const label  = FEATURE_LABELS[feature] || feature;
  const isTemp = feature === 'tempo';
  const fmt    = v => isTemp ? `${(v * TEMPO_NORM).toFixed(0)} BPM` : `${(v * 100).toFixed(1)}%`;

  const meanVal = d3.mean(series, d => d.value);
  const minPt   = series.reduce((m, d) => d.value < m.value ? d : m);
  const maxPt   = series.reduce((m, d) => d.value > m.value ? d : m);

  setCard('card-avg-valence', fmt(meanVal),   `Overall avg. ${label}`);
  setCard('card-lowest',      `${minPt.year}`, `Lowest ${label} year (${fmt(minPt.value)})`);
  setCard('card-highest',     `${maxPt.year}`, `Highest ${label} year (${fmt(maxPt.value)})`);
  setCard('card-crises',      crises.length,   'Crisis periods overlaid');
}

function updateBadge() {
  const badge = document.querySelector('.viz-sample-badge');
  if (!badge) return;
  if (usingRealValence && usingRealCrises) {
    badge.style.display = 'none';
  } else if (usingRealCrises) {
    badge.textContent = 'Valence: sample data';
    badge.style.display = '';
  } else {
    badge.textContent = 'Sample data';
    badge.style.display = '';
  }
}

function setCard(id, value, desc) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = el.querySelector('.insight-card-value');
  const d = el.querySelector('.insight-card-desc');
  if (v) v.textContent = value;
  if (d) d.textContent = desc;
}
