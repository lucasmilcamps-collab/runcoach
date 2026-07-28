from datetime import UTC, datetime, timedelta

import pytest

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_completion_service as pcs
from app.services import plan_progress


def _s(day: Weekday, stype: str) -> Session:
    return Session(day=day, sport=SportType.RUN, type=stype, duration_min=50, rationale="x")


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def _seed_plan(db, user_id: str):
    """Week 1 is last week (past, in the 14-day window) with 3 key sessions on
    Mon/Wed/Fri. Returns its start (last Monday)."""
    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday()) - timedelta(days=7)
    week1 = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "tempo"),
            _s(Weekday.FRIDAY, "threshold"),
        ],
    )
    week2 = Week(
        index=2, is_deload=False, target_load=108.0, sessions=[_s(Weekday.TUESDAY, "easy")]
    )
    plan = Plan(
        goal=PlanGoal(description="Test"), phases=[Phase(name="base", weeks=[week1, week2])]
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
    return start


async def _seed_activity(db, user_id: str, on_date) -> str:
    result = await db.activities.insert_one(
        {
            "user_id": user_id,
            "garmin_activity_id": 123,
            "sport": SportType.RUN,
            "start_time": datetime(on_date.year, on_date.month, on_date.day, 7, tzinfo=UTC),
            "duration_s": 3000,
            "avg_hr": 140,
        }
    )
    return str(result.inserted_id)


async def test_link_then_unlink(db):
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id)
    act_id = await _seed_activity(db, user_id, datetime.now(UTC).date())

    info = await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, act_id)
    assert info.session_date == start  # Monday of week 1
    assert info.linked is not None
    assert info.linked.id == act_id

    got = await pcs.get_session_link(db, user_id, 1, Weekday.MONDAY)
    assert got.linked is not None and got.linked.id == act_id

    cleared = await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, None)
    assert cleared.linked is None
    assert (await pcs.get_session_link(db, user_id, 1, Weekday.MONDAY)).linked is None


async def test_link_counts_as_completed_off_date(db):
    """An activity linked to a key session counts as done in adherence, even
    though that activity is not on the planned day."""
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)
    act_id = await _seed_activity(db, user_id, datetime.now(UTC).date())  # today, not Monday

    before = await plan_progress.compute_progress(db, user_id)
    assert before.recent_key_completed == 0  # no activity on the key dates

    await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, act_id)

    after = await plan_progress.compute_progress(db, user_id)
    assert after.recent_key_completed == 1  # the Monday long_run is now linked


async def test_link_unknown_activity_raises(db):
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)
    with pytest.raises(pcs.ActivityNotFoundError):
        await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, "not-an-id")


async def test_link_without_plan_raises(db):
    user_id = await _seed_user(db)
    with pytest.raises(pcs.NoActivePlanError):
        await pcs.get_session_link(db, user_id, 1, Weekday.MONDAY)
