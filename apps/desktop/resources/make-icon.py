"""Gera os ícones do app (PNG 1024, ICO para Windows e PNGs por tamanho para Linux)."""
from PIL import Image, ImageDraw
import os

SIZE = 1024
GREEN = (46, 122, 81, 255)
PAPER = (251, 250, 247, 255)

def draw(size: int) -> Image.Image:
    scale = size / SIZE
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas = ImageDraw.Draw(image)
    margin = 72 * scale
    radius = 220 * scale
    canvas.rounded_rectangle([margin, margin, size - margin, size - margin], radius=radius, fill=GREEN)
    # Cruz latina centralizada.
    bar = 92 * scale
    vertical_top, vertical_bottom = 250 * scale, 790 * scale
    horizontal_y = 400 * scale
    horizontal_half = 205 * scale
    cx = size / 2
    canvas.rounded_rectangle([cx - bar / 2, vertical_top, cx + bar / 2, vertical_bottom], radius=bar / 4, fill=PAPER)
    canvas.rounded_rectangle([cx - horizontal_half, horizontal_y - bar / 2, cx + horizontal_half, horizontal_y + bar / 2], radius=bar / 4, fill=PAPER)
    return image

here = os.path.dirname(os.path.abspath(__file__))
resources = here
os.makedirs(os.path.join(resources, 'icons'), exist_ok=True)
draw(SIZE).save(os.path.join(resources, 'icon.png'))
draw(256).save(os.path.join(resources, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
for size in (16, 32, 48, 64, 128, 256, 512):
    draw(size).save(os.path.join(resources, 'icons', f'{size}x{size}.png'))
