from datetime import UTC, datetime, timedelta

from app.models.activity import SportType
from app.models.plan import WEEKDAY_ORDER, Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_progress


def _s(day: Weekday, stype: str, priority: str = "key") -> Session:
    return Session(
        day=day, sport=SportType.RUN, type=stype, duration_min=50, priority=priority, rationale="x"
    )


def _instant(day, hour: int = 9) -> datetime:
    """A date as a UTC instant — plans and performances are now compared as
    moments, so a replan the same afternoon as a test can silence it."""
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def _seed_two_week_plan(db, user_id: str) -> tuple:
    """Week 0 is last week (past, inside the 14-day window) with 3 key sessions
    on Mon/Wed/Fri; week 1 is the current week."""
    today = datetime.now(UTC).date()
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(days=7)  # last Monday

    week0 = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "tempo"),
            _s(Weekday.FRIDAY, "threshold"),
        ],
    )
    # Current-week filler is optional so it never counts as a key session
    # regardless of today's weekday (keeps the window assertions date-stable).
    week1 = Week(
        index=2,
        is_deload=False,
        target_load=108.0,
        sessions=[_s(Weekday.TUESDAY, "easy", priority="optional")],
    )
    plan = Plan(
        goal=PlanGoal(description="Test"), phases=[Phase(name="base", weeks=[week0, week1])]
    )
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )
    # Dates of the three key sessions in week 0.
    return start, [start, start + timedelta(days=2), start + timedelta(days=4)]


async def _seed_activity(db, user_id: str, on_date) -> None:
    await db.activities.insert_one(
        {
            "garmin_activity_id": int(on_date.strftime("%Y%m%d")),
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": datetime(on_date.year, on_date.month, on_date.day, 7, tzinfo=UTC),
            "duration_s": 3000,
            "avg_hr": 140,
        }
    )


async def test_no_plan_reports_no_plan(db):
    user_id = await _seed_user(db)
    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.has_plan is False
    assert progress.replan_suggested is False


async def test_missed_key_sessions_trigger_replan(db):
    user_id = await _seed_user(db)
    await _seed_two_week_plan(db, user_id)  # no activities → all missed

    progress = await plan_progress.compute_progress(db, user_id)

    assert progress.has_plan is True
    assert progress.recent_key_planned == 3
    assert progress.recent_key_completed == 0
    assert progress.recent_key_missed == 3
    assert progress.replan_suggested is True
    assert "manquées" in (progress.replan_reason or "")


async def test_completed_sessions_no_replan(db):
    user_id = await _seed_user(db)
    _, key_dates = await _seed_two_week_plan(db, user_id)
    for d in key_dates:
        await _seed_activity(db, user_id, d)

    progress = await plan_progress.compute_progress(db, user_id)

    assert progress.recent_key_completed == 3
    assert progress.recent_key_missed == 0
    assert progress.replan_suggested is False


async def test_one_miss_below_trigger(db):
    user_id = await _seed_user(db)
    _, key_dates = await _seed_two_week_plan(db, user_id)
    # Complete 2 of 3 → only 1 missed, below the 2-miss trigger.
    for d in key_dates[:2]:
        await _seed_activity(db, user_id, d)

    progress = await plan_progress.compute_progress(db, user_id)

    assert progress.recent_key_missed == 1
    assert progress.replan_suggested is False


async def test_progress_endpoint(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    response = await client.get(
        "/api/v1/plans/progress", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["has_plan"] is False


async def test_optional_run_not_counted_as_key(db):
    """Adherence reads Session.priority now: an 'optional' run that's skipped is
    not a missed key session and doesn't push toward a replan."""
    user_id = await _seed_user(db)
    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday()) - timedelta(days=7)  # last Monday

    key = Session(
        day=Weekday.MONDAY,
        sport=SportType.RUN,
        type="long_run",
        duration_min=60,
        priority="key",
        rationale="x",
    )
    optional = Session(
        day=Weekday.WEDNESDAY,
        sport=SportType.RUN,
        type="easy",
        duration_min=40,
        priority="optional",
        rationale="x",
    )
    week1 = Week(index=1, is_deload=False, target_load=100.0, sessions=[key, optional])
    week2 = Week(
        index=2,
        is_deload=False,
        target_load=105.0,
        sessions=[
            Session(
                day=Weekday.TUESDAY,
                sport=SportType.RUN,
                type="easy",
                duration_min=40,
                priority="optional",  # current-week filler, date-stable
                rationale="x",
            )
        ],
    )
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=[week1, week2])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.recent_key_planned == 1  # only the key long_run, not the optional easy
    assert progress.recent_key_missed == 1
    assert progress.replan_suggested is False  # 1 miss < 2-miss trigger


