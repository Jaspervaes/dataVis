/**
 * genre-forecast.js
 * ─────────────────────────────────────────────────────────────
 * Multi-line chart: genre popularity trends 2000–2024 with
 * dashed forecast extension 2025–2030 and a shaded confidence
 * band around each forecast line.
 *
 * TODO: Replace mock data with real:
 *   const raw = await loadCSV('../data/genre-trends.csv');
 *   const series = transformGenreTrends(raw, getFilters());
 *
 * Depends on:
 *   - D3 v7 (global window.d3)
 *   - filters.js  (filter state)
 *   - tooltip.js  (hover tooltips)
 * ─────────────────────────────────────────────────────────────
 */

import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }   from '../tooltip.js';
import { mockGenreTrends }         from '../data-loader.js';

const GENRE_COLORS = [
  'var(--acid)',  // acid — Pop
  '#e5321c',  // red — Hip-Hop
  '#f0a830',  // amber — Electronic
  '#6aabf0',  // blue — Latin
  '#c47fa0',  // rose — R&B
  '#82d4be',  // sage — Afrobeats
  '#f0ebe0',  // cream — Rock
  '#c8a06a',  // warm tan — Indie
];

const FORECAST_START = 2025;
const FORECAST_END   = 2030;
const HISTORY_END    = 2024;

let rawData      = null;
let hiddenGenres = new Set();

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  // TODO: Replace with loadCSV('../data/genre-trends.csv')
  rawData = mockGenreTrends(d3.range(2000, HISTORY_END + 1));

  render();

  window.addEventListener('filters:changed', render);
  window.addEventListener('resize', render);
});

