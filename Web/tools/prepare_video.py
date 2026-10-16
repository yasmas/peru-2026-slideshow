#!/usr/bin/env python3
"""Transcode trip clips to browser-friendly H.264/M4V files."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
source = root / "Images"
output = root / "Web" / "assets" / "video"
output.mkdir(parents=True, exist_ok=True)
files = sorted(p for p in source.iterdir() if p.suffix.lower() in {".mov", ".mp4"})
for i, path in enumerate(files, 1):
    target = output / (path.stem + ".m4v")
    if not target.exists():
        result = subprocess.run(["avconvert", "-s", str(path), "-p", "PresetAppleM4V1080pHD", "-o", str(target)], capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Video conversion failed: {path.name}\n{result.stderr}")
    print(f"Prepared {i}/{len(files)} clips: {path.name}", flush=True)
