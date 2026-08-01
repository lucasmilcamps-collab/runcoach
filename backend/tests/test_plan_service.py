import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.models.activity import SportType
from app.models.fitness import FitnessDay, FitnessResponse
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


def _valid_plan() -> Plan:
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
    return Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=weeks)],
    )


def _valid_plan_dict() -> dict:
    return _valid_plan().model_dump(mode="json")


def _bad_plan_dict() -> dict:
    # Same shape but week 2 ramps +30% — validate_plan will reject it.
    plan = _valid_plan()
    plan.phases[0].weeks[1].target_load = 130.0
    return plan.model_dump(mode="json")


def _mock_response(plan_dict: dict, tool_id: str = "toolu_1"):
    # The model returns the plan through the submit_plan tool (tool use).
    block = SimpleNamespace(type="tool_use", id=tool_id, name="submit_plan", input=plan_dict)
    return SimpleNamespace(stop_reason="tool_use", content=[block])


def _create_mock(*messages) -> AsyncMock:
    # client.messages.create(...) is an async call returning the message.
    return AsyncMock(side_effect=list(messages))


def _request() -> PlanRequest:
    return PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        min_run_sessions_per_week=2,  # fixtures have 2 key runs per normal week
        max_run_sessions_per_week=3,
    )


async def _seed_user(db) -> str:
    from datetime import UTC, datetime

    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


def _patched_client(*responses):
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=_create_mock(*responses)))
    return patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client)


def _no_repair():
    """Bypass the targeted-repair round. These tests are about the full
    regeneration retry and the time budget; repair has its own tests below."""

    async def _passthrough(client, system, plan, violations, *args):
        return plan, violations

    return patch("app.services.plan_service._repair_rounds", _passthrough)


async def test_generate_plan_success(db):
    user_id = await _seed_user(db)
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict())),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready"
    assert result.plan is not None
    stored = await db.plans.find_one({"user_id": user_id})
    assert stored["status"] == "ready"
    assert stored["version"] == 1


async def test_generate_plan_retries_on_violation(db):
    user_id = await _seed_user(db)
    create_mock = _create_mock(
        _mock_response(_bad_plan_dict()),  # first attempt violates ramp
        _mock_response(_valid_plan_dict()),  # second is valid
    )
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
        _no_repair(),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready"
    # Two model calls: the second replays the first attempt as a real assistant
    # turn, then the violations as user feedback (conversational history).
    assert create_mock.call_count == 2
    second_messages = create_mock.call_args_list[1].kwargs["messages"]
    assert len(second_messages) == 3
    assert second_messages[0]["role"] == "user"
    # Assistant turn replays the rejected plan as a tool_use block…
    assert second_messages[1]["role"] == "assistant"
    tool_use = second_messages[1]["content"][0]
    assert tool_use["type"] == "tool_use"
    assert tool_use["input"]["phases"][0]["weeks"][1]["target_load"] == 130.0
    # …and the violations come back as a tool_result.
    assert second_messages[2]["role"] == "user"
    tool_result = second_messages[2]["content"][0]
    assert tool_result["type"] == "tool_result"
    assert "viole" in tool_result["content"]


async def test_generation_stops_when_deadline_exceeded(db):
    user_id = await _seed_user(db)
    create_mock = _create_mock(_mock_response(_bad_plan_dict()))  # one violating attempt
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))

    # First monotonic() call sets the deadline; every later call is far past it,
    # so the second attempt is skipped before any model call.
    ticks = {"n": 0}

    def _clock() -> float:
        ticks["n"] += 1
        return 0.0 if ticks["n"] == 1 else 10_000.0

    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
        patch("app.services.plan_service.time.monotonic", _clock),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "failed"
    assert create_mock.call_count == 1  # never launched the doomed second attempt
    assert "temps" in (result.error_message or "").lower()


