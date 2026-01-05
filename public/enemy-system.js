import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

/* optional dev capture of live flight paths */
export const CAPTURED_ENEMY_PATHS = [];
const CAPTURE_ENABLED = false; // set to false to disable recording
const AVOIDANCE_ENABLED = false; // turn off obstacle avoidance entirely
const CAPTURE_SAMPLE_STEP = 1 / 30;   // seconds between recorded samples
const CAPTURE_BLOCKLIST = ['andross', 'frigate', 'station-boss', 'station-turret', 'spinner', 'platform'];

const _modelCache = new Map();
const sharedLoader = new GLTFLoader();
async function loadModelCached(path){
  if (_modelCache.has(path)) return _modelCache.get(path).clone(true);
  const gltf = await sharedLoader.loadAsync(path);
  _modelCache.set(path, gltf.scene);
  return gltf.scene.clone(true);
}

/**
 * initEnemySystem(scene, {
 *   spawnArray,                 // [{x,y,z}, …] from spawns.json
 *   playerObj,                  // mesh of the player ship
 *   railCurve,                  // CatmullRomCurve3
 *   playerSpeed,                // forward speed along rail (units/s)
 *   modelPath                   // defaults to ./models/dark1.glb
 *   hazardColliders             // optional static colliders to avoid
 *   hazardEntries               // optional static hazards for LOS checks
 *   canFire                     // optional predicate to gate firing
 * })
 *
 * Returns { update(dt) }
 */
