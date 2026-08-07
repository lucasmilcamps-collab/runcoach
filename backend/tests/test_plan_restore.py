"""Restoring a past plan version.

The way back from a regeneration that rebuilt a week the athlete had already
run. It must bring back the plan *and* the week: the same start date, so the
week grid lines up and a link made against week 1 still points at the session it
was made against, and the per-week overrides, which are keyed by plan version
and would otherwise be silently dropped.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_completion_service, plan_service


def _plan(desc: str, day: Weekday = Weekday.TUESDAY, stype: str = "tempo") -> Plan:
    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            Session(
                day=day,
                sport=SportType.RUN,
                type=stype,
                duration_min=45,
                priority="key",
                rationale="x",
            )
        ],
    )
    return Plan(goal=PlanGoal(description=desc), phases=[Phase(name="base", weeks=[week])])


# A minimal but valid stored request — the restore copies it forward, so it has
# to survive PlanRequest validation on the way back out.
_REQUEST = {
    "goal_type": "distance",
    "distance_km": 21.1,
    "available_days": ["TUESDAY", "THURSDAY", "SUNDAY"],
}


def _monday(offset_weeks: int = 0) -> date:
    today = datetime.now(UTC).date()
    return today - timedelta(days=today.weekday()) + timedelta(weeks=offset_weeks)


async def _seed_user(db) -> str:
    user = await db.users.insert_one(
        {"email": "restore@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(user.inserted_id)


async def _insert_version(db, user_id: str, version: int, *, plan: Plan, start: date) -> None:
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": version,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "request": _REQUEST,
            "start_date": start.isoformat(),
            "estimated_time_min": 100,
            "created_at": datetime.now(UTC),
        }
    )


async def test_restore_brings_the_old_plan_back_as_the_active_one(db):
    user_id = await _seed_user(db)
    await _insert_version(db, user_id, 1, plan=_plan("Le bon"), start=_monday())
    await _insert_version(db, user_id, 2, plan=_plan("Le regénéré"), start=_monday(1))

    restored = await plan_service.restore_plan_version(db, user_id, 1)

    assert restored.plan.goal.description == "Le bon"
    current = await plan_service.get_current_plan(db, user_id)
    assert current.plan.goal.description == "Le bon"


async def test_restore_copies_forward_instead_of_deleting(db):
    """A restore that erased the plan it replaced would be the same loss it
    exists to undo — one regeneration too many and there'd be nothing left."""
    user_id = await _seed_user(db)
    await _insert_version(db, user_id, 1, plan=_plan("V1"), start=_monday())
    await _insert_version(db, user_id, 2, plan=_plan("V2"), start=_monday())

    await plan_service.restore_plan_version(db, user_id, 1)

    versions = await plan_service.list_plan_versions(db, user_id)
    assert [v.version for v in versions] == [3, 2, 1]  # newest first, nothing removed
    assert versions[0].is_active is True
    assert versions[0].reason == "Version 1 restaurée"


async def test_restore_keeps_the_original_start_date(db):
    """The point of the whole thing: the restored plan gets its own week grid
    back, so a session run in week 1 sits in week 1 again."""
    user_id = await _seed_user(db)
    original_start = _monday()
    await _insert_version(db, user_id, 1, plan=_plan("V1"), start=original_start)
    await _insert_version(db, user_id, 2, plan=_plan("V2"), start=_monday(1))

    await plan_service.restore_plan_version(db, user_id, 1)

    doc = await db.plans.find_one({"user_id": user_id, "version": 3})
    assert doc["start_date"] == original_start.isoformat()


