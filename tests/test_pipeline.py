"""Invariants of the build stages.

    python3 -m unittest discover -s tests -v

unittest rather than pytest, for the same reason the JavaScript suite uses
node --test: the pipeline's dependency list is the thing that has to stay
reproducible, and a test runner is not worth adding to it.

These cover the two places where a quiet mistake would not look like a
mistake -- the binning, which decides which works share a column, and the
nationality folding, which decides what the SCHOOL filter offers.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

import config as C  # noqa: E402
import importlib.util  # noqa: E402


def _load(stem):
    """Stage files are named 04_build.py and so on, which is not an identifier."""
    path = Path(__file__).resolve().parent.parent / "pipeline" / f"{stem}.py"
    spec = importlib.util.spec_from_file_location(stem.replace(".", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load("04_build")


def painting(year, **kw):
    return {"year": year, "uid": kw.get("uid", f"met:{year}"), **kw}


class TestBinning(unittest.TestCase):
    """build_bins groups consecutive years into columns of ~TARGET_PER_BIN works.

    The invariant that matters is stated in its docstring and was, until now,
    asserted nowhere: a bin never splits a single year across two columns. If it
    did, two works of the same date would sit in different columns of the field
    and the axis would no longer be time.
    """

    def test_a_year_is_never_split_across_bins(self):
        # A year far larger than the target is the case that would force a split.
        works = [painting(1500) for _ in range(5 * C.TARGET_PER_BIN)]
        works += [painting(1501) for _ in range(3)]
        bins = build.build_bins(works)
        seen = {}
        for i, b in enumerate(bins):
            for w in b["items"]:
                self.assertEqual(seen.setdefault(w["year"], i), i,
                                 f"year {w['year']} appears in more than one bin")

    def test_every_work_lands_in_exactly_one_bin(self):
        works = [painting(1400 + i // 7) for i in range(500)]
        bins = build.build_bins(works)
        self.assertEqual(sum(len(b["items"]) for b in bins), len(works))

    def test_bins_are_ordered_and_do_not_overlap(self):
        works = [painting(1300 + i // 3) for i in range(600)]
        bins = build.build_bins(works)
        for b in bins:
            self.assertLessEqual(b["s"], b["e"])
        for a, b in zip(bins, bins[1:]):
            self.assertLess(a["e"], b["s"], "bin spans must not overlap")

    def test_a_small_tail_is_folded_back_rather_than_left_as_a_stub(self):
        works = [painting(1400 + i // 30) for i in range(C.TARGET_PER_BIN * 2)]
        works += [painting(1500), painting(1500)]      # a 2-work tail
        bins = build.build_bins(works)
        self.assertGreaterEqual(len(bins[-1]["items"]), C.TARGET_PER_BIN,
                                "a two-work tail must not become its own column")
        self.assertEqual(bins[-1]["e"], 1500, "the folded tail must extend the span")

    def test_no_empty_bins(self):
        bins = build.build_bins([painting(1400 + i // 10) for i in range(300)])
        for b in bins:
            self.assertGreater(len(b["items"]), 0)


class TestNationality(unittest.TestCase):
    """Four catalogues, four house styles for the same school."""

    def test_the_leading_demonym_is_kept(self):
        for raw, want in [
            ("Italian, Florentine", "Italian"),
            ("British, born Germany", "British"),
            ("American, 19th century", "American"),
            ("French", "French"),
        ]:
            self.assertEqual(build.normalize_nationality(raw), want, raw)

    def test_aliases_fold_to_one_spelling(self):
        for raw in ("English", "Scottish", "Welsh"):
            self.assertEqual(build.normalize_nationality(raw), "British", raw)

    def test_placeholders_become_unattributed_rather_than_a_school(self):
        # The National Gallery writes a literal "Other" where it has no
        # nationality. Left alone it would become a school sitting next to the
        # "Other / unattributed" bucket, which is where it belongs instead.
        for raw in ("Other", "Unknown", "Various", "", None):
            self.assertEqual(build.normalize_nationality(raw), "", repr(raw))

    def test_hedges_are_stripped(self):
        self.assertEqual(build.normalize_nationality("Dutch, possibly Haarlem"), "Dutch")
        self.assertEqual(build.normalize_nationality("Flemish or Dutch"), "Flemish")

    def test_absurd_lengths_are_rejected(self):
        self.assertEqual(build.normalize_nationality("a"), "")
        self.assertEqual(build.normalize_nationality("x" * 40), "")


class TestOgConstantsMatchTheApp(unittest.TestCase):
    """Stage 6 renders the preview card by re-implementing field.js in numpy.

    That duplication is deliberate -- one is JavaScript and one is Python -- but
    it is exactly the kind that rots silently: change SPREAD_GAIN in the app and
    the card keeps drawing the old field, and nothing anywhere would say so.
    This reads the constants back out of the JavaScript and compares them.
    """

    @classmethod
    def setUpClass(cls):
        cls.og = _load("06_og_image")
        cls.js = (Path(__file__).resolve().parent.parent
                  / "app" / "js" / "field.js").read_text()
        cls.nebula = (Path(__file__).resolve().parent.parent
                      / "app" / "js" / "nebula.js").read_text()

    def js_const(self, source, name):
        import re
        m = re.search(rf"^const {name} = ([-\d.]+);", source, re.M)
        self.assertIsNotNone(m, f"{name} not found in the JavaScript")
        return float(m.group(1))

    def test_layout_constants_agree(self):
        for name in ("CELL_YEARS", "CELL_LUM", "SPREAD_FLOOR",
                     "SPREAD_GAIN", "SPREAD_CAP", "DRIFT_PX"):
            self.assertEqual(getattr(self.og, name), self.js_const(self.js, name), name)

    def test_render_constants_agree(self):
        for name in ("GLOW_SCALE", "GLOW_SPREAD", "GLOW_ALPHA", "HALO_SPREAD",
                     "HALO_ALPHA", "CORE_SPREAD", "CORE_ALPHA", "MAT_L",
                     "MAT_SPREAD", "MAT_ALPHA", "MAT_GLOW"):
            self.assertEqual(getattr(self.og, name), self.js_const(self.nebula, name), name)

    def test_rank_mass_agrees(self):
        import re
        m = re.search(r"const RANK_MASS = \[([^\]]+)\]", self.js)
        self.assertIsNotNone(m)
        want = tuple(float(x) for x in m.group(1).split(","))
        self.assertEqual(self.og.RANK_MASS, want)

    def test_the_hash_matches_the_javascript(self):
        # hash01 places every particle's offset and decides the draw order. If
        # the two implementations diverge the card is a different arrangement of
        # the same colours -- which would look fine, and be wrong.
        expected = {  # taken from field.js's hash01 by running it under node
            0: 0.0,
            1: 0.8984252212103456,
            7: 0.01423285249620676,
            42: 0.1995486665982753,
            1000: 0.22768260748125613,
        }
        for x, want in expected.items():
            self.assertAlmostEqual(float(self.og.hash01([x])[0]), want, places=12, msg=str(x))


if __name__ == "__main__":
    unittest.main()
