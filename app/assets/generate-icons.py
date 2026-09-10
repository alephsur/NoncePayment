"""
Generates the app icons.

They are placeholders with intent, not final art: a banknote in the Solana gradient,
which is the whole product in one glyph. Kept as a script rather than committed art
with no provenance, so the colours can be changed in one place — they come from
`src/ui/theme.ts`.

    python3 assets/generate-icons.py

`adaptive-icon.png` is the Android adaptive foreground: transparent, and the artwork
stays inside the safe circle (66% of the canvas) because Android crops the rest to
whatever mask the launcher uses. `icon.png` is the full-bleed one for everywhere else.
"""
from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersampling, for edges that don't look chewed
BG = (11, 11, 15, 255)        # theme.bg
GREEN = (20, 241, 149)        # theme.accent
PURPLE = (153, 69, 255)       # theme.accentAlt


def gradient(w: int, h: int) -> Image.Image:
    """Diagonal Solana gradient, green to purple."""
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2
            px[x, y] = (
                round(GREEN[0] + (PURPLE[0] - GREEN[0]) * t),
                round(GREEN[1] + (PURPLE[1] - GREEN[1]) * t),
                round(GREEN[2] + (PURPLE[2] - GREEN[2]) * t),
            )
    return img


def banknote(canvas: int, note_w: int, note_h: int) -> Image.Image:
    """A banknote: rounded rectangle, a seal in the middle, two ticks on the sides."""
    c = canvas * SS
    w, h = note_w * SS, note_h * SS
    r = 44 * SS

    # The note itself, as a gradient clipped by a rounded rectangle.
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    note = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    note.paste(gradient(w, h), (0, 0), mask)

    d = ImageDraw.Draw(note)
    cx, cy = w // 2, h // 2

    # The seal: a punched-out ring, so the banknote reads as money and not as a card.
    outer, inner = 78 * SS, 52 * SS
    d.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], fill=(0, 0, 0, 0))
    d.ellipse(
        [cx - inner, cy - inner, cx + inner, cy + inner],
        outline=None,
        fill=None,
    )
    ring = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse(
        [cx - inner, cy - inner, cx + inner, cy + inner], fill=(255, 255, 255, 255)
    )
    note.paste(gradient(w, h), (0, 0), ring.split()[3])

    # Two ticks, the way a note has a value printed at each end.
    tick_w, tick_h, pad = 26 * SS, 96 * SS, 60 * SS
    for x in (pad, w - pad - tick_w):
        d.rounded_rectangle(
            [x, cy - tick_h // 2, x + tick_w, cy + tick_h // 2],
            radius=tick_w // 2,
            fill=(0, 0, 0, 0),
        )

    out = Image.new('RGBA', (c, c), (0, 0, 0, 0))
    out.paste(note, ((c - w) // 2, (c - h) // 2), note)
    return out.resize((canvas, canvas), Image.LANCZOS)


# Adaptive foreground: transparent, artwork inside the safe circle.
adaptive = banknote(SIZE, 600, 380)
adaptive.save('assets/adaptive-icon.png')

# Full-bleed icon: the same mark over the app background.
icon = Image.new('RGBA', (SIZE, SIZE), BG)
icon.alpha_composite(banknote(SIZE, 700, 444))
icon.save('assets/icon.png')

print('written: assets/adaptive-icon.png, assets/icon.png')
