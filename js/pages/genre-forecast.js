/**
 * genre-forecast.js
 *
 * Two-panel visualization:
 *   1. Global genre share trend 1986–2030 (solid history + dashed forecast + CI bands)
 *   2. EU over/under-index vs global (avg divergence Oct 2023 – Jun 2025)
 *
 * Data files:
 *   ../data/global_genre_share_yearly.csv
 *   ../data/eu_vs_global_index_monthly.csv
 */

import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }   from '../tooltip.js';
import { loadCSV, mockGenreTrends } from '../data-loader.js';

const GENRE_COLORS = {
  'Pop':        'var(--acid)',
  'Hip-Hop':    '#e5321c',
  'Rock':       '#f0ebe0',
  'Electronic': '#f0a830',
  'R&B':        '#c47fa0',
  'Latin':      '#6aabf0',
  'Country':    '#7ec87e',
  'Jazz':       '#c8a06a',
  'Classical':  '#a0a0c0',
};
const GENRE_ORDER = ['Pop','Hip-Hop','Rock','Electronic','R&B','Latin','Country'];
const HIDDEN_GENRES_HARD = new Set(['Jazz', 'Classical']);  // not featured in the page

const HIST_START    = 1986;
const FORECAST_START = 2026;
const FORECAST_END  = 2035;

// ── State ─────────────────────────────────────────────────────────────────────
let globalSeries   = null;   // Map<genre, {history, forecast, slope}>
let monthlyGlobal  = null;   // Map<genre, [{decYear, share}]>
let euDivergence   = null;   // [{genre, avg_divergence}] sorted desc
let euInfluence    = null;   // [{genre, region, correlation, n_months}]
let regionalMonthly = null;  // Map<region, Map<genre, [{month, decYear, share}]>>
let crises         = null;   // [{name, type, severity, start, end}]
let euWindow       = '';
let hiddenGenres   = new Set();
let usingRealData  = false;

const REGION_ORDER = ['US', 'LatAm', 'Asia', 'Africa/ME'];
const CRISIS_COLORS = {
  'economic':       '#f0a830',
  'armed_conflict': '#e5321c',
  'pandemic':       '#6aabf0',
};

function monthToDecYear(s) {
  if (s instanceof Date) return s.getUTCFullYear() + s.getUTCMonth() / 12;
  const [y, m] = String(s).slice(0, 7).split('-').map(Number);
  return y + (m - 0.5) / 12;
}

// ── Shared ensemble forecast (used by Chart A + Lifecycle Map) ───────────────
function fitLinearSeries(pts) {
  if (!pts || pts.length < 2) return null;
  const xBar = d3.mean(pts, d => d.year);
  const yBar = d3.mean(pts, d => d.share);
  const sxx  = d3.sum(pts, d => (d.year - xBar) ** 2);
  if (sxx === 0) return null;
  const slope     = d3.sum(pts, d => (d.year - xBar) * (d.share - yBar)) / sxx;
  const intercept = yBar - slope * xBar;
  const res       = pts.map(d => d.share - (slope * d.year + intercept));
  const sigma     = Math.sqrt(d3.mean(res, r => r * r));
  return { slope, intercept, sigma };
}

function computeEnsembleForecast(history) {
  if (!history || history.length < 4) return [];
  const lastYear = history[history.length - 1].year;
  const sliceByYears = (n) => history.filter(d => d.year > lastYear - n);

  const models = [
    fitLinearSeries(sliceByYears(5)),
    fitLinearSeries(sliceByYears(10)),
    fitLinearSeries(sliceByYears(20)),
  ].filter(Boolean);
  if (!models.length) return [];

  return d3.range(FORECAST_START, FORECAST_END + 1).map(year => {
    const preds = models.map(m => m.slope * year + m.intercept);
    const central      = d3.mean(preds);
    const modelSpread  = preds.length > 1 ? d3.deviation(preds) : 0;
    const meanResidual = d3.mean(models, m => m.sigma);
    const horizon      = Math.max(1, year - lastYear);
    const sigmaH       = Math.sqrt(modelSpread ** 2 + (meanResidual ** 2) * horizon);
    const half         = sigmaH * 1.5;
    return {
      year,
      share: Math.max(0, Math.min(100, central)),
      lower: Math.max(0, central - half),
      upper: Math.min(100, central + half),
    };
  });
}

