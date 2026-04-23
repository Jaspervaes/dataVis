/**
 * main.js
 * ─────────────────────────────────────────────────────────────
 * Entry point — Dead Wax design system.
 *
 * - Nav glassmorphism on scroll
 * - Active link detection
 * - Mobile sidebar toggle
 * - Oscillating waveform canvas animation (replaces generic particles)
 * ─────────────────────────────────────────────────────────────
 */

// ── Nav scroll effect ─────────────────────────────────────────
function initNavScroll() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;
  const update = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

// ── Active nav link ────────────────────────────────────────────
function initActiveNav() {
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href').split('/').pop();
    if (href === page) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}

// ── Mobile sidebar toggle ──────────────────────────────────────
function initSidebarToggle() {
  const toggle  = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!toggle || !sidebar) return;

  const open = () => {
    sidebar.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    if (overlay) overlay.style.display = 'block';
  };
  const close = () => {
    sidebar.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    if (overlay) overlay.style.display = 'none';
  };

  toggle.addEventListener('click', () =>
    sidebar.classList.contains('open') ? close() : open()
  );
  overlay?.addEventListener('click', close);
}

// ── Oscillating waveform canvas ────────────────────────────────
// Multiple overlapping sine waves at different frequencies and phases.
// Evokes an oscilloscope reading a record groove — musical, not techy.
export function initWaveform(canvasId = 'waveform-canvas') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W, H, animId;

  // Wave definitions: each wave has its own character
  const waves = [
    // Slow, wide, dominant — the main pulse
    { freq: 0.0025, amp: 72,  speed: 0.006,  phase: 0,              opacity: 0.10, color: [200, 240, 0] },
    // Mid-frequency — harmonic
    { freq: 0.0048, amp: 38,  speed: 0.010,  phase: Math.PI * 0.7,  opacity: 0.07, color: [200, 240, 0] },
    // Fast, tight, nervous — treble
    { freq: 0.0088, amp: 18,  speed: 0.016,  phase: Math.PI * 1.3,  opacity: 0.05, color: [200, 240, 0] },
    // Ultra-slow, massive — sub-bass
    { freq: 0.0012, amp: 110, speed: 0.0028, phase: Math.PI * 0.4,  opacity: 0.04, color: [240, 235, 224] },
    // A whisper of red — tension
    { freq: 0.0035, amp: 28,  speed: 0.008,  phase: Math.PI * 1.8,  opacity: 0.04, color: [229, 50, 28] },
    // High overtone
    { freq: 0.0140, amp: 10,  speed: 0.022,  phase: Math.PI * 0.2,  opacity: 0.04, color: [200, 240, 0] },
  ];

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  function drawWave(wave) {
    let [r, g, b] = wave.color;

    // In light mode, swap acid chartreuse for the darker theme-compatible moss green
    if (document.documentElement.classList.contains('light-mode')) {
      if (r === 200 && g === 240 && b === 0) {
        [r, g, b] = [70, 92, 0]; // Match --acid (#465c00)
      }
    }

    ctx.beginPath();

    const segments = Math.min(W, 1200);
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * W;
      // Layer two frequencies for richer shape
      const y = (H / 2)
        + Math.sin(x * wave.freq + wave.phase) * wave.amp
        + Math.sin(x * wave.freq * 2.3 + wave.phase * 0.5) * (wave.amp * 0.22);

      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    ctx.strokeStyle = `rgba(${r},${g},${b},${wave.opacity})`;
    ctx.lineWidth   = 1.2;
    ctx.stroke();
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    waves.forEach(w => {
      w.phase += w.speed;
      drawWave(w);
    });
    animId = requestAnimationFrame(frame);
  }

  resize();
  frame();

  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(animId);
    resize();
    frame();
  });
  ro.observe(canvas.parentElement ?? canvas);
}

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNavScroll();
  initActiveNav();
  initSidebarToggle();
  initWaveform();
});