async def test_slow_first_attempt_still_leaves_room_for_a_second(db):
    """The regression the 160/160 pair caused: a first attempt that burned its
    whole per-call timeout left nothing for the correction round the validator
    exists to trigger."""
    user_id = await _seed_user(db)
    create_mock = _create_mock(
        _mock_response(_bad_plan_dict()),  # attempt 1: violates, and is slow
        _mock_response(_valid_plan_dict()),  # attempt 2: corrected
    )
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))

    # Clock: deadline set at 0, attempt 1 starts at 0 and the first call burns a
    # full _ANTHROPIC_TIMEOUT_S before attempt 2 is considered.
    ticks = iter([0.0, 0.0, plan_service._ANTHROPIC_TIMEOUT_S])

    def _clock() -> float:
        return next(ticks, plan_service._ANTHROPIC_TIMEOUT_S)

    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
        patch("app.services.plan_service.time.monotonic", _clock),
        _no_repair(),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready", result.error_message
    assert create_mock.call_count == 2
    # Each attempt is capped by what's left of the global budget, so the total
    # never overruns _TOTAL_DEADLINE_S.
    timeouts = [call.kwargs["timeout"] for call in create_mock.call_args_list]
    assert timeouts[0] == plan_service._ANTHROPIC_TIMEOUT_S
    assert timeouts[1] == pytest.approx(
        plan_service._TOTAL_DEADLINE_S - plan_service._ANTHROPIC_TIMEOUT_S
    )
    assert sum(timeouts) <= plan_service._TOTAL_DEADLINE_S


def test_generation_budget_allows_more_than_one_attempt():
    """Guards the invariant, not the values: whatever they become, one attempt
    must not be able to swallow the whole budget."""
    assert plan_service._TOTAL_DEADLINE_S > plan_service._ANTHROPIC_TIMEOUT_S
    assert plan_service._MIN_ATTEMPT_S < (
        plan_service._TOTAL_DEADLINE_S - plan_service._ANTHROPIC_TIMEOUT_S
    )


def test_skill_documents_the_real_timeouts():
    """The plan-generator skill is what the next session reads as ground truth,
    so a constant changed here must not leave stale seconds documented there."""
    skill = (
        Path(__file__).resolve().parents[2] / ".claude" / "skills" / "plan-generator" / "SKILL.md"
    ).read_text(encoding="utf-8")
    line = next(line for line in skill.splitlines() if "deadline globale" in line)
    announced = [float(n) for n in re.findall(r"(\d+(?:\.\d+)?)\s*s\b", line)]
    assert plan_service._TOTAL_DEADLINE_S in announced
    assert plan_service._ANTHROPIC_TIMEOUT_S in announced


async def test_generate_plan_with_injury_passes_comeback_directive(db):
    user_id = await _seed_user(db)
    injury = InjuryReport(area="mollet droit", severity="douleur", days_off=10)
    create_mock = _create_mock(_mock_response(_valid_plan_dict()))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request(), injury=injury)

    assert result.status == "ready"
    # The comeback directive (zone + days off) reached the prompt.
    prompt = create_mock.call_args_list[0].kwargs["messages"][0]["content"]
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

    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(
            _mock_response(_valid_plan_dict()),  # initial plan
            _mock_response(_valid_plan_dict()),  # injury comeback
        ),
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
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict()), _mock_response(_valid_plan_dict())),
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
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(
            _mock_response(_valid_plan_dict()),  # v1: initial
            _mock_response(_valid_plan_dict()),  # v2: injury comeback
        ),
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
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict()), _mock_response(_valid_plan_dict())),
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

    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict())),
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

    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict())),
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
    assert len(result.sessions) == 1
    assert result.sessions[0].type == "easy"
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


# --- Lot 1: richer context ---


async def _seed_run(db, user_id: str, days_ago: int, duration_min: int, distance_km: float = 10.0):
    start = datetime.now(UTC) - timedelta(days=days_ago)
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": start,
            "duration_s": duration_min * 60,
            "distance_m": distance_km * 1000,
            "avg_hr": 150,
        }
    )


def _stub_fitness(load_per_day: float = 10.0, days: int = 28) -> FitnessResponse:
    today = datetime.now(UTC).date()
    series = [
        FitnessDay(day=today - timedelta(days=i), load=load_per_day, ctl=1.0, atl=1.0, tsb=0.0)
        for i in range(days)
    ]
    return FitnessResponse(
        has_profile=True,
        hr_max=190,
        hr_rest=50,
        manual=False,
        low_confidence=False,
        ctl=1.0,
        atl=1.0,
        tsb=0.0,
        series=series,
    )


