"""Week-by-week adherence for one plan version.

Answers "did I follow this plan?" over its whole length — including for a
version that is no longer active — where `compute_progress` only looks at a
rolling window to decide whether to suggest a replan.
"""

from datetime import UTC, date, datetime, timedelta

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_progress


def _run(day: Weekday, duration_min: int = 60, priority: str = "key") -> Session:
    return Session(
        day=day,
        sport=SportType.RUN,
        type="easy",
        duration_min=duration_min,
        priority=priority,
        rationale="x",
    )


def _plan(weeks: list[Week]) -> Plan:
    return Plan(goal=PlanGoal(description="Semi"), phases=[Phase(name="base", weeks=weeks)])


def _week(index: int, sessions: list[Session], is_deload: bool = False) -> Week:
    return Week(index=index, is_deload=is_deload, target_load=100.0, sessions=sessions)


async def _seed(db, plan: Plan, start: date, status: str = "ready") -> str:
    user = await db.users.insert_one(
        {"email": "adh@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(user.inserted_id)
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": status,
            "plan": plan.model_dump(mode="json"),
            "request": None,
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )
    return user_id


async def _add_run(db, user_id: str, day: date, minutes: int) -> None:
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": datetime(day.year, day.month, day.day, 9, tzinfo=UTC),
            "duration_s": minutes * 60,
        }
    )


def _monday(weeks_ago: int) -> date:
    today = datetime.now(UTC).date()
    return today - timedelta(days=today.weekday() + 7 * weeks_ago)


async def test_counts_completed_runs_week_by_week(db):
    """Two weeks fully elapsed: the first followed, the second half-missed."""
    start = _monday(2)
    plan = _plan(
        [
            _week(1, [_run(Weekday.MONDAY), _run(Weekday.WEDNESDAY)]),
            _week(2, [_run(Weekday.MONDAY), _run(Weekday.WEDNESDAY)]),
        ]
    )
    user_id = await _seed(db, plan, start)
    await _add_run(db, user_id, start, 60)
    await _add_run(db, user_id, start + timedelta(days=2), 60)
    await _add_run(db, user_id, start + timedelta(days=7), 60)  # week 2 Monday only

    adherence = await plan_progress.compute_overview(db, user_id, 1)

    assert adherence is not None
    assert [(w.week_index, w.planned, w.completed) for w in adherence.weeks] == [
        (1, 2, 2),
        (2, 2, 1),
    ]
    assert (adherence.planned, adherence.completed) == (4, 3)


async def test_a_run_too_short_does_not_count(db):
    """Same 60%-of-planned rule as the replan trigger — one rule, one answer."""
    start = _monday(1)
    user_id = await _seed(db, plan := _plan([_week(1, [_run(Weekday.MONDAY, 60)])]), start)
    assert plan  # seeded above
    await _add_run(db, user_id, start, 20)  # a third of the planned duration

    adherence = await plan_progress.compute_overview(db, user_id, 1)

    assert adherence.weeks[0].completed == 0


async def test_optional_sessions_are_not_counted(db):
    """Adherence measures what the athlete committed to, not every slot offered."""
    start = _monday(1)
    plan = _plan([_week(1, [_run(Weekday.MONDAY), _run(Weekday.FRIDAY, priority="optional")])])
    user_id = await _seed(db, plan, start)

    adherence = await plan_progress.compute_overview(db, user_id, 1)

    assert adherence.weeks[0].planned == 1


async def test_future_weeks_are_not_scored(db):
    """An unfinished week has nothing to be behind on — it stays out of the
    totals so the percentage isn't dragged down by weeks that haven't happened."""
    start = _monday(0)  # this week: in progress
    plan = _plan(
        [
            _week(1, [_run(Weekday.MONDAY), _run(Weekday.WEDNESDAY)]),
            _week(2, [_run(Weekday.MONDAY)]),
        ]
    )
    user_id = await _seed(db, plan, start)

    adherence = await plan_progress.compute_overview(db, user_id, 1)

    assert [w.is_past for w in adherence.weeks] == [False, False]
    assert (adherence.planned, adherence.completed) == (0, 0)
    assert adherence.week_current == 1
    assert [w.is_current for w in adherence.weeks] == [True, False]


async def test_deload_weeks_are_flagged(db):
    start = _monday(1)
    plan = _plan([_week(1, [_run(Weekday.MONDAY)], is_deload=True)])
    user_id = await _seed(db, plan, start)

    adherence = await plan_progress.compute_overview(db, user_id, 1)

    assert adherence.weeks[0].is_deload is True


async def test_a_stopped_version_is_still_readable(db):
    """Stopping a plan retires it; "did I follow it?" stays a fair question."""
    start = _monday(1)
    plan = _plan([_week(1, [_run(Weekday.MONDAY)])])
    user_id = await _seed(db, plan, start, status="cancelled")
    await _add_run(db, user_id, start, 60)

    adherence = await plan_progress.compute_overview(db, user_id, 1)

    assert adherence is not None
    assert adherence.weeks[0].completed == 1


async def test_unknown_version_returns_none(db):
    user_id = await _seed(db, _plan([_week(1, [_run(Weekday.MONDAY)])]), _monday(1))

    assert await plan_progress.compute_overview(db, user_id, 99) is None


async def test_reports_the_plan_calendar_window(db):
    """The summary screen shows start and end dates; the plan document has
    neither — only a week count and a stored start."""
    start = _monday(1)
    plan = _plan([_week(1, [_run(Weekday.MONDAY)]), _week(2, [_run(Weekday.MONDAY)])])
    user_id = await _seed(db, plan, start)

    overview = await plan_progress.compute_overview(db, user_id, 1)

    assert overview.start_date == start
    # Inclusive: the Sunday of week 2, not the Monday after it.
    assert overview.end_date == start + timedelta(days=13)
    assert overview.weeks_total == 2