export async function initEnemySystem(scene, {
  spawnArray,
  playerObj,
  railCurve,
  playerSpeed,
 boltPool = null,
  canFire  = null,
  modelPath = './models/dark1.glb',
  yaw       = 0,                    // ← NEW: apply extra Y-rotation (rad)
  fireDir   = -1,                    // +1 ⇒ shoot +Z; −1 ⇒ shoot −Z
  orbitRadius = 0,              // ← NEW: 0 ⇒ no cork-screw
  orbitRate   = 0,               //      (radians · s⁻¹)
  diagSpeed   = 0,                     // ← NEW
  diagVec     = null,                  // ← NEW (THREE.Vector3 or null)
  lateralAmp  = 0,   // NEW zig-zag side amplitude
  lateralHz   = 0,   // NEW zig-zag frequency  (cycles·s-¹)
  verticalAmp = 0,   // NEW up-down bob amplitude
  verticalHz  = 0,   // NEW bob frequency
  retreatDist = 50,
  despawnDelay = Infinity,
  behaviour   = {},          // ← NEW
  camera,
  dualGun     = false,          // NEW
  gunSpacing  = 0,
  fireInterval = 1.2,
  fireOffsetZ = 0,
  forwardAxis = null,
  burstCount = 0,
  burstInterval = 0,
  burstPause = 0,
  passLoop = false,
  passDuration = 6,
  passAhead = 120,
  passBehind = 20,
  passFireWindow = 80,
  orientToVelocity = false,
  orientToPlayerWhenFiring = false,
  glowOffset = null,
  hazardColliders = [],
  hazardEntries = null,
  bakedPaths = null,
  useBakedPaths = true,
  manualPoolSize = 0,
  materialMode = 'standard',
  editorGroup = null,



}) {

  let backpedal = false;


  /* merge behaviour-specific overrides ------------------------- */
  if (behaviour){
    if ('despawnDelay' in behaviour) despawnDelay = behaviour.despawnDelay;
    if ('yaw'         in behaviour) yaw         = behaviour.yaw;
    if ('fireDir'     in behaviour) fireDir     = behaviour.fireDir;
    if ('orbitRadius' in behaviour) orbitRadius = behaviour.orbitRadius;
    if ('orbitRate'   in behaviour) orbitRate   = behaviour.orbitRate;
    if ('diagSpeed'   in behaviour) diagSpeed   = behaviour.diagSpeed;
    if ('diagVec'     in behaviour) diagVec     = behaviour.diagVec;
    if ('lateralAmp'  in behaviour) lateralAmp  = behaviour.lateralAmp;
    if ('lateralHz'   in behaviour) lateralHz   = behaviour.lateralHz;
    if ('verticalAmp' in behaviour) verticalAmp = behaviour.verticalAmp;
    if ('verticalHz'  in behaviour) verticalHz  = behaviour.verticalHz;
    if ('dualGun'     in behaviour) dualGun     = behaviour.dualGun;
   if ('gunSpacing'  in behaviour) gunSpacing  = behaviour.gunSpacing;
    if ('fireInterval'in behaviour) fireInterval= behaviour.fireInterval;
    if ('fireOffsetZ' in behaviour) fireOffsetZ = behaviour.fireOffsetZ;
    if ('forwardAxis' in behaviour) forwardAxis = behaviour.forwardAxis;
    if ('burstCount'  in behaviour) burstCount  = behaviour.burstCount;
    if ('burstInterval' in behaviour) burstInterval = behaviour.burstInterval;
    if ('burstPause'  in behaviour) burstPause  = behaviour.burstPause;
    if ('passLoop'    in behaviour) passLoop    = behaviour.passLoop;
    if ('passDuration' in behaviour) passDuration = behaviour.passDuration;
    if ('passAhead'   in behaviour) passAhead   = behaviour.passAhead;
    if ('passBehind'  in behaviour) passBehind  = behaviour.passBehind;
    if ('passFireWindow' in behaviour) passFireWindow = behaviour.passFireWindow;
    if ('orientToVelocity' in behaviour) orientToVelocity = behaviour.orientToVelocity;
    if ('orientToPlayerWhenFiring' in behaviour) orientToPlayerWhenFiring = behaviour.orientToPlayerWhenFiring;
    if ('glowOffset'  in behaviour) glowOffset  = behaviour.glowOffset;
    if ('retreatDist' in behaviour) retreatDist = behaviour.retreatDist;
if (behaviour && 'backpedal' in behaviour) backpedal = behaviour.backpedal;

  }

  const spawnList = Array.isArray(spawnArray) ? spawnArray : [];
  if (spawnList.length === 0 && manualPoolSize <= 0) {
    return { update: () => {}, getActiveShips: () => [] };      // nothing to do
  }

  /* ---- load fighter once (cached across systems) ---- */
  const proto = await loadModelCached(modelPath);
  proto.scale.setScalar(5);
  const useLambert = materialMode === 'lambert';
    /* one-time quaternion that keeps the model’s nose correct             */
  const yawFixQ = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);   // 0 or π
  const forwardAxisNorm = (forwardAxis && forwardAxis.isVector3)
    ? forwardAxis.clone().normalize()
    : null;






  /* ---- shared bolt pool hookup (instanced) ---- */
  const LASER_SPEED = 160, LASER_LIFE = 1.2;
  const BOLT_POOL = boltPool ?? scene.userData?.boltPool ?? null;
  function getActiveLasers() { return []; }
  const useBurstFire = burstCount > 0 && burstInterval > 0;
  const losHazards = [];
  const tmpFireForward = new THREE.Vector3();
  const tmpBoltPos = new THREE.Vector3();
  const tmpBoltQuat = new THREE.Quaternion();
  const tmpFireQuat = new THREE.Quaternion();
  const tmpBoltUp = new THREE.Vector3();
  const tmpBoltBack = new THREE.Vector3();
  const tmpBoltRight = new THREE.Vector3();
  const tmpAxisZ = new THREE.Vector3(0, 0, 1);
  const tmpChaseOffset = new THREE.Vector3();
  const tmpChaseAim = new THREE.Vector3();
  const tmpLosDir = new THREE.Vector3();
  const tmpLosMin = new THREE.Vector3();
  const tmpLosMax = new THREE.Vector3();
  const tmpLosBox = new THREE.Box3();

  function addLosHazard(entry) {
    if (!entry) return;
    const mesh = entry.getMesh ? entry.getMesh() : entry.mesh ?? null;
    const collider = entry.collider ?? mesh?.userData?.collider ?? null;
    if (!mesh || !collider) return;
    losHazards.push({
      mesh,
      collider,
      laserCollisionEnabled: mesh.userData?.laserCollisionEnabled !== false,
      gateCylinder: mesh.userData?.gateCylinder ?? null
    });
  }

  const losEntries = Array.isArray(hazardEntries) ? hazardEntries : [];
  losEntries.forEach(addLosHazard);

  function segmentDistSq2D(cx, cz, a, b) {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const acx = cx - a.x;
    const acz = cz - a.z;
    const abLenSq = abx * abx + abz * abz;
    let t = 0;
    if (abLenSq > 1e-8) t = (acx * abx + acz * abz) / abLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = a.x + abx * t - cx;
    const dz = a.z + abz * t - cz;
    return dx * dx + dz * dz;
  }

  function hasLineOfSight(origin, target) {
    if (!losHazards.length) return true;
    tmpLosDir.copy(target).sub(origin);
    const dist = tmpLosDir.length();
    if (dist <= 1e-5) return true;
    tmpLosDir.multiplyScalar(1 / dist);
    tmpLosMin.set(
      Math.min(origin.x, target.x),
      Math.min(origin.y, target.y),
      Math.min(origin.z, target.z)
    );
    tmpLosMax.set(
      Math.max(origin.x, target.x),
      Math.max(origin.y, target.y),
      Math.max(origin.z, target.z)
    );
    tmpLosBox.set(tmpLosMin, tmpLosMax);
    for (let i = 0; i < losHazards.length; i++) {
      const h = losHazards[i];
      if (!h.mesh?.visible) continue;
      if (h.laserCollisionEnabled === false) continue;
      if (h.gateCylinder) {
        const gate = h.gateCylinder;
        const segMinY = Math.min(origin.y, target.y);
        const segMaxY = Math.max(origin.y, target.y);
        if (segMaxY < gate.minY || segMinY > gate.maxY) {
          continue;
        }
        const distSq = segmentDistSq2D(gate.x, gate.z, origin, target);
        if (distSq > gate.radius * gate.radius) {
          continue;
        }
      }
      if (h.collider?.worldAABB && !tmpLosBox.intersectsBox(h.collider.worldAABB)) {
        continue;
      }
      if (h.collider?.linecast) {
        const hit = h.collider.linecast(origin, tmpLosDir, dist);
        if (hit?.hit) return false;
      }
    }
    return true;
  }

function fireLaser(from) {
  if (!dualGun) {            // ─ single-barrel fighters (old path)
    spawnBolt(from, 0);
    return;
  }

  /* dual-gun: alternate left / right every 0.15 s */
  const side = from.userData.barrelSide;
  spawnBolt(from,  side * gunSpacing);
  from.userData.barrelSide = -side;     // toggle for next shot
}

