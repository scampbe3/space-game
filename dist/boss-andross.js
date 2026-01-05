import * as THREE from './libs/build/three.module.js';
import { initBossHead } from './boss-head.js';
import { initBossHand } from './boss-hand.js';
import { createBossMissileSystem } from './boss-missiles.js';
import { setBossHealth } from './hud.js';

/**
 * initBossAndross(scene, {
 *   playerObj,
 *   boltPool,
 *   railSpeed,
 *   summonWave // function to spawn a small wave (optional)
 *   canFire,   // optional predicate to gate attacks
 *   onHeadDestroyed, // callback when head is defeated
 *   handCleanupDelay // ms delay before removing hands
 * })
 */
export async function initBossAndross(scene, {
  playerObj,
  boltPool,
  railSpeed = 35,
  summonWave = () => {},
  spawnZ = -1200,
  explosionPool = null,
  canFire = null,
  onHeadDestroyed = null,
  handCleanupDelay = 300,
  materialMode = 'standard',
  onDialogue = null
} = {}) {
  const rig = new THREE.Object3D();
  scene.add(rig);

  const head = await initBossHead(scene, {
    modelPath: './models/boss_head.glb',
    rig,
    boltPool,
    playerObj,
    railSpeed,
    summonWave,
    materialMode
  });


  const getHeadHpRatio = () => head.getHpRatio ? head.getHpRatio() : 1;
  const headMesh = head.getMesh();
  const leftHand = await initBossHand(scene, {
    modelPath: './models/boss_left_hand.glb',
    palmPath: './models/boss_left_palm.glb',
    rig,
    side: 'left',
    boltPool,
    playerObj,
    railSpeed,
    headMesh,
    getHeadHpRatio,
    materialMode
  });

  const rightHand = await initBossHand(scene, {
    modelPath: './models/boss_right_hand.glb',
    palmPath: './models/boss_right_palm.glb',
    rig,
    side: 'right',
    boltPool,
    playerObj,
    railSpeed,
    headMesh,
    getHeadHpRatio,
    materialMode
  });

  const missileSystem = createBossMissileSystem(scene, {
    playerObj,
    explosionPool,
    headMesh
  });
  let missileCd = 4;
  let missileMuted = false;
  let headDefeated = false;
  let handCleanupScheduled = false;
  let phase2Dialogue = false;
  let phase3Dialogue = false;

  const emitDialogue = (payload) => {
    if (typeof onDialogue === 'function') {
      onDialogue(payload);
    } else if (typeof globalThis?.postMessage === 'function' && globalThis.__IS_RENDER_WORKER) {
      globalThis.postMessage({ type: 'dialogue', payload });
    }
  };

  // health bars: only head uses HUD bar; integrate externally

  rig.visible = false;
  rig.position.set(0, 0, spawnZ);
  let active = false;
  let activeStartT = 0;
  let baseZ = spawnZ;

  // defense trigger: when head takes burst damage in a short window
  let recentDamage = 0;
  let damageWindow = 0;
  const DAMAGE_WINDOW_TIME = 2.0;
  const BURST_THRESHOLD = 8;

  function onHeadDamaged(amount) {
    recentDamage += amount;
    damageWindow = DAMAGE_WINDOW_TIME;
  }

  function activate(tPlayer = 0) {
    active = true;
    activeStartT = tPlayer;
    baseZ = spawnZ;
    rig.visible = true;
    [head, leftHand, rightHand].forEach(p => p.getMesh().visible = true);
    setBossHealth(getHeadHpRatio());
    leftHand.setNoScore?.(false);
    rightHand.setNoScore?.(false);
    headDefeated = false;
    handCleanupScheduled = false;
    missileCd = 4;
    missileSystem.setSpawning?.(true);
    missileMuted = false;
    phase2Dialogue = false;
    phase3Dialogue = false;
  }

  function deactivate() {
    active = false;
    rig.visible = false;
    [head, leftHand, rightHand].forEach(p => p.getMesh().visible = false);
    setBossHealth(null);
  }

  function update(dt, tPlayer, playerZ = null, paused = false) {
    if (!active) return;
    const allowFire = typeof canFire === 'function' ? canFire() : true;
    // keep offset ahead of player; mirror frigate behavior
    if (playerZ !== null) {
      rig.position.z = playerZ - 60; // 80 units in front of player
    } else {
      rig.position.z = baseZ;
    }
    if (paused) return;

    if (damageWindow > 0) {
      damageWindow -= dt;
      if (damageWindow <= 0) recentDamage = 0;
    }

    // defense mode trigger
    if (recentDamage >= BURST_THRESHOLD) {
      const defender = leftHand.isAlive() ? leftHand : rightHand;
      const idle = rightHand.isAlive() && defender === leftHand ? rightHand : null;
      defender?.setDefense(true);
      if (idle) idle.setDefense(false);
      recentDamage = 0;
      damageWindow = 0;
    } else {
      leftHand.setDefense(false);
      rightHand.setDefense(false);
    }

    head.update(dt, tPlayer, allowFire, false);
    leftHand.update(dt, tPlayer, allowFire, false);
    rightHand.update(dt, tPlayer, allowFire, false);

    const hpRatio = getHeadHpRatio();
    if (!phase2Dialogue && hpRatio <= 0.66) {
      phase2Dialogue = true;
      emitDialogue({
        id: 'boss-phase-66',
        portraitSrc: './textures/boss.png',
        textLines: ['I will crush you like a bug.']
      });
    }
    if (!phase3Dialogue && hpRatio <= 0.33) {
      phase3Dialogue = true;
      emitDialogue({
        id: 'boss-phase-33',
        portraitSrc: './textures/boss.png',
        textLines: ['To Oblivion, then.']
      });
    }

    if (head.isAlive() && allowFire) {
      if (missileMuted) {
        missileSystem.setSpawning?.(true);
        missileMuted = false;
      }
      missileCd -= dt;
      if (missileCd <= 0) {
        missileSystem.spawnBurst();
        missileCd = 6 + Math.random() * 3;
      }
      missileSystem.update(dt, playerObj);
    } else if (!missileMuted) {
      missileSystem.setSpawning?.(false);
      missileSystem.clearAll?.();
      missileMuted = true;
    }
  }

  function damageHead(amount, { critical = false } = {}) {
    const actual = critical ? amount : amount * 0.5;
    const dead = critical && head.damageEyes ? head.damageEyes(amount) : head.damage(amount);
    if (dead) {
      if (!headDefeated) {
        headDefeated = true;
        leftHand.setDefense(false);
        rightHand.setDefense(false);
        leftHand.setNoScore?.(true);
        rightHand.setNoScore?.(true);
        missileSystem.setSpawning?.(false);
        missileSystem.clearAll?.();
        active = false; // stop updates/collisions, keep rig visible briefly
        if (!handCleanupScheduled) {
          handCleanupScheduled = true;
          const doCleanup = () => {
            leftHand.forceRemove?.();
            rightHand.forceRemove?.();
            deactivate();
          };
          if (handCleanupDelay <= 0) doCleanup();
          else setTimeout(doCleanup, handCleanupDelay);
        }
        if (typeof onHeadDestroyed === 'function') onHeadDestroyed();
      }
    } else {
      onHeadDamaged(actual);
    }
    return dead;
  }

  function damageHand(which, amount, { critical = false } = {}) {
    const hand = which === 'left' ? leftHand : rightHand;
    if (critical && hand.damagePalm) return hand.damagePalm(amount);
    return hand.damage(amount);
  }

  const bindDamageFns = () => {
    const headRoot = head.getMesh();
    const eyesRoot = head.getEyes?.();
    const leftRoot = leftHand.getMesh();
    const leftPalm = leftHand.getPalm?.();
    const rightRoot = rightHand.getMesh();
    const rightPalm = rightHand.getPalm?.();
    if (headRoot?.userData) {
      headRoot.userData.damageFn = (amt = 1) => damageHead(amt);
    }
    if (eyesRoot?.userData) {
      eyesRoot.userData.damageFn = (amt = 1) => damageHead(amt, { critical: true });
    }
    if (leftRoot?.userData) {
      leftRoot.userData.damageFn = (amt = 1) => damageHand('left', amt);
    }
    if (leftPalm?.userData) {
      leftPalm.userData.damageFn = (amt = 1) => damageHand('left', amt, { critical: true });
    }
    if (rightRoot?.userData) {
      rightRoot.userData.damageFn = (amt = 1) => damageHand('right', amt);
    }
    if (rightPalm?.userData) {
      rightPalm.userData.damageFn = (amt = 1) => damageHand('right', amt, { critical: true });
    }
  };
  bindDamageFns();

  function getEnemyParts() {
    const parts = [];
    if (!active) return parts;
    if (head.isAlive()) {
      const eyes = head.getEyes?.();
      if (eyes) parts.push(eyes);
      parts.push(head.getMesh());
    }
    if (leftHand.isAlive()) {
      const palm = leftHand.getPalm?.();
      if (palm) parts.push(palm);
      parts.push(leftHand.getMesh());
    }
    if (rightHand.isAlive()) {
      const palm = rightHand.getPalm?.();
      if (palm) parts.push(palm);
      parts.push(rightHand.getMesh());
    }
    const missiles = missileSystem.getActiveShips?.();
    if (missiles?.length) parts.push(...missiles);
    return parts;
  }

  function handleLaserHit(mesh, amount = 1) {
    if (mesh === head.getMesh()) return damageHead(amount);
    if (mesh === head.getEyes?.()) return damageHead(amount, { critical: true });
    if (mesh === leftHand.getMesh()) return damageHand('left', amount);
    if (mesh === leftHand.getPalm?.()) return damageHand('left', amount, { critical: true });
    if (mesh === rightHand.getMesh()) return damageHand('right', amount);
    if (mesh === rightHand.getPalm?.()) return damageHand('right', amount, { critical: true });
    return false;
  }

  function prewarm(renderer, camera) {
    if (!renderer || !camera) return;
    const PREWARM_LAYER = 2;
    const prevTarget = renderer.getRenderTarget();
    const prevCameraMask = camera.layers.mask;
    const prevVis = rig.visible;
    rig.visible = true;
    const prevCulls = [];
    const prevBeams = [];
    const prevParts = [];
    const prevLayers = [];
    const prevLightLayers = [];
    rig.traverse(o => {
      prevLayers.push([o, o.layers.mask]);
      o.layers.set(PREWARM_LAYER);
      if (o.isMesh) {
        prevCulls.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
    scene.traverse(o => {
      if (o.isLight) {
        prevLightLayers.push([o, o.layers.mask]);
        o.layers.enable(PREWARM_LAYER);
      }
    });
    head.getMesh().visible = true;
    leftHand.getMesh().visible = true;
    rightHand.getMesh().visible = true;
    const eyes = head.getEyes?.();
    if (eyes) {
      prevParts.push([eyes, eyes.visible]);
      eyes.visible = true;
    }
    const leftPalm = leftHand.getPalm?.();
    if (leftPalm) {
      prevParts.push([leftPalm, leftPalm.visible]);
      leftPalm.visible = true;
    }
    const rightPalm = rightHand.getPalm?.();
    if (rightPalm) {
      prevParts.push([rightPalm, rightPalm.visible]);
      rightPalm.visible = true;
    }
    const beams = head.getActiveBeams?.() ?? [];
    if (camera && beams.length) {
      const tmpPos = new THREE.Vector3();
      const tmpDir = new THREE.Vector3();
      camera.getWorldPosition(tmpPos);
      camera.getWorldDirection(tmpDir);
      beams.forEach(beam => {
        if (!beam) return;
        prevBeams.push([
          beam,
          beam.visible,
          beam.position.clone(),
          beam.quaternion.clone(),
          beam.frustumCulled,
          beam.layers.mask
        ]);
        beam.visible = true;
        beam.frustumCulled = false;
        beam.layers.set(PREWARM_LAYER);
        beam.position.copy(tmpPos).addScaledVector(tmpDir, 30);
        beam.quaternion.copy(camera.quaternion);
      });
    }
    camera.layers.set(PREWARM_LAYER);
    const rt = new THREE.WebGLRenderTarget(1, 1);
    if ('outputColorSpace' in renderer && renderer.outputColorSpace) {
      rt.texture.colorSpace = renderer.outputColorSpace;
    }
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    missileSystem.prewarm?.(renderer, camera, { layer: PREWARM_LAYER });
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    rig.visible = prevVis;
    prevCulls.forEach(([o, c]) => { o.frustumCulled = c; });
    prevParts.forEach(([root, vis]) => { root.visible = vis; });
    prevBeams.forEach(([beam, vis, pos, quat, culled, mask]) => {
      beam.visible = vis;
      beam.position.copy(pos);
      beam.quaternion.copy(quat);
      beam.frustumCulled = culled;
      beam.layers.mask = mask;
    });
    prevLayers.forEach(([o, mask]) => { o.layers.mask = mask; });
    prevLightLayers.forEach(([o, mask]) => { o.layers.mask = mask; });
    camera.layers.mask = prevCameraMask;
  }

  return {
    update,
    damageHead,
    damageHand,
    getEnemyParts,
    handleLaserHit,
    activate,
    deactivate,
    getRig: () => rig,
    getHead: () => head,
    getHands: () => [leftHand, rightHand],
    getMissiles: () => missileSystem,
    prewarm
  };
}
