import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

export async function initAllyShip(scene, {
  railCurve,
  playerObj,
  laserSystem,
  enemySystem = null,
  enemyLasers = null,
  enemyBoltPool = null,
  explosionPool = null,
  onDialogue = null,
  onEscortOutcome = null,
  playerSpeed = 35,
  spawn = { x: 80, y: 12, z: -3500 },
  spawnTriggerZ = -3520,
  materialMode = 'standard'
} = {}) {
  const loader = new GLTFLoader();
  let modelProto = null;
  try {
    modelProto = (await loader.loadAsync('./models/player_starfighter_v2.glb')).scene;
  } catch (err) {
    console.warn('[ally] failed to load model', err);
  }

  if (!modelProto) {
    modelProto = new THREE.Mesh(
      new THREE.BoxGeometry(5, 2, 10),
      new THREE.MeshStandardMaterial({ color: 0x00aaff })
    );
  }

  const useLambert = materialMode === 'lambert';
  modelProto.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(modelProto);
  const boundsCenter = bounds.getCenter(new THREE.Vector3());
  const hitSphere = new THREE.Sphere();
  const hitRadius = bounds.isEmpty() ? 4 : bounds.getBoundingSphere(hitSphere).radius;
  const nosePoint = (!bounds.isEmpty())
    ? new THREE.Vector3(boundsCenter.x, boundsCenter.y, bounds.max.z)
    : null;

  const glowGeo = new THREE.CircleGeometry(0.2, 20);
  glowGeo.scale(1.4, 0.85, 1);
  const makeGlowMat = (hex, opacity, softness = 0.35) => new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: new THREE.Color(hex) },
      opacity: { value: opacity },
      softness: { value: softness }
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  color;
      uniform float opacity;
      uniform float softness;
      varying vec2  vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p);
        float mask = 1.0 - smoothstep(1.0 - softness, 1.0, d);
        gl_FragColor = vec4(color, opacity * mask);
      }
    `
  });

  const engineZ = bounds.isEmpty() ? -1.0 : (bounds.min.z - 0.2);

  const createAllyRoot = () => {
    const root = new THREE.Object3D();
    root.visible = false;

    const model = modelProto.clone(true);
    const meshList = [];
    model.traverse(o => {
      if (!o.isMesh) return;
      o.material = useLambert ? toLambert(o.material) : o.material.clone();
      o.frustumCulled = false;
      meshList.push(o);
    });
    root.add(model);

    if (nosePoint) {
      root.userData.chargeNoseOffsetZ = bounds.max.z;
      root.userData.chargeNosePoint = nosePoint.clone();
    }

    const outerGlow = new THREE.Mesh(glowGeo, makeGlowMat(0x00ccff, 0.45, 0.45));
    outerGlow.position.set(boundsCenter.x, boundsCenter.y, engineZ);
    outerGlow.frustumCulled = false;
    root.add(outerGlow);

    const innerGlow = new THREE.Mesh(glowGeo, makeGlowMat(0x0077c8, 0.55, 0.35));
    innerGlow.scale.set(0.6, 0.6, 0.6);
    innerGlow.position.set(boundsCenter.x, boundsCenter.y, engineZ - 0.01);
    innerGlow.frustumCulled = false;
    root.add(innerGlow);

    root.userData._blinkMeshes = meshList;
    root.userData._blinkBase = meshList.map(m => (m.material?.emissive ? m.material.emissive.clone() : null));
    root.userData.flashT = 0;
    root.userData.hitRadius = hitRadius * 0.9;

    scene.add(root);
    return root;
  };

  const root = createAllyRoot();
  const escortRoot = createAllyRoot();

  const spawnPos = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  const targetA = new THREE.Vector3(80, -10, -4002);
  const targetB = new THREE.Vector3(95, -10, -4003);
  const fireSequence = [targetA, targetA, targetA, targetB, targetB, targetB];
  const ATTACK_START_MAX = 210;
  const ATTACK_START_MAX_SQ = ATTACK_START_MAX * ATTACK_START_MAX;
  const FORWARD_TARGET = 20;
  const APPROACH_SPEED = 35;
  const FOLLOW_LERP = 2.0;
  const FIRE_DELAY = 0.35;
  const FIRE_INTERVAL = 0.22;
  const EXIT_DELAY = 1.4;
  const EXIT_FORWARD_SPEED = 35;
  const EXIT_LEFT_SPEED = 20;
  const EXIT_UP_SPEED = 20;
  const EXIT_DURATION = 5.0;
  const ROLL_TIME = 0.6;

  const ESCORT_TRIGGER_Z = -1280;
  const ESCORT_RESUME_Z = -1470;
  const ESCORT_WAYPOINTS = [
        new THREE.Vector3(-210, 30, -1450),
    new THREE.Vector3(-52, 15, -1600),
    new THREE.Vector3(12, 22, -1845)
  ];
  const ESCORT_SPAWN_POS = ESCORT_WAYPOINTS[0].clone();
  const ESCORT_CHASER_CLEANUP_PAD = 20;
  const ESCORT_CHASER_CLEANUP_Z = ESCORT_WAYPOINTS[ESCORT_WAYPOINTS.length - 1].z - ESCORT_CHASER_CLEANUP_PAD;
  const ESCORT_CHASER_SPAWNS = [
    new THREE.Vector3(-350, 20, -1470),
    new THREE.Vector3(-360, 10, -1470),
    new THREE.Vector3(-370, -10, -1470),
    new THREE.Vector3(-380, -20, -1470)
  ];
  const ESCORT_CHASER_OFFSETS = [
    new THREE.Vector3(6, 6, 12),
    new THREE.Vector3(-6, 6, 14),
    new THREE.Vector3(7, -6, 13),
    new THREE.Vector3(-7, -6, 12)
  ];
  const ESCORT_SLOW_MULT = 0.9;
  const ESCORT_MATCH_LERP = 2.5;
  const ESCORT_WAYPOINT_EPS = 6;
  const ESCORT_CHASER_SPEED = playerSpeed * 1.15;
  const ESCORT_ROLL_INTERVAL = 1.8;
  const ESCORT_EXIT_FORWARD_SPEED = playerSpeed;
  const ESCORT_EXIT_RIGHT_SPEED = 20;
  const ESCORT_EXIT_UP_SPEED = 20;

  const ESCORT_SCALE = 3.5;

  const TARGET_X = 35;
  const TARGET_Y = 10;
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const forwardAxis = new THREE.Vector3(0, 0, 1);
  const FORWARD_FIX = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, Math.PI);
  const tmpPlayerPos = new THREE.Vector3();
  const tmpForward = new THREE.Vector3(0, 0, -1);
  const tmpRailForward = new THREE.Vector3(0, 0, -1);
  const tmpRight = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);
  const tmpDesired = new THREE.Vector3();
  const tmpAim = new THREE.Vector3();
  const tmpLookMat = new THREE.Matrix4();
  const tmpLookTarget = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpRollQuat = new THREE.Quaternion();
  const tmpExitVel = new THREE.Vector3();
  const tmpExitForward = new THREE.Vector3();
  const tmpEscortExitVel = new THREE.Vector3();
  const tmpEscortExitForward = new THREE.Vector3();
  const tmpEscortDir = new THREE.Vector3();
  const tmpSeg = new THREE.Vector3();
  const tmpToCenter = new THREE.Vector3();
  const tmpClosest = new THREE.Vector3();
  const tmpBoltDir = new THREE.Vector3();
  const tmpBoltPos = new THREE.Vector3();
  const tmpAxisZ = new THREE.Vector3(0, 0, 1);
  const railLength = railCurve.getLength();

  let active = false;
  let spawned = false;
  let state = 'idle';
  let forwardOffset = -10;
  let rightOffset = 0;
  let upOffset = 0;
  let attackElapsed = 0;
  let fireIndex = 0;
  let exitElapsed = 0;
  let rollT = 0;
  let rollAngle = 0;

  let escortActive = false;
  let escortSpawned = false;
  let escortState = 'idle';
  let escortSpeed = 0;
  let escortWaypoint = 0;
  let escortRollT = 0;
  let escortRollAngle = 0;
  let escortRollCooldown = ESCORT_ROLL_INTERVAL;
  let escortExitElapsed = 0;
  let escortDestroyTimer = 0;
  const escortChasers = [];
  let prevPlayerT = null;
  let playerSpeedNow = playerSpeed;
  let escortOutcomeSent = false;
  let escortCleanupDone = false;

  function spawnNow(playerPos, forward, right, up) {
    root.position.copy(spawnPos);
    root.visible = true;
    active = true;
    state = 'approach';
    attackElapsed = 0;
    fireIndex = 0;
    exitElapsed = 0;
    rollT = 0;
    rollAngle = 0;

    forwardOffset = -10;
    rightOffset = 0;
    upOffset = 0;
    emitDialogue({
      id: 'turret-ally-spawn',
      portraitSrc: './textures/red.png',
      textLines: ["I'll take out the turrets on the right!"]
    });
  }

  const triggerBlink = (targetRoot) => {
    if (!targetRoot?.userData) return;
    targetRoot.userData.flashT = 0.15;
    const meshes = targetRoot.userData._blinkMeshes ?? [];
    meshes.forEach(m => {
      if (m.material?.emissive) m.material.emissive.setRGB(1, 0, 0);
    });
  };

  const updateBlink = (targetRoot, dt) => {
    if (!targetRoot?.userData) return;
    const ud = targetRoot.userData;
    if (!ud.flashT) return;
    ud.flashT = Math.max(0, ud.flashT - dt);
    if (ud.flashT > 0) return;
    const meshes = ud._blinkMeshes ?? [];
    const base = ud._blinkBase ?? [];
    meshes.forEach((m, i) => {
      if (!m.material?.emissive) return;
      const baseColor = base[i];
      if (baseColor) m.material.emissive.copy(baseColor);
      else m.material.emissive.setRGB(0, 0, 0);
    });
  };

  const emitDialogue = (payload) => {
    if (typeof onDialogue === 'function') {
      onDialogue(payload);
      return;
    }
    if (typeof globalThis?.postMessage === 'function' && globalThis.__IS_RENDER_WORKER) {
      globalThis.postMessage({ type: 'dialogue', payload });
    }
  };

  function segmentSphereHit(a, b, center, radiusSq) {
    tmpSeg.copy(b).sub(a);
    const segLenSq = tmpSeg.lengthSq();
    let t = 0;
    if (segLenSq > 1e-8) {
      tmpToCenter.copy(center).sub(a);
      t = tmpToCenter.dot(tmpSeg) / segLenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    tmpClosest.copy(a).addScaledVector(tmpSeg, t);
    return tmpClosest.distanceToSquared(center) <= radiusSq;
  }

  function spawnEscort() {
    escortRoot.position.copy(ESCORT_SPAWN_POS);
    escortRoot.visible = true;
    escortRoot.traverse(o => {
      if (o.isMesh) o.visible = true;
    });
    escortRoot.scale.setScalar(ESCORT_SCALE);
    escortRoot.updateMatrixWorld(true);
    escortActive = true;
    escortState = 'path';
    const baseSpeed = Number.isFinite(playerSpeedNow) ? playerSpeedNow : playerSpeed;
    escortSpeed = baseSpeed * ESCORT_SLOW_MULT;
    escortWaypoint = Math.min(1, ESCORT_WAYPOINTS.length - 1);
    escortRollT = 0;
    escortRollAngle = 0;
    escortRollCooldown = ESCORT_ROLL_INTERVAL;
    escortExitElapsed = 0;
    escortDestroyTimer = 0;
    escortChasers.length = 0;
    escortOutcomeSent = false;
    escortCleanupDone = false;
    spawnEscortChasers();
    emitDialogue({
      id: 'escort-spawn',
      portraitSrc: './textures/green.png',
      textLines: ["They're on me! I can't shake 'em!"]
    });
  }

  function spawnEscortChaser(pos, idx = 0) {
    if (!enemySystem?.spawnManual || !pos) return;
    const chaser = enemySystem.spawnManual(pos, {
      state: 'chase',
      onSpawn: (ship) => {
        ship.userData.chaseTarget = escortRoot;
        ship.userData.chaseOffset = ESCORT_CHASER_OFFSETS[idx % ESCORT_CHASER_OFFSETS.length];
        ship.userData.chaseOffsetMode = 'world';
        ship.userData.chaseMinDist = 6;
        ship.userData.chaseSpeed = ESCORT_CHASER_SPEED;
        ship.userData.allyChaser = true;
        ship.userData.noCullBehind = true;
        ship.userData.fireT = 999;
      }
    });
    if (chaser) escortChasers.push(chaser);
  }

  function spawnEscortChasers() {
    ESCORT_CHASER_SPAWNS.forEach((pos, idx) => spawnEscortChaser(pos, idx));
  }

  function countAliveChasers() {
    let alive = 0;
    for (let i = 0; i < escortChasers.length; i++) {
      const ship = escortChasers[i];
      if (!ship || !ship.visible || ship.userData?.dead) continue;
      alive += 1;
    }
    return alive;
  }

  function cleanupEscortChasers() {
    if (!escortChasers.length) return;
    for (let i = 0; i < escortChasers.length; i++) {
      const ship = escortChasers[i];
      if (!ship) continue;
      ship.visible = false;
      if (ship.userData) {
        ship.userData.dead = true;
        ship.userData.allyChaser = false;
        ship.userData.noCullBehind = false;
        ship.userData.chaseTarget = null;
      }
    }
    escortChasers.length = 0;
  }

  function checkEscortLaserHits() {
    const lasers = (typeof enemyLasers === 'function') ? enemyLasers() : enemyLasers;
    if (!lasers?.length || !escortRoot.visible) return;
    const radius = escortRoot.userData.hitRadius ?? 6;
    const radiusSq = radius * radius;
    const center = escortRoot.position;
    for (let i = 0; i < lasers.length; i++) {
      const bolt = lasers[i];
      if (!bolt?.userData?.active) continue;
      const prev = bolt.prev ?? bolt.position;
      if (segmentSphereHit(prev, bolt.position, center, radiusSq)) {
        bolt.userData.active = false;
        bolt.userData.life = 0;
        triggerBlink(escortRoot);
        break;
      }
    }
  }

  function fireEscortKillShots() {
    if (!enemyBoltPool?.alloc) return;
    const targetPos = escortRoot.position;
    for (let i = 0; i < escortChasers.length; i++) {
      const ship = escortChasers[i];
      if (!ship || !ship.visible || ship.userData?.dead) continue;
      const handle = enemyBoltPool.alloc({ big: false, life: 1.2, dir: 1, bounced: false });
      if (!handle) continue;
      ship.getWorldPosition(tmpBoltPos);
      tmpBoltDir.copy(targetPos).sub(tmpBoltPos);
      if (tmpBoltDir.lengthSq() < 1e-6) tmpBoltDir.set(0, 0, -1);
      tmpBoltDir.normalize();
      tmpQuat.setFromUnitVectors(tmpAxisZ, tmpBoltDir);
      enemyBoltPool.setTransform(handle, tmpBoltPos, tmpQuat);
    }
  }

  function updateOrientation(targetRoot, desiredForward, rollAngle = 0) {
    if (!targetRoot || desiredForward.lengthSq() < 1e-6) return;
    tmpAim.copy(desiredForward).normalize();
    tmpLookTarget.copy(targetRoot.position).add(tmpAim);
    tmpLookMat.lookAt(targetRoot.position, tmpLookTarget, WORLD_UP);
    tmpQuat.setFromRotationMatrix(tmpLookMat);
    targetRoot.quaternion.copy(tmpQuat);
    targetRoot.quaternion.multiply(FORWARD_FIX);
    if (rollAngle) {
      tmpRollQuat.setFromAxisAngle(forwardAxis, rollAngle);
      targetRoot.quaternion.multiply(tmpRollQuat);
    }
  }

  function update(dt, tPlayer) {
    if (!playerObj || !railCurve || !laserSystem?.fireAllyShot) return;
    playerObj.getWorldPosition(tmpPlayerPos);
    if (typeof tPlayer === 'number') {
      railCurve.getTangentAt(tPlayer, tmpRailForward).normalize();
      if (dt > 0 && Number.isFinite(tPlayer)) {
        if (prevPlayerT !== null) {
          const deltaT = tPlayer - prevPlayerT;
          const speed = Math.abs(deltaT) * railLength / dt;
          if (Number.isFinite(speed) && speed >= 0) {
            playerSpeedNow = speed;
          }
        }
        prevPlayerT = tPlayer;
      }
    } else {
      tmpRailForward.set(0, 0, -1);
    }
    tmpRight.copy(tmpRailForward).cross(tmpUp.set(0, 1, 0)).normalize();
    tmpUp.crossVectors(tmpRight, tmpRailForward).normalize();

    if (!spawned) {
      if (tmpPlayerPos.z <= spawnTriggerZ) {
        spawned = true;
        spawnNow(tmpPlayerPos, tmpRailForward, tmpRight, tmpUp);
      }
    }
    if (active) {
      if (state !== 'exit') {
        forwardOffset = Math.min(FORWARD_TARGET, forwardOffset + APPROACH_SPEED * dt);
        tmpDesired.copy(tmpPlayerPos)
          .addScaledVector(tmpRailForward, forwardOffset);
        tmpDesired.x = TARGET_X;
        tmpDesired.y = TARGET_Y;
        root.position.lerp(tmpDesired, Math.min(1, FOLLOW_LERP * dt));
      }

      if (state === 'approach') {
        const d2A = root.position.distanceToSquared(targetA);
        const d2B = root.position.distanceToSquared(targetB);
        if (Math.min(d2A, d2B) <= ATTACK_START_MAX_SQ) {
          state = 'attack';
          attackElapsed = 0;
        }
      }

      if (state === 'attack') {
        attackElapsed += dt;
        while (fireIndex < fireSequence.length &&
               attackElapsed >= FIRE_DELAY + fireIndex * FIRE_INTERVAL) {
          laserSystem.fireAllyShot(root, fireSequence[fireIndex]);
          fireIndex++;
        }
        if (fireIndex >= fireSequence.length &&
            attackElapsed >= FIRE_DELAY + fireSequence.length * FIRE_INTERVAL + EXIT_DELAY) {
          state = 'exit';
          exitElapsed = 0;
          rollAngle = 0;
          rollT = ROLL_TIME;
          tmpExitVel.copy(tmpRailForward).multiplyScalar(EXIT_FORWARD_SPEED);
          tmpExitVel.x -= EXIT_LEFT_SPEED;
          tmpExitVel.y += EXIT_UP_SPEED;
          tmpExitForward.copy(tmpExitVel).normalize();
          emitDialogue({
            id: 'turret-ally-exit',
            portraitSrc: './textures/red.png',
            textLines: ['Scratch two turrets! No need to thank me.']
          });
        }
      }

      if (state === 'exit') {
        exitElapsed += dt;
        root.position.addScaledVector(tmpExitVel, dt);

        if (rollT > 0) {
          rollT = Math.max(0, rollT - dt);
          const spin = (4 * Math.PI) * (dt / ROLL_TIME);
          rollAngle += spin;
          if (rollT === 0) rollAngle = 0;
        }

        if (exitElapsed >= EXIT_DURATION) {
          root.visible = false;
          active = false;
        }
      }

      let aimTarget = null;
      if (state === 'attack' && fireIndex < fireSequence.length) {
        aimTarget = fireSequence[fireIndex];
      }

      if (state === 'exit') {
        updateOrientation(root, tmpExitForward, rollAngle);
      } else if (aimTarget) {
        tmpAim.copy(aimTarget).sub(root.position);
        if (tmpAim.lengthSq() > 1e-6) tmpAim.normalize();
        tmpForward.copy(tmpRailForward).lerp(tmpAim, 0.6).normalize();
        updateOrientation(root, tmpForward, rollAngle);
      } else {
        updateOrientation(root, tmpRailForward, rollAngle);
      }
    }

    if (!escortSpawned && tmpPlayerPos.z <= ESCORT_TRIGGER_Z) {
      escortSpawned = true;
      spawnEscort();
    }

    if (escortActive) {
      escortRoot.visible = true;
      const aliveChasers = countAliveChasers();
      if (aliveChasers > 0) checkEscortLaserHits();

      if (escortRollT > 0) {
        escortRollT = Math.max(0, escortRollT - dt);
        const spin = (4 * Math.PI) * (dt / ROLL_TIME);
        escortRollAngle += spin;
        if (escortRollT === 0) escortRollAngle = 0;
      } else {
        escortRollCooldown = Math.max(0, escortRollCooldown - dt);
        if (escortRollCooldown === 0) {
          escortRollT = ROLL_TIME;
          escortRollCooldown = ESCORT_ROLL_INTERVAL;
          escortRollAngle = 0;
        }
      }

      if (escortState === 'destroying') {
        escortDestroyTimer += dt;
        if (escortDestroyTimer >= 0.2) {
          escortRoot.visible = false;
          escortActive = false;
        }
      } else if (escortState === 'exit') {
        escortExitElapsed += dt;
        escortRoot.position.addScaledVector(tmpEscortExitVel, dt);
        updateOrientation(escortRoot, tmpEscortExitForward, escortRollAngle);
        if (escortExitElapsed >= EXIT_DURATION) {
          escortRoot.visible = false;
          escortActive = false;
        }
      } else {
        const target = ESCORT_WAYPOINTS[Math.min(escortWaypoint, ESCORT_WAYPOINTS.length - 1)];
        tmpEscortDir.copy(target).sub(escortRoot.position);
        const dist = tmpEscortDir.length();
        if (dist > 1e-4) tmpEscortDir.multiplyScalar(1 / dist);

        const baseSpeed = Number.isFinite(playerSpeedNow) ? playerSpeedNow : playerSpeed;
        const targetSpeed = (tmpPlayerPos.z <= ESCORT_RESUME_Z)
          ? baseSpeed
          : baseSpeed * ESCORT_SLOW_MULT;
        escortSpeed += (targetSpeed - escortSpeed) * Math.min(1, ESCORT_MATCH_LERP * dt);

        const step = escortSpeed * dt;
        const arriveDist = Math.max(step, ESCORT_WAYPOINT_EPS);
        if (dist <= arriveDist) {
          escortRoot.position.copy(target);
          if (escortWaypoint < ESCORT_WAYPOINTS.length - 1) {
            escortWaypoint += 1;
          } else {
            if (aliveChasers === 0) {
              escortState = 'exit';
              escortExitElapsed = 0;
              escortRollAngle = 0;
              escortRollT = ROLL_TIME;
              tmpEscortExitVel.copy(tmpRailForward).multiplyScalar(ESCORT_EXIT_FORWARD_SPEED);
              tmpEscortExitVel.x += ESCORT_EXIT_RIGHT_SPEED;
              tmpEscortExitVel.y += ESCORT_EXIT_UP_SPEED;
              tmpEscortExitForward.copy(tmpEscortExitVel).normalize();
              if (!escortOutcomeSent) {
                escortOutcomeSent = true;
                if (typeof onEscortOutcome === 'function') onEscortOutcome({ survived: true });
              }
              emitDialogue({
                id: 'escort-escape',
                portraitSrc: './textures/green.png',
                textLines: ['Thanks, cat! That was too close!']
              });
            } else {
              escortState = 'destroying';
              escortDestroyTimer = 0;
              triggerBlink(escortRoot);
              fireEscortKillShots();
              explosionPool?.spawn?.(escortRoot.position);
              if (!escortOutcomeSent) {
                escortOutcomeSent = true;
                if (typeof onEscortOutcome === 'function') onEscortOutcome({ survived: false });
              }
              emitDialogue({
                id: 'escort-destroyed',
                portraitSrc: './textures/green.png',
                textLines: ["I'm hit! Ahhhhh!"]
              });
            }
          }
        } else if (dist > 1e-4) {
          escortRoot.position.addScaledVector(tmpEscortDir, step);
        }

        const aimDir = dist > 1e-4 ? tmpEscortDir : tmpRailForward;
        updateOrientation(escortRoot, aimDir, escortRollAngle);
      }
    }

    if (!escortCleanupDone && escortSpawned && tmpPlayerPos.z <= ESCORT_CHASER_CLEANUP_Z && escortState !== 'path') {
      escortCleanupDone = true;
      cleanupEscortChasers();
    }

    updateBlink(root, dt);
    updateBlink(escortRoot, dt);
  }

  function prewarm(renderer, camera) {
    if (!renderer || !camera) return;
    const prevVis = [root.visible, escortRoot.visible];
    const prevPos = [root.position.clone(), escortRoot.position.clone()];
    const prevQuat = [root.quaternion.clone(), escortRoot.quaternion.clone()];
    root.visible = true;
    escortRoot.visible = true;
    camera.getWorldPosition(tmpPlayerPos);
    camera.getWorldDirection(tmpForward);
    root.position.copy(tmpPlayerPos).addScaledVector(tmpForward, 30);
    escortRoot.position.copy(tmpPlayerPos).addScaledVector(tmpForward, 36);
    root.quaternion.copy(camera.quaternion);
    escortRoot.quaternion.copy(camera.quaternion);
    renderer.compile(scene, camera);
    root.visible = prevVis[0];
    escortRoot.visible = prevVis[1];
    root.position.copy(prevPos[0]);
    escortRoot.position.copy(prevPos[1]);
    root.quaternion.copy(prevQuat[0]);
    escortRoot.quaternion.copy(prevQuat[1]);
  }

  return {
    mesh: root,
    meshes: [root, escortRoot],
    update,
    prewarm
  };
}
