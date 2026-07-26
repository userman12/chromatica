"""Cleveland Museum of Art — open access REST, cc0=1.

Cleveland's CC0 painting set is ~3,970 works, but roughly two thirds of it is
Mughal, Indian, Chinese, Japanese, Korean and Himalayan painting: this is one of
the great Asian collections. Those are excluded here for exactly the reason the
Met's Asian Art department is (see config.DEPARTMENTS) -- the field is one
chronological axis, and running independent traditions through it would assert a
shared history that is not there. Cleveland catalogues by `culture` rather than
by department, so the rule has to be written as a vocabulary: C.CMA_WESTERN.

Unlike the Met and the National Gallery, Cleveland serves a ready-made web
derivative, so no IIIF parameters are involved.
"""
import collections
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402
from sources import make  # noqa: E402

KEY = "cma"
PAGE = 1000
FIELDS = ("id,title,creation_date_earliest,creation_date_latest,culture,"
          "creators,technique,images")


# Cleveland catalogues where a work is from; the Met and the National Gallery
# catalogue what the artist was. The SCHOOL filter is one vocabulary shared by
# all four, so the place has to be turned into the demonym the other three
# already use, or "Italy" and "Italian" would sit in the list as two schools.
DEMONYM = {
    "america": "American", "austria": "Austrian", "belgium": "Belgian",
    "britain": "British", "byzantium": "Byzantine", "canada": "Canadian",
    "denmark": "Danish", "england": "British", "flanders": "Flemish",
    "france": "French", "germany": "German", "greece": "Greek",
    "hungary": "Hungarian", "ireland": "Irish", "italy": "Italian",
    "norway": "Norwegian", "poland": "Polish", "portugal": "Portuguese",
    "russia": "Russian", "scotland": "British", "spain": "Spanish",
    "sweden": "Swedish", "switzerland": "Swiss", "wales": "British",
}
# The Low Countries are the one case a lookup cannot settle, because the split
# is temporal rather than geographic: the same region is called Netherlandish
# before the revolt and Dutch after it, and both terms are already in the
# vocabulary. 1580 is where the other catalogues put the line.
NETHERLANDISH_UNTIL = 1580


def culture_of(row):
    """First culture string, trimmed of its period suffix: Cleveland writes
    "France, 19th century" and "Italy, Florence, 15th century"."""
    cultures = row.get("culture") or []
    return cultures[0].split(",")[0].strip() if cultures else ""


def demonym_of(culture, year):
    key = culture.lower()
    if key == "netherlands":
        return "Netherlandish" if year and year < NETHERLANDISH_UNTIL else "Dutch"
    return DEMONYM.get(key, "")


def artist_of(row):
    creators = row.get("creators") or []
    if not creators:
        return ""
    # "Claude Monet (French, 1840-1926)" -> "Claude Monet"
    return (creators[0].get("description") or "").split("(")[0].strip()


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": C.USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def select(stats=None):
    stats = stats if stats is not None else collections.Counter()
    out, skip = [], 0
    while True:
        url = (f"{C.CMA_API}?cc0=1&type=Painting&limit={PAGE}&skip={skip}"
               f"&fields={FIELDS}")
        for attempt in range(C.MAX_RETRIES):
            try:
                page = _get(url)
                break
            except Exception:
                if attempt == C.MAX_RETRIES - 1:
                    raise
                time.sleep(2 ** attempt)
        rows = page["data"]
        if not rows:
            break
        stats["rows"] += len(rows)

        for row in rows:
            culture = culture_of(row)
            if culture.lower() not in C.CMA_WESTERN:
                stats["drop_culture"] += 1
                continue
            img = ((row.get("images") or {}).get("web") or {}).get("url")
            if not img:
                stats["drop_no_image"] += 1
                continue
            begin = row.get("creation_date_earliest")
            end = row.get("creation_date_latest")
            rec = make(KEY, row["id"], row.get("title"), artist_of(row),
                       demonym_of(culture, end or begin),
                       begin, end, row.get("technique"), img=img)
            if rec is None:
                stats["drop_date_or_medium"] += 1
                continue
            out.append(rec)

        skip += len(rows)
        if skip >= page["info"]["total"]:
            break
        time.sleep(C.API_MIN_INTERVAL)
    return out
