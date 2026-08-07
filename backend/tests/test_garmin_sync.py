from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import garminconnect
import pytest

from app.core.crypto import encrypt_token_blob
from app.models.job import JobStatus
from app.services import garmin_sync_service, job_service


@pytest.fixture(autouse=True)
def _no_rate_limit_sleep():
    """The rate-limit sleeps (activity paging + wellness backfill) must not slow
    the suite down. Patch them out for every test in this module."""
    with patch("app.services.garmin_sync_service.time.sleep"):
        yield


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


# --- Wellness (HRV / sleep / resting HR / Body Battery) --------------------

HRV_PAYLOAD = {"hrvSummary": {"lastNightAvg": 45}}
SLEEP_PAYLOAD = {
    "dailySleepDTO": {"sleepTimeSeconds": 25200, "sleepScores": {"overall": {"value": 80}}}
}
RHR_PAYLOAD = {"allMetrics": {"metricsMap": {"WELLNESS_RESTING_HEART_RATE": [{"value": 52.0}]}}}


def test_extract_hrv():
    assert garmin_sync_service._extract_hrv(HRV_PAYLOAD) == 45
    assert garmin_sync_service._extract_hrv({"hrvSummary": {}}) is None
    assert garmin_sync_service._extract_hrv(None) is None


def test_extract_sleep():
    assert garmin_sync_service._extract_sleep_seconds(SLEEP_PAYLOAD) == 25200
    assert garmin_sync_service._extract_sleep_score(SLEEP_PAYLOAD) == 80
    assert garmin_sync_service._extract_sleep_seconds({"dailySleepDTO": {}}) is None


def test_extract_rhr():
    assert garmin_sync_service._extract_rhr(RHR_PAYLOAD) == 52
    assert garmin_sync_service._extract_rhr({}) is None


def test_extract_body_battery_takes_daily_high():
    payload = [
        {
            "date": "2026-07-23",
            "bodyBatteryValuesArray": [
                [1690000000000, "MEASURED", 55],
                [1690000600000, "MEASURED", 80],
            ],
        }
    ]
    assert garmin_sync_service._extract_body_battery_by_date(payload) == {"2026-07-23": 80}
    assert garmin_sync_service._extract_body_battery_by_date({}) == {}


async def test_sync_wellness_stores_daily_records(db):
    user_id = await _seed_user_and_credentials(db)

    mock = MagicMock()
    mock.get_hrv_data.return_value = HRV_PAYLOAD
    mock.get_sleep_data.return_value = SLEEP_PAYLOAD
    mock.get_rhr_day.return_value = RHR_PAYLOAD
    mock.get_body_battery.return_value = []

    stored = await garmin_sync_service.sync_wellness(db, user_id, mock)

    # 30-day window is inclusive of both ends → 31 days, all fetched first time.
    assert stored == 31
    today = datetime.now(UTC).date().isoformat()
    doc = await db.wellness_daily.find_one({"user_id": user_id, "day": today})
    assert doc["hrv"] == 45
    assert doc["sleep_seconds"] == 25200
    assert doc["sleep_score"] == 80
    assert doc["resting_hr"] == 52


async def test_sync_wellness_is_incremental(db):
    user_id = await _seed_user_and_credentials(db)
    today = datetime.now(UTC).date()
    for i in range(31):
        await db.wellness_daily.insert_one(
            {
                "user_id": user_id,
                "day": (today - timedelta(days=i)).isoformat(),
                "hrv": 40,
            }
        )

    mock = MagicMock()
    mock.get_hrv_data.return_value = {"hrvSummary": {"lastNightAvg": 50}}
    mock.get_sleep_data.return_value = {}
    mock.get_rhr_day.return_value = {}
    mock.get_body_battery.return_value = []

    stored = await garmin_sync_service.sync_wellness(db, user_id, mock)

    # Only the last 3 days (today, −1, −2) are re-fetched; older days are skipped.
    assert stored == 3
    refreshed = await db.wellness_daily.find_one({"user_id": user_id, "day": today.isoformat()})
    assert refreshed["hrv"] == 50
    old = await db.wellness_daily.find_one(
        {"user_id": user_id, "day": (today - timedelta(days=10)).isoformat()}
    )
    assert old["hrv"] == 40  # untouched


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


# --- Time in zone (lot 7.1): the field fitness_service reads must be written ---

# Garmin's shape: only the LOW boundary per zone, so a band's ceiling is the
# next one's floor and the top zone is open-ended.
HR_TIME_IN_ZONES = [
    {"zoneNumber": 1, "secsInZone": 600.0, "zoneLowBoundary": 100},
    {"zoneNumber": 2, "secsInZone": 300.0, "zoneLowBoundary": 134},
    {"zoneNumber": 3, "secsInZone": 300.0, "zoneLowBoundary": 148},
    {"zoneNumber": 4, "secsInZone": 600.0, "zoneLowBoundary": 162},
    {"zoneNumber": 5, "secsInZone": 900.0, "zoneLowBoundary": 176},
]


