from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.garmin import (
    GarminConnectRequest,
    GarminConnectResponse,
    GarminMfaRequest,
    GarminSyncResponse,
    WorkoutPushRequest,
    WorkoutPushResponse,
)
from app.models.job import JobStatus
from app.services import garmin_service, garmin_sync_service, garmin_workout_service

router = APIRouter(prefix="/api/v1/garmin", tags=["garmin"])


@router.post("/connect", response_model=GarminConnectResponse)
async def connect(
    body: GarminConnectRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    try:
        result_status, mfa_token = await garmin_service.connect_garmin(
            db, str(user["_id"]), body.garmin_email, body.garmin_password
        )
    except garmin_service.GarminInvalidCredentialsError as exc:
        # 409 rather than 401 for the same reason as GARMIN_RELOGIN below: on a
        # 401 the mobile client refreshes its own token and replays the call,
        # so a mistyped Garmin password would be tried against Garmin twice per
        # tap — the surest way to a CAPTCHA or a locked account (garmin-sync).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
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

    return GarminConnectResponse(status=result_status, mfa_token=mfa_token)


@router.post("/connect/mfa", response_model=GarminConnectResponse)
async def connect_mfa(
    body: GarminMfaRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    try:
        await garmin_service.complete_garmin_mfa(
            db, str(user["_id"]), body.mfa_token, body.mfa_code
        )
    except garmin_service.GarminMfaInvalidError as exc:
        # 409, not 401 — a replayed MFA code is a second failed attempt at
        # Garmin's rate limit, and single-use codes don't survive the replay.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "GARMIN_MFA_INVALID",
                "message": "Code de vérification incorrect ou expiré.",
            },
        ) from exc
    except garmin_service.GarminUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "GARMIN_UPSTREAM_ERROR", "message": "Garmin Connect ne répond pas."},
        ) from exc

    return GarminConnectResponse(status="connected")


@router.post("/sync", response_model=GarminSyncResponse)
async def sync(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Runs a Garmin activity sync synchronously and returns its outcome.
    Throttled server-side to once per SYNC_MIN_INTERVAL — a call inside that
    window returns "skipped" without hitting Garmin."""
    job = await garmin_sync_service.sync_now(db, str(user["_id"]))
    if job is None:
        return GarminSyncResponse(status="skipped")
    if job.status == JobStatus.FAILED:
        return GarminSyncResponse(status="failed", error_message=job.error_message)
    return GarminSyncResponse(
        status="done",
        activities_synced=(job.result_summary or {}).get("activities_synced"),
    )


@router.post("/workout", response_model=WorkoutPushResponse)
async def push_workout(
    body: WorkoutPushRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Build a Garmin structured workout from a plan session and upload it to
    Garmin Connect, which syncs it to the paired watch on its next connection."""
    try:
        name = await garmin_workout_service.push_session_to_watch(db, str(user["_id"]), body)
    except garmin_workout_service.GarminNotConnectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "GARMIN_NOT_CONNECTED",
                "message": "Connectez d'abord votre compte Garmin.",
            },
        ) from exc
    except garmin_workout_service.GarminAuthExpiredError as exc:
        # 409, not 401: the mobile client reads any 401 as "my own token died",
        # refreshes it and replays the request — which would upload the workout
        # to Garmin twice, and sign the athlete out of Relay when the refresh
        # token is dead too. The Garmin session expiring is a business conflict.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "GARMIN_RELOGIN",
                "message": "Session Garmin expirée. Reconnectez votre compte dans Réglages.",
            },
        ) from exc
    except garmin_workout_service.GarminRateLimitedError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "GARMIN_RATE_LIMITED",
                "message": "Garmin limite les requêtes. Réessayez dans quelques minutes.",
            },
        ) from exc
    except garmin_workout_service.GarminWorkoutRejectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "GARMIN_WORKOUT_REJECTED",
                "message": (
                    "Garmin a refusé cette séance. Réessayer n'y changera rien — "
                    "envoyez-en une autre en attendant."
                ),
            },
        ) from exc
    except garmin_workout_service.GarminUpstreamError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "GARMIN_UPSTREAM_ERROR",
                "message": "Garmin Connect ne répond pas. Réessayez dans quelques minutes.",
            },
        ) from exc
    except garmin_workout_service.GarminWorkoutFailedError as exc:
        # The cause is spelled out on purpose. This is the branch for failures
        # nobody anticipated, and the person who hits it is the only one in a
        # position to report it — a message that says only "an error occurred"
        # sends them to a log console they don't have open.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "GARMIN_WORKOUT_FAILED",
                "message": f"Envoi impossible — {exc.cause_label} ({exc.stage}).",
            },
        ) from exc

    return WorkoutPushResponse(status="done", workout_name=name)
