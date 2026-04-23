/**
 * network-map.js
 * ─────────────────────────────────────────────────────────────
 * Force-directed graph: artist collaboration network.
 *
 * Each node is an artist, coloured by their home region.
 * Edges connect artists who have collaborated; edge weight
 * scales with the number of collaborations.
 *
 * TODO: Replace mock data with real:
 *   const raw = await loadCSV('../data/artist-connections.csv');
 *   const { nodes, links } = transformNetwork(raw, getFilters());
 *
 * Depends on:
 *   - D3 v7 (global window.d3)
 *   - filters.js  (filter state)
 *   - tooltip.js  (hover tooltips)
 * ─────────────────────────────────────────────────────────────
 */

import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }   from '../tooltip.js';
import { mockArtistNetwork }       from '../data-loader.js';

const REGION_COLORS = {
  Europe:   'var(--acid)',  // acid
  Americas: '#e5321c',  // red
  Africa:   '#f0a830',  // amber
  Asia:     '#6aabf0',  // cool blue
  Oceania:  '#c47fa0',  // dusty rose
};

let simulation = null;
let rawNetwork = null;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  // TODO: Replace with loadCSV('../data/artist-connections.csv')
  rawNetwork = mockArtistNetwork(22);

  render();

  window.addEventListener('filters:changed', render);
  window.addEventListener('resize', () => {
    if (simulation) simulation.stop();
    render();
  });
});

// ── Data filtering ────────────────────────────────────────────
function filterNetwork(data, filters) {
  const activeRegions = new Set(filters.regions.map(r => r.toLowerCase()));

  const nodes = data.nodes.filter(n =>
    activeRegions.has(n.region.toLowerCase())
  );
  const nodeIds = new Set(nodes.map(n => n.id));
  const links = data.links.filter(l =>
    nodeIds.has(typeof l.source === 'object' ? l.source.id : l.source) &&
    nodeIds.has(typeof l.target === 'object' ? l.target.id : l.target)
  );

  return {
    nodes: nodes.map(n => ({ ...n })),  // deep-copy so simulation doesn't bleed
    links: links.map(l => ({ ...l })),
  };
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const filters   = getFilters();
  const data      = filterNetwork(rawNetwork, filters);
  const container = document.getElementById('viz-container');
  if (!container) return;
  container.innerHTML = '';

  if (!data.nodes.length) {
    container.innerHTML = `<div class="empty-state">
      <p class="empty-state-title">No artists match the selected regions</p>
      <p class="empty-state-desc">Enable more regions in the sidebar filters.</p>
    </div>`;
    return;
  }

  const rect   = container.getBoundingClientRect();
  const width  = rect.width  || 800;
  const height = Math.max(rect.height || 520, 460);

  const svg = d3.select(container)
    .append('svg')
    .attr('width',  width)
    .attr('height', height)
    .attr('aria-label', 'Force-directed network of artist collaborations')
    .attr('role', 'img')
    .call(d3.zoom()
      .scaleExtent([0.3, 4])
      .on('zoom', ({ transform }) => worldG.attr('transform', transform))
    );

  const worldG = svg.append('g');

  // ── Arrowhead marker ─────────────────────────────────────
  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -4 8 8')
    .attr('refX', 16)
    .attr('markerWidth', 5)
    .attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#1e1e2e');

  // ── Simulation ────────────────────────────────────────────
  if (simulation) simulation.stop();

  simulation = d3.forceSimulation(data.nodes)
    .force('link',   d3.forceLink(data.links).id(d => d.id).distance(d => 80 - d.weight * 2).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-180).distanceMax(300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide(20))
    .alphaDecay(0.03);

  // ── Links ─────────────────────────────────────────────────
  const weightScale = d3.scaleLinear()
    .domain(d3.extent(data.links, d => d.weight))
    .range([0.8, 3.5]);

  const linkSel = worldG.append('g').attr('class', 'links')
    .selectAll('line')
    .data(data.links)
    .join('line')
    .attr('stroke',         '#1e1e2e')
    .attr('stroke-width',   d => weightScale(d.weight))
    .attr('stroke-opacity', 0.6);

  // ── Nodes ─────────────────────────────────────────────────
  const radiusScale = d3.scaleLinear()
    .domain([0, 100])
    .range([6, 14]);

  const nodeSel = worldG.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(data.nodes)
    .join('g')
    .style('cursor', 'pointer')
    .call(drag(simulation));

  // Glow ring
  nodeSel.append('circle')
    .attr('r', d => radiusScale(d.popularity) + 4)
    .attr('fill', d => REGION_COLORS[d.region] || '#7c3aed')
    .attr('opacity', 0.15);

  // Main circle
  nodeSel.append('circle')
    .attr('r',    d => radiusScale(d.popularity))
    .attr('fill', d => REGION_COLORS[d.region] || '#7c3aed')
    .attr('stroke', '#0a0a0f')
    .attr('stroke-width', 1.5);

  // Labels (only for high-popularity nodes to avoid clutter)
  nodeSel.filter(d => d.popularity > 75)
    .append('text')
    .attr('dy', d => -(radiusScale(d.popularity) + 5))
    .attr('text-anchor', 'middle')
    .attr('fill', '#f1f5f9')
    .attr('font-size', 10)
    .attr('font-family', 'Inter, system-ui, sans-serif')
    .attr('font-weight', 500)
    .attr('pointer-events', 'none')
    .text(d => d.name);

  // ── Tooltip ───────────────────────────────────────────────
  nodeSel
    .on('mouseenter', function(event, d) {
      d3.select(this).select('circle:last-of-type').attr('stroke', '#f1f5f9');
      const collabs = data.links.filter(l =>
        (typeof l.source === 'object' ? l.source.id : l.source) === d.id ||
        (typeof l.target === 'object' ? l.target.id : l.target) === d.id
      ).length;

      tooltip.show(event, tooltipHtml(d.name, [
        { label: 'Region',         value: d.region,          color: REGION_COLORS[d.region] },
        { label: 'Country',        value: d.country                                          },
        { label: 'Genre',          value: d.genre                                            },
        { label: 'Collaborations', value: collabs                                            },
        { label: 'Popularity',     value: `${d.popularity}%`                                },
      ]));
    })
    .on('mousemove', event => tooltip.move(event))
    .on('mouseleave', function() {
      d3.select(this).select('circle:last-of-type').attr('stroke', '#0a0a0f');
      tooltip.hide();
    });

  // ── Tick ──────────────────────────────────────────────────
  simulation.on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // ── Legend ────────────────────────────────────────────────
  const legendG = svg.append('g').attr('transform', `translate(16, 16)`);
  Object.entries(REGION_COLORS).forEach(([region, color], i) => {
    legendG.append('circle').attr('cx', 6).attr('cy', i * 22 + 6).attr('r', 6).attr('fill', color);
    legendG.append('text')
      .attr('x', 18).attr('y', i * 22 + 10)
      .attr('fill', '#94a3b8').attr('font-size', 11)
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .text(region);
  });

  updateInsightCards(data);
}