function monthToStr(s) {
  if (s instanceof Date) {
    const y = s.getUTCFullYear();
    const m = String(s.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  return String(s).slice(0, 7);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();
  // Sync filter state with the HTML slider defaults (initFilters doesn't do this)
  const startSlider = document.getElementById('filter-decade-start');
  if (startSlider) startSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await loadData();
  render();
  window.addEventListener('filters:changed', render);
  window.addEventListener('resize', render);

  // Left-panel view switch: Lifecycle Map (default) ⇄ Global Forecast.
  // The hidden panel measures 0px wide, so re-render after each switch to let
  // the now-visible chart pick up its real column width.
  const viewSwitch = document.querySelector('.view-switch');
  if (viewSwitch) {
    const TITLES = { lifecycle: 'Genre Lifecycle Map', forecast: 'Global Genre Share' };
    const titleEl = document.getElementById('left-title');
    viewSwitch.querySelectorAll('.view-switch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        viewSwitch.querySelectorAll('.view-switch-btn').forEach(b => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.view-panel').forEach(p => {
          p.hidden = p.dataset.view !== view;
        });
        if (titleEl && TITLES[view]) titleEl.textContent = TITLES[view];
        render();
      });
    });
  }
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  const [rawGlobal, rawEU, rawInfl, rawRegional, rawCrises] = await Promise.all([
    loadCSV('../data/global_genre_share_yearly.csv').catch(() => null),
    loadCSV('../data/eu_vs_global_index_monthly.csv').catch(() => null),
    loadCSV('../data/eu_influence_correlation.csv').catch(() => null),
    loadCSV('../data/regional_monthly_shares.csv').catch(() => null),
    loadCSV('../data/global-crises.csv').catch(() => null),
  ]);

  if (rawRegional && rawRegional.length > 0) {
    regionalMonthly = new Map();
    rawRegional.forEach(r => {
      if (!r.region || !r.genre || r.share == null) return;
      const monthStr = monthToStr(r.month);
      const decYear  = monthToDecYear(r.month);
      const share    = +r.share * 100;
      if (!regionalMonthly.has(r.region)) regionalMonthly.set(r.region, new Map());
      const regionGenres = regionalMonthly.get(r.region);
      if (!regionGenres.has(r.genre)) regionGenres.set(r.genre, []);
      regionGenres.get(r.genre).push({ month: monthStr, decYear, share });
    });
    // Sort each genre series chronologically
    for (const [, gMap] of regionalMonthly) {
      for (const [, arr] of gMap) arr.sort((a, b) => a.decYear - b.decYear);
    }
  }

  if (rawInfl && rawInfl.length > 0) {
    euInfluence = rawInfl
      .filter(r => r.genre && r.region && !isNaN(+r.correlation))
      .map(r => ({
        genre:       r.genre,
        region:      r.region,
        correlation: +r.correlation,
        n_months:    +r.n_months,
      }));
  }

  if (rawCrises && rawCrises.length > 0) {
    crises = rawCrises
      .filter(r => r.crisis_name && +r.start_year && +r.severity >= 4)
      .map(r => ({
        name:     r.crisis_name,
        type:     r.crisis_type,
        severity: +r.severity,
        start:    +r.start_year,
        end:      +r.end_year || +r.start_year,
      }));
  }

  // --- Global series ---
  if (rawGlobal && rawGlobal.length > 10) {
    const rows = rawGlobal.map(r => ({
      year:        +r.year,
      genre:       r.genre,
      share:       +r.share * 100,
      track_count: +r.track_count,
      // d3.autoType converts "True"/"False" → booleans in some versions, strings in others
      is_forecast: r.is_forecast === true || r.is_forecast === 'True',
      // d3.autoType already converts empty strings to null, numbers stay numbers
      lower:       (r.lower != null && !isNaN(+r.lower)) ? +r.lower * 100 : null,
      upper:       (r.upper != null && !isNaN(+r.upper)) ? +r.upper * 100 : null,
    }));

    globalSeries = new Map();
    for (const [genre, genreRows] of d3.group(rows, d => d.genre)) {
      const history = genreRows
        .filter(r => !r.is_forecast && r.year >= HIST_START && r.track_count >= 1)
        .sort((a, b) => a.year - b.year);
      const forecast = genreRows
        .filter(r => r.is_forecast)
        .sort((a, b) => a.year - b.year);
      if (history.length < 8) continue;

      const xBar  = d3.mean(history, d => d.year);
      const yBar  = d3.mean(history, d => d.share);
      const slope = d3.sum(history, d => (d.year - xBar) * (d.share - yBar))
                  / d3.sum(history, d => (d.year - xBar) ** 2);

      globalSeries.set(genre, { history, forecast, slope });
    }

    usingRealData = true;
    const badge = document.getElementById('data-badge');
    if (badge) badge.style.display = 'none';

  } else {
    // Fallback: mock data
    const mockRows = mockGenreTrends(d3.range(1990, 2025));
    globalSeries = new Map();
    for (const [genre, rows] of d3.group(mockRows, d => d.genre)) {
      globalSeries.set(genre, {
        history:  rows.sort((a, b) => a.year - b.year),
        forecast: [],
        slope:    0,
      });
    }
  }

  // --- EU divergence ---
  if (rawEU && rawEU.length > 0) {
    // Build monthly global share series for the trend chart
    const validMonthly = rawEU
      .filter(r => r.genre && r.global_share != null && !isNaN(+r.global_share))
      .map(r => ({
        month:   monthToStr(r.month),
        genre:   r.genre,
        decYear: monthToDecYear(r.month),
        share:   +r.global_share * 100,
      }));
    monthlyGlobal = d3.group(validMonthly, d => d.genre);

    const parsed = rawEU.map(r => ({
      month:      monthToStr(r.month),
      genre:      r.genre,
      divergence: +r.divergence * 100,
    })).filter(r => r.genre && !isNaN(r.divergence));

    const avgByGenre = d3.rollup(parsed, rs => d3.mean(rs, d => d.divergence), d => d.genre);
    euDivergence = [...avgByGenre.entries()]
      .map(([genre, avg]) => ({ genre, avg_divergence: +avg.toFixed(2) }))
      .filter(d => Math.abs(d.avg_divergence) >= 0.2)
      .sort((a, b) => b.avg_divergence - a.avg_divergence);

    const months = [...new Set(parsed.map(r => r.month))].sort();
    if (months.length) {
      euWindow = `vs. global average  ·  ${months[0]} – ${months[months.length - 1]}`;
      const el = document.getElementById('eu-window-label');
      if (el) el.textContent = euWindow;
    }
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  const filters      = getFilters();
  const activeGenres = new Set(filters.genres || []);
  const [startYear, endYear] = filters.decadeRange;

  // Collect visible series
  const visible = [];
  for (const [genre, s] of (globalSeries || new Map())) {
    if (HIDDEN_GENRES_HARD.has(genre)) continue;        // never shown on this page
    if (hiddenGenres.has(genre)) continue;
    if (activeGenres.size && !activeGenres.has(genre)) continue;
    visible.push([genre, s]);
  }
  // Stable sort by GENRE_ORDER
  visible.sort(([a], [b]) =>
    (GENRE_ORDER.indexOf(a) + 1 || 99) - (GENRE_ORDER.indexOf(b) + 1 || 99));

  try {
    renderGlobalChart(visible, startYear, endYear);
  } catch (err) {
    console.error('renderGlobalChart error:', err);
    const c = document.getElementById('viz-global');
    if (c) c.innerHTML = `<div class="empty-state"><p class="empty-state-title">Chart error</p><p class="empty-state-desc" style="font-family:monospace;font-size:0.75rem">${err.message}</p></div>`;
  }
  try {
    renderHitlistForecast(visible.map(([g]) => g));
  } catch (err) {
    console.error('renderHitlistForecast error:', err);
    const c = document.getElementById('viz-hitlist');
    if (c) c.innerHTML = `<div class="empty-state"><p class="empty-state-title">Hitlist forecast error</p><p style="font-family:monospace;font-size:0.75rem">${err.message}</p></div>`;
  }
  try {
    renderLifecycleQuadrant(visible.map(([g]) => g));
  } catch (err) {
    console.error('renderLifecycleQuadrant error:', err);
    const c = document.getElementById('viz-quadrant');
    if (c) c.innerHTML = `<div class="empty-state"><p class="empty-state-title">Lifecycle chart error</p><p style="font-family:monospace;font-size:0.75rem">${err.message}</p></div>`;
  }
}