async def test_build_context_run_metrics(db):
    user_id = await _seed_user(db)
    await _seed_run(db, user_id, 2, 40)  # this week
    await _seed_run(db, user_id, 9, 50)  # last week
    await _seed_run(db, user_id, 30, 60)  # 4 weeks ago

    ctx = await plan_service.build_context(db, user_id, fitness=_stub_fitness())

    assert ctx["days_since_last_run"] == 2
    assert ctx["longest_run_8w_min"] == 60
    assert len(ctx["weekly_run_minutes_8w"]) == 8
    assert ctx["weekly_run_minutes_8w"][7] == 40  # most recent week
    assert ctx["weekly_run_minutes_8w"][6] == 50
    assert sum(ctx["weekly_run_minutes_8w"]) == 150
    assert ctx["last_run"]["duration_min"] == 40
    # 28 days × 10 load / 4 weeks = 70
    assert ctx["avg_weekly_load_4w"] == 70.0


async def test_no_recent_run_triggers_detraining_directive(db):
    user_id = await _seed_user(db)
    await _seed_run(db, user_id, 30, 45)  # last run 30 days ago > 21

    create_mock = _create_mock(_mock_response(_valid_plan_dict()))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        await plan_service.generate_plan(db, user_id, _request())

    prompt = create_mock.call_args_list[0].kwargs["messages"][0]["content"]
    assert "REPRISE APRÈS INTERRUPTION" in prompt
    assert "30 jour" in prompt


async def test_compute_fitness_called_once_per_generation(db):
    user_id = await _seed_user(db)
    await _seed_run(db, user_id, 3, 40)

    real = plan_service.fitness_service.compute_fitness
    calls = {"n": 0}

    async def _spy(db_arg, uid):
        calls["n"] += 1
        return await real(db_arg, uid)

    create_mock = _create_mock(_mock_response(_valid_plan_dict()))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
        patch("app.services.fitness_service.compute_fitness", _spy),
    ):
        await plan_service.generate_plan(db, user_id, _request())

    assert calls["n"] == 1


# --- Lot 3: multiple today sessions + cross-training load ---


async def test_today_returns_primary_and_addon(db):
    from datetime import UTC, datetime, timedelta

    from app.models.plan import WEEKDAY_ORDER

    user_id = await _seed_user(db)
    today = datetime.now(UTC).date()
    start = today - timedelta(days=today.weekday())
    wd = WEEKDAY_ORDER[today.weekday()]
    run = Session(day=wd, sport=SportType.RUN, type="easy", duration_min=40, rationale="x")
    strength = Session(
        day=wd,
        sport=SportType.STRENGTH,
        type="strength",
        duration_min=20,
        slot="addon",
        priority="optional",
        rationale="x",
    )
    week = Week(index=1, is_deload=False, target_load=100.0, sessions=[run, strength])
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

    result = await plan_service.get_today_session(db, user_id)
    assert result.has_session is True
    assert len(result.sessions) == 2
    assert result.sessions[0].slot == "primary"
    assert any(s.type == "strength" for s in result.sessions)


async def test_cross_training_counts_in_fitness(db):
    """include_cross_training is a prompt flag only — other sports always feed
    CTL/ATL. A padel-only history still produces load."""
    user_id = await _seed_user(db)
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.PADEL,
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": 150,
        }
    )
    fitness = await plan_service.fitness_service.compute_fitness(db, user_id)
    assert fitness.atl > 0  # today's padel session created fatigue


def test_counts_directive_has_concrete_numbers():
    from app.models.plan import FixedSport

    req = PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        min_run_sessions_per_week=3,
        max_run_sessions_per_week=3,
        fixed_sports=[FixedSport(sport=SportType.BASKETBALL, day=Weekday.WEDNESDAY)],
    )
    directive = plan_service._counts_directive(req)
    assert "NE DÉPASSE JAMAIS 3" in directive
    assert "EXACTEMENT 3" in directive
    assert "CHAQUE semaine" in directive
    assert "BASKETBALL" in directive


async def test_truncated_response_fails_fast(db):
    user_id = await _seed_user(db)
    truncated = SimpleNamespace(
        stop_reason="max_tokens",
        content=[SimpleNamespace(type="tool_use", id="t", name="submit_plan", input={})],
    )
    create_mock = _create_mock(truncated)
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "failed"
    assert create_mock.call_count == 1  # no pointless retries on truncation
    assert "tronqu" in (result.error_message or "").lower()


