"""Stage 6 -- render the social preview card, app/og.png.

A crawler does not run JavaScript. X, Slack, LinkedIn and the rest fetch the
page, read the <head>, and draw whatever `og:image` points at; the canvas they
would have to execute to see the field never runs for them. So the preview has
to exist as a file, and the only honest file to put there is the field itself.

This renders it from app/data/chromatica.json with the same arithmetic
app/js/field.js and app/js/nebula.js use -- the same Lab conversion, the same
deterministic hash for the offsets, the same density histogram, the same glow
bed and skirt-and-core compositing over the same #0a0a0a. It is not a
screenshot: nothing here is captured from a browser, so the card rebuilds itself
whenever the dataset changes and cannot drift away from what the app shows.

The one thing it cannot reproduce is time. The field breathes, and a still has
to pick a moment: it picks t=0, which is the frame the app itself composes on
load, so the card is the first thing a visitor sees rather than an arbitrary
frame out of the middle of the animation.

Output: app/og.png (1200x630, the ratio X and LinkedIn crop nothing out of)
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C

# --- card geometry -------------------------------------------------------
# 1200x630 is the size both X's summary_large_image and LinkedIn letterbox
# without cropping. Rendered at 2x and reduced with LANCZOS: the particles are
# 1-4 px discs, and antialiasing them by supersampling is far cheaper to write
# than an analytic coverage term per arc.
CARD_W, CARD_H = 1200, 630
SS = 2

# --- constants copied from the app, deliberately by value ----------------
# These are duplicated rather than imported because they live in JavaScript.
# The test suite asserts they still agree with app/js/field.js, so the copy
# cannot silently drift; see tests/test_og_constants.py.
CELL_YEARS, CELL_LUM = 10, 4
SPREAD_FLOOR, SPREAD_GAIN, SPREAD_CAP = 0.42, 0.85, 2.1
DRIFT_PX = 5.5
RANK_MASS = (1.0, 0.86, 0.74, 0.64, 0.56)
INK = 2600

GLOW_SCALE, GLOW_SPREAD, GLOW_ALPHA = 0.34, 3.1, 0.34
HALO_SPREAD, HALO_ALPHA = 2.0, 0.11
CORE_SPREAD, CORE_ALPHA = 0.9, 0.52
MAT_L, MAT_SPREAD, MAT_ALPHA, MAT_GLOW = 24, 1.55, 0.09, 0.5
ORDER_BAND = 5
BG = (0x0a, 0x0a, 0x0a)
ACCENT = (0x00, 0xff, 0x9d)

# --- sRGB -> CIE L*a*b* (D65), the same table field.js builds ------------
_LINEAR = np.array([
    (c / 255) / 12.92 if c / 255 <= 0.04045 else (((c / 255) + 0.055) / 1.055) ** 2.4
    for c in range(256)
])
_XN, _YN, _ZN = 0.95047, 1.0, 1.08883


def _f(t):
    return np.where(t > 0.008856451679, np.cbrt(t), 7.787037037 * t + 16 / 116)


def rgb_to_lab(rgb):
    """rgb: (n,3) uint8 -> (n,3) float64 of L*, a*, b*."""
    lin = _LINEAR[rgb]
    R, G, B = lin[:, 0], lin[:, 1], lin[:, 2]
    x = _f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / _XN)
    y = _f((R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / _YN)
    z = _f((R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / _ZN)
    return np.stack([116 * y - 16, 500 * (x - y), 200 * (y - z)], axis=1)


_M32 = 4294967296.0


def _to_uint32(f):
    """ECMAScript ToUint32, which is what `>>> 0` performs: truncate toward
    zero, then take the result modulo 2**32 into [0, 2**32).

    fmod rather than np.mod: for the ~9.6e18 products below, np.mod computes
    x - floor(x/y)*y and loses the low bits, while fmod is the exact IEEE
    remainder. The difference lands squarely in the bits this hash keeps.
    """
    r = np.fmod(np.trunc(f), _M32)
    return np.where(r < 0, r + _M32, r)


def _xor_shift(h, bits):
    """`h ^= h >>> bits`.

    The shift is unsigned, but `^=` yields a *signed* int32 -- so the value
    handed to the next multiply is negative whenever the top bit is set. That
    sign is not incidental; see hash01.
    """
    u = np.asarray(h).astype(np.uint32)
    r = (u ^ (u >> np.uint32(bits))).astype(np.float64)
    return np.where(r >= 2147483648.0, r - _M32, r)


def hash01(x):
    """field.js's hash01, bit for bit.

    Every particle's offset direction, its distance from its own coordinate and
    its place in the draw order come out of this. A divergence here would not
    look like a bug: it would look like a different but equally plausible
    arrangement of the same colours, which is exactly the kind of quiet lie the
    rest of this project is built to avoid. The test suite pins it against
    values taken from node.

    Two things make it awkward to reproduce outside a JavaScript engine, and
    both were got wrong before they were tested:

     1. The multiplies are *not* 32-bit modular arithmetic. `h * 2246822519` is
        a float64 multiply, and the product reaches ~9.2e18 -- past 2**53, where
        a double can no longer hold every integer -- so it is rounded to the
        nearest representable double before `>>> 0` truncates it. Exact integer
        arithmetic gives a different answer for every input but zero.
     2. `h ^= h >>> bits` returns a signed int32. Once the top bit is set the
        value going into the next multiply is negative, and the product is a
        different magnitude and rounds differently. Carrying the unsigned value
        instead diverges from the third step onward.

    So: multiplies in float64 exactly as V8 performs them, xor-shifts in
    uint32, and the sign carried between them.
    """
    h = _to_uint32(np.asarray(x, dtype=np.float64) * 2654435761.0)
    h = _xor_shift(h, 15)
    h = _to_uint32(h * 2246822519.0)
    h = _xor_shift(h, 13)
    h = _to_uint32(h * 3266489917.0)
    h = _xor_shift(h, 16)
    return _to_uint32(h) / _M32


def splat(buf, xs, ys, rs, cols, alphas, acc=None):
    """Source-over discs into a float RGB buffer, one particle at a time.

    Never "lighter". Additive blending would make a dense region of deep
    Venetian red render as pink glare; source-over makes stacked particles of
    one colour approach that colour, which is the whole compositing argument in
    nebula.js and the reason the field can be read as measurement at all.

    `acc`, when given, is the buffer's own alpha channel and `buf` is taken as
    premultiplied -- which is what a <canvas> cleared with clearRect actually
    is. The glow bed needs this: it is drawn onto transparency and then
    composited over the ground with drawImage, so its coverage has to be
    carried rather than assumed to be 1. Adding it to the ground instead lifts
    the whole cloud toward white, which is the one thing this renderer exists
    not to do.
    """
    h, w = buf.shape[:2]
    for x, y, r, col, a in zip(xs, ys, rs, cols, alphas):
        if a <= 0.002 or r <= 0:
            continue
        x0, x1 = max(0, int(x - r - 1)), min(w, int(x + r + 2))
        y0, y1 = max(0, int(y - r - 1)), min(h, int(y + r + 2))
        if x0 >= x1 or y0 >= y1:
            continue
        gy, gx = np.ogrid[y0:y1, x0:x1]
        # Antialiased coverage: a half-pixel ramp at the rim, so 32,350 discs
        # do not read as 32,350 countable rims.
        cov = np.clip(r - np.sqrt((gx - x) ** 2 + (gy - y) ** 2) + 0.5, 0.0, 1.0)
        eff = (cov * a)[..., None]
        buf[y0:y1, x0:x1] = buf[y0:y1, x0:x1] * (1 - eff) + np.asarray(col) * eff
        if acc is not None:
            acc[y0:y1, x0:x1] = acc[y0:y1, x0:x1] * (1 - eff[..., 0]) + eff[..., 0]


def build_field(data):
    """Every particle's screen position, radius, colour and draw order --
    field.js's constructor and one step() at t=0, in numpy."""
    paintings = data["paintings"]
    hexes, years, ranks = [], [], []
    for p in paintings:
        for k, h in enumerate(p["k"]):
            hexes.append(h)
            years.append(p["y"])
            ranks.append(min(k, len(RANK_MASS) - 1))
    n = len(hexes)

    rgb = np.array([[int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)] for h in hexes],
                   dtype=np.uint8)
    lab = rgb_to_lab(rgb)
    lum = lab[:, 0]
    year = np.array(years, dtype=np.float64)
    mass = np.array([RANK_MASS[r] for r in ranks])

    idx = np.arange(n, dtype=np.uint64)
    ang = hash01(idx * 2 + 1) * 2 * math.pi
    jx, jy = np.cos(ang), np.sin(ang)
    jr = np.sqrt(hash01(idx * 2 + 2))
    phase = hash01(idx * 7 + 3) * 2 * math.pi
    # step() at t=0: sin(wt)=0, cos(wt)=1, so the breathing term is sin(phase).
    wobble = DRIFT_PX * np.sin(phase)

    y0, y1 = data["meta"]["yearRange"]
    minL, maxL = lum.min(), lum.max()

    # tview, exactly as field.js's resize() computes it for the chrono layout.
    pad_x, pad_y = CARD_W * 0.045, CARD_H * 0.085
    sx = (CARD_W - pad_x * 2) / max(1, y1 - y0)
    sy = (CARD_H - pad_y * 2) / max(1, maxL - minL)

    # The chrono density histogram: a decade across by four points of L* up.
    gw = max(1, math.ceil((y1 - y0) / CELL_YEARS) + 1)
    gh = max(1, math.ceil((maxL - minL) / CELL_LUM) + 1)
    cx = np.clip(((year - y0) / CELL_YEARS).astype(int), 0, gw - 1)
    cy = np.clip(((lum - minL) / CELL_LUM).astype(int), 0, gh - 1)
    cell = cy * gw + cx
    density = np.bincount(cell, weights=mass, minlength=gw * gh)

    total = mass.sum()
    occupied = int((density > 0).sum())
    norm = occupied / total if total > 0 else 0
    relative = density[cell] * norm
    cells = np.minimum(SPREAD_CAP, SPREAD_FLOOR + SPREAD_GAIN * np.sqrt(relative)) * jr

    x = pad_x + (year - y0) * sx + jx * (cells * CELL_YEARS * sx + wobble)
    y = pad_y + (maxL - lum) * sy + jy * (cells * CELL_LUM * sy + wobble)
    rad = 1.15 + 2.5 * mass          # weight is 1 everywhere: the whole span at once

    # Draw order, darkest first with the ORDER_BAND jitter, so that overlapping
    # particles of visually identical lightness are not ranked by a difference
    # no viewer can see -- and, under the old strict sort, by construction order.
    key = lum + (hash01(np.arange(n, dtype=np.uint64) * 11 + 5) - 0.5) * ORDER_BAND
    order = np.argsort(key, kind="stable")

    lift = np.where(lum < MAT_L, (1 - lum / MAT_L) ** 2, 0.0)
    return dict(n=n, x=x, y=y, rad=rad, rgb=rgb.astype(np.float64),
                order=order, lift=lift)


