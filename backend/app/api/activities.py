from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.activity import ActivityResponse, ManualActivityCreate
from app.services import activity_service

router = APIRouter(prefix="/api/v1/activities", tags=["activities"])


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return await activity_service.list_activities(db, str(user["_id"]))


@router.post("", response_model=ActivityResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_activity(
    body: ManualActivityCreate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Log a session by hand (no HR): its load is derived from session-RPE."""
    return await activity_service.create_manual_activity(db, str(user["_id"]), body)


@router.delete("/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_manual_activity(
    activity_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Delete a manually-logged activity (Garmin-synced ones are not deletable)."""
    deleted = await activity_service.delete_manual_activity(db, str(user["_id"]), activity_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ACTIVITY_NOT_FOUND", "message": "Séance introuvable."},
        )
