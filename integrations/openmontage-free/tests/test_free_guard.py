"""Offline unit tests for zero-spend guard and reversible source patch."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("omda_guard_test", ROOT / "omda_free_guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

def fake(name="piper_tts", runtime="local", tier="voice", deps=()):
    return SimpleNamespace(name=name, runtime=runtime, tier=tier, dependencies=deps)

class GuardTests(unittest.TestCase):
    def test_piper_ffmpeg_are_allowed(self):
        for name in ("piper_tts", "video_compose"):
            self.assertTrue(guard.allowed_tool(fake(name))[0], name)

    def test_free_stock_provider(self):
        self.assertTrue(guard.allowed_tool(fake("pexels_video","api","source",["env:PEXELS_API_KEY"]))[0])
        self.assertTrue(guard.allowed_tool(fake("pixabay_image","api","source",["env:PIXABAY_API_KEY"]))[0])

    def test_paid_tool_is_blocked_even_with_key(self):
        for name in ("veo_video", "kling_video", "runway_video", "google_music", "openai_tts"):
            self.assertFalse(guard.allowed_tool(fake(name,"api","generate"))[0], name)

    def test_paid_secret_cannot_hide_behind_local_runtime(self):
        self.assertFalse(guard.allowed_tool(fake("sneaky","local","core",["env:FAL_KEY"]))[0])

    def test_publishing_blocked(self):
        self.assertFalse(guard.allowed_tool(fake("youtube_upload","local","publish"))[0])

    def test_unknown_hybrid_and_gpu_blocked(self):
        self.assertFalse(guard.allowed_tool(fake("foo","hybrid","generate"))[0])
        self.assertFalse(guard.allowed_tool(fake("wan_video","local_gpu","generate"))[0])

    def test_corpus_builder_hybrid_allowed(self):
        self.assertTrue(guard.allowed_tool(fake("corpus_builder","hybrid","source"))[0])

    def test_wrapped_paid_tool_does_not_execute(self):
        count = [0]
        def expensive(self, inputs):
            count[0] += 1
        tool = fake("veo_video", "api", "generate")
        # Mock the upstream ToolResult import for this no-dependency test.
        import sys, types
        tools_module = types.ModuleType("tools")
        base_module = types.ModuleType("tools.base_tool")
        class Result:
            def __init__(self, **kw): self.__dict__.update(kw)
        base_module.ToolResult = Result
        old_tools = sys.modules.get("tools")
        old_base = sys.modules.get("tools.base_tool")
        try:
            sys.modules["tools"] = tools_module
            sys.modules["tools.base_tool"] = base_module
            outcome = guard.wrap_execute(expensive)(tool,{})
            self.assertFalse(outcome.success)
            self.assertEqual(outcome.cost_usd, 0)
            self.assertEqual(count[0], 0)
        finally:
            if old_tools is None: sys.modules.pop("tools", None)
            else: sys.modules["tools"] = old_tools
            if old_base is None: sys.modules.pop("tools.base_tool", None)
            else: sys.modules["tools.base_tool"] = old_base

    def test_installer_has_strict_anchors(self):
        sp = importlib.util.spec_from_file_location("omda_install_test", ROOT / "install.py")
        module = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(module)
        self.assertEqual(module.replace_once("hello", "hello", "yes", "fixture"), "yes")
        with self.assertRaises(RuntimeError):
            module.replace_once("missing", "hello", "yes", "fixture")

if __name__ == "__main__":
    unittest.main()
