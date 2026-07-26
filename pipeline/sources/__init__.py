"""Per-collection adapters, all yielding the same record.

Each module here exposes `select() -> list[dict]` and does whatever its museum
requires -- a 480 MB CSV, an Elasticsearch query, a paged REST endpoint -- but
hands back records the rest of the pipeline cannot tell apart:

    {src, id, uid, title, artist, nationality, year, yearStart, yearEnd,
     medium, img}

`img` is the URL of an image big enough to measure, or None. Only the Met makes
us ask for it one object at a time (stage 2); the other three carry it in the
same response as the metadata, so for them stage 2 is a no-op.

The date and span rules are applied here rather than in each adapter, so a
painting is admitted on identical terms whichever museum owns it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402


def uid(src, oid):
    return f"{src}:{oid}"


def split_uid(u):
    src, _, oid = u.partition(":")
    return src, oid


def make(src, oid, title, artist, nationality, begin, end, medium, img=None):
    """Apply the shared date rules and return a record, or None to reject.

    Returns None rather than raising because every caller is a filter loop; the
    reason for the rejection is not interesting once the counts are printed.
    """
    if begin is None or end is None:
        return None
    begin, end = int(begin), int(end)
    if end < begin:
        begin, end = end, begin
    if end - begin > C.MAX_DATE_SPAN:
        return None
    year = (begin + end) // 2
    if not (C.YEAR_MIN <= year <= C.YEAR_MAX):
        return None
    medium = (medium or "").strip()
    if any(x in medium.lower() for x in C.EXCLUDE_MEDIUM):
        return None
    oid = str(oid)
    return {
        "src": src,
        "id": oid,
        "uid": uid(src, oid),
        "title": (title or "").strip() or "Untitled",
        "artist": (artist or "").strip() or "Unattributed",
        "nationality": (nationality or "").strip(),
        "year": year,
        "yearStart": begin,
        "yearEnd": end,
        "medium": medium,
        "img": img,
    }


def image_urls():
    """uid -> image URL, from both places one can come from.

    Three of the four collections publish the URL with the metadata, so it is
    already in selected.json. The Met's has to be looked up object by object and
    lands in image_urls.jsonl. Stages 3 and 5 do not care which, so they ask
    here rather than each merging the two files their own way.
    """
    import json
    urls = {r["uid"]: r["img"] for r in json.loads(C.SELECTED.read_text())
            if r.get("img")}
    if C.IMGURLS.exists():
        for line in C.IMGURLS.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                if rec.get("img"):
                    urls[rec["uid"]] = rec["img"]
    return urls


def headers_for(url):
    """Request headers for an image host.

    The Art Institute puts Cloudflare in front of its IIIF server and rejects
    anything without their courtesy header -- including a browser User-Agent,
    which gets an interstitial rather than a picture. The others want nothing
    beyond a truthful User-Agent, so this is the one host that needs a rule.
    """
    head = {"User-Agent": C.USER_AGENT}
    if "artic.edu" in url:
        head["AIC-User-Agent"] = C.AIC_UA
    return head


def thumb_path(uid):
    src, oid = split_uid(uid)
    return C.THUMBS / src / f"{oid}.{C.THUMB_EXT}"


def load(name):
    """Import one adapter by key. Kept lazy so a missing CSV only breaks its own
    source, and `01_select.py --only aic` runs without the Met's 480 MB file."""
    return __import__(f"sources.{name}", fromlist=["select"])