async def test_generate_plan_computes_time_estimates(db):
    user_id = await _seed_user(db)
    # A fast 10k 10 days ago is the estimate basis. No HR profile → no initial-load
    # check (baseline 0) so the fixture plan validates cleanly.
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": datetime.now(UTC) - timedelta(days=10),
            "duration_s": 2400,  # 40:00
            "distance_m": 10000,
        }
    )
    from datetime import date

    req = PlanRequest(
        goal_type="race",
        distance_km=21.1,
        race_date=date.today() + timedelta(weeks=4),
        available_days=list(Weekday),
        min_run_sessions_per_week=2,
        max_run_sessions_per_week=3,
        target_time_min=70,  # ~1h10 half vs ~88 estimated → unrealistic
    )
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict())),
    ):
        result = await plan_service.generate_plan(db, user_id, req)

    assert result.status == "ready", result.error_message
    assert result.estimated_time_min is not None
    assert 84 <= result.estimated_time_min <= 92  # Riegel 10k 40:00 → ~88 for a half
    assert result.projected_time_min is not None
    assert result.feasibility_warning is not None  # 70 min is unrealistically fast

    stored = await plan_service.get_current_plan(db, user_id)
    assert stored.estimated_time_min == result.estimated_time_min


# --- Lot 5: test session ---


def test_test_directive_toggles_on_needs_test():
    assert "SÉANCE DE TEST" in plan_service._test_directive({"needs_test": True})
    assert plan_service._test_directive({"needs_test": False}) == ""


async def test_build_context_needs_test_without_history(db):
    user_id = await _seed_user(db)  # no run activities at all
    ctx = await plan_service.build_context(db, user_id, fitness=_stub_fitness())
    assert ctx["needs_test"] is True  # no measurable recent effort


async def test_build_context_no_test_with_recent_effort(db):
    user_id = await _seed_user(db)
    await _seed_run(db, user_id, 5, 25, distance_km=5.0)  # recent clean 5k
    ctx = await plan_service.build_context(db, user_id, fitness=_stub_fitness())
    assert ctx["needs_test"] is False


async def test_no_history_puts_test_directive_in_prompt(db):
    user_id = await _seed_user(db)  # no history → needs_test
    create_mock = _create_mock(_mock_response(_valid_plan_dict()))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        await plan_service.generate_plan(db, user_id, _request())
    prompt = create_mock.call_args_list[0].kwargs["messages"][0]["content"]
    assert "SÉANCE DE TEST" in prompt


# --- Lot 6.3: unlogged strength reminder ---


async def test_unlogged_strength_reminder(db):
    from app.models.plan import WEEKDAY_ORDER

    user_id = await _seed_user(db)
    yesterday = datetime.now(UTC).date() - timedelta(days=1)
    start = yesterday - timedelta(days=yesterday.weekday())  # Monday of yesterday's week
    strength = Session(
        day=WEEKDAY_ORDER[yesterday.weekday()],
        sport=SportType.STRENGTH,
        type="strength",
        duration_min=20,
        slot="addon",
        priority="optional",
        rationale="x",
    )
    week = Week(index=1, is_deload=False, target_load=100.0, sessions=[strength])
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=[week])])
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

    assert await plan_service.unlogged_strength(db, user_id) is True  # planned, not logged

    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.STRENGTH,
            "manual": True,
            "start_time": datetime(yesterday.year, yesterday.month, yesterday.day, 18, tzinfo=UTC),
            "duration_s": 1200,
        }
    )
    assert await plan_service.unlogged_strength(db, user_id) is False  # now logged


async def test_incoherent_session_bounds_return_a_readable_message(client):
    """min > max used to reach the model, fail validation three times, and come
    back as "plan invalide" — the athlete could not tell what to change."""
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    response = await client.post(
        "/api/v1/plans",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "goal_type": "distance",
            "distance_km": 21.1,
            "available_days": ["TUESDAY", "THURSDAY", "SATURDAY"],
            "min_run_sessions_per_week": 4,
            "max_run_sessions_per_week": 2,
        },
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "VALIDATION_ERROR"
    assert "minimum" in detail["message"].lower()


