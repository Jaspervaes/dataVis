/**
 * story-mode.js
 * ─────────────────────────────────────────────────────────────
 * Adds a "story mode" to a visualisation page: a single large,
 * tinted insight panel that narrates the chapter's headline stat,
 * with the graph pre-set to a matching filter preset. A segmented
 * toggle swaps between this story panel and the page's standard
 * insights, so it stays reversible/dynamic.
 *
 * Story mode starts ON when the page is opened from the homepage
 * walkthrough (?story=1); otherwise the standard insights show.
 *
 * Each page calls initStoryMode(config) at the end of its init,
 * after the first render so the filter system is already bound.
 * ─────────────────────────────────────────────────────────────
 */

/**
 * Preset helpers — drive the page's existing filter inputs by setting
 * their values and dispatching the native events the page already
 * listens to (so filter state + re-render flow through normally).
 */
export const fx = {
  decade(start, end) {
    const ss = document.getElementById('filter-decade-start');
    const se = document.getElementById('filter-decade-end');
    if (ss) ss.value = start;
    if (se) se.value = end;
    (ss || se)?.dispatchEvent(new Event('input', { bubbles: true }));
  },
  group(name, values) {
    const boxes = document.querySelectorAll(`[data-filter-group="${name}"]`);
    if (!boxes.length) return;
    boxes.forEach(cb => { cb.checked = values.includes(cb.value); });
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
  },
  radio(name, value) {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
  },
  range(id, value) {
    const el = document.getElementById(id);
    if (el) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }
  },
  checkbox(id, on) {
    const el = document.getElementById(id);
    if (el && el.checked !== on) { el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }
  },
  click(selector) {
    document.querySelector(selector)?.click();
  },
};

/**
 * @param {Object} config
 * @param {string} config.insightsSelector  Selector for the page's standard insights element (hidden in story mode).
 * @param {string} config.eyebrow           Chapter label, e.g. "Chapter 01 · The Story".
 * @param {string} config.stat              Headline figure, e.g. "30% → 48.3%".
 * @param {string} config.statLabel         Caption under the figure.
 * @param {string} config.body              Narrative paragraph (may contain HTML).
 * @param {{href:string,label:string,teaser:string}|null} [config.next]  Next-chapter link.
 * @param {Function} [config.applyPreset]   Sets filters to match the story.
 * @param {Function} [config.clearPreset]   Restores page defaults when switching back.
 */
export function initStoryMode(config) {
  const insightsEl = document.querySelector(config.insightsSelector);
  if (!insightsEl) return;

  const wrap = document.createElement('div');
  wrap.className = 'story-mode-wrap';
  wrap.innerHTML = `
    <div class="story-switch" role="tablist" aria-label="Insight view">
      <button class="story-switch-btn" data-mode="story"    type="button" role="tab">Walkthrough</button>
      <button class="story-switch-btn" data-mode="standard" type="button" role="tab">Insights</button>
    </div>
    <section class="story-insight story-hidden" aria-live="polite">
      <div class="story-insight-body">
        <span class="story-insight-eyebrow"><span class="story-insight-dot" aria-hidden="true"></span>${config.eyebrow}</span>
        <div class="story-insight-hero">
          <span class="story-insight-stat">${config.stat}</span>
          <span class="story-insight-statlabel">${config.statLabel}</span>
        </div>
        <p class="story-insight-text">${config.body}</p>
      </div>
      ${config.next ? `
        <a class="story-insight-next" href="${config.next.href}">
          <span class="story-insight-next-kicker">Next chapter</span>
          <span class="story-insight-next-label">${config.next.label}</span>
          <span class="story-insight-next-teaser">${config.next.teaser}</span>
          <span class="story-insight-next-go">See what it means <span aria-hidden="true">→</span></span>
        </a>` : ''}
    </section>`;

  insightsEl.parentNode.insertBefore(wrap, insightsEl);
  insightsEl.classList.add('story-toggleable');

  const storyBox = wrap.querySelector('.story-insight');
  const btns     = wrap.querySelectorAll('.story-switch-btn');
  let presetActive = false;

  function setMode(mode) {
    const story = mode === 'story';
    storyBox.classList.toggle('story-hidden', !story);
    insightsEl.classList.toggle('story-hidden', story);
    btns.forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (story) {
      config.applyPreset?.();
      presetActive = true;
    } else if (presetActive) {
      config.clearPreset?.();
      presetActive = false;
    }
  }

  btns.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  const params = new URLSearchParams(window.location.search);
  const startStory = params.get('story') === '1' || window.location.hash === '#story';
  setMode(startStory ? 'story' : 'standard');
}
