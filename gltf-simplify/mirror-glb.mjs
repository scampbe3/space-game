// mirror-glb.mjs
// Usage:
//   node mirror-glb.mjs "in.glb" "out.glb" --axis x --mode node
//   node mirror-glb.mjs "in.glb" "out.glb" --axis x --mode bake
//
// axis: x|y|z  (which axis to flip; x = typical left/right mirror)
// mode:
//   node = add a parent node with negative scale (best for rigs/animations)
//   bake = rewrite vertex data + reverse triangle winding (best for static meshes)

import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

await MeshoptDecoder.ready;

const io = new NodeIO().registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

function parseArgs(argv) {
  const args = { axis: "x", mode: "node" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--axis") args.axis = (argv[++i] ?? "x").toLowerCase();
    if (a === "--mode") args.mode = (argv[++i] ?? "node").toLowerCase();
  }
  return args;
}

function axisIndex(axis) {
  if (axis === "x") return 0;
  if (axis === "y") return 1;
  if (axis === "z") return 2;
  throw new Error(`Invalid --axis "${axis}" (use x|y|z).`);
}

function mirrorScaleVec(axis) {
  return axis === "x" ? [-1, 1, 1] : axis === "y" ? [1, -1, 1] : [1, 1, -1];
}

// ---- MODE A: NODE WRAP ----
function mirrorByNodeWrap(doc, axis) {
  const root = doc.getRoot();
  const scenes = root.listScenes();

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const oldRoots = scene.listChildren(); // root nodes of the scene

    // Create a wrapper node that mirrors everything beneath it.
    const wrapper = doc.createNode(`Mirror_${axis.toUpperCase()}_${si}`);
    wrapper.setScale(mirrorScaleVec(axis));

    // Move old roots under wrapper.
    for (const n of oldRoots) {
      scene.removeChild(n);
      wrapper.addChild(n);
    }

    // Make wrapper the only root for the scene.
    scene.addChild(wrapper);
  }
}

// ---- MODE B: BAKE INTO GEOMETRY ----
function reverseTriangleWinding(indices) {
  // swap i1 and i2 for each triangle: (i0,i1,i2) -> (i0,i2,i1)
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tmp = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = tmp;
  }
}

function mirrorAccessorVecN(accessor, n, flipComponentIndex) {
  if (!accessor) return;
  const arr = accessor.getArray();
  if (!arr) return;
  for (let i = flipComponentIndex; i < arr.length; i += n) {
    arr[i] = -arr[i];
  }
  accessor.setArray(arr);
}

function mirrorTangents(accessor, flipComponentIndex) {
  if (!accessor) return;
  const arr = accessor.getArray();
  if (!arr) return;
  // Tangent is VEC4 (x,y,z,w). Mirror xyz component, and flip w to preserve handedness.
  for (let i = 0; i + 3 < arr.length; i += 4) {
    arr[i + flipComponentIndex] = -arr[i + flipComponentIndex];
    arr[i + 3] = -arr[i + 3];
  }
  accessor.setArray(arr);
}

function ensureIndices(doc, primitive) {
  let idx = primitive.getIndices();
  if (idx) return idx;

  // Create indices if none exist.
  const pos = primitive.getAttribute("POSITION");
  if (!pos) return null;

  const count = pos.getCount();
  // Choose a compact index type if possible.
  const useUint16 = count <= 65535;
  const arr = useUint16 ? new Uint16Array(count) : new Uint32Array(count);
  for (let i = 0; i < count; i++) arr[i] = i;

  idx = doc.createAccessor()
    .setType("SCALAR")
    .setArray(arr);

  primitive.setIndices(idx);
  return idx;
}

function mirrorByBaking(doc, axis) {
  const ai = axisIndex(axis);
  const root = doc.getRoot();

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      // Only handle TRIANGLES (most common).
      const mode = prim.getMode(); // undefined means TRIANGLES in many cases
      const TRIANGLES = 4;
      if (mode !== undefined && mode !== TRIANGLES) continue;

      // Mirror geometry attributes.
      mirrorAccessorVecN(prim.getAttribute("POSITION"), 3, ai);
      mirrorAccessorVecN(prim.getAttribute("NORMAL"), 3, ai);
      mirrorTangents(prim.getAttribute("TANGENT"), ai);

      // Mirror morph targets too, if present.
      for (const target of prim.listTargets()) {
        mirrorAccessorVecN(target.getAttribute("POSITION"), 3, ai);
        mirrorAccessorVecN(target.getAttribute("NORMAL"), 3, ai);
        mirrorTangents(target.getAttribute("TANGENT"), ai);
      }

      // Fix winding (critical after reflection).
      const idx = ensureIndices(doc, prim);
      if (idx) {
        const arr = idx.getArray();
        reverseTriangleWinding(arr);
        idx.setArray(arr);
      }
    }
  }
}

async function main() {
  const [,, inPathRaw, outPathRaw, ...rest] = process.argv;
  if (!inPathRaw || !outPathRaw) {
    console.log(`Usage:
  node mirror-glb.mjs "in.glb" "out.glb" --axis x --mode node
  node mirror-glb.mjs "in.glb" "out.glb" --axis x --mode bake`);
    process.exit(1);
  }

  const { axis, mode } = parseArgs(rest);
  const inPath = path.resolve(inPathRaw);
  const outPath = path.resolve(outPathRaw);

  const doc = await io.read(inPath);

  if (mode === "node") mirrorByNodeWrap(doc, axis);
  else if (mode === "bake") mirrorByBaking(doc, axis);
  else throw new Error(`Invalid --mode "${mode}" (use node|bake).`);

  await io.write(outPath, doc);
  console.log(`Wrote: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
