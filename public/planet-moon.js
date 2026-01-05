// planet-moon.js  – import this after your scene / renderer have been created
import * as THREE from './libs/build/three.module.js';
/**
 * createPlanetSystem(scene, {
 *   planetRadius, planetColor, planetTexture,
 *   moonRadius,   moonColor,   moonTexture,
 *   moonDistance, orbitSpeed
 * })
 *
 * • planetTexture / moonTexture are optional URLs.
 * • orbitSpeed in radians per second (default 0.2).
 * • Returns { planetMesh, moonMesh, update(dt) }.
 */
export function createPlanetSystem(
  scene,
  {
    planetRadius  = 25,
    planetColor   = 0x2266ff,
    planetTexture = null,
    moonRadius    = 8,
    moonColor     = 0xaaaaaa,
    moonTexture   = null,
    moonDistance  = 60,
    orbitSpeed    = 0.00002     // rad / sec
  } = {}
) {
  const texLoader = new THREE.TextureLoader();

  /* ------------ Planet ------------ */
  const planetMat = planetTexture
    ? new THREE.MeshStandardMaterial({ map: texLoader.load(planetTexture) })
    : new THREE.MeshStandardMaterial({ color: planetColor, flatShading: true });

  const planetGeo  = new THREE.SphereGeometry(
    planetRadius,            // radius
    Math.max(16, planetRadius), // width segs – keeps lowish poly
    Math.max(12, planetRadius)  // height segs
  );

  const planetMesh = new THREE.Mesh(planetGeo, planetMat);
  planetMesh.castShadow = planetMesh.receiveShadow = true;
  scene.add(planetMesh);

  /* ------------ Moon ------------ */
  const moonMat = moonTexture
    ? new THREE.MeshStandardMaterial({ map: texLoader.load(moonTexture) })
    : new THREE.MeshStandardMaterial({ color: moonColor, flatShading: true });

  const moonGeo = new THREE.SphereGeometry(
    moonRadius,
    Math.max(12, moonRadius),
    Math.max(10, moonRadius)
  );

  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.position.x = moonDistance;     // start on +X
  moonMesh.castShadow = moonMesh.receiveShadow = true;

  // parent moon to an empty pivot so we can spin it
  const moonPivot = new THREE.Object3D();
  moonPivot.add(moonMesh);
  planetMesh.add(moonPivot);              // pivot centred on planet
  scene.add(planetMesh);

  /* ------------ Animation helper ------------ */
  let elapsed = 0;
  function update(dt /* seconds since last frame */) {
    elapsed += dt;
    moonPivot.rotation.y = elapsed * orbitSpeed;
    // optional axial rotation
    planetMesh.rotation.y += dt * 0.05;
    moonMesh.rotation.y   += dt * 0.2;
  }

  return { planetMesh, moonMesh, update };
}
