// pickup-system.js
import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { gainHeart } from './hud.js';

export async function initPickupSystem(scene, {
  spawnArray = [{ x: 0, y: 0, z: -120 }],
  blueSpawnArray = [],
  ringSpawnArray = [],
  wingRepairSpawnArray = [],
  bombSpawnArray = [],
  playerObj,
  lasers,
  onBombPickup = () => {},
  onRingCollected = () => {}
}) {
    const tmp1 = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
  const PICKUP_SPAWN_DISTANCE = 300;
  /* ----- visual -------------------------------------------------- */
/* ------- visual: twin-laser icon --------------------------------- */

/* bar geometry (vertical) */
const barGeo = new THREE.BoxGeometry(0.25, 6, 0.25);
const barMat = new THREE.MeshStandardMaterial({
  color: 0x00ff7f,
  emissive: 0x00ff7f,
  emissiveIntensity: 1.5,
  roughness: 0.3,
  metalness: 0.6
});
const BLUE_LASER_COLOR = 0x00ffff;
const barMatBlue = new THREE.MeshStandardMaterial({
  color: BLUE_LASER_COLOR,
  emissive: BLUE_LASER_COLOR,
  emissiveIntensity: 1.5,
  roughness: 0.3,
  metalness: 0.6
});

/* dark-blue bridge – connects mid-sections (y = 0) */
const bridgeGeo = new THREE.BoxGeometry(2, 1.2, 0.3);      // ↑ taller bridgeconst
const  bridgeMat = new THREE.MeshStandardMaterial({ color: 0x001244 });
const bridge    = new THREE.Mesh(bridgeGeo, bridgeMat);
bridge.position.y = 0;            // centred

/* ── white capital “L” glued to the bridge ─────────────────────── */
const letterMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.8,
  roughness: 0.2,
  metalness: 0.4
});

/* bigger “L” */
const vert  = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.0, 0.22), letterMat);
vert.position.set(-0.55, 0, 0.2);               // centred on taller bridge

const horiz = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.22), letterMat);
horiz.position.set( 0.05, -0.9, 0.2);           // aligns with bottom

const letterGrp = new THREE.Group();
letterGrp.add(vert);
letterGrp.add(horiz);
const createDualCore = (barMaterial) => {
  const core = new THREE.Group();
  const barL = new THREE.Mesh(barGeo, barMaterial);
  barL.position.x = -1;
  core.add(barL);
  const barR = new THREE.Mesh(barGeo, barMaterial);
  barR.position.x = 1;
  core.add(barR);
  core.add(bridge.clone());
  core.add(letterGrp.clone());
  return core;
};

const pickupCore = createDualCore(barMat);
const pickupBlueCore = createDualCore(barMatBlue);

/* starting position */
  const pickups = [];

  spawnArray.forEach(p => {
    const core = pickupCore.clone(true);      // deep clone of bars/L/bridge
    const inst = new THREE.Group();
    inst.add(core);
    inst.position.set(p.x, p.y, p.z);
    inst.userData.editorRef = p;
    inst.userData.editorGroup = 'pickupDual';
    scene.add(inst);
    pickups.push({
      group: inst,
      core,
      baseY: p.y,
      active: false,
      pending: true,
      spawnRef: p,
      spawnGroup: 'pickupDual'
    });
    core.visible = false;
  });

  const bluePickups = [];
  const createBlueEntry = (position = null, pending = false) => {
    const core = pickupBlueCore.clone(true);
    const inst = new THREE.Group();
    inst.add(core);
    if (position) inst.position.copy(position);
    scene.add(inst);
    return {
      group: inst,
      core,
      baseY: position ? position.y : 0,
      active: false,
      pending
    };
  };
  blueSpawnArray.forEach(p => {
    const entry = createBlueEntry(new THREE.Vector3(p.x, p.y, p.z), true);
    entry.group.userData.editorRef = p;
    entry.group.userData.editorGroup = 'pickupDualBlue';
    entry.spawnRef = p;
    entry.spawnGroup = 'pickupDualBlue';
    bluePickups.push(entry);
    entry.core.visible = false;
  });
  const BLUE_POOL_EXTRA = Math.max(4, Array.isArray(spawnArray) ? spawnArray.length : 0);
  for (let i = 0; i < BLUE_POOL_EXTRA; i++) {
    const entry = createBlueEntry();
    entry.core.visible = false;
    bluePickups.push(entry);
  }

  /* ------- visual: heal ring ------------------------------------- */
  const RING_OUTER_R = 3;
