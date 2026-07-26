"""Stage 2 — resolve an image URL for the paintings that do not carry one.

In practice this means the Met, and only the Met. The other three collections
return an image URL in the same response as the metadata, so stage 1 already
filled it in and there is nothing here for them to do. The Met's Open Access CSV
carries no image URL and no has-image flag, so its object endpoint has to be hit
once per painting. It rejects bursts with HTTP 403 (4 concurrent workers lost 83%
of requests during testing), so requests are globally paced and retried with
exponential backoff.

Resumable: already-resolved uids are read from data/image_urls.jsonl and skipped.
Output: data/image_urls.jsonl  {"uid":..,"img":..} or {"uid":..,"img":null}
"""
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C
from sources import split_uid

_pace_lock = threading.Lock()
_next_slot = [0.0]
_write_lock = threading.Lock()


def paced_get(url, min_interval):
    """Serialize request start times globally so bursts never form."""
    with _pace_lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot[0] - now)
        _next_slot[0] = max(now, _next_slot[0]) + min_interval
    if wait:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": C.USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read()


def fetch_one(obj):
    uid = obj["uid"]
    _, oid = split_uid(uid)
    for attempt in range(C.MAX_RETRIES):
        try:
            data = json.loads(paced_get(C.API_BASE + oid, C.API_MIN_INTERVAL))
            return {"uid": uid, "img": data.get("primaryImageSmall") or None}
        except urllib.error.HTTPError as err:
            if err.code in (403, 429, 500, 502, 503):
                time.sleep(2 ** attempt + 0.5)      # 1.5, 2.5, 4.5, 8.5, 16.5
                continue
            if err.code == 404:
                return {"uid": uid, "img": None}
            time.sleep(1.5)
        except Exception:
            time.sleep(2 ** attempt * 0.5)
    return None                                      # give up: retried next run


def main():
    selected = json.loads(C.SELECTED.read_text())
    needs_lookup = [o for o in selected if not o.get("img")]

    done = set()
    if C.IMGURLS.exists():
        for line in C.IMGURLS.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["uid"])
    todo = [o for o in needs_lookup if o["uid"] not in done]

    print(f"selected {len(selected)} | url already in metadata "
          f"{len(selected) - len(needs_lookup)} | need lookup {len(needs_lookup)} "
          f"| already resolved {len(needs_lookup) - len(todo)} | to fetch {len(todo)}",
          flush=True)
    if not todo:
        print("nothing to do")
        return

    counts = {"ok": 0, "noimg": 0, "fail": 0}
    started = time.time()

    with open(C.IMGURLS, "a", encoding="utf-8") as out:
        def handle(obj):
            rec = fetch_one(obj)
            with _write_lock:
                if rec is None:
                    counts["fail"] += 1
                else:
                    counts["ok" if rec["img"] else "noimg"] += 1
                    out.write(json.dumps(rec) + "\n")
                    out.flush()
                total = sum(counts.values())
                if total % 100 == 0 or total == len(todo):
                    rate = total / max(time.time() - started, 0.01)
                    eta = (len(todo) - total) / max(rate, 0.01) / 60
                    print(f"  {total}/{len(todo)}  ok={counts['ok']} "
                          f"noimg={counts['noimg']} fail={counts['fail']}  "
                          f"{rate:.1f} req/s  eta {eta:.1f} min", flush=True)

        with ThreadPoolExecutor(max_workers=C.API_WORKERS) as pool:
            list(pool.map(handle, todo))

    print(f"\ndone in {(time.time() - started) / 60:.1f} min -> {counts}", flush=True)
    if counts["fail"]:
        print("re-run this script to retry the failures", flush=True)


if __name__ == "__main__":
    main()
