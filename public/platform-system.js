/* platform‑system.js  – spinning 4‑gun turret “plat.glb” */
import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { addScore }   from './hud.js';                 // +100 pts on death
import { toLambert } from './material-utils.js';

export async function initPlatformSystem(scene, {
spawn       = null,
  spawnArray  = [],  playerObj,
    camera,
  canFire     = null,
  spinRate     = THREE.MathUtils.degToRad(30),   // rad · s‑¹  (≈30°/s)
  gunArc       = THREE.MathUtils.degToRad(30),   // half‑angle of each cone
  fireInterval = 1.2,                            // seconds / gun
  materialMode = 'standard'
} = {}) {

    const cam = camera;

      /* choose spawn point ------------------------------------------ */
  if (!spawn) {
    /* prefer the first element in spawnArray if supplied          */
    if (Array.isArray(spawnArray) && spawnArray.length) {
      spawn = spawnArray[0];
    } else {
      spawn = { x: 0, y: 0, z: 0 };   // safe-fallback origin
    }
  }

const ACTIVATE_DIST = 200;   // same 200-unit trigger used by fighters


  /* ── load once ───────────────────────────────────────────── */
  const root = (await new GLTFLoader().loadAsync('./models/plat.glb')).scene;
  root.scale.setScalar(8);
  root.position.set(spawn.x, spawn.y, spawn.z);
  scene.add(root);

root.visible         = false;     // stay hidden until activated
root.userData.active = false;     // track dormant / awake

  /* ── four hard‑points: +X, +Z, −X, −Z (local space) ──────── */
  const GUN_DIRS = [
    new THREE.Vector3( 0.66, 0.025,  0),
    new THREE.Vector3( 0, 0.025,  0.66),
    new THREE.Vector3(-0.66, 0.025,  0),
    new THREE.Vector3( 0, 0.025, -0.66)
  ];
  const muzzleR   = 3.2;                               // radius from centre
  const GUN_POS   = GUN_DIRS.map(v=>v.clone().multiplyScalar(muzzleR));

  /* ── per‑gun cooldown timers ─────────────────────────────── */
  const cd = new Float32Array(4).fill(0);

  /* ── laser pool (orange bolts) ───────────────────────────── */
  const LASER_SPD = 160, LASER_LIFE = 2;
  const geo = new THREE.BoxGeometry(0.3,0.3,6).translate(0,0,3);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const pool = Array.from({length:32},()=>{
    const m = new THREE.Mesh(geo,mat); m.visible=false; scene.add(m); return m;
  });

  function fireGun(i){
    const bolt = pool.find(b=>!b.visible); if(!bolt) return;
    /* spawn position */
    const p = GUN_POS[i].clone(); root.localToWorld(p);
    bolt.position.copy(p);
    /* orient toward player */
playerObj.getWorldPosition(tmpWorldV);  // → world
  bolt.lookAt(tmpWorldV);                 // shoot at live player
    bolt.visible       = true;
    bolt.userData.life = LASER_LIFE;
    bolt.userData.dir  =  1;          // enemy → player
bolt.userData.bounced = false;    // not yet reflected

    cd[i]              = fireInterval;         // reset that gun’s CD
  }

  const activeLasers = [];
  function getActiveLasers(){
    activeLasers.length = 0;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (b.visible) activeLasers.push(b);
    }
    return activeLasers;
  }

  /* ── basic hp / flash setup (same as spider) ─────────────── */
  /* ── harvest every child mesh so we can tint them safely ── */
  const meshList = [];
  const useLambert = materialMode === 'lambert';
  root.traverse(o=>{
    if (o.isMesh) {
      /* clone the material so flashing this turret
         never affects other instances that share the GLTF */
      o.material = useLambert ? toLambert(o.material) : o.material.clone();
      meshList.push(o);
    }
  });

/* ── green lock-on ring so charge shots can find us ────────── */
/* use the same thin-square (diamond) ring the fighters use */
const lrGeo = new THREE.RingGeometry(1.6, 1.9, 4);   // outer, inner, segments
const lrMat = new THREE.MeshBasicMaterial({ color: 0x00ff7f,
                                            side : THREE.DoubleSide });
const lockRing = new THREE.Mesh(lrGeo, lrMat);
/* no rotation → it faces camera once we billboard it in update() */
 lockRing.visible      = false;
 lockRing.position.y   = 1;
 lockRing.scale.setScalar(5);      // ≈ same screen size as fighter rings
 scene.add(lockRing);
root.userData.lockRing = lockRing;  // laser-system toggles this


  /* ── basic hp / flash setup (same as spider) ─────────────── */
  root.userData = {
    enemy      : true,
    enemyRoot  : true,
    hp         : 5,
    flashT     : 0,
    meshes     : meshList,
    blink(){
      this.flashT = 0.15;
      meshList.forEach(m=>{
        /* some materials (e.g. MeshBasicMaterial) lack ‘emissive’ —
           test first so we never crash again */
        if (m.material.emissive) m.material.emissive.setRGB(1,0,0);
      });
    }
  };

