"""Per-week day overrides ("this week my long run is Sunday, not Saturday").

Stored in `session_moves`, keyed to the current plan version so a replan resets
them. The immutable plan document is never touched — moves are applied on read
(current plan, today's session, adherence). A move is day-level: everything on
the source day (a run + its strength addon) moves together.
"""

from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.plan import Plan, Weekday, session_order_key


class NoActivePlanError(Exception):
    pass


class SessionNotFoundError(Exception):
    pass


async def _current_doc(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        raise NoActivePlanError
    return doc


async def get_moves(
    db: AsyncIOMotorDatabase, user_id: str, plan_version: int
) -> dict[int, dict[str, str]]:
    """{week_index: {from_day: to_day}} for the given plan version."""
    out: dict[int, dict[str, str]] = {}
    async for m in db.session_moves.find({"user_id": user_id, "plan_version": plan_version}):
        out.setdefault(m["week_index"], {})[m["from_day"]] = m["to_day"]
    return out


def apply_moves(plan: Plan, moves: dict[int, dict[str, str]]) -> None:
    """Rewrite session days in place per the overrides (no-op when empty)."""
    if not moves:
        return
    for phase in plan.phases:
        for week in phase.weeks:
            week_moves = moves.get(week.index)
            if not week_moves:
                continue
            moved = False
            for session in week.sessions:
                target = week_moves.get(session.day.value)
                if target is not None:
                    session.day = Weekday(target)
                    moved = True
            # Days changed in place, so the model validator that normalises
            # order didn't re-run — re-sort or a moved session lands out of
            # calendar order for the rest of the request.
            if moved:
                week.sessions.sort(key=session_order_key)


async def move_session(
    db: AsyncIOMotorDatabase, user_id: str, week_index: int, from_day: Weekday, to_day: Weekday
) -> None:
    """Move whatever is on `from_day` (its currently-shown day) to `to_day` for
    this week. Moving back to the original day clears the override."""
    doc = await _current_doc(db, user_id)
    version = doc["version"]
    plan = Plan.model_validate(doc["plan"])
    week = next((w for phase in plan.phases for w in phase.weeks if w.index == week_index), None)
    if week is None:
        raise SessionNotFoundError

    existing = (await get_moves(db, user_id, version)).get(week_index, {})
    # `from_day` is the day currently shown; resolve the plan's original day.
    original = next((o for o, cur in existing.items() if cur == from_day.value), from_day.value)
    if not any(s.day.value == original for s in week.sessions):
        raise SessionNotFoundError

    key = {
        "user_id": user_id,
        "plan_version": version,
        "week_index": week_index,
        "from_day": original,
    }
    if to_day.value == original:
        await db.session_moves.delete_one(key)
    else:
        await db.session_moves.update_one(
            key,
            {"$set": {**key, "to_day": to_day.value, "moved_at": datetime.now(UTC)}},
            upsert=True,
        )
