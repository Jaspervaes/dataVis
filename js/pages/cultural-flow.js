/**
 * cultural-flow.js
 * ─────────────────────────────────────────────────────────────
 * Sankey diagram: genre flow between continents.
 *
 * Shows how many tracks of each genre originate from each
 * continental region, visualised as proportional flows.
 *
 * TODO: Replace mockSankeyData() with a real data call:
 *   const raw   = await loadCSV('../data/spotify-tracks.csv');
 *   const {nodes, links} = transformToSankey(raw, filters);
 *
 * Depends on:
 *   - D3 v7 (global window.d3)
 *   - d3-sankey plugin (window.d3Sankey)
 *   - filters.js  (filter state)
 *   - tooltip.js  (hover tooltips)
 * ─────────────────────────────────────────────────────────────
 */

import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }   from '../tooltip.js';
import { loadCSV }                 from '../data-loader.js';

// ── Design tokens (must match variables.css) ─────────────────
const REGION_COLORS = {
  'Europe':        'var(--acid)',
  'North America': '#e5321c',
  'Latin America': '#e07840',
  'Africa':        '#f0a830',
  'Asia':          '#6aabf0',
};

const GENRE_COLORS = {
  'Pop':        'var(--acid)',
  'Hip-Hop':    '#e5321c',
  'Electronic': '#6aabf0',
  'Latin':      '#f0a830',
  'R&B':        '#c47fa0',
  'Afrobeats':  '#82d4be',
};

// Hex equivalents for SVG attribute use (CSS vars are unreliable in
// stroke/fill attrs across browsers).
const REGION_HEX = {
  'Europe':        '#c8f000',
  'North America': '#e5321c',
  'Latin America': '#e07840',
  'Africa':        '#f0a830',
  'Asia':          '#6aabf0',
};

const GENRE_HEX = {
  'Pop':        '#c8f000',
  'Hip-Hop':    '#e5321c',
  'Electronic': '#6aabf0',
  'Latin':      '#f0a830',
  'R&B':        '#c47fa0',
  'Afrobeats':  '#82d4be',
};

const MUTED_FILL    = '#1c1916'; // var(--bg-elevated)
const BORDER_STROKE = '#252018'; // var(--border)

const SOURCES = ['Europe', 'North America', 'Latin America', 'Africa', 'Asia'];

// Maps region label → sidebar filter key
const REGION_FILTER_KEY = {
  'Europe':        'europe',
  'North America': 'north-america',
  'Latin America': 'latin-america',
  'Africa':        'africa',
  'Asia':          'asia',
};

/** @type {object[]} raw CSV rows */
let rawTracks = [];

// ── Data transform ────────────────────────────────────────────
function transformToSankey(tracks, filters) {
  const { decadeRange, regions } = filters;
  const [startYear, endYear] = decadeRange;

  // Tally flows: region → genre
  const flows = {};
  for (const row of tracks) {
    const year = +row.year;
    if (year < startYear || year > endYear) continue;

    const region = REGION_TO_NODE[row.artist_country];
    if (!region) continue;
    const filterKey = REGION_FILTER_KEY[region];
    if (!regions.includes(filterKey)) continue;

    const genre = row.genre;
    if (!GENRE_COLORS[genre]) continue;

    const key = `${region}|||${genre}`;
    flows[key] = (flows[key] || 0) + 1;
  }

  if (Object.keys(flows).length === 0) return { nodes: [], links: [] };

  // Build unique node list preserving source/target order
  const nodeNames = [
    ...SOURCES,
    ...Object.keys(GENRE_COLORS),
  ];
  const nodes = nodeNames.map(name => ({ id: name, name }));

  // Links use string node ids to match .nodeId(d => d.id) in the layout
  const links = Object.entries(flows)
    .map(([key, value]) => {
      const [source, target] = key.split('|||');
      return { source, target, value };
    })
    .filter(l => l.value > 0);

  return { nodes, links };
}

