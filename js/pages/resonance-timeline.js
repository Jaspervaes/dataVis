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
  economic:      '#f0a830',  // amber
  armed_conflict:'#e5321c',  // red
  pandemic:      '#6aabf0',  // cool blue
};

const CRISIS_LABELS = {
  economic:      'Economic',
  armed_conflict:'Armed Conflict',
  pandemic:      'Pandemic',
};

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

  let series;

  if (usingRealValence) {
    // Pre-aggregated: one row per year, no region breakdown
    const filtered = rawTracks.filter(t => t.year >= start && t.year <= end);
    series = filtered.map(d => ({ year: +d.year, valence: +d.valence }))
      .sort((a, b) => a.year - b.year);
  } else {
    // Individual tracks: filter by year + region, then aggregate
    const filtered = rawTracks.filter(t =>
      t.year >= start && t.year <= end &&
      filters.regions.some(r => r.toLowerCase() === t.region.toLowerCase())
    );
    const byYear = d3.rollup(filtered, v => d3.mean(v, d => d.valence), d => d.year);
    series = Array.from(byYear, ([year, valence]) => ({ year, valence }))
      .sort((a, b) => a.year - b.year);
  }

  // Smooth with rolling 3-year average
  const smoothed = series.map((d, i) => {
    const win = series.slice(Math.max(0, i - 1), i + 2);
    return { year: d.year, valence: d3.mean(win, w => w.valence) };
  });

  // Filter crises
  const crises = rawCrises.filter(c =>
    filters.crisisTypes.includes(c.crisis_type) &&
    +c.start_year <= end && +c.end_year >= start
  );

  return { series: smoothed, crises };
}

