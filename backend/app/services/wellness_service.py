"""Turns the stored daily Garmin wellness records into the recovery signals the
deterministic daily adjustment needs (plan_adaptation.adjust_session).

Baselines are 30-day rolling means (training-science skill). The raw records are
written by garmin_sync_service.sync_wellness; this module is just the read side —
pull the window, average the history, and derive today's signals. Never raises:
missing data simply yields empty signals, and the adjustment falls back to TSB.
"""

from datetime import date, timedelta
from statistics import mean

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.plan_adaptation import RecoverySignals

# Rolling baseline window (training-science: HRV/FC repos vs 30-day baseline).
_BASELINE_WINDOW_DAYS = 30
# Below this many samples a baseline is too noisy to act on — leave it None so
# the autonomic rule stays dormant rather than firing on thin data.
_MIN_BASELINE_SAMPLES = 7
# A "short night" for the no-intensity rule (training-science: < 6 h).
_SHORT_NIGHT_SECONDS = 6 * 3600


def _num(value: object) -> float | None:
    if isinstance(value, bool):  # bool is an int subclass — exclude it explicitly
        return None
    return float(value) if isinstance(value, (int, float)) else None


def _mean_field(docs: list[dict], field: str) -> float | None:
    values = [v for d in docs if (v := _num(d.get(field))) is not None]
    if len(values) < _MIN_BASELINE_SAMPLES:
        return None
    return round(mean(values), 1)


def _short_night_streak(docs_desc: list[dict]) -> int:
    """Consecutive short nights ending at the most recent record. A night with no
    sleep data breaks the run (conservative — we never assume an unlogged night
    was short)."""
    streak = 0
    for doc in docs_desc:
        secs = _num(doc.get("sleep_seconds"))
        if secs is None or secs >= _SHORT_NIGHT_SECONDS:
            break
        streak += 1
    return streak


async def get_recovery_signals(
    db: AsyncIOMotorDatabase, user_id: str, today: date
) -> RecoverySignals:
    cutoff = (today - timedelta(days=_BASELINE_WINDOW_DAYS)).isoformat()
    docs: list[dict] = []
    cursor = db.wellness_daily.find(
        {"user_id": user_id, "day": {"$gte": cutoff, "$lte": today.isoformat()}}
    )
    async for doc in cursor:
        docs.append(doc)

    if not docs:
        return RecoverySignals()

    docs.sort(key=lambda d: d.get("day", ""))
    latest = docs[-1]
    prior = docs[:-1]  # baseline excludes the day we're comparing against

    sleep_seconds = _num(latest.get("sleep_seconds"))
    sleep_hours = round(sleep_seconds / 3600, 1) if sleep_seconds is not None else None

    body_battery = latest.get("body_battery")
    body_battery = int(body_battery) if isinstance(body_battery, (int, float)) else None

    data_date: date | None = None
    if isinstance(latest.get("day"), str):
        try:
            data_date = date.fromisoformat(latest["day"])
        except ValueError:
            data_date = None

    return RecoverySignals(
        hrv=_num(latest.get("hrv")),
        hrv_baseline=_mean_field(prior, "hrv"),
        resting_hr=_num(latest.get("resting_hr")),
        resting_hr_baseline=_mean_field(prior, "resting_hr"),
        short_nights_streak=_short_night_streak(list(reversed(docs))),
        sleep_hours=sleep_hours,
        body_battery=body_battery,
        data_date=data_date,
    )
