# Dev Notes — The Roots of Rhythm

## Running the project

ES6 modules require a local server (not `file://`). From the project root:

```bash
npx serve .
# then open http://localhost:3000
```

Or use the VS Code Live Server extension.

## Adding real data

1. Populate the CSV files in `/data/` (headers already exist).
2. In each page JS file (`js/pages/*.js`), find the `// TODO` comment.
3. Replace `mockXxx()` with `await loadCSV('../data/xxx.csv')`.
4. Add any data transformation logic in the same file.

## Adding a new page

1. Copy any existing `pages/*.html` as a template.
2. Create `js/pages/your-page.js` — import `initFilters`, `getFilters`, `tooltip`, `tooltipHtml`.
3. Listen to `'filters:changed'` on `window` to re-render when filters change.
4. Add a nav link in all five HTML files.

## Design tokens

All colours, spacing, and font sizes live in `css/variables.css`.
Never hardcode values — always use `var(--token-name)`.

## Team conventions

- One JS file per page — no cross-page imports.
- Shared utilities only: `main.js`, `filters.js`, `tooltip.js`, `data-loader.js`.
- D3 is a CDN global (`window.d3`) — no npm install needed.

## Network Map (page 4) — design rationale

The page asks: *which European artists are collaborating with non-European artists, and where in the world are those partners?* It is rendered as a 3D globe (globe.gl / Three.js) with great-circle arcs between the home countries of each collaborating pair. This document records why that form was chosen, what it costs, and what was rejected — directly addressing the "Design rationale" criterion (30%) of the course rubric.

**Why 3D.** The artefact being visualised is literally geographic: cross-continental music exchange. A globe shows Europe and the rest-of-world as one continuous surface, so the eye can follow an arc from London to Lagos without the high-latitude distortion a flat Mercator projection introduces. Because the page is *centred on Europe* — which sits at high latitudes and would be visually inflated on a Mercator map — a sphere is the projection that respects the relative scale of the regions being compared.

**What 3D costs and how we mitigate it.** Three known weaknesses of 3D:

- *Occlusion* (arcs on the back of the globe are hidden) — mitigated by slow auto-rotation that the user can grab and drag; the rotation pauses on cursor interaction so detail can be read.
- *Distance distortion* (perspective makes equal-length arcs look unequal) — mitigated by encoding collaboration count in **stroke width and dash speed**, not in arc altitude. The arc's vertical bow carries no data — it's purely a cue that the line is moving across the sphere.
- *Hairball risk* when many arcs cross — mitigated by the "Europe ↔ World only" toggle in the sidebar, which drops every same-region pair and leaves only the cross-continental arcs the page is actually about. Region filters in the sidebar further narrow the view.

**Alternatives considered and rejected.**

- *Flat geo-map (D3 + natural-earth)* — clearer for reading exact positions but flattens the Europe-vs-rest-of-world story the page is built around, and forces a projection choice that always biases one region.
- *2D D3 force-directed graph* — best for showing pure network structure (who hubs the network) but discards geography entirely, which is the page's whole point.
- *Region-to-region chord diagram* — readable at a glance but aggregates away the artist-level detail that lets the viewer see *who* is doing the crossing.

The 3D globe was chosen because it is the only form that simultaneously preserves (a) geographic position, (b) artist-level granularity, and (c) the Europe-centred framing without distorting it.