function spawnBolt(from, offsetX) {
  if (!BOLT_POOL) return;
  const handle = BOLT_POOL.alloc({ big:false, life: LASER_LIFE, dir: fireDir, bounced: false });
  if (!handle) return;

  from.getWorldPosition(tmpBoltPos);
  from.getWorldQuaternion(tmpBoltQuat);
  let boltQuat = tmpBoltQuat;
  let forwardDir = null;
  const dirSign = fireDir >= 0 ? 1 : -1;
  if (forwardAxisNorm) {
    forwardDir = tmpFireForward.copy(forwardAxisNorm).applyQuaternion(tmpBoltQuat);
    tmpFireQuat.setFromUnitVectors(tmpAxisZ, forwardDir);
    boltQuat = tmpFireQuat;
  }

  /* Spider-turret needs its gun elevated; others don’t                */
  if (dualGun) {                                 // true only for spider
    tmpBoltUp.set(0, 1, 0).applyQuaternion(tmpBoltQuat);
    tmpBoltBack.set(0, 0, -1).applyQuaternion(tmpBoltQuat);
    tmpBoltPos.addScaledVector(tmpBoltUp,   1.8);   // turret height
    tmpBoltPos.addScaledVector(tmpBoltBack, 1.5);   // turret is aft
  }
  // Offset left or right for dual guns (if used)
  if (offsetX) {
    tmpBoltRight.set(1, 0, 0).applyQuaternion(tmpBoltQuat);
    tmpBoltPos.addScaledVector(tmpBoltRight, offsetX);
  }
  if (fireOffsetZ) {
    if (forwardAxisNorm) {
      tmpBoltPos.addScaledVector(forwardDir, fireOffsetZ * dirSign);
    } else {
      tmpFireForward.set(0, 0, 1).applyQuaternion(tmpBoltQuat);
      tmpBoltPos.addScaledVector(tmpFireForward, fireOffsetZ * dirSign);
    }
  }

  BOLT_POOL.setTransform(handle, tmpBoltPos, boltQuat);
}



