"""Prepare frame atlases for the browser renderer from the supplied Park art.

Run with Python and Pillow when source art changes.
"""
import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OUTPUT = ASSETS / "gameplay"
COLORS = ("blue", "green", "orange", "purple", "red", "yellow")
POSES = {
    "idle": (("idle.png",), 120),
    "walk": (("walk.gif",), 117),
    "sprint": (("sprint.gif",), 108),
    "sit": (("sit.gif",), 88),
    "dance": (("dance/one.gif", "dance/two.gif", "dance/three.gif"), 120),
    "talk": (("talking/one.gif", "talking/two.gif", "talking/three.gif"), 120),
    "phone-one": (("phone_surfing/one.gif",), 120),
    "phone-two": (("phone_surfing/two.gif",), 120),
    "phone-three": (("phone_surfing/three.gif",), 120),
    **{f"talk-{clip}": ((f"talking/{clip}.gif",), 120) for clip in ("one", "two", "three")},
    **{f"dance-{clip}": ((f"dance/{clip}.gif",), 120) for clip in ("one", "two", "three")},
    **{f"scream-{clip}": ((f"scream/{clip}.gif",), 120) for clip in ("one", "two", "three")},
    "kill": (("kill.gif",), 120),
    "punch": (("punch.gif",), 120),
    "death": (("death.gif",), 120),
    "pre-stun": (("pre-stun.gif",), 120),
    "stun": (("stun.gif",), 120),
}


def fill_cutouts(alpha):
    width, height = alpha.size
    outside = Image.new("L", (width + 2, height + 2))
    outside.paste(alpha.point(lambda value: 255 if value >= 128 else 0), (1, 1))
    ImageDraw.floodfill(outside, (0, 0), 128)
    holes = outside.crop((1, 1, width + 1, height + 1)).point(lambda value: 255 if value == 0 else 0)
    return ImageChops.lighter(alpha, holes)


def actor_frame(frame, preserve_phone=False):
    """Isolate the saturated body and keep a dark outline around it."""
    frame = frame.convert("RGBA")
    frame.thumbnail((300, 320), Image.Resampling.LANCZOS)
    width, height = frame.size
    pixels = list(frame.getdata())
    visited = bytearray(
        int(4 < i % width < width - 5 and 4 < i // width < height - 5
            and alpha >= 120 and max(r, g, b) >= 92 and max(r, g, b) - min(r, g, b) >= 55)
        for i, (r, g, b, alpha) in enumerate(pixels)
    )
    core = bytearray(width * height)
    for index, marked in enumerate(visited):
        if not marked:
            continue
        visited[index] = 0
        connected = [index]
        remaining = deque(connected)
        while remaining:
            point = remaining.popleft()
            for neighbor in (point - width, point - 1, point + 1, point + width):
                if 0 <= neighbor < len(visited) and visited[neighbor]:
                    visited[neighbor] = 0
                    connected.append(neighbor)
                    remaining.append(neighbor)
        if len(connected) >= 32:
            for point in connected:
                core[point] = 255

    core = Image.frombytes("L", (width, height), bytes(core))
    if not core.getbbox():
        raise ValueError("No character found")
    if preserve_phone:
        # Keep dim and neutral phone details near the character, without retaining the black background.
        detail = frame.convert("RGB").split()
        brightest = ImageChops.lighter(ImageChops.lighter(detail[0], detail[1]), detail[2])
        detail_mask = brightest.point(lambda value: 255 if value >= 48 else 0)
        core = ImageChops.lighter(core, ImageChops.multiply(detail_mask, core.filter(ImageFilter.MaxFilter(37))))
    # Close gaps from the dark ink inside the body before adding the outer outline.
    core = core.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    outline = core.filter(ImageFilter.MaxFilter(9))
    if preserve_phone:
        # Flood the outside so holes inside the model become solid and open gaps stay transparent.
        outline = fill_cutouts(outline)
    matte = outline.filter(ImageFilter.GaussianBlur(0.7))
    matte = matte.point(lambda value: 0 if value < 18 else value)
    frame.putalpha(ImageChops.darker(matte, frame.getchannel("A")))
    return frame


def atlas(name, frames, durations):
    width, height = frames[0].size
    columns = min(4, len(frames))
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new("RGBA", (columns * width, rows * height))
    for index, frame in enumerate(frames):
        sheet.paste(frame, (index % columns * width, index // columns * height))
    sheet.save(OUTPUT / f"{name}.webp", lossless=True, method=6)
    return {"width": width, "height": height, "columns": columns, "durations": durations}


def actor_atlas(color, pose, sources, body_height):
    frames = []
    durations = []
    for source in sources:
        with Image.open(ASSETS / "stickmen" / color / source) as image:
            for frame in ImageSequence.Iterator(image):
                duration = frame.info.get("duration", 100)
                durations.append(max(1 if pose == "kill" else 40, duration))
                frames.append(actor_frame(frame, preserve_phone=pose.startswith("phone-")))
    bounds = [frame.getchannel("A").getbbox() for frame in frames]
    original_bounds = bounds
    combat = pose in {"kill", "punch", "death", "pre-stun", "stun"}
    if combat:
        # A common crop keeps limbs and collapsing bodies from being recentered each frame.
        crop = (min(b[0] for b in bounds), min(b[1] for b in bounds),
                max(b[2] for b in bounds), max(b[3] for b in bounds))
        anchor_x = (bounds[0][0] + bounds[0][2]) / 2
        reach = max(anchor_x - crop[0], crop[2] - anchor_x)
        scale = min(body_height / (crop[3] - crop[1]), 76 / reach)
        bounds = [crop] * len(frames)
    else:
        anchor_x = None
        core_height = max(bottom - top for _, top, _, bottom in bounds)
        scale = body_height / core_height
    result = []
    for frame, (left, top, right, bottom), original in zip(frames, bounds, original_bounds):
        model = frame.crop((left, top, right, bottom))
        model = model.resize(
            (round(model.width * scale), round(model.height * scale)), Image.Resampling.LANCZOS
        )
        if pose.startswith("phone-"):
            model.putalpha(fill_cutouts(model.getchannel("A")))
        if model.width > 156 or model.height > 132:
            raise ValueError(f"{color}/{pose} exceeds the gameplay frame")
        cell = Image.new("RGBA", (160, 136))
        left_offset = round(80 - (anchor_x - left) * scale) if combat else (160 - model.width) // 2
        # Keep the lowest body pixel on the ground, including the fallen corpse.
        ground_offset = round((bottom - original[3]) * scale) if combat else 0
        cell.paste(model, (left_offset, 132 - model.height + ground_offset))
        result.append(cell)
    return atlas(f"{color}-{pose}", result, durations)


def scene_atlas(folder):
    with Image.open(folder / "template.gif") as image:
        durations = []
        frames = []
        for frame in ImageSequence.Iterator(image):
            durations.append(max(40, frame.info.get("duration", 100)))
            frames.append(frame.convert("RGBA"))
    return atlas(folder.name, frames, durations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--poses", nargs="+", choices=POSES, help="Update only these actor poses in existing atlases")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    metadata = json.loads((OUTPUT / "atlases.json").read_text(encoding="utf-8")) if args.poses else {
        folder.name: scene_atlas(folder)
        for folder in sorted((ASSETS / "maps" / "park").iterdir())
        if folder.is_dir() and (folder / "template.gif").exists()
    }
    for color in COLORS:
        for pose, (sources, body_height) in POSES.items():
            if args.poses and pose not in args.poses:
                continue
            metadata[f"{color}-{pose}"] = actor_atlas(color, pose, sources, body_height)
    (OUTPUT / "atlases.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
