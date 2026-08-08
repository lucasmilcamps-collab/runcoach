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
    # And NO plan document. A failed attempt has no weeks; stored as a plan it
    # took the next version number and, being the newest document, took the place
    # of the plan the athlete was actually using. The job is the record.
    assert await db.plans.count_documents({"user_id": user_id}) == 0


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


async def test_job_timestamps_carry_their_timezone(db):
    """Mongo hands datetimes back naive, and a naive datetime serializes with no
    offset — which a browser reads as local time. The client shows how long a
    generation has been running off `created_at`, so a dropped timezone silently
    shifted that by the athlete's UTC offset."""
    user_id = await _seed_user(db)
    job_id = await job_service.create_job(db, user_id, plan_service.PLAN_JOB_TYPE)

    job = await job_service.get_job(db, job_id, user_id)
    assert job.created_at.tzinfo is not None
    assert job.updated_at.tzinfo is not None
    # And it is the instant it was written, not that instant reinterpreted.
    assert abs((datetime.now(UTC) - job.created_at).total_seconds()) < 60


async def test_a_finished_generation_notifies_the_athlete(db):
    """Minutes of spinner is the problem; a push is what lets the app be closed."""
    user_id = await _seed_user(db)
    patched, _ = _patched(_mock_response(_valid_plan_dict()))
    sent = AsyncMock(return_value=1)
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patched,
        patch("app.services.push_service.send_to_user", sent),
    ):
        await plan_service.start_generation(db, user_id, _request())
        await _drain_jobs()

    assert sent.await_count == 1
    notification = sent.await_args.args[2]
    assert notification.url == "/plan"
    assert "prêt" in notification.title


async def test_a_failed_generation_notifies_too(db):
    """Someone waiting on a plan that will never arrive needs to know at least
    as much as someone whose plan is ready."""
    user_id = await _seed_user(db)
    sent = AsyncMock(return_value=1)
    with (
        patch.object(plan_service.settings, "anthropic_api_key", ""),
        patch("app.services.push_service.send_to_user", sent),
    ):
        await plan_service.start_generation(db, user_id, _request())
        await _drain_jobs()

    assert sent.await_count == 1
    assert "interrompue" in sent.await_args.args[2].title


async def test_a_push_failure_never_fails_the_generation(db):
    """A browser that refused a notification is not a plan that didn't generate."""
    user_id = await _seed_user(db)
    patched, _ = _patched(_mock_response(_valid_plan_dict()))
    with (
        patch.object(plan_service.settings, "anthropic_api_key", "sk-test"),
        patched,
        patch(
            "app.services.push_service.send_to_user", AsyncMock(side_effect=RuntimeError("gone"))
        ),
    ):
        job = await plan_service.start_generation(db, user_id, _request())
        await _drain_jobs()

    finished = await job_service.get_job(db, job.id, user_id)
    assert finished.status == JobStatus.DONE
    assert await db.plans.count_documents({"user_id": user_id, "status": "ready"}) == 1