async def test_implausible_source_effort_lowers_the_estimate_confidence(db):
    """A GPS-mangled run would otherwise set the paces for the whole plan with
    no signal that it is suspect (lot 7.5)."""
    user_id = await _seed_user(db)
    base = datetime.now(UTC) - timedelta(days=3)
    # Five ordinary 10k at ~50:00 (5:00/km) and one "10k" at 30:00 (3:00/km).
    for index in range(5):
        await db.activities.insert_one(
            {
                "user_id": user_id,
                "sport": SportType.RUN,
                "start_time": base - timedelta(days=index * 3),
                "duration_s": 3000,
                "distance_m": 10000,
            }
        )
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": base,
            "duration_s": 1800,
            "distance_m": 10000,
        }
    )

    context = await plan_service.build_context(db, user_id)
    assert context["best_recent_effort"]["pace_implausible"] is True

    from datetime import date

    req = PlanRequest(
        goal_type="race",
        distance_km=21.1,
        race_date=date.today() + timedelta(weeks=4),
        available_days=list(Weekday),
        min_run_sessions_per_week=2,
        max_run_sessions_per_week=3,
    )
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(_mock_response(_valid_plan_dict())),
    ):
        result = await plan_service.generate_plan(db, user_id, req)

    assert result.status == "ready", result.error_message
    # The estimate still exists — it is flagged, not discarded.
    assert result.estimated_time_min is not None


def test_fixed_sports_survive_the_cross_training_ban():
    """The failure this guards against: with cross-training off, the prompt said
    "add no cross_training session" while also demanding the athlete's basketball
    every week — and a fixed sport has no other type to be written as. The model
    dropped basketball, every attempt, until the time budget ran out."""
    from app.models.plan import FixedSport

    req = PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        include_cross_training=False,
        fixed_sports=[
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.FRIDAY, flexible=True),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.SATURDAY, flexible=True),
        ],
    )
    system = plan_service._system_prompt(req)
    counts = plan_service._counts_directive(req)

    # The ban is scoped to sessions the model would add on its own…
    assert "n'AJOUTE aucune séance de cross-training de ta propre initiative" in system
    # …and both places that mention fixed sports say how to encode one.
    assert system.count("type='cross_training'") >= 2
    assert "BASKETBALL" in counts
    assert "type='cross_training'" in counts


def test_missing_fixed_sport_violation_says_what_to_add():
    """The violations are replayed to the model as the retry instruction, so they
    have to be executable, not just descriptive."""
    from app.models.plan import FixedSport

    plan = _valid_plan()
    req = PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        min_run_sessions_per_week=2,
        max_run_sessions_per_week=3,
        fixed_sports=[FixedSport(sport=SportType.BASKETBALL, day=Weekday.FRIDAY)],
    )
    violations = plan_service.plan_validation.validate_plan(plan, req, datetime.now(UTC).date())

    missing = [v for v in violations if "BASKETBALL" in v]
    assert missing
    assert "type='cross_training'" in missing[0]
    assert "sport='SportType.BASKETBALL'" in missing[0] or "BASKETBALL'" in missing[0]


async def test_empty_tool_input_is_not_reported_as_a_schema_error(db):
    """The model called submit_plan with nothing in it. That used to degrade to
    `{}`, fail validation as "goal → Field required", and send both the retry and
    the athlete after a schema problem that never existed."""
    user_id = await _seed_user(db)
    empty = SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", id="t1", name="submit_plan", input={})],
    )
    create_mock = _create_mock(empty, _mock_response(_valid_plan_dict()))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    # The second attempt succeeds, and the first fed back an accurate reproach.
    assert result.status == "ready", result.error_message
    feedback = create_mock.call_args_list[1].kwargs["messages"][2]["content"][0]["content"]
    assert "sans aucun contenu" in feedback
    assert "plan ENTIER" in feedback
    assert "Field required" not in feedback


