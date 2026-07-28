from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.models.activity import SportType
from app.models.plan import (
    InjuryReport,
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


class _FakeStream:
    """Mimics the async context manager returned by client.messages.stream()."""

    def __init__(self, message):
        self._message = message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self._message


def _stream_mock(*messages) -> MagicMock:
    # client.messages.stream(...) is a sync call returning an async CM.
    return MagicMock(side_effect=[_FakeStream(m) for m in messages])


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
    mock_client = SimpleNamespace(messages=SimpleNamespace(stream=_stream_mock(*responses)))
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
    stream_mock = _stream_mock(
        _mock_response(_bad_plan_json()),  # first attempt violates ramp
        _mock_response(_valid_plan_json()),  # second is valid
    )
    mock_client = SimpleNamespace(messages=SimpleNamespace(stream=stream_mock))
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patch(
        "app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready"
    # Two model calls: the second replays the first attempt as a real assistant
    # turn, then the violations as user feedback (conversational history).
    assert stream_mock.call_count == 2
    second_messages = stream_mock.call_args_list[1].kwargs["messages"]
    assert len(second_messages) == 3
    assert second_messages[0]["role"] == "user"
    assert second_messages[1]["role"] == "assistant"
    assert "130" in second_messages[1]["content"]  # the rejected plan JSON
    assert second_messages[2]["role"] == "user"
    assert "viole" in second_messages[2]["content"]


async def test_generation_stops_when_deadline_exceeded(db):
    user_id = await _seed_user(db)
    stream_mock = _stream_mock(_mock_response(_bad_plan_json()))  # one violating attempt
    mock_client = SimpleNamespace(messages=SimpleNamespace(stream=stream_mock))

    # First monotonic() call sets the deadline; every later call is far past it,
    # so the second attempt is skipped before any model call.
    ticks = {"n": 0}

    def _clock() -> float:
        ticks["n"] += 1
        return 0.0 if ticks["n"] == 1 else 10_000.0

    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patch(
        "app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client
    ), patch("app.services.plan_service.time.monotonic", _clock):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "failed"
    assert stream_mock.call_count == 1  # never launched the doomed second attempt
    assert "temps" in (result.error_message or "").lower()


async def test_generate_plan_with_injury_passes_comeback_directive(db):
    user_id = await _seed_user(db)
    injury = InjuryReport(area="mollet droit", severity="douleur", days_off=10)
    stream_mock = _stream_mock(_mock_response(_valid_plan_json()))
    mock_client = SimpleNamespace(messages=SimpleNamespace(stream=stream_mock))
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patch(
        "app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client
    ):
        result = await plan_service.generate_plan(db, user_id, _request(), injury=injury)

    assert result.status == "ready"
    # The comeback directive (zone + days off) reached the prompt.
    prompt = stream_mock.call_args_list[0].kwargs["messages"][0]["content"]
    assert "BLESSURE DÉCLARÉE" in prompt
    assert "mollet droit" in prompt
    assert "10 jour" in prompt
    # And the injury is persisted on the new version for traceability.
    stored = await db.plans.find_one({"user_id": user_id})
    assert stored["injury"]["area"] == "mollet droit"
    assert stored["injury"]["days_off"] == 10


async def test_replan_injury_endpoint(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json()),  # initial plan
        _mock_response(_valid_plan_json()),  # injury comeback
    ):
        await client.post(
            "/api/v1/plans",
            headers={"Authorization": f"Bearer {token}"},
            json=_request().model_dump(mode="json"),
        )
        response = await client.post(
            "/api/v1/plans/replan-injury",
            headers={"Authorization": f"Bearer {token}"},
            json={"area": "genou gauche", "severity": "gene", "days_off": 5},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


async def test_replan_injury_requires_existing_plan(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    response = await client.post(
        "/api/v1/plans/replan-injury",
        headers={"Authorization": f"Bearer {token}"},
        json={"area": "cheville", "severity": "arret", "days_off": 14},
    )
    assert response.status_code == 404


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


async def test_list_plan_versions_infers_reason(db):
    user_id = await _seed_user(db)
    injury = InjuryReport(area="mollet", severity="douleur", days_off=7)
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json()),  # v1: initial
        _mock_response(_valid_plan_json()),  # v2: injury comeback
    ):
        await plan_service.generate_plan(db, user_id, _request())
        await plan_service.generate_plan(db, user_id, _request(), injury=injury)

    versions = await plan_service.list_plan_versions(db, user_id)

    assert [v.version for v in versions] == [2, 1]  # newest first
    assert versions[0].reason == "Reprise après blessure"
    assert versions[0].injury_area == "mollet"
    assert versions[1].reason == "Plan initial"
    assert versions[0].weeks_total == 4


async def test_get_plan_version_returns_that_version(db):
    user_id = await _seed_user(db)
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json()), _mock_response(_valid_plan_json())
    ):
        await plan_service.generate_plan(db, user_id, _request())
        await plan_service.generate_plan(db, user_id, _request())

    v1 = await plan_service.get_plan_version(db, user_id, 1)
    assert v1 is not None
    assert v1.plan is not None
    assert await plan_service.get_plan_version(db, user_id, 99) is None


