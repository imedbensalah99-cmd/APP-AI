import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
import omda_render
class ContractTests(unittest.TestCase):
    def test_story_valid(self):
        p=Path(__file__).resolve().parents[1]/'examples/sardera_elevator.json'
        self.assertEqual(omda_render.validate_story(json.loads(p.read_text()))['channel'],'SARDERA')
    def test_cannot_claim_empty_scenes(self):
        with self.assertRaises(ValueError):omda_render.validate_story({'channel':'SARDERA','duration_seconds':10,'scenes':[]})
    def test_timing(self):
        self.assertEqual(omda_render.srt_timestamp(1.5),'00:00:01,500')
if __name__=='__main__':unittest.main()