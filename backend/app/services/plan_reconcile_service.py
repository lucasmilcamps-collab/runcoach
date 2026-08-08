"""Settling an elapsed week — no session left in limbo.

The problem this closes: an untouched session in a past week is not a neutral
gap. `plan_progress._make_run_done` returns False for it, which makes it a missed
key session, which feeds `_MISSED_KEY_TRIGGER` and the weekly review's verdict.
The athlete is being judged on something they never said. This is where they say
it — linked to an activity, or declared not done.

Nothing here invents a rule. Reading "was it done?" stays `plan_progress`'s job,
linking stays `plan_completion_service`'s, and declaring a session missed stays
`plan_moves_service.skip_session`. This module only decides *what is still
undecided*, and offers the two bulk actions that keep the block from becoming a
Monday-morning wall.
"""

from datetime import UTC, date, datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import ActivityResponse, SportType
from app.models.plan import WEEKDAY_ORDER, PendingSession, Plan, Session, WeekReconciliation
from app.services import plan_completion_service, plan_moves_service
from app.services.activity_service import _to_response
from app.services.plan_progress import _WINDOW_DAYS, _plan_start_date


def _session_date(start: date, week_index: int, session: Session) -> date:
    return start + timedelta(days=(week_index - 1) * 7 + WEEKDAY_ORDER.index(session.day))


def _is_settled(session: Session) -> bool:
    """Linked, or declared not done. Both are the athlete's own statement.

    A run the heuristic already counts as done is deliberately NOT settled: it is
    offered with its activity pre-filled instead, so one tap turns a guess into a
    fact. Only an explicit link gives the session its splits, its real pace and
    its drift — treating the heuristic as a decision would keep all of that out
    of reach while looking resolved.
    """
    return session.completed or session.skipped


async def _linked_activity_ids(db: AsyncIOMotorDatabase, user_id: str) -> set[str]:
    """Activities already standing for a session — never offer one twice."""
    return {
        doc["activity_id"]
        async for doc in db.session_completions.find(
            {"user_id": user_id, "activity_id": {"$ne": None}}, {"activity_id": 1}
        )
        if doc.get("activity_id")
    }


async def _suggest(
    db: AsyncIOMotorDatabase,
    user_id: str,
    session: Session,
    day: date,
    taken: set[str],
) -> ActivityResponse | None:
    """An activity recorded that day that could stand for this session.

    Same sport rule as `plan_completion_service.set_session_link`: a planned run
    only accepts a RUN activity. Offering a padel game for a long run would put a
    button on screen that answers 409 — the suggestion has to be tappable.
    """
    day_start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    query: dict = {
        "user_id": user_id,
        "start_time": {"$gte": day_start, "$lt": day_start + timedelta(days=1)},
    }
    if session.sport == SportType.RUN:
        query["sport"] = SportType.RUN.value
    # Longest first: on a day with a warm-up logged separately, the real session
    # is the long one.
    async for doc in db.activities.find(query).sort("duration_s", -1):
        if str(doc["_id"]) not in taken:
            return _to_response(doc)
    return None


async def pending(db: AsyncIOMotorDatabase, user_id: str) -> WeekReconciliation:
    """Sessions of already-elapsed weeks the athlete has not settled.

    Bounded to `_WINDOW_DAYS`, and that bound is the feature working rather than a
    shortcut: past the adherence window `_counts_in_window` ignores a session
    entirely, so settling it changes nothing. Asking anyway would mean fifteen
    decisions after three weeks away, for no effect on the plan.
    """
    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        # No plan is not an error, and must never block the app.
        return WeekReconciliation(has_pending=False)

    plan = Plan.model_validate(doc["plan"])
    await plan_moves_service.apply_overrides(db, user_id, plan, doc["version"])

    today = datetime.now(UTC).date()
    start = _plan_start_date(doc, today)
    window_start = today - timedelta(days=_WINDOW_DAYS)
    taken = await _linked_activity_ids(db, user_id)

    rows: list[PendingSession] = []
    weeks: list[int] = []
    for week in (w for phase in plan.phases for w in phase.weeks):
        # Fully elapsed only: the week under way is still being lived, and asking
        # about a Saturday session on Wednesday would report a miss nobody made.
        if start + timedelta(days=(week.index - 1) * 7 + 6) >= today:
            continue
        for session in week.sessions:
            if session.type == "rest" or _is_settled(session):
                continue
            day = _session_date(start, week.index, session)
            if day < window_start:
                continue
            rows.append(
                PendingSession(
                    week_index=week.index,
                    day=session.day,
                    slot=session.slot,
                    session_date=day,
                    type=session.type,
                    sport=session.sport,
                    duration_min=session.duration_min,
                    priority=session.priority,
                    suggested_activity=await _suggest(db, user_id, session, day, taken),
                )
            )
            if week.index not in weeks:
                weeks.append(week.index)

    return WeekReconciliation(has_pending=bool(rows), sessions=rows, week_indices=weeks)


async def confirm_all_suggested(db: AsyncIOMotorDatabase, user_id: str) -> int:
    """Link every pending session that came with a suggestion. Returns how many.

    Half of what makes the block acceptable: a week actually run settles in one
    tap instead of one per session.
    """
    queue = await pending(db, user_id)
    linked = 0
    for row in queue.sessions:
        if row.suggested_activity is None:
            continue
        try:
            await plan_completion_service.set_session_link(
                db, user_id, row.week_index, row.day, row.suggested_activity.id, row.slot
            )
        except (
            plan_completion_service.ActivityNotFoundError,
            plan_completion_service.SportMismatchError,
            plan_completion_service.NoActivePlanError,
        ):
            # One refused link must not abandon the rest of the week — and the
            # session simply stays pending, which is honest.
            continue
        linked += 1
    return linked


async def resolve_all_missed(db: AsyncIOMotorDatabase, user_id: str) -> int:
    """Declare every remaining pending session not done. Returns how many.

    The other half: a week that went badly settles in one tap. Reversible like
    any skip — the session stays in the plan, flagged.
    """
    queue = await pending(db, user_id)
    skipped = 0
    for row in queue.sessions:
        try:
            await plan_moves_service.skip_session(
                db, user_id, row.week_index, row.day, row.slot, True
            )
        except plan_moves_service.SessionNotFoundError:
            continue
        skipped += 1
    return skipped
