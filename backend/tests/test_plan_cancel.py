"""Stopping the active plan.

It must leave every "current plan" read — today's session, progress, per-week
overrides — while staying readable in the version history.
"""

from datetime import UTC, datetime

import pytest

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_moves_service as pms
from app.services import plan_progress, plan_service


def _plan(desc: str = "Semi") -> Plan:
    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            Session(
                day=Weekday.TUESDAY,
                sport=SportType.RUN,
                type="tempo",
                duration_min=45,
                rationale="x",
            )
        ],
    )
    return Plan(goal=PlanGoal(description=desc), phases=[Phase(name="base", weeks=[week])])


async def _seed(db, versions: int = 1) -> str:
    user = await db.users.insert_one(
        {"email": "cancel@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(user.inserted_id)
    for v in range(1, versions + 1):
        await db.plans.insert_one(
            {
                "user_id": user_id,
                "version": v,
                "status": "ready",
                "plan": _plan(f"Objectif {v}").model_dump(mode="json"),
                "request": None,
                "start_date": datetime.now(UTC).date().isoformat(),
                "created_at": datetime.now(UTC),
            }
        )
    return user_id


async def test_cancel_clears_the_current_plan(db):
    user_id = await _seed(db)
    assert await plan_service.get_current_plan(db, user_id) is not None

    await plan_service.cancel_current_plan(db, user_id)

    # None → the API answers 404 → the app shows its "create a plan" state.
    assert await plan_service.get_current_plan(db, user_id) is None


async def test_cancel_leaves_today_and_progress_empty(db):
    user_id = await _seed(db)
    await plan_service.cancel_current_plan(db, user_id)

    today = await plan_service.get_today_session(db, user_id)
    assert today.has_plan is False

    progress = await plan_progress.compute_progress(db, user_id)
    assert progress.has_plan is False


async def test_cancelled_plan_stays_in_the_history(db):
    """The version is retired, not deleted — that's the point of keeping it."""
    user_id = await _seed(db)
    await plan_service.cancel_current_plan(db, user_id)

    versions = await plan_service.list_plan_versions(db, user_id)
    assert [v.version for v in versions] == [1]

    detail = await plan_service.get_plan_version(db, user_id, 1)
    assert detail is not None
    assert detail.plan is not None


async def test_per_week_overrides_refuse_a_cancelled_plan(db):
    user_id = await _seed(db)
    await plan_service.cancel_current_plan(db, user_id)

    with pytest.raises(pms.NoActivePlanError):
        await pms.move_session(db, user_id, 1, Weekday.TUESDAY, Weekday.FRIDAY)


async def test_cancel_only_retires_the_newest_version(db):
    """Older versions were already superseded; stopping must not rewrite them."""
    user_id = await _seed(db, versions=3)
    await plan_service.cancel_current_plan(db, user_id)

    statuses = {doc["version"]: doc["status"] async for doc in db.plans.find({"user_id": user_id})}
    assert statuses == {1: "ready", 2: "ready", 3: "cancelled"}


async def test_cancel_without_a_plan_raises(db):
    user = await db.users.insert_one(
        {"email": "none@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    with pytest.raises(plan_service.NoActivePlanError):
        await plan_service.cancel_current_plan(db, str(user.inserted_id))


async def test_a_new_plan_can_be_created_after_cancelling(db):
    """Stopping is not a dead end: the next generation becomes current."""
    user_id = await _seed(db)
    await plan_service.cancel_current_plan(db, user_id)

    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 2,
            "status": "ready",
            "plan": _plan("Nouvel objectif").model_dump(mode="json"),
            "request": None,
            "start_date": datetime.now(UTC).date().isoformat(),
            "created_at": datetime.now(UTC),
        }
    )

    current = await plan_service.get_current_plan(db, user_id)
    assert current is not None
    assert current.plan.goal.description == "Nouvel objectif"
