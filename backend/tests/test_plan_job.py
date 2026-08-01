"""Generation as a background job.

A 17-week plan is ~12.5k output tokens — three to six minutes of model time.
That never fitted an HTTP request, at any timeout, which is what a long series
of "budget dépassé" failures was really saying.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.models.job import JobStatus
from app.services import job_service, plan_service
from tests.test_plan_service import (
    _drain_jobs,
    _mock_response,
    _request,
    _seed_user,
    _valid_plan_dict,
)


def _patched(*responses):
    mock = AsyncMock(side_effect=list(responses))
    client = SimpleNamespace(messages=SimpleNamespace(create=mock))
    return patch("app.services.plan_service.anthropic.AsyncAnthropic", return_value=client), mock


async def test_start_generation_returns_immediately_then_completes(db):
    user_id = await _seed_user(db)
    patched, _ = _patched(_mock_response(_valid_plan_dict()))
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patched:
        job = await plan_service.start_generation(db, user_id, _request())
        # Queued, not run: the caller is not made to wait for minutes of model time.
        assert job.status in (JobStatus.PENDING, JobStatus.RUNNING)
        assert await db.plans.count_documents({}) == 0

        await _drain_jobs()

    finished = await job_service.get_job(db, job.id, user_id)
    assert finished.status == JobStatus.DONE
    stored = await db.plans.find_one({"user_id": user_id})
    assert stored["status"] == "ready"
    assert finished.result_summary["plan_id"] == str(stored["_id"])


async def test_a_failed_generation_surfaces_on_the_job(db):
    user_id = await _seed_user(db)
    with patch.object(plan_service.settings, "anthropic_api_key", ""):
        job = await plan_service.start_generation(db, user_id, _request())
        await _drain_jobs()

    finished = await job_service.get_job(db, job.id, user_id)
    assert finished.status == JobStatus.FAILED
    assert "clé API" in (finished.error_message or "")
    # The attempt is still on file — it is the athlete's record of what happened.
    assert await db.plans.count_documents({"user_id": user_id, "status": "failed"}) == 1


async def test_a_second_request_joins_the_running_job(db):
    """A double tap on "générer" should not buy two plans."""
    user_id = await _seed_user(db)
    patched, mock = _patched(_mock_response(_valid_plan_dict()))
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patched:
        first = await plan_service.start_generation(db, user_id, _request())
        second = await plan_service.start_generation(db, user_id, _request())
        assert second.id == first.id
        await _drain_jobs()

    assert mock.call_count == 1
    assert await db.plans.count_documents({}) == 1


async def test_a_finished_job_does_not_block_the_next_generation(db):
    user_id = await _seed_user(db)
    patched, _ = _patched(_mock_response(_valid_plan_dict()), _mock_response(_valid_plan_dict()))
    with patch.object(plan_service.settings, "anthropic_api_key", "sk-test"), patched:
        first = await plan_service.start_generation(db, user_id, _request())
        await _drain_jobs()
        second = await plan_service.start_generation(db, user_id, _request())
        await _drain_jobs()

    assert second.id != first.id
    assert await db.plans.count_documents({}) == 2


async def test_a_job_left_running_is_reported_failed_not_pending_forever(db):
    """If the process is recycled mid-generation, the row keeps saying RUNNING
    and the client polls a status that will never change."""
    user_id = await _seed_user(db)
    job_id = await job_service.create_job(db, user_id, plan_service.PLAN_JOB_TYPE)
    await job_service.update_job(db, job_id, JobStatus.RUNNING)
    await db.jobs.update_one(
        {"_id": (await db.jobs.find_one({"user_id": user_id}))["_id"]},
        {"$set": {"updated_at": datetime.now(UTC) - timedelta(hours=2)}},
    )

    job = await job_service.get_job(db, job_id, user_id)
    assert job.status == JobStatus.FAILED
    assert "interrompue" in (job.error_message or "")


async def test_a_recent_running_job_is_left_alone(db):
    user_id = await _seed_user(db)
    job_id = await job_service.create_job(db, user_id, plan_service.PLAN_JOB_TYPE)
    await job_service.update_job(db, job_id, JobStatus.RUNNING)

    job = await job_service.get_job(db, job_id, user_id)
    assert job.status == JobStatus.RUNNING


def test_the_budget_is_sized_for_a_real_plan():
    """Measured, not guessed: a 17-week plan is ~12.5k output tokens, 200-350s.
    The old 150s budget could not fit it at any per-attempt timeout."""
    assert plan_service._ANTHROPIC_TIMEOUT_S >= 360
    assert plan_service._TOTAL_DEADLINE_S > plan_service._ANTHROPIC_TIMEOUT_S
    # Still room for the cheap paths after a maxed-out generation.
    assert (
        plan_service._TOTAL_DEADLINE_S - plan_service._ANTHROPIC_TIMEOUT_S
        >= plan_service._REPAIR_RESERVE_S
    )
