/* diagnostics.js  ─────────────────────────────────────────────
   DOM overlay on main thread; worker proxy posts diagnostics to host.
----------------------------------------------------------------*/

const isWorker = typeof document === 'undefined' || typeof window === 'undefined' || globalThis.__IS_RENDER_WORKER;
const showOverlay = !isWorker && !!globalThis.__SHOW_DIAGNOSTICS__;

let acc = 0, frames = 0;
let el = null;
let emit = null;

if (showOverlay) {
  el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    right:    '8px',
    bottom:   '4px',
    font:     '14px monospace',
    color:    '#00ff00',
    pointerEvents: 'none',
    textAlign: 'right',
  });
  document.body.appendChild(el);
} else if (isWorker && typeof self?.postMessage === 'function' && globalThis.__SHOW_DIAGNOSTICS__) {
  // only emit diagnostics if overlay is requested
  emit = (payload) => self.postMessage({ type: 'diag', payload });
}

let lastHtml = '';
export function renderDiagnosticsLines(lines = []) {
  if (!el) return;
  const html = lines.join('<br>');
  if (html === lastHtml) return;
  lastHtml = html;
  el.innerHTML = html;
}

export function updateDiagnostics(dt /* seconds */, extraLines = []) {
  if (!showOverlay && !emit) return;
  acc    += dt;
  frames += 1;
  if (acc >= 0.5) {                 // refresh twice a second
    const fps = Math.round(frames / acc);
    const lines = [`${fps} FPS`, ...extraLines];
    if (showOverlay && el) {
      const html = lines.join('<br>');
      if (html !== lastHtml) {
        lastHtml = html;
        el.innerHTML = html;
      }
    } else if (emit) {
      emit({ fps, lines });
    }
    acc = frames = 0;
  }
}