// ── Chart 1: global genre share ───────────────────────────────────────────────
function renderGlobalChart(visible, startYear, endYear) {
  const container = document.getElementById('viz-global');
  if (!container) return;
  container.innerHTML = '';

  if (!visible.length) {
    container.innerHTML = `<div class="empty-state">
      <p class="empty-state-title">No genres selected</p></div>`;
    return;
  }

  const rect   = container.getBoundingClientRect();
  const width  = rect.width || 900;
  const height = Math.max(rect.height || 460, 380);

  // Reserve bottom margin so legend + axis-label never overlap, even with 2 legend rows
  const ROW_H        = 18;
  const itemW        = 108;
  const innerWidth   = (width || 900) - 28 - 52;     // matches right/left below
  const legendCols   = Math.max(3, Math.min(visible.length, Math.floor(innerWidth / itemW)));
  const legendRows   = Math.ceil(visible.length / legendCols);
  const legendH      = legendRows * ROW_H + 8;
  const axisLabelH   = 16;
  const tickLabelH   = 18;
  const gap          = 12;

  const margin = {
    top:    20,
    right:  28,
    bottom: tickLabelH + axisLabelH + gap + legendH,
    left:   52,
  };
  const iW = width  - margin.left - margin.right;
  const iH = height - margin.top  - margin.bottom;

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Scales
  const histPoints = visible.flatMap(([, s]) =>
    s.history.filter(r => r.year >= startYear && r.year <= endYear));
  const forePoints = visible.flatMap(([, s]) => s.forecast);

  const allValues = [
    ...histPoints.map(r => r.share),
    ...forePoints.map(r => r.upper || r.share),
  ];

  const xDomain = [Math.max(startYear, HIST_START), FORECAST_END];
  const xScale  = d3.scaleLinear().domain(xDomain).range([0, iW]);
  const yMax    = d3.max(allValues.filter(v => isFinite(v))) || 60;
  const yScale  = d3.scaleLinear()
    .domain([0, Math.min(70, yMax * 1.12)])
    .range([iH, 0]).nice();

  // Forecast zone — subtle acid wash, matches project design system
  const fxStart = xScale(FORECAST_START);
  g.append('rect')
    .attr('x', fxStart).attr('y', 0)
    .attr('width', iW - fxStart).attr('height', iH)
    .attr('fill', 'rgba(200, 240, 0, 0.035)');
  g.append('line')
    .attr('x1', fxStart).attr('x2', fxStart)
    .attr('y1', 0).attr('y2', iH)
    .attr('stroke', 'rgba(200, 240, 0, 0.28)').attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 3');
  g.append('text')
    .attr('x', fxStart + 7).attr('y', 12)
    .attr('fill', 'rgba(200, 240, 0, 0.7)').attr('font-size', 9)
    .attr('font-family', 'DM Mono, monospace')
    .attr('letter-spacing', '0.18em')
    .text('FORECAST →');

  // Grid + axes
  g.append('g').attr('class', 'chart-grid')
    .call(d3.axisLeft(yScale).tickSize(-iW).tickFormat('').ticks(5))
    .call(ax => ax.select('.domain').remove());

  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(xScale).tickFormat(d3.format('d')).ticks(8));

  g.append('g').attr('class', 'chart-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d => d + '%'));

  g.append('text').attr('class', 'chart-axis-label')
    .attr('x', iW / 2).attr('y', iH + tickLabelH + axisLabelH)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'DM Mono, monospace').attr('font-size', 10)
    .attr('fill', '#5a5550').attr('letter-spacing', '0.14em')
    .text('RELEASE YEAR');
  g.append('text').attr('class', 'chart-axis-label')
    .attr('transform', 'rotate(-90)').attr('x', -iH / 2).attr('y', -40)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'DM Mono, monospace').attr('font-size', 10)
    .attr('fill', '#5a5550').attr('letter-spacing', '0.14em')
    .text('GENRE SHARE %');

  // Lines
  const histLine = d3.line()
    .defined(d => d.share != null)
    .x(d => xScale(d.year)).y(d => yScale(d.share))
    .curve(d3.curveLinear);

  const forecastLine = d3.line()
    .x(d => xScale(d.year)).y(d => yScale(d.share))
    .curve(d3.curveLinear);

  const bandArea = d3.area()
    .defined(d => d.lower != null && d.upper != null)
    .x(d => xScale(d.year))
    .y0(d => yScale(d.lower)).y1(d => yScale(d.upper))
    .curve(d3.curveLinear);

  // Pre-compute history+forecast PER GENRE so the hover uses the SAME data
  const drawn = visible.map(([genre, s]) => {
    const color   = GENRE_COLORS[genre] || '#94a3b8';
    const history = s.history.filter(r => r.year >= startYear && r.year <= endYear);
    if (!history.length) return null;
    const forecast = computeEnsembleForecast(history);
    return { genre, color, history, forecast };
  }).filter(Boolean);

  drawn.forEach(({ genre, color, history, forecast }) => {
    const last = history[history.length - 1];

    // Confidence band, anchored at last actual point so fan opens from there
    if (forecast.length && last) {
      const bandData = [{ year: last.year, lower: last.share, upper: last.share }, ...forecast];
      g.append('path').datum(bandData)
        .attr('fill', color).attr('opacity', 0.09)
        .attr('d', bandArea);
    }

    // Historical line
    g.append('path').datum(history)
      .attr('fill', 'none').attr('stroke', color)
      .attr('stroke-width', 1.6).attr('d', histLine);

    // Annual data dots
    g.selectAll(null).data(history)
      .join('circle')
      .attr('cx', d => xScale(d.year)).attr('cy', d => yScale(d.share))
      .attr('r', history.length > 25 ? 1.8 : 2.6)
      .attr('fill', color).attr('opacity', 0.75);

    // Dashed forecast line bridged from last actual
    if (forecast.length && last) {
      const bridge = [{ year: last.year, share: last.share }, ...forecast];
      g.append('path').datum(bridge)
        .attr('fill', 'none').attr('stroke', color)
        .attr('stroke-width', 2).attr('stroke-dasharray', '5 3')
        .attr('opacity', 0.75).attr('d', forecastLine);
    }
  });

  // Pre-index for fast hover lookup that matches drawn lines
  const indexed = drawn.map(d => ({
    genre: d.genre, color: d.color,
    histByYear: new Map(d.history.map(p => [p.year, p.share])),
    foreByYear: new Map(d.forecast.map(p => [p.year, p.share])),
  }));

  // Hover overlay — uses the SAME forecast data the lines were drawn from
  const focusLine = g.append('line')
    .attr('y1', 0).attr('y2', iH)
    .attr('stroke', '#5a5550').attr('stroke-dasharray', '2 3')
    .attr('stroke-width', 1).style('display', 'none');
  const dots = g.append('g').attr('class', 'hover-dots');

  g.append('rect')
    .attr('width', iW).attr('height', iH).attr('fill', 'transparent')
    .on('mouseenter', () => focusLine.style('display', null))
    .on('mouseleave', () => {
      focusLine.style('display', 'none');
      dots.selectAll('*').remove();
      tooltip.hide();
    })
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const rawYear   = xScale.invert(mx);
      const isForecast = rawYear >= FORECAST_START;
      // Snap to quarter for history, whole-year for forecast
      const year = isForecast
        ? Math.round(rawYear)
        : Math.round(rawYear * 4) / 4;
      focusLine.attr('x1', xScale(year)).attr('x2', xScale(year));
      dots.selectAll('*').remove();

      const tipRows = indexed.map(s => {
        const value = isForecast ? s.foreByYear.get(year) : s.histByYear.get(year);
        if (value == null || !isFinite(value)) return null;
        return { genre: s.genre, color: s.color, value, isForecast };
      }).filter(Boolean).sort((a, b) => b.value - a.value);

      tipRows.forEach(r => {
        dots.append('circle')
          .attr('cx', xScale(year)).attr('cy', yScale(r.value))
          .attr('r', 4).attr('fill', r.color)
          .attr('stroke', '#0e0c0a').attr('stroke-width', 2);
      });

      // Pretty-print quarter labels: 1986.0 → "1986 Q1", forecast year → "2028"
      const yearLabel = (() => {
        if (isForecast) return `${year}  ·  forecast`;
        const wholeYear = Math.floor(year);
        const q = Math.round((year - wholeYear) * 4) + 1;
        return `${wholeYear} Q${q}`;
      })();

      tooltip.show(event, tooltipHtml(
        yearLabel,
        tipRows.map(r => ({
          label: r.genre,
          value: r.value.toFixed(1) + '%',
          color: r.color,
        }))
      ));
      tooltip.move(event);
    });

  // Legend (clickable) — positioned in the dedicated legend strip below the axis label
  renderLegend(svg, visible, width, height, margin, legendCols, ROW_H);
}

