from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.plan import PlanProgress, PlanRequest, PlanResponse, TodaySession
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
