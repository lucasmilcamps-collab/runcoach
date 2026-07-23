from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, garmin
from app.core.config import settings

app = FastAPI(title="RunCoach API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(garmin.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
