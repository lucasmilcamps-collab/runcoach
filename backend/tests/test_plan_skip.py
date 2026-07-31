"""Skipping a session — the declaration the key/optional split was built for.

Deleting a run is refused (it would silently break the plan's guaranteed run
count). Skipping one is allowed: it says "not this week" without pretending the
plan changed, and it is reversible.
"""

from datetime import UTC, datetime, timedelta

from app.models.activity import SportType
from app.models.plan import WEEKDAY_ORDER, Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_moves_service, plan_progress, plan_service


def _s(day: Weekday, stype: str, priority: str = "key") -> Session:
    return Session(
        day=day,
        sport=SportType.RUN,
        type=stype,
        duration_min=50,
        priority=priority,
        rationale="x",
    )


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def _seed_plan(db, user_id: str, version: int = 1):
    """Two weeks, so the fixture is the same whatever day the suite runs on.

    Week 1 is last week and holds one key run on Monday — always in the past, so
    it is missed on its own merits and forms the baseline. Week 2 is the current
    week with a key run TODAY (the case a skip must register without waiting for
    the day to pass) and an optional run on Monday.
    """
    today = datetime.now(UTC).date()
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(days=7)
    today_weekday = WEEKDAY_ORDER[today.weekday()]

    week1 = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[_s(Weekday.MONDAY, "long_run")],
    )
    week2_sessions = [_s(today_weekday, "tempo")]
    if today_weekday is not Weekday.MONDAY:
        week2_sessions.append(_s(Weekday.MONDAY, "easy", priority="optional"))
    week2 = Week(index=2, is_deload=False, target_load=105.0, sessions=week2_sessions)

    plan = Plan(
        goal=PlanGoal(description="Test"),
        phases=[Phase(name="base", weeks=[week1, week2])],
    )
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": version,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )
    return start, today_weekday


async def test_skipping_an_optional_session_costs_nothing(db):
    """That is what optional means: dropping it on a busy week is free."""
    user_id = await _seed_user(db)
    _, today_weekday = await _seed_plan(db, user_id)
    if today_weekday is Weekday.MONDAY:
        return  # no separate optional session in the fixture today
    before = await plan_progress.compute_progress(db, user_id)

    await plan_moves_service.skip_session(db, user_id, 2, Weekday.MONDAY, "primary")

    after = await plan_progress.compute_progress(db, user_id)
    assert after.recent_key_planned == before.recent_key_planned
    assert after.recent_key_missed == before.recent_key_missed


async def test_skipping_a_key_session_counts_missed_the_same_day(db):
    """Without this, a skip declared in the morning changed nothing until the
    next day — the athlete told the app something and the app ignored it."""
    user_id = await _seed_user(db)
    _, today_weekday = await _seed_plan(db, user_id)
    before = await plan_progress.compute_progress(db, user_id)

    await plan_moves_service.skip_session(db, user_id, 2, today_weekday, "primary")

    after = await plan_progress.compute_progress(db, user_id)
    # Today's session had not been counted at all — its day hasn't passed.
    assert after.recent_key_planned == before.recent_key_planned + 1
    assert after.recent_key_missed == before.recent_key_missed + 1


async def test_two_skipped_key_sessions_suggest_a_replan(db):
    user_id = await _seed_user(db)
    _, today_weekday = await _seed_plan(db, user_id)

    await plan_moves_service.skip_session(db, user_id, 1, Weekday.MONDAY, "primary")
    await plan_moves_service.skip_session(db, user_id, 2, today_weekday, "primary")

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.recent_key_missed == 2
    assert progress.replan_suggested is True
    assert progress.replan_reason is not None

    # …suggested, never done: the plan on file is untouched.
    stored = await db.plans.find_one({"user_id": user_id, "version": 1})
    assert stored["status"] == "ready"
    assert await db.plans.count_documents({"user_id": user_id}) == 1


async def test_skip_is_reversible(db):
    user_id = await _seed_user(db)
    _, today_weekday = await _seed_plan(db, user_id)
    before = (await plan_progress.compute_progress(db, user_id)).recent_key_missed

    await plan_moves_service.skip_session(db, user_id, 2, today_weekday, "primary")
    assert (await plan_progress.compute_progress(db, user_id)).recent_key_missed == before + 1

    await plan_moves_service.skip_session(db, user_id, 2, today_weekday, "primary", skipped=False)
    assert (await plan_progress.compute_progress(db, user_id)).recent_key_missed == before


async def test_a_skipped_session_stays_in_the_plan_flagged(db):
    """Skipping is not deleting: the session remains visible, marked."""
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)
    await plan_moves_service.skip_session(db, user_id, 1, Weekday.MONDAY, "primary")

    plan = await plan_service.get_current_plan(db, user_id)
    week1 = plan.plan.phases[0].weeks[0]
    monday = next(s for s in week1.sessions if s.day == Weekday.MONDAY)
    assert monday.skipped is True
    all_sessions = [s for w in plan.plan.phases[0].weeks for s in w.sessions]
    assert sum(1 for s in all_sessions if s.skipped) == 1


async def test_a_run_can_be_skipped_even_though_it_cannot_be_deleted(db):
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)

    # Deleting a run is a replan decision…
    try:
        await plan_moves_service.delete_session(db, user_id, 1, Weekday.MONDAY, "primary")
        raise AssertionError("deleting a run should be refused")
    except plan_moves_service.CannotDeleteRunError:
        pass

    # …skipping it for the week is not.
    await plan_moves_service.skip_session(db, user_id, 1, Weekday.MONDAY, "primary")
    plan = await plan_service.get_current_plan(db, user_id)
    week1 = plan.plan.phases[0].weeks[0]
    assert any(s.day == Weekday.MONDAY and s.skipped for s in week1.sessions)


async def test_a_replan_clears_the_skips(db):
    """Skips are per-week overrides tied to a plan version, like every other
    override: a regenerated plan starts clean."""
    user_id = await _seed_user(db)
    _, today_weekday = await _seed_plan(db, user_id, version=1)
    before = (await plan_progress.compute_progress(db, user_id)).recent_key_missed
    await plan_moves_service.skip_session(db, user_id, 2, today_weekday, "primary")
    assert (await plan_progress.compute_progress(db, user_id)).recent_key_missed == before + 1

    await _seed_plan(db, user_id, version=2)  # the replan

    assert (await plan_progress.compute_progress(db, user_id)).recent_key_missed == before
    plan = await plan_service.get_current_plan(db, user_id)
    assert not any(s.skipped for w in plan.plan.phases[0].weeks for s in w.sessions)


def test_skipped_is_not_part_of_the_ai_contract():
    """`skipped` is a user override applied on read. In the tool schema it would
    invite the model to hand back sessions already marked skipped."""
    session_schema = plan_service._PLAN_TOOL["input_schema"]["$defs"]["Session"]
    assert "skipped" not in session_schema["properties"]
    assert "priority" in session_schema["properties"]  # the rest is untouched