// Maps ISO-2 country code → region label
const REGION_TO_NODE = {
  // Europe
  GB:'Europe',DE:'Europe',FR:'Europe',SE:'Europe',NO:'Europe',NL:'Europe',
  BE:'Europe',IT:'Europe',ES:'Europe',PT:'Europe',DK:'Europe',FI:'Europe',
  PL:'Europe',RU:'Europe',UA:'Europe',IE:'Europe',CH:'Europe',AT:'Europe',
  HU:'Europe',CZ:'Europe',RO:'Europe',GR:'Europe',RS:'Europe',HR:'Europe',
  IS:'Europe',LU:'Europe',SK:'Europe',SI:'Europe',LV:'Europe',LT:'Europe',
  EE:'Europe',BA:'Europe',MK:'Europe',ME:'Europe',AL:'Europe',
  // North America
  US:'North America',CA:'North America',
  // Latin America (Spanish/Portuguese-speaking Americas + Caribbean)
  MX:'Latin America',BR:'Latin America',CO:'Latin America',AR:'Latin America',
  CL:'Latin America',PE:'Latin America',VE:'Latin America',CU:'Latin America',
  JM:'Latin America',TT:'Latin America',DO:'Latin America',PA:'Latin America',
  EC:'Latin America',BO:'Latin America',UY:'Latin America',PY:'Latin America',
  GT:'Latin America',HN:'Latin America',CR:'Latin America',SV:'Latin America',
  NI:'Latin America',HT:'Latin America',
  // Africa
  NG:'Africa',ZA:'Africa',GH:'Africa',KE:'Africa',SN:'Africa',CM:'Africa',
  TZ:'Africa',UG:'Africa',ET:'Africa',EG:'Africa',MA:'Africa',TN:'Africa',
  CI:'Africa',ML:'Africa',CD:'Africa',AO:'Africa',MZ:'Africa',ZW:'Africa',
  BW:'Africa',ZM:'Africa',RW:'Africa',BJ:'Africa',TG:'Africa',BF:'Africa',
  MW:'Africa',
  // Asia
  JP:'Asia',KR:'Asia',CN:'Asia',IN:'Asia',ID:'Asia',PH:'Asia',TH:'Asia',
  VN:'Asia',MY:'Asia',SG:'Asia',PK:'Asia',BD:'Asia',IR:'Asia',TR:'Asia',
  SA:'Asia',AE:'Asia',LB:'Asia',IL:'Asia',IQ:'Asia',SY:'Asia',KZ:'Asia',
  UZ:'Asia',MM:'Asia',KH:'Asia',LK:'Asia',
};

