from datetime import UTC, datetime, timedelta

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_progress


def _s(day: Weekday, stype: str) -> Session:
    return Session(day=day, sport=SportType.RUN, type=stype, duration_min=50, rationale="x")


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
    week1 = Week(
        index=2, is_deload=False, target_load=108.0, sessions=[_s(Weekday.TUESDAY, "easy")]
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