async def test_unparseable_tool_json_says_so(db):
    """A cut-off payload is the usual cause. Naming it beats "schéma non
    respecté", which is what the athlete used to be told."""
    user_id = await _seed_user(db)
    truncated_json = SimpleNamespace(
        stop_reason="tool_use",
        content=[
            SimpleNamespace(type="tool_use", id="t1", name="submit_plan", input='{"goal": {"desc')
        ],
    )
    # Every attempt hits the same wall — the budget isn't the limit here.
    create_mock = _create_mock(*[truncated_json] * plan_service._MAX_ATTEMPTS)
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "failed"
    message = result.error_message or ""
    assert "illisible" in message and "tronqu" in message
    assert "Field required" not in message


async def test_a_json_string_tool_input_is_still_accepted(db):
    """The defensive path that matters: some SDK paths hand back the arguments
    as a JSON string. A parseable one goes through untouched."""
    user_id = await _seed_user(db)
    as_string = SimpleNamespace(
        stop_reason="tool_use",
        content=[
            SimpleNamespace(
                type="tool_use",
                id="t1",
                name="submit_plan",
                input=json.dumps(_valid_plan_dict()),
            )
        ],
    )
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(as_string),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready", result.error_message


async def test_a_plan_wrapped_in_an_extra_key_is_accepted(db):
    """Asked for an object with `goal` and `phases`, the model sometimes wraps it
    — `{"plan": {...}}`. Validation then failed on both required fields at once,
    which reads exactly like an empty call and told the retry nothing useful."""
    user_id = await _seed_user(db)
    wrapped = _mock_response({"plan": _valid_plan_dict()})
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        _patched_client(wrapped),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready", result.error_message
    assert result.plan is not None


def test_unwrap_leaves_real_payloads_and_real_errors_alone():
    plan = _valid_plan_dict()
    assert plan_service._unwrapped(plan) is plan  # already at the root
    # A genuinely wrong payload must stay wrong rather than be massaged.
    junk = {"weeks": [1, 2, 3]}
    assert plan_service._unwrapped(junk) is junk
    # A wrapper whose contents aren't a plan is not unwrapped either.
    not_a_plan = {"data": {"foo": 1}}
    assert plan_service._unwrapped(not_a_plan) is not_a_plan


async def test_schema_error_reports_the_keys_that_did_arrive(db):
    """ "goal → Field required" says what is missing and nothing about what came
    instead — the half that identifies the mistake."""
    user_id = await _seed_user(db)
    wrong_shape = _mock_response({"semaines": [], "objectif": "semi"})
    create_mock = _create_mock(*[wrong_shape] * plan_service._MAX_ATTEMPTS)
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "failed"
    assert "clés reçues : objectif, semaines" in (result.error_message or "")
    feedback = create_mock.call_args_list[1].kwargs["messages"][2]["content"][0]["content"]
    assert "pas enveloppé" in feedback


def test_deload_weeks_are_listed_not_left_to_be_derived():
    """ "One deload per 4-week block" is a rule to apply four times over a
    16-week plan, and the model dropped the last one. A list of week numbers is
    something to copy instead."""
    from datetime import date as _date

    start = _date(2026, 8, 3)
    req = PlanRequest(
        goal_type="race",
        distance_km=42.2,
        race_date=start + timedelta(weeks=16),
        available_days=list(Weekday),
    )
    directive = plan_service._weeks_directive(req, start)
    assert "EXACTEMENT 16 semaines" in directive
    assert "4, 8, 12, 16" in directive
    assert "aucune autre" in directive


def test_impact_sport_names_the_days_quality_is_barred_from():
    """Holding "no quality the day after basket" in mind across sixteen weeks is
    what failed. The forbidden weekdays are derivable, so derive them."""
    from app.models.plan import FixedSport

    req = PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        fixed_sports=[
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.FRIDAY, flexible=True),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.SUNDAY, flexible=True),
        ],
    )
    directive = plan_service._counts_directive(req)
    assert "SATURDAY" in directive  # the day after Friday
    assert "MONDAY" in directive  # the day after Sunday
    assert "flexible" in directive


def test_no_impact_line_without_an_impact_sport():
    """A cycling commitment carries no impact, so the constraint isn't invented."""
    from app.models.plan import FixedSport

    req = PlanRequest(
        goal_type="distance",
        distance_km=21.1,
        available_days=list(Weekday),
        fixed_sports=[FixedSport(sport=SportType.BIKE, day=Weekday.WEDNESDAY)],
    )
    assert "sport à impacts" not in plan_service._counts_directive(req)


