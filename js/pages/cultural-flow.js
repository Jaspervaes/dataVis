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

const SOURCES = ['Europe', 'North America', 'Latin America', 'Africa', 'Asia'];

// Maps region label → sidebar filter key (both Americas share one checkbox)
const REGION_FILTER_KEY = {
  'Europe':        'europe',
  'North America': 'americas',
  'Latin America': 'americas',
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

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  rawTracks = await loadCSV('../data/spotify-tracks.csv');
  const data = transformToSankey(rawTracks, getFilters());
  render(data);

  window.addEventListener('filters:changed', (e) => {
    render(transformToSankey(rawTracks, e.detail));
  });

  window.addEventListener('resize', () => {
    render(transformToSankey(rawTracks, getFilters()));
  });
});

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