def test_zone_bands_close_each_band_on_the_next_floor():
    bands = garmin_sync_service._zone_bands(HR_TIME_IN_ZONES)
    assert bands[0] == (100.0, 134.0, 600.0)
    assert bands[3] == (162.0, 176.0, 600.0)
    assert bands[4][1] == float("inf")  # top zone left open


def test_zone_bands_tolerates_garbage():
    assert garmin_sync_service._zone_bands(None) == []
    assert garmin_sync_service._zone_bands([{"zoneNumber": 1}]) == []


async def _seed_profile(db, user_id: str) -> None:
    await db.fitness_profiles.insert_one(
        {"user_id": user_id, "hr_max": 190, "hr_rest": 50, "manual": True}
    )


async def test_sync_stores_hr_zone_seconds_for_runs(db):
    """The gap lot 6.1 left: the field was read by fitness_service and written by
    nobody, so every activity fell back to average HR."""
    user_id = await _seed_user_and_credentials(db)
    await _seed_profile(db, user_id)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY, PADEL_ACTIVITY], []]
    mock_instance.get_activity_hr_in_timezones.return_value = HR_TIME_IN_ZONES

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    run = await db.activities.find_one({"garmin_activity_id": 111})
    zone_seconds = run["hr_zone_seconds"]
    assert len(zone_seconds) == 5
    # Redistribution conserves time: the 2700s Garmin reported across its zones
    # come back out spread over ours.
    assert sum(zone_seconds) == pytest.approx(2700.0)

    # Only runs pay the extra request: the padel session is left alone.
    padel = await db.activities.find_one({"garmin_activity_id": 222})
    assert padel.get("hr_zone_seconds") is None
    mock_instance.get_activity_hr_in_timezones.assert_called_once_with("111")


async def test_stored_zone_seconds_reach_the_fitness_engine(db):
    """End to end: sync → stored field → CTL built on the true Edwards TRIMP,
    which for an interval session is higher than the average-HR fallback."""
    from app.services import fitness_service

    user_id = await _seed_user_and_credentials(db)
    await _seed_profile(db, user_id)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]
    mock_instance.get_activity_hr_in_timezones.return_value = HR_TIME_IN_ZONES

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    with_zones = await fitness_service.compute_fitness(db, user_id)

    # Same activity without the field: the average-HR path the app used before.
    await db.activities.update_one({"garmin_activity_id": 111}, {"$unset": {"hr_zone_seconds": ""}})
    without_zones = await fitness_service.compute_fitness(db, user_id)

    assert with_zones.ctl > without_zones.ctl


async def test_zone_enrichment_skipped_without_a_complete_hr_profile(db):
    """No HRmax/HRrest → Garmin's zones can't be mapped onto ours, and we store
    nothing rather than a wrong distribution."""
    user_id = await _seed_user_and_credentials(db)
    await db.activities.insert_one(
        {
            "user_id": user_id,
            "sport": "RUN",
            "garmin_activity_id": 999,
            "start_time": datetime.now(UTC),
            "duration_s": 1800,
        }
    )
    mock_instance = MagicMock()

    enriched = await garmin_sync_service.enrich_run_zone_seconds(db, user_id, mock_instance)

    assert enriched == 0
    mock_instance.get_activity_hr_in_timezones.assert_not_called()


async def test_zone_enrichment_only_fetches_activities_missing_the_field(db):
    """A re-sync must not re-buy zone data it already has: the per-sync request
    budget is the reason the backfill is progressive."""
    user_id = await _seed_user_and_credentials(db)
    await _seed_profile(db, user_id)
    now = datetime.now(UTC)
    await db.activities.insert_many(
        [
            {
                "user_id": user_id,
                "sport": "RUN",
                "garmin_activity_id": 1,
                "start_time": now,
                "duration_s": 1800,
                "hr_zone_seconds": [60.0, 60.0, 60.0, 60.0, 60.0],
            },
            {
                "user_id": user_id,
                "sport": "RUN",
                "garmin_activity_id": 2,
                "start_time": now - timedelta(days=1),
                "duration_s": 1800,
            },
        ]
    )
    mock_instance = MagicMock()
    mock_instance.get_activity_hr_in_timezones.return_value = HR_TIME_IN_ZONES

    enriched = await garmin_sync_service.enrich_run_zone_seconds(db, user_id, mock_instance)

    assert enriched == 1
    mock_instance.get_activity_hr_in_timezones.assert_called_once_with("2")


# --- Terrain, form and splits: what a session actually showed ---

SPLITS_PAYLOAD = {
    "lapDTOs": [
        {"distance": 1000.0, "duration": 300.0, "averageHR": 145, "elevationGain": 12.0},
        {"distance": 1000.0, "duration": 295.0, "averageHR": 152, "elevationGain": 4.0},
        {"distance": 420.0, "duration": 130.0, "averageHR": 160, "elevationGain": 0.0},
    ]
}


