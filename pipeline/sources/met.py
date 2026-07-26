"""The Metropolitan Museum of Art — Open Access CSV snapshot.

The only source that does not publish an image URL alongside its metadata: the
CSV carries no image column and no has-image flag, so `img` stays None here and
stage 2 resolves it one object at a time against the collection API.
"""
import csv
import collections
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as C  # noqa: E402
from sources import make  # noqa: E402

csv.field_size_limit(10 ** 9)
KEY = "met"


def is_painting(row):
    """The Met leaves Classification empty for all American Wing paintings, so
    Object Name has to be checked too."""
    return ("painting" in row["Classification"].lower()
            or "painting" in row["Object Name"].lower())


def first_int(value):
    try:
        return int(value.split("|")[0].strip())
    except (ValueError, AttributeError):
        return None


def select(stats=None):
    if not C.CSV_PATH.exists():
        raise SystemExit(f"missing {C.CSV_PATH}\nDownload it with:\n  "
                         f"curl -L -o {C.CSV_PATH} '{C.CSV_URL}'")
    stats = stats if stats is not None else collections.Counter()
    out = []

    with open(C.CSV_PATH, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            stats["rows"] += 1
            if row["Is Public Domain"].strip().lower() != "true":
                continue
            stats["public_domain"] += 1
            if not is_painting(row):
                continue
            stats["painting"] += 1
            if row["Department"] not in C.DEPARTMENTS:
                stats["drop_department"] += 1
                continue

            begin, end = first_int(row["Object Begin Date"]), first_int(row["Object End Date"])
            rec = make(KEY, row["Object ID"],
                       row["Title"],
                       row["Artist Display Name"].split("|")[0],
                       row["Artist Nationality"].split("|")[0],
                       begin, end, row["Medium"])
            if rec is None:
                stats["drop_date_or_medium"] += 1
                continue

            # Sanity check against the artist's lifespan. The Met has genuine
            # errors here (a Durer dated 1900-1999). Only reject clear-cut
            # cases: Artist Begin/End Date sometimes holds *active* dates
            # rather than birth/death, so a tight check would over-reject.
            a_begin = first_int(row["Artist Begin Date"])
            a_end = first_int(row["Artist End Date"])
            if (a_begin and a_end and a_end > a_begin
                    and (rec["yearStart"] > a_end + 60 or rec["yearEnd"] < a_begin)):
                stats["drop_artist_mismatch"] += 1
                continue

            rec["dept"] = row["Department"]
            out.append(rec)
    return out
