"""Prepare frame atlases for the browser renderer from the supplied Park art.

Run with Python and Pillow when source art changes.
"""
import argparse
import json
from collections import deque
from pathlib import Path
from statistics import median_low

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
    "consume": (("food/1_consume.gif",), 120),
    "drink": (("drink.gif",), 120),
    "blowgun": (("blowgun.gif",), 120),
    "head-hit": (("head_hit.gif",), 120),
    "throw": (("throw.gif",), 120),
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


def actor_frame(frame, preserve_details=False, consumable=False):
    """Isolate the saturated body and keep a dark outline around it."""
    frame = frame.convert("RGBA")
    frame.thumbnail((300, 320), Image.Resampling.LANCZOS)
    width, height = frame.size
    pixels = list(frame.getdata())
    minimum_light = 150 if consumable else 92
    visited = bytearray(
        int(4 < i % width < width - 5 and 4 < i // width < height - 5
            and alpha >= 120 and max(r, g, b) >= minimum_light and max(r, g, b) - min(r, g, b) >= 55)
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
    if consumable:
        # Rebuild the ink from the bright body and prop to remove the glow around
        # the moving hand and keep open arm gaps transparent.
        details = Image.frombytes("L", frame.size, bytes(
            255 if max(r, g, b) >= minimum_light or (min(r, g, b) >= 90 and max(r, g, b) - min(r, g, b) < 55) else 0
            for r, g, b, _ in pixels
        ))
        core = ImageChops.lighter(core, ImageChops.multiply(details, core.filter(ImageFilter.MaxFilter(25))))
        ink = core.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(7))
        silhouette = Image.new("RGBA", frame.size, (15, 13, 19))
        silhouette.paste(frame, mask=core)
        silhouette.putalpha(ink.filter(ImageFilter.GaussianBlur(0.6)).point(lambda value: 0 if value < 18 else value))
        return silhouette
    if preserve_details:
        # Preserve small props and marks near the character while removing the background.
        detail = frame.convert("RGB").split()
        brightest = ImageChops.lighter(ImageChops.lighter(detail[0], detail[1]), detail[2])
        detail_mask = brightest.point(lambda value: 255 if value >= 48 else 0)
        core = ImageChops.lighter(core, ImageChops.multiply(detail_mask, core.filter(ImageFilter.MaxFilter(37))))
    # Close gaps from the dark ink inside the body before adding the outer outline.
    core = core.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
    outline = core.filter(ImageFilter.MaxFilter(9))
    if preserve_details:
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
    preserve_details = pose.startswith("phone-") or pose == "blowgun"
    consumable = pose in {"consume", "drink"}
    for source in sources:
        with Image.open(ASSETS / "stickmen" / color / source) as image:
            for frame in ImageSequence.Iterator(image):
                duration = frame.info.get("duration", 100)
                durations.append(max(1 if pose == "kill" else 40, duration))
                frames.append(actor_frame(frame, preserve_details=preserve_details, consumable=consumable))
    bounds = [frame.getchannel("A").getbbox() for frame in frames]
    original_bounds = bounds
    combat = pose in {"kill", "punch", "death", "pre-stun", "stun", "throw"}
    fixed_crop = combat or consumable or pose in {"phone-one", "blowgun", "head-hit"}
    if fixed_crop:
        # A common crop preserves the sprite's origin across frames.
        # Phone One stands still. Its usual foot row excludes stray pixels under the shoes.
        bottoms = [b[3] for b in bounds]
        bottom = median_low(bottoms) if pose == "phone-one" else max(bottoms)
        crop = (min(b[0] for b in bounds), min(b[1] for b in bounds),
                max(b[2] for b in bounds), bottom)
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
        if preserve_details:
            model.putalpha(fill_cutouts(model.getchannel("A")))
        if model.width > 156 or model.height > 132:
            raise ValueError(f"{color}/{pose} exceeds the gameplay frame")
        cell = Image.new("RGBA", (160, 136))
        left_offset = round(80 - (anchor_x - left) * scale) if fixed_crop else (160 - model.width) // 2
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


def smoke_atlases():
    source = ASSETS / "images" / "inventory" / "utilities" / "gif"
    for index, phase in enumerate(("start", "hold", "end"), start=1):
        frames = []
        durations = []
        with Image.open(source / f"smoke_used_{index}.gif") as image:
            for frame in ImageSequence.Iterator(image):
                durations.append(20 if phase == "start" else frame.info.get("duration", 100))
                # Remove the sprite-sheet border and use brightness as opacity for the black background.
                light = frame.convert("L").crop((3, 3, image.width - 3, image.height - 3))
                light = light.resize((256, 256), Image.Resampling.LANCZOS)
                cloud = Image.new("RGBA", light.size, (237, 236, 238))
                cloud.putalpha(light.point(lambda value: min(255, max(0, round((value - 7) * 1.12)))))
                frames.append(cloud)
        name = f"smoke-{phase}"
        yield name, atlas(name, frames, durations)


def rock_atlas():
    source = ASSETS / "images" / "inventory" / "utilities" / "gif" / "rock_used.gif"
    frames = []
    durations = []
    with Image.open(source) as image:
        for frame in ImageSequence.Iterator(image):
            durations.append(frame.info.get("duration", 30))
            rock = frame.convert("RGBA").crop((4, 4, image.width - 4, image.height - 4))
            rock = rock.resize((128, 128), Image.Resampling.LANCZOS)
            mask = rock.convert("L").point(lambda value: 255 if value > 28 else 0)
            rock.putalpha(fill_cutouts(mask).filter(ImageFilter.GaussianBlur(0.45)))
            frames.append(rock)
    return atlas("rock-projectile", frames, durations)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--poses", nargs="+", choices=POSES, help="Update only these actor poses in existing atlases")
    parser.add_argument("--smoke", action="store_true", help="Update the smoke atlases in the existing manifest")
    parser.add_argument("--rock", action="store_true", help="Update the rock projectile atlas in the existing manifest")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    incremental = args.poses or args.smoke or args.rock
    metadata = json.loads((OUTPUT / "atlases.json").read_text(encoding="utf-8")) if incremental else {
        folder.name: scene_atlas(folder)
        for folder in sorted((ASSETS / "maps" / "park").iterdir())
        if folder.is_dir() and (folder / "template.gif").exists()
    }
    for color in COLORS:
        for pose, (sources, body_height) in POSES.items():
            if incremental and pose not in (args.poses or ()):
                continue
            metadata[f"{color}-{pose}"] = actor_atlas(color, pose, sources, body_height)
    if args.smoke or not incremental:
        metadata.update(smoke_atlases())
    if args.rock or not incremental:
        metadata["rock-projectile"] = rock_atlas()
    (OUTPUT / "atlases.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
