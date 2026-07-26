"""National Gallery of Art — bulk open-data CSVs.

No API and no search endpoint: the National Gallery publishes its whole catalogue
as CSVs and its images through IIIF. Four files have to be joined.

  objects.csv               the painting itself
  published_images.csv      which objects have an open-access image (this, not
                            anything on the object row, is the licence signal)
  objects_constituents.csv  object -> person
  constituents.csv          person -> nationality

Only the `primary` view is taken. Several objects carry a dozen published images
(details, versos, frames); the primary one is the painting as catalogued, and
measuring the others would count one work several times.
"""
import collections
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402
from sources import make  # noqa: E402

csv.field_size_limit(10 ** 9)
KEY = "nga"


def _rows(path):
    if not path.exists():
        raise SystemExit(f"missing {path}\nRun pipeline/00_download_csv.sh")
    with open(path, newline="", encoding="utf-8-sig") as fh:
        yield from csv.DictReader(fh)


def _int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def select(stats=None):
    stats = stats if stats is not None else collections.Counter()

    # objectid -> IIIF base for the primary open-access image.
    images = {}
    for row in _rows(C.NGA_IMAGES):
        if row["viewtype"] != "primary" or row["openaccess"] != "1":
            continue
        oid = row["depictstmsobjectid"].strip()
        if oid and oid not in images:
            images[oid] = row["iiifurl"].strip()

    # constituentid -> nationality, then objectid -> nationality of the first
    # credited artist. displayorder 1 is the primary attribution.
    nationality = {r["constituentid"]: (r["visualbrowsernationality"].strip()
                                        or r["nationality"].strip())
                   for r in _rows(C.NGA_CONSTITUENTS)}
    by_object = {}
    for row in _rows(C.NGA_OBJ_CONSTITUENTS):
        if row["roletype"] != "artist":
            continue
        oid, order = row["objectid"], _int(row["displayorder"])
        if oid in by_object and by_object[oid][0] <= (order or 99):
            continue
        by_object[oid] = ((order or 99), nationality.get(row["constituentid"], ""))

    out = []
    for row in _rows(C.NGA_OBJECTS):
        stats["rows"] += 1
        if row["classification"].strip() != "Painting":
            continue
        stats["painting"] += 1
        oid = row["objectid"].strip()
        iiif = images.get(oid)
        if not iiif:
            stats["drop_no_open_image"] += 1
            continue
        rec = make(KEY, oid, row["title"], row["attribution"],
                   by_object.get(oid, (0, ""))[1],
                   _int(row["beginyear"]), _int(row["endyear"]),
                   row["medium"],
                   img=f"{iiif}/full/!843,843/0/default.jpg")
        if rec is None:
            stats["drop_date_or_medium"] += 1
            continue
        out.append(rec)
    return out