//const RING_INNER_R = 4.2;
  const RING_INNER_R = 2.25;
  const RING_SCALE = 1.7;
  const RING_RADIUS = RING_OUTER_R * RING_SCALE;
  const RING_RADIUS2 = RING_RADIUS * RING_RADIUS;
  const RING_HALF_DEPTH = 3.5;
  const RING_COLLECT_DURATION = 0.45;
  const RING_SPIN_SPEED = (Math.PI * 4) / RING_COLLECT_DURATION;

  const RING_MAJOR_R = (RING_OUTER_R + RING_INNER_R) * 0.5;
  const RING_TUBE_R = (RING_OUTER_R - RING_INNER_R) * 0.5;
  const ringGeo = new THREE.TorusGeometry(RING_MAJOR_R, RING_TUBE_R, 6, 12);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    emissive: 0x202020,
    emissiveIntensity: 1.25,
    metalness: 1.0,
    roughness: 0.12,
    side: THREE.FrontSide
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  const ringGrp = new THREE.Group();
  ringGrp.add(ringMesh);

  const ringPickups = [];
  const RING_POOL_EXTRA = 12;
  const createRingEntry = () => {
    const inst = ringGrp.clone(true);
    inst.visible = false;
    inst.scale.setScalar(RING_SCALE);
    scene.add(inst);
    return {
      mesh: inst,
      baseY: 0,
      state: 'done',
      animT: 0,
      spin: 0
    };
  };
  ringSpawnArray.forEach(p => {
    const entry = createRingEntry();
    entry.mesh.position.set(p.x, p.y, p.z);
    entry.mesh.visible = false;
    entry.baseY = p.y;
    entry.state = 'pending';
    entry.mesh.userData.editorRef = p;
    entry.mesh.userData.editorGroup = 'pickupHealRing';
    entry.spawnRef = p;
    entry.spawnGroup = 'pickupHealRing';
    ringPickups.push(entry);
  });
  for (let i = 0; i < RING_POOL_EXTRA; i++) {
    ringPickups.push(createRingEntry());
  }

  /* ------- visual: wing repair pickup (wrench) ------------------ */
  const wingCore = new THREE.Group();
  const wingCoreMat = new THREE.MeshStandardMaterial({
    color: 0x6bbcff,
    emissive: 0x2b6bff,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.6
  });
  const wingBarMat = new THREE.MeshStandardMaterial({
    color: 0x9ad6ff,
    emissive: 0x3a8bff,
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.4
  });

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.2, 0.45), wingCoreMat);
  handle.position.set(0, 0, 0);
  wingCore.add(handle);

  const socketOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 0.6, 14), wingCoreMat);
  socketOuter.rotation.x = Math.PI * 0.5;
  socketOuter.position.set(0, -2.4, 0);
  wingCore.add(socketOuter);

  const socketInnerMat = new THREE.MeshStandardMaterial({
    color: 0x2a4d7f,
    emissive: 0x18335a,
    emissiveIntensity: 0.6,
    roughness: 0.35,
    metalness: 0.2
  });
  const socketInner = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.4, 0.55, 12), socketInnerMat);
  socketInner.rotation.x = Math.PI * 0.5;
  socketInner.position.set(0, -2.4, 0.06);
  wingCore.add(socketInner);

  const openBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.55), wingCoreMat);
  openBase.position.set(0, 2.05, 0);
  wingCore.add(openBase);

  const jawGeo = new THREE.BoxGeometry(0.45, 0.85, 0.55);
  const jawL = new THREE.Mesh(jawGeo, wingBarMat);
  jawL.position.set(-0.65, 2.45, 0);
  wingCore.add(jawL);
  const jawR = jawL.clone();
  jawR.position.set(0.65, 2.25, 0);
  wingCore.add(jawR);

  wingCore.rotation.z = -Math.PI * 0.25;
  wingCore.scale.setScalar(1.55);

  wingCore.updateMatrixWorld(true);
  const wingCoreBounds = new THREE.Box3().setFromObject(wingCore);
  const wingCoreCenter = wingCoreBounds.getCenter(new THREE.Vector3());
  wingCore.children.forEach(child => {
    child.position.sub(wingCoreCenter);
  });
  wingCore.updateMatrixWorld(true);
  wingCoreBounds.setFromObject(wingCore);
  const wingCoreSphere = wingCoreBounds.getBoundingSphere(new THREE.Sphere());
  const wingCoreRadius = wingCoreSphere.radius;

  const wingPickups = [];
  const dualSpawnCount = (Array.isArray(spawnArray) ? spawnArray.length : 0)
    + (Array.isArray(blueSpawnArray) ? blueSpawnArray.length : 0);
  const WING_POOL_EXTRA = Math.max(6, dualSpawnCount);
  const createWingEntry = (position = null, pending = false) => {
    const core = wingCore.clone(true);
    const inst = new THREE.Group();
    inst.add(core);
    if (position) inst.position.copy(position);
    scene.add(inst);
    return {
      group: inst,
      core,
      baseY: position ? position.y : 0,
      pickupRadius: wingCoreRadius,
      pickupRadiusSq: wingCoreRadius * wingCoreRadius,
      active: false,
      pending
    };
  };
  wingRepairSpawnArray.forEach(p => {
    const entry = createWingEntry(new THREE.Vector3(p.x, p.y, p.z), true);
    entry.group.userData.editorRef = p;
    entry.group.userData.editorGroup = 'pickupWingRepair';
    entry.spawnRef = p;
    entry.spawnGroup = 'pickupWingRepair';
    wingPickups.push(entry);
    entry.core.visible = false;
  });
  for (let i = 0; i < WING_POOL_EXTRA; i++) {
    const entry = createWingEntry();
    entry.core.visible = false;
    wingPickups.push(entry);
  }

  /* ------- visual: bomb pickup ---------------------------------- */
  const BOMB_SCALE = 40.0;
  const BOMB_EMISSIVE_SCALE = 0.85;
  const bombGltf = await new GLTFLoader().loadAsync('./models/pickup_bomb.glb');
  const bombCore = bombGltf.scene;
  const sharedBombMaterials = new Map();
  const makeBombEmissive = (mat) => {
    const base = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
    base.multiplyScalar(BOMB_EMISSIVE_SCALE);
    const out = new THREE.MeshBasicMaterial({
      color: base,
      map: mat.map ?? null,
      transparent: mat.transparent ?? false,
      opacity: mat.opacity ?? 1,
      alphaTest: mat.alphaTest ?? 0,
      side: mat.side ?? THREE.FrontSide,
      depthWrite: mat.depthWrite ?? true,
      depthTest: mat.depthTest ?? true
    });
    if (mat.vertexColors !== undefined) out.vertexColors = mat.vertexColors;
    out.toneMapped = false;
    return out;
  };
  const applyBombMaterials = (root) => {
    root.traverse(node => {
      if (!node.isMesh || !node.userData?.bombMatKeys) return;
      const keys = node.userData.bombMatKeys;
      if (Array.isArray(node.material)) {
        node.material = keys.map(key => sharedBombMaterials.get(key)).filter(Boolean);
      } else {
        node.material = sharedBombMaterials.get(keys[0]);
      }
    });
  };
  bombCore.traverse(node => {
    if (node.isLight) {
      node.visible = false;
      return;
    }
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const keys = materials.map(mat => {
      if (!mat) return null;
      if (!mat.userData.bombKey) {
        mat.userData.bombKey = `bomb_${sharedBombMaterials.size}`;
      }
      const key = mat.userData.bombKey;
      if (!sharedBombMaterials.has(key)) {
        sharedBombMaterials.set(key, makeBombEmissive(mat));
      }
      return key;
    }).filter(Boolean);
    node.userData.bombMatKeys = keys;
    if (keys.length) {
      node.material = Array.isArray(node.material)
        ? keys.map(key => sharedBombMaterials.get(key)).filter(Boolean)
        : sharedBombMaterials.get(keys[0]);
    }
  });
  bombCore.scale.setScalar(1);
  bombCore.updateMatrixWorld(true);
  const bombCoreBounds = new THREE.Box3().setFromObject(bombCore);
  const bombCoreCenter = bombCoreBounds.getCenter(new THREE.Vector3());
  bombCore.position.sub(bombCoreCenter);
  bombCore.updateMatrixWorld(true);
  bombCoreBounds.setFromObject(bombCore);
  const bombCoreSphere = bombCoreBounds.getBoundingSphere(new THREE.Sphere());
  const bombCoreRadius = bombCoreSphere.radius * BOMB_SCALE;

  const bombPickups = [];
  const BOMB_POOL_EXTRA = Math.max(4, Array.isArray(bombSpawnArray) ? bombSpawnArray.length : 0);
  const createBombEntry = (position = null, pending = false) => {
    const core = bombCore.clone(true);
    applyBombMaterials(core);
    const inst = new THREE.Group();
    inst.add(core);
    inst.scale.setScalar(BOMB_SCALE);
    if (position) inst.position.copy(position);
    scene.add(inst);
    return {
      group: inst,
      core,
      baseY: position ? position.y : 0,
      pickupRadius: bombCoreRadius,
      pickupRadiusSq: bombCoreRadius * bombCoreRadius,
      active: false,
      pending
    };
  };
  bombSpawnArray.forEach(p => {
    const entry = createBombEntry(new THREE.Vector3(p.x, p.y, p.z), true);
    entry.group.userData.editorRef = p;
    entry.group.userData.editorGroup = 'pickupBomb';
    entry.spawnRef = p;
    entry.spawnGroup = 'pickupBomb';
    bombPickups.push(entry);
    entry.core.visible = false;
  });
  for (let i = 0; i < BOMB_POOL_EXTRA; i++) {
    const entry = createBombEntry();
    entry.core.visible = false;
    bombPickups.push(entry);
  }

  /* ----- state --------------------------------------------------- */
  const setPickupInactive = (entry) => {
    entry.active = false;
    entry.core.visible = false;
  };
  const setWingPickupInactive = (entry) => {
    entry.active = false;
    entry.core.visible = false;
  };

  function spawnWingRepairAt(position) {
    if (!position) return false;
    let entry = wingPickups.find(p => !p.active && !p.pending);
    if (!entry) return false;
    entry.group.position.copy(position);
    entry.baseY = position.y;
    entry.pending = false;
    entry.active = true;
    entry.core.visible = true;
    return true;
  }

  function spawnBluePickupAt(position) {
    if (!position) return false;
    let entry = bluePickups.find(p => !p.active && !p.pending);
    if (!entry) return false;
    entry.group.position.copy(position);
    entry.baseY = position.y;
    entry.pending = false;
    entry.active = true;
    entry.core.visible = true;
    return true;
  }

  const hasMissingWing = () => {
    const left = playerObj?.userData?.wingHpLeft;
    const right = playerObj?.userData?.wingHpRight;
    if (typeof left !== 'number' || typeof right !== 'number') return false;
    return left <= 0 || right <= 0;
  };

  const shouldSpawnAt = (spawnZ, playerZ) => {
    const dz = playerZ - spawnZ;
    return dz >= 0 && dz <= PICKUP_SPAWN_DISTANCE;
  };

  function update(dt, t) {
    playerObj.getWorldPosition(tmp2);
    const playerZ = tmp2.z;
    const missingWing = hasMissingWing();
    const hasDualGreen = lasers?.isDual?.() && !lasers?.isBlue?.();
    const hasDualBlue = lasers?.isDual?.() && lasers?.isBlue?.();

    pickups.forEach((entry) => {
      if (entry.pending) {
        if (shouldSpawnAt(entry.group.position.z, playerZ)) {
          if (missingWing) {
            spawnWingRepairAt(entry.group.position);
            entry.pending = false;
            entry.active = false;
            entry.core.visible = false;
            return;
          }
          if (hasDualBlue) {
            if (spawnWingRepairAt(entry.group.position)) {
              entry.pending = false;
              entry.active = false;
              entry.core.visible = false;
              return;
            }
          }
          if (hasDualGreen) {
            if (spawnBluePickupAt(entry.group.position)) {
              entry.pending = false;
              entry.active = false;
              entry.core.visible = false;
              return;
            }
          }
          entry.pending = false;
          entry.active = true;
          entry.core.visible = true;
        } else {
          return;
        }
      }
      if (!entry.active) return;
      if (missingWing) {
        spawnWingRepairAt(entry.group.position);
        setPickupInactive(entry);
        return;
      }
      const grp = entry.group;

      /* spin & bob */
      grp.position.y  = entry.baseY + Math.sin(t * 0.001) * 1.8;

      /* world-space collision check (6 u sphere → 36) */
      grp.getWorldPosition(tmp1);
      if (tmp1.distanceToSquared(tmp2) < 36) {
        setPickupInactive(entry);
        lasers.enableDual(true);        // activate dual fire
        lasers.enableBlue && lasers.enableBlue(false);
      }
    });

    bluePickups.forEach((entry) => {
      if (entry.pending) {
        if (shouldSpawnAt(entry.group.position.z, playerZ)) {
          if (missingWing) {
            spawnWingRepairAt(entry.group.position);
            entry.pending = false;
            entry.active = false;
            entry.core.visible = false;
            return;
          }
          entry.pending = false;
          entry.active = true;
          entry.core.visible = true;
        } else {
          return;
        }
      }
      if (!entry.active) return;
      if (missingWing) {
        spawnWingRepairAt(entry.group.position);
        setPickupInactive(entry);
        return;
      }
      const grp = entry.group;
      grp.position.y = entry.baseY + Math.sin(t * 0.001) * 1.8;
      grp.getWorldPosition(tmp1);
      if (tmp1.distanceToSquared(tmp2) < 36) {
        setPickupInactive(entry);
        lasers.enableDual(true);
        lasers.enableBlue && lasers.enableBlue(true);
      }
    });

    wingPickups.forEach(entry => {
      if (entry.pending) {
        if (shouldSpawnAt(entry.group.position.z, playerZ)) {
          entry.pending = false;
          entry.active = true;
          entry.core.visible = true;
        } else {
          return;
        }
      }
      if (!entry.active) return;
      const grp = entry.group;
      grp.rotation.y += 0.9 * dt;
      grp.position.y = entry.baseY + Math.sin(t * 0.001) * 1.8;
      grp.getWorldPosition(tmp1);
      if (tmp1.distanceToSquared(tmp2) < entry.pickupRadiusSq) {
        setWingPickupInactive(entry);
        playerObj.userData?.restoreWings?.();
      }
    });

    bombPickups.forEach(entry => {
      if (entry.pending) {
        if (shouldSpawnAt(entry.group.position.z, playerZ)) {
          entry.pending = false;
          entry.active = true;
          entry.core.visible = true;
        } else {
          return;
        }
      }
      if (!entry.active) return;
      const grp = entry.group;
      grp.rotation.y += 0.8 * dt;
      grp.position.y = entry.baseY + Math.sin(t * 0.001) * 1.2;
      grp.getWorldPosition(tmp1);
      if (tmp1.distanceToSquared(tmp2) < entry.pickupRadiusSq) {
        setPickupInactive(entry);
        onBombPickup(1);
      }
    });

    ringPickups.forEach(entry => {
      const grp = entry.mesh;
      if (entry.state === 'pending') {
        if (shouldSpawnAt(grp.position.z, playerZ)) {
          entry.state = 'idle';
          entry.mesh.visible = true;
          entry.mesh.scale.setScalar(RING_SCALE);
          entry.mesh.rotation.set(0, 0, 0);
        } else {
          return;
        }
      }
      if (!grp.visible) return;
      if (entry.state === 'idle') {
        grp.rotation.y += 1.0 * dt;
        grp.position.y = entry.baseY + Math.sin(t * 0.001) * 2.4;

        grp.getWorldPosition(tmp1);
        const dz = tmp1.z - tmp2.z;
        if (Math.abs(dz) <= RING_HALF_DEPTH) {
          const dx = tmp1.x - tmp2.x;
          const dy = tmp1.y - tmp2.y;
          if ((dx * dx + dy * dy) <= RING_RADIUS2) {
            entry.state = 'collecting';
            entry.animT = 0;
            entry.spin = 0;
            grp.rotation.set(0, 0, 0);
            gainHeart(1);
            onRingCollected(1);
          }
        }
      } else if (entry.state === 'collecting') {
        entry.animT += dt;
        const alpha = Math.min(1, entry.animT / RING_COLLECT_DURATION);
        entry.spin += RING_SPIN_SPEED * dt;
        grp.position.copy(tmp2);
        grp.rotation.z = entry.spin;
        const shrink = THREE.MathUtils.lerp(1, 0.05, alpha);
        grp.scale.setScalar(RING_SCALE * shrink);
        if (alpha >= 1) {
          entry.state = 'done';
          grp.visible = false;
        }
      }
    });
  }


  function prewarm(renderer, camera) {
    const prevSize = renderer.getSize(new THREE.Vector2());
    const tmpCamPos = new THREE.Vector3();
    const tmpCamDir = new THREE.Vector3();
    const tmpWarmPos = new THREE.Vector3();
    const warmState = [];

    camera.getWorldPosition(tmpCamPos);
    camera.getWorldDirection(tmpCamDir);
    tmpWarmPos.copy(tmpCamPos).add(tmpCamDir.multiplyScalar(20));

    const warmPickup = (entry, offsetX = 0) => {
      if (!entry?.group) return;
      warmState.push({
        type: 'pickup',
        entry,
        visible: entry.group.visible,
        coreVisible: entry.core.visible,
        position: entry.group.position.clone(),
        rotation: entry.group.rotation.clone()
      });
      entry.group.visible = true;
      entry.core.visible = true;
      entry.group.position.copy(tmpWarmPos).add(new THREE.Vector3(offsetX, 0, 0));
      entry.group.rotation.set(0, 0, 0);
    };

    const warmRing = (entry, offsetX = 0) => {
      if (!entry?.mesh) return;
      warmState.push({
        type: 'ring',
        entry,
        visible: entry.mesh.visible,
        position: entry.mesh.position.clone(),
        rotation: entry.mesh.rotation.clone(),
        scale: entry.mesh.scale.clone()
      });
      entry.mesh.visible = true;
      entry.mesh.position.copy(tmpWarmPos).add(new THREE.Vector3(offsetX, 0, 0));
      entry.mesh.rotation.set(0, 0, 0);
      entry.mesh.scale.setScalar(RING_SCALE);
    };

    warmPickup(pickups[0], -8);
    warmPickup(bluePickups[0], -4);
    warmPickup(wingPickups[0], 6);
    warmPickup(bombPickups[0], 10);
    warmRing(ringPickups[0], 0);

    renderer.setSize(64, 64, false);
    renderer.render(scene, camera);
    renderer.setSize(prevSize.x, prevSize.y, false);

    warmState.forEach(state => {
      if (state.type === 'pickup') {
        const entry = state.entry;
        entry.group.visible = state.visible;
        entry.core.visible = state.coreVisible;
        entry.group.position.copy(state.position);
        entry.group.rotation.copy(state.rotation);
      } else if (state.type === 'ring') {
        const entry = state.entry;
        entry.mesh.visible = state.visible;
        entry.mesh.position.copy(state.position);
        entry.mesh.rotation.copy(state.rotation);
        entry.mesh.scale.copy(state.scale);
      }
    });
  }

  function idleCull(playerZ = 0) {
    for (let i = 0; i < pickups.length; i++) {
      const entry = pickups[i];
      if (entry.pending) {
        if (entry.group.position.z > playerZ + 30) {
          entry.pending = false;
          entry.active = false;
          entry.core.visible = false;
        }
        continue;
      }
      if (!entry.active) continue;
      if (entry.group.position.z > playerZ + 30) {
        setPickupInactive(entry);
      }
    }
    for (let i = 0; i < bluePickups.length; i++) {
      const entry = bluePickups[i];
      if (entry.pending) {
        if (entry.group.position.z > playerZ + 30) {
          entry.pending = false;
          entry.active = false;
          entry.core.visible = false;
        }
        continue;
      }
      if (!entry.active) continue;
      if (entry.group.position.z > playerZ + 30) {
        setPickupInactive(entry);
      }
    }
    for (let i = 0; i < wingPickups.length; i++) {
      const entry = wingPickups[i];
      if (entry.pending) {
        if (entry.group.position.z > playerZ + 30) {
          entry.pending = false;
          entry.active = false;
          entry.core.visible = false;
        }
        continue;
      }
      if (!entry.active) continue;
      if (entry.group.position.z > playerZ + 30) {
        setWingPickupInactive(entry);
      }
    }
    for (let i = 0; i < bombPickups.length; i++) {
      const entry = bombPickups[i];
      if (entry.pending) {
        if (entry.group.position.z > playerZ + 30) {
          entry.pending = false;
          entry.active = false;
          entry.core.visible = false;
        }
        continue;
      }
      if (!entry.active) continue;
      if (entry.group.position.z > playerZ + 30) {
        setPickupInactive(entry);
      }
    }
    for (let i = 0; i < ringPickups.length; i++) {
      const entry = ringPickups[i];
      if (entry.state !== 'idle') continue;
      const grp = entry.mesh;
      if (grp.position.z > playerZ + 30) {
        entry.state = 'done';
        grp.visible = false;
      }
    }
  }

  function spawnHealRingAt(position) {
    if (!position) return false;
    const entry = ringPickups.find(p => p.state === 'done' && !p.mesh.visible);
    if (!entry) return false;
    entry.mesh.position.copy(position);
    entry.mesh.rotation.set(0, 0, 0);
    entry.mesh.scale.setScalar(RING_SCALE);
    entry.mesh.visible = true;
    entry.baseY = position.y;
    entry.state = 'idle';
    entry.animT = 0;
    entry.spin = 0;
    return true;
  }

  function materializeAll() {
    const out = [];
    pickups.forEach(entry => {
      if (!entry.spawnRef) return;
      entry.pending = false;
      entry.active = true;
      entry.core.visible = true;
      entry.group.visible = true;
      out.push(entry.group);
    });
    bluePickups.forEach(entry => {
      if (!entry.spawnRef) return;
      entry.pending = false;
      entry.active = true;
      entry.core.visible = true;
      entry.group.visible = true;
      out.push(entry.group);
    });
    wingPickups.forEach(entry => {
      if (!entry.spawnRef) return;
      entry.pending = false;
      entry.active = true;
      entry.core.visible = true;
      entry.group.visible = true;
      out.push(entry.group);
    });
    bombPickups.forEach(entry => {
      if (!entry.spawnRef) return;
      entry.pending = false;
      entry.active = true;
      entry.core.visible = true;
      entry.group.visible = true;
      out.push(entry.group);
    });
    ringPickups.forEach(entry => {
      if (!entry.spawnRef) return;
      entry.state = 'idle';
      entry.mesh.visible = true;
      out.push(entry.mesh);
    });
    return out;
  }

  return { update, prewarm, idleCull, spawnHealRingAt, materializeAll };
}
