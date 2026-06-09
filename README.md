# The Roots of Rhythm

**A multi-page data visualisation dashboard exploring how European music has become increasingly global** — tracing artist collaborations, genre evolution, and correlations with world events.

Built for *Data Visualisation 2025–2026* at KU Leuven.

> **This README is the technical build guide.** The reasoning behind the design
> (requirements, encoding choices, alternatives considered and rejected,
> constraints) lives in [`DESIGN.md`](DESIGN.md).

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Project Overview](#project-overview)
3. [File Structure](#file-structure)
4. [Design System](#design-system)
5. [Running & Serving](#running--serving)
6. [The Four Visualisations](#the-four-visualisations)
7. [Wiring Up Real Data](#wiring-up-real-data)
8. [The Filter System](#the-filter-system)
9. [The Tooltip Helper](#the-tooltip-helper)
10. [Adding a New Visualisation Page](#adding-a-new-visualisation-page)
11. [Working with D3](#working-with-d3)
12. [Code Conventions](#code-conventions)
13. [Dependencies](#dependencies)
14. [Git Workflow](#git-workflow)
15. [Known Limitations & Next Steps](#known-limitations--next-steps)

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Jaspervaes/dataVis.git
cd dataVis/roots-of-rhythm

# Serve locally (ES6 modules require a server — file:// won't work)
npx serve .

# Open in browser
open http://localhost:3000
```

No build step. No npm install. No bundler. All dependencies load via CDN.

---

## Project Overview

| Page | Route | Chart type | Data source |
|---|---|---|---|
| Landing | `index.html` | — | — |
| Cultural Flow | `pages/sankey.html` | Sankey diagram | `spotify-tracks-2.csv` |
| Global Collabs | `pages/network-map.html` | 3D globe (globe.gl) | `artist-connections.csv` + `country-coords.json` |
| Resonance Timeline | `pages/resonance-timeline.html` | Line + area chart | `datos_merged_1986_2023.csv` + `artist-countries.csv` + `global-crises.csv` |
| Genre Forecast | `pages/genre-forecast.html` | Multi-line forecast + lifecycle map | `global_genre_share_yearly.csv` + `eu_vs_global_index_monthly.csv` + `regional_monthly_shares.csv` |

All visualisation pages share the same shell: fixed nav, collapsible sidebar with filters, D3 chart area. They are completely independent — you can work on one without touching any other.

---

## File Structure

```
roots-of-rhythm/
│
├── index.html                    Landing page
│
├── pages/
│   ├── cultural-flow.html        Sankey: genre flow between continents
│   ├── resonance-timeline.html   Timeline: valence vs. world crises
│   ├── genre-forecast.html       Line chart: genre trends + forecast 2030
│   └── network-map.html          Global Collabs: 3D globe of cross-region collaborations
│
├── css/
│   ├── variables.css             ← ALL design tokens (colours, fonts, spacing)
│   ├── base.css                  Reset + typography
│   ├── layout.css                Nav, sidebar, page shell, responsive
│   └── components.css            Buttons, cards, tooltip, skeleton, legend
│
├── js/
│   ├── main.js                   Nav scroll effect, sidebar toggle, waveform animation
│   ├── filters.js                Sidebar filter state + 'filters:changed' event
│   ├── tooltip.js                Global D3 tooltip singleton
│   ├── data-loader.js            CSV/JSON loader with caching + mock data generators
│   └── pages/
│       ├── cultural-flow.js      D3 Sankey logic
│       ├── resonance-timeline.js D3 line/area logic
│       ├── genre-forecast.js     D3 multi-line + forecast logic
│       └── network-map.js        Global Collabs globe (globe.gl) + region/country aggregation
│
├── data/                         CSV/JSON data + build scripts
│   ├── spotify-tracks.csv
│   ├── genre-trends.csv
│   ├── global-crises.csv
│   ├── artist-connections.csv            Collaboration pairs (Global Collabs)
│   ├── artist-connections-placeholder.csv  Dev fallback (real artists, synthetic pairs)
│   ├── country-coords.json               ISO-2 → { name, lat, lon, region }
│   └── build_connections_offline.py      Builds artist-connections.csv from the MB artist dump (no API)
│
└── assets/icons/                 Reserved for SVG icons
```

**Rule:** each viz page owns exactly one JS file in `js/pages/`. Shared logic goes in the four utility modules (`main.js`, `filters.js`, `tooltip.js`, `data-loader.js`). Never import across page files.

---

## Design System

The design is called **Dead Wax** — warm near-blacks, a single acid chartreuse accent, editorial typography, zero border-radius.

### Colours

All colours are CSS custom properties defined in `css/variables.css`. **Never hardcode a hex value anywhere else.**

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0e0c0a` | Page background |
| `--bg-surface` | `#141210` | Cards, panels |
| `--bg-elevated` | `#1c1916` | Hover states |
| `--acid` | `#c8f000` | **The single brand accent** — active states, chart lines, borders |
| `--red` | `#e5321c` | Crisis zones, danger, declining trends |
| `--amber` | `#f0a830` | Forecast zones, warnings |
| `--blue-cool` | `#6aabf0` | Asia region, cool data |
| `--sage` | `#82d4be` | Oceania region, positive trends |
| `--cream` | `#f0ebe0` | Primary text |
| `--text-secondary` | `#a09a90` | Secondary text |
| `--text-muted` | `#5a5550` | Labels, captions |
| `--border` | `#252018` | All borders |

### Fonts

Three fonts, loaded from Google Fonts in `variables.css`:

| Token | Font | Usage |
|---|---|---|
| `--font-display` | Bebas Neue | All `<h1>`–`<h3>`, page titles, card titles |
| `--font-mono` | DM Mono | Numbers, data labels, nav links, buttons, filter labels |
| `--font-body` | Barlow | Body text, descriptions, tooltips |

### D3 Colour Palettes

Each viz JS file has colour constants at the top. They are intentionally hardcoded (not CSS vars) because D3 sets SVG attributes, not CSS classes. Keep them in sync with the token values if you update `variables.css`.

**Regions:**
```js
Europe   → #c8f000  (acid)
Americas → #e5321c  (red)
Africa   → #f0a830  (amber)
Asia     → #6aabf0  (cool blue)
Oceania  → #c47fa0  (dusty rose)
```

**Genres** (in order): acid, red, amber, blue, rose, sage, cream, tan.

---

## Running & Serving

ES6 `import`/`export` modules are used throughout. Browsers block module imports over the `file://` protocol, so you **must** use a local server.

**Option 1 — npx serve (recommended, no install):**
```bash
npx serve .
```

**Option 2 — VS Code Live Server extension:**
Right-click `index.html` → Open with Live Server.

**Option 3 — Python:**
```bash
python -m http.server 3000
```

Then open `http://localhost:3000`.

---

## The Four Visualisations

### Cultural Flow (`pages/cultural-flow.html`)

- **Chart:** Sankey diagram (requires the `d3-sankey` CDN plugin, already included in the HTML)
- **What it shows:** How many tracks from each continental region belong to each genre — visualised as proportional flows
- **JS file:** `js/pages/cultural-flow.js`
- **Key functions:** `render(data)` draws the Sankey; `prepareData()` transforms raw tracks into `{ nodes, links }`

### Resonance Timeline (`pages/resonance-timeline.html`)

- **Chart:** Line chart with area fill + shaded crisis zones
- **What it shows:** Average Spotify valence (mood score 0–1) per year, overlaid with named crisis periods
- **JS file:** `js/pages/resonance-timeline.js`
- **Key functions:** `prepareData(filters)` aggregates mean valence per year and applies a 3-year rolling average; `render()` draws everything

### Genre Forecast (`pages/genre-forecast.html`)

- **Chart:** Multi-line chart — solid historical lines + dashed forecast extension to 2030 + shaded confidence band
- **What it shows:** Genre popularity trends and a linear regression projection
- **JS file:** `js/pages/genre-forecast.js`
- **Forecast method:** Ordinary least-squares regression on historical scores. Confidence band = ±1.5× RMSE. This is intentionally simple for MVP — replace with a better model when real data is available
- **Interaction:** Click a legend item to toggle a genre line on/off

### Global Collabs (`pages/network-map.html`)

- **Chart:** 3D globe (globe.gl / Three.js) of cross-region artist collaborations
- **What it shows:** Each arc links two regions (or two countries); arc thickness = total collaborations crossing between them. A travelling pulse along each arc conveys flow without breaking the line.
- **JS file:** `js/pages/network-map.js`
- **Aggregation (avoids the hairball):** a *Detail level* toggle switches between **Region** — a handful of fat continent-to-continent arcs, the readable default — and **Country**, one arc per country↔country route. Arc thickness scales (sqrt) with the route's total collaborations, relative to the busiest visible route.
- **Interaction:** drag to rotate (slow auto-rotate, pauses on hover); click an arc to pin it (stops rotation, dims the rest) and open a drill-down listing the underlying artist pairs; click a pair for a single-collaboration card (from → to, count, first year). Sidebar filters: region (colour-coded, doubling as the legend), decade range, "Europe ↔ World only", and a minimum-collaborations threshold that rescales to the active detail level.

#### Data & methodology — `artist-connections.csv`

Collaboration pairs are derived from MusicBrainz and built **offline** (no rate-limited API) by `data/build_connections_offline.py`:

1. **Source.** Phase-1 track data (`raw-tracks.json` — one record per recording with its *full* multi-artist credit list) is joined against a local **MusicBrainz artist JSON dump** (`artist.tar.xz` from the MB json-dumps), whose records carry each artist's `country` (ISO-2) directly. This replaces ~20k slow per-artist API calls with a single local pass.
2. **Collaborations only.** Tracks with fewer than two credited artists are dropped — they aren't collaborations. For each multi-artist track, every unordered artist pair is emitted and aggregated: `collaboration_count` = number of shared tracks, `year` = earliest.
3. **Region resolution.** Each artist's ISO-2 country is mapped to a region via `country-coords.json`. **Pairs where either artist's country has no mapped region are dropped** (they can't be placed on the globe). About 83% of artists resolve to a country in the dump; the rest have no country set in MusicBrainz.
4. **Region taxonomy.** The Americas are split into **North America** (US, Canada) and **Latin America** (Mexico + Central America + Caribbean + South America), matching the Cultural Flow and Sankey pages.

A small `artist-connections-placeholder.csv` (real artists, synthetic pairs) is the development fallback; a "placeholder data" badge shows whenever it's in use because the real CSV is empty.

> Design rationale for choosing a 3D globe (and the alternatives weighed) lives in `DEVNOTES.md`.

---

## Wiring Up Real Data

All four pages currently run on **mock data generators** in `js/data-loader.js`. The mock data is realistic in shape but randomly generated. Here is exactly how to swap in real data for each page.

### Step 1 — populate the CSV files

CSV headers already exist in `/data/`. Add rows below the header line. Do not change the column names — the JS expects them.

**`data/spotify-tracks.csv`**
```
track_id, artist_name, artist_country, genre, year, energy, valence, tempo, danceability, popularity
```

**`data/genre-trends.csv`**
```
year, genre, region, popularity_score, track_count
```

**`data/global-crises.csv`**
```
crisis_id, crisis_name, crisis_type, severity, regions_affected, start_year, end_year, description
```
`crisis_type` must be one of: `economic`, `armed_conflict`, `pandemic`

**`data/artist-connections.csv`**
```
artist_id, artist_name, country, region, collaborator_id, collaborator_name, collab_country, collab_region, collaboration_count, year
```
`region` must be one of: `Europe`, `North America`, `Latin America`, `Africa`, `Asia`, `Oceania`

> The Global Collabs page builds this file via `data/build_connections_offline.py` (see that page's *Data & methodology* above).

### Step 2 — update each page JS file

Open the page JS file and find the `// TODO` comment near the top. Replace the mock call with the real loader:

**Cultural Flow** (`js/pages/cultural-flow.js`):
```js
// Before:
currentData = mockSankeyData();

// After:
const raw = await loadCSV('../data/spotify-tracks.csv');
currentData = transformToSankey(raw, getFilters());
```
You will need to write `transformToSankey()` — it should roll up track counts by `region → genre` and return `{ nodes, links }` matching the d3-sankey format.

**Resonance Timeline** (`js/pages/resonance-timeline.js`):
```js
// Before:
rawTracks = mockSpotifyTracks(300);
rawCrises = mockGlobalCrises();

// After:
rawTracks = await loadCSV('../data/spotify-tracks.csv');
rawCrises = await loadCSV('../data/global-crises.csv');
```
`prepareData()` already handles the aggregation — no other changes needed.

**Genre Forecast** (`js/pages/genre-forecast.js`):
```js
// Before:
rawData = mockGenreTrends(d3.range(2000, HISTORY_END + 1));

// After:
rawData = await loadCSV('../data/genre-trends.csv');
```
The data must include a `popularity_score` column (0–100).

**Network Map** (`js/pages/network-map.js`):
```js
// Before:
rawNetwork = mockArtistNetwork(22);

// After:
const raw = await loadCSV('../data/artist-connections.csv');
rawNetwork = transformToNetwork(raw);
```
`transformToNetwork()` should return `{ nodes: [...], links: [...] }` where each node has `{ id, name, region, country, genre, popularity }` and each link has `{ source, target, weight }`.

### The data loader cache

`loadCSV` and `loadJSON` in `js/data-loader.js` cache results in memory. The same file is only fetched once per page load. If you are developing and changing CSV files, do a hard reload (`Ctrl+Shift+R`) to bust the cache.

---

## The Filter System

The sidebar filters are managed by `js/filters.js`. This module is a singleton — import it once in your page JS, call `initFilters()` on DOMContentLoaded, then listen for the `filters:changed` event.

### How it works

```
User changes a filter input
        ↓
filters.js reads all sidebar inputs
        ↓
Updates internal _state object
        ↓
Fires window event: 'filters:changed' with detail = current state
        ↓
Your page JS re-renders with new filter state
```

### Filter state shape

```js
{
  decadeRange:   [1986, 2025],           // [startYear, endYear]
  audioFeatures: ['energy', 'valence', 'tempo', 'danceability'],
  crisisTypes:   ['economic', 'armed_conflict', 'pandemic'],
  regions:       ['europe', 'americas', 'africa', 'asia', 'oceania'],
}
```

Note: region values are **lowercase** in filter state but **Title Case** in the CSV data. The viz JS files normalise this with `.toLowerCase()` comparisons.

### Usage in a page JS file

```js
import { initFilters, getFilters } from '../filters.js';

document.addEventListener('DOMContentLoaded', async () => {
  initFilters();           // binds all sidebar inputs

  render(getFilters());    // initial render

  window.addEventListener('filters:changed', (e) => {
    render(e.detail);      // re-render whenever filters change
  });
});
```

### Active pills

When a filter deviates from its default, `filters.js` renders a pill into `#active-pills` (already in all sidebar HTML). Clicking the `×` on a pill removes that filter. This is automatic — you do not need to handle it in page JS.

---

## The Tooltip Helper

`js/tooltip.js` exports a singleton `tooltip` and a helper `tooltipHtml()`. Import both in any page JS file.

```js
import { tooltip, tooltipHtml } from '../tooltip.js';
```

### API

```js
// Show tooltip near cursor with HTML content
tooltip.show(event, htmlString);

// Update position on mousemove
tooltip.move(event);

// Hide
tooltip.hide();
```

### Building tooltip content

```js
tooltipHtml(title, rows)
```

- `title` — string, displayed in bold at the top
- `rows` — array of `{ label, value, color }` objects, displayed as key/value pairs

```js
tooltip.show(event, tooltipHtml('Dua Lipa', [
  { label: 'Region',    value: 'Europe',  color: '#c8f000' },
  { label: 'Collabs',   value: 14 },
  { label: 'Popularity',value: '94%' },
]));
```

The tooltip auto-adjusts position to stay within the viewport. It is appended to `<body>` once and reused across all charts.

---

## Adding a New Visualisation Page

Follow these four steps to add a fifth page without touching any existing files (except adding a nav link):

### 1. Copy a page HTML template

```bash
cp pages/cultural-flow.html pages/my-new-page.html
```

Update: `<title>`, `<h1>` page title, `<p>` subtitle, the `aria-current="page"` nav link, and the `<script>` src at the bottom.

### 2. Create the JS file

```bash
cp js/pages/cultural-flow.js js/pages/my-new-page.js
```

Minimal structure:

```js
import { initFilters, getFilters } from '../filters.js';
import { tooltip, tooltipHtml }   from '../tooltip.js';
import { loadCSV }                 from '../data-loader.js';   // when ready
import { mockSpotifyTracks }       from '../data-loader.js';   // for now

document.addEventListener('DOMContentLoaded', async () => {
  initFilters();

  // TODO: replace with loadCSV('../data/your-file.csv')
  const data = mockSpotifyTracks();

  render(data);

  window.addEventListener('filters:changed', (e) => render(data));
  window.addEventListener('resize', () => render(data));
});

function render(data) {
  const container = document.getElementById('viz-container');
  container.innerHTML = '';

  // Your D3 code here
}
```

### 3. Update the `<script>` tag in the HTML

```html
<script type="module" src="../js/pages/my-new-page.js"></script>
```

### 4. Add a nav link to all five HTML files

In `index.html` and all four `pages/*.html` files, add:
```html
<li><a href="my-new-page.html" class="nav-link">My New Page</a></li>
```

---

## Working with D3

D3 v7 is loaded as a CDN global (`window.d3`). You do not import it — just use `d3.xxx` directly in your JS files.

### The `d3-sankey` plugin

`cultural-flow.html` loads this as a second CDN script. It exposes `window.d3Sankey`. The code checks for its presence and shows an error state if it fails to load.

### SVG setup pattern

All viz files follow the same margin convention:

```js
const rect   = container.getBoundingClientRect();
const width  = rect.width  || 800;
const height = Math.max(rect.height || 520, 420);

const margin = { top: 24, right: 32, bottom: 56, left: 56 };
const innerW = width  - margin.left - margin.right;
const innerH = height - margin.top  - margin.bottom;

const svg = d3.select(container)
  .append('svg')
  .attr('width',  width)
  .attr('height', height);

const g = svg.append('g')
  .attr('transform', `translate(${margin.left},${margin.top})`);
```

### Axis styling

Apply the class `chart-axis` to axis groups and `chart-grid` to grid groups — `components.css` handles the styling via SVG CSS selectors:

```js
g.append('g')
  .attr('class', 'chart-axis')
  .attr('transform', `translate(0,${innerH})`)
  .call(d3.axisBottom(xScale));

g.append('g')
  .attr('class', 'chart-grid')
  .call(d3.axisLeft(yScale).tickSize(-innerW).tickFormat(''));
```

### Responsive re-render

All pages listen to `window resize` and call `render()` again, which clears the container and redraws. This is intentional — simpler than trying to update a live SVG.

---

## Code Conventions

- **No hardcoded colours in JS** for UI elements — use CSS variables. Exception: D3 SVG attribute colours must be hex strings; keep them in the constant block at the top of each file.
- **No hardcoded colours in CSS** — always `var(--token-name)`.
- **No inline styles in HTML** — only exception is `--card-accent` custom property on individual cards.
- **One module per page** — `js/pages/cultural-flow.js` is only ever loaded by `cultural-flow.html`.
- **Async data loading** — always `await` CSV loads inside `DOMContentLoaded`. Never at the top level.
- **Re-render on resize** — call `render()` on `window resize`. Clear `container.innerHTML = ''` at the start of every render to avoid duplicate SVGs.
- **Error/empty states** — if `data.length === 0` after filtering, render the `.empty-state` component instead of an empty SVG.

---

## Dependencies

All loaded via CDN — no package.json, no node_modules.

| Library | Version | CDN | Used in |
|---|---|---|---|
| D3.js | v7 | `cdn.jsdelivr.net` | All viz pages |
| d3-sankey | 0.12.3 | `unpkg.com` | `cultural-flow.html` only |
| Bebas Neue | — | Google Fonts | `variables.css` |
| DM Mono | — | Google Fonts | `variables.css` |
| Barlow | — | Google Fonts | `variables.css` |

---

## Git Workflow

The remote is `https://github.com/Jaspervaes/dataVis.git`, branch `main`.

```bash
# Stage all project files
git add .

# Commit
git commit -m "Your message here"

# Push to GitHub
git push origin main
```

### Suggested branch strategy for team work

```bash
# Each person works on their own viz page
git checkout -b feature/cultural-flow
# ... make changes to js/pages/cultural-flow.js and pages/cultural-flow.html only
git push origin feature/cultural-flow
# Open a pull request into main
```

Avoid editing `css/variables.css`, `js/filters.js`, `js/tooltip.js`, or `js/main.js` without coordinating with the team — these are shared by all pages.

---

## Known Limitations & Next Steps

### Current state
- All four visualisations run on **real data** (Spotify audio/genre data and
  MusicBrainz collaboration/region metadata), precomputed into the CSV/JSON files
  in `/data/` by the Python scripts there. Mock generators remain only as
  last-resort fallbacks if a file fails to load.
- Insight cards and per-chapter Walkthrough panels are populated from the data.
- No authentication, no backend, no database: pure static site.

### Next steps
1. **Sync hardcoded narrative figures** with computed values where any story-card
   numbers are still hand-written.
2. **Tune the forecast model** in `genre-forecast.js`: currently a transparent
   ensemble of linear fits, chosen for honesty over accuracy; could be replaced
   with exponential smoothing or a proper time-series model.
3. **Add a global year scrubber** that syncs across all pages, deepening the
   coordinated-view story.

### Longer-term ideas
- Add a global year scrubber that syncs across all pages
- Export chart as SVG/PNG button
- Animate transitions between filter states instead of full re-render
- Add a proper mobile layout for the sidebar (currently hidden on small screens)
