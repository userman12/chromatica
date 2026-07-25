"""Stage 1 — select eligible paintings from the Met Open Access CSV.

Reads the CSV snapshot and applies the Phase 1 filters. No network calls, no
images. Output: data/selected.json
"""
import csv
import json
import sys
import collections

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import config as C

csv.field_size_limit(10**9)


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


def main():
    if not C.CSV_PATH.exists():
        sys.exit(f"missing {C.CSV_PATH}\nDownload it with:\n  "
                 f"curl -L -o {C.CSV_PATH} '{C.CSV_URL}'")

    stats = collections.Counter()
    selected = []

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
            medium = row["Medium"].lower()
            if any(x in medium for x in C.EXCLUDE_MEDIUM):
                stats["drop_medium"] += 1
                continue
            try:
                begin = int(row["Object Begin Date"])
                end = int(row["Object End Date"])
            except ValueError:
                stats["drop_unparseable_date"] += 1
                continue
            if end < begin:
                begin, end = end, begin
            span = end - begin
            if span > C.MAX_DATE_SPAN:
                stats["drop_wide_span"] += 1
                continue
            year = (begin + end) // 2
            if not (C.YEAR_MIN <= year <= C.YEAR_MAX):
                stats["drop_year_range"] += 1
                continue

            # Sanity check against the artist's lifespan. The Met has genuine
            # errors here (a Durer dated 1900-1999). Only reject clear-cut
            # cases: Artist Begin/End Date sometimes holds *active* dates
            # rather than birth/death, so a tight check would over-reject.
            a_begin, a_end = first_int(row["Artist Begin Date"]), first_int(row["Artist End Date"])
            if a_begin and a_end and a_end > a_begin and (begin > a_end + 60 or end < a_begin):
                stats["drop_artist_mismatch"] += 1
                continue

            selected.append({
                "id": int(row["Object ID"]),
                "title": row["Title"].strip() or "Untitled",
                "artist": row["Artist Display Name"].split("|")[0].strip() or "Unattributed",
                "nationality": row["Artist Nationality"].split("|")[0].strip(),
                "year": year,
                "yearStart": begin,
                "yearEnd": end,
                "dept": row["Department"],
                "medium": row["Medium"].strip(),
            })
            stats["selected"] += 1

    selected.sort(key=lambda r: (r["year"], r["id"]))
    C.DATA.mkdir(parents=True, exist_ok=True)
    C.SELECTED.write_text(json.dumps(selected, ensure_ascii=False))

    print(f"rows scanned            {stats['rows']:>8,}")
    print(f"public domain           {stats['public_domain']:>8,}")
    print(f"classified as painting  {stats['painting']:>8,}")
    for key in ("drop_department", "drop_medium", "drop_unparseable_date",
                "drop_wide_span", "drop_year_range", "drop_artist_mismatch"):
        print(f"  -{key:<22} {stats[key]:>6,}")
    print(f"SELECTED                {stats['selected']:>8,}  -> {C.SELECTED.name}")

    per_century = collections.Counter(r["year"] // 100 * 100 for r in selected)
    print("\nper century:")
    for century in sorted(per_century):
        print(f"  {century}s  {per_century[century]:>5}")


if __name__ == "__main__":
    main()
