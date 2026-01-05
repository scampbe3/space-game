import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { setBossHealthAlt } from './hud.js';
import { toLambert } from './material-utils.js';

/**
 * initBossSystem(scene,{
 *   spawn,        // {x,y,z} from spawns.json
 *   playerObj,    // mesh of player ship
 *   railCurve,    // CatmullRomCurve3
 *   playerSpeed   // units / s
 * })
 *  → returns { update(dt,tPlayer), getActiveLasers() }
 */
export async function initBossSystem(scene,{
  spawn,
  playerObj,
  railCurve,
  playerSpeed,
  modelPath = './models/dark2.glb',
  boltPool = null,
  onDestroyed = null,
  canFire = null,
  materialMode = 'standard',
  autoDespawnZ = -3205
}){
  /* ── load and scale frigate ───────────────────────────── */
  const boss = (await new GLTFLoader().loadAsync(modelPath)).scene;
  const useLambert = materialMode === 'lambert';
  boss.scale.setScalar(36);                     // “frigate-sized”
  boss.position.set(spawn.x, spawn.y, spawn.z);
 boss.visible = false;                         // ← hide until spawned
  scene.add(boss);

  /* ── dynamic gun hard-points based on scaled bounds ───── */
  const box   = new THREE.Box3().setFromObject(boss);
const size  = new THREE.Vector3(); box.getSize(size);
const hitR  = size.z * 0.44;            // 45 % of frigate length
const hitR2 = hitR * hitR;              // tighter & visually matched

  const w = size.x * 0.1, h = size.y * 0.1, d = size.z * 0.1;

/* ── gun hard-points (nose + slight left / right) ────────── */
const guns = [
  new THREE.Vector3( 0,            0,  0 ),        // dead-centre bow
  new THREE.Vector3(-0.7,  -0.1,  -d * 0.1),   // left-front
  new THREE.Vector3( 0.7,  -0.1,  -d * 0.1),    // right-front
  new THREE.Vector3(-0.2,  -0.15,  -d * 0.1),   // left-front
  new THREE.Vector3( 0.2,  -0.15,  -d * 0.1)    // right-front
];


  /* ── laser pool (shared instanced) ───────────────────── */
  const LASER_SPD = 180, LASER_LIFE = 1.2, FIRE_INT = 1.8;
  const BOLT_POOL = boltPool ?? scene.userData?.boltPool ?? null;
  function fireLaser(worldPos, worldQuat, isBig = false){
    if (!BOLT_POOL) return;
    const handle = BOLT_POOL.alloc({ big: isBig, life: LASER_LIFE * (isBig ? 1.5 : 1), dir: 1, bounced: false, scale: isBig ? 2 : 1 });
    if (!handle) return;
    BOLT_POOL.setTransform(handle, worldPos, worldQuat, isBig ? 2 : 1);
  }
  function getActiveLasers(){ return []; }

/* ---------- new boss stats & flash ---------- */
const MAX_HP = 45;
let   hp     = MAX_HP;
let   flashT = 0;
let   destroyed = false;

/* cache all meshes once for cheap flash */
  const meshList = [];
  boss.traverse(o => {
    if (o.isMesh) {
      o.material = useLambert ? toLambert(o.material) : o.material.clone();
      meshList.push(o);
    }
  });

/* expose to collision system */
function getMesh(){ return boss; }
function damageBoss(dmg){
  if (destroyed) return;
  hp = Math.max(0, hp-dmg);
 flashT = dmg >= 3 ? 0.30  // charge‑shot or other “big” hits
                   : 0.15; // regular lasers & bounced bolt
  setBossHealthAlt(hp / MAX_HP);
  if(hp===0){
    destroyed = true;
    boss.visible=false;
    setBossHealthAlt(null);
    if (typeof onDestroyed === 'function') onDestroyed();
  }
}

  /* ── helper scratch ──────────────────────────────────── */
const tmpPos   = new THREE.Vector3(),
      tmpQuat  = new THREE.Quaternion(),
      tmpWorld = new THREE.Vector3(),
      tmpDir   = new THREE.Vector3();    // ← declare properly
const lookForward = new THREE.Vector3(0, 0, 1);
  let fireTimer = 0;
  let spawned   = false;        //  ← was below update() in your copy
  const autoKillZ = Number.isFinite(spawn?.autoDespawnZ)
    ? spawn.autoDespawnZ
    : autoDespawnZ;

  function lookQuaternion(from, to, out) {
  tmpDir.copy(to).sub(from);
  if (tmpDir.lengthSq() > 1e-6) {
    tmpDir.normalize();
  } else {
    tmpDir.copy(lookForward);
  }
  return (out ?? tmpQuat).setFromUnitVectors(
         lookForward, tmpDir);            // +Z → dir
}



  /* ── update each frame ───────────────────────────────── */
     function update(dt,tPlayer){
    const allowFire = typeof canFire === 'function' ? canFire() : true;

    /* 0. spawn when player is close enough */
  /* 0. spawn when player comes within 300 u of the boss point */
  if (!spawned) {
  playerObj.getWorldPosition(tmpWorld);
  if (tmpWorld.z <= spawn.z + 300) {          // within range
    spawned      = true;                     // ← FIXED (was inside the comment)
    boss.visible = true;
    setBossHealthAlt(hp / MAX_HP);
  } else {
    return;                                  // not active yet
  }
}

    // keep boss HUD in sync while active (for worker-host HUD)
    setBossHealthAlt(hp > 0 ? hp / MAX_HP : null);

    /* 1. once spawned, stay a little ahead of the player & face them */
    const bossT = Math.min(1, tPlayer + 0.0032); // ~2 % ahead
    boss.position.copy(railCurve.getPointAt(bossT));
    boss.lookAt(tmpWorld.setFromMatrixPosition(playerObj.matrixWorld));

    if (!destroyed && Number.isFinite(autoKillZ) && boss.position.z <= autoKillZ) {
      destroyed = true;
      hp = 0;
      boss.visible = false;
      setBossHealthAlt(null);
      if (typeof onDestroyed === 'function') onDestroyed({ auto: true, noScore: true });
      return;
    }

 if (hp > 0 && allowFire) {                       // ← NEW guard: only while alive
      fireTimer += dt;
      if (fireTimer >= FIRE_INT) {
        fireTimer = 0;
    guns.forEach(g => {
          boss.localToWorld(tmpPos.copy(g));
          lookQuaternion(tmpPos, tmpWorld, tmpQuat);
          fireLaser(tmpPos, tmpQuat);
        });
        /* big centre blast every third volley */
        if (Math.random() < 0.34) {
          tmpPos.copy(guns[0]); boss.localToWorld(tmpPos);
          lookQuaternion(tmpPos, tmpWorld, tmpQuat);
          fireLaser(tmpPos, tmpQuat, true);
        }
      }
    }

    /* update lasers */

/* red flash using emissive – no traverse each frame */
if (flashT>0){
  flashT=Math.max(0,flashT-dt);
  const e=flashT>0?1:0;
  meshList.forEach(m=>m.material.emissive.setRGB(e,0,0));
}


    // movement handled by shared pool update
  }

  function prewarm(renderer, camera) {
    const prevVis = boss.visible;
    const prevPos = boss.position.clone();
    const prevQuat = boss.quaternion.clone();
    const prevCulls = [];
    boss.visible = true;
    if (camera) {
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(camDir);
      boss.position.copy(camPos).addScaledVector(camDir, 80);
      boss.lookAt(camPos);
    }
    boss.traverse(o => {
      if (o.isMesh) {
        prevCulls.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
    renderer.render(scene, camera);
    boss.visible = prevVis;
    boss.position.copy(prevPos);
    boss.quaternion.copy(prevQuat);
    prevCulls.forEach(([o, c]) => { o.frustumCulled = c; });
  }

  return { update, getActiveLasers, damageBoss, getMesh,  getRadiusSq: () => hitR2, prewarm };
}
