import * as THREE from './libs/build/three.module.js';
import { addScore } from './hud.js';   // NEW – scoring
import { createExplosionPool } from './explosion-pool.js';

export function createLaserSystem(scene, {
  speed    = 200,
  life     = 2,
  colour   = 0x00ff00,
  poolSize = 30,
  cooldown = 0.18,
  bossMesh   = null,
  damageBoss = ()=>{},
  bossHitR2  = 400,
  stationMesh   = null,        // NEW
  damageStation = () => {},    // NEW
  camera,                 // ① NEW – the main PerspectiveCamera
  getEnemies = () => [],   // ② NEW – returns active fighters
  passageCollider = null,   // optional single collider (back-compat)
  passageColliders = [],     // optional array of colliders
  onEnemyKilled = () => {},  // callback(positionVec3) when a fighter is killed
  onShotFired = () => {},    // callback(shotId, type)
  onShotHit = () => {}       // callback(shotId)

} = {}) {

let dualMode = false;
let blueMode = false;
let damageMult = 1;
const BASE_COLOR = colour;
const BLUE_COLOR = 0x00ffff;
  const LASER_WIDTH = 0.3;
  const LASER_RADIUS = LASER_WIDTH * 0.5;
  const geo = new THREE.BoxGeometry(LASER_WIDTH, LASER_WIDTH, 6).translate(0, 0, 3);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();   // new scratch
  const tmpPrev = new THREE.Vector3();
  const tmpKill = new THREE.Vector3();
  const blastFX = [];  // pooled charge-explosion visuals
  const tmpBill = new THREE.Quaternion();
  const tmpAllyDir = new THREE.Vector3();
  const tmpAllyQuat = new THREE.Quaternion();


  const MIN_HIT_R2   = 3 * 3;               // impact radius (3 u)
  const MAX_FLIGHT_T = 1.5;                 // shorter life to keep active count low
  const mat = new THREE.MeshBasicMaterial({ color: BASE_COLOR });
  const pool = Array.from({ length: poolSize }, () => {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    return m;
  });
  const ALLY_POOL_SIZE = 8;
  const allyMat = new THREE.MeshBasicMaterial({ color: BASE_COLOR });
  const allyPool = Array.from({ length: ALLY_POOL_SIZE }, () => {
    const m = new THREE.Mesh(geo, allyMat);
    m.visible = false;
    scene.add(m);
    return m;
  });


  /* charge-shot params */
const CHARGE_COOLDOWN = 0.18;   // # same as normal laser rate
const CHARGE_COUNT    = 3;      // fire 3 normals, then start charging
const CHARGE_TIME     = 0.7;    // seconds to reach full charge
const CHARGE_SPEED    = 120;    // flight speed once released
const CHARGE_RANGE    = 120;     // distance before it explodes
const BOSS_MESH   = bossMesh;
const DAMAGE_BOSS = damageBoss;
const BOSS_R2     = bossHitR2;
const STATION_MESH   = stationMesh;
const STATION_COLLIDER = stationMesh?.userData?.collider ?? null;
const DAMAGE_STATION = damageStation;
const CAMERA     = camera;         // ← store once
const GET_ENEMY  = getEnemies;     // ← store once
const CHARGE_SCALE_MIN = 0.30;   // a touch larger while growing
const CHARGE_SCALE_MAX = 0.80;   // final size in flight
const CHARGE_DAMAGE    = 3;
const BLAST_INNER_R    = 8;      // ↑ mild increase (damage)
const BLAST_OUTER_R    = 16;     // ↑ mild increase (flash halo)
const BLAST_MID_R      = (BLAST_INNER_R + BLAST_OUTER_R) * 0.5;
const BLAST_COLOR_INNER = 0x00ff7f;
const BLAST_COLOR_OUTER = 0x00b060;
const BLAST_LIFE       = 0.5;    // shorter explosion life to cut fill-rate
const BLAST_START_SCALE = 0.5;   // start smaller than target radius
const CHARGE_FORWARD_OFFSET = 0.5; // fallback offset if no nose data found
const CHARGE_FORWARD_TWEAK = -0.85; // manual tweak applied even with nose data
const CHARGE_NOSE_PAD = -1; // extra push beyond the ship nose
const BOMB_RADIUS = 1.1;
const BOMB_SPEED = CHARGE_SPEED;
const BOMB_RANGE = CHARGE_RANGE;
const BOMB_POOL_SIZE = 6;
const BOMB_BLAST_INNER_R = BLAST_INNER_R * 2;
const BOMB_BLAST_OUTER_R = BLAST_OUTER_R * 2;
const BOMB_BLAST_LIFE = BLAST_LIFE * 3;
const BOMB_BLAST_START_SCALE = 0.35;
const BOMB_DPS = CHARGE_DAMAGE;
const BOMB_IMPACT_DAMAGE = CHARGE_DAMAGE * 2;
const PASSAGE_COLLIDERS = [];
if (passageCollider) PASSAGE_COLLIDERS.push(passageCollider);
if (Array.isArray(passageColliders)) {
  PASSAGE_COLLIDERS.push(...passageColliders.filter(Boolean));
}

const MUZZLE_POOL_SIZE = Math.max(40, poolSize * 2);
const MUZZLE_BACK_OFFSET = 0; // place flashes at the nose instead of pulling back
const MUZZLE_BASE_SIZE = LASER_WIDTH * 2;
const MUZZLE_LIFE = 0.03;
const TINY_IMPACT_LIFE = 0.175;
const muzzleFxGreen = createExplosionPool(scene, {
  poolSize: MUZZLE_POOL_SIZE,
  baseSize: MUZZLE_BASE_SIZE,
  colors: [BASE_COLOR]
});
const muzzleFxBlue = createExplosionPool(scene, {
  poolSize: MUZZLE_POOL_SIZE,
  baseSize: MUZZLE_BASE_SIZE,
  colors: [BLUE_COLOR]
});

const setBlastOpacity = (fx, value) => {
  if (!fx?.material) return;
  if (fx.material.uniforms?.opacity) {
    fx.material.uniforms.opacity.value = value;
  } else {
    fx.material.opacity = value;
  }
};

const createBlastMidMaterial = () => new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    innerColor: { value: new THREE.Color(BLAST_COLOR_INNER) },
    outerColor: { value: new THREE.Color(BLAST_COLOR_OUTER) },
    opacity: { value: 0.65 }
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 innerColor;
    uniform vec3 outerColor;
    uniform float opacity;
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
      vec3 viewDir = normalize(vViewPosition);
      float rim = 1.0 - clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
      float t = smoothstep(0.0, 1.0, rim);
      vec3 color = mix(innerColor, outerColor, t);
      float edge = smoothstep(0.6, 1.0, rim);
      float alpha = opacity * (0.35 + 0.65 * (1.0 - edge));
      gl_FragColor = vec4(color, alpha);
    }
  `
});

/* pool just for charge spheres */
const cGeo  = new THREE.SphereGeometry(CHARGE_SCALE_MAX, 16, 16);   // mesh size ≈ max charge
const cMat  = new THREE.MeshBasicMaterial({ color: 0x00ff7f });  // HUD-green
const chargePool = Array.from({ length: 8 }, () => {
  const m = new THREE.Mesh(cGeo, cMat); m.visible = false; scene.add(m); return m;
});
// charge blast FX pool (two expanding spheres, pooled)
const blastLayers = [
  { radius: BLAST_INNER_R, opacity: 0.9, material: new THREE.MeshBasicMaterial({
    color: BLAST_COLOR_INNER,
    transparent: true,
    opacity: 0.9
  }) },
  { radius: BLAST_MID_R, opacity: 0.65, material: createBlastMidMaterial() },
  { radius: BLAST_OUTER_R, opacity: 0.4, material: new THREE.MeshBasicMaterial({
    color: BLAST_COLOR_OUTER,
    transparent: true,
    opacity: 0.4
  }) }
];
blastLayers.forEach(layer => {
  const g = new THREE.SphereGeometry(layer.radius, 16, 16);
  const fx = new THREE.Mesh(g, layer.material);
  fx.visible = false;
  fx.userData.life = 0;
  fx.userData.baseOpacity = layer.opacity;
  scene.add(fx);
  blastFX.push(fx);
});

/* bomb projectile pool (low-poly sphere + face) */
const bombBodyMat = new THREE.MeshBasicMaterial({ color: 0xd01f1f });
const bombFaceMat = new THREE.MeshBasicMaterial({ color: 0x081a33 });
const bombLetterMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const bombCore = new THREE.Group();
const bombBody = new THREE.Mesh(new THREE.IcosahedronGeometry(BOMB_RADIUS, 0), bombBodyMat);
bombCore.add(bombBody);
const bombFace = new THREE.Mesh(new THREE.CircleGeometry(BOMB_RADIUS * 0.7, 8), bombFaceMat);
bombFace.position.z = BOMB_RADIUS * 0.85;
bombCore.add(bombFace);
const bombLetter = new THREE.Group();
const bStem = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.06), bombLetterMat);
bStem.position.set(-0.12, 0, 0);
const bTop = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.06), bombLetterMat);
bTop.position.set(0.05, 0.2, 0);
const bBottom = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.06), bombLetterMat);
bBottom.position.set(0.05, -0.2, 0);
bombLetter.add(bStem, bTop, bBottom);
bombLetter.position.z = bombFace.position.z + 0.02;
bombCore.add(bombLetter);
const bombPool = Array.from({ length: BOMB_POOL_SIZE }, () => {
  const core = bombCore.clone(true);
  const m = new THREE.Group();
  m.add(core);
  m.visible = false;
  scene.add(m);
  return m;
});

/* bomb blast FX pool (bigger, longer, with spikes) */
const bombBlastFX = [];
const bombInnerGeo = new THREE.SphereGeometry(BOMB_BLAST_INNER_R, 12, 12);
const bombOuterGeo = new THREE.SphereGeometry(BOMB_BLAST_OUTER_R, 12, 12);
const bombInnerMat = new THREE.MeshBasicMaterial({
  color: 0x00ffff,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const bombOuterMat = new THREE.MeshBasicMaterial({
  color: 0x00ccff,
  transparent: true,
  opacity: 0.35,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const bombSpikeLen = (BOMB_BLAST_OUTER_R - BOMB_BLAST_INNER_R) * 1.15;
const bombSpikeGeo = new THREE.ConeGeometry(BOMB_BLAST_INNER_R * 0.25, bombSpikeLen, 4);
const bombSpikeMat = new THREE.MeshBasicMaterial({
  color: 0x0077c8,
  transparent: true,
  opacity: 0.75,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const bombSpikeUp = new THREE.Vector3(0, 1, 0);
const bombSpikeDirs = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(1, 1, -1),
  new THREE.Vector3(1, -1, 1),
  new THREE.Vector3(-1, 1, 1),
  new THREE.Vector3(-1, -1, 1),
  new THREE.Vector3(-1, 1, -1)
].map(v => v.normalize());
const createBombBlast = () => {
  const grp = new THREE.Group();
  const inner = new THREE.Mesh(bombInnerGeo, bombInnerMat.clone());
  const outer = new THREE.Mesh(bombOuterGeo, bombOuterMat.clone());
  const spikes = new THREE.Group();
  bombSpikeDirs.forEach(dir => {
    const spike = new THREE.Mesh(bombSpikeGeo, bombSpikeMat.clone());
    spike.quaternion.setFromUnitVectors(bombSpikeUp, dir);
    spike.position.copy(dir).multiplyScalar(BOMB_BLAST_INNER_R + bombSpikeLen * 0.5);
    spikes.add(spike);
  });
  grp.add(inner);
  grp.add(outer);
  grp.add(spikes);
  grp.visible = false;
  grp.userData.life = 0;
  grp.userData.inner = inner;
  grp.userData.outer = outer;
  grp.userData.spikes = spikes;
  grp.userData.innerOpacity = inner.material.opacity;
  grp.userData.outerOpacity = outer.material.opacity;
  grp.userData.spikeOpacity = bombSpikeMat.opacity;
  scene.add(grp);
  return grp;
};
for (let i = 0; i < 3; i++) {
  bombBlastFX.push(createBombBlast());
}


/* reticle geometry -- stays module-level */
const retGeo = new THREE.RingGeometry(3, 3.2, 8);          // slightly thicker
const retMat = new THREE.MeshBasicMaterial({
  color: 0x00ff7f,
  transparent: true,
  opacity: 1,
  side: THREE.DoubleSide
});
const reticle = new THREE.Mesh(retGeo, retMat);
reticle.visible = false;
scene.add(reticle);

const retLiteGeo = new THREE.RingGeometry(3.05, 3.15, 8);
const retLiteMat = new THREE.MeshBasicMaterial({
  color: 0x66ffb3,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide
});
const reticleLite = new THREE.Mesh(retLiteGeo, retLiteMat);
reticleLite.visible = false;
scene.add(reticleLite);
const retForward = new THREE.Vector3();
const retShipPos = new THREE.Vector3();
const retBillboardQ = new THREE.Quaternion();
const RETICLE_DISTANCE = 50;
const RETICLE_LITE_FACTOR = 2 / 3;
const RETICLE_OPACITY_CHARGE = 1;
const RETICLE_OPACITY_IDLE = 0.5;
const RETICLE_LITE_OPACITY_CHARGE = 0.6;
const RETICLE_LITE_OPACITY_IDLE = 0.3;
const LOCK_MAX_DIST = 60;
const LOCK_MAX_R2 = 16;
const forwardZ = new THREE.Vector3(0, 0, 1);
const fallbackForwardZ = new THREE.Vector3(0, 0, -1);
const homingForward = new THREE.Vector3();
const homingDesired = new THREE.Vector3();
const homingNew = new THREE.Vector3();
const lockVec = new THREE.Vector3();
const lockForward = new THREE.Vector3();
const lockOrigin = new THREE.Vector3();
const homingTargetPos = new THREE.Vector3();
const segDir = new THREE.Vector3();            // segment direction scratch
const segMin = new THREE.Vector3();
const segMax = new THREE.Vector3();
const segBox = new THREE.Box3();
const boxScratch = new THREE.Box3();
const tmpStaticPos = new THREE.Vector3();
let shotIdCounter = 1;
const nextShotId = () => shotIdCounter++;
let suppressShotEvents = false;
const getProjectileForwardOffset = (fromObject, radius) => {
  const noseOffset = fromObject?.userData?.chargeNoseOffsetZ;
  if (typeof noseOffset !== 'number') return CHARGE_FORWARD_OFFSET + CHARGE_FORWARD_TWEAK;
  return noseOffset + radius + CHARGE_NOSE_PAD + CHARGE_FORWARD_TWEAK;
};
function setProjectilePosition(fromObject, radius, out, forwardQuat) {
  if (!fromObject) return;
  const nosePoint = fromObject?.userData?.chargeNosePoint;
  const nosePad = typeof fromObject?.userData?.chargeNosePad === 'number'
    ? fromObject.userData.chargeNosePad
    : CHARGE_NOSE_PAD;
  const useQuat = forwardQuat ?? fromObject.quaternion;
  if (nosePoint && nosePoint.isVector3) {
    out.copy(nosePoint);
    fromObject.localToWorld(out);
    TMP_FORWARD.set(0, 0, 1).applyQuaternion(useQuat);
    out.addScaledVector(TMP_FORWARD, radius + nosePad + CHARGE_FORWARD_TWEAK);
    return;
  }
  fromObject.getWorldPosition(out);
  const forwardOffset = getProjectileForwardOffset(fromObject, radius);
  TMP_FORWARD.set(0, 0, forwardOffset).applyQuaternion(useQuat);
  out.add(TMP_FORWARD);
}

function getMuzzlePosition(fromObject, offX, out, forwardQuat) {
  if (!fromObject) return null;
  const useQuat = forwardQuat ?? fromObject.quaternion;
  const nosePoint = fromObject?.userData?.chargeNosePoint;
  if (nosePoint && nosePoint.isVector3) {
    out.copy(nosePoint);
    fromObject.localToWorld(out);
  } else {
    fromObject.getWorldPosition(out);
    const forwardOffset = getProjectileForwardOffset(fromObject, 0);
    TMP_FORWARD.set(0, 0, forwardOffset).applyQuaternion(useQuat);
    out.add(TMP_FORWARD);
  }
  TMP_FORWARD.set(0, 0, 1).applyQuaternion(useQuat);
  out.addScaledVector(TMP_FORWARD, -MUZZLE_BACK_OFFSET);
  if (offX !== 0) {
    TMP_SIDE.set(1, 0, 0).applyQuaternion(useQuat);
    out.addScaledVector(TMP_SIDE, offX);
  }
  return out;
}
function segmentHitsCollider(collider, mesh, prev, curr) {
  if (!collider || !mesh?.visible) return null;
  const aabb = collider.worldAABB;
  if (aabb) {
    segMin.set(Math.min(prev.x, curr.x), Math.min(prev.y, curr.y), Math.min(prev.z, curr.z));
    segMax.set(Math.max(prev.x, curr.x), Math.max(prev.y, curr.y), Math.max(prev.z, curr.z));
    segBox.min.copy(segMin);
    segBox.max.copy(segMax);
    if (!segBox.intersectsBox(aabb)) return null;   // coarse reject
  }
  segDir.copy(curr).sub(prev);
  const dist = segDir.length();
  if (dist < 1e-5) return null;
  segDir.multiplyScalar(1 / dist);
  const hit = collider.linecast(prev, segDir, dist);
  return hit.hit ? hit : null;
}

function stationLinecast(prev, curr) {
  return segmentHitsCollider(STATION_COLLIDER, STATION_MESH, prev, curr);
}

function stationIntersectsSphere(center, radius = 0.5) {
  if (!STATION_COLLIDER || !STATION_MESH?.visible) return false;
  const aabb = STATION_COLLIDER.worldAABB;
  const r = Math.max(radius, 0.25);
  if (aabb) {
    boxScratch.copy(aabb).expandByScalar(r);
    if (!boxScratch.containsPoint(center)) return false;
  }
  const result = STATION_COLLIDER.testSphere(center, r);
  return result.hit || STATION_COLLIDER.isPointInside(center);
}

function linecastStatic(prev, curr) {
  for (const col of PASSAGE_COLLIDERS) {
    if (!col) continue;
    const mesh = col.mesh ?? col.root ?? null;
    if (mesh) {
      if (!mesh.visible) continue;
      if (mesh.userData?.dead) continue;
      if (mesh.userData?.laserCollisionEnabled === false) continue;
      if (mesh.userData?.destructible && mesh.userData.destructible.hp <= 0) continue;
    }
    const aabb = col.worldAABB;
    let intersects = true;
    if (aabb) {
      segMin.set(Math.min(prev.x, curr.x), Math.min(prev.y, curr.y), Math.min(prev.z, curr.z));
      segMax.set(Math.max(prev.x, curr.x), Math.max(prev.y, curr.y), Math.max(prev.z, curr.z));
      segBox.min.copy(segMin); segBox.max.copy(segMax);
      intersects = segBox.intersectsBox(aabb);
    }
    if (!intersects) continue;
    segDir.copy(curr).sub(prev);
    const dist = segDir.length();
    if (dist > 1e-5) {
      segDir.multiplyScalar(1 / dist);
      const hit = col.linecast(prev, segDir, dist);
      if (hit.hit) {
        hit.collider = col;
        hit.mesh = col.mesh ?? col.root ?? null;
        return hit;
      }
    }
  }
  return null;
}

function applyStaticDamage(hit, projectile) {
  const mesh = hit?.mesh ?? hit?.collider?.mesh ?? null;
  const destructible = mesh?.userData?.destructible;
  if (!mesh?.visible || !destructible) return false;
  const dmg = projectile?.userData?.damage ?? 1;
  const currentHp = Number.isFinite(destructible.hp) ? destructible.hp : 0;
  const nextHp = currentHp - dmg;
  destructible.hp = nextHp;
  if (mesh.userData?.blink) mesh.userData.blink();
  if (nextHp > 0) return true;
  mesh.visible = false;
  mesh.userData.dead = true;
  mesh.userData.laserCollisionEnabled = false;
  if (typeof mesh.userData.onDestroyed === 'function') {
    const pos = mesh.getWorldPosition ? mesh.getWorldPosition(tmpStaticPos) : mesh.position;
    mesh.userData.onDestroyed(pos, mesh);
  }
  return true;
}

function findLockTarget(origin, forward) {
  if (!origin || !forward) return null;
  let bestR2 = Infinity;
  let candidate = null;
  const enemies = GET_ENEMY ? GET_ENEMY() : [];
  for (let i = 0; i < enemies.length; i++) {
    const f = enemies[i];
    if (!f?.visible) continue;
    const v = lockVec.copy(f.position).sub(origin);
    const l = -v.dot(forward);
    if (l < 0 || l > LOCK_MAX_DIST) continue;
    const r2 = v.lengthSq() - l * l;
    if (r2 < LOCK_MAX_R2 && r2 < bestR2) {
      bestR2 = r2;
      candidate = f;
    }
  }
  return candidate;
}

function applyHoming(mesh, target, blend = 0.10) {
  if (!mesh || !target || !target.visible) return;
  if (typeof target.getWorldPosition === 'function') {
    target.getWorldPosition(homingTargetPos);
  } else {
    homingTargetPos.copy(target.position);
  }
  const desired = homingDesired.copy(homingTargetPos).sub(mesh.position);
  if (desired.lengthSq() > 1e-6) {
    desired.normalize();
  } else {
    desired.copy(fallbackForwardZ);
  }
  const fwdNow = homingForward.set(0, 0, 1).applyQuaternion(mesh.quaternion);
  const newFwd = homingNew.copy(fwdNow).lerp(desired, blend);
  if (newFwd.lengthSq() > 1e-6) {
    newFwd.normalize();
  } else {
    newFwd.copy(fallbackForwardZ);
  }
  mesh.quaternion.setFromUnitVectors(forwardZ, newFwd);
}

  /* local state */
  let triggerHeld = false;
  let timer       = 0;
  let fireCount   = 0;          // how many normals since last release
  let charging    = false;      // true while holding the big shot
  let chargeT     = 0;          // timer while charging
  let chargeObj   = null;       // current sphere mesh
  let flown       = 0;          // range tracker after release
  let flightTime  = 0;
  let nextTarget  = null;
let lockedTarget = null;         // survives until cleared
let lockTimer    = 0;            // optional fade-out
const LOCK_FADE  = 1.0;          // seconds to keep the ring after loss
let fireMuted    = false;

const TIMER = { flown: 0, time: 0 };      // template object
const TMP_FORWARD = new THREE.Vector3();
const TMP_SIDE = new THREE.Vector3();
const SINGLE_OFFSETS = [0];
const DUAL_OFFSETS = [-1, 1];


  /* simple input hook */
  addEventListener('keydown', e => { if (e.code === 'Space') triggerHeld = true; });
  addEventListener('keyup', e => {
    if (e.code === 'Space') {
      triggerHeld = false;
     /* If the player released before charging began, forget the series */
     if (!charging) fireCount = 0;
    }
  });

function resetTriggerState() {
  triggerHeld = false;
  charging = false;
  fireCount = 0;
  chargeT = 0;
  if (chargeObj) {
    chargeObj.visible = false;
    chargeObj = null;
  }
  reticle.visible = false;
  reticleLite.visible = false;
  lockTimer = 0;
  if (lockedTarget) {
    lockedTarget.userData.lockRing &&
      (lockedTarget.userData.lockRing.visible = false);
    lockedTarget = null;
  }
  GET_ENEMY().forEach(f => {
    f.userData.lockRing && (f.userData.lockRing.visible = false);
  });
}

function spawn(fromObject){
  const offsets = dualMode ? DUAL_OFFSETS : SINGLE_OFFSETS;          // X-offsets in world units
  const shotId = nextShotId();
  let spawned = false;
  offsets.forEach(offX => {
    const m = pool.find(l => !l.visible);
    if (!m) return;                                 // pool exhausted

    fromObject.getWorldPosition(m.position);
    fromObject.getWorldQuaternion(m.quaternion);

    if (offX !== 0){
      TMP_SIDE.set(1, 0, 0).applyQuaternion(m.quaternion);
      m.position.addScaledVector(TMP_SIDE, offX);
    }
    m.userData.prev = (m.userData.prev || new THREE.Vector3()).copy(m.position);
    m.userData.damage = damageMult;
    m.userData.isBlue = blueMode;
    m.userData.shotId = shotId;
    m.visible        = true;
    m.userData.life  = life;
    spawned = true;

    if (fromObject) {
      const fxPos = getMuzzlePosition(fromObject, offX, tmp2, m.quaternion);
      if (fxPos) {
        (blueMode ? muzzleFxBlue : muzzleFxGreen).spawn(fxPos, MUZZLE_LIFE);
      }
    }
  });
  if (spawned && !suppressShotEvents) {
    onShotFired && onShotFired(shotId, 'laser');
  }
}

function fireAllyShot(fromObject, target) {
  if (!fromObject || !target) return false;
  const m = allyPool.find(l => !l.visible);
  if (!m) return false;

  setProjectilePosition(fromObject, LASER_RADIUS, m.position, fromObject.quaternion);
  tmpAllyDir.copy(target).sub(m.position);
  if (tmpAllyDir.lengthSq() < 1e-6) {
    tmpAllyDir.set(0, 0, 1);
  } else {
    tmpAllyDir.normalize();
  }
  tmpAllyQuat.setFromUnitVectors(forwardZ, tmpAllyDir);
  m.quaternion.copy(tmpAllyQuat);
  m.userData.prev = (m.userData.prev || new THREE.Vector3()).copy(m.position);
  m.userData.damage = 1;
  m.userData.isBlue = false;
  m.userData.shotId = null;
  m.userData.life = life;
  m.visible = true;

  const fxPos = getMuzzlePosition(fromObject, 0, tmp2, fromObject.quaternion);
  if (fxPos) {
    muzzleFxGreen.spawn(fxPos, MUZZLE_LIFE);
  }
  return true;
}

function spawnTinyImpact(pos, isBlue) {
  if (!pos) return;
  (isBlue ? muzzleFxBlue : muzzleFxGreen).spawn(pos, TINY_IMPACT_LIFE);
}


function spawnChargeSphere(fromObject){
  chargeObj = chargePool.find(c=>!c.visible); if(!chargeObj) return;
  fromObject.getWorldQuaternion(chargeObj.quaternion);
  const initialScale = 0.5;
  setProjectilePosition(
    fromObject,
    CHARGE_SCALE_MAX * initialScale,
    chargeObj.position,
    chargeObj.quaternion
  );
  chargeObj.scale.setScalar(initialScale);           // start small, grow while chargeT < CHARGE_TIME
  chargeObj.visible = true;
  chargeObj.userData.flown = 0;
  chargeObj.userData.time  = 0;
  chargeObj.userData.prev  = (chargeObj.userData.prev || new THREE.Vector3()).copy(chargeObj.position);
}

function fireBomb(fromObject) {
  if (!fromObject || fireMuted) return false;
  const bomb = bombPool.find(b => !b.visible);
  if (!bomb) return false;
  const shotId = nextShotId();
  fromObject.getWorldQuaternion(bomb.quaternion);
  setProjectilePosition(fromObject, BOMB_RADIUS, bomb.position, bomb.quaternion);
  bomb.visible = true;
  bomb.userData.flown = 0;
  bomb.userData.time = 0;
  bomb.userData.prev = (bomb.userData.prev || new THREE.Vector3()).copy(bomb.position);
  bomb.userData.shotId = shotId;
  bomb.userData.statHit = false;
  const locked = lockedTarget && lockedTarget.visible ? lockedTarget : null;
  if (locked) {
    bomb.userData.target = locked;
  } else {
    bomb.userData.target = null;
  }
  if (!suppressShotEvents) {
    onShotFired && onShotFired(shotId, 'bomb');
  }
  return true;
}

  /** call every frame */
  function update(dt, fromObject, { allowFire = true } = {}) {

  /* ensure world matrices are current for hit-tests */
  scene.updateMatrixWorld(false);

  /* update pooled charge blast FX */
  blastFX.forEach(fx => {
    if (!fx.visible) return;
    fx.userData.life -= dt;
    if (fx.userData.life <= 0) {
      fx.visible = false;
      return;
    }
    const t = 1 - (fx.userData.life / BLAST_LIFE);
    const s = THREE.MathUtils.lerp(BLAST_START_SCALE, 1, t);
    fx.scale.setScalar(s);
    const baseOp = fx.userData.baseOpacity ?? 0.5;
    setBlastOpacity(fx, baseOp * (fx.userData.life / BLAST_LIFE));
    if (CAMERA) fx.quaternion.copy(CAMERA.quaternion);
  });

  /* update bomb blast FX (damage-over-time) */
  bombBlastFX.forEach(fx => {
    if (!fx.visible) return;
    const prevLife = fx.userData.life ?? 0;
    if (prevLife <= 0) {
      fx.visible = false;
      return;
    }
    const dtApplied = Math.min(dt, prevLife);
    fx.userData.life = prevLife - dt;
    const t = 1 - (fx.userData.life / BOMB_BLAST_LIFE);
    const s = THREE.MathUtils.lerp(BOMB_BLAST_START_SCALE, 1, t);
    fx.scale.setScalar(s);
    const fade = fx.userData.life / BOMB_BLAST_LIFE;
    const inner = fx.userData.inner;
    const outer = fx.userData.outer;
    if (inner?.material) inner.material.opacity = fx.userData.innerOpacity * fade;
    if (outer?.material) outer.material.opacity = fx.userData.outerOpacity * fade;
    const spikes = fx.userData.spikes;
    if (spikes?.children?.length) {
      spikes.children.forEach(spike => {
        if (spike.material) spike.material.opacity = fx.userData.spikeOpacity * fade;
      });
    }
    if (dtApplied > 0) {
      const didHit = applyBombDamage(fx.position, dtApplied, fx.userData.hitTarget);
      if (didHit && fx.userData.shotId && !fx.userData.statHit) {
        fx.userData.statHit = true;
        onShotHit && onShotHit(fx.userData.shotId);
      }
    }
    if (fx.userData.life <= 0) {
      fx.visible = false;
    }
  });

  muzzleFxGreen.update(dt, CAMERA);
  muzzleFxBlue.update(dt, CAMERA);



  if (!allowFire) {
    triggerHeld = false;
    if (!fireMuted) {
      resetTriggerState();
      fireMuted = true;
    }
  } else if (fireMuted) {
    fireMuted = false;
  }

    /* handle input / cooldown */
    timer += dt;



  if (!charging && triggerHeld && timer >= cooldown) {
    spawn(fromObject);
    fireCount++;
    timer = 0;
    if (fireCount >= CHARGE_COUNT && triggerHeld) {           // start holding energy
      charging  = true;
      chargeT   = 0;
spawnChargeSphere(fromObject);
chargeObj.userData.target = lockedTarget;   // → use the persistent lock
    }
  }

  /* keep sphere glued to nose while charging */
  if (charging && triggerHeld && chargeObj){
    chargeT = Math.min(CHARGE_TIME, chargeT + dt);
    fromObject.getWorldQuaternion(chargeObj.quaternion);
    const s = THREE.MathUtils.lerp(CHARGE_SCALE_MIN,
                                   CHARGE_SCALE_MAX,
                                   chargeT / CHARGE_TIME);
    setProjectilePosition(
      fromObject,
      CHARGE_SCALE_MAX * s,
      chargeObj.position,
      chargeObj.quaternion
    );
    chargeObj.scale.setScalar(s);
  }

  /* release – fire the charged bolt  */
if (charging && !triggerHeld && chargeObj) {
  charging  = false;
  fireCount = 0;
  const shotId = nextShotId();
  chargeObj.userData.shotId = shotId;
  chargeObj.userData.statHit = false;
  if (!suppressShotEvents) {
    onShotFired && onShotFired(shotId, 'charge');
  }

  /* finalise homing target */
  chargeObj.userData.target = lockedTarget;

  /* OPTIONAL — drop the lock so the next volley starts clean */
  if (lockedTarget) {
lockedTarget.userData.lockRing &&
        (lockedTarget.userData.lockRing.visible = false);    lockedTarget = null;
  }
}

 /* ── reticle (always active while firing allowed) ─────────────── */
  if (fromObject) {
    /* player lasers travel along local +Z of the ship mesh */
    retForward.set(0, 0, 1);
    fromObject.getWorldDirection(retForward).negate(); // forward is independent

    fromObject.getWorldPosition(retShipPos);
    reticle.position.copy(retShipPos).addScaledVector(retForward, -RETICLE_DISTANCE);
    reticleLite.position
      .copy(retShipPos)
      .addScaledVector(retForward, -RETICLE_DISTANCE * RETICLE_LITE_FACTOR);

    retBillboardQ.setFromUnitVectors(forwardZ, retForward);
    reticle.quaternion.copy(retBillboardQ);
    reticleLite.quaternion.copy(retBillboardQ);

    retMat.opacity = charging ? RETICLE_OPACITY_CHARGE : RETICLE_OPACITY_IDLE;
    retLiteMat.opacity = charging ? RETICLE_LITE_OPACITY_CHARGE : RETICLE_LITE_OPACITY_IDLE;

    const reticleActive = allowFire && fromObject.visible !== false;
    reticle.visible = reticleActive;
    reticleLite.visible = reticleActive;
  }

 /* ── reticle & lock-on while charging ───────────────────── */
if (charging) {




  /* ----- pick & toggle target ----- */
/* ----- pick candidate under reticle ----- */
/* ----- pick candidate along beam (0-50 u) ----- */
nextTarget = null;
nextTarget = findLockTarget(retShipPos, retForward);


/* if we see a new candidate, make it the primary lock */
if (nextTarget) {
  lockedTarget = nextTarget;
  lockTimer    = 0;                   // reset fade timer
}

/* show the ring on the *locked* target, not the transient one */
GET_ENEMY().forEach(f => {
  if (f.userData.lockRing)
      f.userData.lockRing.visible = (f === lockedTarget);
});



}

else {                                   // <— not charging
  if (lockedTarget) {
    lockTimer += dt;
    const expired = lockTimer > LOCK_FADE || !lockedTarget.visible;

    /* show or hide the ring for EVERY fighter */
    GET_ENEMY().forEach(f => {
      f.userData.lockRing && (f.userData.lockRing.visible = false);
    });

    if (expired) lockedTarget = null;    // forget after fade
  } else {
    /* no lock at all — hide every ring */
    GET_ENEMY().forEach(f => {
      f.userData.lockRing && (f.userData.lockRing.visible = false);
    });
}}


/* ── update every active charge sphere ───────────────────── */
chargePool.forEach(s => {
  if (!s.visible) return;                     // slot unused

  /* keep the one on the nose fixed until released */
  if (charging && s === chargeObj) return;

  /* advance */
  tmpPrev.copy(s.position);
  s.userData.prev = (s.userData.prev || new THREE.Vector3()).copy(tmpPrev);
  s.translateZ(CHARGE_SPEED * dt);
  s.userData.flown += CHARGE_SPEED * dt;
  s.userData.time  += dt;
  let explodeNow = false;

  const hitStatic = linecastStatic(tmpPrev, s.position);
  if (hitStatic) {
    s.position.copy(hitStatic.point);
    explodeNow = true;
  }
  if (!explodeNow && STATION_COLLIDER) {
    const hit = stationLinecast(tmpPrev, s.position);
    if (hit) {
      s.position.copy(hit.point);
      explodeNow = true;
    } else if (stationIntersectsSphere(s.position, CHARGE_SCALE_MAX)) {
      explodeNow = true;
    }
  }

  /* impact checks without full scene traversal */
  let hitTarget = null;
  if (!explodeNow) {
    const enemies = GET_ENEMY ? GET_ENEMY() : [];
    for (let i = 0; i < enemies.length; i++) {
      const root = enemies[i];
      if (!root?.visible) continue;
      const chargeRadius = root.userData?.chargeRadius ?? root.userData?.hitRadius;
      const hitR2 = chargeRadius ? (chargeRadius * chargeRadius) : MIN_HIT_R2;
      if (root.getWorldPosition(tmp).distanceToSquared(s.position) < hitR2) {
        hitTarget = root;
        explodeNow = true;
        break;
      }
    }
  }

  if (!explodeNow && BOSS_MESH && BOSS_MESH.visible &&
      BOSS_MESH.position.distanceToSquared(s.position) < BOSS_R2) {
    explodeNow = true;
  }

applyHoming(s, s.userData.target, 0.10);



  /* range + timeout */
  if (s.userData.flown >= CHARGE_RANGE ||
      s.userData.time  >= MAX_FLIGHT_T)
    explodeNow = true;

  /* perform explosion */
  if (explodeNow) {
    explodeCharge(s.position, hitTarget, s.userData?.shotId ?? null);
    s.visible = false;               // frees this pool slot
  }
});

/* ── update every active bomb ───────────────────── */
bombPool.forEach(b => {
  if (!b.visible) return;
  if (!b.userData.target && lockedTarget && lockedTarget.visible && charging) {
    b.userData.target = lockedTarget;
  }

  tmpPrev.copy(b.position);
  b.userData.prev = (b.userData.prev || new THREE.Vector3()).copy(tmpPrev);
  b.translateZ(BOMB_SPEED * dt);
  b.userData.flown = (b.userData.flown ?? 0) + BOMB_SPEED * dt;
  b.userData.time = (b.userData.time ?? 0) + dt;
  let explodeNow = false;

  const hitStatic = linecastStatic(tmpPrev, b.position);
  if (hitStatic) {
    b.position.copy(hitStatic.point);
    explodeNow = true;
  }
  if (!explodeNow && STATION_COLLIDER) {
    const hit = stationLinecast(tmpPrev, b.position);
    if (hit) {
      b.position.copy(hit.point);
      explodeNow = true;
    } else if (stationIntersectsSphere(b.position, BOMB_RADIUS)) {
      explodeNow = true;
    }
  }

  let hitTarget = null;
  if (!explodeNow) {
    const enemies = GET_ENEMY ? GET_ENEMY() : [];
    for (let i = 0; i < enemies.length; i++) {
      const root = enemies[i];
      if (!root?.visible) continue;
      const bombRadius = root.userData?.chargeRadius ?? root.userData?.hitRadius;
      const hitR2 = bombRadius ? (bombRadius * bombRadius) : MIN_HIT_R2;
      if (root.getWorldPosition(tmp).distanceToSquared(b.position) < hitR2) {
        hitTarget = root;
        explodeNow = true;
        break;
      }
    }
  }

  if (!explodeNow && BOSS_MESH && BOSS_MESH.visible &&
      BOSS_MESH.position.distanceToSquared(b.position) < BOSS_R2) {
    explodeNow = true;
  }

  applyHoming(b, b.userData.target, 0.10);

  if (b.userData.flown >= BOMB_RANGE ||
      b.userData.time >= MAX_FLIGHT_T) {
    explodeNow = true;
  }

  if (explodeNow) {
    explodeBomb(b.position, hitTarget, b.userData?.shotId ?? null);
    b.visible = false;
  }
});



    /* move & cull */
    pool.forEach(l => {
      if (!l.visible) return;

      // remember start of step for segment collision
      tmpPrev.copy(l.position);
      l.userData.prev = (l.userData.prev || new THREE.Vector3()).copy(tmpPrev);

      l.translateZ(speed * dt);

      // collide with any static tunnel/asteroid set piece
      const hitStatic = linecastStatic(tmpPrev, l.position);
      if (hitStatic) {
        l.position.copy(hitStatic.point);
        const didHit = applyStaticDamage(hitStatic, l);
        if (didHit && l.userData?.shotId) {
          onShotHit && onShotHit(l.userData.shotId);
        }
        spawnTinyImpact(hitStatic.point, l.userData?.isBlue);
        l.visible = false;
      }

      l.userData.life -= dt;
      if (l.userData.life <= 0) l.visible = false;
    });

    allyPool.forEach(l => {
      if (!l.visible) return;

      tmpPrev.copy(l.position);
      l.userData.prev = (l.userData.prev || new THREE.Vector3()).copy(tmpPrev);

      l.translateZ(speed * dt);

      const hitStatic = linecastStatic(tmpPrev, l.position);
      if (hitStatic) {
        l.position.copy(hitStatic.point);
        applyStaticDamage(hitStatic, l);
        spawnTinyImpact(hitStatic.point, false);
        l.visible = false;
      }

      l.userData.life -= dt;
      if (l.userData.life <= 0) l.visible = false;
    });
  }


  /** returns an array of visible laser meshes */
  function getActive() {
    const active = pool.filter(l => l.visible);
    allyPool.forEach(l => { if (l.visible) active.push(l); });
    return active;
  }

  function awardEnemyKill(root) {
    if (!root) return;
    const shouldScore = !root.userData?.noScore;
    if (shouldScore) {
      const scoreValue = root.userData?.scoreValue ?? 100;
      addScore(scoreValue);
    }
    if (onEnemyKilled && root.getWorldPosition) {
      root.getWorldPosition(tmpKill);
      onEnemyKilled(tmpKill, root);
    }
  }

  /* hide whole fighter & flag it dead so its update loop stops */
  function killEnemy(root){
    if (!root || root.userData?.dead) return;
    root.visible       = false;
    root.userData.dead = true;
    if (root.userData.lockRing) root.userData.lockRing.visible = false;
    awardEnemyKill(root);
    /* optional: instantly hide its own lasers if you store them by owner */
  }



function explodeCharge(pos, hitTarget = null, shotId = null){
  let   bossHit = false;                 // ensure ≤1 HP per blast
  const innerR = BLAST_INNER_R;
  const outerR = BLAST_OUTER_R;
  const androssGroups = new Set();
  const isCriticalAndross = part => part === 'eyes' || part === 'palmL' || part === 'palmR';
  let didHit = false;

  const processed = new Set();   // keep fighters we've already damaged

  if (hitTarget?.userData?.androssPart && hitTarget?.userData?.damageFn) {
    const owner = hitTarget.userData.androssOwner ?? hitTarget;
    androssGroups.add(owner);
    const died = hitTarget.userData.damageFn(CHARGE_DAMAGE);
    hitTarget.userData.blink && hitTarget.userData.blink();
    if (died) awardEnemyKill(owner);
    didHit = true;
  }

  /* ---------- fighters (targeted list; avoid full-scene traverse) ---- */
  const enemies = GET_ENEMY ? GET_ENEMY() : [];
  for (let i = 0; i < enemies.length; i++) {
    const root = enemies[i];
    if (!root?.visible || !root.userData) continue;
    root.updateMatrixWorld?.(false);
    const blastR = root.userData?.blastRadius ?? innerR;
    const d2 = root.getWorldPosition(tmp).distanceToSquared(pos);
    if (d2 >= blastR * blastR) continue;

    if (root.userData.androssPart && root.userData.damageFn) {
      const owner = root.userData.androssOwner ?? root;
      if (androssGroups.has(owner)) continue;
      if (!hitTarget && isCriticalAndross(root.userData.androssPart)) continue;
      androssGroups.add(owner);
      const died = root.userData.damageFn(CHARGE_DAMAGE);
      root.userData.blink && root.userData.blink();
      if (died) awardEnemyKill(owner);
      didHit = true;
      continue;
    }

    if (processed.has(root)) continue;         // avoid double-hits on same fighter
    processed.add(root);

    root.userData.blink && root.userData.blink();

    /* start red flash for this spider (or any multi-HP enemy) */
    root.userData.flashT = 0.5;          // start timer
    // some enemies (e.g., pooled projectiles) may not expose meshes array
    if (root.userData.meshes?.forEach) {
      root.userData.meshes.forEach(m =>
        m.material.emissive.setRGB(1, 0, 0));
    }

    if (root.userData.hp > CHARGE_DAMAGE) {              // spider survives the blast
      root.userData.hp -= CHARGE_DAMAGE;                 // 3-laser damage
    } else {                                 // this blast kills it
      killEnemy(root);                       // remove fighter & +100 score
    }
    didHit = true;
  }

  /* ---------- boss (once) -------------------------------- */
  if (!bossHit && BOSS_MESH && BOSS_MESH.visible &&
      BOSS_MESH.position.distanceToSquared(pos) < BOSS_R2) {
    DAMAGE_BOSS(CHARGE_DAMAGE);                                    // single-laser dmg
    bossHit = true;
    didHit = true;
  }

  /* ---------- station ------------------------------------ */
  if (stationIntersectsSphere(pos, innerR)) {
    DAMAGE_STATION(CHARGE_DAMAGE);            // same 3-laser punch
    /* start red flash */
    STATION_MESH?.userData?.blink && STATION_MESH.userData.blink();
    didHit = true;
  }

  /* simple visual flash – pooled expanding transparent spheres */
  blastFX.forEach((fx, i) => {
    fx.visible = true;
    fx.position.copy(pos);
    fx.scale.setScalar(BLAST_START_SCALE);
    fx.userData.life = BLAST_LIFE;
    if (typeof fx.userData.baseOpacity !== 'number') {
      fx.userData.baseOpacity = 0.5;
    }
    setBlastOpacity(fx, fx.userData.baseOpacity);
  });
  if (didHit && shotId) {
    onShotHit && onShotHit(shotId);
  }
}

const bombDamageProcessed = new Set();
const bombAndrossGroups = new Set();
const isCriticalAndrossPart = part => part === 'eyes' || part === 'palmL' || part === 'palmR';

function applyBombDamageAmount(pos, amount, hitTarget = null) {
  if (!pos || amount <= 0) return false;
  let didHit = false;

  bombDamageProcessed.clear();
  bombAndrossGroups.clear();

  if (hitTarget?.userData?.androssPart && hitTarget.userData.damageFn) {
    const owner = hitTarget.userData.androssOwner ?? hitTarget;
    bombAndrossGroups.add(owner);
    const died = hitTarget.userData.damageFn(amount);
    hitTarget.userData.blink && hitTarget.userData.blink();
    if (died) awardEnemyKill(owner);
    didHit = true;
  }

  const enemies = GET_ENEMY ? GET_ENEMY() : [];
  for (let i = 0; i < enemies.length; i++) {
    const root = enemies[i];
    if (!root?.visible || !root.userData) continue;
    root.updateMatrixWorld?.(false);
    const blastR = root.userData?.blastRadius ?? BOMB_BLAST_INNER_R;
    const d2 = root.getWorldPosition(tmp).distanceToSquared(pos);
    if (d2 >= blastR * blastR) continue;

    if (root.userData.androssPart && root.userData.damageFn) {
      const owner = root.userData.androssOwner ?? root;
      if (bombAndrossGroups.has(owner)) continue;
      if (!hitTarget && isCriticalAndrossPart(root.userData.androssPart)) continue;
      bombAndrossGroups.add(owner);
      const died = root.userData.damageFn(amount);
      root.userData.blink && root.userData.blink();
      if (died) awardEnemyKill(owner);
      didHit = true;
      continue;
    }

    if (bombDamageProcessed.has(root)) continue;
    bombDamageProcessed.add(root);

    root.userData.blink && root.userData.blink();
    root.userData.flashT = 0.5;
    if (root.userData.meshes?.forEach) {
      root.userData.meshes.forEach(m =>
        m.material.emissive.setRGB(1, 0, 0));
    }

    const hp = root.userData.hp ?? 1;
    if (hp <= 1) {
      root.userData.hp = 0;
      killEnemy(root);
      continue;
    }
    const nextHp = hp - amount;
    root.userData.hp = nextHp;
    if (nextHp <= 0) {
      killEnemy(root);
    }
    didHit = true;
  }

  if (BOSS_MESH && BOSS_MESH.visible &&
      BOSS_MESH.position.distanceToSquared(pos) < BOSS_R2) {
    DAMAGE_BOSS(amount);
    didHit = true;
  }

  if (stationIntersectsSphere(pos, BOMB_BLAST_INNER_R)) {
    DAMAGE_STATION(amount);
    STATION_MESH?.userData?.blink && STATION_MESH.userData.blink();
    didHit = true;
  }
  return didHit;
}

function applyBombDamage(pos, dt, hitTarget = null) {
  if (!pos || dt <= 0) return false;
  const amount = BOMB_DPS * dt;
  if (amount <= 0) return false;
  return applyBombDamageAmount(pos, amount, hitTarget);
}

function explodeBomb(pos, hitTarget = null, shotId = null) {
  const fx = bombBlastFX.find(f => !f.visible);
  if (!fx) return;
  fx.visible = true;
  fx.position.copy(pos);
  fx.scale.setScalar(BOMB_BLAST_START_SCALE);
  fx.userData.life = BOMB_BLAST_LIFE;
  fx.userData.hitTarget = hitTarget;
  fx.userData.shotId = shotId;
  fx.userData.statHit = false;
  if (fx.userData.inner?.material) {
    fx.userData.inner.material.opacity = fx.userData.innerOpacity;
  }
  if (fx.userData.outer?.material) {
    fx.userData.outer.material.opacity = fx.userData.outerOpacity;
  }
  if (fx.userData.spikes?.children?.length) {
    fx.userData.spikes.children.forEach(spike => {
      if (spike.material) spike.material.opacity = fx.userData.spikeOpacity;
    });
  }
  const didImpact = applyBombDamageAmount(pos, BOMB_IMPACT_DAMAGE, hitTarget);
  if (didImpact && shotId && !fx.userData.statHit) {
    fx.userData.statHit = true;
    onShotHit && onShotHit(shotId);
  }
}


  function prewarm(renderer, cam = CAMERA) {
    const prevVis = pool.map(p => p.visible);
    const prevAlly = allyPool.map(p => p.visible);
    const prevCharge = chargePool.map(c => c.visible);
    const prevBomb = bombPool.map(b => b.visible);
    const prevBombFx = bombBlastFX.map(fx => fx.visible);
    const prevRet = reticle.visible;
    const prevRetLite = reticleLite.visible;
    pool.forEach(p => p.visible = true);
    allyPool.forEach(p => p.visible = true);
    chargePool.forEach(c => c.visible = true);
    bombPool.forEach(b => b.visible = true);
    reticle.visible = true;
    reticleLite.visible = true;
    blastFX.forEach(fx => fx.visible = true);
    bombBlastFX.forEach(fx => fx.visible = true);
    renderer.compile(scene, cam);
    const prevSize = renderer.getSize(new THREE.Vector2());
    renderer.setSize(64, 64, false);
    renderer.render(scene, cam);
    renderer.setSize(prevSize.x, prevSize.y, false);
    pool.forEach((p, i) => p.visible = prevVis[i]);
    allyPool.forEach((p, i) => p.visible = prevAlly[i]);
    chargePool.forEach((c, i) => c.visible = prevCharge[i]);
    bombPool.forEach((b, i) => b.visible = prevBomb[i]);
    reticle.visible = prevRet;
    reticleLite.visible = prevRetLite;
    blastFX.forEach(fx => { fx.visible = false; fx.userData.life = 0; });
    bombBlastFX.forEach((fx, i) => {
      fx.visible = prevBombFx[i];
      fx.userData.life = 0;
    });
    muzzleFxGreen.prewarm(renderer, cam);
    muzzleFxBlue.prewarm(renderer, cam);
  }

  function prewarmDual(fromObject) {
    if (!fromObject) return;
    const prevDual = dualMode;
    const prevBlue = blueMode;
    const prevVis = pool.map(p => p.visible);
    const prevLife = pool.map(p => p.userData.life);
    const prevDamage = pool.map(p => p.userData.damage);
    dualMode = true;
    suppressShotEvents = true;
    spawn(fromObject);
    suppressShotEvents = false;
    dualMode = prevDual;
    blueMode = prevBlue;
    pool.forEach((p, i) => {
      if (!prevVis[i] && p.visible) {
        p.visible = false;
        p.userData.life = prevLife[i] ?? 0;
        p.userData.damage = prevDamage[i];
      }
    });
  }

  function applyLaserMode() {
    const nextColor = blueMode ? BLUE_COLOR : BASE_COLOR;
    damageMult = blueMode ? 2 : 1;
    mat.color.setHex(nextColor);
    pool.forEach(p => {
      if (p.visible) p.userData.damage = damageMult;
    });
  }

  function enableBlue(flag = true) {
    blueMode = flag;
    applyLaserMode();
  }

  function resetUpgrades() {
    dualMode = false;
    blueMode = false;
    applyLaserMode();
  }

  return {
    update,
    getActive,
    enableDual: (flag = true) => { dualMode = flag; },
    enableBlue,
    resetUpgrades,
    isDual: () => dualMode,
    isBlue: () => blueMode,
    clearInput: resetTriggerState,
    fireAllyShot,
    fireBomb,
    prewarm,
    prewarmDual
  };

}