async def test_completed_test_session_suggests_replan(db):
    user_id = await _seed_user(db)
    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday()) - timedelta(days=7)  # last Monday

    test_session = Session(
        day=Weekday.MONDAY,
        sport=SportType.RUN,
        type="test",
        duration_min=30,
        priority="key",
        rationale="mesure du niveau",
    )
    week1 = Week(index=1, is_deload=False, target_load=100.0, sessions=[test_session])
    week2 = Week(
        index=2,
        is_deload=False,
        target_load=105.0,
        sessions=[_s(Weekday.TUESDAY, "easy", priority="optional")],
    )
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=[week1, week2])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
            # Written before the week it plans — which is the only order that
            # exists in reality, and what makes the test session it prescribes
            # something this plan cannot already account for.
            "generated_at": _instant(start - timedelta(days=1)),
        }
    )
    await _seed_activity(db, user_id, start)  # the test was run on its planned day

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.replan_suggested is True
    assert "test" in (progress.replan_reason or "").lower()


async def _seed_test_plan_on(db, user_id: str, test_date) -> None:
    """A one-week plan whose only session is a `test` falling exactly on
    `test_date` (week 1 starts on that date's Monday)."""
    start = test_date - timedelta(days=test_date.weekday())
    test_session = Session(
        day=WEEKDAY_ORDER[test_date.weekday()],
        sport=SportType.RUN,
        type="test",
        duration_min=30,
        priority="key",
        rationale="mesure du niveau",
    )
    plan = Plan(
        goal=PlanGoal(description="T"),
        phases=[
            Phase(
                name="base",
                weeks=[Week(index=1, is_deload=False, target_load=100.0, sessions=[test_session])],
            )
        ],
    )
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
            "generated_at": _instant(start - timedelta(days=1)),
        }
    )


async def test_test_session_linked_today_suggests_replan(db):
    """A test run and linked the same day is fresh performance data — the athlete
    shouldn't have to wait until tomorrow to be told to re-anchor the plan."""
    user_id = await _seed_user(db)
    today = datetime.now(UTC).date()
    await _seed_test_plan_on(db, user_id, today)
    await db.session_completions.insert_one(
        {
            "user_id": user_id,
            "week_index": 1,
            "day": WEEKDAY_ORDER[today.weekday()],
            "slot": "primary",
            "session_date": today.isoformat(),
            "activity_id": "507f1f77bcf86cd799439011",
            "linked_at": datetime.now(UTC),
        }
    )

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.replan_suggested is True
    assert "test" in (progress.replan_reason or "").lower()


async def test_test_session_planned_today_but_not_run_does_not_suggest(db):
    """Non-regression for the `<=` above: a test merely *scheduled* for today,
    with no activity and no link, must stay silent."""
    user_id = await _seed_user(db)
    await _seed_test_plan_on(db, user_id, datetime.now(UTC).date())

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.replan_suggested is False
    assert progress.replan_reason is None


async def test_padel_and_short_run_do_not_count_as_key_run(db):
    user_id = await _seed_user(db)
    _, key_dates = await _seed_two_week_plan(db, user_id)  # 3 key runs, 50 min, Mon/Wed/Fri

    def _dt(d):
        return datetime(d.year, d.month, d.day, 7, tzinfo=UTC)

    # Mon: padel (wrong sport). Wed: a 20-min run (< 60% of 50). Fri: a full run.
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.PADEL,
            "start_time": _dt(key_dates[0]),
            "duration_s": 3600,
        }
    )
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": _dt(key_dates[1]),
            "duration_s": 20 * 60,
        }
    )
    await _seed_activity(db, user_id, key_dates[2])  # full 50-min run

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.recent_key_completed == 1  # only the full Friday run counts
    assert progress.recent_key_missed == 2
