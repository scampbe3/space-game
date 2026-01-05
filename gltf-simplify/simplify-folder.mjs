import fs from "node:fs/promises";
import path from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { weld, simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

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

function isGltf(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".glb" || ext === ".gltf";
}

// Counts triangles across all TRIANGLES primitives in the document.
// Note: if a primitive has no indices, we approximate tris = vertexCount / 3.
function countTris(doc) {
  let tris = 0;
  const TRIANGLES = 4;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode(); // undefined often means TRIANGLES
      if (mode !== undefined && mode !== TRIANGLES) continue;

      const idx = prim.getIndices();
      if (idx) {
        tris += idx.getCount() / 3;
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += Math.floor(pos.getCount() / 3);
      }
    }
  }

  return Math.round(tris);
}

const [,, inDirRaw, outDirRaw, ratioArg = "0.35", errorArg = "0.001"] = process.argv;
if (!inDirRaw || !outDirRaw) {
  console.log("Usage: node simplify-folder.mjs <inputDir> <outputDir> [ratio] [error]");
  process.exit(1);
}

const inDir = path.resolve(inDirRaw);
const outDir = path.resolve(outDirRaw);
const ratio = Number(ratioArg);
const error = Number(errorArg);

if (!(ratio > 0 && ratio <= 1)) {
  console.error("ratio must be in (0, 1]. Example: 0.35");
  process.exit(1);
}

for await (const file of walk(inDir)) {
  if (!isGltf(file)) continue;

  const rel = path.relative(inDir, file);
  const outPath = path.join(outDir, rel);

  console.log(`Simplifying: ${rel}`);

  try {
    const doc = await io.read(file);

    const before = countTris(doc);

    await doc.transform(
      weld({}),
      simplify({ simplifier: MeshoptSimplifier, ratio, error })
    );

    const after = countTris(doc);

    console.log(`  tris: ${before} -> ${after} (target ratio=${ratio}, error=${error})`);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await io.write(outPath, doc);
  } catch (e) {
    console.log(`  ERROR on ${rel}: ${e?.message ?? e}`);
  }
}

console.log("Done.");
