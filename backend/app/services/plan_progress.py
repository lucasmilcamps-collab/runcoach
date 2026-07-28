"""Plan adherence + replan trigger (Phase 4, step 2).

Compares the plan's recent KEY sessions (long run + quality) against what was
actually recorded in Garmin, and flags when a replan is warranted — the
structural triggers from the plan-generator skill: ≥2 key sessions missed, or
chronic high fatigue (TSB < −25). The replan itself reuses the generation
pipeline; this module decides *whether* to suggest it and feeds the adherence
summary into the prompt so the regenerated plan is realistic.
"""

from datetime import UTC, date, datetime, timedelta

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import SportType
from app.models.fitness import FitnessResponse
from app.models.plan import (
    WEEKDAY_ORDER,
    Plan,
    PlanProgress,
    Session,
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
    plan_moves_service.apply_moves(
        plan, await plan_moves_service.get_moves(db, user_id, doc["version"])
    )
    weeks = [week for phase in plan.phases for week in phase.weeks]
    start = _plan_start_date(doc, today)
    window_start = today - timedelta(days=_WINDOW_DAYS)

    # Dates with at least one recorded activity (any sport counts as "did it").
    activity_dates: set[date] = set()
    window_start_dt = datetime(window_start.year, window_start.month, window_start.day, tzinfo=UTC)
    cursor = db.activities.find({"user_id": user_id, "start_time": {"$gte": window_start_dt}})
    async for act in cursor:
        st = act.get("start_time")
        if st is not None:
            st_aware = st.replace(tzinfo=UTC) if st.tzinfo is None else st
            activity_dates.add(st_aware.astimezone(UTC).date())

    # Sessions the user explicitly linked to an activity — counts as done even
    # if the activity itself lands on a different day than planned.
    linked_dates: set[date] = set()
    async for comp in db.session_completions.find(
        {"user_id": user_id, "activity_id": {"$ne": None}}
    ):
        stored = comp.get("session_date")
        if isinstance(stored, str):
            try:
                linked_dates.add(date.fromisoformat(stored))
            except ValueError:
                pass

    planned = completed = 0
    for week_pos, week in enumerate(weeks):
        for session in week.sessions:
            if not _is_key_run(session):
                continue
            session_date = start + timedelta(days=week_pos * 7 + WEEKDAY_ORDER.index(session.day))
            if window_start <= session_date < today:  # only past days in the window
                planned += 1
                if session_date in activity_dates or session_date in linked_dates:
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
