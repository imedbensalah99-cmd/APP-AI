#!/usr/bin/env python3
"""Pin, clone and safely instrument upstream OpenMontage for OMDA free-only use.

This script does NOT deploy, generate media, use credits, publish or grant
Google Drive access. Network is needed only when cloning the pinned source.
"""
from __future__ import annotations
import argparse
import shutil
import subprocess
from pathlib import Path

UPSTREAM = "https://github.com/calesthio/OpenMontage.git"
PINNED_COMMIT = "195eab24478dc9363326aec437aefc3701635ddf"

def replace_once(content: str, old: str, new: str, label: str) -> str:
    if content.count(old) != 1:
        raise RuntimeError(f"Upstream {label} changed: expected one patch anchor.")
    return content.replace(old, new, 1)

def apply_guard(target: Path, integration: Path) -> None:
    base_path = target / "tools" / "base_tool.py"
    registry_path = target / "tools" / "tool_registry.py"
    if not (base_path.is_file() and registry_path.is_file()):
        raise RuntimeError("OpenMontage tool framework files not found")
    if not (target / "LICENSE").is_file():
        raise RuntimeError("Upstream license absent: refusing integration")
    if "GNU AFFERO GENERAL PUBLIC LICENSE" not in (target / "LICENSE").read_text(encoding="utf-8"):
        raise RuntimeError("Unexpected upstream license: manual review needed")
    base = base_path.read_text(encoding="utf-8")
    registry = registry_path.read_text(encoding="utf-8")
    base = replace_once(
        base,
        "cls.execute = _cache_execute(_instrument_execute(impl))",
        "from tools.omda_free_guard import wrap_execute\n"
        "            cls.execute = wrap_execute(_cache_execute(_instrument_execute(impl)))",
        "BaseTool execution wrapper",
    )
    registry = replace_once(
        registry,
        "self._tools[tool.name] = tool",
        "from tools.omda_free_guard import allowed_tool\n"
        "        if not allowed_tool(tool)[0]:\n"
        "            return\n"
        "        self._tools[tool.name] = tool",
        "tool registry",
    )
    shutil.copyfile(integration / "omda_free_guard.py", target / "tools" / "omda_free_guard.py")
    base_path.write_text(base, encoding="utf-8")
    registry_path.write_text(registry, encoding="utf-8")
    policy = (integration / "POLICY.md").read_text(encoding="utf-8")
    (target / "OMDA_FREE_ONLY_POLICY.md").write_text(policy, encoding="utf-8")
    print("APPLIED: central paid-provider and publishing guard; license preserved")

def install(destination: Path, integration: Path) -> None:
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite existing path: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "clone", "--no-checkout", "--filter=blob:none", UPSTREAM, str(destination)],
        check=True,
    )
    try:
        subprocess.run(["git", "-C", str(destination), "checkout", "--detach", PINNED_COMMIT], check=True)
        head = subprocess.check_output(
            ["git", "-C", str(destination), "rev-parse", "HEAD"], text=True
        ).strip()
        if head != PINNED_COMMIT:
            raise RuntimeError("Pinned upstream revision verification failed")
        apply_guard(destination, integration)
    except Exception:
        print("Incomplete checkout left for inspection; NOT deployed")
        raise
    print("READY FOR SANDBOX TESTS: " + str(destination))
    print("NOT PRODUCTION READY; NO PAID PROVIDERS, GPU OR YOUTUBE UPLOAD")

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    install(args.destination.expanduser().resolve(), Path(__file__).resolve().parent)

if __name__ == "__main__":
    main()
