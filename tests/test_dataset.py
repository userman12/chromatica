"""The published artefact, checked against what the app assumes about it.

    python3 -m unittest discover -s tests -v

This suite reads app/data/chromatica.json and app/thumbs/ -- the files that are
committed and served, not a fixture. It is the one that earns its place in CI:
the deploy workflow copies app/ to GitHub Pages verbatim, so a painting whose
thumbnail never got committed is a broken panel in production and nothing
upstream of the browser would have said a word about it.

Everything asserted here is something app/js/main.js or app/js/field.js reads
directly. Where a rule is a judgement rather than a requirement -- how many
works a school needs before it earns a filter entry, say -- it is left alone.
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "data" / "chromatica.json"
THUMBS = ROOT / "app" / "thumbs"

HEX = re.compile(r"^#[0-9a-f]{6}$")


class DatasetCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DATA.exists():
            raise unittest.SkipTest(f"{DATA.relative_to(ROOT)} not built")
        cls.data = json.loads(DATA.read_text())
        cls.meta = cls.data["meta"]
        cls.paintings = cls.data["paintings"]


class TestShape(DatasetCase):
    def test_the_keys_the_app_refuses_to_boot_without(self):
        # main.js's init() throws "dataset is older than this build" on this one.
        self.assertIsInstance(self.meta.get("sources"), list)
        self.assertTrue(self.meta["sources"])
        for key in ("totalPaintings", "totalCells", "yearRange", "nationalities"):
            self.assertIn(key, self.meta)

    def test_the_counts_in_meta_are_the_counts_in_the_file(self):
        self.assertEqual(self.meta["totalPaintings"], len(self.paintings))
        self.assertEqual(self.meta["totalCells"],
                         sum(len(p["k"]) for p in self.paintings))

    def test_per_source_counts_add_up(self):
        counted = {}
        for p in self.paintings:
            counted[p["c"]] = counted.get(p["c"], 0) + 1
        for i, src in enumerate(self.meta["sources"]):
            self.assertEqual(src["n"], counted.get(i, 0),
                             f"{src['key']} is credited with the wrong count")

    def test_every_painting_carries_what_the_panel_prints(self):
        nats = len(self.meta["nationalities"])
        sources = len(self.meta["sources"])
        for p in self.paintings:
            self.assertTrue(p["i"], "a catalogue id is the link out; it cannot be empty")
            self.assertIn(p["c"], range(sources), f"{p['i']}: source index out of range")
            self.assertIn(p["n"], range(nats), f"{p['i']}: school index out of range")
            self.assertTrue(p["k"], f"{p['i']}: a painting with no palette is not a particle")

    def test_ids_are_unique_within_their_own_museum(self):
        # Ids only have to be unique per source -- that is the only guarantee
        # any of these catalogues actually gives -- but the thumbnail path and
        # the ?w= permalink both key on (source, id), so a collision would make
        # two works indistinguishable.
        seen = set()
        for p in self.paintings:
            key = (p["c"], p["i"])
            self.assertNotIn(key, seen, f"duplicate id {key}")
            seen.add(key)


class TestColours(DatasetCase):
    def test_every_colour_is_a_lowercase_six_digit_hex(self):
        # field.js slices these by fixed offsets and main.js compares them by
        # string identity to mark the clicked swatch; a shorthand or uppercase
        # form would parse to NaN or silently fail to match.
        for p in self.paintings:
            for h in p["k"]:
                self.assertRegex(h, HEX, f"{p['i']}: bad colour {h!r}")

    def test_palettes_are_within_the_configured_bounds(self):
        for p in self.paintings:
            self.assertLessEqual(len(p["k"]), 5,
                                 f"{p['i']}: more clusters than k-means was asked for")
            self.assertGreaterEqual(len(p["k"]), 1, f"{p['i']}: empty palette")

    def test_no_palette_repeats_a_colour(self):
        # Near-duplicates are merged in stage 3; an exact repeat would mean two
        # particles of one painting stacked at the same point of the plane.
        for p in self.paintings:
            self.assertEqual(len(set(p["k"])), len(p["k"]), f"{p['i']}: repeated colour")


class TestDates(DatasetCase):
    def test_the_year_is_inside_its_own_catalogued_span(self):
        for p in self.paintings:
            self.assertLessEqual(p["s"], p["y"], f"{p['i']}: year before span start")
            self.assertLessEqual(p["y"], p["e"], f"{p['i']}: year after span end")

    def test_every_year_is_inside_the_declared_range(self):
        y0, y1 = self.meta["yearRange"]
        # field.js allocates perYear as exactly this wide and indexes it with
        # p.y - y0, with no bounds check: one year outside is a silent write
        # past the end of a typed array.
        for p in self.paintings:
            self.assertTrue(y0 <= p["y"] <= y1, f"{p['i']}: {p['y']} outside {y0}-{y1}")

    def test_the_declared_range_is_tight(self):
        years = [p["y"] for p in self.paintings]
        self.assertEqual(self.meta["yearRange"], [min(years), max(years)])

    def test_the_span_ceiling_from_config_is_respected(self):
        for p in self.paintings:
            self.assertLessEqual(p["e"] - p["s"], 25,
                                 f"{p['i']}: dated too loosely to place on a time axis")


class TestBins(DatasetCase):
    def test_bins_partition_the_paintings_in_order(self):
        bins = self.data["bins"]
        self.assertEqual(bins[0]["p0"], 0)
        self.assertEqual(bins[-1]["p1"], len(self.paintings))
        for a, b in zip(bins, bins[1:]):
            self.assertEqual(a["p1"], b["p0"], "bins must tile the array with no gap")
            self.assertLess(a["e"], b["s"], "bin spans must not overlap")

    def test_a_year_never_straddles_two_bins(self):
        # The invariant 04_build.py's build_bins() promises, asserted against
        # the artefact it actually produced.
        home = {}
        for i, b in enumerate(self.data["bins"]):
            for p in self.paintings[b["p0"]:b["p1"]]:
                self.assertEqual(home.setdefault(p["y"], i), i,
                                 f"year {p['y']} is split across bins")


class TestThumbnails(DatasetCase):
    """The check that protects the deploy.

    app/ is uploaded to Pages verbatim, so a painting whose thumbnail is absent
    from the working tree is a broken image in the detail panel of the live
    site. main.js builds the path as thumbs/{source key}/{id}.webp.
    """

    def test_every_painting_has_the_thumbnail_the_panel_will_ask_for(self):
        keys = [s["key"] for s in self.meta["sources"]]
        missing = [f"{keys[p['c']]}/{p['i']}.webp" for p in self.paintings
                   if not (THUMBS / keys[p["c"]] / f"{p['i']}.webp").exists()]
        self.assertEqual(missing, [], f"{len(missing)} thumbnails referenced but absent")

    def test_no_thumbnail_is_shipped_that_nothing_points_at(self):
        # 249 MB of committed binaries; an orphan is dead weight in every clone
        # and in the Pages artefact, forever.
        keys = [s["key"] for s in self.meta["sources"]]
        wanted = {f"{keys[p['c']]}/{p['i']}.webp" for p in self.paintings}
        on_disk = {str(f.relative_to(THUMBS)) for f in THUMBS.rglob("*.webp")}
        self.assertEqual(sorted(on_disk - wanted), [], "orphaned thumbnails")

    def test_no_thumbnail_is_empty(self):
        for f in THUMBS.rglob("*.webp"):
            self.assertGreater(f.stat().st_size, 0, f"{f.name} is a zero-byte file")


class TestSocialCard(DatasetCase):
    """og.png is what every crawler shows in place of the page."""

    def test_the_card_exists_and_is_the_size_the_head_claims(self):
        card = ROOT / "app" / "og.png"
        self.assertTrue(card.exists(), "app/og.png is missing; run pipeline/06_og_image.py")
        head = (ROOT / "app" / "index.html").read_text()
        width = re.search(r'og:image:width" content="(\d+)"', head)
        height = re.search(r'og:image:height" content="(\d+)"', head)
        self.assertIsNotNone(width, "og:image:width is not declared")
        self.assertIsNotNone(height, "og:image:height is not declared")
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        with Image.open(card) as img:
            self.assertEqual(img.size, (int(width.group(1)), int(height.group(1))),
                             "the declared preview size is not the file's size")

    def test_the_card_is_small_enough_to_be_fetched(self):
        card = ROOT / "app" / "og.png"
        if not card.exists():
            self.skipTest("card not built")
        self.assertLess(card.stat().st_size, 5 * 1024 * 1024,
                        "some crawlers refuse images past 5 MB")

    def test_the_absolute_urls_in_the_head_agree_with_each_other(self):
        head = (ROOT / "app" / "index.html").read_text()
        url = re.search(r'og:url" content="([^"]+)"', head).group(1)
        image = re.search(r'og:image" content="([^"]+)"', head).group(1)
        for value in (url, image):
            self.assertTrue(value.startswith("https://"),
                            f"{value} must be absolute; a crawler resolves it against nothing")
        self.assertTrue(image.startswith(url.rsplit("/", 1)[0]),
                        "the card must be served from the site it advertises")


if __name__ == "__main__":
    unittest.main()