function renderLegend(svg, visible, width, height, margin, COLS, rowH) {
  const itemW     = 108;
  const cols      = COLS || Math.max(3, Math.min(visible.length, Math.floor((width - margin.left - margin.right) / itemW)));
  const totalRows = Math.ceil(visible.length / cols);
  const rh        = rowH || 18;
  // Anchor at the TOP of the legend strip — legend rows grow downward from here
  const legendTop = height - margin.bottom + 16 + 12 + 16; // tickLabelH + gap + axisLabelH approx
  const lg = svg.append('g')
    .attr('transform', `translate(${margin.left}, ${legendTop + rh / 2})`);

  visible.forEach(([genre], i) => {
    const col  = i % cols;
    const row  = Math.floor(i / cols);
    const item = lg.append('g')
      .attr('transform', `translate(${col * itemW}, ${row * rh})`)
      .style('cursor', 'pointer')
      .on('click', () => {
        hiddenGenres.has(genre) ? hiddenGenres.delete(genre) : hiddenGenres.add(genre);
        render();
      });

    const color = GENRE_COLORS[genre] || '#a09a90';
    const dim   = hiddenGenres.has(genre);

    item.append('line')
      .attr('x1', 0).attr('x2', 16).attr('y1', 0).attr('y2', 0)
      .attr('stroke', color).attr('stroke-width', 2.5)
      .attr('opacity', dim ? 0.25 : 1);
    item.append('text')
      .attr('x', 22).attr('y', 4)
      .attr('fill', dim ? '#5a5550' : '#a09a90')
      .attr('font-size', 10)
      .attr('font-family', 'DM Mono, monospace')
      .attr('letter-spacing', '0.06em')
      .text(genre.toUpperCase());
  });
}

// ── Chart 2: EU divergence bars ───────────────────────────────────────────────
function renderEUPanel(visibleGenres) {
  const container = document.getElementById('viz-eu');
  if (!container) return;
  container.innerHTML = '';

  if (!euDivergence || !euDivergence.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:200px;">
      <p class="empty-state-title">EU divergence data unavailable</p>
      <p class="empty-state-desc">Run fetch_genre_forecast.py to generate eu_vs_global_index_monthly.csv</p>
    </div>`;
    return;
  }

  const visSet = new Set(visibleGenres);
  const data = euDivergence.filter(d => visSet.has(d.genre));
  if (!data.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:160px;">
      <p class="empty-state-title">No genres selected</p></div>`;
    return;
  }

  const BAR_H  = 28;
  const margin = { top: 12, right: 80, bottom: 32, left: 100 };
  const width  = (container.getBoundingClientRect().width || 800);
  const height = data.length * BAR_H + margin.top + margin.bottom;
  const iW     = width  - margin.left - margin.right;
  const iH     = data.length * BAR_H;

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const extent = d3.extent(data, d => d.avg_divergence);
  const xMax   = Math.max(Math.abs(extent[0]), Math.abs(extent[1])) * 1.25;
  const xScale = d3.scaleLinear().domain([-xMax, xMax]).range([0, iW]);
  const yScale = d3.scaleBand()
    .domain(data.map(d => d.genre)).range([0, iH]).padding(0.25);

  // Zero line
  const x0 = xScale(0);
  g.append('line')
    .attr('x1', x0).attr('x2', x0).attr('y1', 0).attr('y2', iH)
    .attr('stroke', '#3e3830').attr('stroke-width', 1);

  // Bars
  g.selectAll('.div-bar')
    .data(data)
    .join('rect')
    .attr('class', 'div-bar')
    .attr('x', d => d.avg_divergence >= 0 ? x0 : xScale(d.avg_divergence))
    .attr('y', d => yScale(d.genre))
    .attr('width', d => Math.abs(xScale(d.avg_divergence) - x0))
    .attr('height', yScale.bandwidth())
    .attr('fill', d => d.avg_divergence >= 0 ? (GENRE_COLORS[d.genre] || '#a09a90') : '#3e3830')
    .attr('opacity', d => d.avg_divergence >= 0 ? 0.88 : 0.7);

  // Value labels
  g.selectAll('.div-label')
    .data(data)
    .join('text')
    .attr('class', 'div-label')
    .attr('x', d => d.avg_divergence >= 0
      ? xScale(d.avg_divergence) + 6
      : xScale(d.avg_divergence) - 6)
    .attr('y', d => yScale(d.genre) + yScale.bandwidth() / 2 + 4)
    .attr('text-anchor', d => d.avg_divergence >= 0 ? 'start' : 'end')
    .attr('fill', '#a09a90').attr('font-size', 11)
    .attr('font-family', 'DM Mono, monospace')
    .text(d => (d.avg_divergence >= 0 ? '+' : '') + d.avg_divergence.toFixed(1) + ' pp');

  // Genre labels (Y-axis)
  g.selectAll('.genre-label')
    .data(data)
    .join('text')
    .attr('class', 'genre-label')
    .attr('x', -10)
    .attr('y', d => yScale(d.genre) + yScale.bandwidth() / 2 + 4)
    .attr('text-anchor', 'end')
    .attr('fill', d => GENRE_COLORS[d.genre] || '#a09a90')
    .attr('font-size', 13)
    .attr('font-family', 'Bebas Neue, Impact, sans-serif')
    .attr('letter-spacing', '0.04em')
    .text(d => d.genre.toUpperCase());

  // X-axis with pp labels
  g.append('g').attr('class', 'chart-axis')
    .attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(xScale)
      .ticks(6)
      .tickFormat(d => (d >= 0 ? '+' : '') + d.toFixed(0) + ' pp'));

  // Annotation
  g.append('text')
    .attr('x', iW).attr('y', iH + 28)
    .attr('text-anchor', 'end')
    .attr('fill', '#5a5550').attr('font-size', 9)
    .attr('font-family', 'DM Mono, monospace')
    .attr('letter-spacing', '0.12em')
    .text('PP = PERCENTAGE POINTS VS. GLOBAL AVERAGE');
}

