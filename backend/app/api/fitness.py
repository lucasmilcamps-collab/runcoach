from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.fitness import FitnessProfileUpdate, FitnessResponse
from app.services import fitness_service

router = APIRouter(prefix="/api/v1/fitness", tags=["fitness"])


@router.get("", response_model=FitnessResponse)
async def get_fitness(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return await fitness_service.compute_fitness(db, str(user["_id"]))


@router.put("/profile", response_model=FitnessResponse)
async def set_profile(
    body: FitnessProfileUpdate,
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Set HRmax/HRrest manually and return the freshly recomputed fitness so
    the client reflects it immediately."""
    user_id = str(user["_id"])
    await fitness_service.set_manual_profile(db, user_id, body.hr_max, body.hr_rest)
    return await fitness_service.compute_fitness(db, user_id)
