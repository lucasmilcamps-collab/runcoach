"""Partial replanning: keep what has been run, regenerate the rest.

The difference from a full regeneration is the whole point. Regenerating rebuilt
the plan from week 1 on today's grid, so an athlete who had just run and linked a
session lost the week they ran it in. A partial replan freezes the weeks through
the one under way, on their ORIGINAL dates, and only rebuilds what is left.

Two things carry that guarantee and are tested hardest: the start date never
moves (which is what keeps links pointing at the sessions they were made
against), and the seam is validated like any other week transition (so the first
new week cannot jump off the back of a week that was never actually run).
"""

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, PlanRequest, Session, Week, Weekday
from app.services import plan_moves_service, plan_service


def _s(day: Weekday, stype: str, duration: int = 45) -> Session:
    return Session(day=day, sport=SportType.RUN, type=stype, duration_min=duration, rationale="x")


def _week(index: int, load: float, deload: bool = False) -> Week:
    return Week(
        index=index,
        is_deload=deload,
        target_load=load,
        sessions=[_s(Weekday.TUESDAY, "tempo"), _s(Weekday.SATURDAY, "long_run", 60)],
    )


def _plan(indices_and_loads) -> Plan:
    weeks = [_week(i, load, deload) for i, load, deload in indices_and_loads]
    return Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=weeks)],
    )


_REQUEST = {
    "goal_type": "distance",
    "distance_km": 21.1,
    "available_days": ["TUESDAY", "SATURDAY"],
    "min_run_sessions_per_week": 1,
    "max_run_sessions_per_week": 2,
}


def _monday(offset_weeks: int = 0) -> date:
    today = datetime.now(UTC).date()
    return today - timedelta(days=today.weekday()) + timedelta(weeks=offset_weeks)


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "replan@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def _seed_plan(db, user_id: str, plan: Plan, start: date, version: int = 1) -> None:
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": version,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "request": _REQUEST,
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )


def _mock_response(plan_dict: dict):
    block = SimpleNamespace(type="tool_use", id="toolu_1", name="submit_plan", input=plan_dict)
    return SimpleNamespace(stop_reason="tool_use", content=[block])


async def _drain_jobs() -> None:
    """Let the queued generation task finish — POST returns a job, not a plan."""
    import asyncio

    while plan_service._RUNNING_JOBS:
        await asyncio.gather(*list(plan_service._RUNNING_JOBS))


def _patched_client(*responses):
    client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(side_effect=list(responses)))
    )
    return patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=client)


# --- Where the cut falls ------------------------------------------------------


async def test_freezes_through_the_week_under_way(db):
    """A week the athlete has started is a week they are running — cutting
    mid-week would rebuild the days left while orphaning the ones done."""
    user_id = await _seed_user(db)
    # Plan started two weeks ago, so today sits in week 3 of 6.
    await _seed_plan(
        db,
        user_id,
        _plan([(i, 100.0 + i, False) for i in range(1, 7)]),
        start=_monday(-2),
    )

    base = await plan_service.build_replan_base(db, user_id)

    assert base.last_week == 3  # weeks 1-3 frozen, 4-6 to regenerate
    assert base.total_weeks == 6
    assert [w.index for p in base.phases for w in p.weeks] == [1, 2, 3]


async def test_start_date_never_moves(db):
    """The load-bearing guarantee: the week grid stays put, so a session run in
    week 3 stays in week 3 and its link still describes it."""
    user_id = await _seed_user(db)
    original_start = _monday(-2)
    await _seed_plan(db, user_id, _plan([(i, 100.0, False) for i in range(1, 6)]), original_start)

    base = await plan_service.build_replan_base(db, user_id)

    assert base.start == original_start


async def test_refuses_when_nothing_is_left(db):
    """Rebuilding the current week is exactly what this path exists to avoid, so
    a plan ending this week has nothing to offer — say so rather than silently
    regenerating it."""
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id, _plan([(1, 100.0, False), (2, 105.0, False)]), _monday(-1))

    with pytest.raises(plan_service.NothingLeftToReplanError):
        await plan_service.build_replan_base(db, user_id)


async def test_no_active_plan_raises(db):
    user_id = await _seed_user(db)
    with pytest.raises(plan_service.NoActivePlanError):
        await plan_service.build_replan_base(db, user_id)


