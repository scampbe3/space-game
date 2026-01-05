/*  asteroids.js
    --------------------------------------------------
    Usage:
      import { initAsteroids } from './asteroids.js';
      const { update } = await initAsteroids(scene, spawnArray);
      // call update(dt) each frame
*/

import * as THREE from './libs/build/three.module.js';
import { GLTFLoader } from './libs/examples/jsm/loaders/GLTFLoader.js';
import { toLambert } from './material-utils.js';

/* deterministic asteroid presets to avoid per-spawn random math */
const ASTEROID_TYPES = [
  { name: 'small',  scale: 1.4,  spin: [0.18, 0.22, 0.16], rot: [0.3, 0.8, 0.1] },
  { name: 'medium', scale: 3.0,  spin: [0.14, 0.18, 0.12], rot: [0.7, 1.2, 0.4] },
  { name: 'large',  scale: 4.6,  spin: [0.10, 0.14, 0.10], rot: [1.1, 0.2, 0.9] },
  { name: 'flat',   scale: 2.2,  spin: [0.12, 0.20, 0.08], rot: [0.5, 0.3, 1.0] }
];

/**
 * Loads a GLB rock once, clones it for every entry in spawnArray,
 * adds them to the scene, and returns an update(dt) function.
 *
 * @param {THREE.Scene} scene
 * @param {Array<{x:number,y:number,z:number}>} spawnArray
 * @param {string} modelPath  default './models/asteroid.glb'
 */
export async function initAsteroids(scene, spawnArray, modelPath = './models/asteroid.glb', {
  materialMode = 'standard'
} = {}) {
  if (!Array.isArray(spawnArray) || spawnArray.length === 0) {
    return { update: () => {} };           // nothing to do
  }

  const rockSrc = (await new GLTFLoader().loadAsync(modelPath)).scene;
  const useLambert = materialMode === 'lambert';
  if (useLambert) {
    rockSrc.traverse(o => {
      if (o.isMesh) {
        o.material = toLambert(o.material);
      }
    });
  } else {
    rockSrc.traverse(o => {
      if (o.isMesh) {
        o.material = o.material.clone();
      }
    });
  }
  const group   = new THREE.Group();
  scene.add(group);

  function pickType(cfg) {
    if (cfg.type) {
      const found = ASTEROID_TYPES.find(t => t.name === cfg.type);
      if (found) return found;
    }
    return ASTEROID_TYPES[1]; // default "medium" if not specified
  }

  spawnArray.forEach((cfg) => {
    const rock = rockSrc.clone(true);
    const preset = pickType(cfg);
    rock.scale.setScalar(preset.scale);
    rock.position.set(cfg.x, cfg.y, cfg.z);
    rock.rotation.set(preset.rot[0], preset.rot[1], preset.rot[2]);
    rock.userData.asteroid = true;
    rock.userData.editorRef = cfg;
    rock.userData.editorGroup = 'asteroid';
    rock.userData.spin = new THREE.Vector3(preset.spin[0], preset.spin[1], preset.spin[2]);
    rock.frustumCulled = false;
    group.add(rock);
  });

  /* update all rocks each frame */
  const camPos = new THREE.Vector3();
  const RENDER_DIST = 200;            // tweak to taste

  function update(dt, camera) {
    if (camera) camera.getWorldPosition(camPos);
    for (let i = group.children.length - 1; i >= 0; i--) {
      const r = group.children[i];
      if (r.userData.dead) {
        group.children.splice(i, 1);
        continue;
      }
      const s = r.userData.spin;
      r.rotation.x += s.x * dt;
      r.rotation.y += s.y * dt;
      r.rotation.z += s.z * dt;


r.visible = r.position.distanceToSquared(camPos) < RENDER_DIST*RENDER_DIST;

/* hard-remove if rock fell 25 u behind camera */
if (r.position.z > camPos.z + 25) {
  r.visible       = false;
      r.userData.dead = true;
    }


    }
  }

  return { group, update };
}
