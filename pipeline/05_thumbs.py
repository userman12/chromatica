"""Stage 5 — re-render the committed thumbnails at the current THUMB_PX.

Stage 3 writes thumbnails as a side effect of palette extraction, so raising
THUMB_PX cannot be applied by rerunning it: its resume log makes it skip every
painting it has already measured, and forcing it would re-run k-means over the
whole set and rewrite palettes that are already correct. This stage does the
thumbnail work alone.

It touches only paintings that are actually in the published dataset, records
each success in data/thumbs.jsonl with the size it was written at, and skips
anything already logged at the current THUMB_PX -- so an interrupted run resumes
where it stopped, and a rerun after a size change redoes exactly the stale ones.

Images are fetched once here and never again from the browser. Nothing full-size
is kept on disk.

Output: app/thumbs/{id}.jpg + data/thumbs.jsonl
"""
import io
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageOps

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import config as C

_pace_lock = __import__("threading").Lock()
_next_slot = [0.0]


def paced_fetch(url):
    """Same politeness contract as stage 3: one shared rate limiter, real UA."""
    with _pace_lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot[0] - now)
        _next_slot[0] = max(now, _next_slot[0]) + C.IMG_MIN_INTERVAL
    if wait:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": C.USER_AGENT})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def render(rec):
    oid, url = rec["id"], rec["img"]
    for attempt in range(C.MAX_RETRIES):
        try:
            raw = paced_fetch(url)
            with Image.open(io.BytesIO(raw)) as img:
                img = ImageOps.exif_transpose(img).convert("RGB")
                src = max(img.size)
                img.thumbnail((C.THUMB_PX, C.THUMB_PX), Image.Resampling.LANCZOS)
                img.save(C.THUMBS / f"{oid}.jpg", "JPEG",
                         quality=C.THUMB_QUALITY, optimize=True, progressive=True)
                return {"id": oid, "px": C.THUMB_PX, "long": max(img.size), "src": src}
        except urllib.error.HTTPError as err:
            if err.code in (403, 429, 500, 502, 503):
                time.sleep(2 ** attempt + 0.5)
                continue
            return {"id": oid, "error": f"http{err.code}"}
        except Exception as exc:
            if attempt == C.MAX_RETRIES - 1:
                return {"id": oid, "error": type(exc).__name__}
            time.sleep(2 ** attempt * 0.5)
    return {"id": oid, "error": "retries"}


def main():
    if not C.OUT_JSON.exists():
        sys.exit("run 04_build.py first — this stage only touches published works")
    if not C.IMGURLS.exists():
        sys.exit("data/image_urls.jsonl is missing; rerun 02_fetch_image_urls.py")

    published = {p["i"] for p in json.loads(C.OUT_JSON.read_text())["paintings"]}
    urls = {}
    for line in C.IMGURLS.read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            if rec.get("img"):
                urls[rec["id"]] = rec["img"]

    # Only ids already logged AT THIS SIZE count as done; a size change invalidates.
    done = set()
    if C.THUMBS_LOG.exists():
        for line in C.THUMBS_LOG.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                if rec.get("px") == C.THUMB_PX:
                    done.add(rec["id"])

    missing_url = sorted(published - set(urls))
    todo = [{"id": i, "img": urls[i]} for i in sorted(published)
            if i in urls and i not in done]

    C.THUMBS.mkdir(parents=True, exist_ok=True)
    print(f"published {len(published)} | at {C.THUMB_PX}px already {len(done)} "
          f"| to render {len(todo)} | no url {len(missing_url)}", flush=True)
    if missing_url:
        print(f"  ids without a stored url: {missing_url[:8]}", flush=True)
    if not todo:
        print("nothing to do")
        return

    ok = fail = 0
    sizes = []
    started = time.time()
    with C.THUMBS_LOG.open("a") as log, ThreadPoolExecutor(C.IMG_WORKERS) as pool:
        for n, result in enumerate(pool.map(render, todo), 1):
            log.write(json.dumps(result) + "\n")
            if result.get("error"):
                fail += 1
            else:
                ok += 1
                sizes.append(result["long"])
            if n % 100 == 0 or n == len(todo):
                log.flush()
                rate = n / max(1e-9, time.time() - started)
                left = (len(todo) - n) / max(1e-9, rate)
                print(f"  {n}/{len(todo)} ok {ok} fail {fail} "
                      f"| {rate:.1f}/s | ~{left / 60:.1f} min left", flush=True)

    total = sum(f.stat().st_size for f in C.THUMBS.glob("*.jpg"))
    print(f"rendered {ok} | failed {fail}")
    if sizes:
        sizes.sort()
        print(f"long edge: min {sizes[0]} median {sizes[len(sizes) // 2]} "
              f"max {sizes[-1]} | at target {sum(1 for s in sizes if s == C.THUMB_PX)}")
    print(f"app/thumbs now {total / 1e6:.1f} MB across "
          f"{len(list(C.THUMBS.glob('*.jpg')))} files")
    if fail:
        print("rerun this stage to retry the failures", file=sys.stderr)


if __name__ == "__main__":
    main()