async def test_frozen_weeks_carry_the_athletes_overrides(db):
    """Freeze the plan the athlete has been LOOKING AT, not the pristine
    generated one — otherwise a replan silently undoes every session they moved."""
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id, _plan([(i, 100.0, False) for i in range(1, 6)]), _monday(-2))
    await plan_moves_service.move_session(db, user_id, 1, Weekday.TUESDAY, Weekday.THURSDAY)

    base = await plan_service.build_replan_base(db, user_id)

    week1 = base.phases[0].weeks[0]
    assert any(s.day == Weekday.THURSDAY for s in week1.sessions)


# --- Splicing -----------------------------------------------------------------


def test_splice_renumbers_the_tail_continuously():
    """The model is told to number from last_week+1 and mostly does, but a plan
    whose weeks don't run 1..N breaks every reader that counts weeks from the
    start date."""
    base = plan_service.ReplanBase(
        start=_monday(),
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(1, 100.0), _week(2, 105.0)])],
        last_week=2,
        total_weeks=4,
    )
    # A tail that numbered itself 1, 2 instead of 3, 4.
    tail = _plan([(1, 110.0, False), (2, 80.0, True)])

    spliced = plan_service._splice(base, tail)

    assert [w.index for p in spliced.phases for w in p.weeks] == [1, 2, 3, 4]


def test_splice_merges_a_phase_split_across_the_seam():
    """Two adjacent `base` phases would read as a restart rather than a
    continuation."""
    base = plan_service.ReplanBase(
        start=_monday(),
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(1, 100.0)])],
        last_week=1,
        total_weeks=3,
    )
    tail = Plan(
        goal=PlanGoal(description="autre"),
        phases=[
            Phase(name="base", weeks=[_week(1, 105.0)]),
            Phase(name="build", weeks=[_week(2, 110.0)]),
        ],
    )

    spliced = plan_service._splice(base, tail)

    assert [p.name for p in spliced.phases] == ["base", "build"]
    assert [w.index for w in spliced.phases[0].weeks] == [1, 2]


def test_splice_keeps_the_athletes_goal_not_the_models():
    """A partial replan adjusts how you get somewhere; it does not redefine
    where you are going."""
    base = plan_service.ReplanBase(
        start=_monday(),
        goal=PlanGoal(description="Semi de Paris", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(1, 100.0)])],
        last_week=1,
        total_weeks=2,
    )
    tail = Plan(
        goal=PlanGoal(description="objectif inventé"),
        phases=[Phase(name="base", weeks=[_week(1, 105.0)])],
    )

    spliced = plan_service._splice(base, tail)

    assert spliced.goal.description == "Semi de Paris"


def test_freeze_through_truncates_a_phase_at_the_cut():
    """The cut usually falls mid-phase; carrying the whole phase would freeze
    weeks the athlete hasn't reached."""
    plan = Plan(
        goal=PlanGoal(description="Semi"),
        phases=[
            Phase(name="base", weeks=[_week(1, 100.0), _week(2, 105.0), _week(3, 110.0)]),
            Phase(name="build", weeks=[_week(4, 115.0)]),
        ],
    )

    phases = plan_service._freeze_through(plan, 2)

    assert [p.name for p in phases] == ["base"]  # the build phase is entirely ahead
    assert [w.index for w in phases[0].weeks] == [1, 2]


# --- The seam is validated ----------------------------------------------------


async def test_the_seam_is_checked_against_the_real_last_week(db):
    """The reason splicing happens BEFORE validation: the first new week is
    compared against the athlete's real last week, not against nothing."""
    from app.services import plan_validation

    base = plan_service.ReplanBase(
        start=_monday(-2),
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(1, 100.0), _week(2, 105.0)])],
        last_week=2,
        total_weeks=4,
    )
    # Week 3 jumps +30% off week 2 — a full regeneration would never see this,
    # because it would have rebuilt week 2 too.
    tail = _plan([(3, 137.0, False), (4, 90.0, True)])
    spliced = plan_service._splice(base, tail)

    violations = plan_validation.validate_plan(
        spliced, PlanRequest.model_validate(_REQUEST), base.start, None, frozen_through=2
    )

    assert any("Semaine 3" in v and "charge" in v for v in violations)


def test_initial_load_anchors_on_the_first_new_week_not_week_one():
    """Week 1's join to reality was validated weeks ago and nobody can change it
    now. Re-checking it against today's load would fail precisely when the
    athlete detrained — which is when replanning matters most."""
    from app.services import plan_validation

    plan = _plan([(1, 200.0, False), (2, 100.0, False), (3, 100.0, False)])
    request = PlanRequest.model_validate(_REQUEST)
    context = {"avg_weekly_load_4w": 100.0}

    # Full generation: week 1 at 200 vs a real load of 100 is a violation.
    full = plan_validation.validate_plan(plan, request, _monday(), context)
    assert any("Semaine 1" in v for v in full)

    # Partial replan with weeks 1-2 frozen: week 1 is nobody's fault any more,
    # and week 3 (the first new one) sits at the real load.
    partial = plan_validation.validate_plan(plan, request, _monday(), context, frozen_through=2)
    assert not any("au-dessus de la charge réelle" in v for v in partial)


