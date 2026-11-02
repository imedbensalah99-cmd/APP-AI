import unittest
from pathlib import Path
from clip_quality import select_unique_candidates, plan_unique_segments


def hit(i, url=None):
    return {"id": i, "user": "fixture", "videos": {"small": {"url": url or f"https://cdn.pixabay.com/video/{i}.mp4"}}}


class ClipQualityTests(unittest.TestCase):
    def test_only_three_unique_video_assets_can_create_three_segments(self):
        candidates = select_unique_candidates([hit(1), hit(1), hit(2), hit(3)])
        self.assertEqual([x[0] for x in candidates], [1, 2, 3])
        self.assertEqual(plan_unique_segments(["a.mp4", "b.mp4", "c.mp4"]), ["a.mp4", "b.mp4", "c.mp4"])

    def test_two_valid_clips_fail_instead_of_repeating_first(self):
        with self.assertRaisesRegex(ValueError, "INSUFFICIENT_UNIQUE_STOCK"):
            plan_unique_segments(["a.mp4", "b.mp4"])

    def test_duplicate_filepath_rejected(self):
        with self.assertRaisesRegex(ValueError, "REPEATED_VIDEO_SOURCE"):
            plan_unique_segments([Path("a.mp4"), Path("b.mp4"), Path("./a.mp4")])

    def test_duplicate_urls_and_ids_removed(self):
        hits = [hit(9), hit(10, "https://cdn.pixabay.com/video/9.mp4"), hit(9, "https://cdn.pixabay.com/video/99.mp4")]
        self.assertEqual(len(select_unique_candidates(hits)), 1)

    def test_untrusted_hosts_and_non_https_rejected(self):
        bad = [hit(1, "https://pixabay.com.evil.invalid/f.mp4"),
               hit(2, "http://cdn.pixabay.com/video/2.mp4"),
               hit(3, "https://user:pw@cdn.pixabay.com/video/3.mp4"),
               hit(4, "https://cdn.pixabay.com:8443/video/4.mp4")]
        self.assertEqual(select_unique_candidates(bad), [])

    def test_limit_is_respected(self):
        self.assertEqual(len(select_unique_candidates([hit(i) for i in range(1, 20)], limit=9)), 9)


if __name__ == "__main__":
    unittest.main()
