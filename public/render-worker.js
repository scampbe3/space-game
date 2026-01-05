// render-worker.js — bootstrap OffscreenCanvas + run main.js inside worker
let started = false;

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;

  if (!started && msg.type === 'init') {
    const size = msg.size ?? {};
    globalThis.__OFFSCREEN_CANVAS = msg.canvas;
    if (msg.canvas && size.w && size.h) {
      msg.canvas.width = size.w;
      msg.canvas.height = size.h;
    }
    globalThis.innerWidth  = size.w ?? globalThis.innerWidth ?? 800;
    globalThis.innerHeight = size.h ?? globalThis.innerHeight ?? 600;
    if (typeof msg.dpr === 'number') {
      globalThis.devicePixelRatio = msg.dpr;
    }
    globalThis.__IS_RENDER_WORKER = true;
    if (typeof window === 'undefined') {
      globalThis.window = globalThis;
    }
    if (typeof document === 'undefined') {
      const makeCanvas = () => {
        if (typeof OffscreenCanvas !== 'undefined') {
          const oc = new OffscreenCanvas(1, 1);
          oc.style = { width: '', height: '' };
          return oc;
        }
        return { style: { width: '', height: '' }, width: 1, height: 1, getContext: () => null };
      };
      class FakeImage {
        constructor() {
          this._listeners = { load: [], error: [] };
          this.onload = null;
          this.onerror = null;
          this.width = 0;
          this.height = 0;
          this.crossOrigin = '';
          this.srcValue = '';
          this.complete = false;
          this.style = {};
        }
        addEventListener(type, fn) {
          (this._listeners[type] || (this._listeners[type] = [])).push(fn);
        }
        removeEventListener(type, fn) {
          const arr = this._listeners[type];
          if (!arr) return;
          const i = arr.indexOf(fn);
          if (i !== -1) arr.splice(i, 1);
        }
        _emit(type, evt) {
          (this._listeners[type] || []).forEach(f => f(evt));
          const handler = type === 'load' ? this.onload : type === 'error' ? this.onerror : null;
          handler && handler(evt);
        }
        decode() {
          return this._decodePromise || Promise.resolve();
        }
        set src(url) {
          if (!url) return;
          this.srcValue = url;
          fetch(url).then(r => r.blob()).then(blob => {
            return typeof createImageBitmap === 'function'
              ? createImageBitmap(blob)
              : Promise.reject(new Error('createImageBitmap not available'));
          }).then(bitmap => {
            this.width = bitmap.width;
            this.height = bitmap.height;
            this._bitmap = bitmap;
            this.complete = true;
            this._emit('load', { target: this });
          }).catch(err => {
            this._emit('error', { error: err, target: this });
          });
        }
      }
      // Always override Image in worker so loaders get a predictable impl
      globalThis.Image = FakeImage;
      const fakeDoc = {
        createElement: (tag) => {
          if (tag === 'canvas') return makeCanvas();
          if (tag === 'img') return new FakeImage();
          return { style: {}, getContext: () => null };
        },
        createElementNS: (_ns, tag) => {
          if (tag === 'canvas') return makeCanvas();
          if (tag === 'img') return new FakeImage();
          return { style: {}, getContext: () => null };
        },
        body: { appendChild: () => {} },
        head: { appendChild: () => {} },
        addEventListener: () => {},
        removeEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        __isFake: true
      };
      globalThis.document = fakeDoc;
    }
    started = true;
    import('./main.js').catch(err => {
      self.postMessage({ type: 'error', error: { message: err?.message, stack: err?.stack } });
    });
  }
  // other messages (inputs/resizes) are handled by main.js listeners once loaded
});

// Forward keyboard events from host to worker listeners when main.js isn't ready.
self.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (!msg || globalThis.__INPUT_HANDLER_READY__) return;
  const events = msg.type === 'input'
    ? [msg]
    : (msg.type === 'inputBatch' && Array.isArray(msg.events) ? msg.events : []);
  if (!events.length) return;
  events.forEach((entry) => {
    if (!entry?.event || entry.code !== 'Space') return;
    const synthetic = new Event(entry.event);
    Object.defineProperty(synthetic, 'code', { value: entry.code });
    Object.defineProperty(synthetic, 'repeat', { value: Boolean(entry.repeat) });
    // Ensure global addEventListener handlers see this (laser-system listens on global)
    if (typeof self.dispatchEvent === 'function') {
      self.dispatchEvent(synthetic);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(synthetic);
    }
  });
});

self.addEventListener('error', (e) => {
  self.postMessage({
    type: 'fatal',
    error: { message: e?.message || 'Worker error', stack: e?.error?.stack }
  });
});
self.addEventListener('unhandledrejection', (e) => {
  self.postMessage({
    type: 'fatal',
    error: {
      message: e?.reason?.message || String(e?.reason ?? 'unhandled rejection'),
      stack: e?.reason?.stack
    }
  });
});
