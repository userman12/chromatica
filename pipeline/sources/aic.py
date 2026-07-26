"""Art Institute of Chicago — /artworks/search, Elasticsearch DSL.

One query expresses the whole selection: their index already knows what is public
domain, what is a Painting, and what has an image, so nothing has to be
re-derived from free text. Getting the results out is the awkward part. The
endpoint caps `limit` at 100 and refuses `from + limit` above 1,000 outright
("You have requested too many results", as HTTP 403), while the result set is
~1,800. So the date range is split into windows small enough to be paged to the
end, recursively, and the windows are disjoint by construction -- no work can be
collected twice, and none falls between two of them.

Nationality is not a field. It exists only inside the parenthetical of
`artist_display`, which comes in two shapes:

    Vincent van Gogh (Dutch, 1853-1890)
    Tintoretto (Jacopo Robusti; Italian, 1518-1594)

The demonym is the last semicolon-separated part, never the first -- reading the
first gives "Jacopo Robusti" as a school. What is left is the same demonym string
the Met publishes, so it normalises identically downstream.
"""
import collections
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402
from sources import make  # noqa: E402

KEY = "aic"
PAGE = 100
FIELDS = ["id", "title", "artist_title", "artist_display", "date_start",
          "date_end", "medium_display", "image_id"]

# Anything that is a bare lifespan or an empty paren is left as "" and lands in
# "Other / unattributed", which is the honest answer for an unsigned panel.
_PAREN = re.compile(r"\(([^)]*)\)")


def nationality_of(artist_display):
    match = _PAREN.search(artist_display or "")
    if not match:
        return ""
    token = match.group(1).split(";")[-1].split(",")[0].strip()
    return "" if any(ch.isdigit() for ch in token) else token


def _post(body):
    req = urllib.request.Request(
        C.AIC_SEARCH, data=json.dumps(body).encode(),
        headers={"User-Agent": C.USER_AGENT, "AIC-User-Agent": C.AIC_UA,
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


DEEP_LIMIT = 1000       # hard ceiling on `from` + `limit`, enforced with a 403


def _query(lo, hi):
    return {"bool": {"filter": [
        {"term": {"is_public_domain": True}},
        {"term": {"artwork_type_title.keyword": "Painting"}},
        {"exists": {"field": "image_id"}},
        {"terms": {"department_title.keyword": C.AIC_DEPARTMENTS}},
        {"range": {"date_end": {"gte": lo, "lte": hi}}},
    ]}}


def _retry(body):
    for attempt in range(C.MAX_RETRIES):
        try:
            return _post(body)
        except Exception:
            if attempt == C.MAX_RETRIES - 1:
                raise
            time.sleep(2 ** attempt)


def _windows(lo, hi):
    """Year ranges each holding few enough works to be paged to the end."""
    total = _retry({"query": _query(lo, hi), "fields": ["id"], "limit": 1}
                   )["pagination"]["total"]
    if total <= DEEP_LIMIT - PAGE or lo >= hi:
        # A single year over the ceiling cannot be split further; take what the
        # endpoint will give. No year in this collection comes close.
        return [(lo, hi, total)]
    mid = (lo + hi) // 2
    time.sleep(C.API_MIN_INTERVAL)
    return _windows(lo, mid) + _windows(mid + 1, hi)


def select(stats=None):
    stats = stats if stats is not None else collections.Counter()
    out = []

    for lo, hi, total in _windows(C.YEAR_MIN, C.YEAR_MAX):
        stats["windows"] += 1
        offset = 0
        while offset < min(total, DEEP_LIMIT - PAGE):
            page = _retry({"query": _query(lo, hi), "fields": FIELDS,
                           "limit": PAGE, "from": offset})
            rows = page["data"]
            if not rows:
                break
            stats["rows"] += len(rows)
            for row in rows:
                rec = make(KEY, row["id"], row.get("title"),
                           row.get("artist_title"),
                           nationality_of(row.get("artist_display")),
                           row.get("date_start"), row.get("date_end"),
                           row.get("medium_display"),
                           img=C.AIC_IIIF.format(row["image_id"]))
                if rec is None:
                    stats["drop_date_or_medium"] += 1
                    continue
                out.append(rec)
            offset += len(rows)
            time.sleep(C.API_MIN_INTERVAL)
    return out
