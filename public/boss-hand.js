import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

/**
 * initBossHand(scene, {
 *   modelPath,          // glb path (left/right specific)
 *   palmPath,           // optional glb path for critical palm hit mesh
 *   rig,                // parent Object3D that follows the rail
 *   side,               // 'left' | 'right'
 *   boltPool,           // shared bolt pool for power blasts
 *   playerObj,          // player mesh for targeting
 *   railSpeed           // units/s (for syncing motion if needed)
 * })
 * Returns { update(dt,tPlayer), damage(n), getMesh(), isAlive(), setDefense(flag) }
 */
export async function initBossHand(scene, {
  modelPath,
  palmPath = null,
  rig,
  side = 'left',
  boltPool,
  playerObj,
  railSpeed = 35,
  headMesh = null,
  getHeadHpRatio = () => 1,
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
  root.scale.setScalar(12);
  root.visible = false;
  rig.add(root);

  // basic health & flash
  const MAX_HP = 40;
  let hp = MAX_HP;
  let flashT = 0;
  let palmRoot = null;
  const palmMeshList = [];
  let palmBlinkIdx = -1;
  let palmBlinkTimer = 0;
  const palmBlinkPattern = [0.07, -0.05, 0.07, -0.05];
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();
  const tmpInv = new THREE.Matrix4();
  const tmpSphere = new THREE.Sphere();
  let defense = false;

  const useLambert = materialMode === 'lambert';
  const meshList = [];
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
  function setPalmBlink(on) {
    if (!palmMeshList.length) return;
    setEmissive(palmMeshList, on ? 1 : 0, 0, 0);
  }
  function startPalmBlink() {
    if (!palmRoot) return;
    palmBlinkIdx = 0;
    palmBlinkTimer = Math.abs(palmBlinkPattern[0]);
    setPalmBlink(true);
  }
  function updatePalmBlink(dt) {
    if (palmBlinkIdx < 0) return;
    palmBlinkTimer -= dt;
    if (palmBlinkTimer > 0) return;
    palmBlinkIdx += 1;
    if (palmBlinkIdx >= palmBlinkPattern.length) {
      setPalmBlink(false);
      palmBlinkIdx = -1;
      return;
    }
    const entry = palmBlinkPattern[palmBlinkIdx];
    setPalmBlink(entry > 0);
    palmBlinkTimer = Math.abs(entry);
  }

  root.userData.enemy = true;
  root.userData.enemyRoot = true;
  root.userData.hp = MAX_HP;
  root.userData.dead = false;
  root.userData.blink = blink;
  root.userData.meshes = meshList;
  root.userData.androssPart = side === 'left' ? 'handL' : 'handR';
  root.userData.scoreValue = 500;
  root.userData.largeExplosion = true;
  root.userData.damageFn = (amt = 1) => damage(amt);
  root.userData.hitRadius = 8;
  root.userData.blastRadius = 10;
  root.userData.chargeRadius = 10; // direct charge impact
  prepareMeshBounds(root);
  if (palmPath) {
    try {
      palmRoot = (await loader.loadAsync(palmPath)).scene;
    } catch (err) {
      console.warn('[boss-hand] palm load failed:', err);
    }
  }
  if (palmRoot) {
    palmRoot.traverse(o => {
      if (o.isMesh) {
        o.material = useLambert ? toLambert(o.material) : o.material.clone();
        palmMeshList.push(o);
      }
    });
    root.add(palmRoot);
    prepareMeshBounds(palmRoot);
    root.updateWorldMatrix(true, true);
    palmRoot.updateWorldMatrix(true, true);
    let palmHitRadius = 2;
    tmpBox.setFromObject(palmRoot);
    if (!tmpBox.isEmpty()) {
      const localBox = tmpBox.clone().applyMatrix4(tmpInv.copy(palmRoot.matrixWorld).invert());
      localBox.getCenter(tmpCenter);
      localBox.getSize(tmpSize);
      localBox.expandByScalar(0.30);
      localBox.getBoundingSphere(tmpSphere);
      palmHitRadius = tmpSphere.center.length() + tmpSphere.radius + 0.50;
      palmRoot.userData.hitBoxes = [localBox];
    }
    palmRoot.userData.enemy = true;
    palmRoot.userData.enemyRoot = true;
    palmRoot.userData.androssPart = side === 'left' ? 'palmL' : 'palmR';
    palmRoot.userData.androssOwner = root;
    palmRoot.userData.meshes = palmMeshList;
    palmRoot.userData.blink = startPalmBlink;
    palmRoot.userData.scoreValue = root.userData.scoreValue;
    palmRoot.userData.largeExplosion = true;
    palmRoot.userData.damageFn = (amt = 1) => damagePalm(amt);
    palmRoot.userData.hitRadius = palmHitRadius;
    palmRoot.userData.blastRadius = root.userData.blastRadius;
    palmRoot.userData.chargeRadius = palmHitRadius;
  }
  root.updateWorldMatrix(true, true);
  const worldBox = new THREE.Box3().setFromObject(root);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const localBox = worldBox.clone().applyMatrix4(inv); // oriented AABB in hand-local space
  const size = localBox.getSize(new THREE.Vector3());
  const center = localBox.getCenter(new THREE.Vector3());
  const scale = new THREE.Vector3(0.42, 0.42, 0.32); // tighter palm-ish box
  const halfSize = size.multiply(scale).multiplyScalar(0.4);
  const palmOffset = size.z * 0.12; // bias forward toward palm
  center.z += palmOffset;
  localBox.min.copy(center).sub(halfSize);
  localBox.max.copy(center).add(halfSize);
  root.userData.handCollider = { box: localBox };

  // idle motion
  let idleT = Math.random() * Math.PI * 2;
  const anchorHistory = [];
  const anchorPool = [];
  for (let i = 0; i < 24; i++) {
    anchorPool.push({ t: 0, pos: new THREE.Vector3() });
  }
  const tmpAnchorFallback = { t: 0, pos: new THREE.Vector3() };
  let anchorElapsed = 0;
  const headAnchorScratch = new THREE.Vector3();
  const delayedHeadScratch = new THREE.Vector3();
  const tmpAnchoredBase = new THREE.Vector3();
  const tmpIdlePos = new THREE.Vector3();
  const baseOffset = new THREE.Vector3(
    side === 'left' ? -20 : 20,   // tuned spacing
    -3,
    3
  );
  const palmTiltDir = side === 'left' ? -1 : 1;
  const getAnchorDelay = ratio => ratio <= 0.33 ? 0.0625 : ratio <= 0.66 ? 0.1 : 0.2;

  // attack timers
  let swipeCd = 3 + Math.random();
  let blastCd = 4 + Math.random();
  let swipeLungeT = 0;
  let swipeDist = 0;
  const swipeDir = new THREE.Vector3();
  const swipeAxis = new THREE.Vector3(0, 1, 0);
  let charging = false;
  let chargeT = 0;
  const SWIPE_DURATION = 1.2;
  const SWIPE_DAMAGE_RADIUS2 = 9; // 3u

  const tmp = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpRootPos = new THREE.Vector3();
  const tmpPlayerPos = new THREE.Vector3();
  const tmpDirVec = new THREE.Vector3();
  const tmpPlayerLocal = new THREE.Vector3();
  const tmpHandLocal = new THREE.Vector3();
  const tmpArcSide = new THREE.Vector3();
  const tmpForwardRef = new THREE.Vector3(0, 0, 1);

  function update(dt, tPlayer, allowFire = true, paused = false) {
    if (!root.visible || root.userData.dead) return;
    if (paused) return;

    // fade emissive flash
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      const e = flashT > 0 ? 1 : 0;
      setEmissive(meshList, e, 0, 0);
    }
    updatePalmBlink(dt);

    // idle loop + face player (stay near base offset trailing the head)
    idleT += dt * 0.9;
    const currentHeadPos = headMesh ? headMesh.position : headAnchorScratch.set(0,0,0);
    const sample = anchorPool.pop() ?? { t: 0, pos: new THREE.Vector3() };
    sample.t = anchorElapsed;
    sample.pos.copy(currentHeadPos);
    anchorHistory.push(sample);
    anchorElapsed += dt;
    const ratio = getHeadHpRatio?.() ?? 1;
    const delay = getAnchorDelay(ratio);
    const targetTime = Math.max(0, anchorElapsed - delay);
    while (anchorHistory.length > 1 && anchorHistory[0].t < targetTime - 0.3) {
      const oldSample = anchorHistory.shift();
      if (oldSample) anchorPool.push(oldSample);
    }
    let prevSample = anchorHistory[0] ?? tmpAnchorFallback;
    if (prevSample === tmpAnchorFallback) {
      tmpAnchorFallback.t = targetTime;
      tmpAnchorFallback.pos.copy(currentHeadPos);
    }
    let nextSample = anchorHistory[anchorHistory.length - 1] ?? prevSample;
    for (let i = 0; i < anchorHistory.length - 1; i++) {
      const a = anchorHistory[i];
      const b = anchorHistory[i + 1];
      if (a.t <= targetTime && b.t >= targetTime) {
        prevSample = a;
        nextSample = b;
        break;
      }
    }
    const span = Math.max(1e-5, nextSample.t - prevSample.t);
    const histAlpha = THREE.MathUtils.clamp((targetTime - prevSample.t) / span, 0, 1);
    delayedHeadScratch.copy(prevSample.pos).lerp(nextSample.pos, histAlpha);
    const loop = idleT * 1.1;
    tmpAnchoredBase.copy(delayedHeadScratch).add(baseOffset);
    tmpIdlePos.set(
      tmpAnchoredBase.x + Math.cos(loop) * 1.0 + Math.sin(loop * 1.8) * 0.4,
      tmpAnchoredBase.y + Math.sin(loop) * 0.8 + Math.sin(loop * 2.1) * 0.3,
      tmpAnchoredBase.z + Math.sin(loop * 1.3) * 0.6
    );
    root.position.copy(tmpIdlePos);
    // face palm toward player using +Z as forward
    playerObj.getWorldPosition(tmpPlayerPos);
    root.getWorldPosition(tmpRootPos);
    tmpDirVec.copy(tmpPlayerPos).sub(tmpRootPos);
    if (tmpDirVec.lengthSq() > 1e-6) {
      tmpDirVec.normalize();
    } else {
      tmpDirVec.copy(tmpForwardRef);
    }
    root.quaternion.setFromUnitVectors(tmpForwardRef, tmpDirVec);
    // rotate so thumbs face inward (90° roll toward center)
    root.rotateY(side === 'left' ? Math.PI * 0.5 : -Math.PI * 0.5);
    // mild idle tilt for life
    root.rotateX(Math.sin(loop * 1.9) * 0.08);

    if (!allowFire) {
      swipeLungeT = 0;
      if (charging) {
        charging = false;
        root.scale.setScalar(12);
      }
      return;
    }

    // swipe attack
    swipeCd -= dt;
    if (swipeCd <= 0 && swipeLungeT <= 0 && !defense) {
      swipeLungeT = SWIPE_DURATION;
      swipeCd = 4 + Math.random() * 2;
      // compute swipe direction in rig space toward player
      playerObj.getWorldPosition(tmp);
      tmpPlayerLocal.copy(tmp);
      rig.worldToLocal(tmpPlayerLocal);
      tmpHandLocal.copy(root.position);
      swipeDir.copy(tmpPlayerLocal).sub(tmpHandLocal).normalize();
      swipeDist = Math.min(102, tmpPlayerLocal.distanceTo(tmpHandLocal));
    }
    if (swipeLungeT > 0) {
      swipeLungeT -= dt;
      const progress = 1 - swipeLungeT / SWIPE_DURATION;
      const offset = Math.sin(progress * Math.PI) * swipeDist; // out and back
      tmpArcSide.copy(swipeDir).cross(swipeAxis).setLength(8.5);
      tmpArcSide.multiplyScalar(Math.sin(progress * Math.PI));
      root.position.copy(tmpIdlePos).addScaledVector(swipeDir, offset).add(tmpArcSide);
      // rotate palm toward/down at peak (hand-specific)
      const tilt = Math.sin(progress * Math.PI) * (Math.PI * 0.5);
      root.rotateZ(palmTiltDir * -tilt);
      // damage check
      playerObj.getWorldPosition(tmp);
      root.getWorldPosition(tmpRootPos);
      if (tmp.distanceToSquared(tmpRootPos) < SWIPE_DAMAGE_RADIUS2) {
        playerObj.userData?.onHit?.(tmpRootPos); // optional hook
      }
    } else {
      root.position.copy(tmpIdlePos);
    }

    // blast attack
    blastCd -= dt;
    if (blastCd <= 0 && !charging && !defense) {
      charging = true;
      chargeT = 0;
    }
    if (charging) {
      chargeT += dt;
      // simple charge telegraph: scale pulse
      const s = 1 + Math.sin(chargeT * 12) * 0.05;
      root.scale.setScalar(12 * s);
      if (chargeT >= 1.0) {
        // fire bolt toward player
        if (boltPool) {
          const handle = boltPool.alloc({ big: true, life: 1.5, dir: 1, bounced: false, scale: 2 });
          if (handle) {
            root.getWorldQuaternion(tmpQuat);
            root.getWorldPosition(tmp);
            // orient palm toward player
            playerObj.getWorldPosition(tmpPlayerPos);
            tmpDirVec.copy(tmpPlayerPos).sub(tmp);
            if (tmpDirVec.lengthSq() > 1e-6) {
              tmpDirVec.normalize();
            } else {
              tmpDirVec.copy(tmpForwardRef);
            }
            tmpQuat.setFromUnitVectors(tmpForwardRef, tmpDirVec);
            boltPool.setTransform(handle, tmp, tmpQuat);
          }
        }
        charging = false;
        root.scale.setScalar(12);
        blastCd = 4 + Math.random() * 2;
      }
    }
  }

  function damage(amount = 1, { full = false, blinkHand = true } = {}) {
    if (root.userData.dead) return false;
    const scaled = full ? amount : amount * 0.5;
    hp = Math.max(0, hp - scaled);
    root.userData.hp = hp;
    if (blinkHand) blink();
    if (hp === 0) {
      root.userData.dead = true;
      root.visible = false;
      setPalmBlink(false);
      palmBlinkIdx = -1;
      return true;
    }
    return false;
  }

  function damagePalm(amount = 1) {
    startPalmBlink();
    return damage(amount, { full: true, blinkHand: false });
  }

  function setDefense(flag) {
    defense = flag;
  }

  function setNoScore(flag = true) {
    root.userData.noScore = Boolean(flag);
  }

  function forceRemove() {
    if (root.userData.dead) return false;
    root.userData.noScore = true;
    root.userData.dead = true;
    root.visible = false;
    root.userData.lockRing && (root.userData.lockRing.visible = false);
    return true;
  }

  return {
    update,
    damage,
    damagePalm,
    setDefense,
    setNoScore,
    forceRemove,
    isAlive: () => !root.userData.dead,
    getMesh: () => root,
    getPalm: () => palmRoot,
    getHP: () => hp,
    handleLaserHit: (amount = 1) => damage(amount)
  };
}
