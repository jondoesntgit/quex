#!/usr/bin/env bash
# Rebuild every tile atlas from scratch: Blender renders -> palette snap -> atlas.
# PixelLab creature sprites in art/pixellab are swapped in for the 64 px atlas.
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
for s in ${SIZES:-24 32 40 48 64}; do
  "$BLENDER" --background --factory-startup --python tools/blender/render_tiles.py -- --size "$s" --out "art/raw/$s" > /dev/null
  python3 tools/post_tiles.py "art/raw/$s" "public/art/$s"
done
python3 tools/preview_monsters.py art/preview_monsters_64.png
