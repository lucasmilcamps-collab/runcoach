from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.plan import (
    InjuryReport,
    PlanProgress,
    PlanRequest,
    PlanResponse,
    PlanVersionSummary,
    TodaySession,
)
from app.services import plan_progress, plan_service

router = APIRouter(prefix="/api/v1/plans", tags=["plans"])


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
