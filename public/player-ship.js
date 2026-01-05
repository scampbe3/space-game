import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

/**
 * initPlayerShip(parent)
 * ▸ loads player_starfighter_body_only.glb (body) + optional wing GLBs
 * ▸ adds them to parent
 * ▸ returns { mesh, radius, update(dx,dy,dt) }
 */
export async function initPlayerShip(parent, {
  path = './models/player_starfighter_body_only.glb',
  wingLeftPath = './models/player_starfighter_l_wing_only.glb',
  wingRightPath = './models/player_starfighter_r_wing_only.glb',
  fallbackColour = 0x00aaff,
  scene = null,                  // optional, for world-space trail
  explosionPool = null,          // optional, for wing break FX
  materialMode = 'standard'
} = {}) {

  /* 1 ─ load model */
  const loader = new GLTFLoader();
  const mesh = new THREE.Object3D();
  parent.add(mesh);

  const loadModel = async (modelPath) => {
    if (!modelPath) return null;
    try {
      return (await loader.loadAsync(modelPath)).scene;
    } catch {
      return null;
    }
  };

  const fallbackModel = () => new THREE.Mesh(
    new THREE.BoxGeometry(5, 2, 10),
    new THREE.MeshStandardMaterial({ color: fallbackColour })
  );

  const tmpBox = new THREE.Box3();
  const tmpMatrix = new THREE.Matrix4();
  const tmpVec = new THREE.Vector3();
  const tmpSizeVec = new THREE.Vector3();

  const collectMeshes = (root) => {
    const list = [];
    if (!root) return list;
    root.traverse(node => {
      if (node.isMesh) list.push(node);
    });
    return list;
  };

  const computeLocalBounds = (root) => {
    const box = new THREE.Box3();
    if (!root) return box;
    root.updateMatrixWorld(true);
    const inv = tmpMatrix.copy(root.matrixWorld).invert();
    root.traverse(node => {
      if (!node.isMesh || !node.geometry) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (!node.geometry.boundingBox) return;
      tmpBox.copy(node.geometry.boundingBox);
      tmpBox.applyMatrix4(node.matrixWorld);
      tmpBox.applyMatrix4(inv);
      box.union(tmpBox);
    });
    return box;
  };

  const computeNoseTipZ = (root, bounds, center) => {
    if (!root || !bounds || bounds.isEmpty()) return null;
    const size = bounds.getSize(tmpSizeVec);
    const xLimit = size.x * 0.22;
    const yLimit = size.y * 0.22;
    const zSamples = [];
    root.updateMatrixWorld(true);
    const inv = tmpMatrix.copy(root.matrixWorld).invert();
    root.traverse(node => {
      if (!node.isMesh || !node.geometry) return;
      const pos = node.geometry.getAttribute('position');
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        tmpVec.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        tmpVec.applyMatrix4(node.matrixWorld);
        tmpVec.applyMatrix4(inv);
        if (Math.abs(tmpVec.x - center.x) > xLimit) continue;
        if (Math.abs(tmpVec.y - center.y) > yLimit) continue;
        zSamples.push(tmpVec.z);
      }
    });
    if (!zSamples.length) return null;
    zSamples.sort((a, b) => b - a);
    const skip = Math.min(3, Math.floor(zSamples.length * 0.005));
    return zSamples[Math.min(skip, zSamples.length - 1)];
  };

  const useLambert = materialMode === 'lambert';
  const prepareBody = (model) => {
    if (!model) return null;
    const data = {
      model,
      meshList: [],
      bounds: new THREE.Box3(),
      boundsCenter: new THREE.Vector3(),
      chargeNoseOffsetZ: 0
    };

    model.traverse(o => {
      if (o.isMesh) {
        o.material = useLambert ? toLambert(o.material) : o.material.clone();
        data.meshList.push(o);
      }
    });

    data.bounds = computeLocalBounds(model);
    if (!data.bounds.isEmpty()) {
      data.bounds.getCenter(data.boundsCenter);
      data.chargeNoseOffsetZ = data.bounds.max.z;
    }
    return data;
  };

  const prepareWing = (model) => {
    if (!model) return null;
    const data = {
      model,
      meshList: [],
      bounds: new THREE.Box3(),
      center: new THREE.Vector3()
    };

    model.traverse(o => {
      if (o.isMesh) {
        o.material = useLambert ? toLambert(o.material) : o.material.clone();
        data.meshList.push(o);
      }
    });

    data.bounds = computeLocalBounds(model);
    if (!data.bounds.isEmpty()) {
      data.bounds.getCenter(data.center);
    }
    return data;
  };

  const bodyModel = await loadModel(path) ?? fallbackModel();
  const bodyData = prepareBody(bodyModel);
  if (bodyData?.model) mesh.add(bodyData.model);

  const wingLeftModel = await loadModel(wingLeftPath);
  const wingRightModel = await loadModel(wingRightPath);
  const wingLeft = wingLeftModel ? prepareWing(wingLeftModel) : null;
  const wingRight = wingRightModel ? prepareWing(wingRightModel) : null;
  if (wingLeft?.model) {
    wingLeft.model.name = 'player-wing-left';
    mesh.add(wingLeft.model);
  }
  if (wingRight?.model) {
    wingRight.model.name = 'player-wing-right';
    mesh.add(wingRight.model);
  }

  if (bodyData?.model) {
    bodyData.model.updateMatrix();
    bodyData.boundsCenterInPlayer = bodyData.boundsCenter
      ? bodyData.boundsCenter.clone().applyMatrix4(bodyData.model.matrix)
      : new THREE.Vector3();
  }
  if (wingLeft?.model && wingLeft?.bounds && !wingLeft.bounds.isEmpty()) {
    wingLeft.model.updateMatrix();
    wingLeft.boundsInPlayer = wingLeft.bounds.clone().applyMatrix4(wingLeft.model.matrix);
    wingLeft.boundsInPlayer.expandByScalar(0.05);
    wingLeft.centerInPlayer = wingLeft.boundsInPlayer.getCenter(new THREE.Vector3());
  }
  if (wingRight?.model && wingRight?.bounds && !wingRight.bounds.isEmpty()) {
    wingRight.model.updateMatrix();
    wingRight.boundsInPlayer = wingRight.bounds.clone().applyMatrix4(wingRight.model.matrix);
    wingRight.boundsInPlayer.expandByScalar(0.05);
    wingRight.centerInPlayer = wingRight.boundsInPlayer.getCenter(new THREE.Vector3());
  }

  /* 2 ─ pre-compute bounding radius (root-local bounds for accuracy) */
  const sphere = new THREE.Sphere();
  const combinedBox = new THREE.Box3();
  const addLocalBox = (box, obj) => {
    if (!box || box.isEmpty() || !obj) return;
    obj.updateMatrix();
    tmpBox.copy(box).applyMatrix4(obj.matrix);
    combinedBox.union(tmpBox);
  };
  addLocalBox(bodyData?.bounds, bodyData?.model);
  addLocalBox(wingLeft?.bounds, wingLeft?.model);
  addLocalBox(wingRight?.bounds, wingRight?.model);
  if (combinedBox.isEmpty()) {
    mesh.updateMatrixWorld(true);
    combinedBox.setFromObject(mesh);
  }
  combinedBox.getBoundingSphere(sphere);
  const radius = sphere.radius;

  if (bodyData?.bounds && bodyData?.model) {
    bodyData.model.updateMatrixWorld(true);
    const noseTipZ = computeNoseTipZ(bodyData.model, bodyData.bounds, bodyData.boundsCenter);
    if (typeof noseTipZ === 'number') {
      const nosePoint = new THREE.Vector3(
        bodyData.boundsCenter.x,
        bodyData.boundsCenter.y,
        noseTipZ
      );
      nosePoint.applyMatrix4(bodyData.model.matrix);
      mesh.userData.chargeNosePoint = nosePoint;
      mesh.userData.chargeNoseOffsetZ = nosePoint.z;
    } else {
      tmpBox.copy(bodyData.bounds).applyMatrix4(bodyData.model.matrix);
      mesh.userData.chargeNoseOffsetZ = tmpBox.max.z;
    }
  } else {
    mesh.userData.chargeNoseOffsetZ = combinedBox.max.z;
  }

  /* gather meshes for local emissive flash */
  let meshList = [
    ...(bodyData?.meshList ?? []),
    ...(wingLeft?.meshList ?? []),
    ...(wingRight?.meshList ?? [])
  ];
  mesh.userData.meshes = meshList;

  /* 3 ─ attitude parameters */
  const MAX_ROLL  = 0.30;  // rad  ≈17°
  const MAX_YAW   = 0.20;  // rad  ≈11°
  const MAX_PITCH = 0.20;

  const DAMP      = 6;     // how fast we return to neutral (larger = snappier)

  /* barrel-roll parms */
