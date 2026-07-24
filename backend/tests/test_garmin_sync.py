from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import garminconnect

from app.core.crypto import encrypt_token_blob
from app.models.job import JobStatus
from app.services import garmin_sync_service, job_service

RUNNING_ACTIVITY = {
    "activityId": 111,
    "activityType": {"typeKey": "running"},
    "startTimeGMT": "2026-07-20 06:00:00",
    "duration": 1800.0,
    "distance": 5000.0,
    "averageHR": 150,
    "maxHR": 175,
}

PADEL_ACTIVITY = {
    "activityId": 222,
    "activityType": {"typeKey": "padel"},
    "startTimeGMT": "2026-07-19 18:00:00",
    "duration": 3600.0,
    "distance": None,
    "averageHR": 120,
    "maxHR": 160,
}


async def _seed_user_and_credentials(db) -> str:
    user_result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(user_result.inserted_id)
    await db.garmin_credentials.insert_one(
        {
            "user_id": user_id,
            "encrypted_tokens": encrypt_token_blob('{"di_token": "fake"}'),
            "needs_relogin": False,
            "connected_at": datetime.now(UTC),
        }
    )
    return user_id


async def test_run_activity_sync_success(db):
    user_id = await _seed_user_and_credentials(db)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY, PADEL_ACTIVITY], []]

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    job = await job_service.get_job(db, job_id, user_id)
    assert job.status == JobStatus.DONE
    assert job.result_summary == {"activities_synced": 2}

    activities = [doc async for doc in db.activities.find({"user_id": user_id})]
    assert len(activities) == 2
    by_id = {a["garmin_activity_id"]: a for a in activities}
    assert by_id[111]["sport"] == "RUN"
    assert by_id[111]["duration_s"] == 1800
    assert by_id[111]["distance_m"] == 5000.0
    assert by_id[222]["sport"] == "PADEL"
    assert by_id[222]["distance_m"] is None
    assert by_id[111]["training_load"] is None  # computed later by load_service
    assert "raw" in by_id[111]

    credentials = await db.garmin_credentials.find_one({"user_id": user_id})
    assert credentials["last_sync_at"] is not None


def test_ensure_display_name_backfills_from_social_profile():
    """A token-restored client has no display_name; without it every wellness
    URL 403s. It must be backfilled from the social profile."""
    client = MagicMock()
    client.display_name = None
    client.client.connectapi.return_value = {"displayName": "abc-123", "fullName": "Al"}

    garmin_sync_service._ensure_display_name(client)

    assert client.display_name == "abc-123"
    client.client.connectapi.assert_called_once_with("/userprofile-service/socialProfile")


def test_ensure_display_name_noop_when_already_set():
    client = MagicMock()
    client.display_name = "already-here"

    garmin_sync_service._ensure_display_name(client)

    client.client.connectapi.assert_not_called()


async def test_sync_stores_fitness_profile_from_garmin(db):
    """HRmax/HRrest are probed from Garmin's profile payloads and stored so the
    load engine can compute zones. Field names vary across accounts, so the
    probe is by key-substring, not a fixed path."""
    user_id = await _seed_user_and_credentials(db)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]
    # HRmax lives in profile settings; HRrest lives in the daily wellness summary.
    mock_instance.get_userprofile_settings.return_value = {"userData": {"maxHeartRate": 192}}
    mock_instance.get_user_summary.return_value = {"lastSevenDaysAvgRestingHeartRate": 48}

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    profile = await db.fitness_profiles.find_one({"user_id": user_id})
    assert profile["hr_max"] == 192
    assert profile["hr_rest"] == 48


async def test_sync_falls_back_to_observed_max_hr(db):
    """When Garmin exposes no HRmax field, the highest recorded activity maxHR
    is a sound fallback lower bound."""
    user_id = await _seed_user_and_credentials(db)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY, PADEL_ACTIVITY], []]
    # No usable HR anywhere: empty profile settings and empty wellness summary.
    mock_instance.get_userprofile_settings.return_value = {}
    mock_instance.get_user_profile.return_value = {}
    mock_instance.get_user_summary.return_value = {}
    mock_instance.get_heart_rates.return_value = {}

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    profile = await db.fitness_profiles.find_one({"user_id": user_id})
    assert profile["hr_max"] == 175  # highest maxHR across the two activities
    assert "hr_rest" not in profile  # never invented


async def test_run_activity_sync_is_idempotent(db):
    """A resync must upsert, never duplicate (garmin-sync skill)."""
    user_id = await _seed_user_and_credentials(db)

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]
    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        job_id_1 = await job_service.create_job(db, user_id, "garmin_activity_sync")
        await garmin_sync_service.run_activity_sync(db, user_id, job_id_1)

    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]
    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        job_id_2 = await job_service.create_job(db, user_id, "garmin_activity_sync")
        await garmin_sync_service.run_activity_sync(db, user_id, job_id_2)

    activities = [doc async for doc in db.activities.find({"user_id": user_id})]
    assert len(activities) == 1


