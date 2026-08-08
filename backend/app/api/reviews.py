from fastapi import APIRouter, Depends, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.core.db import get_db
from app.core.security import get_current_user
from app.models.review import WeeklyReviewResponse
from app.services import weekly_review_service

router = APIRouter(prefix="/api/v1/reviews", tags=["reviews"])


@router.get("/weekly", response_model=WeeklyReviewResponse)
async def weekly(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """The review of the week that just ended.

    The numbers are recomputed on every request, like the rest of the read
    models, so they can never go stale against a freshly synced activity. The AI
    narrative is the one cached part: it is produced only when the deterministic
    verdict already says the plan should move, and only once for that week —
    this endpoint is refetched on focus, so regenerating the sentence each time
    would spend an API call per visit to describe a week that is already over."""
    return await weekly_review_service.build_weekly_review(db, str(user["_id"]))


@router.post("/run")
async def run_weekly(
    x_review_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Precompute everyone's weekly review. No user auth — secured by a shared
    secret header so an external scheduler (GitHub Actions cron, same as
    /push/run) can call it on Sunday evening.

    Returns a count only: no health data ever leaves through this endpoint."""
    if not settings.review_run_secret or x_review_secret != settings.review_run_secret:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Secret invalide."},
        )
    return await weekly_review_service.run_due_reviews(db)
