from datetime import UTC, datetime

import pytest

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_moves_service as pms
from app.services import plan_service


def _s(day: Weekday, stype: str) -> Session:
    return Session(day=day, sport=SportType.RUN, type=stype, duration_min=50, rationale="x")


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def _seed_plan(db, user_id: str, version: int = 1):
    week1 = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[_s(Weekday.TUESDAY, "tempo"), _s(Weekday.SATURDAY, "long_run")],
    )
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=[week1])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": version,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": datetime.now(UTC).date().isoformat(),
            "created_at": datetime.now(UTC),
        }
    )


async def _current_days(db, user_id):
    plan = (await plan_service.get_current_plan(db, user_id)).plan
    return {s.type: s.day for s in plan.phases[0].weeks[0].sessions}


async def test_move_and_reset(db):
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)

    await pms.move_session(db, user_id, 1, Weekday.SATURDAY, Weekday.SUNDAY)
    days = await _current_days(db, user_id)
    assert days["long_run"] == Weekday.SUNDAY
    assert days["tempo"] == Weekday.TUESDAY  # untouched

    # Move again from the now-current day (Sunday) back to Saturday → clears it.
    await pms.move_session(db, user_id, 1, Weekday.SUNDAY, Weekday.SATURDAY)
    days = await _current_days(db, user_id)
    assert days["long_run"] == Weekday.SATURDAY
    assert await pms.get_moves(db, user_id, 1) == {}


async def test_move_then_move_again_updates_same_override(db):
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)

    await pms.move_session(db, user_id, 1, Weekday.SATURDAY, Weekday.SUNDAY)
    await pms.move_session(db, user_id, 1, Weekday.SUNDAY, Weekday.FRIDAY)
    days = await _current_days(db, user_id)
    assert days["long_run"] == Weekday.FRIDAY
    # A single override remains (Saturday → Friday), not two.
    assert await pms.get_moves(db, user_id, 1) == {1: {"SATURDAY": "FRIDAY"}}


async def test_move_unknown_day_raises(db):
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)
    with pytest.raises(pms.SessionNotFoundError):
        await pms.move_session(db, user_id, 1, Weekday.MONDAY, Weekday.WEDNESDAY)


async def test_move_without_plan_raises(db):
    user_id = await _seed_user(db)
    with pytest.raises(pms.NoActivePlanError):
        await pms.move_session(db, user_id, 1, Weekday.SATURDAY, Weekday.SUNDAY)


# --- The weekly load is derived, not declared ---------------------------------


async def test_the_week_load_is_computed_from_its_sessions(db):
    """`target_load` used to be a number the model wrote beside sessions it had
    already composed, so every load rule policed a label: a week could announce
    100 and prescribe 140."""
    from app.models.plan import Phase, Plan, PlanGoal, Session, Week
    from app.services import plan_moves_service

    plan = Plan(
        goal=PlanGoal(description="T"),
        phases=[
            Phase(
                name="base",
                weeks=[
                    Week(
                        index=1,
                        is_deload=False,
                        target_load=999.0,  # a lie, and it must not survive
                        sessions=[
                            Session(
                                day=Weekday.TUESDAY,
                                sport=SportType.RUN,
                                type="tempo",
                                duration_min=45,
                                rationale="x",
                            ),
                            Session(
                                day=Weekday.SATURDAY,
                                sport=SportType.RUN,
                                type="long_run",
                                duration_min=60,
                                rationale="x",
                            ),
                            Session(
                                day=Weekday.SUNDAY,
                                sport=SportType.RUN,
                                type="rest",
                                duration_min=0,
                                rationale="x",
                            ),
                        ],
                    )
                ],
            )
        ],
    )

    plan_moves_service.apply_computed_load(plan)

    # 45 min Z3 + 60 min Z2 = 135 + 120; rest contributes nothing.
    assert plan.phases[0].weeks[0].target_load == 255.0


async def test_shortening_a_session_lowers_the_week_load(db):
    """The reason the load is computed AFTER the edits: an athlete who trims a
    session has trimmed the week, and a load computed first would report the plan
    as generated rather than as it stands."""
    from app.services import plan_moves_service, plan_service

    user_id = await _seed_user(db)
    await _seed_plan(db, user_id)
    before = (await plan_service.get_current_plan(db, user_id)).plan.phases[0].weeks[0].target_load

    await plan_moves_service.set_session_duration(db, user_id, 1, Weekday.TUESDAY, "primary", 20)

    after = (await plan_service.get_current_plan(db, user_id)).plan.phases[0].weeks[0].target_load
    assert after < before
