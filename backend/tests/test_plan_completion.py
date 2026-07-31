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


# --- The slot is part of a session's identity ---


async def _seed_plan_with_addon(db, user_id: str):
    """Week 1 is last week: a key run on Tuesday plus a strength addon the same
    day — the shape that used to make one link validate both."""
    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday()) - timedelta(days=7)
    week1 = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            _s(Weekday.TUESDAY, "tempo"),
            Session(
                day=Weekday.TUESDAY,
                sport=SportType.STRENGTH,
                type="strength",
                duration_min=20,
                slot="addon",
                priority="optional",
                rationale="x",
            ),
        ],
    )
    plan = Plan(goal=PlanGoal(description="Test"), phases=[Phase(name="base", weeks=[week1])])
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


async def test_linking_the_addon_leaves_the_run_missed(db):
    """The bug: session_completions was keyed on the day alone, so logging the
    strength block marked the key run done and the replan trigger never fired."""
    user_id = await _seed_user(db)
    await _seed_plan_with_addon(db, user_id)
    strength = await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.STRENGTH,
            "start_time": datetime.now(UTC),
            "duration_s": 1200,
        }
    )

    await pcs.set_session_link(db, user_id, 1, Weekday.TUESDAY, str(strength.inserted_id), "addon")

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.recent_key_planned == 1
    assert progress.recent_key_completed == 0  # the run is still outstanding

    # And the two links don't see each other.
    assert (await pcs.get_session_link(db, user_id, 1, Weekday.TUESDAY, "primary")).linked is None
    assert (await pcs.get_session_link(db, user_id, 1, Weekday.TUESDAY, "addon")).linked is not None


async def test_non_run_activity_cannot_validate_a_run(db):
    """Refused explicitly rather than silently accepted: accepting it would mark
    a key run done and quietly disarm the replan trigger."""
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)
    padel = await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.PADEL,
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
        }
    )

    with pytest.raises(pcs.SportMismatchError) as exc:
        await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, str(padel.inserted_id))
    assert exc.value.activity_sport == SportType.PADEL

    assert await db.session_completions.find_one({"user_id": user_id}) is None


async def test_legacy_link_without_slot_still_counts_as_primary(db):
    """Documents written before the slot existed have none. They were always
    primary links, so they keep counting — and the next write heals them."""
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id)
    act_id = await _seed_activity(db, user_id, datetime.now(UTC).date())
    await db.session_completions.insert_one(
        {
            "user_id": user_id,
            "week_index": 1,
            "day": Weekday.MONDAY,
            "session_date": start.isoformat(),
            "activity_id": act_id,
        }
    )

    assert (await pcs.get_session_link(db, user_id, 1, Weekday.MONDAY)).linked is not None
    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.recent_key_completed == 1

    # Re-linking updates the legacy document in place rather than duplicating it.
    await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, act_id)
    docs = [d async for d in db.session_completions.find({"user_id": user_id})]
    assert len(docs) == 1
    assert docs[0]["slot"] == "primary"
