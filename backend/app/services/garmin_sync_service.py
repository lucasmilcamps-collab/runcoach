import asyncio
import time
from datetime import UTC, datetime, timedelta

import garminconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.crypto import decrypt_token_blob
from app.models.activity import map_garmin_sport
from app.models.job import JobResponse, JobStatus
from app.services import job_service

SYNC_HISTORY_DAYS = 90  # needed to seed CTL — see training-science skill
SYNC_MIN_INTERVAL = timedelta(minutes=15)  # garmin-sync skill: rate-limit guard
_PAGE_SIZE = 20
_MAX_PAGES = 10  # safety cap: 200 activities per sync
_RATE_LIMIT_DELAY_S = 1.0


def _restore_client_sync(token_blob: str) -> garminconnect.Garmin:
    client = garminconnect.Garmin()
    client.client.loads(token_blob)
    return client


def _parse_garmin_datetime(value: str | None) -> datetime | None:
    """Garmin's *GMT fields are "yyyy-MM-dd HH:mm:ss" with no timezone suffix,
    implicitly UTC (garmin-sync skill: always use the *GMT fields)."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    except ValueError:
        return None


def _map_activity(user_id: str, raw: dict) -> dict | None:
    activity_id = raw.get("activityId")
    start_time = _parse_garmin_datetime(raw.get("startTimeGMT"))
    if activity_id is None or start_time is None:
        return None

    activity_type = raw.get("activityType") or {}
    duration = raw.get("duration")

    return {
        "garmin_activity_id": int(activity_id),
        "user_id": user_id,
        "sport": map_garmin_sport(activity_type.get("typeKey")),
        "start_time": start_time,
        "duration_s": int(duration) if duration is not None else 0,
        "distance_m": raw.get("distance"),
        "avg_hr": raw.get("averageHR"),
        "max_hr": raw.get("maxHR"),
        "training_load": None,  # computed later by load_service, never by Garmin
        "raw": raw,
    }


def _fetch_activities_sync(client: garminconnect.Garmin, cutoff: datetime) -> list[dict]:
    """Runs in a worker thread (garminconnect is synchronous). Paginates
    until the cutoff, an empty page, or the safety cap — whichever comes
    first — sleeping between pages to stay under Garmin's informal rate
    limit (garmin-sync skill: ~1 request/second)."""
    collected: list[dict] = []
    for page in range(_MAX_PAGES):
        batch = client.get_activities(page * _PAGE_SIZE, _PAGE_SIZE)
        if not batch:
            break
        collected.extend(batch)
        oldest_in_batch = _parse_garmin_datetime(batch[-1].get("startTimeGMT"))
        if len(batch) < _PAGE_SIZE or (oldest_in_batch and oldest_in_batch < cutoff):
            break
        time.sleep(_RATE_LIMIT_DELAY_S)
    return collected


async def run_activity_sync(db: AsyncIOMotorDatabase, user_id: str, job_id: str) -> None:
    """Fire-and-forget background job (asyncio.create_task) — must never
    raise, or the exception is only ever seen in asyncio's default logger."""
    await job_service.update_job(db, job_id, JobStatus.RUNNING)

    credentials = await db.garmin_credentials.find_one({"user_id": user_id})
    if credentials is None:
        await job_service.update_job(
            db, job_id, JobStatus.FAILED, error_message="Garmin non connecté."
        )
        return

    try:
        token_blob = decrypt_token_blob(credentials["encrypted_tokens"])
        client = await asyncio.to_thread(_restore_client_sync, token_blob)
        cutoff = datetime.now(UTC) - timedelta(days=SYNC_HISTORY_DAYS)
        raw_activities = await asyncio.to_thread(_fetch_activities_sync, client, cutoff)
    except garminconnect.GarminConnectAuthenticationError:
        # Never loop retries on an auth failure here — that's how Garmin
        # accounts get CAPTCHA'd or locked (garmin-sync skill).
        await db.garmin_credentials.update_one(
            {"user_id": user_id}, {"$set": {"needs_relogin": True}}
        )
        await job_service.update_job(
            db,
            job_id,
            JobStatus.FAILED,
            error_message="Connexion Garmin expirée, reconnectez votre compte.",
        )
        return
    except Exception as exc:  # noqa: BLE001 — a background job must never crash silently
        await job_service.update_job(db, job_id, JobStatus.FAILED, error_message=str(exc))
        return

    upserted = 0
    for raw in raw_activities:
        mapped = _map_activity(user_id, raw)
        if mapped is None:
            continue
        await db.activities.update_one(
            {"garmin_activity_id": mapped["garmin_activity_id"]},
            {"$set": mapped},
            upsert=True,
        )
        upserted += 1

    await db.garmin_credentials.update_one(
        {"user_id": user_id}, {"$set": {"last_sync_at": datetime.now(UTC)}}
    )
    await job_service.update_job(
        db, job_id, JobStatus.DONE, result_summary={"activities_synced": upserted}
    )


def _as_aware_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


async def sync_now(db: AsyncIOMotorDatabase, user_id: str) -> JobResponse | None:
    """Runs an activity sync synchronously and returns the finished job, or
    None when throttled (a sync already ran within SYNC_MIN_INTERVAL) or no
    Garmin connection exists.

    Deliberately synchronous rather than a background asyncio.create_task:
    on a free single-instance host the web process can be recycled at any
    time, which silently kills a fire-and-forget task mid-sync. Awaiting the
    work inside the request means the caller always learns the real outcome,
    and the upsert-by-id write makes a retry safe."""
    credentials = await db.garmin_credentials.find_one({"user_id": user_id})
    if credentials is None:
        return None

    last_sync_at = credentials.get("last_sync_at")
    if (
        last_sync_at is not None
        and datetime.now(UTC) - _as_aware_utc(last_sync_at) < SYNC_MIN_INTERVAL
    ):
        return None

    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")
    await run_activity_sync(db, user_id, job_id)
    return await job_service.get_job(db, job_id, user_id)