// ── Data preparation ──────────────────────────────────────────
function prepareData(filters) {
  const [start, end] = filters.decadeRange;

  // Group by genre
  const grouped = d3.group(rawData, d => d.genre);

  const genreEntries = [...grouped.entries()];

  return genreEntries.map(([genre, rows], colorIdx) => {
    // Historical data filtered by year range
    const history = rows
      .filter(r => r.year >= Math.max(start, 2000) && r.year <= Math.min(end, HISTORY_END))
      .sort((a, b) => a.year - b.year);

    if (history.length < 2) return null;

    // Simple linear forecast via least-squares regression
    const n   = history.length;
    const xBar = d3.mean(history, d => d.year);
    const yBar = d3.mean(history, d => d.popularity_score);
    const slope = d3.sum(history, d => (d.year - xBar) * (d.popularity_score - yBar))
                / d3.sum(history, d => (d.year - xBar) ** 2);
    const intercept = yBar - slope * xBar;

    const residuals = history.map(d => d.popularity_score - (slope * d.year + intercept));
    const rmse      = Math.sqrt(d3.mean(residuals, r => r * r));

    // Forecast points
    const forecast = d3.range(FORECAST_START, FORECAST_END + 1).map(year => ({
      year,
      value:  Math.min(100, Math.max(0, slope * year + intercept)),
      upper:  Math.min(100, Math.max(0, slope * year + intercept + rmse * 1.5)),
      lower:  Math.min(100, Math.max(0, slope * year + intercept - rmse * 1.5)),
    }));

    return {
      genre,
      history,
      forecast,
      color: GENRE_COLORS[colorIdx % GENRE_COLORS.length],
      slope,
    };
  }).filter(Boolean);
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const filters   = getFilters();
  const series    = prepareData(filters);
  const container = document.getElementById('viz-container');
  if (!container) return;
  container.innerHTML = '';

  if (!series.length) {
    container.innerHTML = `<div class="empty-state">
      <p class="empty-state-title">No data for selected filters</p>
    </div>`;
    return;
  }

  const rect   = container.getBoundingClientRect();
  const width  = rect.width  || 900;
  const height = Math.max(rect.height || 520, 420);

  const margin = { top: 24, right: 32, bottom: 56, left: 56 };
  const innerW = width  - margin.left - margin.right;
  const innerH = height - margin.top  - margin.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('aria-label', 'Multi-line chart showing genre popularity trends and forecasts')
    .attr('role', 'img');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const defs = svg.append('defs');

  // ── Scales ────────────────────────────────────────────────
  const allYears  = [
    ...series.flatMap(s => s.history.map(d => d.year)),
    FORECAST_END,
  ];
  const allValues = [
    ...series.flatMap(s => s.history.map(d => d.popularity_score)),
    ...series.flatMap(s => s.forecast.map(d => d.upper)),
  ];

  const xScale = d3.scaleLinear()
    .domain([d3.min(allYears), FORECAST_END])
    .range([0, innerW]);

  const yScale = d3.scaleLinear()
    .domain([0, Math.min(100, d3.max(allValues) * 1.08)])
    .range([innerH, 0])
    .nice();

  // ── Forecast zone divider ─────────────────────────────────
  const forecastX = xScale(FORECAST_START);

  g.append('rect')
    .attr('x',       forecastX)
    .attr('y',       0)
    .attr('width',   innerW - forecastX)
    .attr('height',  innerH)
    .attr('fill',    'rgba(245,158,11,0.05)');

  g.append('line')
    .attr('x1', forecastX).attr('x2', forecastX)
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#f59e0b')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '6 4')
    .attr('opacity', 0.4);

  g.append('text')
    .attr('x',     forecastX + 6)
    .attr('y',     12)
    .attr('fill',  '#f59e0b')
    .attr('font-size', 10)
    .attr('font-family', 'Inter, system-ui, sans-serif')
    .attr('font-weight', 600)
    .attr('opacity', 0.7)
    .text('Forecast →');

  // ── Grid ──────────────────────────────────────────────────
  g.append('g').attr('class', 'chart-grid')
    .call(d3.axisLeft(yScale).tickSize(-innerW).tickFormat('').ticks(5))
    .call(ax => ax.select('.domain').remove());

  // ── Axes ──────────────────────────────────────────────────
  g.append('g')
    .attr('class', 'chart-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickFormat(d3.format('d')).ticks(8));

  g.append('g')
    .attr('class', 'chart-axis')
    .call(d3.axisLeft(yScale).ticks(5));

  g.append('text').attr('class', 'chart-axis-label')
    .attr('x', innerW / 2).attr('y', innerH + 44)
    .attr('text-anchor', 'middle').text('Year');

  g.append('text').attr('class', 'chart-axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2).attr('y', -44)
    .attr('text-anchor', 'middle').text('Popularity Score');

  // ── Per-genre lines ───────────────────────────────────────
  series.forEach(s => {
    if (hiddenGenres.has(s.genre)) return;

    // Confidence band (forecast only)
    const bandArea = d3.area()
      .x(d => xScale(d.year))
      .y0(d => yScale(d.lower))
      .y1(d => yScale(d.upper))
      .curve(d3.curveCatmullRom.alpha(0.5));

    g.append('path')
      .datum(s.forecast)
      .attr('fill', s.color)
      .attr('opacity', 0.1)
      .attr('d', bandArea);

    // Historical line
    const histLine = d3.line()
      .x(d => xScale(d.year))
      .y(d => yScale(d.popularity_score))
      .curve(d3.curveCatmullRom.alpha(0.5));

    g.append('path')
      .datum(s.history)
      .attr('fill', 'none')
      .attr('stroke', s.color)
      .attr('stroke-width', 2)
      .attr('d', histLine);

    // Forecast line (dashed)
    // Bridge: last historical point + forecast
    const bridge = [s.history[s.history.length - 1]
      ? { year: s.history[s.history.length - 1].year, value: s.history[s.history.length - 1].popularity_score }
      : null,
      ...s.forecast.map(d => ({ year: d.year, value: d.value }))
    ].filter(Boolean);

    const forecastLine = d3.line()
      .x(d => xScale(d.year))
      .y(d => yScale(d.value))
      .curve(d3.curveCatmullRom.alpha(0.5));

    g.append('path')
      .datum(bridge)
      .attr('fill', 'none')
      .attr('stroke', s.color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 4')
      .attr('opacity', 0.7)
      .attr('d', forecastLine);
  });

  // ── Interaction overlay ───────────────────────────────────
  const bisect = d3.bisector(d => d.year).center;

  const focusLine = g.append('line')
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#475569')
    .attr('stroke-dasharray', '3 3')
    .attr('stroke-width', 1)
    .style('display', 'none');

  const dots = g.append('g');

  g.append('rect')
    .attr('width', innerW).attr('height', innerH)
    .attr('fill', 'transparent')
    .on('mouseenter', () => focusLine.style('display', null))
    .on('mouseleave', () => { focusLine.style('display', 'none'); dots.selectAll('*').remove(); tooltip.hide(); })
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const year = Math.round(xScale.invert(mx));
      focusLine.attr('x1', xScale(year)).attr('x2', xScale(year));

      dots.selectAll('*').remove();

      const rows = series
        .filter(s => !hiddenGenres.has(s.genre))
        .map(s => {
          const histPt = s.history.find(d => d.year === year);
          const fcastPt = s.forecast.find(d => d.year === year);
          const val = histPt?.popularity_score ?? fcastPt?.value;
          if (val == null) return null;
          return { genre: s.genre, color: s.color, value: val, forecast: !histPt };
        }).filter(Boolean);

      rows.forEach(r => {
        dots.append('circle')
          .attr('cx', xScale(year))
          .attr('cy', yScale(r.value))
          .attr('r', 4)
          .attr('fill', r.color)
          .attr('stroke', '#0a0a0f')
          .attr('stroke-width', 1.5);
      });

      tooltip.show(event, tooltipHtml(
        `${year}${year >= FORECAST_START ? ' (forecast)' : ''}`,
        rows.map(r => ({ label: r.genre, value: r.value.toFixed(1), color: r.color }))
      ));
      tooltip.move(event);
    });

  // ── Legend ────────────────────────────────────────────────
  renderLegend(svg, series, width, height, margin);
  updateInsightCards(series);
}

function renderLegend(svg, series, width, height, margin) {
  const COLS = 4;
  const legendY = height - 14;
  const lg = svg.append('g').attr('transform', `translate(${margin.left}, ${legendY})`);

  series.forEach((s, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const lx  = col * 130;
    const ly  = row * -18;

    const item = lg.append('g')
      .attr('transform', `translate(${lx}, ${ly})`)
      .style('cursor', 'pointer')
      .on('click', () => {
        if (hiddenGenres.has(s.genre)) hiddenGenres.delete(s.genre);
        else hiddenGenres.add(s.genre);
        render();
      });

    item.append('line')
      .attr('x1', 0).attr('x2', 16).attr('y1', 0).attr('y2', 0)
      .attr('stroke', s.color)
      .attr('stroke-width', 2.5)
      .attr('opacity', hiddenGenres.has(s.genre) ? 0.3 : 1);

    item.append('text')
      .attr('x', 20).attr('y', 4)
      .attr('fill', hiddenGenres.has(s.genre) ? '#475569' : '#94a3b8')
      .attr('font-size', 11)
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .text(s.genre);
  });
}

// ── Insight cards ─────────────────────────────────────────────
function updateInsightCards(series) {
  if (!series.length) return;

  const fastest = series.reduce((a, b) => b.slope > a.slope ? b : a);
  const slowest = series.reduce((a, b) => b.slope < a.slope ? b : a);

  setCard('card-fastest', fastest.genre, `Fastest rising genre (+${fastest.slope.toFixed(2)}/yr)`);
  setCard('card-declining', slowest.genre, `Trending downward (${slowest.slope.toFixed(2)}/yr)`);
  setCard('card-genres-tracked', series.length, 'Genres tracked');
  setCard('card-forecast-horizon', `${FORECAST_END}`, `Forecast horizon`);
}

function setCard(id, value, desc) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = el.querySelector('.insight-card-value');
  const d = el.querySelector('.insight-card-desc');
  if (v) v.textContent = value;
  if (d) d.textContent = desc;
}
