"""Per-week session edits: change a duration, drop a non-run session.

Same override model as a move — the stored plan version is never mutated and a
replan clears them.
"""

from datetime import UTC, datetime

import pytest

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_moves_service as pms
from app.services import plan_service


def _s(day: Weekday, stype: str, sport: SportType, slot: str = "primary", dur: int = 60) -> Session:
    return Session(day=day, sport=sport, type=stype, duration_min=dur, rationale="x", slot=slot)


async def _seed(db) -> str:
    user = await db.users.insert_one(
        {"email": "edits@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(user.inserted_id)
    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            _s(Weekday.TUESDAY, "tempo", SportType.RUN, dur=45),
            _s(Weekday.WEDNESDAY, "cross_training", SportType.BASKETBALL, dur=60),
            _s(Weekday.WEDNESDAY, "strength", SportType.STRENGTH, slot="addon", dur=20),
        ],
    )
    plan = Plan(goal=PlanGoal(description="Semi"), phases=[Phase(name="base", weeks=[week])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": datetime.now(UTC).date().isoformat(),
            "created_at": datetime.now(UTC),
        }
    )
    return user_id


async def _sessions(db, user_id):
    plan = (await plan_service.get_current_plan(db, user_id)).plan
    return plan.phases[0].weeks[0].sessions


async def test_duration_change_shows_on_the_current_plan(db):
    user_id = await _seed(db)
    await pms.set_session_duration(db, user_id, 1, Weekday.WEDNESDAY, "primary", 40)

    basket = next(s for s in await _sessions(db, user_id) if s.sport == SportType.BASKETBALL)
    assert basket.duration_min == 40


async def test_duration_change_targets_the_right_slot(db):
    """A day holds a primary and its addon; editing one must not touch the other."""
    user_id = await _seed(db)
    await pms.set_session_duration(db, user_id, 1, Weekday.WEDNESDAY, "addon", 30)

    sessions = await _sessions(db, user_id)
    assert next(s for s in sessions if s.slot == "addon").duration_min == 30
    assert next(s for s in sessions if s.sport == SportType.BASKETBALL).duration_min == 60


async def test_deleting_a_non_run_session_removes_it(db):
    user_id = await _seed(db)
    await pms.delete_session(db, user_id, 1, Weekday.WEDNESDAY, "primary")

    sports = [s.sport for s in await _sessions(db, user_id)]
    assert SportType.BASKETBALL not in sports
    assert SportType.RUN in sports  # the rest of the week is untouched
    assert SportType.STRENGTH in sports  # the addon on the same day survives


async def test_deleting_a_run_is_refused(db):
    """Removing a run would silently break the plan's guaranteed run count."""
    user_id = await _seed(db)
    with pytest.raises(pms.CannotDeleteRunError):
        await pms.delete_session(db, user_id, 1, Weekday.TUESDAY, "primary")

    assert any(s.sport == SportType.RUN for s in await _sessions(db, user_id))


async def test_the_stored_plan_is_never_mutated(db):
    """Overrides are applied on read — the plan document keeps its own truth."""
    user_id = await _seed(db)
    await pms.set_session_duration(db, user_id, 1, Weekday.WEDNESDAY, "primary", 40)
    await pms.delete_session(db, user_id, 1, Weekday.WEDNESDAY, "addon")

    doc = await db.plans.find_one({"user_id": user_id})
    stored = Plan.model_validate(doc["plan"]).phases[0].weeks[0].sessions
    assert len(stored) == 3
    assert next(s for s in stored if s.sport == SportType.BASKETBALL).duration_min == 60


async def test_edit_survives_a_move_of_the_same_session(db):
    """Edits are keyed on the plan's original day, so moving the session after
    editing it must not orphan the edit."""
    user_id = await _seed(db)
    await pms.set_session_duration(db, user_id, 1, Weekday.WEDNESDAY, "primary", 40)
    await pms.move_session(db, user_id, 1, Weekday.WEDNESDAY, Weekday.FRIDAY)

    basket = next(s for s in await _sessions(db, user_id) if s.sport == SportType.BASKETBALL)
    assert basket.day == Weekday.FRIDAY
    assert basket.duration_min == 40


async def test_editing_a_moved_session_by_its_shown_day(db):
    """After a move the app shows the session on its new day, and that's the day
    it will send back — it must resolve to the original."""
    user_id = await _seed(db)
    await pms.move_session(db, user_id, 1, Weekday.WEDNESDAY, Weekday.FRIDAY)
    await pms.set_session_duration(db, user_id, 1, Weekday.FRIDAY, "primary", 35)

    basket = next(s for s in await _sessions(db, user_id) if s.sport == SportType.BASKETBALL)
    assert basket.duration_min == 35