root.userData.lockRing = lockRing;

  /* ── update loop ─────────────────────────────────────────── */
  const vPlayerDir = new THREE.Vector3();   // scratch – player direction WS

  const vPlayerWS = new THREE.Vector3();    // player world‑space
const vRootWS   = new THREE.Vector3();    // root  world‑space

  const tmpWorldV = new THREE.Vector3();
const tmpWorldQ = new THREE.Quaternion();
const tmpQuat        = new THREE.Quaternion();
const tmpParentQuat  = new THREE.Quaternion();
const qWorldParent = new THREE.Quaternion();   // temp
const qLocal       = new THREE.Quaternion();   // temp

  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  const COS_ARC = Math.cos(gunArc);              // pre‑compute threshold

  function update(dt){
    const allowFire = typeof canFire === 'function' ? canFire() : true;
    /* continuous spin */
    root.rotateY(spinRate * dt * 10);

      /* ―― DESPAWN once player is well ahead ――――――――――――――――― */
  const DESPAWN_Z  = 100;              // distance threshold (units)
  playerObj.getWorldPosition(vPlayerWS);
  root.getWorldPosition(vRootWS);

if (!root.userData.active) {
  if (vPlayerWS.distanceToSquared(vRootWS) > ACTIVATE_DIST * ACTIVATE_DIST) {
    return;                        // still dormant – skip everything
  }
  /* player is close enough → wake up */
  root.visible         = true;
  root.userData.active = true;
  /* optional: cd.fill(0);  // fire immediately if you prefer */
}

  if (!root.userData.dead && vPlayerWS.z < vRootWS.z - DESPAWN_Z) {
    root.visible        = false;       // stop rendering & firing
    root.userData.active = false;   // flag so update() knows we’re asleep
    root.userData.dead  = true;        // collisions skip it
    return;                            // nothing else to do
  }

    /* fade red flash */

    /* billboard the lock-ring when it’s showing */
if (lockRing.visible && cam){                      // guard against null cam
  /* 1. keep the ring centred on the turret */
  root.getWorldPosition(lockRing.position);

  /* 2. face whatever the *current* rail camera is seeing */
  cam.getWorldQuaternion(tmpWorldQ);          // → world
  lockRing.quaternion.copy(tmpWorldQ);        // face player *now*
}

    if (root.userData.flashT > 0){
      root.userData.flashT -= dt;
      if (root.userData.flashT <= 0){
        meshList.forEach(m=>{
          if (m.material.emissive) m.material.emissive.setRGB(0,0,0);
        });
      }
    }

    /* move & cull our bolts */
    pool.forEach(b=>{
      if(!b.visible) return;
b.translateZ(LASER_SPD * dt * (b.userData.dir ?? 1));
      b.userData.life -= dt;
      if (b.userData.life <= 0) b.visible = false;
    });

    if (!root.visible) return;                 // dead already?

    /* vector to player in world XZ plane */
  /* direction to player in the X‑Z plane (world space) */
  playerObj.getWorldPosition(vPlayerWS);
  root.getWorldPosition(vRootWS);
  tmp.copy(vPlayerWS).sub(vRootWS);    // now both in world space
  tmp.y = 0;
    if (tmp.lengthSq() < 1e-4) return;         // player on top
    tmp.normalize();

/* ---------- per‑gun firing logic (robust) --------------- */
playerObj.getWorldPosition(vPlayerWS);
root.getWorldPosition(vRootWS);
vPlayerDir.copy(vPlayerWS).sub(vRootWS).setY(0).normalize();

for (let i = 0; i < 4; ++i) {
  cd[i] -= dt;                    // tick cooldown



  if (cd[i] > 0) continue;        // still cooling

  // gun’s forward vector → world, flattened
  dir.copy(GUN_DIRS[i])
     .applyQuaternion(root.quaternion)
     .setY(0).normalize();

  // fire if player within ±30°
  if (allowFire && dir.dot(vPlayerDir) >= 0.866) {   // cos 30° = 0.866
    fireGun(i);
  }
}}


  /* expose what the other systems need */
  return {
    update,
    getActiveLasers,
    getMesh : () => root,
    getActiveShips : () => root.visible ? [root] : []   // NEW – for main.js
    , prewarm(renderer, camera) {
      const prevVis = root.visible;
      const prevCull = root.frustumCulled;
      root.visible = true;
      root.frustumCulled = false;
      renderer.render(scene, camera);
      root.visible = prevVis;
      root.frustumCulled = prevCull;
    }

  };
}
