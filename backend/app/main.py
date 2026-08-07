import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import activities, auth, fitness, garmin, jobs, plans, push, reviews
from app.core.config import settings
from app.core.db import get_db

# uvicorn configures its own loggers and leaves the root one bare, so anything
# the app logs was landing on logging's `lastResort` handler: the bare message
# on stderr, with no level, no timestamp and no logger name — unfindable in a
# host's log stream, which is where it matters. Configure it once, here.
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    force=True,  # uvicorn --reload can import this module more than once
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await get_db().activities.create_index("garmin_activity_id", unique=True)
    yield


app = FastAPI(title="Relay API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's default 422 body is a list of pydantic errors, which the mobile
    client (expecting `detail={code, message}`, api-conventions) can only render
    as "Unprocessable Entity". Surface the first error's message instead, so a
    rejected request says what is wrong — e.g. min > max run sessions."""
    errors = exc.errors()
    message = "Requête invalide."
    if errors:
        raw = str(errors[0].get("msg") or message)
        # Pydantic prefixes messages raised from a validator with "Value error, ".
        message = raw.removeprefix("Value error, ")
    # 422 as a literal: starlette deprecated its own name for this status.
    return JSONResponse(
        status_code=422,
        content={"detail": {"code": "VALIDATION_ERROR", "message": message}},
    )


app.include_router(auth.router)
app.include_router(garmin.router)
app.include_router(activities.router)
app.include_router(fitness.router)
app.include_router(plans.router)
app.include_router(jobs.router)
app.include_router(push.router)
app.include_router(reviews.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
