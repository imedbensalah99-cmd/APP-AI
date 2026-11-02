"""Pure, offline clip-quality gates for OMDA's no-spend staging renderer.

Never downloads stock, invokes AI, or performs a network request.
"""
from pathlib import Path
from urllib.parse import urlsplit


def select_unique_candidates(hits, limit=9):
    """Select unique Pixabay video IDs and URLs from bounded search metadata."""
    result, seen_ids, seen_urls = [], set(), set()
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        vid = hit.get("id")
        if not isinstance(vid, int) or vid <= 0 or vid in seen_ids:
            continue
        variants = hit.get("videos") or {}
        selected = next((variants[k] for k in ("small", "tiny", "medium")
                         if isinstance(variants.get(k), dict)
                         and isinstance(variants[k].get("url"), str)), None)
        if not selected:
            continue
        uri = selected["url"]
        parsed = urlsplit(uri)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not (host == "pixabay.com" or host.endswith(".pixabay.com")):
            continue
        if parsed.username or parsed.password or parsed.port not in (None, 443):
            continue
        if uri in seen_urls:
            continue
        seen_ids.add(vid)
        seen_urls.add(uri)
        result.append((vid, hit.get("user"), uri))
        if len(result) >= limit:
            break
    return result


def plan_unique_segments(material, expected=3):
    """Fail closed instead of replaying a clip to fill the 60-second timeline."""
    if len(material) < expected:
        raise ValueError("INSUFFICIENT_UNIQUE_STOCK")
    plan = list(material[:expected])
    resolved = [str(Path(x).resolve()) for x in plan]
    if len(set(resolved)) != expected:
        raise ValueError("REPEATED_VIDEO_SOURCE")
    return plan
