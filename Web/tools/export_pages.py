#!/usr/bin/env python3
"""Export only the files used by the offline slideshow for GitHub Pages."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
STATIC = {"index.html", "style.css", "app.js", "playback_plan.js", "manifest.js"}


def referenced_files() -> set[str]:
    manifest = json.loads((WEB / "manifest.json").read_text(encoding="utf-8"))
    files = set(STATIC)
    for slide in manifest["slides"]:
        for item in slide.get("items", [slide]):
            files.update((item["source"], item["fallback"]))
        files.add(slide["fallback"])
    files.update(track["file"] for track in manifest["music"])
    for name in files:
        source = WEB / name
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(WEB):
            raise FileNotFoundError(f"Missing or unsafe site file: {name}")
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--check", action="store_true", help="verify without copying")
    args = parser.parse_args()
    files = referenced_files()
    size = sum((WEB / name).stat().st_size for name in files)
    print(f"{len(files)} files, {size / 2**20:.1f} MiB")
    if size > 2**30:
        raise RuntimeError("Site exceeds GitHub Pages' 1 GiB published-site limit")
    if args.check:
        return
    destination = args.destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise RuntimeError(f"Destination must be empty: {destination}")
    for name in sorted(files):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(WEB / name, target)
    (destination / ".nojekyll").touch()
    print(f"Exported to {destination}")


if __name__ == "__main__":
    main()
