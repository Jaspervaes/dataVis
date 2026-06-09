# The Roots of Rhythm — Design Rationale

*Data Visualisation 2025–2026, KU Leuven.*

This document records the reasoning behind every major design decision in the
project: the requirements each visualisation had to meet, the encoding we chose,
the alternatives we weighed and rejected, and the constraints that shaped the
result. It is the companion to `README.md` (which is a purely technical build
guide) and it expands on the globe rationale first sketched in `DEVNOTES.md`.

---

## 1. Problem statement

Most "global music" visualisations answer *what is popular*. We wanted to answer
a harder, more original question: **how did music stop being local?** Our thesis
is that one variable, globalisation, runs underneath four separate phenomena:
the rise of Pop as a worldwide default, the explosion of cross-border artist
collaboration, the shifting emotional tone of music against world events, and the
projected convergence of genres. The project is therefore not four charts but one
argument told in four chapters.

The framing is deliberately **Europe-centred**: we treat Europe as the baseline
and ask how it produces, collaborates, feels, and forecasts relative to the rest
of the world. This is a defensible analytical angle rather than a generic "music
trends" dashboard.

## 2. Target audience

A culturally literate but non-technical reader: a data visualisation examiner, a
journalist, or a curious listener. This audience can read a line chart and a map
but will not tolerate a node-link hairball or unexplained jargon. Two consequences
follow throughout: (a) every chart must be legible at a glance before it rewards
deeper interaction, and (b) every page carries a plain-language narrative layer
(the Walkthrough mode, Section 5.2) so the insight is never hidden behind the
encoding.

## 3. Requirements

1. Each visualisation must communicate a single, clear insight on first view.
2. The four pages must feel like one coherent system, not four assignments.
3. Every chart must support details on demand for a reader who wants to dig in.
4. The work must be honest about its data: no distortion, and uncertainty shown
   where it exists (most importantly in the forecast).
5. It must run as a static site with no build step, so it is trivially reviewable.

## 4. Constraints

* **Data coverage bias.** The underlying Spotify and MusicBrainz data is
  Western-skewed: North America and Europe are over-represented, and large parts
  of Africa and South and East Asia are thin. We treat this as part of the story
  ("whose music gets counted") rather than hiding it, and we surface it in the
  Cultural Flow narrative.
* **Country resolution.** Only about 83% of artists in the MusicBrainz dump carry
  a usable country. Pairs where either artist has no mapped region are dropped
  from the globe, because they cannot be placed.
* **No backend.** Everything is precomputed into CSV/JSON and rendered client
  side. Heavier modelling (for the forecast) is done offline in Python.
* **Single developer-grade stack.** D3 v7, d3-sankey, and globe.gl over CDN, no
  bundler. This keeps the project auditable but rules out anything that needs a
  server at runtime.

## 5. System-level design

### 5.1 One narrative, four pages (vs. a single dashboard)

We considered packing all four views into one coordinated dashboard. We rejected
it for this audience: a four-panel dashboard forces the reader to discover the
argument themselves, and the small multiples would each be too cramped to read.
A guided sequence of full-bleed pages lets each chapter breathe and lets us
control the order in which the argument unfolds (production, then collaboration,
then emotion, then forecast).

### 5.2 The Walkthrough layer (coherence + guided insight)

Coherence across independent pages is the hardest part of a multi-page project.
Our solution is a shared **Walkthrough** mode (`js/story-mode.js`, `css/story-mode.css`):

* The landing page presents the four chapters as a single story. Opening a chapter
  from the landing page (`?story=1`) lands the reader in Walkthrough mode, where a
  single large, tinted insight panel states that chapter's headline finding and
  the page's filters are preset to the configuration that demonstrates it.
* A segmented `Walkthrough / Insights` toggle lets the reader switch between the
  guided statement and the page's standard analytical insight cards, so the mode
  is reversible rather than a dead end.
* Each Walkthrough panel ends with a "next chapter" hand-off that carries the
  reader forward in story mode, chaining the four pages into one path and looping
  back to the conclusion on the landing page.

This is the mechanism that turns four independent visualisations into one
coherent system, and it is the project's main piece of original interaction design.

### 5.3 Colour

The palette ("Dead Wax") is intentionally minimal: warm near-blacks, a single
acid-chartreuse accent for the most important mark on any view, and four
**distinct categorical families** for the data dimensions. Colour is used
**meaningfully, not decoratively**: the swatch in the sidebar is the legend, and
the same hue for a category recurs identically on every page.

The four families are kept visually separate so the reader can always tell *what
kind of thing* a colour encodes:

* **Regions** — the signature warm spectrum plus blue and rose (Europe, North
  America, Latin America, Africa, Asia, Oceania).
* **Genres** — a cooler jewel-and-earth family (magenta, violet, cyan, plum,
  emerald, mint, wheat, olive, periwinkle, plus a neutral cream/charcoal for
  Rock) that deliberately shares **no hue** with any region.