async def test_versions_endpoint(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), _patched_client(
        _mock_response(_valid_plan_json())
    ):
        await client.post(
            "/api/v1/plans",
            headers={"Authorization": f"Bearer {token}"},
            json=_request().model_dump(mode="json"),
        )

    listing = await client.get(
        "/api/v1/plans/versions", headers={"Authorization": f"Bearer {token}"}
    )
    assert listing.status_code == 200
    assert listing.json()[0]["version"] == 1

    detail = await client.get(
        "/api/v1/plans/versions/1", headers={"Authorization": f"Bearer {token}"}
    )
    assert detail.status_code == 200
    assert detail.json()["plan"]["goal"]["description"] == "Semi"

    missing = await client.get(
        "/api/v1/plans/versions/42", headers={"Authorization": f"Bearer {token}"}
    )
    assert missing.status_code == 404


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


async def _seed_ready_plan(db, user_id: str, sessions_by_day: dict) -> None:
    from datetime import UTC, datetime, timedelta

    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday())  # Monday of this week
    sessions = [_s(day, stype, 45) for day, stype in sessions_by_day.items()]
    week = Week(index=1, is_deload=False, target_load=100.0, sessions=sessions)
    plan = Plan(goal=PlanGoal(description="Test"), phases=[Phase(name="base", weeks=[week])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "request": _request().model_dump(mode="json"),
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )


async def test_today_session_returns_todays_session(db):
    from datetime import UTC, datetime

    from app.models.plan import WEEKDAY_ORDER

    user_id = await _seed_user(db)
    today_weekday = WEEKDAY_ORDER[datetime.now(UTC).date().weekday()]
    await _seed_ready_plan(db, user_id, {today_weekday: "easy"})

    result = await plan_service.get_today_session(db, user_id)

    assert result.has_plan is True
    assert result.has_session is True
    assert result.week_index == 1
    assert result.session is not None
    assert result.session.type == "easy"
    # No HR profile → tsb 0 → session kept.
    assert result.adjustment is not None
    assert result.adjustment.adjusted is False


async def test_today_session_no_plan(db):
    user_id = await _seed_user(db)
    result = await plan_service.get_today_session(db, user_id)
    assert result.has_plan is False
    assert result.has_session is False


async def test_today_session_rest_day(db):
    from datetime import UTC, datetime, timedelta

    from app.models.plan import WEEKDAY_ORDER

    user_id = await _seed_user(db)
    # Put a session on a different weekday than today → today is a rest day.
    other = WEEKDAY_ORDER[(datetime.now(UTC).date() + timedelta(days=1)).weekday()]
    await _seed_ready_plan(db, user_id, {other: "tempo"})

    result = await plan_service.get_today_session(db, user_id)
    assert result.has_plan is True
    assert result.has_session is False


async def test_current_plan_endpoint_404_when_none(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    response = await client.get(
        "/api/v1/plans/current", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 404
