"""Link a recorded activity to a planned session ("I did this one — here's the
Garmin activity"). Stored in `session_completions`, keyed by the plan session's
slot (week index + weekday). Complements the date-heuristic adherence in
plan_progress with an explicit, user-confirmed link.
"""

from datetime import UTC, datetime, timedelta

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.plan import WEEKDAY_ORDER, SessionLinkInfo, Weekday
from app.services.activity_service import _to_response
from app.services.plan_progress import _plan_start_date


class NoActivePlanError(Exception):
    pass


class ActivityNotFoundError(Exception):
    pass


async def _current_plan_doc(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        raise NoActivePlanError
    return doc


def _session_date(plan_doc: dict, week_index: int, day: Weekday):
    today = datetime.now(UTC).date()
    start = _plan_start_date(plan_doc, today)
    return start + timedelta(days=(week_index - 1) * 7 + WEEKDAY_ORDER.index(day))


async def _linked_activity(db: AsyncIOMotorDatabase, user_id: str, week_index: int, day: str):
    completion = await db.session_completions.find_one(
        {"user_id": user_id, "week_index": week_index, "day": day}
    )
    if completion is None or not completion.get("activity_id"):
        return None
    try:
        oid = ObjectId(completion["activity_id"])
    except (InvalidId, TypeError):
        return None
    act = await db.activities.find_one({"_id": oid, "user_id": user_id})
    return _to_response(act) if act is not None else None


async def get_session_link(
    db: AsyncIOMotorDatabase, user_id: str, week_index: int, day: Weekday
) -> SessionLinkInfo:
    plan_doc = await _current_plan_doc(db, user_id)
    return SessionLinkInfo(
        session_date=_session_date(plan_doc, week_index, day),
        linked=await _linked_activity(db, user_id, week_index, day),
    )


async def set_session_link(
    db: AsyncIOMotorDatabase, user_id: str, week_index: int, day: Weekday, activity_id: str | None
) -> SessionLinkInfo:
    plan_doc = await _current_plan_doc(db, user_id)
    session_date = _session_date(plan_doc, week_index, day)

    if activity_id is None:
        await db.session_completions.delete_one(
            {"user_id": user_id, "week_index": week_index, "day": day}
        )
        return SessionLinkInfo(session_date=session_date, linked=None)

    try:
        oid = ObjectId(activity_id)
    except (InvalidId, TypeError) as exc:
        raise ActivityNotFoundError from exc
    activity = await db.activities.find_one({"_id": oid, "user_id": user_id})
    if activity is None:
        raise ActivityNotFoundError

    await db.session_completions.update_one(
        {"user_id": user_id, "week_index": week_index, "day": day},
        {
            "$set": {
                "user_id": user_id,
                "week_index": week_index,
                "day": day,
                "session_date": session_date.isoformat(),
                "activity_id": activity_id,
                "linked_at": datetime.now(UTC),
            }
        },
        upsert=True,
    )
    return SessionLinkInfo(session_date=session_date, linked=_to_response(activity))
