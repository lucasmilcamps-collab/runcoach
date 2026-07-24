from datetime import UTC, datetime

from app.services import fitness_service


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def test_no_profile_yields_empty_series(db):
    user_id = await _seed_user(db)
    await db.activities.insert_one(
        {
            "garmin_activity_id": 1,
            "user_id": user_id,
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": 134,
        }
    )

    result = await fitness_service.compute_fitness(db, user_id)

    assert result.has_profile is False
    assert result.low_confidence is True
    assert result.series == []
    assert result.ctl == 0.0


async def test_profile_but_no_hr_activities_is_low_confidence(db):
    user_id = await _seed_user(db)
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    # An activity with no avg_hr can't produce TRIMP → no load.
    await db.activities.insert_one(
        {
            "garmin_activity_id": 1,
            "user_id": user_id,
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": None,
        }
    )

    result = await fitness_service.compute_fitness(db, user_id)

    assert result.has_profile is True
    assert result.low_confidence is True
    assert result.series == []


async def test_single_z2_hour_seeds_ctl(db):
    """One 60-min Z2 run (avg 134 bpm on HRmax190/HRrest50) is 120 TRIMP.
    With a single day of history the seed = that load, so CTL=ATL=120, TSB=0."""
    user_id = await _seed_user(db)
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    await db.activities.insert_one(
        {
            "garmin_activity_id": 1,
            "user_id": user_id,
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": 134,
        }
    )

    result = await fitness_service.compute_fitness(db, user_id)

    assert result.has_profile is True
    assert result.ctl == 120.0
    assert result.atl == 120.0
    assert result.tsb == 0.0
    assert len(result.series) == 1
    assert result.series[-1].load == 120.0


async def test_cross_training_counts_toward_load(db):
    """Product truth: a padel session adds load just like a run."""
    user_id = await _seed_user(db)
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    now = datetime.now(UTC)
    await db.activities.insert_many(
        [
            {
                "garmin_activity_id": 1,
                "user_id": user_id,
                "sport": "RUN",
                "start_time": now,
                "duration_s": 3600,
                "avg_hr": 134,  # Z2 → 120
            },
            {
                "garmin_activity_id": 2,
                "user_id": user_id,
                "sport": "PADEL",
                "start_time": now,
                "duration_s": 1800,
                "avg_hr": 162,  # Z4 → 30min × 4 = 120
            },
        ]
    )

    result = await fitness_service.compute_fitness(db, user_id)

    # Same-day loads sum: 120 + 120 = 240.
    assert result.series[-1].load == 240.0
    assert result.ctl == 240.0


async def test_only_own_activities_count(db):
    """Every query is scoped by user_id — another user's load never leaks in."""
    user_id = await _seed_user(db)
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    await db.activities.insert_one(
        {
            "garmin_activity_id": 99,
            "user_id": "someone-else",
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": 134,
        }
    )

    result = await fitness_service.compute_fitness(db, user_id)

    assert result.series == []
    assert result.ctl == 0.0


async def test_set_manual_profile_makes_has_profile_true(db):
    user_id = await _seed_user(db)
    await db.activities.insert_one(
        {
            "garmin_activity_id": 1,
            "user_id": user_id,
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": 134,
        }
    )

    await fitness_service.set_manual_profile(db, user_id, hr_max=190, hr_rest=50)
    result = await fitness_service.compute_fitness(db, user_id)

    assert result.has_profile is True
    assert result.manual is True
    assert result.ctl == 120.0


async def test_manual_profile_survives_garmin_sync(db):
    """A Garmin sync must never overwrite athlete-entered HR values."""
    from unittest.mock import MagicMock

    from app.services import garmin_sync_service

    await fitness_service.set_manual_profile(db, "u1", hr_max=188, hr_rest=44)

    client_mock = MagicMock()
    client_mock.get_userprofile_settings.return_value = {"maxHeartRate": 200}
    client_mock.get_user_summary.return_value = {"restingHeartRate": 60}

    await garmin_sync_service._update_fitness_profile(db, "u1", client_mock, [])

    profile = await db.fitness_profiles.find_one({"user_id": "u1"})
    assert profile["hr_max"] == 188  # unchanged
    assert profile["hr_rest"] == 44


async def test_profile_endpoint_sets_and_returns_fitness(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]

    response = await client.put(
        "/api/v1/fitness/profile",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"hr_max": 190, "hr_rest": 50},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["has_profile"] is True
    assert body["manual"] is True
    assert body["hr_max"] == 190


async def test_profile_endpoint_rejects_impossible_values(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]

    response = await client.put(
        "/api/v1/fitness/profile",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"hr_max": 60, "hr_rest": 55},  # below floor + reserve too small
    )

    assert response.status_code == 422


async def test_fitness_endpoint_returns_shape(client, db):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]
    user = await db.users.find_one({"email": "a@b.com"})
    user_id = str(user["_id"])

    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    await db.activities.insert_one(
        {
            "garmin_activity_id": 1,
            "user_id": user_id,
            "sport": "RUN",
            "start_time": datetime.now(UTC),
            "duration_s": 3600,
            "avg_hr": 134,
        }
    )

    response = await client.get(
        "/api/v1/fitness", headers={"Authorization": f"Bearer {access_token}"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["has_profile"] is True
    assert body["hr_max"] == 190
    assert body["ctl"] == 120.0
    assert len(body["series"]) == 1
