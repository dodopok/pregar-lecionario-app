"""Gera os ícones do app a partir da marca do Proper: o pilcrow (¶), o sinal das rubricas dos
livros de oração, em papel sobre o verde litúrgico. Saída: icon.png (1024, usado no macOS, onde o
electron-builder converte para .icns), icon.ico (Windows) e icons/<n>x<n>.png (Linux).

A geometria é a mesma do SVG em AppRail.vue e AboutSection.vue (caixa de 100 unidades):
bojo = retângulo (38,14)-(62,56) + semidisco à esquerda com centro (38,35) e raio 21;
hastes = (54,14)-(63,88) e (69,14)-(78,88). Desenha em 4096 px e reduz, para bordas limpas.

Uso: python3 make-icon.py   (precisa do Pillow)
"""
from PIL import Image, ImageDraw
import os

SIZE = 1024
SUPERSAMPLE = 4
GREEN = (46, 122, 81, 255)
PAPER = (245, 243, 238, 255)

# Modelo da Apple para ícones do macOS: tile de 824 px centrado na tela de 1024, cantos de 185 px.
TILE = 824
RADIUS = 185
MARK_SCALE = 0.70  # a caixa de 100 unidades da marca ocupa 70 % do tile


def draw_master() -> Image.Image:
    big = SIZE * SUPERSAMPLE
    image = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    canvas = ImageDraw.Draw(image)
    s = SUPERSAMPLE
    margin = (SIZE - TILE) / 2 * s
    canvas.rounded_rectangle([margin, margin, big - margin, big - margin], radius=RADIUS * s, fill=GREEN)

    unit = TILE * MARK_SCALE / 100 * s
    # Centraliza a caixa do glifo (x 17..78, y 14..88) no tile e aplica um ajuste óptico pequeno:
    # o bojo deixa a massa da marca acima e à direita do centro, então ela desce 1 % e vai 0,4 % à esquerda.
    ox = margin + (TILE * s - 100 * unit) / 2 + 1.8 * unit
    oy = margin + (TILE * s - 100 * unit) / 2 + 0.7 * unit

    def box(x1, y1, x2, y2):
        return [ox + x1 * unit, oy + y1 * unit, ox + x2 * unit, oy + y2 * unit]

    canvas.rectangle(box(38, 14, 62, 56), fill=PAPER)
    canvas.ellipse(box(17, 14, 59, 56), fill=PAPER)
    canvas.rectangle(box(54, 14, 63, 88), fill=PAPER)
    canvas.rectangle(box(69, 14, 78, 88), fill=PAPER)
    return image.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.join(here, 'icons'), exist_ok=True)
    master = draw_master()
    master.save(os.path.join(here, 'icon.png'))
    master.resize((256, 256), Image.LANCZOS).save(
        os.path.join(here, 'icon.ico'),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    for size in (16, 32, 48, 64, 128, 256, 512):
        master.resize((size, size), Image.LANCZOS).save(os.path.join(here, 'icons', f'{size}x{size}.png'))


if __name__ == '__main__':
    main()