# --- End to end ---------------------------------------------------------------


async def test_replan_keeps_the_frozen_weeks_verbatim(db):
    """The whole promise, end to end: what was run comes back untouched."""
    user_id = await _seed_user(db)
    start = _monday(-2)
    original = _plan([(1, 100.0, False), (2, 105.0, False), (3, 110.0, False), (4, 80.0, True)])
    await _seed_plan(db, user_id, original, start)

    # The model returns only the tail — week 4, numbered as asked.
    tail = _plan([(4, 80.0, True)])
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(tail.model_dump(mode="json"))),
    ):
        base = await plan_service.build_replan_base(db, user_id)
        result = await plan_service.generate_plan(
            db, user_id, PlanRequest.model_validate(_REQUEST), base=base
        )

    assert result.status == "ready", result.error_message
    weeks = [w for p in result.plan.phases for w in p.weeks]
    assert [w.index for w in weeks] == [1, 2, 3, 4]
    # Frozen weeks came through unchanged.
    assert [w.target_load for w in weeks[:3]] == [100.0, 105.0, 110.0]

    stored = await db.plans.find_one({"user_id": user_id, "version": 2})
    assert stored["start_date"] == start.isoformat()  # the grid never moved


async def test_replan_endpoint_needs_no_body_and_reuses_the_objective(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    me = await db.users.find_one({"email": "a@b.com"})
    user_id = str(me["_id"])
    await _seed_plan(db, user_id, _plan([(i, 100.0, False) for i in range(1, 6)]), _monday(-1))

    tail = _plan([(i, 100.0, False) for i in range(3, 6)])
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(tail.model_dump(mode="json"))),
    ):
        response = await client.post("/api/v1/plans/replan", headers=headers)

    assert response.status_code == 202
    assert response.json()["type"] == "plan_generation"


async def test_replan_endpoint_without_a_plan_is_404(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    response = await client.post(
        "/api/v1/plans/replan", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 404


async def test_replan_endpoint_on_a_finishing_plan_is_409(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    me = await db.users.find_one({"email": "a@b.com"})
    await _seed_plan(db, str(me["_id"]), _plan([(1, 100.0, False)]), _monday())

    response = await client.post(
        "/api/v1/plans/replan", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "NOTHING_TO_REPLAN"


# --- The suggestion has to go quiet once it has been acted on -----------------


def _plan_with_test(n_weeks: int) -> Plan:
    """Week 1 holds a `test` session; the rest are ordinary."""
    return Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[
            Phase(
                name="base",
                weeks=[
                    Week(
                        index=i,
                        is_deload=(i == 4),
                        target_load=(60.0 if i == 4 else 100.0),
                        sessions=[_s(Weekday.TUESDAY, "test" if i == 1 else "tempo")],
                    )
                    for i in range(1, n_weeks + 1)
                ],
            )
        ],
    )


async def _seed_ran_test(db, user_id: str, start: date) -> None:
    """The athlete ran the week-1 test on its planned Tuesday and linked it."""
    day = start + timedelta(days=1)
    activity = await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.RUN,
            "duration_s": 2700,
            "distance_m": 5000,
            "start_time": datetime(day.year, day.month, day.day, 10, tzinfo=UTC),
            "garmin_activity_id": 1,
        }
    )
    await db.session_completions.insert_one(
        {
            "user_id": user_id,
            "week_index": 1,
            "day": "TUESDAY",
            "slot": "primary",
            "session_date": day.isoformat(),
            "activity_id": str(activity.inserted_id),
            "linked_at": datetime(day.year, day.month, day.day, 11, tzinfo=UTC),
        }
    )


async def test_replanning_silences_the_test_suggestion(db):
    """The regression partial replanning introduced. A full rebuild used to drop
    the test session outright, so the banner cleared. Freezing week 1 keeps it —
    and its link — forever, so without this the banner fires for the life of the
    plan and the athlete replans again and again on the same stale advice."""
    from app.services import plan_progress

    user_id = await _seed_user(db)
    start = _monday(-1)  # today is in week 2; the test sits in week 1
    await _seed_plan(db, user_id, _plan_with_test(6), start)
    # Generated the day before the plan began, so it cannot know the test's result.
    await db.plans.update_one(
        {"user_id": user_id, "version": 1},
        {"$set": {"generated_at": datetime(start.year, start.month, start.day, 8, tzinfo=UTC)}},
    )
    await _seed_ran_test(db, user_id, start)

    before = await plan_progress.compute_progress(db, user_id)
    assert before.replan_suggested is True
    assert "test" in (before.replan_reason or "").lower()

    tail = Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[
            Phase(
                name="base",
                weeks=[
                    Week(
                        index=i,
                        is_deload=(i == 4),
                        target_load=(60.0 if i == 4 else 90.0),
                        sessions=[_s(Weekday.TUESDAY, "tempo")],
                    )
                    for i in range(3, 7)
                ],
            )
        ],
    )
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(tail.model_dump(mode="json"))),
    ):
        base = await plan_service.build_replan_base(db, user_id)
        result = await plan_service.generate_plan(
            db, user_id, PlanRequest.model_validate(_REQUEST), base=base
        )

    assert result.status == "ready", result.error_message
    after = await plan_progress.compute_progress(db, user_id)
    assert after.replan_suggested is False, after.replan_reason
    # The session itself is still there — it's the suggestion that's spent.
    types = [s.type for p in result.plan.phases for w in p.weeks for s in w.sessions]
    assert "test" in types