// ── Chart 3: short-term EU hitlist momentum forecast ─────────────────────────
const REGION_COLORS = {
  'US':        '#e5321c',
  'LatAm':     '#f0a830',
  'Asia':      '#6aabf0',
  'Africa/ME': '#c47fa0',
};

function fitMonthlyTrend(points, lookbackMonths = 6) {
  if (!points || points.length < 3) return null;
  const recent = points.slice(-lookbackMonths);
  const xBar = d3.mean(recent, d => d.decYear);
  const yBar = d3.mean(recent, d => d.share);
  const sxx  = d3.sum(recent, d => (d.decYear - xBar) ** 2);
  if (sxx === 0) return null;
  const slope     = d3.sum(recent, d => (d.decYear - xBar) * (d.share - yBar)) / sxx;
  const intercept = yBar - slope * xBar;
  return { slope, intercept, recent, last: recent[recent.length - 1] };
}

function computeShortTermForecast(genre, horizonMonths = 6) {
  const euData = regionalMonthly?.get('EU')?.get(genre);
  const euFit  = fitMonthlyTrend(euData, 6);
  if (!euFit) return null;

  // Pull most-correlated region (largest |r|, threshold 0.3)
  let bestRegion = null;
  let bestCorr   = 0;
  if (euInfluence) {
    for (const e of euInfluence) {
      if (e.genre !== genre) continue;
      if (Math.abs(e.correlation) > Math.abs(bestCorr)) {
        bestCorr   = e.correlation;
        bestRegion = e.region;
      }
    }
  }

  // Region's own recent slope, sign-aligned via correlation
  let regionSlopeWeighted = 0;
  if (bestRegion && Math.abs(bestCorr) >= 0.3) {
    const regData = regionalMonthly?.get(bestRegion)?.get(genre);
    const regFit  = fitMonthlyTrend(regData, 6);
    if (regFit) regionSlopeWeighted = regFit.slope * bestCorr;
  }

  // 70% EU own momentum, 30% correlated region's momentum
  const blendedSlope  = 0.7 * euFit.slope + 0.3 * regionSlopeWeighted;
  const horizonYears  = horizonMonths / 12;
  const last          = euFit.last;
  const predictedShare = Math.max(0, Math.min(100, last.share + blendedSlope * horizonYears));

  // Build projection points for the sparkline (3 points: last actual, mid, end)
  const projection = [
    { decYear: last.decYear,                share: last.share },
    { decYear: last.decYear + horizonYears, share: predictedShare },
  ];

  return {
    genre,
    current:    last.share,
    predicted:  predictedShare,
    change:     predictedShare - last.share,
    bestRegion: Math.abs(bestCorr) >= 0.3 ? bestRegion : null,
    correlation: bestCorr,
    actualSeries: euFit.recent,
    projection,
    // Slopes (pp/year) — exposed so the Lifecycle Map's momentum axis stays
    // coherent with this chart. `euSlope` is the established last-6-month
    // trend (the dot); `predictedSlope` is the blended trend the dashed
    // projection draws (the arrow).
    euSlope:        euFit.slope,
    predictedSlope: blendedSlope,
  };
}

