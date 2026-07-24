from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import activities, auth, fitness, garmin, jobs, plans
from app.core.config import settings
from app.core.db import get_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    await get_db().activities.create_index("garmin_activity_id", unique=True)
    yield


app = FastAPI(title="RunCoach API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(garmin.router)
app.include_router(activities.router)
app.include_router(fitness.router)
app.include_router(plans.router)
app.include_router(jobs.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