// ── Drag helper ───────────────────────────────────────────────
function drag(sim) {
  return d3.drag()
    .on('start', (event, d) => {
      if (!event.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
    .on('end',  (event, d) => {
      if (!event.active) sim.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}

// ── Insight cards ─────────────────────────────────────────────
function updateInsightCards(data) {
  const regions = [...new Set(data.nodes.map(n => n.region))];
  const topNode = data.nodes.reduce((a, b) => b.popularity > a.popularity ? b : a, data.nodes[0] || {});
  const maxDeg  = data.nodes.reduce((a, n) => {
    const deg = data.links.filter(l =>
      (typeof l.source === 'object' ? l.source.id : l.source) === n.id ||
      (typeof l.target === 'object' ? l.target.id : l.target) === n.id
    ).length;
    return deg > a.deg ? { node: n, deg } : a;
  }, { node: null, deg: 0 });

  setCard('card-artists',     data.nodes.length,     'Artists in network');
  setCard('card-collabs',     data.links.length,      'Collaboration links');
  setCard('card-top-artist',  topNode.name ?? '—',    `Highest popularity artist`);
  setCard('card-hub',         maxDeg.node?.name ?? '—', `Most connected (${maxDeg.deg} links)`);
}

function setCard(id, value, desc) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = el.querySelector('.insight-card-value');
  const d = el.querySelector('.insight-card-desc');
  if (v) v.textContent = value;
  if (d) d.textContent = desc;
}