# --- Targeted repair: fix the flagged weeks, not the whole plan ---


def _repair_response(weeks: list[dict], tool_id: str = "rep_1"):
    block = SimpleNamespace(
        type="tool_use", id=tool_id, name="submit_weeks", input={"weeks": weeks}
    )
    return SimpleNamespace(stop_reason="tool_use", content=[block])


def test_violation_weeks_reads_the_indices():
    assert plan_service._violation_weeks(
        ["Semaine 3 : renforcement le FRIDAY…", "Semaine 12 : 3 séance(s)…"]
    ) == {3, 12}


def test_violation_weeks_refuses_plan_wide_problems():
    """A week count or an all-deload plan can't be fixed by rewriting weeks, so
    the caller must fall back to regenerating rather than silently drop it."""
    assert plan_service._violation_weeks(["Le plan compte 4 semaines mais il reste ~12"]) is None
    assert (
        plan_service._violation_weeks(["Semaine 2 : rampe", "Toutes les semaines sont deload"])
        is None
    )


async def test_repair_fixes_the_flagged_week_without_regenerating(db):
    """A 16-week plan costs a full generation to correct four weeks — more than
    the remaining budget allows. The repair sends those weeks out and splices
    the corrected ones back."""
    user_id = await _seed_user(db)
    fixed_week = _valid_plan().phases[0].weeks[1].model_dump(mode="json")
    create_mock = _create_mock(
        _mock_response(_bad_plan_dict()),  # week 2 ramps +30%
        _repair_response([fixed_week]),  # only week 2 comes back
    )
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready", result.error_message
    assert create_mock.call_count == 2  # generation + one small repair, no regeneration
    repair_call = create_mock.call_args_list[1]
    assert repair_call.kwargs["tools"][0]["name"] == "submit_weeks"
    prompt = repair_call.kwargs["messages"][0]["content"]
    assert "Semaine 2" in prompt or "S2 " in prompt  # the outline keeps it coherent
    assert '"index": 2' in prompt  # the week to fix went out in full
    assert '"index": 3' not in prompt  # the others did not
    # The splice landed on the stored plan.
    assert result.plan.phases[0].weeks[1].target_load == 108.0


async def test_repair_that_makes_things_worse_is_discarded(db):
    """A rewrite trading four violations for five would otherwise be adopted and
    then repaired again, drifting further each round."""
    user_id = await _seed_user(db)
    worse = _valid_plan().phases[0].weeks[1]
    worse.target_load = 400.0  # even further off the ramp
    create_mock = _create_mock(
        _mock_response(_bad_plan_dict()),
        _repair_response([worse.model_dump(mode="json")]),
        _mock_response(_valid_plan_dict()),  # falls back to a full regeneration
    )
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, _request())

    assert result.status == "ready", result.error_message
    assert result.plan.phases[0].weeks[1].target_load == 108.0


async def test_repair_is_skipped_for_a_plan_wide_violation(db):
    """Nothing to target, so no pointless call — straight to regeneration."""
    user_id = await _seed_user(db)
    short = _valid_plan_dict()  # 4 weeks, against a ~12-week race
    create_mock = _create_mock(_mock_response(short), _mock_response(short), _mock_response(short))
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=create_mock))
    from datetime import date as _date

    req = PlanRequest(
        goal_type="race",
        distance_km=21.1,
        race_date=_date.today() + timedelta(weeks=12),
        available_days=list(Weekday),
        min_run_sessions_per_week=2,
        max_run_sessions_per_week=3,
    )
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=mock_client),
    ):
        result = await plan_service.generate_plan(db, user_id, req)

    assert result.status == "failed"
    # Three full generations, no repair call in between.
    assert create_mock.call_count == plan_service._MAX_ATTEMPTS
    assert all(
        call.kwargs["tools"][0]["name"] == "submit_plan" for call in create_mock.call_args_list
    )


def test_splice_ignores_a_week_index_that_does_not_exist():
    plan = _valid_plan()
    stray = _valid_plan().phases[0].weeks[0]
    stray.index = 99
    assert plan_service._splice_weeks(plan, [stray]) == 0
    assert len(plan.phases[0].weeks) == 4  # nothing appended
