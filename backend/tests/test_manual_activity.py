from datetime import UTC, datetime

from app.models.activity import ManualActivityCreate, SportType
from app.services import activity_service, fitness_service, load_service


def test_session_rpe_load_matches_reference():
    # Foster session-RPE: RPE × min / 10. RPE 8 for 60 min → 8*60/10 = 48.
    assert load_service.compute_session_rpe_load(3600, 8) == 48.0


def test_session_rpe_load_rejects_out_of_range():
    assert load_service.compute_session_rpe_load(3600, 0) is None
    assert load_service.compute_session_rpe_load(3600, 11) is None
    assert load_service.compute_session_rpe_load(3600, None) is None


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


async def test_create_and_list_manual_activity(db):
    user_id = await _seed_user(db)
    payload = ManualActivityCreate(
        sport=SportType.STRENGTH,
        start_time=datetime(2026, 7, 20, 18, 0, tzinfo=UTC),
        duration_min=45,
        rpe=7,
        note="Renfo",
    )

    created = await activity_service.create_manual_activity(db, user_id, payload)
    assert created.manual is True
    assert created.rpe == 7
    assert created.garmin_activity_id is None
    assert created.training_load == 45 * 7 / 10

    listed = await activity_service.list_activities(db, user_id)
    assert len(listed) == 1
    assert listed[0].manual is True
    assert listed[0].note == "Renfo"


async def test_delete_only_manual_activities(db):
    user_id = await _seed_user(db)
    # A Garmin-synced activity must not be deletable through this path.
    garmin = await db.activities.insert_one(
        {"user_id": user_id, "garmin_activity_id": 5, "sport": "RUN",
         "start_time": datetime.now(UTC), "duration_s": 1800, "manual": False}
    )
    manual = await activity_service.create_manual_activity(
        db,
        user_id,
        ManualActivityCreate(
            sport=SportType.RUN, start_time=datetime.now(UTC), duration_min=30, rpe=5
        ),
    )

    garmin_id = str(garmin.inserted_id)
    assert await activity_service.delete_manual_activity(db, user_id, garmin_id) is False
    assert await activity_service.delete_manual_activity(db, user_id, manual.id) is True
    assert await activity_service.delete_manual_activity(db, user_id, "not-an-id") is False


async def test_manual_rpe_session_counts_toward_fitness(db):
    user_id = await _seed_user(db)
    # A HR profile is required for the fitness computation at all.
    await db.fitness_profiles.insert_one({"user_id": user_id, "hr_max": 190, "hr_rest": 50})
    await activity_service.create_manual_activity(
        db,
        user_id,
        ManualActivityCreate(
            sport=SportType.PADEL,
            start_time=datetime.now(UTC),
            duration_min=60,
            rpe=8,
        ),
    )

    fitness = await fitness_service.compute_fitness(db, user_id)
    # The RPE session produced load, so the series is non-empty and CTL > 0.
    assert fitness.series
    assert fitness.ctl > 0


async def test_manual_activity_endpoints(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        "/api/v1/activities",
        headers=headers,
        json={
            "sport": "BIKE",
            "start_time": "2026-07-20T17:00:00Z",
            "duration_min": 50,
            "rpe": 6,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["manual"] is True
    assert "user_id" not in body
    activity_id = body["id"]

    deleted = await client.delete(f"/api/v1/activities/{activity_id}", headers=headers)
    assert deleted.status_code == 204

    missing = await client.delete(f"/api/v1/activities/{activity_id}", headers=headers)
    assert missing.status_code == 404
