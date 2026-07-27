from fastapi import APIRouter, Depends, Header, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.core.db import get_db
from app.core.security import get_current_user
from app.models.push import PublicKeyResponse, PushSubscriptionIn, UnsubscribeIn
from app.services import push_service

router = APIRouter(prefix="/api/v1/push", tags=["push"])


@router.get("/public-key", response_model=PublicKeyResponse)
async def public_key():
    """The VAPID applicationServerKey the browser needs to subscribe (public,
    safe to expose). Null when push isn't configured."""
    return PublicKeyResponse(public_key=push_service.get_public_key())


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe(
    body: PushSubscriptionIn,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    await push_service.save_subscription(db, str(user["_id"]), body)


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    body: UnsubscribeIn,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    await push_service.delete_subscription(db, str(user["_id"]), body.endpoint)


@router.post("/test")
async def send_test(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Send a test push to the caller's own subscriptions — verifies the whole
    chain end to end."""
    sent = await push_service.send_to_user(
        db,
        str(user["_id"]),
        push_service.Notification(
            title="RunCoach", body="Notifications activées ✔", url="/"
        ),
    )
    return {"sent": sent}


@router.post("/run")
async def run_due(
    x_push_secret: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Send everyone's due notifications. No user auth — secured by a shared
    secret header so an external scheduler (GitHub Actions cron) can call it."""
    if not settings.push_run_secret or x_push_secret != settings.push_run_secret:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "FORBIDDEN", "message": "Secret invalide."},
        )
    return await push_service.send_due_notifications(db)
