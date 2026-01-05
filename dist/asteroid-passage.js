// asteroid-passage.js — static “asteroid with tunnel” + accurate mesh collisions
// Usage:
//   import { initAsteroidPassage } from './asteroid-passage.js';
//   const passage = await initAsteroidPassage(scene, { position:{x:..,y:..,z:..} });
//   // per frame (player):
//   steerNode.position.copy(
//     passage.collider.constrainPoint(prevPos, desiredPos, playerRadius).position
//   );
//   // lasers: passage.collider.linecast(origin, dir, maxDist)

import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from './libs/examples/jsm/utils/BufferGeometryUtils.js';

const MATERIAL_TEXTURE_KEYS = [
  'map',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap'
];

function capMaterialAnisotropy(material, cap) {
  if (!material || typeof cap !== 'number') return;
  if (Array.isArray(material)) {
    material.forEach(mat => capMaterialAnisotropy(mat, cap));
    return;
  }
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const tex = material[key];
    if (tex && tex.isTexture) {
      tex.anisotropy = Math.min(tex.anisotropy ?? cap, cap);
    }
  }
}

function freezeStaticTransforms(root) {
  root.updateMatrixWorld(true);
  root.traverse(o => {
    o.matrixAutoUpdate = false;
  });
}

/** Build a spatial hash (uniform grid) for triangle AABBs */
function makeSpatialHash(cellSize = 4) {
  const map = new Map();
  const keyOf = (ix, iy, iz) => `${ix}|${iy}|${iz}`;
  function insertTri(aabbMin, aabbMax, triIndex) {
    const cs = cellSize;
    const min = new THREE.Vector3(
      Math.floor(aabbMin.x / cs),
      Math.floor(aabbMin.y / cs),
      Math.floor(aabbMin.z / cs)
    );
    const max = new THREE.Vector3(
      Math.floor(aabbMax.x / cs),
      Math.floor(aabbMax.y / cs),
      Math.floor(aabbMax.z / cs)
    );
    for (let ix = min.x; ix <= max.x; ix++) {
      for (let iy = min.y; iy <= max.y; iy++) {
        for (let iz = min.z; iz <= max.z; iz++) {
          const k = keyOf(ix, iy, iz);
          let arr = map.get(k);
          if (!arr) { arr = []; map.set(k, arr); }
          arr.push(triIndex);
        }
      }
    }
  }
  function queryAABB(aabbMin, aabbMax, out = []) {
    const seen = new Set();
    const cs = cellSize;
    const min = new THREE.Vector3(
      Math.floor(aabbMin.x / cs),
      Math.floor(aabbMin.y / cs),
      Math.floor(aabbMin.z / cs)
    );
    const max = new THREE.Vector3(
      Math.floor(aabbMax.x / cs),
      Math.floor(aabbMax.y / cs),
      Math.floor(aabbMax.z / cs)
    );
    for (let ix = min.x; ix <= max.x; ix++) {
      for (let iy = min.y; iy <= max.y; iy++) {
        for (let iz = min.z; iz <= max.z; iz++) {
          const k = `${ix}|${iy}|${iz}`;
          const arr = map.get(k);
          if (!arr) continue;
          for (const idx of arr) {
            if (!seen.has(idx)) { seen.add(idx); out.push(idx); }
          }
        }
      }
    }
    return out;
  }
  return { insertTri, queryAABB, cellSize };
}

/** Closest point on triangle (Christer Ericson, Real-Time Collision Detection) */
function closestPointOnTri(p, a, b, c, out) {
  // Compute vectors
  const ab = _v1.subVectors(b, a);
  const ac = _v2.subVectors(c, a);
  const ap = _v3.subVectors(p, a);

  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) { out.copy(a); return out; }

  const bp = _v3.subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) { out.copy(b); return out; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.copy(ab).multiplyScalar(v).add(a);
    return out;
  }

  const cp = _v3.subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) { out.copy(c); return out; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.copy(ac).multiplyScalar(w).add(a);
    return out;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.copy(_v4.subVectors(c, b)).multiplyScalar(w).add(b);
    return out;
  }

  // Inside face region
  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out.copy(a).addScaledVector(ab, v).addScaledVector(ac, w);
  return out;
}

