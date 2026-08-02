"""The wiring between app/index.html and app/js/main.js.

    python3 -m unittest discover -s tests -v

main.js resolves about forty elements by id at module scope and never checks any
of them. A missing one is not an error, it is `null` — and the failure surfaces
much later as a TypeError inside a handler, or as a control that silently does
nothing. This is the cheapest possible guard against a rename touching one file
and not the other, and it needs no browser to run.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"


class TestElementWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (APP / "index.html").read_text()
        cls.main = (APP / "js" / "main.js").read_text()
        cls.css = (APP / "css" / "style.css").read_text()
        cls.ids = set(re.findall(r'\bid="([^"]+)"', cls.html))

    def test_every_element_main_js_looks_up_exists_in_the_markup(self):
        wanted = set(re.findall(r'\$\("([^"]+)"\)', self.main))
        self.assertTrue(wanted, "the $ helper should be finding element ids")
        self.assertEqual(sorted(wanted - self.ids), [],
                         "main.js resolves ids that the markup does not define")

    def test_every_label_points_at_a_control_that_exists(self):
        for target in re.findall(r'\bfor="([^"]+)"', self.html):
            self.assertIn(target, self.ids, f"<label for={target}> points at nothing")

    def test_aria_describedby_targets_exist(self):
        for target in re.findall(r'aria-describedby="([^"]+)"', self.html):
            for one in target.split():
                self.assertIn(one, self.ids, f"aria-describedby={one} points at nothing")

    def test_ids_are_unique(self):
        found = re.findall(r'\bid="([^"]+)"', self.html)
        duplicates = {i for i in found if found.count(i) > 1}
        self.assertEqual(duplicates, set(), "duplicate ids make getElementById ambiguous")


class TestLocalReferences(unittest.TestCase):
    """Everything the page loads is served from app/, which is uploaded verbatim."""

    @classmethod
    def setUpClass(cls):
        cls.html = (APP / "index.html").read_text()

    def test_stylesheets_and_scripts_are_present_on_disk(self):
        for attr in (r'<link[^>]+href="([^"]+)"', r'<script[^>]+src="([^"]+)"'):
            for ref in re.findall(attr, self.html):
                if ref.startswith(("http", "data:", "#")):
                    continue
                self.assertTrue((APP / ref).exists(), f"{ref} is referenced but absent")

    def test_the_module_graph_resolves(self):
        # No bundler: the browser follows these imports itself, so a wrong path
        # is a blank page rather than a build error.
        js = APP / "js"
        for source in js.glob("*.js"):
            for ref in re.findall(r'from "([^"]+)"', source.read_text()):
                self.assertTrue(ref.startswith("."), f"{source.name}: bare import {ref}")
                self.assertTrue((source.parent / ref).resolve().exists(),
                                f"{source.name} imports {ref}, which does not exist")


class TestNoDeadWiring(unittest.TestCase):
    """The two-school comparison was removed; nothing may still reach for it.

    It spent a while wired but unreachable — the state, the cache keys, the URL
    parameter and the dashed curve were all live while no control could set it,
    and writeURL wrote a `nat2` the reader never read. That state is worse than
    either having the feature or not, so this asserts it has not crept back.
    """

    def test_nat2_is_gone_from_the_app(self):
        for name in ("js/main.js", "js/field.js", "index.html", "css/style.css"):
            self.assertNotIn("nat2", (APP / name).read_text(), f"{name} still mentions nat2")

    def test_writeurl_and_applyurl_agree_on_their_parameters(self):
        """Every key written into the URL has to be read back out of it.

        A key that only one side knows about is a link that quietly loses part
        of the view it claims to carry.
        """
        main = (APP / "js" / "main.js").read_text()
        write = main[main.index("function writeURL"):main.index("function applyURL")]
        apply_ = main[main.index("function applyURL"):]
        written = set(re.findall(r'set\("([^"]+)"', write))
        read = set(re.findall(r'q\.get\("([^"]+)"\)', apply_))
        read |= set(re.findall(r'school\("([^"]+)"\)', apply_))
        self.assertEqual(sorted(written - read), [],
                         "writeURL writes parameters applyURL never reads")


if __name__ == "__main__":
    unittest.main()
