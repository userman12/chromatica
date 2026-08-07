"""One painter, one spelling — and never two painters folded into one.

    python3 -m unittest discover -s tests -v

The merging in 04_build.canonical_artists is the kind of cleanup that is
obviously right until it quietly eats something. Gerard David (Bruges, 1460) and
Jacques-Louis David (Paris, 1748) share a surname across three centuries; there
are four Peales and four painters called Veneziano; "the Elder" and "the
Younger" exist precisely to tell two men of one name apart. Every one of those
is a test here, because a merge that wrong would not look wrong in the output —
it would look like an artist with more works than they painted.
"""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))


def _load(stem):
    path = ROOT / "pipeline" / f"{stem}.py"
    spec = importlib.util.spec_from_file_location(stem.replace(".", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load("04_build")


def canon(*names):
    """Map each spelling to its canonical form, one record per name."""
    return build.canonical_artists([{"artist": n} for n in names])


class TestMerging(unittest.TestCase):
    def test_a_parenthetical_alias_meets_the_bare_name(self):
        c = canon("Rembrandt (Rembrandt van Rijn)", "Rembrandt van Rijn")
        self.assertEqual(len(set(c.values())), 1)
        self.assertEqual(set(c.values()), {"Rembrandt van Rijn"},
                         "the unbracketed spelling is the readable one")

    def test_accents_are_kept_not_dropped(self):
        c = canon("Paul Cezanne", "Paul Cezanne", "Paul Cézanne")
        self.assertEqual(set(c.values()), {"Paul Cézanne"},
                         "the accented form is the painter's name even when rarer")

    def test_a_knighthood_is_not_a_different_painter(self):
        c = canon("Anthony van Dyck", "Sir Anthony van Dyck")
        self.assertEqual(len(set(c.values())), 1)
        self.assertEqual(set(c.values()), {"Anthony van Dyck"},
                         "a title the museum chose to print is not part of the name")

    def test_hyphens_and_spaces_are_the_same_name(self):
        c = canon("Jean-François Millet", "Jean François Millet")
        self.assertEqual(len(set(c.values())), 1)

    def test_the_canonical_form_is_stable_whatever_the_input_order(self):
        a = canon("Rembrandt (Rembrandt van Rijn)", "Rembrandt van Rijn")
        b = canon("Rembrandt van Rijn", "Rembrandt (Rembrandt van Rijn)")
        self.assertEqual(set(a.values()), set(b.values()))


class TestNeverMerging(unittest.TestCase):
    """Each of these would be a silent, plausible-looking corruption."""

    def assertSeparate(self, *names):
        c = canon(*names)
        self.assertEqual(len(set(c.values())), len(names),
                         f"{names} were folded together: {c}")

    def test_two_painters_may_share_a_surname(self):
        self.assertSeparate("Gerard David", "Jacques Louis David")
        self.assertSeparate("James Peale", "Rembrandt Peale", "Charles Willson Peale")
        self.assertSeparate("Domenico Veneziano", "Lorenzo Veneziano")

    def test_the_elder_is_not_the_younger(self):
        self.assertSeparate("Pieter Bruegel the Elder", "Pieter Bruegel the Younger")
        self.assertSeparate("Hans Holbein the Elder", "Hans Holbein the Younger")

    def test_a_century_label_is_not_another_century(self):
        # These are the National Gallery's placeholders for unattributed work.
        # An early version stripped digits while normalising and folded them.
        self.assertSeparate("American 18th Century", "American 19th Century")

    def test_attribution_is_a_different_hand_and_stays_one(self):
        # A follower's palette is a different measurement from the master's,
        # which is the whole reason this project records colour at all.
        self.assertSeparate("Rembrandt van Rijn", "Follower of Rembrandt van Rijn")
        self.assertSeparate("Frans Hals", "Workshop of Frans Hals")
        self.assertSeparate("Vincent van Gogh", "Imitator of Vincent van Gogh")
        self.assertSeparate("Gilbert Stuart", "Attributed to Gilbert Stuart")

    def test_qualified_names_still_normalise_among_themselves(self):
        # "Follower of X" must not merge with X, but two spellings of
        # "Follower of X" are still one thing.
        c = canon("Follower of Rembrandt (Rembrandt van Rijn)",
                  "Follower of Rembrandt van Rijn")
        self.assertEqual(len(set(c.values())), 1)


class TestSplitAttribution(unittest.TestCase):
    def test_prefixes_and_suffixes_are_both_recognised(self):
        self.assertEqual(build.split_attribution("Follower of Frans Hals"),
                         ("follower of", "Frans Hals"))
        self.assertEqual(build.split_attribution("Bernardo Bellotto and Workshop"),
                         ("and workshop", "Bernardo Bellotto"))

    def test_an_unqualified_name_is_returned_whole(self):
        self.assertEqual(build.split_attribution("Frans Hals"), ("", "Frans Hals"))

    def test_a_name_merely_containing_a_qualifier_word_is_untouched(self):
        # "After" as a word, not as an attribution.
        self.assertEqual(build.split_attribution("Mary Cassatt")[0], "")


class TestIdentityKeys(unittest.TestCase):
    def test_single_tokens_never_become_keys(self):
        # The rule that keeps the four Davids and four Peales apart.
        self.assertEqual(build.identity_keys("Titian"), set())
        self.assertEqual(build.identity_keys("Rembrandt"), set())

    def test_both_sides_of_a_bracket_are_offered(self):
        keys = build.identity_keys("Rembrandt (Rembrandt van Rijn)")
        self.assertIn("rembrandt van rijn", keys)

    def test_digits_survive_normalisation(self):
        self.assertIn("american 18th century", build.identity_keys("American 18th Century"))


class TestAgainstThePublishedDataset(unittest.TestCase):
    """Whatever the rules do in the abstract, this is what shipped."""

    @classmethod
    def setUpClass(cls):
        import json
        data = ROOT / "app" / "data" / "chromatica.json"
        if not data.exists():
            raise unittest.SkipTest("dataset not built")
        cls.paintings = json.loads(data.read_text())["paintings"]

    def test_no_painter_appears_under_two_spellings(self):
        """Every remaining artist string must be its own canonical form.

        If the build applied the folding, running it again over the published
        artists is a no-op. A non-empty diff means a spelling escaped.
        """
        names = sorted({p["a"] for p in self.paintings})
        again = build.canonical_artists([{"artist": n} for n in names])
        escaped = {raw: best for raw, best in again.items() if raw != best}
        self.assertEqual(escaped, {}, "spellings the build should already have folded")


if __name__ == "__main__":
    unittest.main()
