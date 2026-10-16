#!/usr/bin/env python3
"""Prepare browser-friendly media while retaining original HDR files.

Run from this directory's parent: python3 tools/prepare_media.py
Requires macOS sips and Pillow. Original files stay in ../Images.
"""
from __future__ import annotations

import json
import filecmp
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "Images"
OUT = ROOT / "Web" / "assets"
JPG = OUT / "photos"
HDR = OUT / "originals"
TMP = OUT / ".tmp"


def main() -> None:
    for directory in (JPG, HDR, TMP):
        directory.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in SOURCE.iterdir() if p.suffix.lower() in {".heic", ".avif", ".jpg"})
    for index, source in enumerate(files, 1):
        target = JPG / (source.stem + ".jpg")
        original = HDR / source.name
        changed = not original.exists() or not filecmp.cmp(source, original, shallow=False)
        if changed:
            shutil.copy2(source, original)
        if changed or not target.exists():
            # macOS sips can silently render some edited AVIFs as solid black.
            # Pillow's AVIF decoder handles those files correctly; keep sips
            # for HEIC, which is not available in this Pillow build.
            temporary = TMP / target.name
            if source.suffix.lower() in {".avif", ".jpg", ".jpeg"}:
                image_path = source
            else:
                result = subprocess.run(
                    ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "87", "-Z", "2800", str(source), "--out", str(temporary)],
                    capture_output=True, text=True,
                )
                if result.returncode != 0 or not temporary.exists():
                    raise RuntimeError(f"sips failed for {source.name}: {result.stderr}")
                image_path = temporary
            with Image.open(image_path) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                if source.stem not in {"b2c6cd50-757d-44f7-8862-a703852ff561", "2bdfbaca-b1b7-4e78-b453-de580d3b783a"}:
                    image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
                    image.save(target, "JPEG", quality=72, optimize=True, progressive=True)
                else:
                    image.save(target, "JPEG", quality=85, optimize=True, progressive=True)
            if temporary.exists():
                temporary.unlink()
            print(f"Regenerated {source.name}", flush=True)
        if index % 25 == 0 or index == len(files):
            print(f"Prepared {index}/{len(files)} photos", flush=True)
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
