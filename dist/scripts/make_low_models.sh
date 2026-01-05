#!/usr/bin/env bash
set -e

INPUT_DIR="../models"
RATIO=0.25          # keep ~40% of triangles; adjust 0–1
EXTRA_OPTS="-cc -kn"  # compress, keep node names

for src in "$INPUT_DIR"/*.glb "$INPUT_DIR"/*.gltf; do
  [ -e "$src" ] || continue
  base=$(basename "$src")
  ext="${base##*.}"
  name="${base%.*}"
  out="$INPUT_DIR/${name}_lo.$ext"
  echo "Simplifying $base -> $(basename "$out") (ratio=$RATIO)"
  gltfpack -i "$src" -o "$out" -si "$RATIO" $EXTRA_OPTS
done

echo "Done. Verify _lo files exist in $INPUT_DIR and run the game."