// Maps world-atlas-50m country `properties.name` → region label.
// Used only by the world map; not all entries appear in the track data.
const COUNTRY_NAME_TO_REGION = {
  // Europe
  'Albania':'Europe','Andorra':'Europe','Austria':'Europe','Belarus':'Europe',
  'Belgium':'Europe','Bosnia and Herz.':'Europe','Bulgaria':'Europe',
  'Croatia':'Europe','Cyprus':'Europe','N. Cyprus':'Europe','Czechia':'Europe',
  'Denmark':'Europe','Estonia':'Europe','Faeroe Is.':'Europe','Finland':'Europe',
  'France':'Europe','Germany':'Europe','Greece':'Europe','Hungary':'Europe',
  'Iceland':'Europe','Ireland':'Europe','Isle of Man':'Europe','Italy':'Europe',
  'Kosovo':'Europe','Latvia':'Europe','Liechtenstein':'Europe','Lithuania':'Europe',
  'Luxembourg':'Europe','Malta':'Europe','Moldova':'Europe','Monaco':'Europe',
  'Montenegro':'Europe','Netherlands':'Europe','North Macedonia':'Europe',
  'Macedonia':'Europe','Norway':'Europe','Poland':'Europe','Portugal':'Europe',
  'Romania':'Europe','Russia':'Europe','San Marino':'Europe','Serbia':'Europe',
  'Slovakia':'Europe','Slovenia':'Europe','Spain':'Europe','Sweden':'Europe',
  'Switzerland':'Europe','Ukraine':'Europe','United Kingdom':'Europe','Vatican':'Europe',
  // North America
  'Canada':'North America','United States of America':'North America',
  'Greenland':'North America','Bermuda':'North America',
  // Latin America (Spanish/Portuguese-speaking Americas + Caribbean)
  'Mexico':'Latin America','Belize':'Latin America','Costa Rica':'Latin America',
  'El Salvador':'Latin America','Guatemala':'Latin America','Honduras':'Latin America',
  'Nicaragua':'Latin America','Panama':'Latin America','Argentina':'Latin America',
  'Bolivia':'Latin America','Brazil':'Latin America','Chile':'Latin America',
  'Colombia':'Latin America','Ecuador':'Latin America','Guyana':'Latin America',
  'Paraguay':'Latin America','Peru':'Latin America','Suriname':'Latin America',
  'Uruguay':'Latin America','Venezuela':'Latin America','Falkland Is.':'Latin America',
  'Bahamas':'Latin America','Cuba':'Latin America','Dominican Rep.':'Latin America',
  'Haiti':'Latin America','Jamaica':'Latin America','Puerto Rico':'Latin America',
  'Trinidad and Tobago':'Latin America',
  // Africa
  'Algeria':'Africa','Angola':'Africa','Benin':'Africa','Botswana':'Africa',
  'Burkina Faso':'Africa','Burundi':'Africa','Cabo Verde':'Africa','Cameroon':'Africa',
  'Central African Rep.':'Africa','Chad':'Africa','Comoros':'Africa','Congo':'Africa',
  "Côte d'Ivoire":'Africa','Dem. Rep. Congo':'Africa','Djibouti':'Africa',
  'Egypt':'Africa','Eq. Guinea':'Africa','Eritrea':'Africa','eSwatini':'Africa',
  'Eswatini':'Africa','Swaziland':'Africa','Ethiopia':'Africa','Gabon':'Africa',
  'Gambia':'Africa','Ghana':'Africa','Guinea':'Africa','Guinea-Bissau':'Africa',
  'Kenya':'Africa','Lesotho':'Africa','Liberia':'Africa','Libya':'Africa',
  'Madagascar':'Africa','Malawi':'Africa','Mali':'Africa','Mauritania':'Africa',
  'Mauritius':'Africa','Morocco':'Africa','Mozambique':'Africa','Namibia':'Africa',
  'Niger':'Africa','Nigeria':'Africa','Rwanda':'Africa','Senegal':'Africa',
  'Sierra Leone':'Africa','Somalia':'Africa','Somaliland':'Africa','South Africa':'Africa',
  'S. Sudan':'Africa','Sudan':'Africa','Tanzania':'Africa','Togo':'Africa',
  'Tunisia':'Africa','Uganda':'Africa','W. Sahara':'Africa','Zambia':'Africa',
  'Zimbabwe':'Africa',
  // Asia
  'Afghanistan':'Asia','Armenia':'Asia','Azerbaijan':'Asia','Bahrain':'Asia',
  'Bangladesh':'Asia','Bhutan':'Asia','Brunei':'Asia','Cambodia':'Asia',
  'China':'Asia','Georgia':'Asia','Hong Kong':'Asia','India':'Asia','Indonesia':'Asia',
  'Iran':'Asia','Iraq':'Asia','Israel':'Asia','Japan':'Asia','Jordan':'Asia',
  'Kazakhstan':'Asia','Kuwait':'Asia','Kyrgyzstan':'Asia','Laos':'Asia',
  'Lebanon':'Asia','Macao':'Asia','Malaysia':'Asia','Maldives':'Asia',
  'Mongolia':'Asia','Myanmar':'Asia','Nepal':'Asia','North Korea':'Asia',
  'Dem. Rep. Korea':'Asia','Oman':'Asia','Pakistan':'Asia','Palestine':'Asia',
  'Philippines':'Asia','Qatar':'Asia','Saudi Arabia':'Asia','Singapore':'Asia',
  'South Korea':'Asia','Korea':'Asia','Sri Lanka':'Asia','Syria':'Asia',
  'Taiwan':'Asia','Tajikistan':'Asia','Thailand':'Asia','Timor-Leste':'Asia',
  'Turkey':'Asia','Turkmenistan':'Asia','United Arab Emirates':'Asia',
  'Uzbekistan':'Asia','Vietnam':'Asia','Yemen':'Asia',
};