async def test_restoring_an_older_plan_brings_the_suggestion_back(db):
    """A restore regenerates nothing, so the plan it brings back still predates
    the test. Stamping the copy with `now` would let it claim otherwise."""
    from app.services import plan_progress

    user_id = await _seed_user(db)
    start = _monday(-1)
    await _seed_plan(db, user_id, _plan_with_test(6), start)
    await db.plans.update_one(
        {"user_id": user_id, "version": 1},
        {"$set": {"generated_at": datetime(start.year, start.month, start.day, 8, tzinfo=UTC)}},
    )
    await _seed_ran_test(db, user_id, start)

    # A newer plan that DOES account for the test silences the suggestion...
    await _seed_plan(db, user_id, _plan_with_test(6), start, version=2)
    await db.plans.update_one(
        {"user_id": user_id, "version": 2},
        {"$set": {"generated_at": datetime.now(UTC)}},
    )
    assert (await plan_progress.compute_progress(db, user_id)).replan_suggested is False

    # ...and going back to the one written before it must bring it back.
    await plan_service.restore_plan_version(db, user_id, 1)

    restored = await plan_progress.compute_progress(db, user_id)
    assert restored.replan_suggested is True
    assert "test" in (restored.replan_reason or "").lower()


def test_a_replan_asks_for_the_test_in_the_first_open_week():
    """`_test_directive` said "SEMAINE 1", always frozen on a partial replan — so
    an athlete who still needed a test could never be given one."""
    base = plan_service.ReplanBase(
        start=_monday(-2),
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(i, 100.0) for i in (1, 2, 3)])],
        last_week=3,
        total_weeks=6,
    )
    context = {"needs_test": True}

    assert "SEMAINE 4" in plan_service._test_directive(context, base)
    assert "SEMAINE 1" in plan_service._test_directive(context)  # fresh plan, unchanged


# --- An injury is a replan too ------------------------------------------------


async def test_injury_replan_freezes_the_weeks_already_run(client, db):
    """A gêne declared on a Friday must not rewrite the sessions run on Tuesday.
    Injury took the full-rebuild path long after the other replans stopped."""
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    me = await db.users.find_one({"email": "a@b.com"})
    user_id = str(me["_id"])
    start = _monday(-2)  # today sits in week 3 of 6
    await _seed_plan(db, user_id, _plan([(i, 100.0 + i, i == 4) for i in range(1, 7)]), start)

    # The comeback: eased right down to one key run a week, deload still on
    # week 4 where it belongs.
    tail = Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[
            Phase(
                name="base",
                weeks=[
                    Week(
                        index=i,
                        is_deload=i == 4,
                        target_load=60.0,
                        sessions=[_s(Weekday.TUESDAY, "easy", 30)],
                    )
                    for i in range(4, 7)
                ],
            )
        ],
    )
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(tail.model_dump(mode="json"))),
    ):
        response = await client.post(
            "/api/v1/plans/replan-injury",
            headers={"Authorization": f"Bearer {token}"},
            json={"area": "mollet droit", "severity": "gene", "days_off": 5},
        )
        await _drain_jobs()

    stored = await db.plans.find_one({"user_id": user_id, "version": 2})
    assert response.status_code == 202
    assert stored is not None, "the comeback was never stored"
    assert stored["start_date"] == start.isoformat()  # the grid never moved
    weeks = [w for p in stored["plan"]["phases"] for w in p["weeks"]]
    assert [w["index"] for w in weeks] == [1, 2, 3, 4, 5, 6]
    assert [w["target_load"] for w in weeks[:3]] == [101.0, 102.0, 103.0]


