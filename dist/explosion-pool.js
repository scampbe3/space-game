import * as THREE from './libs/build/three.module.js';

/**
 * Lightweight explosion pool: tiny additive billboards with quick fade/expand.
 */
export function createExplosionPool(scene, {
  poolSize = 24,
  baseSize = 6,
  colors = null,             // optional palette override
  life = 0.35                // seconds
} = {}) {
  const geo = new THREE.PlaneGeometry(baseSize, baseSize);

  // fuzzy radial gradient (shared) to avoid sharp edges/squares
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(128, 128) : null);
  if (!canvas) throw new Error('No canvas available for explosion texture');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;

  const defaultPalette = [0xff6622, 0xffbb22, 0xff3322];
  const palette = colors && colors.length ? colors : defaultPalette;
  const opacities = [0.8, 0.6, 0.85];
  const variants = palette.map((c, i) => new THREE.MeshBasicMaterial({
    color: c,
    map: tex,
    transparent: true,
    opacity: opacities[i % opacities.length],
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  }));

  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const mat = variants[i % variants.length];
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.userData.life = 0;
    mesh.userData.variant = i % variants.length;
    scene.add(mesh);
    pool.push(mesh);
  }

  function spawn(position, lifeOverride = null) {
    const fx = pool.find(m => !m.visible);
    if (!fx) return;
    fx.visible = true;
    const maxLife = Number.isFinite(lifeOverride) ? lifeOverride : life;
    fx.userData.maxLife = maxLife;
    fx.userData.life = maxLife;             // seconds
    fx.scale.setScalar(1);
    fx.position.copy(position);
    return fx;
  }

  function update(dt, camera = null) {
    pool.forEach(fx => {
      if (!fx.visible) return;
      fx.userData.life -= dt;
      if (fx.userData.life <= 0) {
        fx.visible = false;
        return;
      }
      const maxLife = fx.userData.maxLife ?? life;
      const t = maxLife > 0 ? (fx.userData.life / maxLife) : 0;
      const baseOpacity = fx.userData.variant === 1 ? 0.6 : fx.userData.variant === 2 ? 0.85 : 0.8;
      fx.material.opacity = baseOpacity * t;
      const s = THREE.MathUtils.lerp(1, 2.5, 1 - t);
      fx.scale.setScalar(s);
      if (camera) {
        fx.quaternion.copy(camera.quaternion); // true billboard
      }
    });
  }

  function prewarm(renderer, camera) {
    const prev = pool.map(p => ({ vis: p.visible, life: p.userData.life }));
    pool.slice(0, Math.min(pool.length, 8)).forEach(p => {
      p.visible = true;
      p.userData.maxLife = life;
      p.userData.life = life;
      p.scale.setScalar(1);
    });
    // render a tiny frame to bake programs/UBOs
    const prevSize = renderer.getSize(new THREE.Vector2());
    renderer.setSize(64, 64, false);
    renderer.render(scene, camera);
    renderer.setSize(prevSize.x, prevSize.y, false);
    pool.forEach((p, i) => {
      p.visible = prev[i].vis;
      p.userData.life = prev[i].life;
    });
  }

  return { spawn, update, prewarm };
}
