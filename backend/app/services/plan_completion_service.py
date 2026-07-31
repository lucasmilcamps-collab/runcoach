"""Link a recorded activity to a planned session ("I did this one — here's the
Garmin activity"). Stored in `session_completions`, keyed by week index, weekday
AND slot. Complements the date-heuristic adherence in plan_progress with an
explicit, user-confirmed link.

The slot is part of the key, not decoration: a Tuesday can carry a key run
(primary) and a strength block (addon). Keyed on the day alone, linking an
activity to the strength block marked the run done, the missed-key trigger never
fired, and the athlete was told they were on track while they weren't.
"""

from datetime import UTC, datetime, timedelta
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import SportType
from app.models.plan import WEEKDAY_ORDER, Plan, SessionLinkInfo, Weekday
from app.services import plan_moves_service
from app.services.activity_service import _to_response
from app.services.plan_progress import _plan_start_date

Slot = Literal["primary", "addon"]


class NoActivePlanError(Exception):
    pass


class ActivityNotFoundError(Exception):
    pass


class SportMismatchError(Exception):
    """A non-run activity can't stand in for a planned run. Refused loudly:
    silently accepting it would mark a key run done and quietly disable the
    replan trigger, which is the exact failure this module is meant to catch."""

    def __init__(self, activity_sport: str) -> None:
        super().__init__(activity_sport)
        self.activity_sport = activity_sport


def _completion_filter(user_id: str, week_index: int, day: Weekday, slot: Slot) -> dict:
    """Match the completion for one session.

    MIGRATION: documents written before the slot existed have no `slot` field.
    Rather than a migration script, `primary` also matches a missing slot —
    Mongo treats null as matching an absent field — and any write heals the
    document by setting it. Chosen over a script because it needs no deploy-time
    step and no ordering guarantee: a link made before the upgrade keeps counting
    for the run it was always meant to be, which is what those documents are
    (the addon case is precisely what didn't work before)."""
    stored: object = {"$in": [slot, None]} if slot == "primary" else slot
    return {"user_id": user_id, "week_index": week_index, "day": day, "slot": stored}


async def _current_plan_doc(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        raise NoActivePlanError
    return doc


def _session_date(plan_doc: dict, week_index: int, day: Weekday):
    today = datetime.now(UTC).date()
    start = _plan_start_date(plan_doc, today)
    return start + timedelta(days=(week_index - 1) * 7 + WEEKDAY_ORDER.index(day))


async def _linked_activity(
    db: AsyncIOMotorDatabase, user_id: str, week_index: int, day: Weekday, slot: Slot
):
    completion = await db.session_completions.find_one(
        _completion_filter(user_id, week_index, day, slot)
    )
    if completion is None or not completion.get("activity_id"):
        return None
    try:
        oid = ObjectId(completion["activity_id"])
    except (InvalidId, TypeError):
        return None
    act = await db.activities.find_one({"_id": oid, "user_id": user_id})
    return _to_response(act) if act is not None else None


async def _planned_session(
    db: AsyncIOMotorDatabase,
    user_id: str,
    plan_doc: dict,
    day: Weekday,
    week_index: int,
    slot: Slot,
):
    """The session shown on that day and slot, overrides applied — None when the
    week or the slot doesn't exist (an old link, a deleted session)."""
    plan = Plan.model_validate(plan_doc["plan"])
    await plan_moves_service.apply_overrides(db, user_id, plan, plan_doc["version"])
    week = next((w for phase in plan.phases for w in phase.weeks if w.index == week_index), None)
    if week is None:
        return None
    return next((s for s in week.sessions if s.day == day and s.slot == slot), None)


async def get_session_link(
    db: AsyncIOMotorDatabase, user_id: str, week_index: int, day: Weekday, slot: Slot = "primary"
) -> SessionLinkInfo:
    plan_doc = await _current_plan_doc(db, user_id)
    return SessionLinkInfo(
        session_date=_session_date(plan_doc, week_index, day),
        linked=await _linked_activity(db, user_id, week_index, day, slot),
    )


async def set_session_link(
    db: AsyncIOMotorDatabase,
    user_id: str,
    week_index: int,
    day: Weekday,
    activity_id: str | None,
    slot: Slot = "primary",
) -> SessionLinkInfo:
    plan_doc = await _current_plan_doc(db, user_id)
    session_date = _session_date(plan_doc, week_index, day)

    if activity_id is None:
        await db.session_completions.delete_one(_completion_filter(user_id, week_index, day, slot))
        return SessionLinkInfo(session_date=session_date, linked=None)

    try:
        oid = ObjectId(activity_id)
    except (InvalidId, TypeError) as exc:
        raise ActivityNotFoundError from exc
    activity = await db.activities.find_one({"_id": oid, "user_id": user_id})
    if activity is None:
        raise ActivityNotFoundError

    session = await _planned_session(db, user_id, plan_doc, day, week_index, slot)
    if (
        session is not None
        and session.sport == SportType.RUN
        and activity.get("sport") != SportType.RUN
    ):
        raise SportMismatchError(str(activity.get("sport") or "?"))

    key = _completion_filter(user_id, week_index, day, slot)
    await db.session_completions.update_one(
        key,
        {
            "$set": {
                "user_id": user_id,
                "week_index": week_index,
                "day": day,
                "slot": slot,
                "session_date": session_date.isoformat(),
                "activity_id": activity_id,
                "linked_at": datetime.now(UTC),
            }
        },
        upsert=True,
    )
    return SessionLinkInfo(session_date=session_date, linked=_to_response(activity))
