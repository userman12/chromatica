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
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as C
from sources import thumb_path

# Nationality strings are messy in every catalogue ("Italian, Florentine",
# "British, born Germany", "American, 19th century"). Keep the leading demonym,
# which is the reliable part -- and the part all four museums agree on.
NATIONALITY_MIN_COUNT = 25

# Field lengths in the published record. The artist is trimmed before the
# spellings are folded rather than after -- see the note in main().
TITLE_MAX = 140
ARTIST_MAX = 90

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


# --- one painter, one spelling ------------------------------------------
# Five catalogues, five house styles for the same hand. The Met writes
# "Rembrandt (Rembrandt van Rijn)", the Rijksmuseum "Rembrandt van Rijn", the
# National Gallery "Rembrandt van Rijn"; Cezanne appears with and without his
# accent, van Dyck with and without his knighthood. Left alone the same painter
# is several artists, which is wrong on the detail panel and wrong for anything
# that counts by artist.
#
# Two things this deliberately does NOT do, because both would destroy real
# information:
#
#   - It does not merge across attribution. "Follower of Rembrandt van Rijn" is
#     not Rembrandt: it is a different hand, and its palette is a different
#     measurement. The qualifier is kept as part of the identity, and only the
#     painter's name inside it is normalised.
#   - It does not merge on surname. "David" is Gerard David (Bruges, 1460) and
#     Jacques-Louis David (Paris, 1748); "Peale" is four different Peales;
#     "Veneziano" is four unrelated painters. So a key must be at least two
#     tokens, and single-name masters are matched through their parenthetical
#     expansion instead -- which is exactly the form the catalogues supply.
ATTRIBUTION = (
    "formerly attributed to", "attributed to", "workshop of", "studio of",
    "follower of", "circle of", "manner of", "style of", "school of",
    "imitator of", "copy after", "possibly by", "after", "and workshop",
)
# "Sir" is an honorific and the same man without it. "the Elder" and "the
# Younger" look similar and are the opposite case -- they are what tells two
# painters of one name apart -- so they are never touched.
HONORIFIC = ("sir ",)


def _fold(text):
    text = unicodedata.normalize("NFD", text or "")
    return "".join(c for c in text if unicodedata.category(c) != "Mn").lower()


def _has_accents(raw):
    """Diacritics only. Comparing against _fold() would have answered "yes" for
    every capitalised name, because _fold lowercases as well as strips."""
    return any(unicodedata.category(c) == "Mn"
               for c in unicodedata.normalize("NFD", raw or ""))


def split_attribution(raw):
    """("follower of", "Rembrandt van Rijn") -- qualifier and painter."""
    name = (raw or "").strip()
    low = _fold(name)
    for qualifier in ATTRIBUTION:
        if low.startswith(qualifier + " "):
            return qualifier, name[len(qualifier) + 1:].strip()
        if low.endswith(" " + qualifier):
            return qualifier, name[:-(len(qualifier) + 1)].strip()
    return "", name


def identity_keys(name):
    """Every multi-token form this spelling could be recognised by.

    A catalogue writes either the short name with the full one in brackets, or
    the full one alone; taking both sides of the bracket as candidate keys is
    what lets those two meet.
    """
    keys = set()
    for candidate in [re.sub(r"\(.*?\)", " ", name)] + re.findall(r"\((.*?)\)", name):
        flat = _fold(candidate)
        for honorific in HONORIFIC:
            if flat.startswith(honorific):
                flat = flat[len(honorific):]
        flat = re.sub(r"[^a-z0-9 ]+", " ", flat)
        flat = re.sub(r"\s+", " ", flat).strip()
        if " " in flat:          # single tokens are ambiguous; see the note above
            keys.add(flat)
    return keys


