"""Hard zero-spend execution policy for OpenMontage tools.

Installed inside the upstream tools package. Deliberately cannot be disabled
with an environment variable. No billing credentials are loaded or required.
"""
from functools import wraps

_FREE_API_TOOLS = frozenset({
    "pexels_image", "pexels_video", "pixabay_image", "pixabay_video",
    "unsplash_image",
})
# Hybrid controllers are permitted; any provider tool they dispatch is guarded.
_FREE_HYBRID_TOOLS = frozenset({
    "corpus_builder", "image_selector", "video_selector",
    "tts_selector", "music_selector", "video_compose",
})
_FREE_SECRET_DEPENDENCIES = frozenset({
    "PEXELS_API_KEY", "PIXABAY_API_KEY", "UNSPLASH_ACCESS_KEY",
})

def _value(obj):
    return str(getattr(obj, "value", obj)).lower()

def allowed_tool(tool):
    """Return (bool, reason). Fail closed for anything not clearly free."""
    name = str(getattr(tool, "name", ""))
    tier = _value(getattr(tool, "tier", ""))
    runtime = _value(getattr(tool, "runtime", ""))
    deps = getattr(tool, "dependencies", ()) or ()
    secret_deps = {
        str(dep)[4:] for dep in deps if str(dep).startswith("env:")
    }
    if tier == "publish" or name.endswith("_publisher"):
        return False, "Publishing requires separate owner approval and integration."
    if secret_deps - _FREE_SECRET_DEPENDENCIES:
        return False, "Paid or unapproved API credentials are prohibited."
    if runtime == "api":
        if name not in _FREE_API_TOOLS:
            return False, "Only explicit no-charge stock APIs are permitted."
        return True, "Free stock API"
    if runtime == "hybrid":
        if name not in _FREE_HYBRID_TOOLS:
            return False, "Unreviewed hybrid provider blocked."
        return True, "Reviewed hybrid controller"
    if runtime == "local_gpu":
        return False, "No free GPU is provisioned for this cloud stage."
    if runtime == "local":
        return True, "Local tool without paid API credentials"
    return False, "Unknown execution runtime: fail closed."

def wrap_execute(fn):
    """Block disallowed tool execution, including direct imports and selectors."""
    @wraps(fn)
    def guarded(self, inputs, *args, **kwargs):
        allowed, reason = allowed_tool(self)
        if not allowed:
            from tools.base_tool import ToolResult
            return ToolResult(
                success=False,
                error="OMDA_FREE_ONLY_BLOCKED: " + reason,
                cost_usd=0.0,
            )
        return fn(self, inputs, *args, **kwargs)
    return guarded
