from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.job import JobResponse
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
    SessionSkipRequest,
    TodaySession,
    Weekday,
    WeekReconciliation,
)
from app.services import (
    plan_completion_service,
    plan_moves_service,
    plan_progress,
    plan_reconcile_service,
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


@router.post("", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_plan(
    body: PlanRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Queue a plan generation and return its job.

    Not synchronous, and it can't be: a 17-week plan is ~12.5k output tokens,
    three to six minutes of model time. Poll `GET /api/v1/jobs/{id}`; once it
    reports `done`, `GET /api/v1/plans/current` has the plan."""
    return await plan_service.start_generation(db, str(user["_id"]), body)


@router.post("/replan", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def replan(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Replan the weeks ahead, keeping everything through the week under way.

    The difference from `POST /plans` matters: that one rebuilds the plan from
    scratch, week one included, so a session already run and linked is rebuilt
    out from under the athlete. This one freezes the elapsed weeks on their
    original dates and regenerates only what is left, which keeps completed work
    — and the links made against it — exactly where they were.

    Takes no body on purpose: it reuses the active plan's objective. Adjusting
    how you get somewhere is not redefining where you are going; that is what
    the plan-setup screen is for."""
    try:
        return await plan_service.start_partial_replan(db, str(user["_id"]))
    except plan_service.NoActivePlanError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_ACTIVE_PLAN", "message": "Aucun plan actif."},
        ) from None
    except plan_service.NothingLeftToReplanError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "NOTHING_TO_REPLAN",
                "message": (
                    "Ton plan se termine cette semaine : il n'y a plus de semaine à replanifier."
                ),
            },
        ) from None


@router.post("/replan-injury", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
async def replan_injury(
    body: InjuryReport,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Declare an injury and replan the remaining weeks as a comeback (eased-off
    period then a gradual ramp). Reuses the current plan's objective; a plan must
    already exist. Queued like any generation — poll the returned job.

    Partial, like every other replan: the weeks through the one under way are
    frozen, so an injury declared on a Friday never rewrites the sessions already
    run and linked that week. What is left of the current week is handled by
    skipping sessions, which is what that override is for; the comeback phase
    starts with the first week actually being rewritten.
    """
    user_id = str(user["_id"])
    current = await plan_service.get_current_plan(db, user_id)
    if current is None or current.request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_PLAN", "message": "Aucun plan à réadapter."},
        )
    try:
        base = await plan_service.build_replan_base(db, user_id)
    except plan_service.NothingLeftToReplanError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "NOTHING_TO_REPLAN",
                "message": (
                    "Ton plan se termine cette semaine : il n'y a plus de semaine à réadapter. "
                    "Passe les séances que tu ne peux pas faire."
                ),
            },
        ) from None
    return await plan_service.start_generation(db, user_id, current.request, injury=body, base=base)


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


@router.get("/reconcile", response_model=WeekReconciliation)
async def reconcile(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Sessions of elapsed weeks the athlete has neither validated nor declared
    missed.

    Not an error state and never a 404: with no plan it answers `has_pending:
    false`. The app blocks on this, so it must not be able to block on the
    absence of a plan."""
    return await plan_reconcile_service.pending(db, str(user["_id"]))


@router.post("/reconcile/confirm-all")
async def reconcile_confirm_all(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Link every pending session that came with a suggested activity."""
    return {"linked": await plan_reconcile_service.confirm_all_suggested(db, str(user["_id"]))}


@router.post("/reconcile/skip-all")
async def reconcile_skip_all(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Declare every remaining pending session not done. Reversible, like any
    skip — the sessions stay in the plan, flagged."""
    return {"skipped": await plan_reconcile_service.resolve_all_missed(db, str(user["_id"]))}


@router.get("/session/link", response_model=SessionLinkInfo)
async def get_session_link(
    week_index: int,
    day: Weekday,
    slot: Literal["primary", "addon"] = "primary",
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """The activity linked to a planned session (by week + weekday + slot), plus
    the session's real calendar date so the picker can surface nearby
    activities."""
    try:
        return await plan_completion_service.get_session_link(
            db, str(user["_id"]), week_index, day, slot
        )
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
            db, str(user["_id"]), body.week_index, body.day, body.activity_id, body.slot
        )
    except plan_completion_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc
    except plan_completion_service.ActivityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ACTIVITY_NOT_FOUND", "message": "Activité introuvable."},
        ) from exc
    except plan_completion_service.SportMismatchError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SPORT_MISMATCH",
                "message": (
                    "Cette séance est une séance de course : une activité "
                    f"{exc.activity_sport} ne peut pas la valider."
                ),
            },
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


@router.post("/session/skip", response_model=PlanResponse)
async def skip_session(
    body: SessionSkipRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Mark a session skipped, or un-skip it, for one week only (per-week
    override). Allowed on runs — unlike deletion — because it doesn't pretend
    the plan changed. It never triggers a regeneration: a skipped key session
    feeds `replan_suggested`, and acting on that stays the athlete's call."""
    user_id = str(user["_id"])
    try:
        await plan_moves_service.skip_session(
            db, user_id, body.week_index, body.day, body.slot, body.skipped
        )
    except plan_moves_service.NoActivePlanError as exc:
        raise _no_plan_error() from exc
    except plan_moves_service.SessionNotFoundError as exc:
        raise _session_not_found_error() from exc
    return await plan_service.get_current_plan(db, user_id)


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


@router.post("/versions/{version}/restore", response_model=PlanResponse)
async def restore_plan_version(
    version: int,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Bring a past version back as the active plan.

    Non-destructive: the version is copied forward as a new one, so the plan it
    replaces stays in the history and a restore can itself be undone. This is
    the way back from a regeneration that rebuilt a week the athlete had already
    run — the case this endpoint exists for."""
    try:
        return await plan_service.restore_plan_version(db, str(user["_id"]), version)
    except plan_service.PlanVersionNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NO_PLAN_VERSION", "message": "Version introuvable."},
        ) from None


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
