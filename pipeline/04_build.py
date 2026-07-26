"""Stage 4 — merge everything into the single static JSON the app consumes.

Adaptive binning: coverage is wildly uneven (4 paintings in the 1350s, 245 in
the 1870s), so a fixed-decade axis would produce near-empty columns and destroy
the "continuous fabric" look. Instead each bin holds roughly TARGET_PER_BIN
works, so columns are visually uniform and the label reports the real span.
A bin never splits a single year across two columns.

Output: app/data/chromatica.json
"""
import json
import re
import sys
import collections
import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C
from sources import thumb_path

# Nationality strings are messy in every catalogue ("Italian, Florentine",
# "British, born Germany", "American, 19th century"). Keep the leading demonym,
# which is the reliable part -- and the part all four museums agree on.
NATIONALITY_MIN_COUNT = 25

# Four catalogues, four spellings of the same school. Folded to whichever form
# the largest share of the collection already uses, so the filter offers one
# entry per school rather than one per museum's house style.
NATIONALITY_ALIAS = {
    "English": "British", "Scottish": "British", "Welsh": "British",
    "Netherlandish/French": "Netherlandish", "Netherlandish / French": "Netherlandish",
    "Anglo-American": "American", "German American": "American",
    "Mexico": "Mexican",
    # The National Gallery writes a literal "Other" where it has no nationality.
    # Left alone it would become a school called Other sitting next to the
    # "Other / unattributed" bucket, which is exactly where it belongs instead.
    "Other": "", "Unknown": "", "Various": "",
}


def normalize_nationality(raw):
    if not raw:
        return ""
    token = re.split(r"[,;(]", raw)[0].strip()
    token = re.sub(r"\b(born|active|or|possibly|probably)\b.*$", "", token, flags=re.I).strip()
    token = NATIONALITY_ALIAS.get(token, token)
    return token if 2 < len(token) < 24 else ""


def build_bins(paintings):
    """Group consecutive years into bins of ~TARGET_PER_BIN paintings."""
    by_year = collections.OrderedDict()
    for p in paintings:
        by_year.setdefault(p["year"], []).append(p)

    bins, current, years = [], [], []
    for year in sorted(by_year):
        current.extend(by_year[year])
        years.append(year)
        if len(current) >= C.TARGET_PER_BIN:
            bins.append({"s": years[0], "e": years[-1], "items": current})
            current, years = [], []
    if current:
        # Fold a small tail into the previous bin rather than leaving a stub.
        if bins and len(current) < C.TARGET_PER_BIN * 0.5:
            bins[-1]["e"] = years[-1]
            bins[-1]["items"].extend(current)
        else:
            bins.append({"s": years[0], "e": years[-1], "items": current})
    return bins


def main():
    selected = {p["uid"]: p for p in json.loads(C.SELECTED.read_text())}

    palettes = {}
    for line in C.PALETTES.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("colors"):
            palettes[rec["uid"]] = rec["colors"]

    # Keep only paintings that have both a palette and a thumbnail on disk.
    usable = []
    missing_thumb = 0
    for uid, colors in palettes.items():
        if uid not in selected:
            continue
        if not thumb_path(uid).exists():
            missing_thumb += 1
            continue
        rec = dict(selected[uid])
        rec["colors"] = colors
        usable.append(rec)
    usable.sort(key=lambda r: (r["year"], r["src"], r["id"]))

    print(f"selected {len(selected)} | with palette {len(palettes)} | "
          f"missing thumb {missing_thumb} | usable {len(usable)}")
    if not usable:
        sys.exit("no usable paintings -- run stages 2 and 3 first")

    # Nationality vocabulary: rare values collapse to "Other" so the filter
    # stays a short, useful list instead of 90 one-off entries.
    raw_counts = collections.Counter()
    for rec in usable:
        norm = normalize_nationality(rec["nationality"])
        rec["_nat"] = norm
        if norm:
            raw_counts[norm] += 1
    vocab = sorted(n for n, c in raw_counts.items() if c >= NATIONALITY_MIN_COUNT)
    nat_index = {name: i for i, name in enumerate(vocab)}
    other_idx = len(vocab)
    vocab_out = vocab + ["Other / unattributed"]

    # Only sources that actually survived to publication are listed, so the
    # about panel never credits a museum that contributed nothing.
    present = [k for k in C.SOURCE_ORDER if any(r["src"] == k for r in usable)]
    src_index = {k: i for i, k in enumerate(present)}

    bins = build_bins(usable)
    out_paintings = []
    out_bins = []
    for bin_idx, b in enumerate(bins):
        start = len(out_paintings)
        for rec in b["items"]:
            out_paintings.append({
                "i": rec["id"],
                "c": src_index[rec["src"]],
                "t": rec["title"][:140],
                "a": rec["artist"][:90],
                "y": rec["year"],
                "s": rec["yearStart"],
                "e": rec["yearEnd"],
                "n": nat_index.get(rec["_nat"], other_idx),
                "b": bin_idx,
                "k": rec["colors"],
            })
        out_bins.append({"s": b["s"], "e": b["e"], "n": len(b["items"]),
                         "p0": start, "p1": len(out_paintings)})

    total_cells = sum(len(p["k"]) for p in out_paintings)
    payload = {
        "meta": {
            "generatedAt": datetime.date.today().isoformat(),
            "sourceCsvSnapshot": "2026-07-25",
            # The app reads `c` on each painting as an index into this list: it
            # is where the thumbnail path, the outbound link and the credit all
            # come from, so order here is load-bearing.
            "sources": [{"key": k, **C.SOURCES[k],
                         "n": sum(1 for r in usable if r["src"] == k)}
                        for k in present],
            "totalPaintings": len(out_paintings),
            "totalCells": total_cells,
            "bins": len(out_bins),
            "yearRange": [out_bins[0]["s"], out_bins[-1]["e"]],
            "nationalities": vocab_out,
            "notes": {
                "date": "year = midpoint of the catalogued begin/end date, span <= 25y",
                "excluded": "portrait miniatures on ivory; Asian and Islamic "
                            "traditions; works held by more than one of these "
                            "collections are counted once",
                "palette": "k-means k=5 in CIE L*a*b*, clusters <4% dropped, near-duplicates merged",
                "movement": "none of these catalogues exposes a clean "
                            "artistic-movement field; artist nationality is "
                            "used as a proxy",
            },
        },
        "bins": out_bins,
        "paintings": out_paintings,
    }

    C.OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    C.OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    size_kb = C.OUT_JSON.stat().st_size / 1024

    print(f"\nbins {len(out_bins)} | paintings {len(out_paintings)} | cells {total_cells}")
    for key in present:
        n = sum(1 for r in usable if r["src"] == key)
        print(f"  {key:<5} {C.SOURCES[key]['short']:<24} {n:>6,}")
    print(f"wrote {C.OUT_JSON.relative_to(C.ROOT)}  {size_kb:.0f} KB")
    print(f"nationalities: {', '.join(vocab_out)}")
    print("\nbin spans:")
    for i, b in enumerate(out_bins):
        span = b["e"] - b["s"]
        print(f"  {i:>2}  {b['s']}-{b['e']}  ({span:>3}y)  n={b['n']}")


if __name__ == "__main__":
    main()