* **Crises / conflicts** — a reserved cool triad (teal · magenta · indigo) that
  sits off the region spectrum, so an *event* never reads as a *place*. (This is
  why crisis is no longer encoded in red: red is North America, and the two used
  to collide.)
* **Audio features** — the four toggled timeline metrics (valence on the accent;
  energy, tempo, danceability).

**Single source of truth.** Every categorical colour is a CSS custom property in
`css/variables.css` (`--region-*`, `--genre-*`, `--crisis-*`, `--feature-*`). The
charts never hardcode a hex: `js/colors.js` resolves the tokens at render time via
`regionColor()` / `genreColor()` / `crisisColor()` / `featureColor()`, which also
normalise the historical label spellings (`Africa/ME` → Africa, `US` → North
America, case). This is what guarantees a region is the same colour on the globe,
the Sankey, and the timeline.

Two accessibility decisions:

* **Theme awareness.** Every token has a **separate, hand-tuned value for light and
  dark mode** (`:root` and `.light-mode` in `variables.css`); the hues that work on
  the dark ground are darkened for the cream paper rather than reused. Charts
  re-resolve their colours on the `themechanged` event, so the toggle is live.
* **Colour-blind mitigation.** The region family necessarily uses green, red, and
  amber together, which sit on the common red/green confusion axis. We mitigate
  this with redundant encoding rather than colour alone: every region and genre is
  also labelled directly, positioned consistently, and (on the globe and hitlist)
  carries shape and directional cues, so no insight depends on distinguishing two
  hues.

**Canonical contract (dark / light).** A live swatch reference is rendered at
`palette.html`.

| Family | Member → token | Dark | Light |
|---|---|---|---|
| Region  | Europe `--region-europe`               | `#c8f000` | `#5c7400` |
| Region  | North America `--region-north-america` | `#e5321c` | `#c52d18` |
| Region  | Latin America `--region-latin-america` | `#e07840` | `#bf5a22` |
| Region  | Africa `--region-africa`               | `#f0a830` | `#aa7212` |
| Region  | Asia `--region-asia`                   | `#6aabf0` | `#2f72c2` |
| Region  | Oceania `--region-oceania`             | `#c47fa0` | `#9d4f78` |
| Genre   | Pop `--genre-pop`                      | `#e5379b` | `#b81f70` |
| Genre   | Hip-Hop `--genre-hiphop`               | `#7b5cff` | `#5634c9` |
| Genre   | Rock `--genre-rock`                    | `#f0ebe0` | `#4a4540` |
| Genre   | Electronic `--genre-electronic`        | `#1fc8d8` | `#0d8d9c` |
| Genre   | R&B `--genre-rnb`                      | `#b15ad6` | `#843aa8` |
| Genre   | Latin `--genre-latin`                  | `#2fbf8a` | `#15875f` |
| Genre   | Country `--genre-country`              | `#c2954a` | `#8a6526` |
| Genre   | Jazz `--genre-jazz`                    | `#8f9a5b` | `#5f6a36` |
| Genre   | Classical `--genre-classical`          | `#8e94c4` | `#565c8a` |
| Genre   | Afrobeats `--genre-afrobeats`          | `#5fcf9e` | `#1f8a63` |
| Crisis  | Economic `--crisis-economic`           | `#2dd4bf` | `#0d8073` |
| Crisis  | Armed Conflict `--crisis-conflict`     | `#ec4899` | `#b32568` |
| Crisis  | Pandemic `--crisis-pandemic`           | `#6366f1` | `#4b45c0` |
| Feature | Valence `--feature-valence`            | `#c8f000` | `#5c7400` |
| Feature | Energy `--feature-energy`              | `#fb923c` | `#c75a10` |
| Feature | Tempo `--feature-tempo`                | `#a78bfa` | `#6b3fd4` |
| Feature | Danceability `--feature-danceability`  | `#34d399` | `#0f8a5f` |

### 5.4 Typography and layout

Three typefaces with fixed roles (Bebas Neue for display, DM Mono for numbers and
labels, Barlow for prose) and a strict 4px spacing scale give the project a single
editorial voice. Zero border-radius and full-width rules are a deliberate
"data-journal" aesthetic that keeps attention on the marks.

### 5.5 Interaction model and details on demand