/** Ray-triangle (Möller–Trumbore) — returns t or Infinity */
function rayTri(rayOrig, rayDir, a, b, c) {
  const EPS = 1e-8;
  const edge1 = _v1.subVectors(b, a);
  const edge2 = _v2.subVectors(c, a);
  const pvec = _v3.crossVectors(rayDir, edge2);
  const det = edge1.dot(pvec);
  if (det > -EPS && det < EPS) return Infinity;          // parallel
  const invDet = 1 / det;
  const tvec = _v4.subVectors(rayOrig, a);
  const u = tvec.dot(pvec) * invDet;
  if (u < 0 || u > 1) return Infinity;
  const qvec = _v5.crossVectors(tvec, edge1);
  const v = rayDir.dot(qvec) * invDet;
  if (v < 0 || u + v > 1) return Infinity;
  const t = edge2.dot(qvec) * invDet;
  return t > EPS ? t : Infinity;
}

// scratch vectors
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _aabbMin = new THREE.Vector3();
const _aabbMax = new THREE.Vector3();
const _expandedAABB = new THREE.Box3();
const _closest = new THREE.Vector3();
const _triN = new THREE.Vector3();
const _tmpSize = new THREE.Vector3();

export async function initAsteroidPassage(
  scene,
  {
    path = './models/asteroid_passage.glb',
    position = { x: 0, y: 0, z: -900 },
    rotation = { x: 0, y: 0, z: 45 },
    scale = 30,
    cellSize = 'auto',        // spatial hash cell size (world units)
    visible = true,
    materialMode = 'default',
    anisotropyCap = 1,
    freezeTransforms = true
  } = {}
) {
  // 1) Load GLB and bake a single world-space geometry
  const gltf = await new GLTFLoader().loadAsync(path);
  const root = gltf.scene;
  root.position.set(position.x, position.y, position.z);
  root.rotation.set(rotation.x, rotation.y, rotation.z);
  root.scale.setScalar(scale);
  root.visible = visible;
  scene.add(root);

  // Clone each mesh’s geometry into world space & merge
  const geos = [];
  root.updateMatrixWorld(true);
  const useLambert = materialMode === 'lambert';
  const toLambert = (material) => {
    if (!material) return material;
    if (Array.isArray(material)) return material.map(toLambert);
    const lambert = new THREE.MeshLambertMaterial({
      color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
      map: material.map ?? null,
      emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
      emissiveMap: material.emissiveMap ?? null,
      emissiveIntensity: material.emissiveIntensity ?? 1,
      transparent: material.transparent ?? false,
      opacity: material.opacity ?? 1,
      alphaTest: material.alphaTest ?? 0,
      side: material.side ?? THREE.FrontSide,
      depthWrite: material.depthWrite ?? true,
      depthTest: material.depthTest ?? true
    });
    return lambert;
  };
  root.traverse(o => {
    if (o.isMesh && o.geometry) {
      if (o.visible === false) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld); // bake to world
      geos.push(geo);
      // give it its own material instance if you want flashes later
      o.material = useLambert ? toLambert(o.material) : o.material.clone();
      capMaterialAnisotropy(o.material, anisotropyCap);
      // thin wireframe for debugging (toggle .visible when needed)
      // o.material.wireframe = true;
    }
  });
  if (freezeTransforms) {
    freezeStaticTransforms(root);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos, false);

  // 2) Extract triangle list & build spatial hash
  const pos = merged.getAttribute('position');
  const index = merged.index
    ? merged.index.array
    : Array.from({ length: pos.count }, (_, i) => i);

  const triCount = index.length / 3;
  if (cellSize === 'auto' || cellSize === null || !Number.isFinite(cellSize) || cellSize <= 0) {
    if (!merged.boundingBox) merged.computeBoundingBox();
    const box = merged.boundingBox;
    box.getSize(_tmpSize);
    const maxDim = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z);
    const minDim = Math.min(_tmpSize.x, _tmpSize.y, _tmpSize.z);
    const midDim = _tmpSize.x + _tmpSize.y + _tmpSize.z - maxDim - minDim;
    const thickness = Math.max(minDim, maxDim * 0.15);
    const volume = Math.max(maxDim * midDim * thickness, 1e-3);
    const density = triCount / volume;
    const targetTrisPerCell = 140;
    const raw = Math.cbrt(targetTrisPerCell / Math.max(density, 1e-6));
    cellSize = THREE.MathUtils.clamp(raw, 4, 18);
  }
  const tris = new Array(triCount);
  const hash = makeSpatialHash(cellSize);

  for (let t = 0; t < triCount; t++) {
    const i0 = index[t * 3 + 0];
    const i1 = index[t * 3 + 1];
    const i2 = index[t * 3 + 2];
    const a = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const b = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const c = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    // precompute triangle normal for push-out
    _triN.copy(b).sub(a).cross(_v2.copy(c).sub(a)).normalize();
    tris[t] = { a, b, c, n: _triN.clone() };

    // insert AABB into grid
    _aabbMin.set(
      Math.min(a.x, b.x, c.x),
      Math.min(a.y, b.y, c.y),
      Math.min(a.z, b.z, c.z)
    );
    _aabbMax.set(
      Math.max(a.x, b.x, c.x),
      Math.max(a.y, b.y, c.y),
      Math.max(a.z, b.z, c.z)
    );
    hash.insertTri(_aabbMin, _aabbMax, t);
  }

  // 3) Build a broad AABB for the whole set piece (quick reject)
  const worldAABB = new THREE.Box3().setFromObject(root);

  // 4) Precise queries -------------------------------------------------

  /** Query candidates near an AABB */
  function _gatherCandidates(aabbMin, aabbMax, outIdx = []) {
    outIdx.length = 0;
    return hash.queryAABB(aabbMin, aabbMax, outIdx);
  }

  /** Sphere penetration test against triangles.
   *  Returns {hit, point, normal, depth} */
  function testSphere(center, radius) {
    // quick reject using an expanded copy (keep worldAABB untouched)
    _expandedAABB.copy(worldAABB).expandByScalar(radius);
    if (!_expandedAABB.containsPoint(center)) return { hit: false };

    const out = { hit: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), depth: 0 };

    _aabbMin.set(center.x - radius, center.y - radius, center.z - radius);
    _aabbMax.set(center.x + radius, center.y + radius, center.z + radius);
    const cand = _gatherCandidates(_aabbMin, _aabbMax, _candIdx);

    let bestDepth = 0;
    for (let i = 0; i < cand.length; i++) {
      const tri = tris[cand[i]];
      const cp = closestPointOnTri(center, tri.a, tri.b, tri.c, _closest);
      const dist2 = center.distanceToSquared(cp);
      if (dist2 <= radius * radius) {
        const d = Math.sqrt(dist2);
        const depth = radius - d;
        if (depth > bestDepth) {
          bestDepth = depth;
          out.hit = true;
          out.point.copy(cp);
          out.normal.copy(tri.n); // push along triangle normal
          out.depth = depth;
        }
      }
    }
    return out;
  }

  /** Constrain a point motion (prev → next) by sphere collision; returns slide.
   *  Good for clamping player steering against the tunnel walls. */
  function constrainPoint(prev, desired, radius, maxIterations = 3) {
    const result = { position: new THREE.Vector3().copy(desired), hit: false, iterations: 0, normal: new THREE.Vector3() };

    // If the move crosses the big AABB, we bother checking; else nothing to do.
    const segAABB = _segmentAABB(prev, desired, radius, _aabbMin, _aabbMax);
    if (!segAABB.intersectsBox(worldAABB)) return result;

    // Iterative push-out + slide
    for (let k = 0; k < maxIterations; k++) {
      const probe = testSphere(result.position, radius);
      if (!probe.hit) break;

      // push out
      const push = _v1.copy(probe.normal).multiplyScalar(probe.depth + 1e-3);
      result.position.add(push);
      result.hit = true;
      result.normal.copy(probe.normal);
      result.iterations++;
      // optional: project remaining motion onto tangent plane (simple slide)
    }
    return result;
  }

  /** Ray/segment vs mesh — returns {hit, t, point, normal} or {hit:false} */
  function linecast(origin, dir, maxDist = Infinity) {
    // fast coarse AABB reject
    const rayBox = new THREE.Ray(origin, dir);
    const tBox = rayBox.intersectBox(worldAABB, new THREE.Vector3());
    if (tBox === null || tBox > maxDist) return { hit: false };

    const end = _v1.copy(dir).multiplyScalar(maxDist).add(origin);
    _aabbMin.set(Math.min(origin.x, end.x), Math.min(origin.y, end.y), Math.min(origin.z, end.z));
    _aabbMax.set(Math.max(origin.x, end.x), Math.max(origin.y, end.y), Math.max(origin.z, end.z));
    const cand = _gatherCandidates(_aabbMin, _aabbMax, _candIdx);

    let bestT = maxDist;
    let bestN = null;
    for (let i = 0; i < cand.length; i++) {
      const tri = tris[cand[i]];
      const t = rayTri(origin, dir, tri.a, tri.b, tri.c);
      if (t < bestT) { bestT = t; bestN = tri.n; }
    }
    if (bestT !== maxDist) {
      const point = _v1.copy(dir).multiplyScalar(bestT).add(origin);
      return { hit: true, t: bestT, point: point.clone(), normal: bestN.clone() };
    }
    return { hit: false };
  }

  /** Point-in-solid test (odd-even rule along +X) */
  function isPointInside(pt) {
    if (!worldAABB.containsPoint(pt)) return false;

    // Build an AABB from the point to max.x so the hash query is small
    _aabbMin.set(pt.x, pt.y, pt.z);
    _aabbMax.copy(worldAABB.max);
    const cand = _gatherCandidates(_aabbMin, _aabbMax, _candIdx);

    const dir = _v2.set(1, 0, 0);           // +X ray
    let crossings = 0;
    for (let i = 0; i < cand.length; i++) {
      const tri = tris[cand[i]];
      const t = rayTri(pt, dir, tri.a, tri.b, tri.c);
      if (t !== Infinity && t > 1e-5) crossings++;
    }
    return crossings % 2 === 1;             // odd → inside
  }

  /** Optional helper to visualize the merged collider (wireframe) */
  function addDebugWire(material = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.15 })) {
    const m = new THREE.Mesh(merged, material);
    // Keep it at world coordinates (not parented under root), purely debug:
    scene.add(m);
    return m;
  }

  // scratch arrays/boxes used by collider
  const _candIdx = [];
  function _segmentAABB(a, b, r, outMin, outMax) {
    outMin.set(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r);
    outMax.set(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r);
    const box = new THREE.Box3(outMin.clone(), outMax.clone());
    return box;
  }

  // Expose
  const collider = { testSphere, constrainPoint, linecast, isPointInside, addDebugWire, worldAABB };
  collider.mesh = root;
  root.userData.collider = collider; // convenient handle

  function prewarm(renderer, camera) {
    const prevVis = root.visible;
    root.visible = true;
    const prevCulls = [];
    root.traverse(o => {
      if (o.isMesh) {
        prevCulls.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
    renderer.render(scene, camera);
    root.visible = prevVis;
    prevCulls.forEach(([o, c]) => { o.frustumCulled = c; });
  }

  return {
    getMesh: () => root,
    collider,
    update: () => {}, // static set piece (no per-frame work required)
    prewarm
  };
}
