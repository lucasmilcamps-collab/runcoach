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

# Plausible human heart-rate bounds (bpm). Used to reject garbage when probing
# Garmin's loosely-typed profile payloads for HRmax / HRrest.
_HR_MIN = 30
_HR_MAX_CEILING = 230
# Substrings (lowercased key names) that carry each value across Garmin's
# several profile/settings shapes. Order doesn't matter — we take the first
# plausible number found.
_HR_MAX_KEY_HINTS = ("maxheartrate", "maxhr", "lactatethresholdheartrate")
_HR_REST_KEY_HINTS = ("restingheartrate", "resting_heart_rate", "restinghr")


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
    type_key = activity_type.get("typeKey")
    duration = raw.get("duration")

    return {
        "garmin_activity_id": int(activity_id),
        "user_id": user_id,
        "sport": map_garmin_sport(type_key),
        "garmin_type_key": type_key,
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


def _search_hr_value(data: object, key_hints: tuple[str, ...]) -> int | None:
    """Recursively walk a Garmin payload for a plausible HR under any key whose
    lowercased name contains one of key_hints. Garmin's profile/settings shapes
    differ across accounts and library versions, so we probe rather than assume
    a fixed path — and only accept values inside human HR bounds."""
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, (int, float)) and any(
                hint in str(key).lower() for hint in key_hints
            ):
                ivalue = int(value)
                if _HR_MIN <= ivalue <= _HR_MAX_CEILING:
                    return ivalue
        for value in data.values():
            found = _search_hr_value(value, key_hints)
            if found is not None:
                return found
    elif isinstance(data, list):
        for item in data:
            found = _search_hr_value(item, key_hints)
            if found is not None:
                return found
    return None


def _plausible_hr(value: object) -> int | None:
    if isinstance(value, (int, float)):
        ivalue = int(value)
        if _HR_MIN <= ivalue <= _HR_MAX_CEILING:
            return ivalue
    return None


def _fetch_max_hr_sync(client: garminconnect.Garmin) -> int | None:
    """The athlete's configured max HR, if Garmin exposes it in profile
    settings. Often absent (Garmin auto-detects it), so the caller falls back
    to the highest observed activity max — an empirically sound ceiling."""
    for getter in (
        client.get_userprofile_settings,
        client.get_user_profile,
    ):
        try:
            payload = getter()
        except Exception:  # noqa: BLE001 — probing loosely-typed upstream, tolerate anything
            continue
        found = _search_hr_value(payload, _HR_MAX_KEY_HINTS)
        if found is not None:
            return found
    return None


def _fetch_resting_hr_sync(client: garminconnect.Garmin) -> int | None:
    """Resting HR from Garmin's daily wellness summary — NOT the profile
    settings (it isn't there). We prefer the 7-day average (stable) over a
    single day, and walk back a couple of days because 'today' is usually still
    null early on. Bounded to a few calls to respect the rate limit."""
    today = datetime.now(UTC).date()
    for days_ago in (1, 7):
        cdate = (today - timedelta(days=days_ago)).strftime("%Y-%m-%d")
        for getter in (client.get_user_summary, client.get_heart_rates):
            try:
                payload = getter(cdate)
            except Exception:  # noqa: BLE001
                continue
            if not isinstance(payload, dict):
                continue
            hr = (
                _plausible_hr(payload.get("lastSevenDaysAvgRestingHeartRate"))
                or _plausible_hr(payload.get("restingHeartRate"))
                or _search_hr_value(payload, _HR_REST_KEY_HINTS)
            )
            if hr is not None:
                return hr
        time.sleep(_RATE_LIMIT_DELAY_S)
    return None


def _fetch_hr_profile_sync(client: garminconnect.Garmin) -> tuple[int | None, int | None]:
    """Best-effort HRmax / HRrest from Garmin (runs in a worker thread).

    Every call is guarded independently: a physiology profile is a nice-to-have
    for the load engine, never a reason to fail an activity sync."""
    return _fetch_max_hr_sync(client), _fetch_resting_hr_sync(client)


async def _update_fitness_profile(
    db: AsyncIOMotorDatabase,
    user_id: str,
    client: garminconnect.Garmin,
    raw_activities: list[dict],
) -> None:
    """Refresh the stored HRmax/HRrest profile. Never raises: a missing profile
    only degrades the load engine to 'low confidence', it must not break sync."""
    existing = await db.fitness_profiles.find_one({"user_id": user_id})
    if existing and existing.get("manual"):
        # Athlete-entered values are authoritative — never overwrite them.
        return

    try:
        hr_max, hr_rest = await asyncio.to_thread(_fetch_hr_profile_sync, client)
    except Exception:  # noqa: BLE001 — profile is best-effort, sync must survive
        hr_max, hr_rest = None, None

    # Fallback for HRmax: the highest max-HR Garmin recorded across synced
    # sessions is a sound lower bound when the profile field is absent.
    observed_max = [
        int(raw["maxHR"])
        for raw in raw_activities
        if isinstance(raw.get("maxHR"), (int, float))
        and _HR_MIN <= int(raw["maxHR"]) <= _HR_MAX_CEILING
    ]
    if hr_max is None and observed_max:
        hr_max = max(observed_max)

    update: dict = {"user_id": user_id, "updated_at": datetime.now(UTC)}
    if hr_max is not None:
        update["hr_max"] = hr_max
    if hr_rest is not None:
        update["hr_rest"] = hr_rest

    # Only touch the doc when we actually learned something, so a transient
    # upstream blank never wipes a previously good value.
    if hr_max is not None or hr_rest is not None:
        await db.fitness_profiles.update_one(
            {"user_id": user_id}, {"$set": update}, upsert=True
        )


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

    await _update_fitness_profile(db, user_id, client, raw_activities)

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

    # Until we have a complete HR profile the load engine can't compute zones,
    # so a manual sync always runs to backfill it — bypassing the throttle.
    # Once HRmax and HRrest are known, the normal rate-limit guard applies.
    profile = await db.fitness_profiles.find_one({"user_id": user_id})
    has_full_profile = bool(profile and profile.get("hr_max") and profile.get("hr_rest"))

    last_sync_at = credentials.get("last_sync_at")
    if (
        has_full_profile
        and last_sync_at is not None
        and datetime.now(UTC) - _as_aware_utc(last_sync_at) < SYNC_MIN_INTERVAL
    ):
        return None

    job_id = await job_service.create_job(db, user_id, "garmin_activity_sync")
    await run_activity_sync(db, user_id, job_id)
    return await job_service.get_job(db, job_id, user_id)
