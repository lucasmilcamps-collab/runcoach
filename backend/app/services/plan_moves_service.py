"""Per-week overrides on the current plan — "this week my long run is Sunday",
"this week the basket session is off", "make it 40 min instead of 60".

Two collections, both keyed to the current plan version so a replan resets them:
`session_moves` (day changes) and `session_edits` (duration changes and
deletions). The immutable plan document is never touched — overrides are
applied on read.

A move is day-level: everything on the source day (a run plus its strength
addon) moves together. An edit is session-level, keyed by the session's
*original* day and slot, so it survives a move of the same session.
"""

from datetime import UTC, datetime
from typing import Literal

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import SportType
from app.models.plan import Plan, Session, Weekday, session_order_key


class NoActivePlanError(Exception):
    pass


class SessionNotFoundError(Exception):
    pass


class CannotDeleteRunError(Exception):
    """Deleting a run would break the plan's guaranteed run count — that's a
    replan decision, not a per-week tweak."""


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


async def get_edits(
    db: AsyncIOMotorDatabase, user_id: str, plan_version: int
) -> dict[int, dict[tuple[str, str], dict]]:
    """{week_index: {(original_day, slot): edit}} for the given plan version."""
    out: dict[int, dict[tuple[str, str], dict]] = {}
    async for e in db.session_edits.find({"user_id": user_id, "plan_version": plan_version}):
        out.setdefault(e["week_index"], {})[(e["day"], e["slot"])] = e
    return out


def apply_edits(plan: Plan, edits: dict[int, dict[tuple[str, str], dict]]) -> None:
    """Drop deleted sessions and rewrite durations, in place (no-op when empty)."""
    if not edits:
        return
    for phase in plan.phases:
        for week in phase.weeks:
            week_edits = edits.get(week.index)
            if not week_edits:
                continue
            kept: list[Session] = []
            for session in week.sessions:
                edit = week_edits.get((session.day.value, session.slot))
                if edit is None:
                    kept.append(session)
                    continue
                if edit.get("deleted"):
                    continue
                duration = edit.get("duration_min")
                if duration:
                    session.duration_min = duration
                # A skip keeps the session in the plan, flagged. Deleting it
                # would hide the very decision the athlete wants to see.
                session.skipped = bool(edit.get("skipped"))
                kept.append(session)
            week.sessions = kept


async def apply_overrides(
    db: AsyncIOMotorDatabase, user_id: str, plan: Plan, plan_version: int
) -> None:
    """Apply every per-week override to `plan`, in place.

    The single entry point on purpose: fetching and applying each kind at every
    read site meant four copies of the same two lines, and a new override type
    only had to be forgotten in one of them to make a screen disagree with the
    rest of the app.

    Edits run first — they're keyed on the plan's original days, which a move
    would have already rewritten.
    """
    apply_edits(plan, await get_edits(db, user_id, plan_version))
    apply_moves(plan, await get_moves(db, user_id, plan_version))


def _find_session(week, day: Weekday, slot: str, existing_moves: dict[str, str]) -> Session | None:
    """The session shown on `day` in `slot`, resolved back to its original day
    when a move is already in effect."""
    original = next((o for o, cur in existing_moves.items() if cur == day.value), day.value)
    return next(
        (s for s in week.sessions if s.day.value == original and s.slot == slot),
        None,
    )


async def _edit_session(
    db: AsyncIOMotorDatabase,
    user_id: str,
    week_index: int,
    day: Weekday,
    slot: str,
    change: dict,
) -> None:
    doc = await _current_doc(db, user_id)
    version = doc["version"]
    plan = Plan.model_validate(doc["plan"])
    week = next((w for phase in plan.phases for w in phase.weeks if w.index == week_index), None)
    if week is None:
        raise SessionNotFoundError

    moves = (await get_moves(db, user_id, version)).get(week_index, {})
    session = _find_session(week, day, slot, moves)
    if session is None:
        raise SessionNotFoundError
    if change.get("deleted") and session.sport == SportType.RUN:
        raise CannotDeleteRunError

    key = {
        "user_id": user_id,
        "plan_version": version,
        "week_index": week_index,
        "day": session.day.value,  # always the plan's original day
        "slot": slot,
    }
    await db.session_edits.update_one(
        key, {"$set": {**key, **change, "edited_at": datetime.now(UTC)}}, upsert=True
    )


async def set_session_duration(
    db: AsyncIOMotorDatabase,
    user_id: str,
    week_index: int,
    day: Weekday,
    slot: Literal["primary", "addon"],
    duration_min: int,
) -> None:
    """Change a session's duration for this week only."""
    await _edit_session(db, user_id, week_index, day, slot, {"duration_min": duration_min})


async def delete_session(
    db: AsyncIOMotorDatabase,
    user_id: str,
    week_index: int,
    day: Weekday,
    slot: Literal["primary", "addon"],
) -> None:
    """Drop a non-run session for this week only. Raises CannotDeleteRunError
    for a run: the plan guarantees a run count, so removing one is a replan."""
    await _edit_session(db, user_id, week_index, day, slot, {"deleted": True})


async def skip_session(
    db: AsyncIOMotorDatabase,
    user_id: str,
    week_index: int,
    day: Weekday,
    slot: Literal["primary", "addon"],
    skipped: bool = True,
) -> None:
    """Declare a session skipped for this week only — reversible, and allowed on
    runs, unlike deletion.

    The distinction is the point. Deleting a run is refused because it silently
    breaks the plan's guaranteed run count; skipping one says "not this week"
    without pretending the plan changed. On a key session that makes the miss
    count immediately (it feeds the replan trigger); on an optional one it costs
    nothing, which is what optional was for. It never regenerates anything —
    the suggestion is the athlete's to act on."""
    await _edit_session(db, user_id, week_index, day, slot, {"skipped": skipped})


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


async def copy_overrides(
    db: AsyncIOMotorDatabase, user_id: str, from_version: int, to_version: int
) -> None:
    """Carry a version's per-week overrides onto another version.

    Used by a plan restore. Overrides are keyed by `plan_version`, so a restored
    plan would otherwise come back stripped of every move and duration edit the
    athlete had made against it — the plan restored, the week not.

    The `_id` is dropped so each copy is a new document; everything else is
    carried verbatim, since the two versions describe the same weeks.
    """
    for collection in (db.session_moves, db.session_edits):
        cursor = collection.find({"user_id": user_id, "plan_version": from_version})
        docs = [doc async for doc in cursor]
        if not docs:
            continue
        for doc in docs:
            doc.pop("_id", None)
            doc["plan_version"] = to_version
        await collection.insert_many(docs)
