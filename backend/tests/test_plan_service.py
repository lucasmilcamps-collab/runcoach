from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.models.activity import SportType
from app.models.plan import (
    Phase,
    Plan,
    PlanGoal,
    PlanRequest,
    Session,
    Week,
    Weekday,
)
from app.services import plan_service


def _s(day: Weekday, stype: str, duration: int) -> Session:
    return Session(day=day, sport=SportType.RUN, type=stype, duration_min=duration, rationale="x")


def _valid_plan_json() -> str:
    weeks = [
        Week(
            index=1,
            is_deload=False,
            target_load=100.0,
            sessions=[_s(Weekday.TUESDAY, "tempo", 45), _s(Weekday.SATURDAY, "long_run", 60)],
        ),
        Week(
            index=2,
            is_deload=False,
            target_load=108.0,
            sessions=[_s(Weekday.TUESDAY, "tempo", 45), _s(Weekday.SATURDAY, "long_run", 70)],
        ),
        Week(
            index=3,
            is_deload=False,
            target_load=116.0,
            sessions=[_s(Weekday.TUESDAY, "tempo", 45), _s(Weekday.SATURDAY, "long_run", 80)],
        ),
        Week(
            index=4,
            is_deload=True,
            target_load=80.0,
            sessions=[_s(Weekday.SATURDAY, "long_run", 60)],
        ),
    ]
    plan = Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=weeks)],
    )
    return plan.model_dump_json()


def _bad_plan_json() -> str:
    # Same shape but week 2 ramps +30% — validate_plan will reject it.
    plan = Plan.model_validate_json(_valid_plan_json())
    plan.phases[0].weeks[1].target_load = 130.0
    return plan.model_dump_json()


def _mock_response(text: str):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


def _request() -> PlanRequest:
    return PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        max_run_sessions_per_week=3,
    )


async def _seed_user(db) -> str:
    from datetime import UTC, datetime

    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


def _patched_client(*responses):
    create = AsyncMock(side_effect=list(responses))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    return patch(
        "app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client
    )


async def test_generate_plan_success(db):
    user_id = await _seed_user(db)
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json())
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready"
    assert result.plan is not None
    stored = await db.plans.find_one({"user_id": user_id})
    assert stored["status"] == "ready"
    assert stored["version"] == 1


async def test_generate_plan_retries_on_violation(db):
    user_id = await _seed_user(db)
    create_mock = AsyncMock(
        side_effect=[
            _mock_response(_bad_plan_json()),  # first attempt violates ramp
            _mock_response(_valid_plan_json()),  # second is valid
        ]
    )
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patch(
        "app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready"
    # Two model calls: the second carried the violations as feedback.
    assert create_mock.await_count == 2
    second_messages = create_mock.await_args_list[1].kwargs["messages"]
    assert any("viole" in m["content"] for m in second_messages if m["role"] == "user")


async def test_generate_plan_without_key_fails_gracefully(db):
    user_id = await _seed_user(db)
    with patch.object(plan_service.settings, "anthropic_api_key", ""):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "failed"
    assert "clé API" in (result.error_message or "")


async def test_get_current_plan_returns_latest_version(db):
    user_id = await _seed_user(db)
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json()), _mock_response(_valid_plan_json())
    ):
        await plan_service.generate_plan(db, user_id, _request())
        await plan_service.generate_plan(db, user_id, _request())

    current = await plan_service.get_current_plan(db, user_id)
    assert current is not None
    assert current.status == "ready"
    latest = await db.plans.find_one({"user_id": user_id}, sort=[("version", -1)])
    assert latest["version"] == 2


async def test_plans_endpoint_generates(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json())
    ):
        response = await client.post(
            "/api/v1/plans",
            headers={"Authorization": f"Bearer {token}"},
            json=_request().model_dump(mode="json"),
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["plan"]["phases"][0]["weeks"][0]["index"] == 1


async def test_current_plan_endpoint_404_when_none(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    response = await client.get(
        "/api/v1/plans/current", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
