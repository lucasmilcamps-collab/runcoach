from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.db import get_db
from app.core.security import get_current_user
from app.models.fitness import FitnessResponse
from app.services import fitness_service

router = APIRouter(prefix="/api/v1/fitness", tags=["fitness"])


@router.get("", response_model=FitnessResponse)
async def get_fitness(
    db: AsyncIOMotorDatabase = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    return await fitness_service.compute_fitness(db, str(user["_id"]))