const ROLL_TIME   = 0.6;   // seconds for two full spins
let   rollT   = 0;         // time left
let   rollDir = 0;         // -1 = left, +1 = right
  const SIDE_BANK_ANGLE = Math.PI * 0.5;

  /* hit flash */
  let flashT = 0;

  /* compact engine glow (soft, layered ovals, no tail) */
  const glowGeo = new THREE.CircleGeometry(0.2, 20); // size already tuned by you
  glowGeo.scale(1.4, 0.85, 1);                       // small horizontal oval

  const makeGlowMat = (hex, opacity, softness = 0.35) => new THREE.ShaderMaterial({
    transparent : true,
    blending    : THREE.AdditiveBlending,
    depthWrite  : false,
    side        : THREE.DoubleSide,
    uniforms: {
      color   : { value: new THREE.Color(hex) },
      opacity : { value: opacity },
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

  const outerGlow = new THREE.Mesh(glowGeo, makeGlowMat(0x00ccff, 0.45, 0.45));
  outerGlow.position.set(0, 0, -1.0); // tuck close to the rear
  outerGlow.frustumCulled = false;
  mesh.add(outerGlow);

  const innerGlow = new THREE.Mesh(glowGeo, makeGlowMat(0x0077c8, 0.55, 0.35));
  innerGlow.scale.set(0.6, 0.6, 0.6); // smaller darker core
  innerGlow.position.set(0, 0, -1.01);
  innerGlow.frustumCulled = false;
  mesh.add(innerGlow);
  const baseGlowScaleOuter = outerGlow.scale.clone();
  const baseGlowScaleInner = innerGlow.scale.clone();
  const engineOffset = outerGlow.position.clone();

  const TAIL_SEGMENTS = 12;
  const TAIL_SPACING = 0.6;
  const TAIL_FADE_IN = 6.0;
  const TAIL_FADE_OUT = 3.2;
  const TAIL_SMOOTH = 0.35;
  const TAIL_START_SCALE = 1.15;
  const TAIL_END_SCALE = 0.35;
  const TAIL_BASE_OPACITY = 0.65;

  const makeTailMat = () => new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      innerColor: { value: new THREE.Color(0x0077c8) },
      outerColor: { value: new THREE.Color(0x00ccff) },
      opacity: { value: TAIL_BASE_OPACITY },
      softness: { value: 0.6 }
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 innerColor;
      uniform vec3 outerColor;
      uniform float opacity;
      uniform float softness;
      varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float d = length(p);
        float t = smoothstep(0.0, 1.0, d);
        vec3 color = mix(innerColor, outerColor, t);
        float mask = 1.0 - smoothstep(1.0 - softness, 1.0, d);
        gl_FragColor = vec4(color, opacity * mask);
      }
    `
  });

  const tailMeshes = [];
  const tailPositions = Array.from({ length: TAIL_SEGMENTS }, () => new THREE.Vector3());
  const tailQuats = Array.from({ length: TAIL_SEGMENTS }, () => new THREE.Quaternion());
  const tailTargetPos = new THREE.Vector3();
  const tailTargetQuat = new THREE.Quaternion();
  const tailTmpPos = new THREE.Vector3();
  let tailCount = 0;
  let tailFade = 0;
  let lastTrailTime = 0;
  let boosting = false;
  let boostScale = 1;
  if (scene) {
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const m = new THREE.Mesh(glowGeo, makeTailMat());
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      tailMeshes.push(m);
    }
  }

  /* wing health + wing meshes */
  const WING_MAX_HP = 3;
  let wingHpLeft = WING_MAX_HP;
  let wingHpRight = WING_MAX_HP;
  const wingMeshes = {
    left: wingLeft?.meshList ?? [],
    right: wingRight?.meshList ?? []
  };
  const tmpWingLocal = new THREE.Vector3();
  const tmpWingWorld = new THREE.Vector3();
  const tmpWingDir = new THREE.Vector3();
  const tmpBodyCenterWorld = new THREE.Vector3();
  const tmpWingOrigin = new THREE.Vector3();
  const tmpPlayerLocal = new THREE.Vector3();
  const WING_HIT_PAD = 0.25;
  const wingBlinkColor = new THREE.Color(0x4aa3ff);
  const WING_BLINK_DURATION = 1.6;
  const WING_BLINK_RATE = 8.0;
  let wingBlinkLeftT = 0;
  let wingBlinkRightT = 0;
  let wingBlinkLeftOn = false;
  let wingBlinkRightOn = false;
  let warnedMissingWings = false;

  function syncWingUserData() {
    mesh.userData.wingHpLeft = wingHpLeft;
    mesh.userData.wingHpRight = wingHpRight;
  }

  function updateWingVariant() {
    let nextKey = 'full';
    if (wingHpLeft <= 0 && wingHpRight <= 0) nextKey = 'noW';
    else if (wingHpLeft <= 0) nextKey = 'noL';
    else if (wingHpRight <= 0) nextKey = 'noR';
    mesh.userData.wingVariant = nextKey;
  }

  function setWingVisible(wingData, visible) {
    if (!wingData?.model) return;
    wingData.model.visible = visible;
    if (!visible) {
      setWingGlow(wingData.meshList, 0);
    }
  }

  function spawnWingExplosion(wingData) {
    if (!explosionPool?.spawn || !wingData?.center || !wingData?.model) return;
    tmpWingWorld.copy(wingData.center);
    wingData.model.localToWorld(tmpWingWorld);
    explosionPool.spawn(tmpWingWorld);
  }

  function segmentHitsBox(origin, dir, box) {
    if (!box) return false;
    if (dir.lengthSq() < 1e-6) return false;
    let tMin = 0;
    let tMax = 1;
    const sx = origin.x;
    const sy = origin.y;
    const sz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;
    const min = box.min;
    const max = box.max;
    const eps = 1e-6;
    if (Math.abs(dx) < eps) {
      if (sx < min.x || sx > max.x) return false;
    } else {
      const inv = 1 / dx;
      let t1 = (min.x - sx) * inv;
      let t2 = (max.x - sx) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
    if (Math.abs(dy) < eps) {
      if (sy < min.y || sy > max.y) return false;
    } else {
      const inv = 1 / dy;
      let t1 = (min.y - sy) * inv;
      let t2 = (max.y - sy) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
    if (Math.abs(dz) < eps) {
      if (sz < min.z || sz > max.z) return false;
    } else {
      const inv = 1 / dz;
      let t1 = (min.z - sz) * inv;
      let t2 = (max.z - sz) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
    return tMax >= 0 && tMin <= 1;
  }

  function hitWing(wingData, hitPointWorld, hitPointPlayerLocal = null) {
    if (!wingData?.model || !wingData.bounds || wingData.bounds.isEmpty()) return false;
    if (wingData.model.visible === false) return false;
    const hitLocal = hitPointPlayerLocal ?? tmpPlayerLocal.copy(hitPointWorld);

    if (hitPointPlayerLocal === null) {
      mesh.updateMatrixWorld(true);
      mesh.worldToLocal(hitLocal);
    }

    if (wingData.boundsInPlayer && (wingData.boundsInPlayer.containsPoint(hitLocal) ||
        wingData.boundsInPlayer.distanceToPoint(hitLocal) <= WING_HIT_PAD)) {
      return true;
    }

    if (bodyData?.boundsCenterInPlayer) {
      tmpWingOrigin.copy(bodyData.boundsCenterInPlayer);
      tmpWingDir.copy(hitLocal).sub(tmpWingOrigin);
      if (wingData.boundsInPlayer && !wingData.boundsInPlayer.containsPoint(tmpWingOrigin)) {
        if (segmentHitsBox(tmpWingOrigin, tmpWingDir, wingData.boundsInPlayer)) return true;
      }
    }

    wingData.model.updateMatrixWorld(true);
    tmpWingLocal.copy(hitPointWorld);
    wingData.model.worldToLocal(tmpWingLocal);
    if (wingData.bounds.containsPoint(tmpWingLocal) ||
        wingData.bounds.distanceToPoint(tmpWingLocal) <= WING_HIT_PAD) return true;
    if (!bodyData?.model || !bodyData?.boundsCenter) return false;
    bodyData.model.updateMatrixWorld(true);
    tmpBodyCenterWorld.copy(bodyData.boundsCenter);
    bodyData.model.localToWorld(tmpBodyCenterWorld);
    tmpWingOrigin.copy(tmpBodyCenterWorld);
    wingData.model.worldToLocal(tmpWingOrigin);
    tmpWingDir.copy(tmpWingLocal).sub(tmpWingOrigin);
    if (!wingData.bounds.containsPoint(tmpWingOrigin)) {
      return segmentHitsBox(tmpWingOrigin, tmpWingDir, wingData.bounds);
    }
    return false;
  }

  function applyWingDamage(hitPointWorld) {
    if (!hitPointWorld) return null;
    if (!wingLeft?.model && !wingRight?.model) {
      if (!warnedMissingWings) {
        warnedMissingWings = true;
        console.warn('[player] wing models not found; check player_starfighter_l_wing_only/player_starfighter_r_wing_only GLBs.');
      }
      return null;
    }
    mesh.updateMatrixWorld(true);
    tmpPlayerLocal.copy(hitPointWorld);
    mesh.worldToLocal(tmpPlayerLocal);

    const leftHit = wingLeft?.model && wingHpLeft > 0 && hitWing(wingLeft, hitPointWorld, tmpPlayerLocal);
    const rightHit = wingRight?.model && wingHpRight > 0 && hitWing(wingRight, hitPointWorld, tmpPlayerLocal);
    if (!leftHit && !rightHit) return null;

    let side = leftHit ? 'left' : 'right';
    if (leftHit && rightHit) {
      const leftDist = wingLeft?.centerInPlayer
        ? tmpPlayerLocal.distanceToSquared(wingLeft.centerInPlayer)
        : Infinity;
      const rightDist = wingRight?.centerInPlayer
        ? tmpPlayerLocal.distanceToSquared(wingRight.centerInPlayer)
        : Infinity;
      side = rightDist < leftDist ? 'right' : 'left';
    }

    if (side === 'left') {
      wingHpLeft = Math.max(0, wingHpLeft - 1);
      syncWingUserData();
      mesh.userData.wingHitCountLeft = (mesh.userData.wingHitCountLeft ?? 0) + 1;
      mesh.userData.lastWingHit = 'left';
      mesh.userData.lastWingHitAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      if (wingHpLeft === 0) {
        setWingVisible(wingLeft, false);
        spawnWingExplosion(wingLeft);
        mesh.userData.onWingLost && mesh.userData.onWingLost('left');
      }
    } else {
      wingHpRight = Math.max(0, wingHpRight - 1);
      syncWingUserData();
      mesh.userData.wingHitCountRight = (mesh.userData.wingHitCountRight ?? 0) + 1;
      mesh.userData.lastWingHit = 'right';
      mesh.userData.lastWingHitAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      if (wingHpRight === 0) {
        setWingVisible(wingRight, false);
        spawnWingExplosion(wingRight);
        mesh.userData.onWingLost && mesh.userData.onWingLost('right');
      }
    }
    updateWingVariant();
    return side;
  }

  function setWingGlow(meshes, intensity) {
    if (!meshes || !meshes.length) return;
    const r = wingBlinkColor.r * intensity;
    const g = wingBlinkColor.g * intensity;
    const b = wingBlinkColor.b * intensity;
    meshes.forEach(m => {
      if (m.material.emissive) m.material.emissive.setRGB(r, g, b);
    });
  }

  function updateWingBlink(dt) {
    if (wingBlinkLeftT > 0) {
      wingBlinkLeftT = Math.max(0, wingBlinkLeftT - dt);
    }
    if (wingBlinkRightT > 0) {
      wingBlinkRightT = Math.max(0, wingBlinkRightT - dt);
    }
    const leftActive = wingBlinkLeftT > 0 && wingLeft?.model?.visible !== false;
    const rightActive = wingBlinkRightT > 0 && wingRight?.model?.visible !== false;
    if (leftActive) {
      const pulse = 0.6 + 0.4 * Math.sin((WING_BLINK_DURATION - wingBlinkLeftT) * WING_BLINK_RATE);
      setWingGlow(wingMeshes.left, pulse);
      wingBlinkLeftOn = true;
    } else if (wingBlinkLeftOn) {
      setWingGlow(wingMeshes.left, 0);
      wingBlinkLeftOn = false;
    }
    if (rightActive) {
      const pulse = 0.6 + 0.4 * Math.sin((WING_BLINK_DURATION - wingBlinkRightT) * WING_BLINK_RATE);
      setWingGlow(wingMeshes.right, pulse);
      wingBlinkRightOn = true;
    } else if (wingBlinkRightOn) {
      setWingGlow(wingMeshes.right, 0);
      wingBlinkRightOn = false;
    }
  }

  function restoreWings() {
    wingHpLeft = WING_MAX_HP;
    wingHpRight = WING_MAX_HP;
    syncWingUserData();
    setWingVisible(wingLeft, true);
    setWingVisible(wingRight, true);
    wingBlinkLeftT = WING_BLINK_DURATION;
    wingBlinkRightT = WING_BLINK_DURATION;
    updateWingVariant();
  }

  /** update(dx, dy, dt, bankDir) ▸ dx,dy ∈ [-1,1]  dt seconds */
  function update(dx, dy, dt, bankDir = 0) {
    /* fade emissive flash */
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt);
      const e = flashT > 0 ? 1 : 0;
      meshList.forEach(m => {
        if (m.material.emissive) m.material.emissive.setRGB(e, 0, 0);
      });
    }
    updateWingBlink(dt);

    /* target angles based on current key press */
    const tgtRoll  = bankDir ? bankDir * SIDE_BANK_ANGLE : -dx * MAX_ROLL;
    const tgtYaw   =  dx * MAX_YAW;
    const tgtPitch = -dy * MAX_PITCH;

    /* critically damp toward targets */
    if (rollT === 0) {                                       // not rolling
      mesh.rotation.z += (tgtRoll - mesh.rotation.z) * DAMP * dt;
    }
    mesh.rotation.y += (tgtYaw   - mesh.rotation.y) * DAMP * dt;
    mesh.rotation.x += (tgtPitch - mesh.rotation.x) * DAMP * dt;

    /* active barrel roll */
    if (rollT > 0) {
      rollT  = Math.max(0, rollT - dt);
      const spin = rollDir * (4 * Math.PI) * (dt / ROLL_TIME); // 720° total
      mesh.rotateZ(spin);
      if (rollT === 0) mesh.rotation.z = 0;    // land perfectly level
    }
  }

  function startRoll(dir){
    if (rollT === 0){        // only if not already rolling
      rollT  = ROLL_TIME;
      rollDir= dir;          // -1 left, +1 right
    }
  }
  function isRolling(){ return rollT > 0; }
  function getRollDir(){ return rollDir; }
  function blink(){
    flashT = 0.15;
    meshList.forEach(m => {
      if (m.material.emissive) m.material.emissive.setRGB(1, 0, 0);
    });
  }

  function updateTrail(dt = 0) {
    if (!scene || tailMeshes.length === 0) return;
    let stepDt = dt;
    if (!Number.isFinite(stepDt) || stepDt <= 0) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      stepDt = lastTrailTime ? Math.max(0, (now - lastTrailTime) / 1000) : 0;
      lastTrailTime = now;
    }

    if (boosting) {
      tailFade = Math.min(1, tailFade + stepDt * TAIL_FADE_IN);
    } else {
      tailFade = Math.max(0, tailFade - stepDt * TAIL_FADE_OUT);
    }

    if (boosting) {
      tailTmpPos.copy(engineOffset);
      mesh.localToWorld(tailTmpPos);
      mesh.getWorldQuaternion(tailTargetQuat);
      if (tailCount === 0 || tailTmpPos.distanceToSquared(tailPositions[0]) >= (TAIL_SPACING * TAIL_SPACING)) {
        for (let i = TAIL_SEGMENTS - 1; i > 0; i--) {
          tailPositions[i].copy(tailPositions[i - 1]);
          tailQuats[i].copy(tailQuats[i - 1]);
        }
        tailPositions[0].copy(tailTmpPos);
        tailQuats[0].copy(tailTargetQuat);
        tailCount = Math.min(TAIL_SEGMENTS, tailCount + 1);
      }
    }

    const scaleBoost = 1 + Math.max(0, boostScale - 1) * 0.35;
    for (let i = 0; i < tailMeshes.length; i++) {
      const m = tailMeshes[i];
      if (i >= tailCount || tailFade <= 0.001) {
        m.visible = false;
        continue;
      }
      const t = tailCount > 1 ? i / (tailCount - 1) : 0;
      const fade = (1 - t) * tailFade;
      if (fade <= 0.01) {
        m.visible = false;
        continue;
      }
      tailTargetPos.copy(tailPositions[i]);
      tailTargetQuat.copy(tailQuats[i]);
      if (!m.userData.init) {
        m.position.copy(tailTargetPos);
        m.quaternion.copy(tailTargetQuat);
        m.userData.init = true;
      } else {
        m.position.lerp(tailTargetPos, TAIL_SMOOTH);
        m.quaternion.slerp(tailTargetQuat, TAIL_SMOOTH);
      }
      const scale = THREE.MathUtils.lerp(TAIL_START_SCALE, TAIL_END_SCALE, t) * scaleBoost;
      m.scale.copy(baseGlowScaleOuter).multiplyScalar(scale);
      if (m.material?.uniforms?.opacity) {
        m.material.uniforms.opacity.value = TAIL_BASE_OPACITY * fade;
      }
      m.visible = true;
    }
  }
  function setEngineGlowScale(mult = 1) {
    outerGlow.scale.copy(baseGlowScaleOuter).multiplyScalar(mult);
    innerGlow.scale.copy(baseGlowScaleInner).multiplyScalar(mult);
    boostScale = mult;
    boosting = mult > 1.01;
  }

  mesh.userData.blink = blink;   // allow external callers
  mesh.userData.updateTrail = updateTrail;
  mesh.userData.setEngineGlowScale = setEngineGlowScale;
  mesh.userData.applyWingDamage = applyWingDamage;
  mesh.userData.restoreWings = restoreWings;
  mesh.userData.wingMaxHp = WING_MAX_HP;
  syncWingUserData();
  updateWingVariant();

  return { mesh, radius, update, startRoll, isRolling, getRollDir, blink, updateTrail, setEngineGlowScale };
}
