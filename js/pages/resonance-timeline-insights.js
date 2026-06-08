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
  <article class="story-card" id="story-card-peak" style="--card-accent: var(--acid)">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-peak-title">Peak · 1986</span>
      <span class="story-card-tag" data-tone="up">All-time high</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-peak-value">60.1%</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      Music's happiest year — in the midst of the <strong>AIDS crisis</strong> and the <strong>S&amp;L crisis</strong>. It hasn't been this high since.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:#f0a830">AIDS crisis</span>
      <span class="story-chip" style="--chip-color:#e5321c">S&amp;L crisis</span>
    </footer>
  </article>

  <article class="story-card" id="story-card-break" style="--card-accent: #e5321c">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-break-title">Break · 2011</span>
      <span class="story-card-tag" data-tone="down">Sharpest drop</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-break-value">-2,4%</span>
      <span class="story-card-unit">valence</span>
    </div>
    <p class="story-card-tagline">
      Four crises detonated at once. Music has stayed below its <strong>1990s baseline</strong> ever since.
    </p>
    <footer class="story-card-chips">
      <span class="story-chip" style="--chip-color:#e5321c">Syrian Civil War</span>
      <span class="story-chip" style="--chip-color:#e5321c">Arab Spring</span>
      <span class="story-chip" style="--chip-color:#f0a830">Euro Debt Crisis</span>
    </footer>
  </article>

  <article class="story-card" id="story-card-floor" style="--card-accent: #6aabf0">
    <header class="story-card-head">
      <span class="story-card-eyebrow" id="story-floor-title">Steady uptick · 1986–2018</span>
      <span class="story-card-tag" data-tone="flat">Danceability change</span>
    </header>
    <div class="story-card-hero">
      <span class="story-card-value" id="story-floor-value">42.7%</span>
      <span class="story-card-unit">danceability</span>
    </div>
    <p class="story-card-tagline">
      despite sadder music, it got <em>more</em> danceable.
    </p>
  </article>
</section>`;

document.addEventListener('DOMContentLoaded', () => {
  const anchor = document.querySelector(TARGET_SELECTOR);
  if (!anchor) return;

  anchor.insertAdjacentHTML('afterend', MARKUP);
});
