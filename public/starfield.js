import * as THREE from './libs/build/three.module.js';

export function addStarfield(scene, {
  radius = 12200,
  depth  = 500,
  count  = 20000,
  size   = 0.7,
  colour = 0xffffff
} = {}) {
  const pos = new Float32Array(count * 3);
  const outer = Math.max(1, radius + depth);
  for (let i = 0; i < count; i++) {
    // Uniform distribution through sphere volume (not a shell).
    const r = Math.cbrt(Math.random()) * outer;
    const v = new THREE.Vector3().randomDirection().multiplyScalar(r);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry()
    .setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size, color: colour })
  ));
}
