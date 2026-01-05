/*  Level-layout viewer
    ---------------------------------------------------------- */
import * as THREE        from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createPlanetSystem } from './planet-moon.js';

/* …everything else stays the same… */


/* ---- helper to fetch JSON files ---- */
async function loadJSON(path){
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/* ---- load rail curve + spawn tables in parallel ---- */
const [curveData, spawnData] = await Promise.all([
  loadJSON('./scene/curve.json'),
  loadJSON('./scene/spawns.json')
]);

/* -----------------------------------------------------------------------
   Basic three.js scene setup
------------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene    = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera   = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 8000);
camera.position.set(0, 80, 180);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/* resize-safe */
window.addEventListener('resize', ()=>{
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* -----------------------------------------------------------------------
   1. Catmull–Rom rail (yellow line)
------------------------------------------------------------------------ */
const railCurve = new THREE.CatmullRomCurve3(
  curveData.points.map(p => new THREE.Vector3(p.x, p.y, p.z)),
  curveData.closed  ?? false,
  'catmullrom',
  curveData.tension ?? 0.5
);

const railLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints( railCurve.getPoints(400) ),
  new THREE.LineBasicMaterial({ color:0xffff00 })
);
scene.add(railLine);

/* -----------------------------------------------------------------------
   2. Helper-sphere factory
------------------------------------------------------------------------ */
function addHelper(pos, color, size){
  const g = new THREE.SphereGeometry(size, 16, 16);
  const m = new THREE.MeshBasicMaterial({ color });
  const s = new THREE.Mesh(g, m);
  s.position.copy(pos);
  scene.add(s);
}

/* colors & sizes for each category */
const C = { enemy:0xff4444, asteroid:0xffaa00, boss:0xaa66ff };
const S = { enemy: 4,       asteroid: 3,       boss: 8       };

/* enemies */
spawnData.enemy?.forEach(p =>
  addHelper(new THREE.Vector3(p.x, p.y, p.z), C.enemy, S.enemy));

/* asteroids */
spawnData.asteroid?.forEach(p =>
  addHelper(new THREE.Vector3(p.x, p.y, p.z), C.asteroid, S.asteroid));

/* single boss */
if (spawnData.boss)
  addHelper(new THREE.Vector3(spawnData.boss.x, spawnData.boss.y, spawnData.boss.z),
            C.boss, S.boss);

/* reference grid (2 km x 2 km) */
scene.add( new THREE.GridHelper(2000, 40, 0x444444, 0x222222) );


/* ---------- planet + moon (viewer-only) ---------- */
const { planetMesh, update: updatePlanet } = createPlanetSystem(scene, {
  planetRadius : 30,
  planetColor  : 0x2266ff,
  moonRadius   : 10,
  moonColor    : 0xaaaaaa,
  moonDistance : 75,
  orbitSpeed   : 0.0002
});
planetMesh.position.set(0, -90, -1700);   // move the whole system

/* -----------------------------------------------------------------------
   Render loop
------------------------------------------------------------------------ */
let last = 0;
renderer.setAnimationLoop((nowMS)=>{
  const dt = (nowMS - last) * 0.001;   // seconds
  last = nowMS;
  updatePlanet(dt);
  controls.update();
  renderer.render(scene, camera);
});