def test_map_activity_extracts_terrain_and_cadence():
    """Elevation was sitting unread in `raw` — without it a hilly long run reads
    as a pace regression."""
    mapped = garmin_sync_service._map_activity(
        "u1",
        {
            **RUNNING_ACTIVITY,
            "elevationGain": 210.5,
            "averageRunningCadenceInStepsPerMinute": 178.4,
        },
    )
    assert mapped["elevation_gain_m"] == 210.5
    assert mapped["avg_cadence_spm"] == 178.4


def test_map_activity_tolerates_missing_terrain():
    """A treadmill run reports no elevation; that must not drop the activity."""
    mapped = garmin_sync_service._map_activity("u1", RUNNING_ACTIVITY)
    assert mapped["elevation_gain_m"] is None
    assert mapped["avg_cadence_spm"] is None


def test_laps_keeps_real_distance_rather_than_assuming_a_kilometre():
    """Auto-lap can be off or set to miles, so pace must come from the
    distance/duration pair — never from an assumed 1000 m."""
    laps = garmin_sync_service._laps(SPLITS_PAYLOAD)
    assert [lap["index"] for lap in laps] == [1, 2, 3]
    assert laps[2]["distance_m"] == 420.0  # the trailing partial lap survives intact
    assert laps[0]["avg_hr"] == 145
    assert laps[0]["elevation_gain_m"] == 12.0


def test_laps_drops_rows_that_would_produce_an_infinite_pace():
    assert garmin_sync_service._laps(None) == []
    assert garmin_sync_service._laps({"lapDTOs": [{"distance": 0.0, "duration": 300.0}]}) == []
    assert garmin_sync_service._laps({"lapDTOs": [{"distance": 1000.0}]}) == []


async def test_enrich_splits_only_fills_runs_that_lack_them(db):
    user_id = await _seed_user_and_credentials(db)
    now = datetime.now(UTC)
    await db.activities.insert_many(
        [
            {
                "user_id": user_id,
                "sport": "RUN",
                "garmin_activity_id": 1,
                "start_time": now,
                "duration_s": 1800,
                "splits": [{"index": 1, "distance_m": 1000.0, "duration_s": 300}],
            },
            {
                "user_id": user_id,
                "sport": "RUN",
                "garmin_activity_id": 2,
                "start_time": now - timedelta(days=1),
                "duration_s": 1800,
            },
            {
                "user_id": user_id,
                "sport": "PADEL",
                "garmin_activity_id": 3,
                "start_time": now - timedelta(days=2),
                "duration_s": 3600,
            },
        ]
    )
    mock_instance = MagicMock()
    mock_instance.get_activity_splits.return_value = SPLITS_PAYLOAD

    enriched = await garmin_sync_service.enrich_run_splits(db, user_id, mock_instance)

    assert enriched == 1
    # Only the run missing the field pays a request — not the padel session, and
    # not the run that already has splits.
    mock_instance.get_activity_splits.assert_called_once_with("2")
    stored = await db.activities.find_one({"garmin_activity_id": 2})
    assert len(stored["splits"]) == 3


async def test_one_activity_without_splits_does_not_cost_the_others(db):
    """Per-activity guard, same contract as the zone enrichment: an old device
    or a lapless treadmill entry must not abort the batch."""
    user_id = await _seed_user_and_credentials(db)
    now = datetime.now(UTC)
    await db.activities.insert_many(
        [
            {
                "user_id": user_id,
                "sport": "RUN",
                "garmin_activity_id": 10,
                "start_time": now,
                "duration_s": 1800,
            },
            {
                "user_id": user_id,
                "sport": "RUN",
                "garmin_activity_id": 11,
                "start_time": now - timedelta(days=1),
                "duration_s": 1800,
            },
        ]
    )
    mock_instance = MagicMock()
    mock_instance.get_activity_splits.side_effect = [
        garminconnect.GarminConnectConnectionError("API Error 500 - boom"),
        SPLITS_PAYLOAD,
    ]

    enriched = await garmin_sync_service.enrich_run_splits(db, user_id, mock_instance)

    assert enriched == 1  # the second one still landed
    assert mock_instance.get_activity_splits.call_count == 2


async def test_sync_never_fails_when_splits_blow_up(db):
    """Splits are a nice-to-have: a Garmin hiccup there must not fail an
    otherwise-successful activity sync."""
    user_id = await _seed_user_and_credentials(db)
    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")

    mock_instance = MagicMock()
    mock_instance.get_activities.side_effect = [[RUNNING_ACTIVITY], []]
    mock_instance.get_activity_splits.side_effect = RuntimeError("garmin is having a moment")

    with patch("app.services.garmin_sync_service.garminconnect.Garmin", return_value=mock_instance):
        await garmin_sync_service.run_activity_sync(db, user_id, job_id)

    job = await job_service.get_job(db, job_id, user_id)
    assert job.status == JobStatus.DONE
    assert await db.activities.find_one({"garmin_activity_id": 111}) is not None