// Cached world TopoJSON (loaded once per page).
let worldFeatures = null;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  // filters.js defaults use 'americas'; force-check the split boxes and re-sync
  document.querySelectorAll(
    '[data-filter-group="region"][value="north-america"],' +
    '[data-filter-group="region"][value="latin-america"]'
  ).forEach(cb => { cb.checked = true; });
  document.querySelector('[data-filter-group="region"]')
    ?.dispatchEvent(new Event('change'));

  rawTracks = await loadCSV('../data/spotify-tracks.csv');

  // Load world map (TopoJSON) in parallel; failure is non-fatal.
  loadWorldMap()
    .then(() => renderWorldMap(getFilters()))
    .catch(err => console.warn('World map failed to load', err));

  renderAll(getFilters());

  window.addEventListener('filters:changed', (e) => renderAll(e.detail));
  window.addEventListener('resize', () => renderAll(getFilters()));
});

function renderAll(filters) {
  renderTimeline(computeGenreShareSeries(rawTracks, filters));
  renderWorldMap(filters);
}

async function loadWorldMap() {
  if (worldFeatures) return worldFeatures;
  const topo = await d3.json(
    'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json'
  );
  if (typeof topojson === 'undefined') {
    throw new Error('topojson-client global is missing');
  }
  worldFeatures = topojson.feature(topo, topo.objects.countries);
  return worldFeatures;
}

