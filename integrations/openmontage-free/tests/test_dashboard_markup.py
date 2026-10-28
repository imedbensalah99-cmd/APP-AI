from html.parser import HTMLParser
from pathlib import Path
import unittest

FILE = Path(__file__).resolve().parents[1] / "dashboard" / "index.html"
class Inspect(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sections = set()
        self.navigation = set()
        self.buttons = []
        self.scripts = []
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=="section" and "view" in a.get("class",""):
            self.sections.add(a.get("id"))
        if tag=="button":
            self.buttons.append(a)
            if "data-tab" in a: self.navigation.add(a["data-tab"])
        if tag=="script": self.scripts.append(a)

class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html=FILE.read_text(encoding="utf-8")
        cls.parser=Inspect()
        cls.parser.feed(cls.html)
    def test_navigation(self):
        expected={"overview","studio","agents","library","approvals","connections","audit"}
        self.assertEqual(expected,self.parser.sections)
        self.assertEqual(expected,self.parser.navigation)
    def test_approval_gate(self):
        self.assertIn("Approve & publish (disabled)",self.html)
        self.assertIn("No verified final films",self.html)
        self.assertTrue(any("disabled" in b for b in self.parser.buttons))
    def test_sandbox_markings(self):
        self.assertIn("NOT LIVE",self.html)
        self.assertIn("NO-SPEND",self.html)
        self.assertIn("not yet verified",self.html)
    def test_no_external_script(self):
        self.assertTrue(all("src" not in x for x in self.parser.scripts))
    def test_project_evidence(self):
        self.assertIn("40775226914",self.html)
        self.assertIn("1D8t2YK_E2nfpPVOed5fBIZY5JlIPoEi41Q-pfecqycU",self.html)
if __name__=="__main__":
    unittest.main()
