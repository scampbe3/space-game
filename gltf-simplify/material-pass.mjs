// material-pass.mjs
// Batch tweak GLB/GLTF materials in-place (NO emissive):
// - non-asteroids: metallic look (metallicFactor=1, lower roughness)
// - asteroids: NOT shiny (metallicFactor=0, higher roughness)

import fs from "node:fs/promises";
import path from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const MODELS_DIR = String.raw`C:\Users\Stephen\Desktop\space_site\public\models`;

// --- TUNABLES ---
// Non-asteroid “space metal”
const METAL_METALLIC = 1.0;
const METAL_ROUGHNESS_CAP = 0.40; // lower = shinier; try 0.30–0.50

// Asteroid “rock”
const ASTEROID_METALLIC = 0.0;
const ASTEROID_ROUGHNESS_FLOOR = 0.88; // higher = more matte; try 0.80–0.95

const ASTEROID_FILES = new Set([
  "asteroid.glb",
  "asteroid_flat.glb",
  "asteroid_passage.glb",
]);
// --- END TUNABLES ---

await MeshoptDecoder.ready;

const io = new NodeIO().registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function isGltfFile(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".glb" || ext === ".gltf";
}

let filesProcessed = 0;

for await (const file of walk(MODELS_DIR)) {
  if (!isGltfFile(file)) continue;

  const base = path.basename(file).toLowerCase();
  const isAsteroid = ASTEROID_FILES.has(base);

  const rel = path.relative(MODELS_DIR, file);
  console.log(`\n=== ${rel} ===`);
  console.log(isAsteroid ? "Profile: ASTEROID (matte rock)" : "Profile: METAL (space metal)");

  const doc = await io.read(file);
  const materials = doc.getRoot().listMaterials();

  let touched = 0;

  for (const mat of materials) {
    let changed = false;

    if (isAsteroid) {
      // Asteroids: not metallic, more rough
      if (mat.getMetallicFactor() !== ASTEROID_METALLIC) {
        mat.setMetallicFactor(ASTEROID_METALLIC);
        changed = true;
      }

      const r = mat.getRoughnessFactor();
      if (r < ASTEROID_ROUGHNESS_FLOOR) {
        mat.setRoughnessFactor(ASTEROID_ROUGHNESS_FLOOR);
        changed = true;
      }
    } else {
      // Everything else: metallic, less rough
      if (mat.getMetallicFactor() !== METAL_METALLIC) {
        mat.setMetallicFactor(METAL_METALLIC);
        changed = true;
      }

      const r = mat.getRoughnessFactor();
      if (r > METAL_ROUGHNESS_CAP) {
        mat.setRoughnessFactor(METAL_ROUGHNESS_CAP);
        changed = true;
      }
    }

    if (changed) touched++;
  }

  await io.write(file, doc);
  console.log(`Updated materials: ${touched}/${materials.length}`);

  filesProcessed++;
}

console.log(`\nDONE. Files processed: ${filesProcessed}`);
