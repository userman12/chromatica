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

# Met nationality strings are messy ("Italian, Florentine", "British, born
# Germany"). Keep the leading demonym, which is the reliable part.
NATIONALITY_MIN_COUNT = 25


def normalize_nationality(raw):
    if not raw:
        return ""
    token = re.split(r"[,;(]", raw)[0].strip()
    token = re.sub(r"\b(born|active|or)\b.*$", "", token, flags=re.I).strip()
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
    selected = {p["id"]: p for p in json.loads(C.SELECTED.read_text())}

    palettes = {}
    for line in C.PALETTES.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("colors"):
            palettes[rec["id"]] = rec["colors"]

    # Keep only paintings that have both a palette and a thumbnail on disk.
    usable = []
    missing_thumb = 0
    for oid, colors in palettes.items():
        if oid not in selected:
            continue
        if not (C.THUMBS / f"{oid}.jpg").exists():
            missing_thumb += 1
            continue
        rec = dict(selected[oid])
        rec["colors"] = colors
        usable.append(rec)
    usable.sort(key=lambda r: (r["year"], r["id"]))

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

    bins = build_bins(usable)
    out_paintings = []
    out_bins = []
    for bin_idx, b in enumerate(bins):
        start = len(out_paintings)
        for rec in b["items"]:
            out_paintings.append({
                "i": rec["id"],
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
            "source": "The Metropolitan Museum of Art Open Access (CC0)",
            "sourceCsvSnapshot": "2026-07-25",
            "totalPaintings": len(out_paintings),
            "totalCells": total_cells,
            "bins": len(out_bins),
            "yearRange": [out_bins[0]["s"], out_bins[-1]["e"]],
            "nationalities": vocab_out,
            "notes": {
                "date": "year = midpoint of objectBeginDate/objectEndDate, span <= 25y",
                "excluded": "portrait miniatures on ivory; Asian and Islamic Art departments",
                "palette": "k-means k=5 in CIE L*a*b*, clusters <4% dropped, near-duplicates merged",
                "movement": "the Met exposes no clean artistic-movement field; "
                            "artist nationality is used as a proxy",
            },
        },
        "bins": out_bins,
        "paintings": out_paintings,
    }

    C.OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    C.OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    size_kb = C.OUT_JSON.stat().st_size / 1024

    print(f"\nbins {len(out_bins)} | paintings {len(out_paintings)} | cells {total_cells}")
    print(f"wrote {C.OUT_JSON.relative_to(C.ROOT)}  {size_kb:.0f} KB")
    print(f"nationalities: {', '.join(vocab_out)}")
    print("\nbin spans:")
    for i, b in enumerate(out_bins):
        span = b["e"] - b["s"]
        print(f"  {i:>2}  {b['s']}-{b['e']}  ({span:>3}y)  n={b['n']}")


if __name__ == "__main__":
    main()
