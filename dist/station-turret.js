/* station‑turret.js – auto‑turret that defends the space‑station boss
   ------------------------------------------------------------------
   initStationTurretSystem(scene,{
     playerObj,      // the player ship mesh
     stationMesh,    // the big static station mesh (for LOS ray)
     camera,         // main PerspectiveCamera (for lock‑ring billboarding)
     spawn           // {x,y,z} position for this turret
   })
     → returns {
         update(dt),
         getActiveShips(),    // for collision / lock‑on
         getActiveLasers()    // for collision
       }
*/

import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

const loader = new GLTFLoader();
const _turretCache = { proto: null, promise: null };
async function getTurretProto(path = './models/turret.glb') {
  if (_turretCache.proto) return _turretCache.proto;
  if (!_turretCache.promise) _turretCache.promise = loader.loadAsync(path);
  const gltf = await _turretCache.promise;
  _turretCache.proto = gltf.scene;
  return _turretCache.proto;
}

export async function initStationTurretSystem(scene, {
  playerObj,
  stationMesh,
  camera      = null,
  spawn       = { x: 0, y: 0, z: 0 },
  boltPool    = null,
  canFire     = null,
  materialMode = 'standard'
} = {}) {

  /* ── constants ────────────────────────────────────────────── */
  const ACTIVATE_DIST2 = 600 * 600;   // 200‑u sphere (squared)
  const DESPAWN_Z_GAP  = 100;         // despawn once player is 100 u ahead
  const FIRE_INT       = 1.0;         // seconds between shots
  const LASER_SPEED    = 160;
  const LASER_LIFE     = 3.0;         // seconds (shorter to reduce active count)

  /* ── load turret model (cached) ───────────────────────────── */
  const proto = (await getTurretProto()).clone(true);
  const turret = proto;
  turret.scale.setScalar(5);
  turret.position.set(spawn.x, spawn.y, spawn.z);
  scene.add(turret);

  turret.visible          = false;  // hidden until activation
  turret.userData.active  = false;
  turret.userData.enemy   = true;
  turret.userData.enemyRoot = true;
  turret.userData.hp      = 3;
  turret.userData.flashT  = 0;
  turret.userData.dead    = false;

  /* ── clone materials & store mesh list for flashing ───────── */
  const meshList = [];
  const useLambert = materialMode === 'lambert';
  turret.traverse(o => {
    if (o.isMesh) {
      o.material = useLambert ? toLambert(o.material) : o.material.clone();
      meshList.push(o);
    }
  });

turret.userData.meshes = meshList;

  turret.userData.blink = function () {
    this.flashT = 0.15;
    meshList.forEach(m => {
      if (m.material.emissive) m.material.emissive.setRGB(1, 0, 0);
    });
  };

  /* ── optional lock‑on ring (same geo as fighters) ─────────── */
  const lrGeo = new THREE.RingGeometry(1.6, 1.9, 4);
  const lrMat = new THREE.MeshBasicMaterial({ color: 0x00ff7f, side: THREE.DoubleSide });
  const lockRing = new THREE.Mesh(lrGeo, lrMat);
  lockRing.visible = false;
  lockRing.scale.setScalar(4);         // slightly smaller than platform ring
  scene.add(lockRing);
  turret.userData.lockRing = lockRing;

  /* ── shared bolt pool (instanced) ────────────────────────── */
  function getActiveLasers() { return []; }

  /* ── helpers ------------------------------------------------ */
  const raycaster       = new THREE.Raycaster();
  const playerWorldPos  = new THREE.Vector3();
  const lastPlayerPos   = new THREE.Vector3();
  const playerVel       = new THREE.Vector3();
  const turretWorldPos  = new THREE.Vector3();
  const leadTarget      = new THREE.Vector3();
  const fwdVec          = new THREE.Vector3();
  const tmpPos          = new THREE.Vector3();
  const tmpQuat         = new THREE.Quaternion();
  let   fireTimer       = 0;
  const BOLT_POOL = boltPool ?? scene.userData?.boltPool ?? null;
  const MAX_LEAD_TIME = 0.75;
  let hasPlayerPrev = false;

  function fireBolt() {
    if (!boltPool) return;
    const handle = boltPool.alloc({ big:false, life: LASER_LIFE, dir: 1, bounced: false });
    if (!handle) return;

    /* spawn bolt 2 u in front of the muzzle (-Z after lookAt) */
    turret.getWorldQuaternion(tmpQuat);
    turret.getWorldPosition(tmpPos);
    fwdVec.set(0, 0, -1).applyQuaternion(tmpQuat);
    tmpPos.addScaledVector(fwdVec, 2);

    boltPool.setTransform(handle, tmpPos, tmpQuat);
    turret.userData.activeBoltHandle = handle;
  }

  /* ── per‑frame update ─────────────────────────────────────── */
  function update(dt) {
    const allowFire = typeof canFire === 'function' ? canFire() : true;

    /* --- flash fade ----------------------------------------- */
    if (turret.userData.flashT > 0) {
      turret.userData.flashT -= dt;
      if (turret.userData.flashT <= 0) {
        meshList.forEach(m => {
          if (m.material.emissive) m.material.emissive.setRGB(0, 0, 0);
        });
      }
    }

    /* --- update bolt pool ----------------------------------- */
    // bolt movement handled by shared pool update

    /* if turret already despawned, nothing else to do */
    if (turret.userData.dead) return;

    /* positions for distance / despawn checks */
    playerObj.getWorldPosition(playerWorldPos);
    turret.getWorldPosition(turretWorldPos);
    if (hasPlayerPrev && dt > 0) {
      playerVel.copy(playerWorldPos).sub(lastPlayerPos).multiplyScalar(1 / dt);
    } else {
      playerVel.set(0, 0, 0);
      hasPlayerPrev = true;
    }
    lastPlayerPos.copy(playerWorldPos);

    /* --- despawn once player is far ahead ------------------- */
    if (playerWorldPos.z < turretWorldPos.z - DESPAWN_Z_GAP) {
      turret.visible          = false;
      turret.userData.active  = false;
      turret.userData.dead    = true;
      return;
    }

    /* --- activation gate (200‑unit sphere) ------------------ */
    if (!turret.userData.active) {
      if (playerWorldPos.distanceToSquared(turretWorldPos) < ACTIVATE_DIST2) {
        turret.visible         = true;
        turret.userData.active = true;
        fireTimer              = 0;     // reset cooldown
      } else {
        return;                         // stay dormant
      }
    }

    /* --- face the player (lead aim) -------------------------- */
    const dist = turretWorldPos.distanceTo(playerWorldPos);
    const leadTime = Math.min(dist / LASER_SPEED, MAX_LEAD_TIME);
    leadTarget.copy(playerWorldPos).addScaledVector(playerVel, leadTime);
    turret.lookAt(leadTarget);

    /* billboard the lock‑ring if visible --------------------- */
    if (lockRing.visible && camera) {
      turret.getWorldPosition(lockRing.position);
      camera.getWorldQuaternion(lockRing.quaternion);
    }

    /* --- fire logic ----------------------------------------- */
    fireTimer += dt;
    if (fireTimer >= FIRE_INT) {
      fireTimer = 0;

      /* LOS raycast to avoid shooting through the station */
      fwdVec.subVectors(leadTarget, turretWorldPos).normalize();
      raycaster.set(turretWorldPos, fwdVec);

      const hit = raycaster.intersectObject(stationMesh, true);
      const hasClearShot = hit.length === 0;

      if (allowFire && hasClearShot) fireBolt();
    }
  }

  /* ── helpers exposed to other systems ────────────────────── */
  function getActiveShips() { return turret.visible ? [turret] : []; }

  function destroy() {
    if (turret.userData.dead) return false;
    turret.visible = false;
    turret.userData.active = false;
    turret.userData.dead = true;
    if (lockRing) lockRing.visible = false;
    return true;
  }

  function getMesh() { return turret; }

  return { update, getActiveShips, getActiveLasers, destroy, getMesh };
}