async def test_a_link_made_against_the_old_plan_lines_up_again(db):
    """The failure this endpoint answers: a regeneration left the link pointing
    at whatever the new plan put on that week/day/slot. After a restore it
    describes the session it was made against once more."""
    user_id = await _seed_user(db)
    start = _monday()
    # V1's week 1 Tuesday is the test session the athlete actually ran.
    await _insert_version(db, user_id, 1, plan=_plan("V1", stype="test"), start=start)
    activity = await db.activities.insert_one(
        {
            "garmin_activity_id": 1,
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": datetime(start.year, start.month, start.day, 7, tzinfo=UTC)
            + timedelta(days=1),
            "duration_s": 1800,
        }
    )
    await plan_completion_service.set_session_link(
        db, user_id, 1, Weekday.TUESDAY, str(activity.inserted_id)
    )
    # The regeneration: same slot, different session.
    await _insert_version(db, user_id, 2, plan=_plan("V2", stype="intervals"), start=start)

    linked_to_wrong_session = await plan_completion_service.get_session_link(
        db, user_id, 1, Weekday.TUESDAY
    )
    assert linked_to_wrong_session.linked is not None  # the link survived, re-pointed

    await plan_service.restore_plan_version(db, user_id, 1)

    current = await plan_service.get_current_plan(db, user_id)
    assert current.plan.phases[0].weeks[0].sessions[0].type == "test"
    link = await plan_completion_service.get_session_link(db, user_id, 1, Weekday.TUESDAY)
    assert link.linked is not None  # and now it points at the test session again


async def test_restore_carries_the_week_overrides(db):
    """Overrides are keyed by plan version. Without copying them a restore puts
    the plan back but not the week — every move and duration edit gone."""
    from app.services import plan_moves_service

    user_id = await _seed_user(db)
    start = _monday()
    await _insert_version(db, user_id, 1, plan=_plan("V1"), start=start)
    await plan_moves_service.move_session(db, user_id, 1, Weekday.TUESDAY, Weekday.THURSDAY)
    await plan_moves_service.set_session_duration(db, user_id, 1, Weekday.THURSDAY, "primary", 70)
    await _insert_version(db, user_id, 2, plan=_plan("V2"), start=start)

    await plan_service.restore_plan_version(db, user_id, 1)

    current = await plan_service.get_current_plan(db, user_id)
    session = current.plan.phases[0].weeks[0].sessions[0]
    assert session.day == Weekday.THURSDAY  # the move came back
    assert session.duration_min == 70  # and so did the duration edit


async def test_restoring_a_cancelled_version_reactivates_it(db):
    user_id = await _seed_user(db)
    await _insert_version(db, user_id, 1, plan=_plan("V1"), start=_monday())
    await plan_service.cancel_current_plan(db, user_id)
    assert await plan_service.get_current_plan(db, user_id) is None

    await plan_service.restore_plan_version(db, user_id, 1)

    current = await plan_service.get_current_plan(db, user_id)
    assert current is not None
    assert current.plan.goal.description == "V1"


async def test_restoring_an_unknown_version_raises(db):
    user_id = await _seed_user(db)
    await _insert_version(db, user_id, 1, plan=_plan("V1"), start=_monday())

    with pytest.raises(plan_service.PlanVersionNotFoundError):
        await plan_service.restore_plan_version(db, user_id, 99)


async def test_restore_endpoint(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    me = await db.users.find_one({"email": "a@b.com"})
    user_id = str(me["_id"])
    await _insert_version(db, user_id, 1, plan=_plan("Le bon"), start=_monday())
    await _insert_version(db, user_id, 2, plan=_plan("Le regénéré"), start=_monday())

    response = await client.post("/api/v1/plans/versions/1/restore", headers=headers)

    assert response.status_code == 200
    assert response.json()["plan"]["goal"]["description"] == "Le bon"

    missing = await client.post("/api/v1/plans/versions/99/restore", headers=headers)
    assert missing.status_code == 404


async def test_restore_endpoint_requires_auth(client):
    assert (await client.post("/api/v1/plans/versions/1/restore")).status_code == 401


async def test_restore_carries_the_estimate_confidence(db):
    """The confidence qualifies the chrono shown on the card. A restored plan
    that dropped it would show the same number with more authority than the plan
    it came from."""
    user_id = await _seed_user(db)
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": _plan("V1").model_dump(mode="json"),
            "request": _REQUEST,
            "start_date": _monday().isoformat(),
            "estimated_time_min": 110,
            "estimated_time_confidence": "low",
            "created_at": datetime.now(UTC),
        }
    )
    await _insert_version(db, user_id, 2, plan=_plan("V2"), start=_monday())

    restored = await plan_service.restore_plan_version(db, user_id, 1)

    assert restored.estimated_time_min == 110
    assert restored.estimated_time_confidence == "low"
