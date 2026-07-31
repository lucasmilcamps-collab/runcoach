"""Plan adherence + replan trigger (Phase 4, step 2).

Compares the plan's recent KEY sessions (long run + quality) against what was
actually recorded in Garmin, and flags when a replan is warranted — the
structural triggers from the plan-generator skill: ≥2 key sessions missed, or
chronic high fatigue (TSB < −25). The replan itself reuses the generation
pipeline; this module decides *whether* to suggest it and feeds the adherence
summary into the prompt so the regenerated plan is realistic.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import SportType
from app.models.fitness import FitnessResponse
from app.models.plan import (
    WEEKDAY_ORDER,
    Plan,
    PlanOverview,
    PlanProgress,
    Session,
    WeekAdherence,
)
from app.services import fitness_service, plan_moves_service


def _is_key_run(session: Session) -> bool:
    """A key run session — the ones that drive adherence and the replan trigger.
    Read straight from the model's `priority` now that it exists (was inferred)."""
    return (
        session.priority == "key" and session.slot == "primary" and session.sport == SportType.RUN
    )


_WINDOW_DAYS = 14
_MISSED_KEY_TRIGGER = 2
_CHRONIC_FATIGUE_TSB = -25.0


def _plan_start_date(doc: dict, today: date) -> date:
    stored = doc.get("start_date")
    if isinstance(stored, str):
        try:
            return date.fromisoformat(stored)
        except ValueError:
            pass
    created = doc.get("created_at")
    base = created.date() if created is not None else today
    return base - timedelta(days=base.weekday())


async def _load_run_days(db: AsyncIOMotorDatabase, user_id: str, since: date) -> dict[date, float]:
    """Longest RUN, in minutes, per day since `since`.

    A key RUN session is only "done" by a RUN activity of sufficient duration —
    a padel game the same day doesn't validate a long run (Lot 6.2) — and only
    the longest run of a day counts toward the 60%-of-planned check.
    """
    since_dt = datetime(since.year, since.month, since.day, tzinfo=UTC)
    run_minutes_by_date: dict[date, float] = {}
    cursor = db.activities.find(
        {"user_id": user_id, "sport": SportType.RUN, "start_time": {"$gte": since_dt}}
    )
    async for act in cursor:
        st = act.get("start_time")
        if st is None:
            continue
        st_aware = st.replace(tzinfo=UTC) if st.tzinfo is None else st
        day = st_aware.astimezone(UTC).date()
        minutes = (act.get("duration_s") or 0) / 60
        run_minutes_by_date[day] = max(run_minutes_by_date.get(day, 0.0), minutes)
    return run_minutes_by_date


async def _load_linked_dates(db: AsyncIOMotorDatabase, user_id: str) -> set[tuple[date, str]]:
    """Sessions the athlete explicitly linked to an activity, as (date, slot) —
    those count as done even when the activity lands on a different day than
    planned.

    The slot has to come along: a day can hold a key run and a strength addon,
    and a link on the addon says nothing about the run. Documents written before
    the slot existed default to `primary`, which is what they were."""
    linked: set[tuple[date, str]] = set()
    async for comp in db.session_completions.find(
        {"user_id": user_id, "activity_id": {"$ne": None}}
    ):
        stored = comp.get("session_date")
        if isinstance(stored, str):
            try:
                linked.add((date.fromisoformat(stored), comp.get("slot") or "primary"))
            except ValueError:
                pass
    return linked


def _make_run_done(
    run_minutes_by_date: dict[date, float], linked: set[tuple[date, str]]
) -> Callable[[date, int], bool]:
    """The one rule for "was this planned run actually done?".

    Shared by the replan trigger and the per-week adherence read-out: two copies
    of this would drift, and the day they disagree the app tells the athlete two
    different things about the same session.
    """

    def _run_done(session_date: date, planned_min: int) -> bool:
        # Only a link on the PRIMARY slot validates a run — every caller here
        # filters on `_is_key_run`, which is primary by definition.
        if (session_date, "primary") in linked:
            return True
        done_min = run_minutes_by_date.get(session_date)
        return done_min is not None and done_min >= 0.6 * planned_min

    return _run_done


def _counts_in_window(
    session: Session, session_date: date, window_start: date, today: date
) -> bool:
    """Whether a key session belongs in the adherence numbers yet.

    Normally a session only counts once its day has passed — judging a run at
    08:00 on the day it's planned would report a miss the athlete hasn't made.
    A skip is different: it's a decision, already taken, so it counts from the
    day it applies to rather than the day after. A skip dated further ahead
    still waits for its day — the two-week window is about recent history, and
    letting a skip three weeks out fire the replan trigger today would suggest
    replanning a plan the athlete hasn't started living yet.
    """
    if session_date < window_start:
        return False
    return session_date <= today if session.skipped else session_date < today