// ── Render ────────────────────────────────────────────────────
function render(data) {
  const container = document.getElementById('viz-container');
  if (!container) return;
  container.innerHTML = '';

  if (!d3.sankey) {
    container.innerHTML = `<div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"/>
      </svg>
      <p class="empty-state-title">Sankey plugin not loaded</p>
      <p class="empty-state-desc">Ensure d3-sankey is included before this script.</p>
    </div>`;
    return;
  }

  const { sankey, sankeyLinkHorizontal } = d3;

  const rect   = container.getBoundingClientRect();
  const width  = rect.width  || 800;
  const height = Math.max(rect.height || 520, 440);

  const margin = { top: 20, right: 160, bottom: 20, left: 130 };
  const innerW = width  - margin.left - margin.right;
  const innerH = height - margin.top  - margin.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('width',  width)
    .attr('height', height)
    .attr('aria-label', 'Sankey diagram showing genre flows from continents')
    .attr('role', 'img');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Deep-copy data so Sankey can mutate it
  const sankeyData = {
    nodes: data.nodes.map(n => ({ ...n })),
    links: data.links.map(l => ({ ...l })),
  };

  const sankeyLayout = sankey()
    .nodeId(d => d.id)
    .nodeWidth(16)
    .nodePadding(14)
    .extent([[0, 0], [innerW, innerH]]);

  const { nodes, links } = sankeyLayout(sankeyData);

  // ── Links ──────────────────────────────────────────────────
  const linkG = g.append('g').attr('class', 'sankey-links');

  linkG.selectAll('path')
    .data(links)
    .join('path')
    .attr('d', sankeyLinkHorizontal())
    .attr('stroke-width', d => Math.max(1, d.width))
    .attr('stroke', d => {
      const srcName = d.source.name;
      return REGION_COLORS[srcName] || '#7c3aed';
    })
    .attr('stroke-opacity', 0.28)
    .attr('fill', 'none')
    .attr('class', 'sankey-link')
    .style('cursor', 'pointer')
    .on('mouseenter', function(event, d) {
      d3.select(this).attr('stroke-opacity', 0.55);
      tooltip.show(event, tooltipHtml(
        `${d.source.name} → ${d.target.name}`,
        [{ label: 'Track flow', value: d.value.toLocaleString() }]
      ));
    })
    .on('mousemove', event => tooltip.move(event))
    .on('mouseleave', function() {
      d3.select(this).attr('stroke-opacity', 0.28);
      tooltip.hide();
    });

  // ── Nodes ──────────────────────────────────────────────────
  const nodeG = g.append('g').attr('class', 'sankey-nodes');

  const nodeRects = nodeG.selectAll('g')
    .data(nodes)
    .join('g')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  nodeRects.append('rect')
    .attr('height', d => Math.max(1, d.y1 - d.y0))
    .attr('width',  d => d.x1 - d.x0)
    .attr('fill',   d => REGION_COLORS[d.name] || GENRE_COLORS[d.name] || '#475569')
    .attr('rx', 3)
    .attr('opacity', 0.9)
    .style('cursor', 'pointer')
    .on('mouseenter', function(event, d) {
      d3.select(this).attr('opacity', 1);
      const total = d.value ?? (d.sourceLinks?.reduce((s, l) => s + l.value, 0) || 0);
      tooltip.show(event, tooltipHtml(d.name, [
        { label: 'Total flow', value: total.toLocaleString() },
      ]));
    })
    .on('mousemove', event => tooltip.move(event))
    .on('mouseleave', function() {
      d3.select(this).attr('opacity', 0.9);
      tooltip.hide();
    });

  // ── Labels ─────────────────────────────────────────────────
  nodeRects.append('text')
    .attr('x', d => SOURCES.includes(d.name) ? -8 : (d.x1 - d.x0 + 8))
    .attr('y', d => (d.y1 - d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', d => SOURCES.includes(d.name) ? 'end' : 'start')
    .attr('fill', '#f1f5f9')
    .attr('font-size', 12)
    .attr('font-family', 'Inter, system-ui, sans-serif')
    .attr('font-weight', 500)
    .text(d => d.name);

  // ── Legend ─────────────────────────────────────────────────
  const legendData = [
    ...SOURCES.map(s => ({ label: s, color: REGION_COLORS[s], type: 'region' })),
    ...Object.entries(GENRE_COLORS).map(([g, c]) => ({ label: g, color: c, type: 'genre' })),
  ];

  const legendG = svg.append('g')
    .attr('transform', `translate(${margin.left}, ${height - 10})`);

  // (Legend rendered in the HTML insight cards for space reasons)

  updateInsightCards(data);
}

// ── Insight cards ─────────────────────────────────────────────
function updateInsightCards(data) {
  const topFlow = data.links.reduce((max, l) =>
    l.value > max.value ? l : max, data.links[0] || { value: 0, source: 0, target: 0 });
  const srcNode = data.nodes[topFlow.source] || {};
  const tgtNode = data.nodes[topFlow.target] || {};
  const totalFlow = data.links.reduce((s, l) => s + l.value, 0);

  setCard('card-top-flow',    `${srcNode.name} → ${tgtNode.name}`, topFlow.value, null, 'Strongest genre corridor');
  setCard('card-total-tracks', totalFlow.toLocaleString(),          null,          null, 'Total track flows visualised');
  setCard('card-regions',      data.nodes.filter(n => SOURCES.includes(n.name)).length, null, null, 'Source regions tracked');
  setCard('card-genres',       data.nodes.filter(n => !SOURCES.includes(n.name)).length, null, null, 'Genre destinations');
}

function setCard(id, value, extra, trend, desc) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl  = el.querySelector('.insight-card-value');
  const descEl = el.querySelector('.insight-card-desc');
  if (valEl)  valEl.textContent  = value;
  if (descEl) descEl.textContent = desc;
}

// ══════════════════════════════════════════════════════════════
//  GENRE SHARE OVER TIME — multi-line chart
// ══════════════════════════════════════════════════════════════

function computeGenreShareSeries(tracks, filters) {
  const { decadeRange, regions } = filters;
  const [startYear, endYear] = decadeRange;
  const genres = Object.keys(GENRE_HEX);

  const filtered = tracks.filter(t => {
    const y = +t.year;
    if (!Number.isFinite(y) || y < startYear || y > endYear) return false;
    const region = REGION_TO_NODE[t.artist_country];
    if (!region) return false;
    const filterKey = REGION_FILTER_KEY[region];
    if (!regions.includes(filterKey)) return false;
    return GENRE_HEX[t.genre] != null;
  });

  if (filtered.length === 0) return { years: [], series: [] };

  const byYearGenre = d3.rollup(
    filtered,
    v => v.length,
    d => +d.year,
    d => d.genre,
  );

  const years = d3.range(startYear, endYear + 1);
  const cum = Object.fromEntries(genres.map(g => [g, 0]));
  const points = Object.fromEntries(genres.map(g => [g, []]));
  let firstActive = -1;

  for (const y of years) {
    const yr = byYearGenre.get(y);
    if (yr) yr.forEach((c, g) => { if (genres.includes(g)) cum[g] += c; });
    const total = genres.reduce((s, g) => s + cum[g], 0);
    if (firstActive < 0 && total > 0) firstActive = y;
    if (total === 0) {
      genres.forEach(g => points[g].push({ year: y, share: 0 }));
    } else {
      genres.forEach(g => points[g].push({ year: y, share: cum[g] / total }));
    }
  }

  if (firstActive < 0) return { years: [], series: [] };

  const trimmedYears = years.filter(y => y >= firstActive);
  const series = genres.map(g => ({
    genre:  g,
    color:  GENRE_HEX[g],
    points: points[g].filter(p => p.year >= firstActive),
  }));

  return { years: trimmedYears, series };
}

function renderTimeline(data) {
  const container = document.getElementById('timeline-container');
  if (!container) return;
  container.innerHTML = '';

  const { years, series } = data;
  if (!years.length || !series.length) {
    container.innerHTML = `<div class="empty-state" style="min-height:280px;">
      <p class="empty-state-title">No data for current filters</p>
      <p class="empty-state-desc">Adjust the decade range or regions to see genre shares.</p>
    </div>`;
    return;
  }

  const width  = container.clientWidth || 700;
  const height = 360;
  const margin = { top: 20, right: 24, bottom: 44, left: 56 };
  const innerW = width  - margin.left - margin.right;
  const innerH = height - margin.top  - margin.bottom;

  const svg = d3.select(container).append('svg')
    .attr('width',  width)
    .attr('height', height)
    .attr('aria-label', 'Cumulative-normalised genre share over time');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleLinear()
    .domain(d3.extent(years))
    .range([0, innerW]);

  const maxShare = d3.max(series, s => d3.max(s.points, p => p.share)) || 0.5;
  const yMax = Math.min(1, Math.ceil((maxShare + 0.05) * 10) / 10);
  const yScale = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

  // Grid (horizontal lines from y-axis ticks)
  g.append('g')
    .attr('class', 'chart-grid')
    .call(d3.axisLeft(yScale).tickSize(-innerW).tickFormat('').ticks(5))
    .call(sel => sel.select('.domain').remove())
    .call(sel => sel.selectAll('text').remove());

  // Axes
  g.append('g')
    .attr('class', 'chart-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale)
      .tickFormat(d3.format('d'))
      .ticks(Math.min(8, Math.max(2, Math.floor(innerW / 70)))));

  g.append('g')
    .attr('class', 'chart-axis')
    .call(d3.axisLeft(yScale).tickFormat(d3.format('.0%')).ticks(5));

  svg.append('text')
    .attr('class', 'chart-axis-label')
    .attr('x', margin.left + innerW / 2)
    .attr('y', height - 8)
    .attr('text-anchor', 'middle')
    .text('Year');

  svg.append('text')
    .attr('class', 'chart-axis-label')
    .attr('transform', `translate(14,${margin.top + innerH / 2}) rotate(-90)`)
    .attr('text-anchor', 'middle')
    .text('Share of releases');

  const lineGen = d3.line()
    .x(p => xScale(p.year))
    .y(p => yScale(p.share))
    .curve(d3.curveMonotoneX);

  const linesG = g.append('g').attr('class', 'lines-group');
  linesG.selectAll('path')
    .data(series)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke', d => d.color)
    .attr('stroke-width', 2)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round')
    .attr('opacity', 0.95)
    .attr('d', d => lineGen(d.points));

  // Hover layer: vertical rule, dots, tooltip
  const focus = g.append('g').style('display', 'none').attr('pointer-events', 'none');

  focus.append('line')
    .attr('class', 'hover-rule')
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#5a5550')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3');

  const dots = focus.selectAll('circle')
    .data(series)
    .join('circle')
    .attr('r', 3.5)
    .attr('fill', d => d.color)
    .attr('stroke', '#0e0c0a')
    .attr('stroke-width', 1);

  g.append('rect')
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair')
    .on('mouseenter', () => focus.style('display', null))
    .on('mouseleave', () => { focus.style('display', 'none'); tooltip.hide(); })
    .on('mousemove', function(event) {
      const [mx] = d3.pointer(event);
      const yr = Math.max(years[0], Math.min(years[years.length - 1],
        Math.round(xScale.invert(mx))));
      const px = xScale(yr);
      focus.select('.hover-rule').attr('x1', px).attr('x2', px);

      const valuesAtYear = series.map(s => {
        const p = s.points.find(pt => pt.year === yr) ?? s.points[s.points.length - 1];
        return { genre: s.genre, color: s.color, share: p?.share ?? 0, _p: p };
      });

      dots.attr('cx', px)
        .attr('cy', s => yScale((valuesAtYear.find(v => v.genre === s.genre)?.share) || 0));

      const sorted = valuesAtYear.slice().sort((a, b) => b.share - a.share);
      tooltip.show(event, tooltipHtml(`${yr}`, sorted.map(v => ({
        label: v.genre,
        value: d3.format('.1%')(v.share),
        color: v.color,
      }))));
    });

  // Legend
  const legend = d3.select(container).append('div').attr('class', 'legend');
  series.forEach(s => {
    const item = legend.append('div').attr('class', 'legend-item');
    item.append('span')
      .attr('class', 'legend-line')
      .style('background', s.color);
    item.append('span').text(s.genre);
  });
}

// ══════════════════════════════════════════════════════════════
//  WORLD MAP — selected regions highlighter
// ══════════════════════════════════════════════════════════════

function renderWorldMap(filters) {
  const container = document.getElementById('worldmap-container');
  if (!container) return;
  container.innerHTML = '';

  if (!worldFeatures) {
    container.innerHTML = `<div class="empty-state" style="min-height:240px;">
      <div class="skeleton skeleton-block" style="height:200px;"></div>
    </div>`;
    return;
  }

  const width  = container.clientWidth || 360;
  const height = Math.max(220, Math.round(width * 0.55));

  const svg = d3.select(container).append('svg')
    .attr('width',  width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('aria-label', 'World map highlighting selected regions');

  const projection = d3.geoNaturalEarth1()
    .fitSize([width - 8, height - 8], worldFeatures);
  const pathGen = d3.geoPath(projection);

  const selected = new Set(filters.regions);

  const fillFor = name => {
    const region = COUNTRY_NAME_TO_REGION[name];
    if (!region) return MUTED_FILL;
    const key = REGION_FILTER_KEY[region];
    if (!key || !selected.has(key)) return MUTED_FILL;
    return REGION_HEX[region] || MUTED_FILL;
  };

  const opacityFor = name => {
    const region = COUNTRY_NAME_TO_REGION[name];
    if (!region) return 0.45;
    const key = REGION_FILTER_KEY[region];
    return (key && selected.has(key)) ? 0.85 : 0.35;
  };

  svg.append('g')
    .selectAll('path')
    .data(worldFeatures.features)
    .join('path')
    .attr('d', pathGen)
    .attr('fill', d => fillFor(d.properties.name))
    .attr('fill-opacity', d => opacityFor(d.properties.name))
    .attr('stroke', BORDER_STROKE)
    .attr('stroke-width', 0.4)
    .style('cursor', 'pointer')
    .on('mouseenter', function(event, d) {
      const region = COUNTRY_NAME_TO_REGION[d.properties.name] || '—';
      d3.select(this).attr('fill-opacity', 1);
      tooltip.show(event, tooltipHtml(d.properties.name, [
        { label: 'Region', value: region },
      ]));
    })
    .on('mousemove', e => tooltip.move(e))
    .on('mouseleave', function(event, d) {
      d3.select(this).attr('fill-opacity', opacityFor(d.properties.name));
      tooltip.hide();
    });
}
