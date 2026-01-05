import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { setBossHealth } from './hud.js';
import { toLambert } from './material-utils.js';

/**
 * initBossHead(scene, {
 *   modelPath,
 *   eyesPath,
 *   rig,
 *   boltPool,
 *   playerObj,
 *   railSpeed,
 *   summonWave   // callback to spawn enemies
 * })
 */
export async function initBossHead(scene, {
  modelPath,
  eyesPath = './models/boss_eyes.glb',
  rig,
  boltPool,
  playerObj,
  railSpeed = 35,
  summonWave = () => {},
  materialMode = 'standard'
} = {}) {
  const prepareMeshBounds = (root) => {
    if (!root) return;
    root.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    });
  };

  const loader = new GLTFLoader();
  const root = (await loader.loadAsync(modelPath)).scene;
  root.scale.setScalar(14);
  root.visible = false;
  rig.add(root);

  const MAX_HP = 120;
  let hp = MAX_HP;
  let flashT = 0;
  const meshList = [];
  const eyesMeshList = [];
  let eyesRoot = null;
  let eyesBlinkIdx = -1;
  let eyesBlinkTimer = 0;
  const eyesBlinkPattern = [0.07, -0.05, 0.07, -0.05];
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();
  const tmpInv = new THREE.Matrix4();
  const tmpSphere = new THREE.Sphere();
  const useLambert = materialMode === 'lambert';
  root.traverse(o => {
    if (o.isMesh) {
      o.material = useLambert ? toLambert(o.material) : o.material.clone();
      meshList.push(o);
    }
  });
  function setEmissive(list, r, g, b) {
    list.forEach(m => m.material.emissive && m.material.emissive.setRGB(r, g, b));
  }
  function blink() {
    flashT = 0.15;
    setEmissive(meshList, 1, 0, 0);
  }
  function setEyesBlink(on) {
    if (!eyesMeshList.length) return;
    setEmissive(eyesMeshList, on ? 1 : 0, 0, 0);
  }
  function startEyesBlink() {
    if (!eyesRoot) return;
    eyesBlinkIdx = 0;
    eyesBlinkTimer = Math.abs(eyesBlinkPattern[0]);
    setEyesBlink(true);
  }
  function updateEyesBlink(dt) {
    if (eyesBlinkIdx < 0) return;
    eyesBlinkTimer -= dt;
    if (eyesBlinkTimer > 0) return;
    eyesBlinkIdx += 1;
    if (eyesBlinkIdx >= eyesBlinkPattern.length) {
      setEyesBlink(false);
      eyesBlinkIdx = -1;
      return;
    }
    const entry = eyesBlinkPattern[eyesBlinkIdx];
    setEyesBlink(entry > 0);
    eyesBlinkTimer = Math.abs(entry);
  }
  root.userData.enemy = true;
  root.userData.enemyRoot = true;
  root.userData.hp = MAX_HP;
  root.userData.dead = false;
  root.userData.blink = blink;
  root.userData.meshes = meshList;
  root.userData.androssPart = 'head';
  root.userData.scoreValue = 5000;
  root.userData.largeExplosion = true;
  root.userData.damageFn = (amt = 1) => damage(amt);
  root.userData.hitRadius = 12;
  root.userData.blastRadius = 14;
  root.userData.chargeRadius = 14; // for charge-shot direct hit

  prepareMeshBounds(root);

  if (eyesPath) {
    try {
      eyesRoot = (await loader.loadAsync(eyesPath)).scene;
    } catch (err) {
      console.warn('[boss-head] eyes load failed:', err);
    }
  }
  if (eyesRoot) {
    eyesRoot.traverse(o => {
      if (o.isMesh) {
        o.material = useLambert ? toLambert(o.material) : o.material.clone();
        eyesMeshList.push(o);
      }
    });
    root.add(eyesRoot);
    prepareMeshBounds(eyesRoot);
    root.updateWorldMatrix(true, true);
    eyesRoot.updateWorldMatrix(true, true);
    let eyesHitRadius = 2;
    tmpBox.setFromObject(eyesRoot);
    if (!tmpBox.isEmpty()) {
      const localBox = tmpBox.clone().applyMatrix4(tmpInv.copy(eyesRoot.matrixWorld).invert());
      localBox.getCenter(tmpCenter);
      localBox.getSize(tmpSize);
      localBox.expandByScalar(0.11);
      localBox.getBoundingSphere(tmpSphere);
      eyesHitRadius = tmpSphere.center.length() + tmpSphere.radius + 0.19;
      eyesRoot.userData.hitBoxes = [localBox];
    }
    eyesRoot.userData.enemy = true;
    eyesRoot.userData.enemyRoot = true;
    eyesRoot.userData.androssPart = 'eyes';
    eyesRoot.userData.androssOwner = root;
    eyesRoot.userData.meshes = eyesMeshList;
    eyesRoot.userData.blink = startEyesBlink;
    eyesRoot.userData.scoreValue = root.userData.scoreValue;
    eyesRoot.userData.largeExplosion = true;
    eyesRoot.userData.damageFn = (amt = 1) => damageEyes(amt);
    eyesRoot.userData.hitRadius = eyesHitRadius;
    eyesRoot.userData.blastRadius = root.userData.blastRadius;
    eyesRoot.userData.chargeRadius = eyesHitRadius;
  }

  // idle motion
  let idleT = Math.random() * Math.PI * 2;

  // attacks timers
  let eyeSweepCd = 3;
  let summonCd = Infinity; // disable summon/retreat for now
  let sweeping = false;
  let sweepT = 0;
  let retreating = false;
  let retreatT = 0;

  const tmp = new THREE.Vector3();
  const tmpHead = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpQuatLook = new THREE.Quaternion();
  const headForward = new THREE.Vector3(0, 0, 1);
  const aimTarget = new THREE.Vector3();
  const aimHistory = [];
  const aimPool = [];
  for (let i = 0; i < 24; i++) {
    aimPool.push({ t: 0, pos: new THREE.Vector3() });
  }
  const tmpAimFallback = { t: 0, pos: new THREE.Vector3() };
  const tmpHeadPos = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpDirL = new THREE.Vector3();
  const tmpDirR = new THREE.Vector3();
  const tmpDirToAim = new THREE.Vector3();
  const fallbackForward = new THREE.Vector3(0, 0, -1);
  let elapsed = 0;
  let lastPlayerZ = 0;
  const IDLE_PHASES = [
    {
      maxRatio: 0.33,
      swayRadius: 14.5,
      yAmp: 7.5,
      yFreq: 0.65,
      baseYFlow: 1.4,
      speedBase: 5.4,
      speedRange: 1.2,
      speedLerp: 0.3,
      changeMin: 2,
      changeMax: 3
    },

        {
      maxRatio: 0.66,
      swayRadius: 10.875,
      yAmp: 5.625,
      yFreq: 0.4875,
      baseYFlow: 1.05,
      speedBase: 4.05,
      speedRange: 0.9,
      speedLerp: 0.3,
      changeMin: 2,
      changeMax: 3
    },

    {
      maxRatio:   1.0,
      swayRadius: 7.25,
      yAmp: 3.75,
      yFreq: 0.325,
      baseYFlow: 0.7,
      speedBase: 2.7,
      speedRange: 0.6,
      speedLerp: 0.3,
      changeMin: 2,
      changeMax: 3
    }

  ];
  const getIdlePhase = ratio => IDLE_PHASES.find(p => ratio <= p.maxRatio) ?? IDLE_PHASES[IDLE_PHASES.length - 1];
  let headSwayAngle = Math.PI / 4;
  let swaySpeed = 0.8;
  let targetSwaySpeed = 0.8;
  let swayChangeTimer = 0;
  const eyeOffsetL = new THREE.Vector3(3, 0, 0);
  const eyeOffsetR = new THREE.Vector3(-3, 0, 0);
  const eyeWorldL = new THREE.Vector3();
  const eyeWorldR = new THREE.Vector3();
  let aimInitialized = false;
  const AIM_LAG = 6; // higher = snappier; lower = slower
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const BEAM_LEN = 80;
  const beamGeo = new THREE.BoxGeometry(0.8, 0.8, BEAM_LEN);
  beamGeo.translate(0, 0, BEAM_LEN * 0.5); // anchor origin at the back so it projects forward only
  const eyeBeamL = new THREE.Mesh(beamGeo, beamMat.clone());
  const eyeBeamR = new THREE.Mesh(beamGeo, beamMat.clone());
  eyeBeamL.visible = eyeBeamR.visible = false;
  scene.add(eyeBeamL, eyeBeamR);

  function startEyeSweep() {
    sweeping = true;
    sweepT = 0;
    eyeBeamL.visible = eyeBeamR.visible = true;
  }

  function stopEyeSweep() {
    sweeping = false;
    eyeBeamL.visible = eyeBeamR.visible = false;
  }

  function updateEyeBeams(dt) {
    if (!sweeping) return;
    sweepT += dt;
    // positions from head eyes (keep offsets as-is)
    root.updateMatrixWorld(true);
    const headPos = root.getWorldPosition(tmpHeadPos);
    eyeWorldL.copy(eyeOffsetL).applyQuaternion(root.quaternion).add(headPos);
    eyeWorldR.copy(eyeOffsetR).applyQuaternion(root.quaternion).add(headPos);
    tmpTarget.set(aimTarget.x, aimTarget.y, lastPlayerZ);

    tmpDirL.copy(tmpTarget).sub(eyeWorldL);
    const lookDirL = tmpDirL.lengthSq() > 1e-6 ? tmpDirL.normalize() : fallbackForward;
    tmpQuat.setFromUnitVectors(headForward, lookDirL);
    eyeBeamL.position.copy(eyeWorldL);
    eyeBeamL.quaternion.copy(tmpQuat);

    tmpDirR.copy(tmpTarget).sub(eyeWorldR);
    const lookDirR = tmpDirR.lengthSq() > 1e-6 ? tmpDirR.normalize() : fallbackForward;
    tmpQuat.setFromUnitVectors(headForward, lookDirR);
    eyeBeamR.position.copy(eyeWorldR);
    eyeBeamR.quaternion.copy(tmpQuat);

    if (sweepT >= 3) stopEyeSweep();
  }

  function update(dt, tPlayer, allowFire = true, paused = false) {
    if (!root.visible || root.userData.dead) return;
    if (paused) return;

    // flash decay
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      const e = flashT > 0 ? 1 : 0;
      setEmissive(meshList, e, 0, 0);
    }
    updateEyesBlink(dt);

    // idle motion (no lunges)
    idleT += dt * 0.6;
    const hpRatio = Math.max(0, Math.min(1, hp / MAX_HP));
    const phase = getIdlePhase(hpRatio);
    const baseY = 8 + Math.sin(idleT) * phase.baseYFlow;
    swayChangeTimer -= dt;
    if (swayChangeTimer <= 0) {
      targetSwaySpeed = phase.speedBase + Math.random() * phase.speedRange;
      swayChangeTimer = phase.changeMin + Math.random() * (phase.changeMax - phase.changeMin);
    }
    swaySpeed += (targetSwaySpeed - swaySpeed) * phase.speedLerp * dt;
    headSwayAngle += swaySpeed * dt;
    root.position.x = Math.cos(headSwayAngle) * phase.swayRadius;
    root.position.y = baseY + Math.sin(headSwayAngle * phase.yFreq) * phase.yAmp;
    root.position.z = 0;

    // always face the player with a small lag (shared with beams)
    const headPos = root.getWorldPosition(tmpHead);
    const playerPos = playerObj.getWorldPosition(tmp);
    if (!aimInitialized) { aimTarget.set(playerPos.x, playerPos.y, 0); aimInitialized = true; }
    elapsed += dt;
    lastPlayerZ = playerPos.z;
    // record current player position (XY only) in history (maintain small window)
    const sample = aimPool.pop() ?? { t: 0, pos: new THREE.Vector3() };
    sample.t = elapsed;
    sample.pos.set(playerPos.x, playerPos.y, 0);
    aimHistory.push(sample);
    const AIM_DELAY = 0.1; // seconds of intentional delay
    const targetTime = elapsed - AIM_DELAY;
    // prune old samples
    while (aimHistory.length && aimHistory[0].t < targetTime - 0.1) {
      const oldSample = aimHistory.shift();
      if (oldSample) aimPool.push(oldSample);
    }
    // find samples around the delayed time for interpolation
    let prev = aimHistory[0] ?? tmpAimFallback;
    if (prev === tmpAimFallback) {
      tmpAimFallback.t = elapsed;
      tmpAimFallback.pos.set(playerPos.x, playerPos.y, 0);
    }
    let next = aimHistory[aimHistory.length - 1] ?? prev;
    for (let i = 0; i < aimHistory.length - 1; i++) {
      const a = aimHistory[i];
      const b = aimHistory[i + 1];
      if (a.t <= targetTime && b.t >= targetTime) {
        prev = a; next = b; break;
      }
    }
    const span = Math.max(1e-5, next.t - prev.t);
    const alpha = THREE.MathUtils.clamp((targetTime - prev.t) / span, 0, 1);
    aimTarget.copy(prev.pos).lerp(next.pos, alpha);
    aimTarget.z = lastPlayerZ;
    tmpDirToAim.copy(aimTarget).sub(headPos);
    if (tmpDirToAim.lengthSq() > 1e-6) {
      tmpDirToAim.normalize();
      tmpQuatLook.setFromUnitVectors(headForward, tmpDirToAim);
      root.quaternion.slerp(tmpQuatLook, 0.25);
      root.updateMatrixWorld(true);
    }

    if (!allowFire && sweeping) {
      stopEyeSweep();
    }

    // attacks
    if (allowFire) {
      eyeSweepCd -= dt;
      if (eyeSweepCd <= 0 && !sweeping && !retreating) {
        startEyeSweep();
        eyeSweepCd = 5 + Math.random() * 3;
      }
    }

    // retreat/summon disabled for now

    if (allowFire) updateEyeBeams(dt);
  }

  function damage(amount = 1, { full = false, blinkHead = true } = {}) {
    if (root.userData.dead) return false;
    const scaled = full ? amount : amount * 0.5;
    hp = Math.max(0, hp - scaled);
    root.userData.hp = hp;
    if (blinkHead) blink();
    setBossHealth(hp / MAX_HP);
    if (hp === 0) {
      root.userData.dead = true;
      root.visible = false;
      stopEyeSweep();
      setEyesBlink(false);
      eyesBlinkIdx = -1;
      setBossHealth(null);
      return true;
    }
    return false;
  }

  function damageEyes(amount = 1) {
    startEyesBlink();
    return damage(amount, { full: true, blinkHead: false });
  }

  return {
    update,
    damage,
    damageEyes,
    isAlive: () => !root.userData.dead,
    getMesh: () => root,
    getEyes: () => eyesRoot,
    getHP: () => hp,
    startEyeSweep,
    handleLaserHit: (amount = 1) => damage(amount),
    getActiveBeams: () => [eyeBeamL, eyeBeamR],
    getHpRatio: () => hp / MAX_HP
  };
}
