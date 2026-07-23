from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.garmin import GarminConnectRequest, GarminConnectResponse
from app.services import garmin_service

router = APIRouter(prefix="/api/v1/garmin", tags=["garmin"])


@router.post("/connect", response_model=GarminConnectResponse)
async def connect(
    body: GarminConnectRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    try:
        await garmin_service.connect_garmin(
            db, str(user["_id"]), body.garmin_email, body.garmin_password
        )
    except garmin_service.GarminInvalidCredentialsError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "GARMIN_INVALID_CREDENTIALS",
                "message": "Identifiants Garmin refusés.",
            },
        ) from exc
    except garmin_service.GarminUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "GARMIN_UPSTREAM_ERROR", "message": "Garmin Connect ne répond pas."},
        ) from exc
    return GarminConnectResponse()