// ── Crisis range merger ───────────────────────────────────────
// Collapses overlapping/adjacent crises of the same type into
// continuous bands so the main chart background stays readable.
function mergeCrisisRanges(crises) {
  const result = {};
  for (const type of Object.keys(CRISIS_COLORS)) {
    const sorted = crises
      .filter(c => c.crisis_type === type)
      .map(c => ({ start: +c.start_year, end: +c.end_year }))
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of sorted) {
      if (merged.length && r.start <= merged[merged.length - 1].end + 1) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
      } else {
        merged.push({ ...r });
      }
    }
    result[type] = merged;
  }
  return result;
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const filters   = getFilters();
  const { series, crises } = prepareData(filters);
  const container = document.getElementById('viz-container');
  if (!container) return;
  container.innerHTML = '';

  if (series.length < 2) {
    container.innerHTML = `<div class="empty-state">
      <p class="empty-state-title">No data for selected filters</p>
      <p class="empty-state-desc">Try expanding the decade range or selecting more regions.</p>
    </div>`;
    return;
  }

  const rect   = container.getBoundingClientRect();
  const width  = rect.width  || 800;
  const height = Math.max(rect.height || 480, 380);

  const margin = { top: 32, right: 24, bottom: 150, left: 56 };
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

  // ── Crisis background bands (merged per type, no labels) ──
  // Overlapping crises of the same type are merged into one band
  // so the chart area stays readable. Opacity is kept very low.
  const crisisG = g.append('g').attr('class', 'crisis-zones').style('pointer-events', 'none');
  const [filterStart, filterEnd] = filters.decadeRange;
  const mergedBands = mergeCrisisRanges(crises);

  Object.entries(mergedBands).forEach(([type, bands]) => {
    const color = CRISIS_COLORS[type] || '#ef4444';
    bands.forEach(band => {
      const x1 = xScale(Math.max(band.start, filterStart));
      const x2 = xScale(Math.min(band.end,   filterEnd));
      if (x2 <= x1) return;
      crisisG.append('rect')
        .attr('x',      x1).attr('y',      0)
        .attr('width',  x2 - x1).attr('height', innerH)
        .attr('fill',   color).attr('opacity', 0.06);
    });
  });

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

  g.append('text')
    .attr('class', 'chart-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -42)
    .attr('text-anchor', 'middle')
    .text('Avg. Valence (mood score)');

  // ── Area ──────────────────────────────────────────────────
  const areaGen = d3.area()
    .x(d => xScale(d.year))
    .y0(innerH)
    .y1(d => yScale(d.valence))
    .curve(d3.curveCatmullRom.alpha(0.5));

  g.append('path')
    .datum(series)
    .attr('fill', 'url(#valence-gradient)')
    .attr('d', areaGen);

  // Gradient fill
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'valence-gradient')
    .attr('x1', '0%').attr('y1', '0%')
    .attr('x2', '0%').attr('y2', '100%');
  grad.append('stop').attr('offset', '0%').attr('stop-color', 'var(--acid)').attr('stop-opacity', 0.14);
  grad.append('stop').attr('offset', '100%').attr('stop-color', 'var(--acid)').attr('stop-opacity', 0.01);

  // ── Line ──────────────────────────────────────────────────
  const lineGen = d3.line()
    .x(d => xScale(d.year))
    .y(d => yScale(d.valence))
    .curve(d3.curveCatmullRom.alpha(0.5));

  g.append('path')
    .datum(series)
    .attr('fill', 'none')
    .attr('stroke', 'var(--acid)')
    .attr('stroke-width', 2.5)
    .attr('d', lineGen);

  // ── Interaction: invisible overlay ────────────────────────
  const bisect = d3.bisector(d => d.year).center;

  const focusG = g.append('g').attr('class', 'focus').style('display', 'none');
  focusG.append('line')
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#475569')
    .attr('stroke-dasharray', '4 3')
    .attr('stroke-width', 1);
  focusG.append('circle')
    .attr('r', 5)
    .attr('fill', 'var(--acid)')
    .attr('stroke', '#f1f5f9')
    .attr('stroke-width', 1.5);

  g.append('rect')
    .attr('width',  innerW)
    .attr('height', innerH)
    .attr('fill',   'transparent')
    .on('mouseenter', () => focusG.style('display', null))
    .on('mouseleave', () => { focusG.style('display', 'none'); tooltip.hide(); })
    .on('mousemove', function(event) {
      const [mx]  = d3.pointer(event);
      const year  = xScale.invert(mx);
      const idx   = bisect(series, year);
      const d     = series[idx];
      if (!d) return;

      focusG.attr('transform', `translate(${xScale(d.year)},${yScale(d.valence)})`);
      focusG.select('line').attr('y1', -yScale(d.valence)).attr('y2', innerH - yScale(d.valence));

      const activeCrises = crises.filter(c => d.year >= +c.start_year && d.year <= +c.end_year);
      tooltip.show(event, tooltipHtml(`${d.year}`, [
        { label: 'Avg. Valence', value: `${(d.valence * 100).toFixed(1)}%`, color: 'var(--acid)' },
        ...activeCrises.map(c => ({ label: CRISIS_LABELS[c.crisis_type] || 'Crisis', value: c.crisis_name, color: CRISIS_COLORS[c.crisis_type] })),
      ]));
      tooltip.move(event);
    });

  // ── Crisis lanes (detail strip below x-axis) ─────────────
  const LANE_H      = 14;
  const LANE_GAP    = 5;
  const LANE_TOP    = innerH + 54;   // px below the chart top (within g)
  const LANE_ORDER  = ['economic', 'armed_conflict', 'pandemic'];
  const FONT_STACK  = 'Inter, system-ui, sans-serif';

  const lanesG = g.append('g').attr('class', 'crisis-lanes');

  LANE_ORDER.forEach((type, i) => {
    const laneY = LANE_TOP + i * (LANE_H + LANE_GAP);
    const color = CRISIS_COLORS[type];

    // Track background
    lanesG.append('rect')
      .attr('x', 0).attr('y', laneY)
      .attr('width', innerW).attr('height', LANE_H)
      .attr('fill', 'rgba(255,255,255,0.04)').attr('rx', 2);

    // Type label on left margin
    lanesG.append('text')
      .attr('x', -6).attr('y', laneY + LANE_H / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 8).attr('font-family', FONT_STACK)
      .attr('fill', color)
      .text(CRISIS_LABELS[type].toUpperCase());

    // Individual crisis segments
    crises.filter(c => c.crisis_type === type).forEach(crisis => {
      const x1   = xScale(Math.max(+crisis.start_year, filterStart));
      const x2   = xScale(Math.min(+crisis.end_year,   filterEnd));
      if (x2 <= x1) return;
      const segW = x2 - x1;

      lanesG.append('rect')
        .attr('x', x1).attr('y', laneY)
        .attr('width', segW).attr('height', LANE_H)
        .attr('fill', color).attr('opacity', 0.78).attr('rx', 2)
        .on('mouseenter', (event) => {
          tooltip.show(event, tooltipHtml(crisis.crisis_name, [
            { label: 'Type',     value: CRISIS_LABELS[type] },
            { label: 'Period',   value: `${crisis.start_year}–${crisis.end_year}` },
            { label: 'Severity', value: '★'.repeat(Math.min(+crisis.severity || 3, 5)) },
          ]));
        })
        .on('mousemove',  (event) => tooltip.move(event))
        .on('mouseleave', ()      => tooltip.hide());

      if (segW > 38) {
        const name = crisis.crisis_name;
        const label = segW > 75 ? name : (name.length > 10 ? name.slice(0, 9) + '…' : name);
        lanesG.append('text')
          .attr('x', x1 + segW / 2).attr('y', laneY + LANE_H / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 7.5).attr('font-family', FONT_STACK)
          .attr('fill', '#fff').style('pointer-events', 'none')
          .text(label);
      }
    });
  });

  // ── Legend ────────────────────────────────────────────────
  const legendY = LANE_TOP + LANE_ORDER.length * (LANE_H + LANE_GAP) + 14;
  const legendG = g.append('g').attr('transform', `translate(0, ${legendY})`);

  const legendItems = [
    { label: 'Avg. Valence', color: 'var(--acid)', type: 'line' },
    ...Object.entries(CRISIS_COLORS).map(([k, c]) => ({ label: CRISIS_LABELS[k], color: c, type: 'rect' })),
  ];

  legendItems.forEach((item, i) => {
    const lx = i * 130;
    if (item.type === 'line') {
      legendG.append('line').attr('x1', lx).attr('x2', lx + 18).attr('y1', 0).attr('y2', 0)
        .attr('stroke', item.color).attr('stroke-width', 2.5);
    } else {
      legendG.append('rect').attr('x', lx).attr('y', -6).attr('width', 10).attr('height', 10)
        .attr('fill', item.color).attr('opacity', 0.75).attr('rx', 2);
    }
    legendG.append('text').attr('x', lx + 18).attr('y', 4)
      .attr('fill', '#94a3b8').attr('font-size', 10).attr('font-family', FONT_STACK)
      .text(item.label);
  });

  updateInsightCards(series, crises);
  updateBadge();
}

// ── Insight cards ─────────────────────────────────────────────
function updateInsightCards(series, crises) {
  if (!series.length) return;
  const meanVal = d3.mean(series, d => d.valence);
  const minPt   = series.reduce((m, d) => d.valence < m.valence ? d : m);
  const maxPt   = series.reduce((m, d) => d.valence > m.valence ? d : m);

  setCard('card-avg-valence', `${(meanVal * 100).toFixed(1)}%`, 'Overall avg. valence');
  setCard('card-lowest',      `${minPt.year}`,                  `Lowest mood year (${(minPt.valence*100).toFixed(1)}%)`);
  setCard('card-highest',     `${maxPt.year}`,                  `Highest mood year (${(maxPt.valence*100).toFixed(1)}%)`);
  setCard('card-crises',      crises.length,                    'Crisis periods overlaid');
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