def render(field):
    """nebula.js's renderCloud: glow bed, mats, then skirt and core."""
    n, order = field["n"], field["order"]
    x, y, rad, rgb, lift = field["x"], field["y"], field["rad"], field["rgb"], field["lift"]
    # The whole collection at once puts roughly eight times more colour on the
    # canvas than one period does; at full alpha it stops being a cloud and
    # becomes a slab. Alpha only -- no hue is touched.
    intensity = min(1.0, max(0.3, INK / n))

    # --- glow bed, at a fraction of the resolution, on transparency ---
    bw, bh = round(CARD_W * GLOW_SCALE), round(CARD_H * GLOW_SCALE)
    bed = np.zeros((bh, bw, 3), dtype=np.float64)     # premultiplied
    bed_a = np.zeros((bh, bw), dtype=np.float64)
    S = GLOW_SCALE
    dark = order[lift[order] > 0]
    # The dark ones' aura goes in first, under everything, so a black particle
    # contributes to the bed instead of leaving a hole in it.
    splat(bed, x[dark] * S, y[dark] * S, np.maximum(0.7, rad[dark] * S * GLOW_SPREAD),
          np.full((len(dark), 3), 255.0),
          lift[dark] * MAT_ALPHA * MAT_GLOW * intensity, acc=bed_a)
    splat(bed, x[order] * S, y[order] * S, np.maximum(0.7, rad[order] * S * GLOW_SPREAD),
          rgb[order], np.full(n, GLOW_ALPHA * intensity), acc=bed_a)

    # The upscale is the blur -- far cheaper than a real one, and it is what
    # gives the field its nebular falloff. Colour and coverage are resampled
    # together, as a browser resamples an RGBA canvas.
    bed_rgba = np.dstack([bed, bed_a * 255])
    bed_up = np.asarray(
        Image.fromarray(np.clip(bed_rgba, 0, 255).astype(np.uint8), "RGBA")
             .resize((CARD_W * SS, CARD_H * SS), Image.BICUBIC),
        dtype=np.float64)

    buf = np.zeros((CARD_H * SS, CARD_W * SS, 3), dtype=np.float64)
    buf[:] = BG
    # drawImage over the ground: source-over with the bed's own coverage, not
    # an addition. The bed carries atmosphere, it does not brighten the panel.
    a = (bed_up[:, :, 3] / 255)[..., None]
    buf = np.clip(bed_up[:, :, :3] + buf * (1 - a), 0, 255)

    sx_, sy_ = x * SS, y * SS
    rad_ = rad * SS

    # --- mats: a neutral lift under the darkest colours, so they read as dark
    # things on a raised ground rather than as holes in the panel ---
    splat(buf, sx_[dark], sy_[dark], rad_[dark] * MAT_SPREAD,
          np.full((len(dark), 3), 255.0), lift[dark] * MAT_ALPHA * intensity)

    # --- crisp pass: skirt, then core ---
    solid = np.where(lift > 0, lift, 0.0)
    splat(buf, sx_[order], sy_[order], rad_[order] * HALO_SPREAD, rgb[order],
          (HALO_ALPHA + (1 - HALO_ALPHA) * solid[order] * 0.35) * intensity)
    splat(buf, sx_[order], sy_[order], rad_[order] * CORE_SPREAD, rgb[order],
          (CORE_ALPHA + (1 - CORE_ALPHA) * solid[order]) * intensity)

    img = Image.fromarray(np.clip(buf, 0, 255).astype(np.uint8))
    return img.resize((CARD_W, CARD_H), Image.LANCZOS)