async def test_injury_replan_on_a_finishing_plan_is_409(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    me = await db.users.find_one({"email": "a@b.com"})
    await _seed_plan(db, str(me["_id"]), _plan([(1, 100.0, False)]), _monday())

    response = await client.post(
        "/api/v1/plans/replan-injury",
        headers={"Authorization": f"Bearer {token}"},
        json={"area": "cheville", "severity": "arret", "days_off": 14},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "NOTHING_TO_REPLAN"


def test_injury_directive_discounts_the_days_off_already_frozen():
    """The stop starts today; the weeks being written start next Monday. Asking
    for the full days_off from there prescribes a longer stop than declared."""
    from app.models.plan import InjuryReport

    start = _monday(-2)
    base = plan_service.ReplanBase(
        start=start,
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(i, 100.0) for i in (1, 2, 3)])],
        last_week=3,
        total_weeks=6,
    )
    # Friday of week 3: two days of the stop (Sat, Sun) fall in the frozen week.
    friday = start + timedelta(days=18)
    injury = InjuryReport(area="mollet", severity="arret", days_off=10)

    text = plan_service._injury_directive(injury, base, today=friday)

    assert "10 jour(s) sans course possible" in text  # what was declared
    # Friday, Saturday, Sunday are spent inside the frozen week; 7 days remain
    # for the weeks actually being written.
    assert "7 premier(s) jour(s)" in text


def test_injury_directive_asks_for_no_extra_rest_when_the_stop_is_over():
    from app.models.plan import InjuryReport

    start = _monday(-2)
    base = plan_service.ReplanBase(
        start=start,
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=[_week(i, 100.0) for i in (1, 2, 3)])],
        last_week=3,
        total_weeks=6,
    )
    monday_of_week_3 = start + timedelta(days=14)
    injury = InjuryReport(area="mollet", severity="gene", days_off=3)

    text = plan_service._injury_directive(injury, base, today=monday_of_week_3)

    assert "pas de repos supplémentaire" in text
    assert "phase allégée" not in text


def test_week_count_is_checked_on_the_whole_plan_not_just_the_open_part():
    """The trap in filtering: session days are a per-week question, but the
    plan's LENGTH against the race date is a property of the whole plan.
    Counting only the open weeks would report a 16-week plan as twelve weeks
    short the moment twelve of them are frozen."""
    from app.services import plan_validation

    start = _monday(-11)  # 12 weeks in, 4 to go
    plan = _plan([(i, 100.0, i % 4 == 0) for i in range(1, 17)])
    request = PlanRequest.model_validate(
        {**_REQUEST, "goal_type": "race", "race_date": start + timedelta(weeks=16)}
    )

    violations = plan_validation.validate_plan(plan, request, start, None, frozen_through=12)

    assert not any("semaines avant la course" in v for v in violations)


def test_a_genuinely_short_plan_is_still_caught_when_replanning():
    """Non-regression for the fix above: relaxing the count must not disable it."""
    from app.services import plan_validation

    start = _monday(-2)
    plan = _plan([(i, 100.0, i % 4 == 0) for i in range(1, 5)])  # 4 weeks
    request = PlanRequest.model_validate(
        {**_REQUEST, "goal_type": "race", "race_date": start + timedelta(weeks=16)}
    )

    violations = plan_validation.validate_plan(plan, request, start, None, frozen_through=2)

    assert any("semaines avant la course" in v for v in violations)


def test_a_frozen_week_is_never_reported_as_a_violation():
    """Frozen weeks are context, not defendants: they already shipped, and a
    violation the model cannot fix would burn every retry."""
    from app.services import plan_validation

    # Week 1 carries two 'key' runs where the request allows one — a real
    # violation, but in a week nobody can still change.
    plan = _plan([(1, 100.0, False), (2, 105.0, False), (3, 80.0, True)])
    request = PlanRequest.model_validate(_REQUEST)  # min_run_sessions_per_week = 1

    judged_whole = plan_validation.validate_plan(plan, request, _monday())
    assert any("Semaine 1" in v for v in judged_whole)

    replanning = plan_validation.validate_plan(plan, request, _monday(), frozen_through=1)
    assert not any("Semaine 1" in v for v in replanning)
