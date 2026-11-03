"""
Depth maps for the photo-based 3D experience.

For every photo in public/photos/*.jpg that doesn't have one yet, writes
public/photos/depth/<name>.png — a greyscale depth map (white = near) made
with the open Depth Anything V2 (Small) model. Run by the GitHub Action
.github/workflows/depth-maps.yml whenever photos are added; it can also be
run by hand:  pip install torch transformers pillow  &&  python scripts/depth_maps.py
"""
from pathlib import Path

import numpy as np
from PIL import Image
from transformers import pipeline

ROOT = Path(__file__).resolve().parent.parent
PHOTOS = ROOT / "public" / "photos"
OUT = PHOTOS / "depth"
MAX_SIDE = 768  # plenty for a depth sheet; keeps the files small

OUT.mkdir(exist_ok=True)
todo = [p for p in sorted(PHOTOS.glob("*.jp*g")) if not (OUT / f"{p.stem}.png").exists()]
print(f"{len(todo)} photo(s) need a depth map")
if todo:
    depth = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf")
    for path in todo:
        img = Image.open(path).convert("RGB")
        img.thumbnail((1024, 1024))
        d = np.asarray(depth(img)["predicted_depth"], dtype=np.float32)
        d = np.squeeze(d)
        lo, hi = np.percentile(d, 1), np.percentile(d, 99)
        d = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)  # relative depth: high = near
        out = Image.fromarray((d * 255).astype(np.uint8), mode="L")
        out.thumbnail((MAX_SIDE, MAX_SIDE))
        out = out.resize(img.size if max(img.size) <= MAX_SIDE else out.size)
        out.save(OUT / f"{path.stem}.png", optimize=True)
        print("  ", path.name)