/* ── lock-on visuals (shared across all fighters) ─────────── */
const lockGeo = new THREE.RingGeometry(1.6, 1.9, 4);  // a thin square
  const lockMat = new THREE.MeshBasicMaterial({
  color: 0x00ff7f, side: THREE.DoubleSide
});

  /* shared engine-glow geo/materials (lighter: basic + pre-baked gradient) */
  const glowGeo = new THREE.CircleGeometry(0.2, 12);
  glowGeo.scale(1.4, 0.85, 1);
  const glowCanvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(64, 64) : null);
  if (!glowCanvas) throw new Error('No canvas available for glow texture');
  glowCanvas.width = glowCanvas.height = 64;
  const gctx = glowCanvas.getContext('2d');
  const ggrad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  ggrad.addColorStop(0, 'rgba(255,255,255,1)');
  ggrad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  ggrad.addColorStop(1, 'rgba(255,255,255,0)');
  gctx.fillStyle = ggrad;
  gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const makeBasicGlow = (hex, opacity) => new THREE.MeshBasicMaterial({
    color: hex,
    map: glowTex,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const outerGlowMat = makeBasicGlow(0xff4422, 0.5);
  const innerGlowMat = makeBasicGlow(0xff9900, 0.6);

  /* per-model tuning for glow placement/size */
  const glowOffsetZ = modelPath.includes('blue1') ? 1.2 : -1.0; // blue1 faced opposite; place at back
  const defaultGlowOffset = new THREE.Vector3(0, 0, glowOffsetZ);
  const glowOffsetVec = (glowOffset && glowOffset.isVector3)
    ? glowOffset.clone()
    : defaultGlowOffset;
  const innerGlowOffset = glowOffsetVec.clone();
  if (innerGlowOffset.lengthSq() > 1e-6) {
    const offsetDir = glowOffsetVec.clone().normalize();
    innerGlowOffset.addScaledVector(offsetDir, -0.01);
  } else {
    innerGlowOffset.z -= 0.01;
  }
  const baseScale = modelPath.includes('dark1') ? 2 : 1;
  const globalScale = modelPath.includes('dark1') ? 1.5 : 3.0; // dark1 unchanged; others doubled again
  const glowScaleMult = baseScale * globalScale;


  /* ---- enemy instances ---- */
  const ACTIVE = [];
  const ACTIVE_SHIPS = [];
  const spawnQueue = spawnList.map((cfg, idx) => ({
    ...cfg,
    __spawnIdx: idx,
    __src: cfg,
    spawned: false
  }));
  const bakedPathLookup = (useBakedPaths && bakedPaths instanceof Map) ? bakedPaths : new Map();

  /* Build all enemy meshes up-front so spawning is just a state reset.
     This avoids runtime GLTF cloning/material cloning hitches. */
  function createShipInstance() {
    const ship = proto.clone(true);
    ship.visible = false;
    ship.userData = {
      enemy     : true,
      enemyRoot : true,
      flashT    : 0
    };

    /* gather meshes + unique materials for local emissive flash */
    const meshes = [];
    ship.traverse(n => {
      if (n.isMesh) {
        n.material = useLambert ? toLambert(n.material) : n.material.clone();
        n.userData.enemy = true;
        n.frustumCulled = false; // ensure warmup renders even if off-screen
        meshes.push(n);
      }
    });
    ship.userData.meshes = meshes;
    ship.userData.blink  = () => { ship.userData.flashT = 0.15; };

    /* add hidden lock-on ring */
    const ring = new THREE.Mesh(lockGeo, lockMat.clone());
    ring.visible = false;
    ship.add(ring);
    ship.userData.lockRing = ring;

    /* attach compact red/orange engine glow */
    const outerGlow = new THREE.Mesh(glowGeo, outerGlowMat);
    outerGlow.position.copy(glowOffsetVec);
    outerGlow.scale.multiplyScalar(glowScaleMult);
    const innerGlow = new THREE.Mesh(glowGeo, innerGlowMat);
    innerGlow.scale.set(0.6 * glowScaleMult, 0.6 * glowScaleMult, 0.6 * glowScaleMult);
    innerGlow.position.copy(innerGlowOffset);
    // let normal frustum culling discard them when off-screen
    ship.add(outerGlow);
    ship.add(innerGlow);

    scene.add(ship);
    return ship;
  }

  const shipPool = spawnQueue.map(() => {
    const ship = createShipInstance();
    ACTIVE.push(ship);
    return ship;
  });
  spawnQueue.forEach((cfg, i) => { cfg.ship = shipPool[i]; });
  const manualPool = [];
  for (let i = 0; i < manualPoolSize; i++) {
    const ship = createShipInstance();
    ship.userData.manual = true;
    ship.userData.dead = true;
    ship.visible = false;
    manualPool.push(ship);
    ACTIVE.push(ship);
  }
  const allShips = manualPool.length ? shipPool.concat(manualPool) : shipPool;
  const SPAWN_RADIUS = behaviour.spawnRadius ?? 200;
  const SPAWN_RADIUS_SQ = SPAWN_RADIUS * SPAWN_RADIUS;
  const BUCKET_SIZE = behaviour.spawnBucketSize ?? (SPAWN_RADIUS * 2); // coarse Z buckets
  const spawnBuckets = new Map(); // key -> [cfg,...]
  const bucketKey = (z) => Math.floor((z ?? 0) / BUCKET_SIZE);
  spawnQueue.forEach(cfg => {
    const k = bucketKey(cfg.z);
    if (!spawnBuckets.has(k)) spawnBuckets.set(k, []);
    spawnBuckets.get(k).push(cfg);
  });

  function resetShipState(ship, cfg) {
    const baked = bakedPathLookup.get(cfg.__spawnIdx) ?? null;

    ship.visible          = true;
    ship.userData.dead    = false;
    ship.userData.fireT   = 0;
    ship.userData.barrelSide = 1;
    ship.userData.phi     = 0;
    ship.userData.ttl     = despawnDelay;
    ship.userData.hp      = behaviour.hp ?? 1;
    ship.userData.flashT  = 0;
    ship.userData.dropHealRing = Boolean(cfg.dropHealRing);
    ship.userData.burstRemaining = burstCount;
    ship.userData.burstCooldown = 0;
    ship.userData.burstShotT = 0;
    ship.userData.passT = Math.random() * passDuration;
    ship.userData.passFireReady = true;
    ship.userData.lockRing.visible = false;
    ship.position.set(cfg.x, cfg.y, cfg.z);
    ship.userData.collided = false;
    ship.userData.state   = baked ? 'path' : 'approach';
    ship.userData.retreatZ = null;
    if (cfg.__src) {
      ship.userData.editorRef = cfg.__src;
      ship.userData.editorGroup = editorGroup;
      ship.userData.editorIndex = cfg.__spawnIdx;
    }
    if (baked) {
      ship.userData.bakedPath = {
        samples : baked.samples,
        duration: baked.duration ?? (baked.samples?.length ? baked.samples[baked.samples.length - 1].t : 0),
        t       : 0,
        idx     : 0
      };
    } else {
      ship.userData.bakedPath = null;
    }

    if (CAPTURE_ACTIVE) {
      ship.userData.pathLog      = [];
      ship.userData.captureT     = 0;
      ship.userData.captureAcc   = 0;
      ship.userData.spawnIdx     = cfg.__spawnIdx ?? null;
      ship.userData.spawnPoint   = { x: cfg.x, y: cfg.y, z: cfg.z };
      ship.userData.pathLogged   = false;
      ship.userData.finishPath   = (reason) => finalizeCapture(ship, reason);
    } else {
      ship.userData.pathLog    = null;
      ship.userData.captureT   = 0;
      ship.userData.captureAcc = 0;
      ship.userData.spawnIdx   = cfg.__spawnIdx ?? null;
      ship.userData.spawnPoint = { x: cfg.x, y: cfg.y, z: cfg.z };
      ship.userData.pathLogged = true;
      ship.userData.finishPath = null;
    }
  }

  function materializeSpawns() {
    spawnQueue.forEach(cfg => {
      resetShipState(cfg.ship, cfg);
    });
    return spawnQueue.map(cfg => cfg.ship);
  }

  function getActiveShips()  { return ACTIVE_SHIPS; }
  function getActiveLasers() { return []; }

  /* quick helpers */
  const tmp = new THREE.Vector3();
  const playerPos = new THREE.Vector3();
  const tmpTargetPos = new THREE.Vector3();
  const tmpChaseDir = new THREE.Vector3();
  const railDir   = new THREE.Vector3();
  const tmpRight  = new THREE.Vector3();
  const tmpUp     = new THREE.Vector3();
  const tmpBack   = new THREE.Vector3();
  const tmpPrevPos = new THREE.Vector3();
  const tmpAvoid   = new THREE.Vector3();
  const tmpAhead   = new THREE.Vector3();
  const tmpVel     = new THREE.Vector3();
  const tmpRearDir = new THREE.Vector3();
  const tmpSphere  = new THREE.Sphere();
  const tmpDir     = new THREE.Vector3();
  const tmpFaceQuat = new THREE.Quaternion();
  const tmpLosOrigin = new THREE.Vector3();

  const CULL_Z_BEHIND = 20;   // units the player may outrun a fighter
  const AVOID_RADIUS_PAD   = 1.5;   // extra padding beyond hit radius
  const AVOID_LOOKAHEAD    = 100;    // how far ahead to probe for hazards
  const AVOID_MAX_PUSH     = 20;    // clamp avoidance velocity (u/s)
  const AVOID_REAR_LOOKAHEAD = 0.5;  // extra buffer for set pieces behind (negative Z)
  const AVOID_REAR_PAD = 1.5;       // extra radius padding when moving backward
  const AVOID_REAR_PUSH = 5.5;      // gentle push away from rear hazards
  const AVOID_RETURN_SPEED = Math.max(20, playerSpeed * 2.0); // nudge back to desired distance

  const CAMERA = camera;
  const CAPTURE_ACTIVE = CAPTURE_ENABLED &&
    !CAPTURE_BLOCKLIST.some(key => modelPath.includes(key));

  function finalizeCapture(ship, reason = 'ok') {
    if (!CAPTURE_ACTIVE) return;
    const ud = ship?.userData;
    if (!ud?.pathLog || ud.pathLogged) return;
    ud.pathLogged = true;
    if (ud.pathLog.length === 0) return;
    CAPTURED_ENEMY_PATHS.push({
      spawnIdx : ud.spawnIdx ?? null,
      spawn    : ud.spawnPoint ?? null,
      model    : modelPath,
      collided : Boolean(ud.collided || reason === 'collision'),
      reason   : reason,
      samples  : ud.pathLog.slice()
    });
  }

  function applyHazardAvoidance(ship, prevPos, dt) {
    if (!AVOIDANCE_ENABLED) return;
    if (!hazardColliders?.length || dt <= 0) return;
    tmpVel.copy(ship.position).sub(prevPos);
    if (tmpVel.lengthSq() < 1e-5) {
      tmpVel.copy(playerPos).sub(ship.position);
      if (tmpVel.lengthSq() < 1e-5) tmpVel.set(0, 0, -1);
    }
    tmpVel.normalize();
    const movingBack = tmpVel.z < -0.2;
    const lookAhead = movingBack ? AVOID_LOOKAHEAD * 1.6 : AVOID_LOOKAHEAD;
    const hitR = (ship.userData?.hitRadius ?? 3) + AVOID_RADIUS_PAD + (movingBack ? AVOID_REAR_PAD : 0);
    const coarseR = hitR + lookAhead * 0.5;
    tmpAvoid.set(0, 0, 0);
    let avoidActive = false;

    for (let i = 0; i < hazardColliders.length; i++) {
      const col = hazardColliders[i];
      if (!col?.testSphere) continue;
      if (col.worldAABB &&
          !col.worldAABB.intersectsSphere(tmpSphere.set(ship.position, coarseR))) {
        continue;
      }

      /* immediate overlap → push out along the surface normal */
      const overlap = col.testSphere(ship.position, hitR);
      if (overlap.hit) {
        ship.userData.collided = true;
        avoidActive = true;
        tmpAvoid.addScaledVector(overlap.normal, overlap.depth + 0.5);
        continue;
      }

      /* look ahead in current travel direction to bias around obstacles */
      const ahead = tmpAhead.copy(ship.position).addScaledVector(tmpVel, lookAhead);
      const aheadProbe = col.testSphere(ahead, hitR);
      if (aheadProbe.hit) {
        const dist = ship.position.distanceTo(ahead);
        const gain = Math.max(0.35, 1 - dist / (lookAhead + 1e-3));
        avoidActive = true;
        tmpAvoid.addScaledVector(aheadProbe.normal, gain * 4);
      }

      if (movingBack && col.worldAABB && col.worldAABB.max.z < ship.position.z) {
        const rearGap = ship.position.z - col.worldAABB.max.z;
        if (rearGap < AVOID_REAR_LOOKAHEAD) {
          const rearGain = Math.max(0.15, 1 - rearGap / (AVOID_REAR_LOOKAHEAD + 1e-3));
          tmpRearDir.set(0, 0, 1);
          avoidActive = true;
          tmpAvoid.addScaledVector(tmpRearDir, rearGain * AVOID_REAR_PUSH);
        }
      }
    }

    if (avoidActive && ship.userData?.state === 'retreat') {
      const desiredZ = playerPos.z + (typeof ship.userData.retreatZ === 'number'
        ? ship.userData.retreatZ
        : -retreatDist);
      const diffZ = desiredZ - ship.position.z;
      if (diffZ < -0.1) {
        tmpAvoid.z += Math.max(diffZ, -AVOID_RETURN_SPEED * dt);
      }
    }

    const len = tmpAvoid.length();
    if (len > 1e-4) {
      const maxStep = AVOID_MAX_PUSH * dt;
      tmpAvoid.multiplyScalar(Math.min(1, maxStep / len));
      ship.position.add(tmpAvoid);
    }
  }


  function update(dt, tPlayer) {
    const allowFire = typeof canFire === 'function' ? canFire() : true;
    playerObj.getWorldPosition(playerPos);

    /* 1. spawn check (nearby Z buckets) */
    let spawnedThisFrame = 0;
    const MAX_SPAWN_PER_FRAME = 3;
    const centerKey = bucketKey(playerPos.z);
    const keys = [centerKey - 1, centerKey, centerKey + 1];
    for (let kIdx = 0; kIdx < keys.length; kIdx++) {
      const list = spawnBuckets.get(keys[kIdx]);
      if (!list || !list.length) continue;
      for (let i = list.length - 1; i >= 0 && spawnedThisFrame < MAX_SPAWN_PER_FRAME; i--) {
        const cfg = list[i];
        if (cfg.spawned) { list.splice(i, 1); continue; }
        const ship = cfg.ship;
        if (!ship) { list.splice(i, 1); continue; }
        tmp.set(cfg.x, cfg.y, cfg.z);
        if (tmp.distanceToSquared(playerPos) < SPAWN_RADIUS_SQ) {
          resetShipState(ship, cfg);
          cfg.spawned = true;
          spawnedThisFrame++;
          list.splice(i, 1);
        }
      }
      if (!list.length) spawnBuckets.delete(keys[kIdx]);
      if (spawnedThisFrame >= MAX_SPAWN_PER_FRAME) break;
    }



    /* 2. per-enemy logic */
    ACTIVE_SHIPS.length = 0;
    ACTIVE.forEach(e => {
       if (CAPTURE_ACTIVE && e.userData?.dead && e.userData.pathLog && !e.userData.pathLogged) {
         finalizeCapture(e, 'dead');
       }
       if (!e.visible || e.userData.dead) return;   // ← ignore destroyed ships
      ACTIVE_SHIPS.push(e);

      tmpPrevPos.copy(e.position);

      e.userData.fireT += dt;

      /* aim, then restore model’s correct nose direction */
      let usedBakedPath = false;
      const chaseTarget = e.userData?.chaseTarget ?? null;
      const chaseOffset = e.userData?.chaseOffset ?? null;
      const chaseOffsetMode = e.userData?.chaseOffsetMode ?? 'local';
      const chaseMinDist = e.userData?.chaseMinDist ?? 0;
      let chaseActive = false;
      if (e.userData?.state === 'chase') {
        if (chaseTarget && chaseTarget.visible) {
          chaseActive = true;
          chaseTarget.getWorldPosition(tmpTargetPos);
          tmpChaseAim.copy(tmpTargetPos);
          if (chaseOffset) {
            tmpChaseOffset.copy(chaseOffset);
            if (chaseOffsetMode !== 'world' && chaseTarget.quaternion) {
              tmpChaseOffset.applyQuaternion(chaseTarget.quaternion);
            }
            tmpTargetPos.add(tmpChaseOffset);
          }
        } else {
          e.userData.state = 'retreat';
          e.userData.chaseTarget = null;
        }
      }
      const targetPos = chaseActive ? tmpTargetPos : playerPos;
      const aimPos = chaseActive ? tmpChaseAim : targetPos;
      if (chaseActive) {
        usedBakedPath = true;
        tmpChaseDir.copy(targetPos).sub(e.position);
        const dist = tmpChaseDir.length();
        if (dist > 1e-4) {
          tmpChaseDir.multiplyScalar(1 / dist);
          const chaseSpeed = e.userData.chaseSpeed ?? (playerSpeed * 1.1);
          const step = Math.min(chaseSpeed * dt, Math.max(0, dist - chaseMinDist));
          if (step > 0) e.position.addScaledVector(tmpChaseDir, step);
        }
      }
      const baked = e.userData.bakedPath;
      if (!chaseActive && baked && baked.samples?.length) {
        usedBakedPath = true;
        baked.t = Math.min(baked.t + dt, baked.duration);
        const s = baked.samples;
        while (baked.idx < s.length - 2 && s[baked.idx + 1].t < baked.t) baked.idx++;
        const a = s[baked.idx];
        const b = s[Math.min(baked.idx + 1, s.length - 1)];
        const span = Math.max(1e-4, b.t - a.t);
        const alpha = THREE.MathUtils.clamp((baked.t - a.t) / span, 0, 1);
        e.position.set(
          THREE.MathUtils.lerp(a.pos[0], b.pos[0], alpha),
          THREE.MathUtils.lerp(a.pos[1], b.pos[1], alpha),
          THREE.MathUtils.lerp(a.pos[2], b.pos[2], alpha)
        );
        if (baked.t >= baked.duration - 1e-3) {
          // finished baked path; fall back to default behaviour
          e.userData.bakedPath = null;
          e.userData.state = 'retreat';
          e.userData.retreatZ = e.position.z - playerPos.z;
        }
      }

      let passLoopActive = false;
      if (!usedBakedPath && passLoop) {
        passLoopActive = true;
        e.userData.passT += dt;
        if (passDuration > 0) {
          e.userData.passT %= passDuration;
        }
        const phase = passDuration > 0
          ? (e.userData.passT / passDuration) * Math.PI * 2
          : e.userData.passT;
        railCurve.getTangentAt(tPlayer, railDir).normalize();
        tmpRight.copy(railDir).cross(tmpUp.set(0,1,0)).normalize();
        const up = tmpUp.crossVectors(tmpRight, railDir).normalize();
        const zUnit = Math.sin(phase);
        const zOffset = ((zUnit + 1) * 0.5) * (passAhead + passBehind) - passBehind;
        const xOffset = Math.cos(phase) * lateralAmp;
        const yOffset = Math.sin(phase * 0.5) * verticalAmp;
        e.position.copy(playerPos)
          .addScaledVector(railDir, zOffset)
          .addScaledVector(tmpRight, xOffset)
          .addScaledVector(up, yOffset);
        e.userData.passZOffset = zOffset;
        e.userData.passFireReady = Math.abs(zOffset) <= passFireWindow;
      } else if (!usedBakedPath && e.userData.state === 'approach') {
        /* fly toward player until within 50 u  (axis-independent) */
        tmp.copy(playerPos).sub(e.position).normalize();  // vector TO player
        e.position.addScaledVector(tmp, 20 * dt);         // 20 u s⁻¹
        if (e.position.distanceToSquared(playerPos) < retreatDist * retreatDist) {
          e.userData.state = 'retreat';
          /* figure out rail direction at player t to mirror speed */
          railCurve.getTangentAt(tPlayer, railDir).normalize();
          e.userData.retreatZ = e.position.z - playerPos.z;
        }
      } else if (!usedBakedPath) { /* retreat */
        e.position.addScaledVector(railDir, playerSpeed * dt);

        // Special case: spider turret style → jitter back now and then
if (backpedal && Math.random() < 0.2 * dt) {
  tmpBack.copy(railDir).multiplyScalar(-20 * dt);
  e.position.add(tmpBack);
}





       /* ---------- optional diagonal drive-by ---------------- */
        if (diagSpeed && diagVec) {
          e.position.addScaledVector(diagVec, diagSpeed * dt);
        }

/* ── optional cork-screw (blue squadron only) ────────── */
        if (orbitRadius > 0 && orbitRate !== 0) {
          e.userData.phi += orbitRate * dt;

          /* build a local side/up frame perpendicular to railDir */
          const right = tmpRight.copy(railDir).cross(tmpUp.set(0,1,0)).normalize();
          const up    = tmpUp.crossVectors(right, railDir).normalize();

          /* velocity needed for circular motion of radius R */
          const vLat = right.multiplyScalar(-Math.sin(e.userData.phi))
                            .add(  up.multiplyScalar( Math.cos(e.userData.phi)))
                            .multiplyScalar(orbitRadius * orbitRate);

          e.position.addScaledVector(vLat, dt);
        }

                /* ── optional LATERAL zig-zag (uses right vector) ─────── */
        if (lateralAmp && lateralHz) {
          e.userData.phi += lateralHz * 2*Math.PI * dt;
          tmpRight.copy(railDir).cross(tmpUp.set(0,1,0)).normalize();
          e.position.addScaledVector(tmpRight,
            Math.cos(e.userData.phi) * lateralAmp * dt);   // velocity style
        }

        /* ── optional vertical bob (uses up vector) ───────────── */
        if (verticalAmp && verticalHz) {
          e.userData.phi += verticalHz * 2*Math.PI * dt;
          tmpUp.set(0,1,0);
          e.position.addScaledVector(tmpUp,
            Math.sin(e.userData.phi) * verticalAmp * dt);
        }

      }

      const useForwardAxis = Boolean(forwardAxisNorm);
      let facePlayer = true;
      let movingToward = true;
      if (passLoopActive) {
        tmpVel.copy(e.position).sub(tmpPrevPos);
        if (tmpVel.lengthSq() > 1e-6) {
          tmpVel.normalize();
          tmpDir.copy(targetPos).sub(e.position);
          if (tmpDir.lengthSq() > 1e-6) {
            tmpDir.normalize();
            movingToward = tmpVel.dot(tmpDir) > 0;
          }
        }
        const zOffset = typeof e.userData.passZOffset === 'number'
          ? e.userData.passZOffset
          : 0;
        e.userData.passFireReady = movingToward && Math.abs(zOffset) <= passFireWindow;
      }
      if (passLoopActive && (orientToVelocity || orientToPlayerWhenFiring)) {
        if (orientToPlayerWhenFiring && e.userData.passFireReady && movingToward) {
          facePlayer = true;
        } else if (orientToVelocity) {
          if (tmpVel.lengthSq() > 1e-6) {
            if (useForwardAxis) {
              tmpFaceQuat.setFromUnitVectors(forwardAxisNorm, tmpVel);
              e.quaternion.copy(tmpFaceQuat);
            } else {
              tmp.copy(e.position).add(tmpVel);
              e.lookAt(tmp);
            }
            facePlayer = false;
          }
        }
      }
      if (facePlayer) {
        if (useForwardAxis) {
          tmpDir.copy(aimPos).sub(e.position);
          if (tmpDir.lengthSq() > 1e-6) {
            tmpDir.normalize();
            tmpFaceQuat.setFromUnitVectors(forwardAxisNorm, tmpDir);
            e.quaternion.copy(tmpFaceQuat);
          }
        } else {
          e.lookAt(aimPos);
        }
      }
      if (!useForwardAxis) {
        e.quaternion.multiply(yawFixQ);      // ← keep nose forward
      }

      if (!passLoopActive) {
        applyHazardAvoidance(e, tmpPrevPos, dt);
      }

      if (CAPTURE_ACTIVE && e.userData.pathLog) {
        e.userData.captureT   += dt;
        e.userData.captureAcc += dt;
        if (e.userData.captureAcc >= CAPTURE_SAMPLE_STEP) {
          e.userData.captureAcc -= CAPTURE_SAMPLE_STEP;
          const pos = e.position;
          e.userData.pathLog.push({
            t  : e.userData.captureT,
            pos: [pos.x, pos.y, pos.z]
          });
        }
      }

/* --- 1-D cull (only behind-player check) ------------------- */
if (!e.userData?.noCullBehind && e.position.z > playerPos.z + CULL_Z_BEHIND) {
if (CAPTURE_ACTIVE && e.userData.pathLog && !e.userData.pathLogged) {
    finalizeCapture(e, 'cull');
  }
  e.visible       = false;   // no render, no firing
  e.userData.dead = true;    // collisions skip
  return;                    // stop updating this fighter
}


/* ---------- life-timer ------------------------------------- */
if (e.userData.ttl !== Infinity) {
  e.userData.ttl -= dt;
  if (e.userData.ttl <= 0) {
    if (CAPTURE_ACTIVE && e.userData.pathLog && !e.userData.pathLogged) {
      finalizeCapture(e, 'ttl');
    }
    /* shift fighter just past the cull gate so next frame it disappears */
    e.position.z = playerPos.z + CULL_Z_BEHIND + 1;
  }
}

 /*  ── keep lock-ring facing the camera ───────────────────── */
if (e.userData.lockRing.visible && CAMERA) {
  e.userData.lockRing.quaternion.copy(CAMERA.quaternion); // ← full billboard
}

 /* firing */
 const allowFireNow = allowFire && (!passLoop || e.userData.passFireReady);
 if (allowFireNow) {
   if (useBurstFire) {
     if (e.userData.burstCooldown > 0) {
       e.userData.burstCooldown -= dt;
     } else {
       e.userData.burstShotT += dt;
       if (e.userData.burstShotT >= burstInterval) {
         tmpLosOrigin.copy(e.position);
         const hasLOS = hasLineOfSight(tmpLosOrigin, aimPos);
         if (hasLOS) {
           fireLaser(e);
           e.userData.burstShotT = 0;
           e.userData.burstRemaining -= 1;
           if (e.userData.burstRemaining <= 0) {
             e.userData.burstCooldown = burstPause;
             e.userData.burstRemaining = burstCount;
           }
         } else {
           e.userData.burstShotT = burstInterval;
         }
       }
     }
   } else if (e.userData.fireT >= fireInterval) {
     tmpLosOrigin.copy(e.position);
     const hasLOS = hasLineOfSight(tmpLosOrigin, aimPos);
     if (hasLOS) {
       fireLaser(e);
       e.userData.fireT = 0;
     } else {
       e.userData.fireT = fireInterval;
     }
   }
 }



if (e.userData.needsFlash) {
     e.userData.flashT   = 0.15;       // start 150 ms blink
     delete e.userData.needsFlash;     // consume the flag
 }

/* ── red-flash blink (simple) ─────────────────────────────── */
const flashing = e.userData.flashT > 0;

if (flashing) {
  e.userData.flashT = Math.max(0, e.userData.flashT - dt);
}

/* paint red while flashing, otherwise black */
const r = flashing ? 1 : 0;
e.userData.meshes.forEach(m => m.material.emissive.setRGB(r, 0, 0));





    });

    /* 3. update enemy lasers — movement handled by shared pool */
  }

  function prewarm(renderer, camera) {
    const prev = allShips.map(s => s.visible);
    allShips.forEach(s => { s.visible = true; });
    renderer.compile(scene, camera);
    allShips.forEach((s, i) => { s.visible = prev[i]; });
  }
  function prewarmRender(renderer, camera) {
    const prev = allShips.map(s => s.visible);
    allShips.forEach(s => { s.visible = true; });
    renderer.render(scene, camera);
    allShips.forEach((s, i) => { s.visible = prev[i]; });
  }
  function prewarmSpawn(renderer, camera) {
    if (!allShips.length) return;
    const prevStates = allShips.map(s => ({
      vis: s.visible,
      pos: s.position.clone()
    }));
    allShips.forEach((s, i) => {
      s.visible = true;
      s.position.set((i % 5) * 2, -200 - Math.floor(i / 5) * 2, -200);
    });
    renderer.render(scene, camera);
    allShips.forEach((s, i) => {
      s.visible = prevStates[i].vis;
      s.position.copy(prevStates[i].pos);
    });
  }

  function previewSetup({
    origin = null,
    right = null,
    up = null,
    spacing = 12,
    count = 1,
    faceTarget = null
  } = {}) {
    if (!shipPool.length) return () => {};
    const maxCount = Math.min(count, shipPool.length);
    const prevStates = [];
    for (let i = 0; i < maxCount; i++) {
      const ship = shipPool[i];
      prevStates.push({
        ship,
        vis: ship.visible,
        pos: ship.position.clone(),
        quat: ship.quaternion.clone()
      });
      ship.visible = true;
      ship.userData.dead = false;
      ship.userData.flashT = 0;
      if (origin) {
        ship.position.copy(origin);
      }
      if (right) {
        const offset = (i - (maxCount - 1) * 0.5) * spacing;
        ship.position.addScaledVector(right, offset);
      }
      if (up) {
        ship.position.addScaledVector(up, (i % 2) * spacing * 0.15);
      }
      if (faceTarget) {
        ship.lookAt(faceTarget);
        ship.quaternion.multiply(yawFixQ);
      }
    }
    return () => {
      prevStates.forEach(state => {
        state.ship.visible = state.vis;
        state.ship.position.copy(state.pos);
        state.ship.quaternion.copy(state.quat);
      });
    };
  }

  let manualSpawnIdx = -1;
  const manualSpawnCfg = { x: 0, y: 0, z: 0, dropHealRing: false, __spawnIdx: -1 };
  function spawnManual(position, overrides = {}) {
    if (!manualPool.length || !position) return null;
    const ship = manualPool.find(s => !s.visible || s.userData.dead);
    if (!ship) return null;
    manualSpawnIdx -= 1;
    manualSpawnCfg.x = position.x;
    manualSpawnCfg.y = position.y;
    manualSpawnCfg.z = position.z;
    manualSpawnCfg.dropHealRing = Boolean(overrides.dropHealRing);
    manualSpawnCfg.__spawnIdx = manualSpawnIdx;
    resetShipState(ship, manualSpawnCfg);
    if (overrides.state) ship.userData.state = overrides.state;
    if (typeof overrides.hp === 'number') ship.userData.hp = overrides.hp;
    if (typeof overrides.onSpawn === 'function') overrides.onSpawn(ship);
    return ship;
  }

   return { update
         , getActiveShips: () => ACTIVE_SHIPS
         , getActiveLasers: () => []
         , prewarm
         , prewarmRender
         , prewarmSpawn
         , previewSetup
         , spawnManual
         , materializeSpawns
          };
}
