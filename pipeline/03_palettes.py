"""Stage 3 — download each image, extract its dominant palette, write a thumbnail.

Images are processed entirely in memory: the ~97 KB web-large file is decoded,
used for both k-means and the thumbnail, then discarded. Nothing full-size ever
touches disk (the dev machine has <3 GB free, and 2,862 web-large files would be
~280 MB of pure waste).

Palette: k-means (k=5) over pixels in CIE L*a*b*, which clusters by perceptual
similarity rather than raw RGB distance -- important here because the whole point
of the piece is that the colours read as the painting's real colours. Clusters
are ordered by pixel share, tiny clusters dropped, near-duplicates merged.

Resumable: paintings already present in data/palettes.jsonl are skipped.
Output: data/palettes.jsonl + app/thumbs/{src}/{id}.webp
"""
import io
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage
from sklearn.cluster import KMeans

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C
from sources import headers_for, image_urls, thumb_path

_pace_lock = threading.Lock()
_next_slot = [0.0]
_write_lock = threading.Lock()


def paced_fetch(url):
    with _pace_lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot[0] - now)
        _next_slot[0] = max(now, _next_slot[0]) + C.IMG_MIN_INTERVAL
    if wait:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=headers_for(url))
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


# --- colour space conversion (sRGB -> CIE L*a*b*, D65) --------------------
def srgb_to_lab(rgb):
    rgb = rgb.astype(np.float64) / 255.0
    mask = rgb > 0.04045
    lin = np.where(mask, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    matrix = np.array([[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ matrix.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    eps, kappa = 216 / 24389, 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16,
                     500 * (f[:, 0] - f[:, 1]),
                     200 * (f[:, 1] - f[:, 2])], axis=1)


def mean_chroma(arr):
    """Mean per-pixel (max-min) across RGB: 0.0 for a true greyscale scan."""
    a = arr.astype(np.int16)
    return float((a.max(axis=2) - a.min(axis=2)).mean())


def detect_backdrop(arr):
    """Return (backdrop RGB, removal tolerance) if the photograph has a studio
    surround, else None.

    Two kinds of evidence, tried in order, because a surround shows itself two
    different ways. Usually it *is* the border, and the ring test below reads it
    off the border's average. But a shaped support -- a gable, an arched
    triptych, a cross -- is only black in the corners, so its border averages to
    the painting and the ring test correctly declines; the corner test then looks
    for the surround as a region instead of as an average.
    """
    # Explicit, not `or`: these return a tuple holding a numpy array, and
    # leaning on truthiness there is the kind of thing that works until the
    # shape changes.
    ring = detect_ring_backdrop(arr)
    return ring if ring is not None else detect_corner_surround(arr)


def detect_corner_surround(arr):
    """A surround that touches the border without dominating it.

    Near-black pixels, restricted to the connected components that reach the
    edge, judged on how exactly black they are and how much of the frame they
    cover. Both tests are needed and neither is enough: paintings do have
    near-black touching their edge, but it is small, and paintings that are large
    and dark at the edge are never *exactly* black. See config for the two
    distributions these thresholds sit between.
    """
    a = arr.astype(np.int16)
    near = np.linalg.norm(a, axis=2) <= C.BACKDROP_CORNER_TOL
    if not near.any():
        return None
    labels, count = ndimage.label(near)
    if count == 0:
        return None
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    touching = np.unique(edge)
    touching = touching[touching > 0]
    if touching.size == 0:
        return None
    region = np.isin(labels, touching)
    if region.mean() < C.BACKDROP_CORNER_MIN_SHARE:
        return None                      # a shadow at the edge, not a surround
    pixels = a[region]
    blackness = float(np.median(np.linalg.norm(pixels, axis=1)))
    if blackness > C.BACKDROP_CORNER_MAX_BLACKNESS:
        return None                      # dark, but paint is never this exact
    return np.median(pixels, axis=0), C.BACKDROP_CORNER_TOL


def detect_ring_backdrop(arr):
    """Return (backdrop RGB, removal tolerance) if the border ring is a studio
    background, else None.

    A tightly-cropped painting has a busy, high-variance border ring and returns
    None, so nothing is removed. A panel shot on grey seamless -- or on black,
    which is just as common once the support stops being a rectangle -- has a
    ring that is ~one colour, which we can then subtract.

    Light and dark backdrops are admitted on different evidence, because they are
    not equally easy to mistake. Nothing in a painting is a flat light neutral
    reaching the frame on all four sides, so lightness plus uniformity settles
    it. Plenty of paintings are dark at the edge on all four sides, and their
    darkness is the work itself -- so a dark ring has to prove it is flatter than
    paint can be before anything is taken away. See config for the measurements
    the two thresholds sit between.
    """
    h, w = arr.shape[:2]
    thickness = max(2, int(min(h, w) * C.BACKDROP_RING))
    ring = np.concatenate([
        arr[:thickness].reshape(-1, 3), arr[-thickness:].reshape(-1, 3),
        arr[:, :thickness].reshape(-1, 3), arr[:, -thickness:].reshape(-1, 3),
    ]).astype(np.int16)
    median = np.median(ring, axis=0)
    if median.max() - median.min() > C.BACKDROP_MAX_CHROMA:
        return None                      # coloured -> painted, not a backdrop
    close = np.linalg.norm(ring - median, axis=1) < C.BACKDROP_UNIFORM_DIST
    if close.mean() <= C.BACKDROP_UNIFORM_FRAC:
        return None                      # busy -> the painting reaches the edge

    light = median.mean()
    if light >= C.BACKDROP_MIN_LIGHTNESS:
        return median, C.BACKDROP_TOLERANCE
    # Flatness measured only over the pixels that belong to the ring's own
    # colour: a dark passage of the painting intruding into the ring is excluded
    # by `close` and so cannot inflate the figure, and a genuinely painted ground
    # keeps its brushwork in it and fails.
    if light <= C.BACKDROP_DARK_MAX_LIGHTNESS \
            and median.max() - median.min() <= C.BACKDROP_DARK_MAX_CHROMA \
            and float(ring[close].std()) <= C.BACKDROP_DARK_MAX_STD:
        return median, C.BACKDROP_DARK_TOLERANCE
    return None                          # the painting's own ground, real content


def backdrop_mask(arr, colour, tolerance):
    """Keep-mask that removes the backdrop *region*, not the backdrop colour.

    Matching on colour alone removes every pixel of that colour anywhere in the
    picture. For a light seamless that is nearly harmless. For a dark surround it
    is not: a small panel portrait inset on black (met/435912) had 64% of itself
    inside the tolerance, because the sitter's black cap and fur robe are the
    same black as the photographer's paper, and stripping the surround would have
    taken his costume with it.

    A surround is not a colour, it is a region -- the part of that colour that
    reaches the edge of the photograph and is continuous with it. So the mask is
    built by connected components and only the components touching the border are
    dropped. The sitter's coat is interior and survives; the black around a
    shaped gable does not, which is the whole point.
    """
    near = np.linalg.norm(arr.astype(np.int16) - colour, axis=2) <= tolerance
    labels, n = ndimage.label(near)
    if n == 0:
        return np.ones(arr.shape[:2], bool)
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    touching = np.unique(edge)
    touching = touching[touching > 0]
    if touching.size == 0:
        return np.ones(arr.shape[:2], bool)
    return ~np.isin(labels, touching)


def extract_palette(img):
    """Return up to PALETTE_MAX hex colours ordered by pixel share."""
    work = img.convert("RGB").copy()
    work.thumbnail((C.ANALYSIS_PX, C.ANALYSIS_PX), Image.Resampling.LANCZOS)
    arr = np.asarray(work)

    backdrop = detect_backdrop(arr)
    flat = arr.reshape(-1, 3)
    if backdrop is not None:
        colour, tolerance = backdrop
        keep = backdrop_mask(arr, colour, tolerance).reshape(-1)
        # Guard against monochrome or very dark paintings where the "backdrop"
        # colour is actually most of the artwork.
        if keep.sum() > 400 and (1 - keep.mean()) < C.BACKDROP_MAX_REMOVED:
            flat = flat[keep]
    pixels = flat

    if len(pixels) > 12000:
        idx = np.random.default_rng(42).choice(len(pixels), 12000, replace=False)
        pixels = pixels[idx]

    k = min(C.KMEANS_K, len(np.unique(pixels, axis=0)))
    if k < 1:
        return []
    if k == 1:
        r, g, b = pixels[0]
        return ["#%02x%02x%02x" % (r, g, b)]

    lab = srgb_to_lab(pixels)
    model = KMeans(n_clusters=k, n_init=4, random_state=42, max_iter=120).fit(lab)
    labels = model.labels_

    clusters = []
    for ci in range(k):
        member = pixels[labels == ci]
        if len(member) == 0:
            continue
        share = len(member) / len(pixels)
        if share < C.MIN_CLUSTER_SHARE:
            continue
        # Median in RGB, not the LAB centroid mapped back: the median is an
        # actual-ish pixel value and avoids muddy averages across a cluster.
        rgb = np.median(member, axis=0).astype(int)
        clusters.append((share, rgb))

    clusters.sort(key=lambda c: -c[0])

    kept = []
    for _, rgb in clusters:
        if any(np.linalg.norm(rgb - other) < C.DEDUP_DISTANCE for other in kept):
            continue
        kept.append(rgb)
        if len(kept) >= C.PALETTE_MAX:
            break

    # If dedup collapsed everything, fall back to the raw ordering so a
    # monochrome painting still contributes at least one honest colour.
    if len(kept) < C.PALETTE_MIN and clusters:
        kept = [rgb for _, rgb in clusters[:C.PALETTE_MAX]]

    return ["#%02x%02x%02x" % tuple(int(v) for v in rgb) for rgb in kept]


def process(rec):
    uid, url = rec["uid"], rec["img"]
    thumb = thumb_path(uid)
    thumb.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(C.MAX_RETRIES):
        try:
            raw = paced_fetch(url)
            with Image.open(io.BytesIO(raw)) as img:
                img = ImageOps.exif_transpose(img).convert("RGB")
                probe = img.copy()
                probe.thumbnail((120, 120), Image.Resampling.LANCZOS)
                if mean_chroma(np.asarray(probe)) < C.GRAYSCALE_MAX_CHROMA:
                    return {"uid": uid, "colors": [], "skip": "grayscale"}
                colors = extract_palette(img)
                if not colors:
                    return {"uid": uid, "colors": [], "skip": "nocolors"}
                small = img.convert("RGB")
                small.thumbnail((C.THUMB_PX, C.THUMB_PX), Image.Resampling.LANCZOS)
                small.save(thumb, C.THUMB_FORMAT, quality=C.THUMB_QUALITY,
                           method=C.THUMB_METHOD)
            return {"uid": uid, "colors": colors}
        except urllib.error.HTTPError as err:
            if err.code in (403, 429, 500, 502, 503):
                time.sleep(2 ** attempt + 0.5)
                continue
            return {"uid": uid, "colors": [], "error": f"http{err.code}"}
        except Exception as exc:
            if attempt == C.MAX_RETRIES - 1:
                return {"uid": uid, "colors": [], "error": type(exc).__name__}
            time.sleep(2 ** attempt * 0.5)
    return None


def main():
    if not C.SELECTED.exists():
        sys.exit("run 01_select.py first")
    urls = image_urls()

    done = set()
    if C.PALETTES.exists():
        for line in C.PALETTES.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["uid"])

    C.THUMBS.mkdir(parents=True, exist_ok=True)
    todo = [{"uid": u, "img": url} for u, url in urls.items() if u not in done]
    print(f"with image url {len(urls)} | already done {len(done)} | to process {len(todo)}",
          flush=True)
    if not todo:
        print("nothing to do")
        return

    counts = {"ok": 0, "grayscale": 0, "empty": 0, "fail": 0}
    started = time.time()

    with open(C.PALETTES, "a", encoding="utf-8") as out:
        def handle(rec):
            result = process(rec)
            with _write_lock:
                if result is None:
                    counts["fail"] += 1
                else:
                    if result["colors"]:
                        counts["ok"] += 1
                    elif result.get("skip") == "grayscale":
                        counts["grayscale"] += 1
                    else:
                        counts["empty"] += 1
                    out.write(json.dumps(result) + "\n")
                    out.flush()
                total = sum(counts.values())
                if total % 100 == 0 or total == len(todo):
                    rate = total / max(time.time() - started, 0.01)
                    print(f"  {total}/{len(todo)}  ok={counts['ok']} "
                          f"bw={counts['grayscale']} "
                          f"empty={counts['empty']} fail={counts['fail']}  "
                          f"{rate:.1f} img/s  eta "
                          f"{(len(todo) - total) / max(rate, 0.01) / 60:.1f} min",
                          flush=True)

        with ThreadPoolExecutor(max_workers=C.IMG_WORKERS) as pool:
            list(pool.map(handle, todo))

    print(f"\ndone in {(time.time() - started) / 60:.1f} min -> {counts}", flush=True)


if __name__ == "__main__":
    main()
