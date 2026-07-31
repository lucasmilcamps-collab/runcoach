"""TEMPORARY — delete this router, its `enable_debug_slow` setting and its test
once the platform's inbound request limit is measured and written down in
`.claude/skills/plan-generator/SKILL.md`.

Why it exists: `generate_plan` runs inside the HTTP request and can hold it for
up to `_TOTAL_DEADLINE_S` (150s) without sending a single byte. Streaming the
call to Anthropic protects the OUTBOUND request; it does nothing for the
inbound one. If the host cuts an idle connection before then, the athlete gets a
502 while the backend keeps burning tokens on a plan nobody will receive — and
we do not currently know where that limit sits.

This endpoint reproduces exactly that shape: silence for N seconds, then a
response. Nothing else in the app should ever look like this.
"""

import asyncio
import time

from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import settings

router = APIRouter(prefix="/debug", tags=["debug"])

# Comfortably past the 150s generation budget, so a passing test at the top of
# the range actually proves the real case is safe.
_MAX_SLEEP_S = 300


@router.get("/slow", include_in_schema=False)
async def slow(seconds: int = Query(default=150, ge=1, le=_MAX_SLEEP_S)) -> dict:
    """Hold the request open for `seconds`, sending nothing, then answer.

    Read the RESULT, not the status code: if the client gets a 502/504 or a
    dropped connection instead of this body, the platform cut the connection and
    the synchronous design of `generate_plan` is unsafe at that duration.
    `elapsed_s` is there to catch a proxy that answers early from a cache.

    404 unless `ENABLE_DEBUG_SLOW` is set — an endpoint that pins a worker for
    minutes is a denial-of-service primitive on a single-instance host, so it
    stays shut and invisible (no OpenAPI entry) until someone opts in.
    """
    if not settings.enable_debug_slow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "Endpoint non activé."},
        )
    started = time.monotonic()
    await asyncio.sleep(seconds)
    return {
        "slept_s": seconds,
        "elapsed_s": round(time.monotonic() - started, 1),
        "note": "endpoint temporaire — à retirer après la mesure",
    }
