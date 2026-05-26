/**
 * resonance-timeline-insights.js
 * ─────────────────────────────────────────────────────────────
 * Story cards parked below the Resonance Timeline year-detail box:
 *   PEAK · 1999  ·  BREAK · 2011  ·  FLOOR · 2018
 *
 * Self-contained. Loads its own aggregate data, injects its own
 * markup after #insight-box, and writes the dynamic numbers in.
 * Nothing in resonance-timeline.js depends on this file.
 *
 * To re-enable on the page, add these two lines to
 * pages/resonance-timeline.html:
 *
 *   <link rel="stylesheet" href="../css/resonance-timeline-insights.css" />
 *   <script type="module" src="../js/pages/resonance-timeline-insights.js"></script>
 *
 * Note: chip labels + taglines are hand-written for the 1986–2023
 * dataset and reference specific crises. If the data refresh shifts
 * the peak/break/floor years, the strings below need updating to
 * match.
 * ─────────────────────────────────────────────────────────────
 */

import { loadCSV } from '../data-loader.js';

const TARGET_SELECTOR = '#insight-box';
const DATA_PATH       = '../data/valence-by-year.csv';

const MARKUP = `
<section class="story-cards" id="story-cards" aria-label="Timeline insights">
  <article class="story-card" id="story-card-peak" style="--card-accent: var(--acid)">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-peak-title">Peak · 1999</span>
      <span class="story-card-tag" data-tone="up">All-time high</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-peak-value">—</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      Music's happiest year — right before the <strong>Dot-com Bust</strong> and <strong>9/11</strong>. It hasn't been this high since.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:#f0a830">Pre-Dot-com Bust</span>
      <span class="story-chip" style="--chip-color:#e5321c">Pre-9/11</span>
    </footer>
  </article>

  <article class="story-card" id="story-card-break" style="--card-accent: #e5321c">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-break-title">Break · 2011</span>
      <span class="story-card-tag" data-tone="down">Sharpest drop</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-break-value">—</span>
      <span class="story-card-unit">valence · YoY</span>
    </div>
    <p class="story-card-tagline">
      Three crises detonated at once. Music has stayed below its <strong>1990s baseline</strong> ever since.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:#e5321c">Syrian Civil War</span>
      <span class="story-chip" style="--chip-color:#e5321c">Arab Spring</span>
      <span class="story-chip" style="--chip-color:#f0a830">Euro Debt Crisis</span>
    </footer>
  </article>

  <article class="story-card" id="story-card-floor" style="--card-accent: #6aabf0">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-floor-title">Floor · 2018</span>
      <span class="story-card-tag" data-tone="flat">Lowest on record</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-floor-value">—</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      Hit bottom <strong>before</strong> the pandemic. Even the COVID era couldn't push it lower.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:#6aabf0">COVID-19</span>
      <span class="story-chip" style="--chip-color:#e5321c">Russia–Ukraine</span>
      <span class="story-chip" style="--chip-color:#f0a830">Cost-of-Living</span>
    </footer>
  </article>
</section>`;

document.addEventListener('DOMContentLoaded', async () => {
  const anchor = document.querySelector(TARGET_SELECTOR);
  if (!anchor) return;

  anchor.insertAdjacentHTML('afterend', MARKUP);

  const rows = await loadCSV(DATA_PATH).catch(() => null);
  if (!rows || rows.length < 5) return;

  const data = rows
    .map(r => ({ year: +r.year, valence: +r.valence }))
    .filter(r => Number.isFinite(r.year) && Number.isFinite(r.valence))
    .sort((a, b) => a.year - b.year);

  if (data.length < 5) return;

  // Peak — highest valence year.
  const peak = data.reduce((m, d) => d.valence > m.valence ? d : m);
  setText('story-peak-title', `Peak · ${peak.year}`);
  setText('story-peak-value', `${(peak.valence * 100).toFixed(1)}%`);

  // Break — biggest single-year valence drop.
  let worst = { delta: 0, from: data[0].year, to: data[0].year };
  for (let i = 1; i < data.length; i++) {
    const delta = data[i].valence - data[i - 1].valence;
    if (delta < worst.delta) worst = { delta, from: data[i - 1].year, to: data[i].year };
  }
  setText('story-break-title', `Break · ${worst.to}`);
  setText('story-break-value', `${worst.delta >= 0 ? '+' : '−'}${Math.abs(worst.delta * 100).toFixed(1)} pts`);

  // Floor — lowest valence year.
  const floor = data.reduce((m, d) => d.valence < m.valence ? d : m);
  setText('story-floor-title', `Floor · ${floor.year}`);
  setText('story-floor-value', `${(floor.valence * 100).toFixed(1)}%`);
});

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
