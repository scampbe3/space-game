import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

export async function initFrigateEnemySystem(scene, {
  spawnArray,
  playerObj,
  boltPool = null,
  canFire = null,
  hazardEntries = null,
  spawnBlue = null,
  modelPath = './models/dark_frigate.glb',
  scale = 30,
  moveSpeed = 3,
  hp = 40,
  scoreValue = 400,
  wingBurstCount = 10,
  wingBurstInterval = 0.30,
  wingBurstPause = 2.0,
  noseFireInterval = 1.3,
  bigLaserScale = 2.2,
  spawnInterval = 3.0,
  spawnLimit = 3,
  spawnRadius = 420,
  cullBehind = 30,
  faceMinDistance = 140,
  yaw = 0,
  forwardAxis = new THREE.Vector3(-1, 0, 0),
  materialMode = 'standard',
  editorGroup = null
} = {}) {
  if (!Array.isArray(spawnArray) || spawnArray.length === 0) {
    return { update: () => {}, getActiveShips: () => [] };
  }

  const loader = new GLTFLoader();
  const proto = (await loader.loadAsync(modelPath)).scene;
  const useLambert = materialMode === 'lambert';

  const baseBox = new THREE.Box3().setFromObject(proto);
  const baseSize = new THREE.Vector3();
  const baseCenter = new THREE.Vector3();
  baseBox.getSize(baseSize);
  baseBox.getCenter(baseCenter);

  const baseHitRadius = Math.max(baseSize.x, baseSize.z) * 0.35;
  const hitBoxes = [];
  {
    const rootInv = new THREE.Matrix4();
    const tmpVec = new THREE.Vector3();
    proto.updateMatrixWorld(true);
    rootInv.copy(proto.matrixWorld).invert();

    const maxDim = Math.max(baseSize.x, baseSize.y, baseSize.z) || 1;
    const gridX = Math.min(14, Math.max(6, Math.round((baseSize.x / maxDim) * 12)));
    const gridY = Math.min(14, Math.max(8, Math.round((baseSize.y / maxDim) * 12)));
    const gridZ = Math.min(14, Math.max(6, Math.round((baseSize.z / maxDim) * 12)));
    const cellCount = gridX * gridY * gridZ;
    const filled = new Uint8Array(cellCount);
    const baseMin = baseBox.min;
    const sizeX = baseSize.x || 1e-6;
    const sizeY = baseSize.y || 1e-6;
    const sizeZ = baseSize.z || 1e-6;
    const invSizeX = 1 / sizeX;
    const invSizeY = 1 / sizeY;
    const invSizeZ = 1 / sizeZ;
    const toIndex = (ix, iy, iz) => ix + gridX * (iy + gridY * iz);
    let sawVertex = false;

    proto.traverse(node => {
      if (!node.isMesh || !node.geometry || !node.geometry.attributes?.position) return;
      const posAttr = node.geometry.attributes.position;
      const mat = node.matrixWorld;
      for (let i = 0, n = posAttr.count; i < n; i++) {
        tmpVec.fromBufferAttribute(posAttr, i);
        tmpVec.applyMatrix4(mat);
        tmpVec.applyMatrix4(rootInv);
        const ix = Math.min(gridX - 1, Math.max(0, Math.floor(((tmpVec.x - baseMin.x) * invSizeX) * gridX)));
        const iy = Math.min(gridY - 1, Math.max(0, Math.floor(((tmpVec.y - baseMin.y) * invSizeY) * gridY)));
        const iz = Math.min(gridZ - 1, Math.max(0, Math.floor(((tmpVec.z - baseMin.z) * invSizeZ) * gridZ)));
        filled[toIndex(ix, iy, iz)] = 1;
        sawVertex = true;
      }
    });

    if (sawVertex) {
      for (let iz = 0; iz < gridZ; iz++) {
        const z0 = baseMin.z + (iz / gridZ) * sizeZ;
        const z1 = baseMin.z + ((iz + 1) / gridZ) * sizeZ;
        for (let iy = 0; iy < gridY; iy++) {
          const y0 = baseMin.y + (iy / gridY) * sizeY;
          const y1 = baseMin.y + ((iy + 1) / gridY) * sizeY;
          for (let ix = 0; ix < gridX; ix++) {
            if (!filled[toIndex(ix, iy, iz)]) continue;
            const x0 = baseMin.x + (ix / gridX) * sizeX;
            const x1 = baseMin.x + ((ix + 1) / gridX) * sizeX;
            hitBoxes.push(new THREE.Box3(
              new THREE.Vector3(x0, y0, z0),
              new THREE.Vector3(x1, y1, z1)
            ));
          }
        }
      }
    } else {
      hitBoxes.push(baseBox.clone());
    }
  }

  const forwardAxisNorm = forwardAxis.clone().normalize();
  const axisUp = new THREE.Vector3(0, 1, 0);
  const axisRight = new THREE.Vector3().crossVectors(axisUp, forwardAxisNorm).normalize();
  const baseCorners = [
    new THREE.Vector3(baseBox.min.x, baseBox.min.y, baseBox.min.z),
    new THREE.Vector3(baseBox.min.x, baseBox.min.y, baseBox.max.z),
    new THREE.Vector3(baseBox.min.x, baseBox.max.y, baseBox.min.z),
    new THREE.Vector3(baseBox.min.x, baseBox.max.y, baseBox.max.z),
    new THREE.Vector3(baseBox.max.x, baseBox.min.y, baseBox.min.z),
    new THREE.Vector3(baseBox.max.x, baseBox.min.y, baseBox.max.z),
    new THREE.Vector3(baseBox.max.x, baseBox.max.y, baseBox.min.z),
    new THREE.Vector3(baseBox.max.x, baseBox.max.y, baseBox.max.z)
  ];
  function axisExtents(axis) {
    let min = Infinity;
    let max = -Infinity;
    baseCorners.forEach(corner => {
      const v = corner.dot(axis);
      if (v < min) min = v;
      if (v > max) max = v;
    });
    const center = baseCenter.dot(axis);
    return { min, max, length: max - min, center };
  }
  const fExt = axisExtents(forwardAxisNorm);
  const rExt = axisExtents(axisRight);
  const uExt = axisExtents(axisUp);
  const buildLocalPos = (forward, right, up) => (
    baseCenter.clone()
      .addScaledVector(forwardAxisNorm, forward - fExt.center)
      .addScaledVector(axisRight, right - rExt.center)
      .addScaledVector(axisUp, up - uExt.center)
  );
  const noseForward = fExt.max - fExt.length * 0.01;
  const wingForward = fExt.min + fExt.length * 0.22;
  const bellyForward = fExt.min + fExt.length * 0.42;
  const wingRight = rExt.max - rExt.length * 0.05;
  const wingLeft = rExt.min + rExt.length * 0.05;
  const noseRight = rExt.center + rExt.length * 0.03;
  const noseLeft = rExt.center - rExt.length * 0.03;
  const wingUp = uExt.center + uExt.length * 0.05;
  const noseUp = uExt.center - uExt.length * 0.02;
  const bellyUp = uExt.min + uExt.length * 0.12;
  const baseWingLeft = buildLocalPos(wingForward, wingLeft, wingUp);
  const baseWingRight = buildLocalPos(wingForward, wingRight, wingUp);
  const baseNoseLeft = buildLocalPos(noseForward, noseLeft, noseUp);
  const baseNoseRight = buildLocalPos(noseForward, noseRight, noseUp);
  const baseBelly = buildLocalPos(bellyForward, rExt.center, bellyUp);

  const yawFixQ = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const BOLT_POOL = boltPool ?? scene.userData?.boltPool ?? null;

  const ACTIVE = [];
  const ACTIVE_SHIPS = [];
  const spawnQueue = spawnArray.map((cfg, idx) => ({
    ...cfg,
    __spawnIdx: idx,
    __src: cfg,
    spawned: false
  }));

  function createFrigateInstance() {
    const ship = proto.clone(true);
    ship.visible = false;
    ship.userData = {
      enemy: true,
      enemyRoot: true,
      flashT: 0,
      hitBoxes,
      largeExplosion: true
    };

    const meshes = [];
    ship.traverse(n => {
      if (n.isMesh) {
        n.material = useLambert ? toLambert(n.material) : n.material.clone();
        n.userData.enemy = true;
        n.frustumCulled = false;
        meshes.push(n);
      }
    });
    ship.userData.meshes = meshes;
    ship.userData.blink = () => { ship.userData.flashT = 0.2; };
    scene.add(ship);
    return ship;
  }

  const shipPool = spawnQueue.map(() => {
    const ship = createFrigateInstance();
    ACTIVE.push(ship);
    return ship;
  });
  spawnQueue.forEach((cfg, i) => { cfg.ship = shipPool[i]; });

  const tmpPlayer = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpDir = new THREE.Vector3();
  const tmpForward = new THREE.Vector3();
  const tmpSpawn = new THREE.Vector3();
  const tmpOffset = new THREE.Vector3();
  const boltForward = new THREE.Vector3(0, 0, 1);
  const losHazards = [];
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

  function lookQuaternion(from, to, out) {
    tmpDir.copy(to).sub(from);
    if (tmpDir.lengthSq() > 1e-6) {
      tmpDir.normalize();
    } else {
      tmpDir.set(0, 0, 1);
    }
    return (out ?? tmpQuat).setFromUnitVectors(boltForward, tmpDir);
  }

  function fireLaser(worldPos, worldQuat, { big = false } = {}) {
    if (!BOLT_POOL) return;
    const handle = BOLT_POOL.alloc({
      big,
      life: big ? 1.8 : 1.8,
      dir: 1,
      bounced: false,
      scale: big ? bigLaserScale : 1
    });
    if (!handle) return;
    BOLT_POOL.setTransform(handle, worldPos, worldQuat, big ? bigLaserScale : 1);
  }

  function resetFrigate(ship, cfg) {
    const scaleMult = typeof cfg.scale === 'number' ? cfg.scale : 1;
    const totalScale = scale * scaleMult;
    ship.scale.setScalar(totalScale);
    ship.position.set(cfg.x, cfg.y, cfg.z);
    if (cfg.__src) {
      ship.userData.editorRef = cfg.__src;
      ship.userData.editorGroup = editorGroup;
      ship.userData.editorIndex = cfg.__spawnIdx;
    }
    ship.visible = true;
    ship.userData.dead = false;
    ship.userData.hp = typeof cfg.hp === 'number' ? cfg.hp : hp;
    ship.userData.scoreValue = typeof cfg.scoreValue === 'number' ? cfg.scoreValue : scoreValue;
    ship.userData.hitRadius = baseHitRadius * totalScale;
    ship.userData.dropHealRing = Boolean(cfg.dropHealRing);
    ship.userData.flashT = 0;
    ship.userData.wingBurstRemaining = wingBurstCount;
    ship.userData.wingBurstCooldown = 0;
    ship.userData.wingBurstShotT = 0;
    ship.userData.noseFireT = 0;
    ship.userData.noseSide = 1;
    ship.userData.spawnT = 0;
    const spawnCap = typeof cfg.spawnLimit === 'number' ? cfg.spawnLimit : spawnLimit;
    ship.userData.spawnRemaining = Number.isFinite(spawnCap) ? spawnCap : Infinity;
    ship.userData.spawnInterval = typeof cfg.spawnInterval === 'number'
      ? cfg.spawnInterval
      : spawnInterval;
    const yawOffset = typeof cfg.yaw === 'number' ? cfg.yaw : 0;
    if (!ship.userData.yawOffsetQ) ship.userData.yawOffsetQ = new THREE.Quaternion();
    ship.userData.yawOffsetQ.setFromAxisAngle(axisUp, yawOffset);
    if (!ship.userData.spawnOffsetVec) ship.userData.spawnOffsetVec = new THREE.Vector3();
    const spawnOffset = cfg.spawnOffset;
    if (spawnOffset && typeof spawnOffset === 'object') {
      ship.userData.spawnOffsetVec.set(
        Number(spawnOffset.x) || 0,
        Number(spawnOffset.y) || 0,
        Number(spawnOffset.z) || 0
      );
    } else if (typeof cfg.spawnOffsetY === 'number') {
      ship.userData.spawnOffsetVec.set(0, cfg.spawnOffsetY, 0);
    } else {
      ship.userData.spawnOffsetVec.set(0, 0, 0);
    }
    ship.userData.guns = {
      wingLeft: baseWingLeft.clone(),
      wingRight: baseWingRight.clone(),
      noseLeft: baseNoseLeft.clone(),
      noseRight: baseNoseRight.clone(),
      belly: baseBelly.clone()
    };
    ship.updateMatrixWorld(true);
  }

  function update(dt) {
    const allowFire = typeof canFire === 'function' ? canFire() : true;
    playerObj.getWorldPosition(tmpPlayer);

    let spawnedThisFrame = 0;
    const MAX_SPAWN_PER_FRAME = 1;
    for (let i = 0; i < spawnQueue.length && spawnedThisFrame < MAX_SPAWN_PER_FRAME; i++) {
      const cfg = spawnQueue[i];
      if (cfg.spawned) continue;
      tmpPos.set(cfg.x, cfg.y, cfg.z);
      if (tmpPos.distanceToSquared(tmpPlayer) <= spawnRadius * spawnRadius) {
        resetFrigate(cfg.ship, cfg);
        cfg.spawned = true;
        spawnedThisFrame += 1;
      }
    }

    ACTIVE_SHIPS.length = 0;
    ACTIVE.forEach(ship => {
      if (!ship.visible || ship.userData.dead) return;
      ACTIVE_SHIPS.push(ship);

      const distSq = ship.position.distanceToSquared(tmpPlayer);
      if (distSq >= faceMinDistance * faceMinDistance) {
        ship.lookAt(tmpPlayer);
        ship.quaternion.multiply(yawFixQ);
        ship.userData.yawOffsetQ && ship.quaternion.multiply(ship.userData.yawOffsetQ);
      }

      tmpForward.copy(forwardAxisNorm).applyQuaternion(ship.quaternion).normalize();
      ship.position.addScaledVector(tmpForward, moveSpeed * dt);

      if (ship.position.z > tmpPlayer.z + cullBehind) {
        ship.visible = false;
        ship.userData.dead = true;
        return;
      }

      if (allowFire) {
        if (ship.userData.wingBurstCooldown > 0) {
          ship.userData.wingBurstCooldown = Math.max(0, ship.userData.wingBurstCooldown - dt);
        } else {
          ship.userData.wingBurstShotT += dt;
          if (ship.userData.wingBurstShotT >= wingBurstInterval) {
            let fired = false;
            ship.localToWorld(tmpPos.copy(ship.userData.guns.wingLeft));
            if (hasLineOfSight(tmpPos, tmpPlayer)) {
              lookQuaternion(tmpPos, tmpPlayer, tmpQuat);
              fireLaser(tmpPos, tmpQuat);
              fired = true;
            }
            ship.localToWorld(tmpPos.copy(ship.userData.guns.wingRight));
            if (hasLineOfSight(tmpPos, tmpPlayer)) {
              lookQuaternion(tmpPos, tmpPlayer, tmpQuat);
              fireLaser(tmpPos, tmpQuat);
              fired = true;
            }
            if (fired) {
              ship.userData.wingBurstShotT = 0;
              ship.userData.wingBurstRemaining -= 1;
              if (ship.userData.wingBurstRemaining <= 0) {
                ship.userData.wingBurstRemaining = wingBurstCount;
                ship.userData.wingBurstCooldown = wingBurstPause;
              }
            } else {
              ship.userData.wingBurstShotT = wingBurstInterval;
            }
          }
        }

        ship.userData.noseFireT += dt;
        if (ship.userData.noseFireT >= noseFireInterval) {
          const useRight = ship.userData.noseSide > 0;
          ship.userData.noseSide *= -1;
          const noseLocal = useRight ? ship.userData.guns.noseRight : ship.userData.guns.noseLeft;
          ship.localToWorld(tmpPos.copy(noseLocal));
          if (hasLineOfSight(tmpPos, tmpPlayer)) {
            ship.userData.noseFireT = 0;
            lookQuaternion(tmpPos, tmpPlayer, tmpQuat);
            fireLaser(tmpPos, tmpQuat, { big: true });
          } else {
            ship.userData.noseFireT = noseFireInterval;
          }
        }

        if (spawnBlue && ship.userData.spawnRemaining > 0) {
          ship.userData.spawnT += dt;
          if (ship.userData.spawnT >= ship.userData.spawnInterval) {
            ship.userData.spawnT = 0;
            ship.localToWorld(tmpSpawn.copy(ship.userData.guns.belly));
            if (ship.userData.spawnOffsetVec?.lengthSq() > 1e-6) {
              tmpOffset.copy(ship.userData.spawnOffsetVec).applyQuaternion(ship.quaternion);
              tmpSpawn.add(tmpOffset);
            }
            spawnBlue(tmpSpawn);
            if (Number.isFinite(ship.userData.spawnRemaining)) {
              ship.userData.spawnRemaining -= 1;
            }
          }
        }
      }

      if (ship.userData.flashT > 0) {
        ship.userData.flashT = Math.max(0, ship.userData.flashT - dt);
      }
      const flashOn = ship.userData.flashT > 0;
      const r = flashOn ? 1 : 0;
      ship.userData.meshes.forEach(m => m.material.emissive.setRGB(r, 0, 0));
    });
  }

  function prewarm(renderer, camera) {
    const prev = shipPool.map(s => s.visible);
    shipPool.forEach(s => { s.visible = true; });
    renderer.compile(scene, camera);
    shipPool.forEach((s, i) => { s.visible = prev[i]; });
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
        quat: ship.quaternion.clone(),
        scale: ship.scale.clone()
      });
      ship.visible = true;
      ship.userData.dead = false;
      ship.userData.flashT = 0;
      ship.scale.setScalar(scale);
      if (origin) ship.position.copy(origin);
      if (right) {
        const offset = (i - (maxCount - 1) * 0.5) * spacing;
        ship.position.addScaledVector(right, offset);
      }
      if (up) ship.position.addScaledVector(up, (i % 2) * spacing * 0.1);
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
        state.ship.scale.copy(state.scale);
      });
    };
  }

  function materializeSpawns() {
    spawnQueue.forEach(cfg => {
      resetFrigate(cfg.ship, cfg);
    });
    return spawnQueue.map(cfg => cfg.ship);
  }

  return {
    update,
    getActiveShips: () => ACTIVE_SHIPS,
    prewarm,
    previewSetup,
    materializeSpawns
  };
}