def canonical_artists(records):
    """raw spelling -> the one spelling all of them will be shown as."""
    groups = collections.defaultdict(set)          # (qualifier, key) -> spellings
    counts = collections.Counter()
    for rec in records:
        raw = rec["artist"]
        counts[raw] += 1
        qualifier, name = split_attribution(raw)
        for key in identity_keys(name):
            groups[(qualifier, key)].add(raw)

    # Union the spellings that share any key, within one attribution class.
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for spellings in groups.values():
        spellings = sorted(spellings)
        for other in spellings[1:]:
            union(spellings[0], other)

    clusters = collections.defaultdict(list)
    for raw in counts:
        clusters[find(raw)].append(raw)

    def preference(raw):
        """Least bracketed, then no honorific, then accented, then most used.

        Brackets are a catalogue's way of carrying an alias and read as noise on
        the panel. "Sir" is a title the museum chose to print, not part of the
        name, and printing it for Reynolds but not for van Dyck -- purely
        because more catalogues happened to knight one of them -- would look
        like a fact about the painters. And accents are the painter's actual
        name: a catalogue that drops them is being lossy, not tidy.
        """
        return (("(" in raw), _fold(raw).startswith(HONORIFIC),
                -_has_accents(raw), -counts[raw], len(raw))

    canon = {}
    for members in clusters.values():
        best = sorted(members, key=preference)[0]
        for raw in members:
            canon[raw] = best
    return canon


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

    # One painter, one spelling, across all five catalogues. Applied here rather
    # than in each adapter because it is a statement about the union: two
    # spellings only need reconciling once they are in the same field together.
    #
    # Trimmed to the published length *first*, because the folding has to see
    # the strings the field will actually carry. Doing it the other way round
    # let one escape: the Met writes "Netherlandish Painter (possibly Goswijn
    # van der Weyden, active by 1491, died after 1538), ca. 1515-20", whose
    # trailing date makes it a different identity from the plain
    # "Netherlandish Painter" -- until the 90-character cut removed the date
    # again and left a near-duplicate in the field that nothing would fold.
    for rec in usable:
        rec["artist"] = re.sub(r"[,\s]+$", "", rec["artist"][:ARTIST_MAX]) or "Unattributed"
    canon = canonical_artists(usable)
    merged = sum(1 for raw, best in canon.items() if raw != best)
    for rec in usable:
        rec["artist"] = canon.get(rec["artist"], rec["artist"])
    print(f"artists: {len(set(canon.values()))} after folding "
          f"{merged} duplicate spellings")

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

    # The bins are still computed, and still decide the order paintings are
    # written in -- a bin never splits a year, so this is a stable chronological
    # grouping and the invariant is worth keeping. What is no longer *shipped*
    # is the bins themselves.
    #
    # They were designed for a column layout the app has not used since it
    # became a particle field: nothing in app/js ever read `bins` or the `b`
    # index on a painting. Together that was 55 KB, 4.3% of the payload, sent to
    # every visitor and parsed on every load to be ignored. Anything wanting a
    # period axis can bin by year in the browser in one pass.
    bins = build_bins(usable)
    out_paintings = []
    for b in bins:
        for rec in b["items"]:
            out_paintings.append({
                "i": rec["id"],
                "c": src_index[rec["src"]],
                "t": rec["title"][:TITLE_MAX],
                "a": rec["artist"],   # already trimmed, then folded, above
                "y": rec["year"],
                "s": rec["yearStart"],
                "e": rec["yearEnd"],
                "n": nat_index.get(rec["_nat"], other_idx),
                "k": rec["colors"],
            })

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
            "yearRange": [bins[0]["s"], bins[-1]["e"]],
            "nationalities": vocab_out,
            "notes": {
                "date": "year = midpoint of the catalogued begin/end date, span <= 25y",
                "excluded": "portrait miniatures on ivory; Asian and Islamic "
                            "traditions; works held by more than one of these "
                            "collections are counted once",
                "palette": "k-means k=5 in CIE L*a*b*, clusters <4% dropped, near-duplicates merged",
                "backdrop": "the photographer's surround is removed where the "
                            "border is one flat neutral colour, light or dark, "
                            "and only the part of it continuous with the edge; "
                            "a painting's own dark ground is kept",
                "movement": "none of these catalogues exposes a clean "
                            "artistic-movement field; artist nationality is "
                            "used as a proxy",
            },
        },
        "paintings": out_paintings,
    }

    C.OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    C.OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    size_kb = C.OUT_JSON.stat().st_size / 1024

    print(f"\nbins {len(bins)} (ordering only, not shipped) | "
          f"paintings {len(out_paintings)} | cells {total_cells}")
    for key in present:
        n = sum(1 for r in usable if r["src"] == key)
        print(f"  {key:<5} {C.SOURCES[key]['short']:<24} {n:>6,}")
    print(f"wrote {C.OUT_JSON.relative_to(C.ROOT)}  {size_kb:.0f} KB")
    print(f"nationalities: {', '.join(vocab_out)}")
    print("\nbin spans:")
    for i, b in enumerate(bins):
        span = b["e"] - b["s"]
        print(f"  {i:>2}  {b['s']}-{b['e']}  ({span:>3}y)  n={len(b['items'])}")


if __name__ == "__main__":
    main()