A shared sidebar filter system (`js/filters.js`) emits a single `filters:changed`
event that every page listens to, so filtering behaves identically everywhere.
Details on demand are layered: a hover tooltip on every mark, then a click-to-pin
deeper view on the pages where it adds meaning (the globe's drill-down to artist
pairs, the timeline's year-detail panel). We deliberately did **not** add
interaction where it earns nothing; the Sankey, for instance, is a read-first
overview with hover details but no click state, because drilling into a single
flow ribbon would not reveal anything the overview hides.

---

## 6. Per-visualisation rationale

### 6.1 Cultural Flow — Sankey diagram

**Requirement.** Show, at a glance, how the volume of tracks divides across world
regions and genres, and let the proportions (especially Pop's dominance) be read
without numbers.

**Why a Sankey.** Flow magnitude between two categorical dimensions (region to
genre) is exactly what a Sankey encodes: ribbon width is directly proportional to
track count, so the eye reads share without axes.

**Alternatives rejected.**
* *Stacked bar / 100% stacked area* would show genre share over time but loses the
  region-to-genre routing that is the page's point.
* *Grouped bar chart* would force the reader to compare many small bars across two
  facets, which is slower and less evocative than ribbons.
* *Chord diagram* reads elegantly but is harder for a lay audience to decode than a
  left-to-right flow.

**Constraint acknowledged.** The Western data bias is most visible here (Africa
barely registers), so the page names the bias instead of implying the data is the
world.

### 6.2 Global Collabs — 3D globe

**Requirement.** Show which European artists collaborate with non-European
artists and where those partners are, preserving both geography and artist-level
detail.

**Why a 3D globe.** The subject is literally geographic, and the framing is
Europe-centred. Europe sits at high latitudes where a flat Mercator projection
inflates it; a sphere respects the relative scale of the regions being compared
and lets the eye follow an arc across continents as one continuous surface.

**Costs and mitigations.**
* *Occlusion* of back-facing arcs: slow auto-rotation that the reader can grab and
  drag, pausing on interaction.
* *Perspective distance distortion*: collaboration count is encoded in stroke width
  and pulse speed, never in arc height, so the data does not depend on apparent
  arc length.
* *Hairball risk*: a region/country detail toggle, a minimum-collaborations
  threshold, and a "Europe to World only" filter keep the view legible.

**Alternatives rejected.** A flat geo-map (clear positions but distorts the
Europe-vs-rest framing and forces a biased projection), a force-directed graph
(shows network structure but discards geography, the page's whole point), and a
region-to-region chord diagram (readable but aggregates away the artist-level
detail that lets the reader see *who* is crossing borders).

### 6.3 Resonance Timeline — line and area with crisis overlay

**Requirement.** Let the reader see the emotional tone of music over four decades
and relate it to world events, then interrogate any single year.

**Why this encoding.** Valence over time is a continuous trend, which a line chart
reads best. Named crisis periods are drawn as shaded vertical bands behind the
line so the reader can visually correlate dips and peaks with events without a
second chart. A feature toggle (valence, energy, tempo, danceability) lets the
reader surface the project's sharpest finding: as valence falls, danceability
rises.

**Details on demand.** Clicking a year pins a detail panel (value versus baseline,
regional breakdown, active crises), and a magnifier-lens zoom expands a five-year
quarterly window in place.

**Alternatives rejected.** *Small multiples* (one panel per audio feature) make
cross-feature correlation harder to see than a single toggled overlay. A
*heatmap* of feature by year is compact but hides the shape of the trend and the
relationship to crises.

### 6.4 Genre Forecast — multi-line history, ensemble forecast, lifecycle map

**Requirement.** Project genre share forward honestly, and show where each genre
sits today versus where it is heading.

**Why this encoding.** Solid historical lines extend into dashed forecast lines
with a shaded confidence band that widens with the horizon, so uncertainty is
visible rather than implied. The forecast is an ensemble of linear fits over
multiple look-back windows, which is honest about model spread. A companion
lifecycle quadrant places each genre by current size against momentum, and a
short-term EU hitlist ranks risers and fallers. The three views share the genre
filter, so they read as one coordinated panel.

**Alternatives rejected.** A *single regression line with no band* would overstate
certainty, the exact distortion the rubric warns against. A *stacked area to 2035*
would imply the shares are known rather than projected.

---

## 7. From description to prescription

We aimed for insights beyond "X is higher than Y":

* **Descriptive.** Pop rose from roughly 30% to 48% of tracked flow; the US and UK
  form the single busiest collaboration corridor.
* **Interpretive.** Music's emotional floor in 2017 lines up with peak political
  polarization and the ongoing refugee crisis; the simultaneous rise in danceability
  suggests listeners reached for rhythm as mood fell.
* **Predictive.** The ensemble forecast projects Electronic gaining share while
  Rock declines toward the floor by the late 2020s.
* **Prescriptive.** If the forecast holds, a European label or festival booker has
  a concrete reason to weight investment toward electronic and cross-border Latin
  pipelines, where both the long-term trend and the EU momentum signal point the
  same way.

---

## 8. Limitations and future work

* The data is Western-biased; conclusions about under-represented regions are
  weak by construction and are flagged as such in the interface.
* The forecast is a transparent ensemble of linear models, chosen for honesty and
  reproducibility over raw accuracy; a proper time-series model is future work.
* Filters are per-page by design. A global year scrubber that syncs every page is
  a natural next step that would deepen the coordinated-view story.
