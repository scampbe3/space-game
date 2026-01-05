import * as THREE from './libs/build/three.module.js';

export function createBossMissileSystem(scene, {
  playerObj,
  explosionPool,
  headMesh,
  poolSize = 12
} = {}) {
  const FORWARD = new THREE.Vector3(0, 1, 0);
  const missiles = [];
  const active = [];
  const tmpV = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpPrewarmPos = new THREE.Vector3();
  const tmpPrewarmDir = new THREE.Vector3();
  const burstQueue = [];
  let burstTimer = 0;
  const BURST_SPACING = 0.36;
  let spawningEnabled = true;

  function makeMissile() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x888888, transparent: true, opacity: 0.7 });
    const tipMat  = new THREE.MeshPhongMaterial({ color: 0xffaa66, transparent: true, opacity: 0.7 });
    const finMat  = new THREE.MeshPhongMaterial({ color: 0xffaa66, transparent: true, opacity: 0.7 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 6), bodyMat);
    body.position.y = 1;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 6), tipMat);
    tip.position.y = 3;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.8), finMat);
    fin.position.y = -0.2;
    fin.rotation.y = Math.PI / 2;
    const fin2 = fin.clone();
    fin2.rotation.y = 0;
    const exhaust = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 6), glowMat);
    exhaust.scale.set(0.5, 0.3, 1.5);
    exhaust.position.y = -1.2;

    group.add(body, tip, fin, fin2, exhaust);
    group.visible = false;
    group.userData = {
      hp: 1,
      blink: () => {},
      dead: false,
      enemy: true,
      hitRadius: 1.2,
      state: 'idle',
      t: 0,
      vel: new THREE.Vector3()
    };
    scene.add(group);
    group.rotateX(-Math.PI * 0.5); // align cone tip to +Z
    return group;
  }

  for (let i = 0; i < poolSize; i++) missiles.push(makeMissile());

  function spawnBurst() {
    if (!headMesh || !spawningEnabled) return;
    headMesh.updateWorldMatrix(true, true);
    const headPos = headMesh.getWorldPosition(new THREE.Vector3());
    const offsets = [-9, -5, -2, 2, 5, 9];
    offsets.forEach((ox, idx) => {
      burstQueue.push({
        ox,
        dirSign: idx < offsets.length / 2 ? -1 : 1,
        origin: headPos.clone()
      });
    });
    burstTimer = 0;
  }

  function launchQueuedMissile(entry) {
    if (!entry) return;
    const m = missiles.find(mi => !mi.visible);
    if (!m) return;
    const { ox, dirSign, origin } = entry;
    m.visible = true;
    m.userData.dead = false;
    m.userData.hp = 1;
    m.userData.noScore = true;
    m.userData.state = 'launch';
    m.userData.t = 0;
    m.userData.dirSign = dirSign;
    m.userData.pastPlayer = false;
    const spawnPos = origin.clone().add(new THREE.Vector3(ox, -4, 0));
    m.position.copy(spawnPos);
    m.userData.vel.set(0, -8, 0);
    if (playerObj) {
      const targetPos = playerObj.getWorldPosition(new THREE.Vector3());
      const dir = targetPos.sub(m.position).normalize();
      m.quaternion.setFromUnitVectors(FORWARD, dir);
    } else {
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), FORWARD);
    }
    active.push(m);
  }

  function destroyMissile(m) {
    m.visible = false;
    m.userData.dead = true;
    explosionPool?.spawn(m.position);
  }

  function clearAll() {
    burstQueue.length = 0;
    active.forEach(m => { m.visible = false; m.userData.dead = true; });
    active.length = 0;
  }

  function update(dt, player) {
    for (let i = active.length - 1; i >= 0; i--) {
      const m = active[i];
      if (!m.visible) { active.splice(i,1); continue; }
      const ud = m.userData;
      ud.t += dt;
      const playerPos = player.getWorldPosition(tmpV);

      if (ud.state === 'launch' && ud.t > 0.35) {
        ud.state = 'arc';
      } else if (ud.state === 'arc' && ud.t > 0.8) {
        ud.state = 'home';
      }

      if (ud.state === 'launch') {
        // initial drop
        m.userData.vel.set(0, -20, 10);
      } else if (!ud.pastPlayer) {
        // steer toward player after the drop/arc phase
        tmpDir.subVectors(playerPos, m.position).normalize();
        const targetVel = tmpDir.multiplyScalar(42); // faster homing to visibly track the player
        // stronger steering so path clearly curves toward the player
        m.userData.vel.lerp(targetVel, 0.65);
      }

      m.position.addScaledVector(m.userData.vel, dt);

      // orient nose toward player for visual alignment (even after passing the player)
      tmpDir.subVectors(playerPos, m.position);
      if (tmpDir.lengthSq() > 1e-6) {
        tmpDir.normalize();
        m.quaternion.setFromUnitVectors(FORWARD, tmpDir);
      }

      // once a missile crosses the player's plane, stop steering so it doesn't curl back
      if (!ud.pastPlayer && m.position.z >= playerPos.z) {
        ud.pastPlayer = true;
      }

      // out-of-range cleanup
      if (m.position.distanceToSquared(playerPos) < (m.userData.hitRadius + 1.2) ** 2) {
        destroyMissile(m);
        player.userData?.onHit?.(m.position);
        active.splice(i,1);
        continue;
      }
      if (m.position.z > playerPos.z + 20) {
        m.visible = false;
        active.splice(i,1);
      }
    }

    processBurstQueue(dt);
  }

  function processBurstQueue(dt) {
    if (!burstQueue.length) return;
    burstTimer -= dt;
    while (burstQueue.length && burstTimer <= 0) {
      const entry = burstQueue.shift();
      launchQueuedMissile(entry);
      burstTimer += BURST_SPACING;
    }
  }

  function getActiveShips() {
    return active.filter(m => m.visible && !m.userData.dead);
  }

  function setSpawning(flag) {
    spawningEnabled = flag;
    if (!flag) {
      burstQueue.length = 0;
      clearAll();
    }
  }

  function prewarm(renderer, camera, { layer = null } = {}) {
    if (!renderer || !camera || missiles.length === 0) return;
    const m = missiles[0];
    const prev = {
      visible: m.visible,
      position: m.position.clone(),
      quaternion: m.quaternion.clone(),
      layerMask: m.layers.mask
    };
    const prevCulls = [];
    m.visible = true;
    if (typeof layer === 'number') {
      m.layers.set(layer);
    }
    camera.getWorldPosition(tmpPrewarmPos);
    camera.getWorldDirection(tmpPrewarmDir);
    m.position.copy(tmpPrewarmPos).addScaledVector(tmpPrewarmDir, 25);
    m.quaternion.copy(camera.quaternion);
    m.traverse(o => {
      if (o.isMesh) {
        prevCulls.push([o, o.frustumCulled]);
        o.frustumCulled = false;
      }
    });
    renderer.render(scene, camera);
    prevCulls.forEach(([o, c]) => { o.frustumCulled = c; });
    m.visible = prev.visible;
    m.position.copy(prev.position);
    m.quaternion.copy(prev.quaternion);
    m.layers.mask = prev.layerMask;
  }

  return { spawnBurst, update, getActiveShips, setSpawning, clearAll, prewarm };
}