async def compute_overview(
    db: AsyncIOMotorDatabase, user_id: str, version: int
) -> PlanOverview | None:
    """Week-by-week adherence for one stored plan version.

    Unlike `compute_progress`, which looks at a rolling 14-day window to decide
    whether to suggest a replan, this covers the whole plan — it answers "did I
    follow this plan?", including for a version that is no longer active.
    Returns None when the version doesn't exist.
    """
    today = datetime.now(UTC).date()
    doc = await db.plans.find_one(
        {
            "user_id": user_id,
            "version": version,
            "status": {"$in": ["ready", "cancelled"]},
        }
    )
    if doc is None or not doc.get("plan"):
        return None

    plan = Plan.model_validate(doc["plan"])
    # Per-week overrides only exist for the active plan; applying them to a
    # retired version would report weeks it never actually had.
    if doc.get("status") == "ready":
        await plan_moves_service.apply_overrides(db, user_id, plan, version)
    weeks = [week for phase in plan.phases for week in phase.weeks]
    start = _plan_start_date(doc, today)

    run_minutes_by_date = await _load_run_days(db, user_id, start)
    linked_dates = await _load_linked_dates(db, user_id)
    _run_done = _make_run_done(run_minutes_by_date, linked_dates)

    week_pos_today = (today - start).days // 7
    rows: list[WeekAdherence] = []
    total_planned = total_completed = 0

    for week_pos, week in enumerate(weeks):
        week_start = start + timedelta(days=week_pos * 7)
        is_past = week_start + timedelta(days=7) <= today
        planned = completed = 0
        for session in week.sessions:
            if not _is_key_run(session):
                continue
            planned += 1
            session_date = week_start + timedelta(days=WEEKDAY_ORDER.index(session.day))
            if (
                not session.skipped
                and session_date < today
                and _run_done(session_date, session.duration_min)
            ):
                completed += 1
        rows.append(
            WeekAdherence(
                week_index=week.index,
                planned=planned,
                completed=completed,
                is_deload=week.is_deload,
                is_past=is_past,
                is_current=week_pos == week_pos_today,
            )
        )
        if is_past:
            total_planned += planned
            total_completed += completed

    return PlanOverview(
        version=version,
        start_date=start,
        # Inclusive: the last day of the last week, not the Monday after it.
        end_date=start + timedelta(days=len(weeks) * 7 - 1),
        week_current=(week_pos_today + 1 if 0 <= week_pos_today < len(weeks) else None),
        weeks_total=len(weeks),
        planned=total_planned,
        completed=total_completed,
        weeks=rows,
    )


async def compute_progress(
    db: AsyncIOMotorDatabase, user_id: str, fitness: FitnessResponse | None = None
) -> PlanProgress:
    today = datetime.now(UTC).date()
    if fitness is None:
        fitness = await fitness_service.compute_fitness(db, user_id)
    tsb = fitness.tsb

    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        return PlanProgress(has_plan=False, tsb=tsb)

    plan = Plan.model_validate(doc["plan"])
    await plan_moves_service.apply_overrides(db, user_id, plan, doc["version"])
    weeks = [week for phase in plan.phases for week in phase.weeks]
    start = _plan_start_date(doc, today)
    window_start = today - timedelta(days=_WINDOW_DAYS)

    run_minutes_by_date = await _load_run_days(db, user_id, window_start)
    linked_dates = await _load_linked_dates(db, user_id)
    _run_done = _make_run_done(run_minutes_by_date, linked_dates)

    planned = completed = 0
    for week_pos, week in enumerate(weeks):
        for session in week.sessions:
            if not _is_key_run(session):
                continue
            session_date = start + timedelta(days=week_pos * 7 + WEEKDAY_ORDER.index(session.day))
            if not _counts_in_window(session, session_date, window_start, today):
                continue
            planned += 1
            # A declared skip is a miss by definition — no activity can redeem
            # it, and it needn't wait for the day to pass.
            if not session.skipped and _run_done(session_date, session.duration_min):
                completed += 1
    missed = planned - completed

    week_pos_today = (today - start).days // 7
    week_current = week_pos_today + 1 if 0 <= week_pos_today < len(weeks) else None

    replan_suggested = missed >= _MISSED_KEY_TRIGGER or tsb < _CHRONIC_FATIGUE_TSB
    reason: str | None = None
    if missed >= _MISSED_KEY_TRIGGER:
        reason = f"{missed} séances clés manquées sur les 2 dernières semaines."
    elif tsb < _CHRONIC_FATIGUE_TSB:
        reason = f"Fatigue élevée persistante (TSB {tsb:+.0f})."

    # A completed assessment ("test") session is fresh performance data — suggest
    # regenerating so the plan re-anchors on the measured level (Lot 5 loop).
    for week_pos, week in enumerate(weeks):
        for session in week.sessions:
            if session.type != "test":
                continue
            test_date = start + timedelta(days=week_pos * 7 + WEEKDAY_ORDER.index(session.day))
            if test_date < today and (
                test_date in run_minutes_by_date or (test_date, session.slot) in linked_dates
            ):
                replan_suggested = True
                reason = "Séance de test réalisée — réestime ton chrono et réajuste le plan."

    return PlanProgress(
        has_plan=True,
        week_current=week_current,
        weeks_total=len(weeks),
        recent_key_planned=planned,
        recent_key_completed=completed,
        recent_key_missed=missed,
        tsb=tsb,
        replan_suggested=replan_suggested,
        replan_reason=reason,
    )
