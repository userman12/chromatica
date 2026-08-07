"""Stage 1 — select eligible paintings from every open-access collection.

Each source has its own adapter under pipeline/sources/; this stage only runs
them, applies the rules that are about the dataset as a whole rather than about
one museum, and writes the union.

The one cross-source rule is de-duplication by (artist, title, year). Museums do
occasionally hold the same composition, and more often the same artist repeated
a subject with the same title in the same year. Neither case should be counted
twice, so the earliest source in SOURCE_ORDER keeps it.

Output: data/selected.json
"""
import argparse
import collections
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C
import sources


def dedup_key(rec):
    """Loose match on artist + title + year. Punctuation and case vary between
    catalogues ("St." vs "Saint", trailing dates), so both strings are reduced
    to their letters before comparison.

    Returns None -- meaning "never a duplicate" -- for anonymous untitled work.
    Two unrelated panels can both be an Unattributed Untitled of 1650, and
    collapsing those would throw away real paintings to prevent an imaginary
    double count."""
    if rec["title"] == "Untitled" or rec["artist"] == "Unattributed":
        return None
    flat = lambda s: re.sub(r"[^a-z0-9]+", "", s.lower())
    return flat(rec["artist"]), flat(rec["title"]), rec["year"]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", nargs="*", choices=C.SOURCE_ORDER,
                    help="run just these sources (default: all)")
    args = ap.parse_args()
    keys = args.only or list(C.SOURCE_ORDER)

    all_stats = {}
    records = []
    # Adding a fifth collection should not mean re-harvesting the other four.
    # With --only, whatever is already in selected.json for the sources *not*
    # being run is carried forward, so `--only rijks` adds a source instead of
    # replacing the file with one. Without --only every source runs and the
    # file is rebuilt from scratch, which is what a full rebuild should mean.
    if args.only and C.SELECTED.exists():
        carried = [r for r in json.loads(C.SELECTED.read_text())
                   if r["src"] not in keys]
        if carried:
            held = collections.Counter(r["src"] for r in carried)
            print("carried forward from the previous run: "
                  + ", ".join(f"{k} {n:,}" for k, n in sorted(held.items())))
            records.extend(carried)

    for key in keys:
        stats = collections.Counter()
        print(f"\n=== {key}  {C.SOURCES[key]['name']}", flush=True)
        got = sources.load(key).select(stats)
        all_stats[key] = stats
        for name, value in stats.most_common():
            print(f"  {name:<24} {value:>8,}")
        print(f"  {'selected':<24} {len(got):>8,}")
        records.extend(got)

    seen, kept, dropped = {}, [], collections.Counter()
    order = {k: i for i, k in enumerate(C.SOURCE_ORDER)}
    records.sort(key=lambda r: (order[r["src"]], r["year"], r["id"]))
    for rec in records:
        key = dedup_key(rec)
        if key is not None and key in seen:
            dropped[f"{rec['src']}<-{seen[key]}"] += 1
            continue
        seen[key] = rec["src"]
        kept.append(rec)

    kept.sort(key=lambda r: (r["year"], r["src"], r["id"]))
    C.DATA.mkdir(parents=True, exist_ok=True)
    C.SELECTED.write_text(json.dumps(kept, ensure_ascii=False))

    print(f"\n{'-' * 46}")
    for key in C.SOURCE_ORDER:
        n = sum(1 for r in kept if r["src"] == key)
        print(f"{key:<6} {C.SOURCES[key]['short']:<24} {n:>7,}")
    if dropped:
        print("\ncross-source duplicates dropped:")
        for pair, n in dropped.most_common():
            print(f"  {pair:<20} {n:>5}")
    print(f"\nSELECTED {len(kept):,}  ->  {C.SELECTED.name}")

    per_century = collections.Counter(r["year"] // 100 * 100 for r in kept)
    print("\nper century:")
    for century in sorted(per_century):
        print(f"  {century}s  {per_century[century]:>5}")


if __name__ == "__main__":
    main()
