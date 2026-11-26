#!/usr/bin/env python3
"""Generate Lucas's original abstract connection icon, without lettering."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
tile = Image.new("RGBA", img.size)
pixels = tile.load()
for y in range(SIZE):
    t = y / SIZE
    for x in range(SIZE):
        pixels[x, y] = (int(28 + 8*t), int(31 + 8*t), int(36 + 8*t), 255)
mask = Image.new("L", img.size)
ImageDraw.Draw(mask).rounded_rectangle((24, 24, 1000, 1000), radius=224, fill=255)
img.paste(tile, (0, 0), mask)
ImageDraw.Draw(img).rounded_rectangle((25, 25, 999, 999), radius=223, outline=(255, 255, 255, 32), width=2)

gradient = Image.new("RGBA", img.size)
gp = gradient.load()
for x in range(SIZE):
    t = x / SIZE
    for y in range(SIZE):
        gp[x, y] = (int(94 + (96-94)*t), int(234 + (165-234)*t), int(212 + (250-212)*t), 255)

# Rounded adjustment tracks communicate settings without using a letter.
tracks = [(320, 380), (512, 640), (704, 500)]
strokes = Image.new("L", img.size)
draw = ImageDraw.Draw(strokes)
for y, knob in tracks:
    draw.rounded_rectangle((238, y-14, 786, y+14), radius=14, fill=255)
    draw.ellipse((knob-50, y-50, knob+50, y+50), fill=255)
img.paste(gradient, (0, 0), strokes)

out = ROOT / "build" / "appicon.png"
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out)
print(out)
