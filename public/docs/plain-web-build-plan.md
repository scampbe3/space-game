Plain Web Build: Aggressive Tuning Plan
- Scope: maximize browser build performance while staying host-agnostic; focus on items from the note.
- Outcomes: WebGPU-first with WebGL2 fallback, minimized state churn, baked textures, pooled objects, cached assets, stable dt, and guidance for high-performance GPU selection.

1) WebGPU first, WebGL2 fallback
- Capability detect at startup: if navigator.gpu is present, initialize WebGPU; otherwise create a WebGL2 context with desired attributes.
- Expose a backend interface so render code is shared; gate backend-specific features with capability flags.
- Record backend selection in diagnostics/telemetry to see real-world coverage.

2) Reduce state changes
- Sort draws by program/material; batch static geometry where possible.
- Reuse VAOs/FBOs and avoid redundant binds; keep pipeline changes to a minimal set per frame.
- Prefer uniform buffers/texture arrays where supported to avoid frequent uniform updates.
- Add a draw-call/state-change counter to diagnostics to track wins.

3) Bake mipmaps and compress textures
- Offline bake mipmaps and generate compressed textures (KTX2/Basis) with uncompressed fallbacks.
- Ship hashed asset URLs via a manifest so runtime can pick the right format without per-frame work.
- Avoid runtime mipmap generation on hot paths; keep uploads staged and reused.

4) Pool objects
- Pools for projectiles, particles, explosions, and enemies; reset and reuse instead of allocating.
- Reuse typed arrays for per-frame data (matrices, uniforms, vertex buffers); preallocate command buffers.
- Track pool hit/miss stats in diagnostics to confirm GC churn is reduced.

5) Preload/cache assets with a service worker
- Add a service worker that precaches the core bundle plus key textures/meshes/audio; version via a manifest and cache-busting on updates.
- Runtime manifest fetch can trigger background prefetch for the next level/zone.
- On SW update, skip waiting and reload clients to keep users on the latest cache set.

6) Clamp dt
- Use a fixed-step accumulator (e.g., 1/60s) and clamp large deltas (e.g., max 50–100ms) to avoid spiral-of-death after tab refocus.
- Optionally interpolate visuals between simulation steps; drop frames rather than letting dt explode.
- Pipe dt spikes into diagnostics so quality tier can auto-adjust when performance tanks.

7) High-performance GPU guidance
- Detect discrete vs. integrated hints where possible and surface a prompt to set the site/app to “High performance GPU” in the OS/GPU control panel.
- Provide a quality toggle (effects/particles/shadows) and remember the user’s choice; default higher when a discrete GPU is detected.

Next actions
- Implement backend selector and diagnostics hooks (1).
- Add service worker manifest and precache list (5).
- Wire the fixed-step loop and dt clamp (6).
- Start pooling hot entities and batch-friendly render paths (2 and 4).
- Prepare texture pipeline notes/scripts for mipmap/compression outputs (3).
