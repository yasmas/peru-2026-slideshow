#!/usr/bin/env python3
"""Build the trip order from embedded capture dates, with recovered video positions."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "Images"
OUT = ROOT / "Web"
INTRO = "b2c6cd50-757d-44f7-8862-a703852ff561.heic"
MAP = "2bdfbaca-b1b7-4e78-b453-de580d3b783a.heic"

# QuickTime creation times were rewritten on import. Camera sequence numbers,
# GPS, and nearby photo scenes give these clips their position in the trip.
VIDEO_AFTER = {
    "IMG_0230.mov": None,
    "IMG_0362.mov": "IMG_0358.heic",
    "DSCF0305.mp4": "DSCF0304.avif",
    "IMG_0439.mov": "IMG_0438.heic",
    "IMG_0440.mov": "IMG_0439.mov",
    "IMG_0479.mov": "IMG_0476.heic",
    "IMG_0508.mov": "IMG_0503.heic",
    "PC000404.mov": "IMG_0670.heic",
    "DSCF0562.mp4": "DSCF0561.avif",
    "IMG_0708.mov": "IMG_0707.heic",
    "DSCF0599.mp4": "DSCF0598.avif",
    "a63c6990-cd95-464e-af41-8714f9e624eb.mov": "IMG_0724.heic",
    "IMG_0817.mov": "IMG_0814.heic",
    "IMG_0877.mov": "a9c1955e-56fb-42c2-bd35-ef5c82ee3a8c.heic",
    "WhatsApp Video 2026-10-07 at 10.36.52.mp4": "DSCF0632.avif",
}
MORAY = "WhatsApp Image 2026-10-08 at 16.25.06.jpeg"
ROUTE_START = "DSCF0234.avif"
OMIT = {"IMG_0440.mov", "DSCF0229.avif", "DSCF0722.avif", "DSCF0726.avif",
        "DSCF0250.avif", "DSCF0266.avif", "DSCF0274.avif", "IMG_0470.heic"}

# Two-photo pairs share a screen. Larger related runs play as individual
# full-size slides so each original HDR photo is shown in full.
# The names are source-photo stems.
COLLAGE_GROUPS = [
    ("DSCF0197", "DSCF0201", "DSCF0202", "DSCF0206"),
    ("DSCF0258", "DSCF0265", "DSCF0271", "DSCF0272"),
    ("DSCF0278", "DSCF0280"),
    ("DSCF0342", "DSCF0346", "DSCF0349", "DSCF0358", "DSCF0359"),
    ("DSCF0373", "DSCF0375", "IMG_0529"),
    ("DSCF0378", "DSCF0379", "DSCF0381"),
    ("IMG_0564", "IMG_0577", "IMG_0579"),
    ("DSCF0471", "DSCF0476", "DSCF0487"),
    ("DSCF0515", "DSCF0519", "DSCF0526"),
    ("DSCF0551", "DSCF0552", "DSCF0559"),
    ("DSCF0574", "DSCF0578", "DSCF0579"),
    ("DSCF0586", "DSCF0587", "DSCF0588"),
    ("IMG_0727", "20aeec80-2190-4c9b-84cb-b7246aa05a8a", "150ad2eb-ac2d-4fbb-b978-5b563e0aab78"),
    ("DSCF0636", "DSCF0638", "DSCF0642"),
    ("DSCF0652", "DSCF0657", "DSCF0658"),
    ("IMG_0796", "IMG_0797", "IMG_0801"),
    ("IMG_0841", "IMG_0842", "IMG_0843"),
    ("5f61c3cf-9d13-4300-930b-76e760b3996b", "89a85f04-97c3-4ff2-8aec-d8315655d8db", "b1ff21e9-1ee3-4950-961d-e1f69f922188"),
    ("DSCF0682", "DSCF0683", "DSCF0690"),
    ("DSCF0149", "DSCF0152"),
    ("DSCF0174", "DSCF0175"),
    ("DSCF0192", "IMG_0280"),
    ("IMG_0394", "IMG_0398"),
    ("IMG_0492", "IMG_0494"),
    ("IMG_0424", "IMG_0425"),
    ("DSCF0394", "DSCF0401"),
    ("IMG_0537", "IMG_0539"),
    ("DSCF0434", "DSCF0435"),
    ("DSCF0446", "DSCF0448"),
    ("DSCF0546", "DSCF0548"),
    ("DSCF0560", "DSCF0561"),
    ("DSCF0566", "DSCF0568"),
    ("DSCF0570", "DSCF0571"),
    ("DSCF0583", "DSCF0585"),
    ("IMG_0723", "IMG_0724"),
    ("DSCF0607", "DSCF0611"),
    ("DSCF0612", "DSCF0613"),
    ("DSCF0615", "DSCF0616"),
    ("IMG_0805", "a1e9fa92-3b07-4613-897d-0f1320a491da"),
    ("DSCF0727", "DSCF0728"),
]
PAIR_GROUPS = [group for group in COLLAGE_GROUPS if len(group) == 2]

# Give iconic landscapes and portraits their full hold time. Other solo
# photos move at three or four seconds; place headings keep their hold time.
HERO_PHOTOS = {
    "IMG_0366", "IMG_0383", "IMG_0402", "IMG_0503", "IMG_0516",
    "DSCF0428", "DSCF0489", "DSCF0508", "DSCF0509", "IMG_0651",
    "IMG_0670", "DSCF0598", "IMG_0785", "IMG_0852", "DSCF0724",
    "IMG_0907",
}

# These short on-screen headings do not change the place shown in the route menu.
OVERLAYS = {
    "IMG_0230.mov": ("Landing in Arequipa", "", "ARRIVAL"),
    MAP: ("The Andes Journey Begins!", "", "THE ROUTE"),
    "IMG_0485.heic": ("Salineras de Maras", "Sacred Valley · Cusco", "THE SALT PANS"),
    "DSCF0651.avif": ("Urus Floating Islands", "", "LAKE TITICACA"),
    "IMG_0845.heic": ("Desert Pampa del Confital", "", "THE ROAD WEST"),
    "IMG_0877.mov": ("RE Classic 500 🤯", "", "KICK START"),
    "IMG_0912.heic": ("Until the Next Ride", "Leaving Arequipa", "TAKEOFF"),
}

# A title only at a change of place. Labels were checked against the supplied
# route map and photo locations; deliberately avoid claiming exact sights
# where the metadata only establishes the general area.
TITLES = {
    "DSCF0159.avif": ("Arequipa", "The adventure lands in the Andes", "01 / THE BEGINNING"),
    "IMG_0351.heic": ("Cabanaconde", "Into the Colca country", "02 / THE FIRST HIGH ROAD"),
    "IMG_0399.heic": ("To Espinar", "Across the wide, high puna", "03 / ABOVE THE CLOUDS"),
    "IMG_0424.heic": ("Cusco", "Stone streets and mountain air", "04 / THE ANCIENT CITY"),
    "DSCF0334.avif": ("Ollantaytambo", "The Sacred Valley opens up", "05 / THE SACRED VALLEY"),
    "DSCF0412.avif": ("Machu Picchu", "One remarkable detour from the road", "06 / THE LOST CITY"),
    "IMG_0640.heic": ("The eastern road", "From snowline to cloud forest", "07 / THE DESCENT"),
    "DSCF0545.avif": ("Quincemil", "Morning in the green", "08 / CLOUD FOREST"),
    "IMG_0744.heic": ("Macusani", "Back up where the rocks become sculptures", "09 / STONE COUNTRY"),
    "IMG_0783.heic": ("Lake Titicaca", "Llachón, on the edge of the blue", "10 / THE LAKE"),
    "IMG_0828.heic": ("The road west", "Salt flats, big sky, one more ride", "11 / HOMEWARD"),
    "IMG_0877.mov": ("Arequipa", "One last look at the machines", "12 / FULL CIRCLE"),
}
CAPTIONS = {
    MORAY: "Moray · Sacred Valley",
    "DSCF0272.avif": "The first roadblock had horns.",
    "DSCF0546.avif": "One night later, a different planet.",
    "IMG_0665.heic": "Local guide. No fee.",
    "IMG_0859.heic": "The road to nowhere looked promising.",
}
MUSIC = [
    {"file": "assets/music/01-ananau-alborada.m4a", "title": "Ananau", "artist": "Alborada", "source": "https://www.youtube.com/watch?v=RoVutuzlJS8", "startAt": 0, "maxPlay": 150},
    {"file": "assets/music/02-alturas-inti-illimani.m4a", "title": "Alturas", "artist": "Inti-Illimani", "source": "https://www.youtube.com/watch?v=IGrmEGsfAu4", "startAt": 0, "maxPlay": 150},
    {"file": "assets/music/03-diablo-rojo-rodrigo-y-gabriela.m4a", "title": "Diablo Rojo", "artist": "Rodrigo y Gabriela", "source": "https://www.youtube.com/watch?v=MHI4xr_gngM", "startAt": 0},
    {"file": "assets/music/04-bachianas-brasileiras-hauser-ceku.m4a", "title": "Bachianas Brasileiras No. 5 — Aria (Cantilena)", "artist": "HAUSER & Petrit Çeku", "source": "https://www.youtube.com/watch?v=Ill6LeBPNa0", "startAt": 0, "maxPlay": 303},
    {"file": "assets/music/05-cavatina-ana-vidovic.m4a", "title": "Cavatina", "artist": "Ana Vidović", "source": "https://www.youtube.com/watch?v=HSECkRnpsDE", "startAt": 0, "maxPlay": 166, "cacheVersion": "no-applause-1"},
    {"file": "assets/music/06-andean-spirit-etrusco-music.m4a", "title": "Andean Spirit – Peruvian Folk Charango and Flute", "artist": "Etrusco Music", "source": "https://www.youtube.com/watch?v=cr3Vb6fAvQs", "startAt": 0},
]
MOTION_PLAN = json.loads((OUT / "tools/motion_plan.json").read_text())


def metadata() -> list[dict]:
    result = subprocess.run(
        ["exiftool", "-json", "-n", "-FileName", "-DateTimeOriginal", "-Duration", "-ImageWidth", "-ImageHeight", "-Make", "-Model", "-Rating", str(SOURCE)],
        capture_output=True, text=True, check=True,
    )
    items = json.loads(result.stdout)
    # Keep the established sequence keys when Lightroom replaces an iPhone
    # HEIC with an edited JPEG of the same stem.
    for item in items:
        name = item["FileName"]
        item["SourceName"] = name
        if name.lower().endswith(".jpg") and name.startswith("IMG_"):
            item["FileName"] = Path(name).stem + ".heic"

    # This selected AVIF is absent from Images, but the original local
    # slideshow still has a playable copy. Keep its frame and use rating 3.
    present = {item["FileName"] for item in items}
    for name in ("DSCF0717.avif",):
        if name in present:
            continue
        original = OUT / "assets/originals" / name
        if not original.exists():
            raise FileNotFoundError(f"Selected photo is missing from Images and Web assets: {name}")
        fallback = subprocess.run(
            ["exiftool", "-json", "-n", "-FileName", "-DateTimeOriginal", "-ImageWidth", "-ImageHeight", "-Make", "-Model", str(original)],
            capture_output=True, text=True, check=True,
        )
        item = json.loads(fallback.stdout)[0]
        item["SourceName"] = name
        items.append(item)
    return items


def main() -> None:
    items = metadata()
    photos = sorted(
        (x for x in items if x["FileName"].lower().endswith((".heic", ".avif")) and x["FileName"] not in {INTRO, MAP} | OMIT),
        key=lambda x: (x.get("DateTimeOriginal", ""), x["FileName"]),
    )
    by_name = {x["FileName"]: x for x in items}
    ordered = [by_name[INTRO]]
    ordered += photos
    for name, after in VIDEO_AFTER.items():
        if name in OMIT:
            continue
        position = 1 if after is None else next(i for i, x in enumerate(ordered) if x["FileName"] == after) + 1
        ordered.insert(position, by_name[name])
    # This WhatsApp share has no capture EXIF. Its scene is Moray, beside the
    # Maras salt-pan visit on Oct 3; the Oct 8 filename is the sharing date.
    ordered.insert(next(i for i, x in enumerate(ordered) if x["FileName"] == "IMG_0479.mov") + 1, by_name[MORAY])
    ordered.insert(next(i for i, x in enumerate(ordered) if x["FileName"] == ROUTE_START), by_name[MAP])
    # Opening edit: start with today's frames 8-12, then frames 4-6,
    # then today's frame 3, then frame 7. The rest of the trip stays in order.
    opening = ordered[:12]
    assert [x["FileName"] for x in opening] == [
        INTRO, "IMG_0230.mov", "IMG_0235.heic", "DSCF0149.avif", "DSCF0152.avif", "IMG_0236.heic",
        "IMG_0253.heic", "DSCF0159.avif", "DSCF0164.avif", "IMG_0259.heic", "IMG_0263.heic", "IMG_0265.heic",
    ]
    ordered[:12] = opening[:2] + opening[7:12] + opening[3:6] + [opening[2], opening[6]]

    slides = []
    resolved_date = {}
    current_chapter = "Prologue"
    chapters = []
    by_stem = {Path(name).stem: item for name, item in by_name.items()}
    for index, item in enumerate(ordered):
        name = item["FileName"]
        stem = Path(name).stem
        is_video = name.lower().endswith((".mov", ".mp4"))
        is_avif = name.lower().endswith(".avif")
        source_name = item["SourceName"]
        is_heic = source_name.lower().endswith(".heic")
        is_moray = name == MORAY
        chapter_title, chapter_subtitle, chapter_kicker = TITLES.get(name, (None, None, None))
        title, subtitle, kicker = OVERLAYS.get(name, (chapter_title, chapter_subtitle, chapter_kicker))
        if chapter_title:
            current_chapter = chapter_title
            chapters.append({"title": chapter_title, "index": index, "kicker": chapter_kicker})
        capture = item.get("DateTimeOriginal", "")
        if is_video:
            # Use the anchor photo's date but no invented exact capture time.
            anchor = VIDEO_AFTER[name]
            if anchor:
                capture = resolved_date.get(anchor, by_name[anchor].get("DateTimeOriginal", ""))[:10]
            elif name == "IMG_0230.mov":
                capture = "2026:09:27"
        elif is_moray:
            capture = "2026:10:03"
        resolved_date[name] = capture
        source = ("assets/video/whatsapp-2026-10-07-103652.mp4" if name.startswith("WhatsApp Video")
                  else f"assets/video/{stem}.m4v" if is_video
                  else "assets/photos/moray-terraces.jpg" if is_moray
                  else f"assets/originals/{source_name}")
        fallback = ("assets/posters/whatsapp-2026-10-07-103652.jpg" if name.startswith("WhatsApp Video")
                    else f"assets/posters/{name}.jpg" if is_video
                    else "assets/photos/moray-terraces.jpg" if is_moray
                    else f"assets/photos/{stem}.jpg")
        is_iphone_photo = not is_video and name not in {INTRO, MAP} and (is_heic or item.get("Make") == "Apple")
        base_duration = 8 if name == INTRO else 7 if name == MAP or title else 5.2
        if is_video:
            source_duration = round(float(item.get("Duration", 0)), 1)
            duration = (4.5 if name == "IMG_0230.mov" else
                        min(source_duration, 55 if name.startswith("WhatsApp Video") else 20))
            if name == "DSCF0305.mp4":
                duration = round(duration - 5, 1)
            trim_end = round(source_duration - duration, 1) if name != "IMG_0230.mov" else 0
        else:
            duration = base_duration - (1 if is_iphone_photo else 0)
            if not title and name not in {INTRO, MAP} and stem not in HERO_PHOTOS:
                duration = 3.0 if is_iphone_photo else 4.0
            trim_end = 0
        motion = None if is_video or name in {INTRO, MAP} else MOTION_PLAN[Path(fallback).name]
        slides.append({
            "id": stem,
            "kind": "video" if is_video else "photo",
            "source": source,
            "fallback": fallback,
            "format": "video" if is_video else "avif" if is_avif else "heic" if is_heic else "jpeg",
            "rating": item.get("Rating") if item.get("Rating") in (1, 2, 3, 4, 5) else 3,
            "date": capture.replace(":", "-", 2),
            "chapter": current_chapter,
            "title": title,
            "subtitle": subtitle,
            "kicker": kicker,
            "caption": CAPTIONS.get(name),
            "transition": "shutter" if title else "dissolve",
            "motion": motion,
            "duration": duration,
            "trimEnd": trim_end,
            **({"musicVolume": 0} if name == "IMG_0439.mov" else {}),
            "opening": name == INTRO,
            "map": name == MAP,
        })

    assert len(slides) == len(items) - len(OMIT.intersection(by_name))
    groups = {group[0]: group for group in PAIR_GROUPS}
    members = [member for group in COLLAGE_GROUPS for member in group]
    assert len(members) == len(set(members)), "A photo belongs to more than one group"
    compact = []
    old_to_new = {}
    index = 0
    while index < len(slides):
        slide = slides[index]
        group = groups.get(slide["id"])
        if not group:
            old_to_new[index] = len(compact)
            compact.append(slide)
            index += 1
            continue
        photos = slides[index:index + len(group)]
        assert [photo["id"] for photo in photos] == list(group), group
        assert all(photo["kind"] == "photo" for photo in photos), group
        assert all(not photo["title"] for photo in photos[1:]), group
        assert len({photo["chapter"] for photo in photos}) == 1, group
        for old_index in range(index, index + len(group)):
            old_to_new[old_index] = len(compact)
        portrait_pair = len(photos) == 2 and all(
            by_stem[photo["id"]].get("ImageHeight", 0) >
            by_stem[photo["id"]].get("ImageWidth", 0)
            for photo in photos
        )
        layout = "portrait-pair" if portrait_pair else "diagonal"
        compact.append({**slide,
            "id": "collage-" + slide["id"],
            "kind": "collage",
            "layout": layout,
            "items": [{"id": photo["id"], "source": photo["source"],
                       "fallback": photo["fallback"], "format": photo["format"],
                       "rating": photo["rating"],
                       "alt": f"Peru trip photograph {index + offset + 1}"}
                      for offset, photo in enumerate(photos)],
            "motion": None,
            "duration": 5.5,
        })
        index += len(group)
    assert len(compact) == len(slides) - len(PAIR_GROUPS)
    assert all(member in {item["id"] for slide in compact if slide["kind"] == "collage" for item in slide["items"]}
               for member in (member for group in PAIR_GROUPS for member in group))
    for chapter in chapters:
        chapter["index"] = old_to_new[chapter["index"]]
    slides = compact

    # Music follows the trip's original frames, even when a shorter playlist
    # hides low-rated media. The player moves a filtered cue to the next frame.
    def frame_at(second):
        elapsed = 0
        for frame, slide in enumerate(slides):
            if elapsed + slide["duration"] > second:
                return frame
            elapsed += slide["duration"]
        return len(slides) - 1

    hauser_frame = next(c["index"] for c in chapters if c["title"] == "Machu Picchu") - 1
    andean_frame = next(i for i, slide in enumerate(slides) if slide["id"] == "DSCF0636")
    hauser_time = sum(slide["duration"] for slide in slides[:hauser_frame])
    cues = [
        {"track": 0, "index": 0},
        {"track": 1, "index": frame_at(150), "fadeFrames": 2},
        {"track": 2, "index": frame_at(300), "fadeFrames": 2},
        {"track": 3, "index": hauser_frame, "fadeFrames": 2},
        {"track": 4, "index": frame_at(hauser_time + 303), "fadeFrames": 2},
        {"track": 5, "index": andean_frame, "fadeFrames": 2},
    ]
    for cue in cues:
        cue["anchorId"] = slides[cue["index"]]["id"]

    data = json.dumps({"slides": slides, "chapters": chapters, "music": MUSIC, "musicCues": cues}, ensure_ascii=False, separators=(",", ":"))
    (OUT / "manifest.json").write_text(data, encoding="utf-8")
    (OUT / "manifest.js").write_text("window.PERU_TRIP = " + data + ";\n", encoding="utf-8")
    print(f"Wrote {len(slides)} slides, {len(chapters)} chapters, {len(MUSIC)} tracks")
    assert slides[0]["id"] == Path(INTRO).stem and slides[1]["id"] == "IMG_0230"
    assert slides[2]["id"] == "DSCF0159" and slides[2]["title"] == "Arequipa"
    assert slides[9]["id"] == "IMG_0235"
    map_index = next(i for i, slide in enumerate(slides) if slide["map"])
    assert slides[map_index + 1]["id"] == Path(ROUTE_START).stem


if __name__ == "__main__":
    main()
