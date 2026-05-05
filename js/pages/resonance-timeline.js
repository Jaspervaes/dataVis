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

const CRISIS_COLORS = {
  economic:      '#f0a830',
  armed_conflict:'#e5321c',
  pandemic:      '#6aabf0',
};

const CRISIS_LABELS = {
  economic:      'Economic',
  armed_conflict:'Armed Conflict',
  pandemic:      'Pandemic',
};

const FEATURE_COLORS = {
  valence:      'var(--acid)',
  energy:       '#fb923c',
  tempo:        '#a78bfa',
  danceability: '#34d399',
};

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
// data/fetch_musicbrainz.py but flattens the Americas (the sidebar
// here uses europe/americas/africa/asia/oceania, not the split scheme).
const COUNTRY_TO_REGION = {
  GB:'europe',DE:'europe',FR:'europe',SE:'europe',NO:'europe',NL:'europe',
  BE:'europe',IT:'europe',ES:'europe',PT:'europe',DK:'europe',FI:'europe',
  PL:'europe',RU:'europe',UA:'europe',IE:'europe',CH:'europe',AT:'europe',
  HU:'europe',CZ:'europe',RO:'europe',GR:'europe',RS:'europe',HR:'europe',
  IS:'europe',LU:'europe',SK:'europe',SI:'europe',LV:'europe',LT:'europe',
  EE:'europe',BA:'europe',MK:'europe',ME:'europe',AL:'europe',BG:'europe',
  CY:'europe',MT:'europe',MD:'europe',BY:'europe',
  US:'americas',CA:'americas',MX:'americas',BR:'americas',CO:'americas',
  AR:'americas',CL:'americas',PE:'americas',VE:'americas',CU:'americas',
  JM:'americas',TT:'americas',DO:'americas',PA:'americas',EC:'americas',
  BO:'americas',UY:'americas',PY:'americas',GT:'americas',HN:'americas',
  CR:'americas',SV:'americas',NI:'americas',HT:'americas',PR:'americas',
  BS:'americas',BB:'americas',GY:'americas',VC:'americas',VG:'americas',
  VI:'americas',
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
let pinnedYear      = null;   // null = no insight box; otherwise the focused year
let regionFeature   = null;   // which audio feature drives the regional column

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
      .map(t => ({ ...t, region: artistToRegion.get(t.principal_artist_name) || null }))
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

  render();

  window.addEventListener('filters:changed', render);
  window.addEventListener('resize', render);
});

// ── Data preparation ─────────────────────────────────────────
function prepareData(filters) {
  const [start, end] = filters.decadeRange;
  const activeFeatures = filters.audioFeatures
    .filter(f => Object.keys(FEATURE_COLORS).includes(f));

  const seriesByFeature = {};

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
  }

  const crises = rawCrises.filter(c => {
    if (!filters.crisisTypes.includes(c.crisis_type)) return false;
    if (+c.start_year > end || +c.end_year < start) return false;
    if (!c.regions_affected) return true;
    const crisisRegions = c.regions_affected.split('|').map(r => r.trim().toLowerCase());
    return filters.regions.some(r => crisisRegions.includes(r.toLowerCase()));
  });

  return { seriesByFeature, crises };
}


