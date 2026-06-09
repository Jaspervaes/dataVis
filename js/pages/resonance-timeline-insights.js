/**
 * resonance-timeline-insights.js
 * ─────────────────────────────────────────────────────────────
 * Story cards parked below the Resonance Timeline year-detail box:
 *   PEAK · 1999  ·  BREAK · 2011  ·  FLOOR · 2018
 *
 * Self-contained. Injects its own markup after #insight-box.
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

const TARGET_SELECTOR = '#insight-box';

const MARKUP = `
<section class="story-cards" id="story-cards" aria-label="Timeline insights">
  <article class="story-card" id="story-card-peak" data-spotlight-year="2000" data-spotlight-feature="valence" style="--card-accent: var(--acid)">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-peak-title">Peak · 2000</span>
      <span class="story-card-tag" data-tone="up">All-time high</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-peak-value">59.2%</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      Music's happiest year, at the height of pre-millennium optimism and the launch of the <strong>Euro</strong>. It hasn't been this high since.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:var(--crisis-economic)">Euro launch</span>
      <span class="story-chip" style="--chip-color:var(--crisis-conflict)">Kosovo War</span>
    </footer>
  </article>

  <article class="story-card" id="story-card-break" data-spotlight-year="2011" data-spotlight-feature="valence" style="--card-accent: var(--crisis-conflict)">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-break-title">Break · 2011</span>
      <span class="story-card-tag" data-tone="down">Sharpest drop</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-break-value">-7.3%</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      Four crises detonated at once. Music has stayed below its <strong>1990s baseline</strong> ever since.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:var(--crisis-conflict)">Syrian Civil War</span>
      <span class="story-chip" style="--chip-color:var(--crisis-conflict)">Arab Spring</span>
      <span class="story-chip" style="--chip-color:var(--crisis-economic)">Euro Debt Crisis</span>
    </footer>
  </article>

  <article class="story-card" id="story-card-floor" data-spotlight-year="2017" data-spotlight-feature="valence" style="--card-accent: var(--crisis-pandemic)">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-floor-title">Floor · 2017</span>
      <span class="story-card-tag" data-tone="down">All-time low</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-floor-value">43.4%</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      The emotional floor. A year of deep political polarization and the ongoing weight of the refugee crisis.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:var(--crisis-pandemic)">Refugee crisis</span>
      <span class="story-chip" style="--chip-color:var(--crisis-conflict)">Global polarization</span>
    </footer>
  </article>
</section>`;

document.addEventListener('DOMContentLoaded', () => {
  const anchor = document.querySelector(TARGET_SELECTOR);
  if (!anchor) return;

  // Lead with the static story cards; the interactive year-detail box
  // (and its "click a year" prompt) sits below them.
  anchor.insertAdjacentHTML('beforebegin', MARKUP);

  // Linked highlighting: hovering a card spotlights its year/feature on the
  // timeline. Decoupled via a window event so resonance-timeline.js needn't
  // know this module exists (and vice-versa). Fires harmlessly if unhandled.
  const cards = document.getElementById('story-cards');
  cards?.querySelectorAll('article[data-spotlight-year]').forEach(card => {
    const detail = { year: +card.dataset.spotlightYear, feature: card.dataset.spotlightFeature };
    card.addEventListener('mouseenter', () =>
      window.dispatchEvent(new CustomEvent('resonance:spotlight', { detail })));
    card.addEventListener('mouseleave', () =>
      window.dispatchEvent(new CustomEvent('resonance:spotlight', { detail: null })));
  });
});
