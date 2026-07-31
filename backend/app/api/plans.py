from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.plan import (
    InjuryReport,
    PlanOverview,
    PlanProgress,
    PlanRequest,
    PlanResponse,
    PlanVersionSummary,
    SessionDeleteRequest,
    SessionDurationRequest,
    SessionLinkInfo,
    SessionLinkRequest,
    SessionMoveRequest,
    TodaySession,
    Weekday,
)
from app.services import (
    plan_completion_service,
    plan_moves_service,
    plan_progress,
    plan_service,
)

router = APIRouter(prefix="/api/v1/plans", tags=["plans"])


def _no_plan_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "NO_PLAN", "message": "Aucun plan actif."},
    )


def _session_not_found_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "SESSION_NOT_FOUND", "message": "Séance introuvable pour ce jour."},
    )


@router.post("", response_model=PlanResponse)
async def create_plan(
    body: PlanRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Generate a new plan version from the athlete's request. Synchronous:
    resolves only once the plan is generated, validated, and stored (or failed
    with a message)."""
    return await plan_service.generate_plan(db, str(user["_id"]), body)


@router.post("/replan-injury", response_model=PlanResponse)
async def replan_injury(
    body: InjuryReport,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Declare an injury and regenerate the remaining plan as a comeback (eased-off
    period then a gradual ramp). Reuses the current plan's objective; a plan must
    already exist."""
    user_id = str(user["_id"])
    current = await plan_service.get_current_plan(db, user_id)
    if current is None or current.request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_PLAN", "message": "Aucun plan à réadapter."},
        )
    return await plan_service.generate_plan(db, user_id, current.request, injury=body)


@router.get("/today", response_model=TodaySession)
async def today_session(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Today's planned session, deterministically adjusted for current form."""
    return await plan_service.get_today_session(db, str(user["_id"]))


@router.get("/progress", response_model=PlanProgress)
async def plan_progress_endpoint(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Recent adherence + whether a replan is warranted (missed key sessions or
    persistent fatigue)."""
    return await plan_progress.compute_progress(db, str(user["_id"]))


@router.get("/session/link", response_model=SessionLinkInfo)
async def get_session_link(
    week_index: int,
    day: Weekday,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """The activity linked to a planned session (by week + weekday), plus the
    session's real calendar date so the picker can surface nearby activities."""
    try:
        return await plan_completion_service.get_session_link(db, str(user["_id"]), week_index, day)
    except plan_completion_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc


@router.post("/session/link", response_model=SessionLinkInfo)
async def set_session_link(
    body: SessionLinkRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Link (or unlink, when activity_id is null) a recorded activity to a
    planned session."""
    try:
        return await plan_completion_service.set_session_link(
            db, str(user["_id"]), body.week_index, body.day, body.activity_id
        )
    except plan_completion_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc
    except plan_completion_service.ActivityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ACTIVITY_NOT_FOUND", "message": "Activité introuvable."},
        ) from exc


@router.post("/session/move", response_model=PlanResponse)
async def move_session(
    body: SessionMoveRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Move a session to another weekday for one week only (per-week override).
    Returns the updated current plan."""
    user_id = str(user["_id"])
    try:
        await plan_moves_service.move_session(
            db, user_id, body.week_index, body.from_day, body.to_day
        )
    except plan_moves_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc
    except plan_moves_service.SessionNotFoundError as exc:
        raise _session_not_found_error() from exc
    plan = await plan_service.get_current_plan(db, user_id)
    if plan is None:
        raise _no_plan_error()
    return plan


@router.post("/session/duration", response_model=PlanResponse)
async def set_session_duration(
    body: SessionDurationRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Change a session's duration for one week only (per-week override).
    Returns the updated current plan."""
    user_id = str(user["_id"])
    try:
        await plan_moves_service.set_session_duration(
            db, user_id, body.week_index, body.day, body.slot, body.duration_min
        )
    except plan_moves_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc
    except plan_moves_service.SessionNotFoundError as exc:
        raise _session_not_found_error() from exc
    plan = await plan_service.get_current_plan(db, user_id)
    if plan is None:
        raise _no_plan_error()
    return plan


@router.post("/session/delete", response_model=PlanResponse)
async def delete_session(
    body: SessionDeleteRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Drop a non-run session for one week only (per-week override). Returns the
    updated current plan."""
    user_id = str(user["_id"])
    try:
        await plan_moves_service.delete_session(db, user_id, body.week_index, body.day, body.slot)
    except plan_moves_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc
    except plan_moves_service.SessionNotFoundError as exc:
        raise _session_not_found_error() from exc
    except plan_moves_service.CannotDeleteRunError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "CANNOT_DELETE_RUN",
                "message": (
                    "Une séance de course ne se supprime pas à la semaine : "
                    "régénère le plan pour changer le nombre de courses."
                ),
            },
        ) from exc
    plan = await plan_service.get_current_plan(db, user_id)
    if plan is None:
        raise _no_plan_error()
    return plan


@router.post("/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_plan(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Stop the active plan. It leaves the current-plan reads (today, progress,
    per-week overrides) but stays readable in the version history."""
    try:
        await plan_service.cancel_current_plan(db, str(user["_id"]))
    except plan_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc


@router.get("/current", response_model=PlanResponse)
async def current_plan(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    plan = await plan_service.get_current_plan(db, str(user["_id"]))
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_PLAN", "message": "Aucun plan pour l'instant."},
        )
    return plan


@router.get("/versions", response_model=list[PlanVersionSummary])
async def plan_versions(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Read-only history of successful plan versions, newest first."""
    return await plan_service.list_plan_versions(db, str(user["_id"]))


@router.get("/versions/{version}", response_model=PlanResponse)
async def plan_version(
    version: int,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """A single past plan version, read-only."""
    plan = await plan_service.get_plan_version(db, str(user["_id"]), version)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_PLAN_VERSION", "message": "Version introuvable."},
        )
    return plan


@router.get("/versions/{version}/overview", response_model=PlanOverview)
async def plan_version_overview(
    version: int,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Calendar placement + week-by-week planned-vs-done key runs for one plan
    version — what the plan summary screen needs beyond the plan itself."""
    adherence = await plan_progress.compute_overview(db, str(user["_id"]), version)
    if adherence is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_PLAN_VERSION", "message": "Version introuvable."},
        )
    return adherence