# Whatever monospace the machine has. The card is built once and committed, so
# this only ever runs on a developer's machine; if none of these exist the
# wordmark is dropped rather than falling back to a proportional face, which
# would read as a different project.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return None


def caption(img, meta):
    """The wordmark, in the interface's own register.

    The field alone would be the purer card, but a preview is read at thumbnail
    size in a feed next to a truncated title, and an unlabelled cloud of colour
    is not self-evident there the way it is on the page. So: the name, and the
    one sentence that says what the colours are. Small, cold, monospace, bottom
    left -- the HUD's register, not a logo pasted onto the artwork.
    """
    title_font, body_font = load_font(34), load_font(15)
    if not title_font or not body_font:
        print("  (no monospace font found -- wordmark skipped)")
        return img

    draw = ImageDraw.Draw(img, "RGBA")
    # A short scrim, so the type is legible over whichever colours happen to
    # land under it. Vertical gradient rather than a flat box: a hard edge
    # across the field would read as a panel, and nothing is allowed to look
    # like chrome on the field.
    scrim_h = 150
    for i in range(scrim_h):
        a = int(200 * (i / scrim_h) ** 1.6)
        draw.line([(0, CARD_H - scrim_h + i), (CARD_W, CARD_H - scrim_h + i)],
                  fill=(10, 10, 10, a))

    draw.text((54, CARD_H - 96), "C H R O M A T I C A", font=title_font,
              fill=(232, 245, 239, 255))
    line = (f"{meta['totalPaintings']:,} PAINTINGS · {meta['totalCells']:,} MEASURED COLOURS · "
            f"{meta['yearRange'][0]}–{meta['yearRange'][1]} · "
            f"{len(meta['sources'])} OPEN-ACCESS COLLECTIONS")
    draw.text((56, CARD_H - 48), line, font=body_font, fill=(*ACCENT, 235))
    return img


def main():
    data = json.loads(C.OUT_JSON.read_text())
    meta = data["meta"]
    print(f"composing {meta['totalCells']:,} particles at {CARD_W}x{CARD_H} ({SS}x supersampled)")

    field = build_field(data)
    img = render(field)
    img = caption(img, meta)

    out = C.APP / "og.png"
    img.save(out, "PNG", optimize=True)
    kb = out.stat().st_size / 1024
    print(f"wrote {out.relative_to(C.ROOT)}  {kb:.0f} KB")
    if kb > 1024:
        print("  ! over 1 MB -- some crawlers refuse to fetch that")


if __name__ == "__main__":
    main()
