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
  tempo:        'Tempo (norm.)',
  danceability: 'Danceability',
};

const TEMPO_NORM  = 200;
const FONT_STACK  = 'Inter, system-ui, sans-serif';
const CRISIS_PRIORITY = { pandemic: 3, armed_conflict: 2, economic: 1 };

let rawTracks = null;
let rawCrises = null;
let usingRealCrises  = false;
let usingRealValence = false;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  // ── Valence data ──────────────────────────────────────────
  const byYear = await loadCSV('../data/valence-by-year.csv').catch(() => null);
  if (byYear && byYear.length) {
    rawTracks = byYear;
    usingRealValence = true;
  } else {
    rawTracks = mockSpotifyTracks(300);
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

  for (const feature of activeFeatures) {
    let raw;

    if (usingRealValence) {
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
        t.year >= start && t.year <= end &&
        filters.regions.some(r => r.toLowerCase() === t.region.toLowerCase())
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

  const crises = rawCrises.filter(c =>
    filters.crisisTypes.includes(c.crisis_type) &&
    +c.start_year <= end && +c.end_year >= start
  );

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
    ? `Avg. ${FEATURE_LABELS[featureEntries[0][0]]}${featureEntries[0][0] === 'tempo' ? ' (norm.)' : ' score'}`
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

  g.append('rect')
    .attr('width',  innerW)
    .attr('height', innerH)
    .attr('fill',   'transparent')
    .on('mouseenter', () => focusG.style('display', null))
    .on('mouseleave', () => { focusG.style('display', 'none'); tooltip.hide(); })
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
  updateBadge();
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
