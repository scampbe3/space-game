import * as THREE from './libs/build/three.module.js';

/**
 * Shared instanced bolt pool for all enemies/boss/turrets.
 * Usage:
 *   const pool = createBoltPool(scene, { smallCount: 200, bigCount: 30 });
 *   const idx = pool.alloc({ big:false, life:2, dir:1 });
 *   pool.setTransform(idx, position, quaternion, scale);
 *   // each frame:
 *   pool.update(dt);
 *   pool.getActive(); // array of active bolt records
 */
export function createBoltPool(scene, {
  smallCount = 200,
  bigCount   = 30,
  smallColor = 0xff6600,
  bigColor   = 0xff9900
} = {}) {

  const geoSmall = new THREE.BoxGeometry(0.3, 0.3, 6).translate(0, 0, 3);
  const matSmall = new THREE.MeshBasicMaterial({ color: smallColor });
  const meshSmall = new THREE.InstancedMesh(geoSmall, matSmall, smallCount);
  meshSmall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  meshSmall.visible = true;
  meshSmall.frustumCulled = false;   // large spread; skip cull
  scene.add(meshSmall);

  const geoBig = new THREE.BoxGeometry(0.6, 0.6, 12).translate(0, 0, 6);
  const matBig = new THREE.MeshBasicMaterial({ color: bigColor });
  const meshBig = new THREE.InstancedMesh(geoBig, matBig, bigCount);
  meshBig.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  meshBig.visible = true;
  meshBig.frustumCulled = false;
  scene.add(meshBig);

  const small = new Array(smallCount).fill(null).map(() => ({
    active: false,
    life: 0,
    dir: 1,
    bounced: false,
    scale: 1,
    prev: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion()
  }));
  const big = new Array(bigCount).fill(null).map(() => ({
    active: false,
    life: 0,
    dir: 1,
    bounced: false,
    scale: 1,
    prev: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion()
  }));

  const activeList = [];
  const dirVec = new THREE.Vector3();
  function prewarm(renderer, camera) {
    // fabricate a couple of instances to force shader/program upload and render once offscreen
    const dummyHandle = alloc({ big:false, life: 0.01, dir: 1 });
    const dummyHandleBig = alloc({ big:true, life: 0.01, dir: 1 });
    setTransform(dummyHandle, new THREE.Vector3(), new THREE.Quaternion());
    setTransform(dummyHandleBig, new THREE.Vector3(), new THREE.Quaternion());
    update(0); // flush matrices
    const prevSize = renderer.getSize(new THREE.Vector2());
    renderer.setSize(64, 64, false);
    renderer.render(scene, camera);
    renderer.setSize(prevSize.x, prevSize.y, false);
    free(dummyHandle);
    free(dummyHandleBig);
  }

  function alloc({ big: isBig = false, life = 2, dir = 1, bounced = false, scale = 1 } = {}) {
    const arr = isBig ? big : small;
    const idx = arr.findIndex(b => !b.active);
    if (idx === -1) return null;
    const b = arr[idx];
    b.active = true;
    b.life = life;
    b.dir = dir;
    b.bounced = bounced;
    b.scale = scale;
    return { isBig, idx };
  }

  function setTransform(handle, position, quaternion, scaleOverride) {
    if (!handle) return;
    const arr = handle.isBig ? big : small;
    const b = arr[handle.idx];
    b.pos.copy(position);
    b.quat.copy(quaternion);
    b.scale = scaleOverride ?? b.scale;
    b.bounced = handle.bounced ?? b.bounced;
    b.dir = handle.dir ?? b.dir;
  }

  function free(handle) {
    if (!handle) return;
    const arr = handle.isBig ? big : small;
    const b = arr[handle.idx];
    b.active = false;
    b.life = 0;
  }

  const _m = new THREE.Matrix4();
  const _scale = new THREE.Vector3();
  function flushInstances(arr, mesh) {
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (!b.active) continue;
      _scale.set(b.scale, b.scale, b.scale);
      _m.compose(b.pos, b.quat, _scale);
      mesh.setMatrixAt(count, _m);
      b._drawIndex = count;
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update(dt) {
    activeList.length = 0;
    small.forEach(b => {
      if (!b.active) return;
      b.prev.copy(b.pos);
      dirVec.set(0, 0, 1).applyQuaternion(b.quat);
      b.pos.addScaledVector(dirVec, 160 * dt * b.dir);
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    });
    big.forEach(b => {
      if (!b.active) return;
      b.prev.copy(b.pos);
      dirVec.set(0, 0, 1).applyQuaternion(b.quat);
      b.pos.addScaledVector(dirVec, 200 * dt * b.dir);
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.scale = 1; }
    });

    small.forEach(b => {
      if (b.active) activeList.push({
        position: b.pos,
        prev: b.prev,
        userData: b,   // mutate dir/bounced directly
        handle: b,
        isBig: false,
        visible: true
      });
    });
    big.forEach(b => {
      if (b.active) activeList.push({
        position: b.pos,
        prev: b.prev,
        userData: b,
        handle: b,
        isBig: true,
        visible: true
      });
    });

    flushInstances(small, meshSmall);
    flushInstances(big, meshBig);
  }

  function getActive() { return activeList; }

  return { alloc, setTransform, free, update, getActive, meshSmall, meshBig, prewarm };
}
