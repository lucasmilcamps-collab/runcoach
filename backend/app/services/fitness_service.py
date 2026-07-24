"""Turns stored activities + the athlete's HR profile into the CTL/ATL/TSB
curve. All the physiology lives in load_service (pure, tested); this module is
just the DB glue — read profile, read activities, aggregate daily load, hand
off to load_service, shape the response. Recomputed on every request so a
changed profile or a new activity is reflected without any resync."""

from datetime import UTC, date, datetime

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.fitness import FitnessDay, FitnessResponse
from app.services import load_service

# Trailing window returned to the client. CTL/ATL are still seeded from the
# full history the maths sees; this only bounds how much of the curve we ship.
_SERIES_WINDOW_DAYS = 42


def _as_utc_date(value: datetime) -> date:
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware.astimezone(UTC).date()


async def compute_fitness(db: AsyncIOMotorDatabase, user_id: str) -> FitnessResponse:
    today = datetime.now(UTC).date()

    profile = await db.fitness_profiles.find_one({"user_id": user_id})
    hr_max = (profile or {}).get("hr_max")
    hr_rest = (profile or {}).get("hr_rest")
    has_profile = hr_max is not None and hr_rest is not None

    if not has_profile:
        # No zones without both bounds — never fake them (no 220−age).
        return FitnessResponse(
            has_profile=False,
            hr_max=hr_max,
            hr_rest=hr_rest,
            low_confidence=True,
            ctl=0.0,
            atl=0.0,
            tsb=0.0,
            series=[],
        )

    daily_loads: dict[date, float] = {}
    cursor = db.activities.find({"user_id": user_id})
    async for doc in cursor:
        trimp = load_service.compute_trimp(
            doc.get("duration_s") or 0, doc.get("avg_hr"), hr_max, hr_rest
        )
        if trimp is None:
            continue
        day = _as_utc_date(doc["start_time"])
        daily_loads[day] = daily_loads.get(day, 0.0) + trimp

    if not daily_loads:
        return FitnessResponse(
            has_profile=True,
            hr_max=hr_max,
            hr_rest=hr_rest,
            low_confidence=True,
            ctl=0.0,
            atl=0.0,
            tsb=0.0,
            series=[],
        )

    full_series = load_service.compute_fitness_series(daily_loads, today)
    low_confidence = load_service.has_low_confidence(daily_loads, today)

    current = full_series[-1]
    window = full_series[-_SERIES_WINDOW_DAYS:]

    return FitnessResponse(
        has_profile=True,
        hr_max=hr_max,
        hr_rest=hr_rest,
        low_confidence=low_confidence,
        ctl=round(current.ctl, 1),
        atl=round(current.atl, 1),
        tsb=round(current.tsb, 1),
        series=[
            FitnessDay(
                day=point.day,
                load=round(point.load, 1),
                ctl=round(point.ctl, 1),
                atl=round(point.atl, 1),
                tsb=round(point.tsb, 1),
            )
            for point in window
        ],
    )