async def test_run_activity_sync_missing_credentials(db):
    job_id = await job_service.create_job(db, "no-such-user", "garmin_activity_sync")

    await garmin_sync_service.run_activity_sync(db, "no-such-user", job_id)

    job = await job_service.get_job(db, job_id, "no-such-user")
    assert job.status == JobStatus.FAILED


async def test_run_activity_sync_marks_needs_relogin_on_auth_failure(db):
    user_id = await _seed_user_and_credentials(db)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = garminconnect.GarminConnectAuthenticationError(
        "expired"
    )

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    job = await job_service.get_job(db, job_id, user_id)
    assert job.status == JobStatus.FAILED

    credentials = await db.garmin_credentials.find_one({"user_id": user_id})
    assert credentials["needs_relogin"] is True


async def test_sync_now_skips_when_recent(db):
    user_id = await _seed_user_and_credentials(db)
    await db.garmin_credentials.update_one(
        {"user_id": user_id}, {"$set": {"last_sync_at": datetime.now(UTC) - timedelta(minutes=2)}}
    )
    # A complete profile means the normal throttle applies.
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})

    result = await garmin_sync_service.sync_now(db, user_id)

    assert result is None


async def test_sync_now_bypasses_throttle_until_profile_complete(db):
    """A recent sync must not block backfilling a missing HR profile — without
    it the load engine can never leave 'low confidence'."""
    user_id = await _seed_user_and_credentials(db)
    await db.garmin_credentials.update_one(
        {"user_id": user_id}, {"$set": {"last_sync_at": datetime.now(UTC) - timedelta(minutes=2)}}
    )  # recent — would normally skip, but there's no fitness_profiles doc yet

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]
    mock_instance.get_userprofile_settings.return_value = {"maxHeartRate": 190}
    mock_instance.get_user_summary.return_value = {"restingHeartRate": 50}

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        result = await garmin_sync_service.sync_now(db, user_id)

    assert result is not None
    assert result.status == JobStatus.DONE
    profile = await db.fitness_profiles.find_one({"user_id": user_id})
    assert profile["hr_max"] == 190
    assert profile["hr_rest"] == 50


async def test_sync_now_runs_and_returns_finished_job(db):
    user_id = await _seed_user_and_credentials(db)

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        job = await garmin_sync_service.sync_now(db, user_id)

    assert job is not None
    assert job.status == JobStatus.DONE
    assert job.result_summary == {"activities_synced": 1}


async def test_sync_endpoint_runs_synchronously(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]
    user = await db.users.find_one({"email": "a@b.com"})
    user_id = str(user["_id"])

    await db.garmin_credentials.insert_one(
        {
            "user_id": user_id,
            "encrypted_tokens": encrypt_token_blob('{"di_token": "fake"}'),
            "needs_relogin": False,
            "connected_at": datetime.now(UTC),
        }
    )

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY, PADEL_ACTIVITY], []]

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        response = await client.post(
            "/api/v1/garmin/sync", headers={"Authorization": f"Bearer {access_token}"}
        )

    assert response.status_code == 200
    assert response.json() == {"status": "done", "activities_synced": 2, "error_message": None}


async def test_sync_endpoint_skips_when_no_credentials(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]

    response = await client.post(
        "/api/v1/garmin/sync", headers={"Authorization": f"Bearer {access_token}"}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "skipped"


async def test_activities_endpoint_lists_synced_activities(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]

    # Find the user id FastAPI actually created, not a separately-seeded one.
    user = await db.users.find_one({"email": "a@b.com"})
    user_id = str(user["_id"])
    await db.activities.insert_one(
        {
            "garmin_activity_id": 111,
            "user_id": user_id,
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 1800,
            "distance_m": 5000.0,
            "avg_hr": 150,
            "max_hr": 175,
            "training_load": None,
            "raw": {"secret": "never-exposed"},
        }
    )

    response = await client.get(
        "/api/v1/activities", headers={"Authorization": f"Bearer {access_token}"}
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["garmin_activity_id"] == 111
    assert "raw" not in body[0]
    assert "user_id" not in body[0]


async def test_job_endpoint_requires_ownership(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]

    other_job_id = await job_service.create_job(db, "someone-else", "garmin_activity_sync")

    response = await client.get(
        f"/api/v1/jobs/{other_job_id}", headers={"Authorization": f"Bearer {access_token}"}
    )

    assert response.status_code == 404