// ── Render ────────────────────────────────────────────────────
function render() {
  const filters   = getFilters();
  const { seriesByFeature, crises } = prepareData(filters);
  const container = document.getElementById('viz-container');
  if (!container) return;
  container.innerHTML = '';

  const featureEntries = Object.entries(seriesByFeature);
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

  // Lines on top
  featureEntries.forEach(([feature, fseries]) => {
    g.append('path')
      .datum(fseries)
      .attr('fill', 'none')
      .attr('stroke', FEATURE_COLORS[feature])
      .attr('stroke-width', 2.5)
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
    .attr('stroke', '#475569')
    .attr('stroke-dasharray', '4 3')
    .attr('stroke-width', 1);

  // One dot per active feature
  featureEntries.forEach(([feature]) => {
    focusG.append('circle')
      .attr('class', `focus-dot focus-dot-${feature}`)
      .attr('r', 5)
      .attr('fill', FEATURE_COLORS[feature])
      .attr('stroke', '#f1f5f9')
      .attr('stroke-width', 1.5);
  });

  // Pinned-year vertical marker (separate from the hover focus line)
  if (pinnedYear != null && pinnedYear >= filterStart && pinnedYear <= filterEnd) {
    g.append('line')
      .attr('class', 'pinned-line')
      .attr('x1', xScale(pinnedYear)).attr('x2', xScale(pinnedYear))
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', 'var(--acid)')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8);
  }

  g.append('rect')
    .attr('width',  innerW)
    .attr('height', innerH)
    .attr('fill',   'transparent')
    .style('cursor', 'pointer')
    .on('mouseenter', () => focusG.style('display', null))
    .on('mouseleave', () => { focusG.style('display', 'none'); tooltip.hide(); })
    .on('click', function(event) {
      const [mx] = d3.pointer(event);
      const yr = Math.round(xScale.invert(mx));
      pinnedYear = (pinnedYear === yr) ? null : yr;
      render();
    })
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
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

  updateInsightCards(series, primaryFeature, crises);
  updateInsightBox(seriesByFeature, crises, filters, primaryFeature);
  updateBadge();
}

// ── Insight box (year-detail panel) ───────────────────────────
function updateInsightBox(seriesByFeature, crises, filters, primaryFeature) {
  const box = document.getElementById('insight-box');
  if (!box) return;

  // ── Empty state ───────────────────────────────────────────
  if (pinnedYear == null) {
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

  const year = pinnedYear;
  titleEl.textContent = year;

  // ── Crisis-delta column ───────────────────────────────────
  // Baseline = the 3 years immediately preceding the selected year,
  // clamped to whatever data the active features have available.
  const baselineYears = [year - 3, year - 2, year - 1];
  deltaSubEl.textContent = `VS. ${year - 3}–${year - 1} BASELINE`;

  const featureEntries = Object.entries(seriesByFeature);
  const rowsHtml = featureEntries.map(([feature, fseries]) => {
    const pt = fseries.find(p => p.year === year);
    const baselinePts = fseries.filter(p => baselineYears.includes(p.year));
    const baseline = baselinePts.length ? d3.mean(baselinePts, p => p.value) : null;
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
  const activeCrises = crises.filter(c => year >= +c.start_year && year <= +c.end_year);
  deltaCrisesEl.innerHTML = activeCrises.length
    ? activeCrises.map(c => `
        <span class="insight-crisis-pill" style="color:${CRISIS_COLORS[c.crisis_type]}">
          <span class="insight-crisis-dot" style="background:${CRISIS_COLORS[c.crisis_type]}"></span>
          ${c.crisis_name}
        </span>`).join('')
    : '<span class="insight-empty">No crises active in this year.</span>';

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
  regionSubEl.textContent = `${featureLabel.toUpperCase()} BY REGION`;

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

  const regionsSelected = filters.regions;
  const regionStats = regionsSelected.map(region => {
    const tracks = rawMergedTracks.filter(t => t.region === region && +t.year === year);
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
    regionBarsEl.innerHTML = `<p class="insight-empty">No tracks for ${year} in the selected regions.</p>`;
    regionFootEl.innerHTML = '';
    return;
  }

  const REGION_COLORS = {
    europe:   '#c8f000',
    americas: '#e5321c',
    africa:   '#f0a830',
    asia:     '#6aabf0',
    oceania:  '#82d4be',
  };
  const REGION_LABELS = {
    europe:'Europe', americas:'Americas', africa:'Africa', asia:'Asia', oceania:'Oceania',
  };

  const fmtVal = v => isTempo ? `${(v * TEMPO_NORM).toFixed(0)} BPM` : `${(v * 100).toFixed(1)}%`;

  regionBarsEl.innerHTML = regionStats.map(s => {
    if (s.value == null) {
      return `
        <div class="insight-bar-row is-empty" title="No tracks attributed to this region for ${year}">
          <span class="insight-bar-label">${REGION_LABELS[s.region]}</span>
          <span class="insight-bar-track">
            <span class="insight-bar-fill" style="width:0%"></span>
          </span>
          <span class="insight-bar-value"><span class="insight-na-tag">no data</span></span>
        </div>`;
    }
    const pct = Math.max(0, Math.min(1, s.value)) * 100;
    return `
      <div class="insight-bar-row">
        <span class="insight-bar-label">${REGION_LABELS[s.region]}</span>
        <span class="insight-bar-track">
          <span class="insight-bar-fill" style="width:${pct.toFixed(1)}%;background:${REGION_COLORS[s.region]}"></span>
        </span>
        <span class="insight-bar-value">${fmtVal(s.value)}</span>
      </div>`;
  }).join('');

  const present = regionStats.filter(s => s.value != null);
  const sorted  = [...present].sort((a, b) => b.value - a.value);
  const spread  = sorted[0].value - sorted[sorted.length - 1].value;
  const spreadTxt = isTempo
    ? `${(spread * TEMPO_NORM).toFixed(1)} BPM`
    : `${(spread * 100).toFixed(1)} pts`;

  regionFootEl.innerHTML = `
    <span><span class="insight-foot-label">Spread</span><span class="insight-foot-value">${spreadTxt}</span></span>
    <span><span class="insight-foot-label">Highest</span><span class="insight-foot-value">${REGION_LABELS[sorted[0].region]}</span></span>
  `;
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
