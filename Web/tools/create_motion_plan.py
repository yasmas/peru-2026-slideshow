#!/usr/bin/env python3
"""Turn local Vision observations into reviewed, reproducible slide motion cues.

Compile and run analyze_photos.m on macOS, then pass its JSON output here.
The player uses only the compact motion_plan.json produced by this script.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "assets/photos"
OUTPUT = Path(__file__).with_name("motion_plan.json")
SCENIC = {"hill", "mountain", "canyon", "cliff", "rocks", "desert", "lake", "river", "water_body", "valley"}
MANUAL_CUES = {
    # The distant rider at Machu Picchu is clear to a viewer, but the local
    # detector labels the outstretched arms as a scarecrow.
    "DSCF0427.jpg": {"mode": "person", "focus": [0.51, 0.39], "scale": 1.04},
    # The dogs are the subject even though the wide sky dominates the labels.
    "IMG_0814.jpg": {"mode": "zoom-in", "scale": 1.025},
}


def score(labels: dict[str, float], *names: str) -> float:
    return max((labels.get(name, 0) for name in names), default=0)


def center(box: dict, *, head: bool = False) -> list[float]:
    x = box["x"] + box["width"] / 2
    # Apple's Vision origin is bottom left; the player uses top left.
    y = 1 - (box["y"] + box["height"] * (0.82 if head else 0.5))
    return [round(max(0.05, min(0.95, x)), 3), round(max(0.05, min(0.95, y)), 3)]


def main() -> None:
    observations = {x["file"]: x for x in json.loads(Path(sys.argv[1]).read_text())}
    metadata = json.loads(subprocess.check_output([
        "exiftool", "-json", "-n", "-FileName", "-ImageWidth", "-ImageHeight", str(PHOTOS)
    ]))
    plan = {}
    wide_index = 0
    zoom_index = 0
    for photo in sorted(metadata, key=lambda x: x["FileName"]):
        name = photo["FileName"]
        result = observations.get(name)
        if not result:
            raise SystemExit(f"Missing Vision result for {name}")
        labels = {x["name"]: x["confidence"] for x in result["labels"]}
        ratio = photo["ImageWidth"] / photo["ImageHeight"]
        faces = sorted(result["faces"], key=lambda b: b["width"] * b["height"], reverse=True)
        people = sorted(result["humans"], key=lambda b: b["width"] * b["height"], reverse=True)
        faces = [b for b in faces if b["width"] * b["height"] >= 0.0015]
        people = [b for b in people if b["width"] * b["height"] >= 0.015]

        if name in MANUAL_CUES:
            cue = MANUAL_CUES[name]
        elif faces and (score(labels, "people", "adult", "child") >= 0.42 or faces[0]["width"] * faces[0]["height"] >= 0.015):
            # A group stays together; a single portrait can move a little closer.
            targets = faces[:3]
            centers = [center(b) for b in targets]
            focus = [round(sum(c[axis] for c in centers) / len(centers), 3) for axis in (0, 1)]
            cue = {"mode": "face", "focus": focus, "scale": 1.06 if len(targets) == 1 else 1.045}
        elif people and score(labels, "people", "adult", "child") >= 0.55:
            targets = people[:3]
            centers = [center(b, head=True) for b in targets]
            focus = [round(sum(c[axis] for c in centers) / len(centers), 3) for axis in (0, 1)]
            cue = {"mode": "person", "focus": focus, "scale": 1.04 if len(targets) == 1 else 1.03}
        elif ratio >= 1.70:
            cue = {"mode": "pan", "direction": "right" if wide_index % 2 == 0 else "left", "scale": 1.018}
            wide_index += 1
        elif (ratio >= 1.25 and score(labels, "outdoor") >= 0.7
              and score(labels, "animal", "machine") < 0.6
              and (score(labels, "land") >= 0.5 and score(labels, *SCENIC) >= 0.4
                   or score(labels, "rocks") >= 0.5
                   or score(labels, "plant", "foliage") >= 0.7
                   or score(labels, "sunset_sunrise") >= 0.6
                   or score(labels, "land") >= 0.8 and score(labels, "sky") >= 0.4)):
            cue = {"mode": "hold"}
        else:
            cue = {"mode": "zoom-in" if zoom_index % 2 == 0 else "zoom-out", "scale": 1.025}
            zoom_index += 1
        plan[name] = cue

    OUTPUT.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n")
    from collections import Counter
    print(f"Wrote {len(plan)} photo cues: {dict(Counter(x['mode'] for x in plan.values()))}")


if __name__ == "__main__":
    main()