function renderHitlistForecast(visibleGenres) {
  const container = document.getElementById('viz-hitlist');
  if (!container) return;
  container.innerHTML = '';

  if (!regionalMonthly || !regionalMonthly.has('EU')) {
    container.innerHTML = `<div class="empty-state" style="min-height:200px;">
      <p class="empty-state-title">Hitlist data unavailable</p>
      <p class="empty-state-desc">Run fetch_genre_forecast.py to generate regional_monthly_shares.csv</p>
    </div>`;
    return;
  }

  const predictions = visibleGenres
    .map(g => computeShortTermForecast(g, 6))
    .filter(Boolean)
    .sort((a, b) => b.change - a.change);

  if (!predictions.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:160px;">
      <p class="empty-state-title">No genres selected</p></div>`;
    return;
  }

  // X domain spans the actualSeries + projection (all genres)
  const allPts = predictions.flatMap(p => [...p.actualSeries, ...p.projection]);
  const xDomain = d3.extent(allPts, d => d.decYear);

  // Tag top 3 risers / bottom 3 fallers for accent rails
  const total = predictions.length;
  predictions.forEach((p, idx) => {
    const row = document.createElement('div');
    let cls = 'hitlist-row';
    if      (idx < 3 && p.change > 0.5)              cls += ' rising';
    else if (idx >= total - 3 && p.change < -0.5)    cls += ' falling';
    row.className = cls;

    // Left: genre name + subtitle (correlated region)
    const left = document.createElement('div');
    const color = GENRE_COLORS[p.genre] || '#94a3b8';
    left.innerHTML = `
      <div class="hitlist-genre" style="color:${color}">${p.genre}</div>
      ${p.bestRegion
        ? `<span class="hitlist-sub">via ${p.bestRegion} (r=${p.correlation >= 0 ? '+' : ''}${p.correlation.toFixed(2)})</span>`
        : `<span class="hitlist-sub">EU momentum only</span>`}
    `;

    // Middle: SVG sparkline (actual solid + projection dashed)
    const sparkW = 200;
    const sparkH = 36;
    const xScale = d3.scaleLinear().domain(xDomain).range([0, sparkW - 4]);
    const allShares = [...p.actualSeries, ...p.projection].map(d => d.share);
    const yScale = d3.scaleLinear()
      .domain([Math.max(0, d3.min(allShares) * 0.85), d3.max(allShares) * 1.1])
      .range([sparkH - 4, 4]);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width',  sparkW);
    svg.setAttribute('height', sparkH);

    // Actual line
    const lineGen = d3.line().x(d => xScale(d.decYear)).y(d => yScale(d.share)).curve(d3.curveMonotoneX);

    const actualPath = document.createElementNS(svgNS, 'path');
    actualPath.setAttribute('d', lineGen(p.actualSeries));
    actualPath.setAttribute('fill', 'none');
    actualPath.setAttribute('stroke', color);
    actualPath.setAttribute('stroke-width', '2');
    svg.appendChild(actualPath);

    // Projection (dashed)
    const projPath = document.createElementNS(svgNS, 'path');
    projPath.setAttribute('d', lineGen(p.projection));
    projPath.setAttribute('fill', 'none');
    projPath.setAttribute('stroke', color);
    projPath.setAttribute('stroke-width', '2');
    projPath.setAttribute('stroke-dasharray', '4 3');
    projPath.setAttribute('opacity', '0.7');
    svg.appendChild(projPath);

    // Endpoint marker
    const endPt = p.projection[p.projection.length - 1];
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', xScale(endPt.decYear));
    dot.setAttribute('cy', yScale(endPt.share));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);

    const middle = document.createElement('div');
    middle.appendChild(svg);

    // Right: change in pp
    const right = document.createElement('div');
    const ch = p.change;
    const sign = ch >= 0 ? '+' : '';
    const changeColor = ch > 0.5  ? 'var(--acid)'
                      : ch < -0.5 ? 'var(--red)'
                      : 'var(--text-secondary)';
    const arrow = ch > 0.5 ? '▲' : ch < -0.5 ? '▼' : '◆';
    right.innerHTML = `
      <div class="hitlist-change" style="color:${changeColor}">${arrow}&nbsp;${sign}${ch.toFixed(1)}<span style="font-size:0.65em;letter-spacing:0.05em;margin-left:2px;color:var(--text-muted)">PP</span></div>
      <span class="hitlist-change-sub">${p.current.toFixed(0)}% → ${p.predicted.toFixed(0)}%</span>
    `;

    row.appendChild(left);
    row.appendChild(middle);
    row.appendChild(right);
    container.appendChild(row);
  });
}

// ── Chart 4: genre lifecycle trajectory map ──────────────────────────────────
function renderLifecycleQuadrant(visibleGenres) {
  const container = document.getElementById('viz-quadrant');
  if (!container) return;
  container.innerHTML = '';

  if (!globalSeries || globalSeries.size === 0) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">Lifecycle data unavailable</p></div>`;
    return;
  }

  // ── Build trajectory per genre ────────────────────────────────────────────
  const slopeAt = (history, targetYear, lookback = 5) => {
    const window = history.filter(d => d.year > targetYear - lookback && d.year <= targetYear);
    if (window.length < 3) return null;
    const xBar = d3.mean(window, d => d.year);
    const yBar = d3.mean(window, d => d.share);
    const sxx  = d3.sum(window, d => (d.year - xBar) ** 2);
    if (sxx === 0) return null;
    return d3.sum(window, d => (d.year - xBar) * (d.share - yBar)) / sxx;
  };

  // EU chart slope (pp/year) over the most recent `months` of monthly data
  const euSlopeWindow = (genre, months) => {
    const eu = regionalMonthly?.get('EU')?.get(genre);
    if (!eu || eu.length < 3) return null;
    const recent = eu.slice(-months);
    if (recent.length < 3) return null;
    const xBar = d3.mean(recent, d => d.decYear);
    const yBar = d3.mean(recent, d => d.share);
    const sxx  = d3.sum(recent, d => (d.decYear - xBar) ** 2);
    if (sxx === 0) return null;
    return d3.sum(recent, d => (d.decYear - xBar) * (d.share - yBar)) / sxx;
  };

  const strongestCorr = (genre) => {
    if (!euInfluence) return { region: null, r: 0 };
    let best = { region: null, r: 0 };
    for (const e of euInfluence) {
      if (e.genre !== genre) continue;
      if (Math.abs(e.correlation) > Math.abs(best.r)) {
        best = { region: e.region, r: e.correlation };
      }
    }
    return best;
  };

  // Y axis is expressed as a 6-month pp change (same units as the hitlist).
  // No clamp — the axis auto-scales below to fit the real values, so the arrow
  // tip always lands on the exact PP the hitlist prints (even big movers).

  const trajectories = visibleGenres.map(genre => {
    const series = globalSeries.get(genre);
    if (!series || series.history.length < 10) return null;

    const history = series.history;
    const lastPt  = history[history.length - 1];
    const corr    = strongestCorr(genre);

    // ── X-axis = catalog share: today → global forecast ~5 years out ─────────
    const currentShare = lastPt.share;
    const fc      = computeEnsembleForecast(history);
    const targetY = lastPt.year + 5;
    const fcPt    = fc.find(f => f.year === targetY)
                 || fc.find(f => f.year === 2030)
                 || fc[fc.length - 1];
    const forecastShare = fcPt ? fcPt.share : null;

    // ── Y-axis = short-term EU trend, in the SAME 6-month pp the hitlist uses ──
    // Dot   = EU last-6-month trend, expressed as a 6-month change (euSlope × ½).
    // Arrow = the predicted change the hitlist prints (stf.change = the blended
    // slope × ½). Plotting in pp/6-mo — not pp/yr — makes the arrow tip land
    // exactly on the trend chart's "PP" value, so the two charts agree.
    const HORIZON_YEARS = 0.5;                          // 6 months, matches the hitlist
    const stf           = computeShortTermForecast(genre, 6);
    const fallbackSlope = euSlopeWindow(genre, 6);
    const baseSlope     = stf ? stf.euSlope
                        : (fallbackSlope != null ? fallbackSlope : slopeAt(history, lastPt.year));
    const currentTrend  = baseSlope != null ? baseSlope * HORIZON_YEARS : null;
    const comingTrend   = stf ? stf.change : currentTrend;

    if (currentShare == null || forecastShare == null || currentTrend == null) return null;

    const trail = [
      { tag: 'now', share: currentShare,  slope: currentTrend, kind: 'now' },
      { tag: '5yr', share: forecastShare, slope: (comingTrend != null ? comingTrend : currentTrend), kind: 'forecast' },
    ];

    return {
      genre,
      color: GENRE_COLORS[genre] || '#a09a90',
      trail,
      corr,
    };
  }).filter(Boolean);

  if (!trajectories.length) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">No trajectories for selected genres</p></div>`;
    return;
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  // Fill the flex-allocated container height (so this view and the Forecast
  // view, which share the same fixed-height column, render at one size).
  // Subtract the container's padding — with border-box, getBoundingClientRect
  // reports the padded box, and drawing the SVG at that size pushes the bottom
  // legend out of bounds.
  const rect    = container.getBoundingClientRect();
  const cs      = getComputedStyle(container);
  const padX    = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY    = parseFloat(cs.paddingTop)  + parseFloat(cs.paddingBottom);
  const width   = (rect.width  || 900) - padX;
  const height  = Math.max((rect.height || 540) - padY, 460);
  const margin  = { top: 32, right: 36, bottom: 64, left: 64 };
  const iW = width - margin.left - margin.right;
  const iH = height - margin.top - margin.bottom;

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height).style('display', 'block');
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Scales — cross is visually centered: divider at iW/2 (X) and iH/2 (Y=0)
  const allShares = trajectories.flatMap(t => t.trail.map(p => p.share));
  const allSlopes = trajectories.flatMap(t => t.trail.map(p => p.slope));
  const xMax  = Math.max(15, d3.max(allShares) * 1.18);
  const ySpan = Math.max(0.8, Math.max(Math.abs(d3.min(allSlopes)), Math.abs(d3.max(allSlopes))) * 1.30);
  const xScale = d3.scaleLinear().domain([0, xMax]).range([0, iW]);
  const yScale = d3.scaleLinear().domain([-ySpan, ySpan]).range([iH, 0]);

  // Cross sits at exact pixel center of the plot
  const xMid = iW / 2;
  const yMid = iH / 2;
  const xMidVal = xMax / 2;  // data value at the divider for X (≈ midpoint share)

  // ── Subtle per-quadrant background tints ──────────────────────────────────
  // Top-right: Dominant Rising = acid hint, Bottom-left: Fading = red hint
  g.append('rect').attr('x', xMid).attr('y', 0).attr('width', iW - xMid).attr('height', yMid)
    .attr('fill', 'rgba(200,240,0,0.025)');
  g.append('rect').attr('x', 0).attr('y', yMid).attr('width', xMid).attr('height', iH - yMid)
    .attr('fill', 'rgba(229,50,28,0.025)');

  // ── Cross (prominent, neutral grey) ───────────────────────────────────────
  const AXIS_COLOR = '#5a5550';
  g.append('line').attr('x1', xMid).attr('x2', xMid).attr('y1', 0).attr('y2', iH)
    .attr('stroke', AXIS_COLOR).attr('stroke-width', 1.5);
  g.append('line').attr('x1', 0).attr('x2', iW).attr('y1', yMid).attr('y2', yMid)
    .attr('stroke', AXIS_COLOR).attr('stroke-width', 1.5);

  // Centre marker — small grey diamond
  g.append('rect')
    .attr('x', xMid - 4).attr('y', yMid - 4)
    .attr('width', 8).attr('height', 8)
    .attr('transform', `rotate(45 ${xMid} ${yMid})`)
    .attr('fill', 'var(--bg-surface)')
    .attr('stroke', AXIS_COLOR).attr('stroke-width', 1.5);

  // ── Quadrant labels — lifecycle stage + a plain-language read of the axes ──
  // Stage word = where the genre is in its life; descriptor spells out the two
  // axes (X = share size, Y = 6-month momentum) so the corner is self-explaining.
  const qLabel = (cx, cy, stage, desc) => {
    g.append('text')
      .attr('x', cx).attr('y', cy).attr('text-anchor', 'middle')
      .attr('fill', '#8a8580')
      .attr('font-family', 'Bebas Neue, Impact, sans-serif')
      .attr('font-size', 16).attr('letter-spacing', '0.16em')
      .text(stage);
    g.append('text')
      .attr('x', cx).attr('y', cy + 13).attr('text-anchor', 'middle')
      .attr('fill', '#5a5550')
      .attr('font-family', 'DM Mono, monospace')
      .attr('font-size', 8.5).attr('letter-spacing', '0.10em')
      .text(desc);
  };
  qLabel(xMid / 2,      20,      'EMERGING', 'small share · heating up');
  qLabel(xMid + iW / 4, 20,      'PEAKING',  'big share · heating up');
  qLabel(xMid + iW / 4, iH - 20, 'MATURE',   'big share · cooling');
  qLabel(xMid / 2,      iH - 20, 'FADING',   'small share · cooling');


  // ── Ticks ON the cross axes (no external axes) ────────────────────────────
  // X ticks along the horizontal cross axis (y = yMid)
  const xTicks = xScale.ticks(5).filter(v => v > 0 && xScale(v) > 12 && xScale(v) < iW - 12);
  xTicks.forEach(v => {
    const xp = xScale(v);
    g.append('line')
      .attr('x1', xp).attr('x2', xp).attr('y1', yMid - 4).attr('y2', yMid + 4)
      .attr('stroke', AXIS_COLOR).attr('stroke-width', 1.2);
    g.append('text')
      .attr('x', xp).attr('y', yMid + 14).attr('text-anchor', 'middle')
      .attr('fill', '#7a7570').attr('font-family', 'DM Mono, monospace')
      .attr('font-size', 9).attr('letter-spacing', '0.06em')
      .text(v + '%');
  });

  // Y ticks along the vertical cross axis (x = xMid), skipping 0 (the cross itself)
  const yTicks = yScale.ticks(5).filter(v => v !== 0 && yScale(v) > 12 && yScale(v) < iH - 12);
  yTicks.forEach(v => {
    const yp = yScale(v);
    g.append('line')
      .attr('x1', xMid - 4).attr('x2', xMid + 4).attr('y1', yp).attr('y2', yp)
      .attr('stroke', AXIS_COLOR).attr('stroke-width', 1.2);
    g.append('text')
      .attr('x', xMid - 8).attr('y', yp + 3).attr('text-anchor', 'end')
      .attr('fill', '#7a7570').attr('font-family', 'DM Mono, monospace')
      .attr('font-size', 9).attr('letter-spacing', '0.06em')
      .text((v > 0 ? '+' : '') + v.toFixed(1) + ' pp');
  });

  // ── Axis driver labels at the start of each cross axis ────────────────────
  // X-dimension label (SHARE) rotated vertically at LEFT MIDDLE — reads bottom-up
  g.append('text')
    .attr('transform', `translate(-22, ${yMid}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .attr('fill', '#a09a90')
    .attr('font-family', 'DM Mono, monospace')
    .attr('font-size', 10).attr('letter-spacing', '0.22em')
    .text('SHARE');

  // Small arrow at the RIGHT END of the horizontal cross axis, pointing right
  g.append('path')
    .attr('d', `M ${iW - 4},${yMid - 4} L ${iW + 4},${yMid} L ${iW - 4},${yMid + 4} Z`)
    .attr('fill', AXIS_COLOR);

  // Y-dimension label (TREND) anchored at BOTTOM MIDDLE
  g.append('text')
    .attr('x', xMid).attr('y', iH + 22).attr('text-anchor', 'middle')
    .attr('fill', '#a09a90')
    .attr('font-family', 'DM Mono, monospace')
    .attr('font-size', 10).attr('letter-spacing', '0.22em')
    .text('6-MO TREND · PP');

  // Small arrow at the TOP END of the vertical cross axis, pointing up
  g.append('path')
    .attr('d', `M ${xMid - 4},4 L ${xMid},-4 L ${xMid + 4},4 Z`)
    .attr('fill', AXIS_COLOR);

  // ── Draw trajectories ────────────────────────────────────────────────────
  // Arrowhead defs — one per genre color
  const defs = svg.append('defs');
  trajectories.forEach((t, i) => {
    const mid = `arrow-${i}`;
    defs.append('marker')
      .attr('id', mid).attr('viewBox', '0 -4 8 8')
      .attr('refX', 6).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto-start-reverse')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', t.color);
    t._arrowId = mid;
  });

  trajectories.forEach(t => {
    const now  = t.trail.find(p => p.kind === 'now');
    const fore = t.trail.find(p => p.kind === 'forecast');

    // Arrow bundles two independent moves: X = today's share → 5-yr global
    // forecast, Y = current trend → projected 6-month trend. Hover highlights
    // it and pops a small bracket with both moves + EU correlation.
    if (now && fore) {
      const x1 = xScale(now.share);
      const y1 = yScale(now.slope);
      const x2 = xScale(fore.share);
      const y2 = yScale(fore.slope);
      // Pull the arrow tip slightly back so it doesn't overlap the forecast dot
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const back = 8;
      const x2t = x2 - (dx / len) * back;
      const y2t = y2 - (dy / len) * back;

      const arrow = g.append('line')
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2t).attr('y2', y2t)
        .attr('stroke', t.color).attr('stroke-width', 2)
        .attr('stroke-dasharray', '4 3').attr('opacity', 0.75)
        .attr('marker-end', `url(#${t._arrowId})`);

      const fmt        = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
      const shareDelta = fore.share - now.share;   // 5-yr share move (X)
      const tipRows    = [
        { label: 'Share (5y)', value: `${now.share.toFixed(1)}% → ${fore.share.toFixed(1)}%  (${fmt(shareDelta)} pp)`, color: t.color },
        { label: 'Trend (6mo)', value: `${fmt(now.slope, 2)} → ${fmt(fore.slope, 2)} pp`, color: t.color },
      ];
      if (t.corr.region) {
        tipRows.push({ label: 'EU tracks', value: `${t.corr.region.toUpperCase()} · r=${fmt(t.corr.r, 2)}`, color: t.color });
      }

      // Invisible fat hit-area makes the thin dashed arrow easy to hover
      g.append('line')
        .attr('x1', x1).attr('y1', y1).attr('x2', x2).attr('y2', y2)
        .attr('stroke', 'transparent').attr('stroke-width', 16)
        .style('cursor', 'pointer')
        .on('mouseenter', (event) => {
          arrow.attr('stroke-width', 3.5).attr('opacity', 1);
          tooltip.show(event, tooltipHtml(t.genre.toUpperCase(), tipRows));
        })
        .on('mousemove', (event) => tooltip.move(event))
        .on('mouseleave', () => {
          arrow.attr('stroke-width', 2).attr('opacity', 0.75);
          tooltip.hide();
        });
    }

    // "Now" dot — large, filled, prominent
    if (now) {
      g.append('circle')
        .attr('cx', xScale(now.share)).attr('cy', yScale(now.slope))
        .attr('r', 8)
        .attr('fill', t.color)
        .attr('stroke', 'var(--bg-surface)').attr('stroke-width', 2);
    }
  });

  // ── Genre labels — drawn last (top layer) so they never sit under an arrow ──
  // Each label starts on the side OPPOSITE its own arrow, then a greedy pass
  // nudges any that still collide so two names never stack on each other.
  const FONT_PX = 14, LABEL_H = 15, CHAR_W = 8.4;
  const labels = trajectories.map(t => {
    const now  = t.trail.find(p => p.kind === 'now');
    const fore = t.trail.find(p => p.kind === 'forecast');
    if (!now) return null;
    const dotX = xScale(now.share);
    const dotY = yScale(now.slope);
    const goesRight = fore ? xScale(fore.share) >= dotX : true;   // arrow heads right?
    const goesUp    = fore ? yScale(fore.slope)  <  dotY : false; // up = smaller y
    const text   = t.genre.toUpperCase();
    const w      = text.length * CHAR_W;
    const anchor = goesRight ? 'end' : 'start';
    const x      = goesRight ? dotX - 13 : dotX + 13;             // opposite the arrow
    const x0     = goesRight ? x - w : x;                         // left edge of the text box
    return { color: t.color, text, x, x0, w, anchor,
             y: dotY + (goesUp ? 15 : -7) };
  }).filter(Boolean);

  // Greedy vertical de-overlap: scan top→bottom, push a label down only when it
  // both overlaps the previous one horizontally and sits too close vertically.
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = labels[j], b = labels[i];
      const overlapX = a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w;
      if (overlapX && Math.abs(a.y - b.y) < LABEL_H) {
        b.y = a.y + LABEL_H;
      }
    }
  }

  labels.forEach(l => {
    g.append('text')
      .attr('x', l.x).attr('y', l.y).attr('text-anchor', l.anchor)
      .attr('fill', l.color)
      .attr('font-family', 'Bebas Neue, Impact, sans-serif')
      .attr('font-size', FONT_PX).attr('letter-spacing', '0.04em')
      .attr('stroke', 'var(--bg-surface)').attr('stroke-width', 3.5)
      .attr('paint-order', 'stroke')           // halo behind the glyphs
      .text(l.text);
  });

  // ── Legend strip (tiny, bottom-right) ─────────────────────────────────────
  const legY = iH + 48;
  const legG = svg.append('g').attr('transform', `translate(${margin.left + iW - 280}, ${margin.top + legY})`);

  // "Now" dot
  legG.append('circle').attr('cx', 0).attr('cy', 0).attr('r', 6)
    .attr('fill', '#a09a90').attr('stroke', 'var(--bg-surface)').attr('stroke-width', 2);
  legG.append('text').attr('x', 10).attr('y', 3)
    .attr('fill', '#a09a90').attr('font-family', 'DM Mono, monospace')
    .attr('font-size', 8).attr('letter-spacing', '0.12em').text('TODAY');

  // Arrow: share→5yr forecast (X) + current→coming trend (Y)
  legG.append('line').attr('x1', 70).attr('y1', 0).attr('x2', 100).attr('y2', 0)
    .attr('stroke', '#a09a90').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 3');
  legG.append('path').attr('d', 'M100,-4 L108,0 L100,4 Z').attr('fill', '#a09a90');
  legG.append('text').attr('x', 114).attr('y', 3)
    .attr('fill', '#a09a90').attr('font-family', 'DM Mono, monospace')
    .attr('font-size', 8).attr('letter-spacing', '0.12em').text('HEADING');
}
