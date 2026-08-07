import asyncio
import time
from datetime import UTC, datetime, timedelta

import garminconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.crypto import decrypt_token_blob
from app.models.activity import SportType, map_garmin_sport
from app.models.job import JobResponse, JobStatus
from app.services import job_service, load_service

SYNC_HISTORY_DAYS = 90  # needed to seed CTL — see training-science skill
SYNC_MIN_INTERVAL = timedelta(minutes=15)  # garmin-sync skill: rate-limit guard
_PAGE_SIZE = 20
_MAX_PAGES = 10  # safety cap: 200 activities per sync
_RATE_LIMIT_DELAY_S = 1.0

# Daily wellness (HRV / sleep / resting HR / Body Battery) window: 30 days feeds
# the recovery baselines (training-science skill). Only the missing days plus the
# last two (which get revised as Garmin finishes processing) are re-fetched, so a
# steady-state sync only makes a couple of extra requests.
_WELLNESS_HISTORY_DAYS = 30
_WELLNESS_REFRESH_DAYS = 2

# Time-in-zone is not in the activity list payload: it needs one extra request
# per activity (`hrTimeInZones`). Three deliberate limits keep that affordable
# against Garmin's informal ~1 req/s budget:
#   - RUN only. The average-HR fallback understates interval work, and intervals
#     are a running thing here; a padel match has no such structure to lose.
#   - Only activities that don't have the field yet, newest first, so the days
#     that drive today's ATL are enriched before older ones.
#   - A per-sync cap. RETROACTIVE DECISION: rather than a one-shot backfill
#     script, each sync enriches up to this many activities, so the 90-day
#     window fills in over a handful of syncs. Chosen because a single 90-day
#     backfill is ~90 extra requests in one burst — the surest way to get an
#     account rate-limited — and because CTL is a 42-day EMA: filling in from
#     the most recent backwards makes the curve converge rather than step.
_ZONE_ENRICH_MAX_PER_SYNC = 25
# Splits cost one request per activity, same as zones — keep the same ceiling so
# a single sync can't spend more than ~50 enrichment requests in total.
_SPLITS_ENRICH_MAX_PER_SYNC = 25

# Plausible human heart-rate bounds (bpm). Used to reject garbage when probing
# Garmin's loosely-typed profile payloads for HRmax / HRrest.
_HR_MIN = 30
_HR_MAX_CEILING = 230
# Substrings (lowercased key names) that carry each value across Garmin's
# several profile/settings shapes. Order doesn't matter — we take the first
# plausible number found.
_HR_MAX_KEY_HINTS = ("maxheartrate", "maxhr", "lactatethresholdheartrate")
_HR_REST_KEY_HINTS = ("restingheartrate", "resting_heart_rate", "restinghr")


def _ensure_display_name(client: garminconnect.Garmin) -> None:
    """A token-restored client never ran login(), so `display_name` is None —
    yet every wellness endpoint (resting HR, sleep, HRV, Body Battery) splices
    it straight into the request URL, turning them all into `.../None` 403s.
    Backfill it from the social profile. Best-effort: activity sync doesn't need
    it, so a failure here must never break the sync."""
    if client.display_name:
        return
    try:
        prof = client.client.connectapi("/userprofile-service/socialProfile")
    except Exception:  # noqa: BLE001 — profile backfill is best-effort
        return
    if isinstance(prof, dict):
        client.display_name = prof.get("displayName") or prof.get("userName")
        client.full_name = prof.get("fullName", "")


def _restore_client_sync(token_blob: str) -> garminconnect.Garmin:
    client = garminconnect.Garmin()
    client.client.loads(token_blob)
    _ensure_display_name(client)
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
        # Terrain and form, both already in the activity-list payload — no extra
        # request. Elevation is what separates a bad session from a hilly one:
        # without it a climb-heavy long run reads as a pace regression.
        "elevation_gain_m": raw.get("elevationGain"),
        "avg_cadence_spm": raw.get("averageRunningCadenceInStepsPerMinute"),
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


def _zone_bands(payload: object) -> list[tuple[float, float, float]]:
    """Garmin's `hrTimeInZones` → [(low_bpm, high_bpm, seconds)] sorted by zone.

    The payload is a list of per-zone dicts carrying `zoneNumber`, `secsInZone`
    and `zoneLowBoundary`; only the LOW boundary is given, so each band's ceiling
    is the next band's floor and the top band is left open (inf). Shapes vary by
    watch model and activity type, so anything unparseable is skipped rather
    than guessed."""
    if not isinstance(payload, list):
        return []
    rows: list[tuple[int, float, float]] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        number = entry.get("zoneNumber")
        low = entry.get("zoneLowBoundary")
        seconds = entry.get("secsInZone")
        if not isinstance(number, (int, float)) or isinstance(number, bool):
            continue
        if not isinstance(low, (int, float)) or isinstance(low, bool):
            continue
        if not isinstance(seconds, (int, float)) or isinstance(seconds, bool):
            continue
        rows.append((int(number), float(low), float(seconds)))
    if not rows:
        return []
    rows.sort()
    bands: list[tuple[float, float, float]] = []
    for index, (_, low, seconds) in enumerate(rows):
        high = rows[index + 1][1] if index + 1 < len(rows) else float("inf")
        bands.append((low, high, seconds))
    return bands


def _fetch_zone_bands_sync(
    client: garminconnect.Garmin, activity_ids: list[int]
) -> dict[int, list[tuple[float, float, float]]]:
    """Runs in a worker thread. One `hrTimeInZones` call per activity, spaced by
    the rate-limit delay. Each call is guarded on its own: a single activity
    without zone data (no HR strap that day, an old device) must not cost the
    others."""
    out: dict[int, list[tuple[float, float, float]]] = {}
    for index, activity_id in enumerate(activity_ids):
        try:
            payload = client.get_activity_hr_in_timezones(str(activity_id))
        except Exception:  # noqa: BLE001 — enrichment is best-effort, per activity
            payload = None
        bands = _zone_bands(payload)
        if bands:
            out[activity_id] = bands
        if index < len(activity_ids) - 1:
            time.sleep(_RATE_LIMIT_DELAY_S)
    return out


async def enrich_run_zone_seconds(
    db: AsyncIOMotorDatabase, user_id: str, client: garminconnect.Garmin
) -> int:
    """Fill `hr_zone_seconds` on run activities that lack it, so their TRIMP uses
    the true Edwards form instead of the average-HR fallback (training-science
    skill). Needs the athlete's real HRmax/HRrest: Garmin's zone boundaries are
    not ours, so the time is redistributed onto the project's Karvonen zones —
    without a complete profile we store nothing rather than mismap it.

    Best-effort and non-throwing: returns how many activities were enriched."""
    profile = await db.fitness_profiles.find_one({"user_id": user_id})
    hr_max = (profile or {}).get("hr_max")
    hr_rest = (profile or {}).get("hr_rest")
    if not hr_max or not hr_rest or hr_max <= hr_rest:
        return 0

    cursor = (
        db.activities.find(
            {
                "user_id": user_id,
                "sport": SportType.RUN.value,
                "garmin_activity_id": {"$ne": None},
                "hr_zone_seconds": None,
            },
            {"garmin_activity_id": 1},
        )
        .sort("start_time", -1)
        .limit(_ZONE_ENRICH_MAX_PER_SYNC)
    )
    activity_ids = [
        int(doc["garmin_activity_id"])
        async for doc in cursor
        if doc.get("garmin_activity_id") is not None
    ]
    if not activity_ids:
        return 0

    bands_by_id = await asyncio.to_thread(_fetch_zone_bands_sync, client, activity_ids)

    enriched = 0
    for activity_id, bands in bands_by_id.items():
        zone_seconds = load_service.redistribute_zone_seconds(bands, hr_max, hr_rest)
        if zone_seconds is None:
            continue
        await db.activities.update_one(
            {"garmin_activity_id": activity_id, "user_id": user_id},
            {"$set": {"hr_zone_seconds": zone_seconds}},
        )
        enriched += 1
    return enriched


def _laps(payload: object) -> list[dict]:
    """Garmin's `/splits` response → our split rows.

    The payload is `{"lapDTOs": [...]}`; each lap carries `distance` (m),
    `duration` (s), and optionally `averageHR` / `elevationGain`. Note this is
    NOT `get_activity`, whose `splitSummaries` are aggregated by movement type
    (run/walk) rather than per lap — useless for pacing.

    A lap without a usable distance or duration is dropped rather than guessed:
    a zero-distance lap would produce an infinite pace downstream."""
    if not isinstance(payload, dict):
        return []
    rows: list[dict] = []
    for entry in payload.get("lapDTOs") or []:
        if not isinstance(entry, dict):
            continue
        distance = entry.get("distance")
        duration = entry.get("duration")
        if not isinstance(distance, (int, float)) or isinstance(distance, bool) or distance <= 0:
            continue
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
            continue
        rows.append(
            {
                "index": len(rows) + 1,
                "distance_m": float(distance),
                "duration_s": int(duration),
                "avg_hr": _as_int(entry.get("averageHR")),
                "elevation_gain_m": _as_float(entry.get("elevationGain")),
            }
        )
    return rows


def _as_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(value)


def _as_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _fetch_splits_sync(
    client: garminconnect.Garmin, activity_ids: list[int]
) -> dict[int, list[dict]]:
    """Runs in a worker thread. One `/splits` call per activity, spaced by the
    rate-limit delay — same shape and same guarantees as `_fetch_zone_bands_sync`:
    one activity without laps must never cost the others."""
    out: dict[int, list[dict]] = {}
    for index, activity_id in enumerate(activity_ids):
        try:
            payload = client.get_activity_splits(str(activity_id))
        except Exception:  # noqa: BLE001 — enrichment is best-effort, per activity
            payload = None
        laps = _laps(payload)
        if laps:
            out[activity_id] = laps
        if index < len(activity_ids) - 1:
            time.sleep(_RATE_LIMIT_DELAY_S)
    return out


async def enrich_run_splits(
    db: AsyncIOMotorDatabase, user_id: str, client: garminconnect.Garmin
) -> int:
    """Fill `splits` on run activities that lack it, so a session can be read as
    a shape rather than a single average — a negative split and a blow-up have
    the same average pace.

    Same cost discipline as `enrich_run_zone_seconds` (garmin-sync skill): runs
    only, only where the field is missing, most recent first, capped per sync,
    and no one-shot backfill script. History fills in over a few syncs instead of
    firing 90 requests in a burst, which is the surest way to get rate-limited.

    Best-effort and non-throwing: returns how many activities were enriched."""
    cursor = (
        db.activities.find(
            {
                "user_id": user_id,
                "sport": SportType.RUN.value,
                "garmin_activity_id": {"$ne": None},
                "splits": None,
            },
            {"garmin_activity_id": 1},
        )
        .sort("start_time", -1)
        .limit(_SPLITS_ENRICH_MAX_PER_SYNC)
    )
    activity_ids = [
        int(doc["garmin_activity_id"])
        async for doc in cursor
        if doc.get("garmin_activity_id") is not None
    ]
    if not activity_ids:
        return 0

    splits_by_id = await asyncio.to_thread(_fetch_splits_sync, client, activity_ids)

    enriched = 0
    for activity_id, splits in splits_by_id.items():
        await db.activities.update_one(
            {"garmin_activity_id": activity_id, "user_id": user_id},
            {"$set": {"splits": splits}},
        )
        enriched += 1
    return enriched


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
        await db.fitness_profiles.update_one({"user_id": user_id}, {"$set": update}, upsert=True)


def _extract_hrv(payload: object) -> int | None:
    """Last-night average HRV (ms) from get_hrv_data → hrvSummary.lastNightAvg."""
    if isinstance(payload, dict):
        summary = payload.get("hrvSummary")
        if isinstance(summary, dict):
            value = summary.get("lastNightAvg")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
                return int(value)
    return None


def _extract_sleep_seconds(payload: object) -> int | None:
    """Total sleep (seconds) from get_sleep_data → dailySleepDTO.sleepTimeSeconds."""
    if isinstance(payload, dict):
        dto = payload.get("dailySleepDTO")
        if isinstance(dto, dict):
            value = dto.get("sleepTimeSeconds")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
                return int(value)
    return None


def _extract_sleep_score(payload: object) -> int | None:
    """Garmin's 0-100 sleep score (dailySleepDTO.sleepScores.overall.value)."""
    if not isinstance(payload, dict):
        return None
    dto = payload.get("dailySleepDTO")
    scores = dto.get("sleepScores") if isinstance(dto, dict) else None
    overall = scores.get("overall") if isinstance(scores, dict) else None
    value = overall.get("value") if isinstance(overall, dict) else None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    return None


def _extract_rhr(payload: object) -> int | None:
    """Resting HR from get_rhr_day → allMetrics.metricsMap
    .WELLNESS_RESTING_HEART_RATE[].value, bounded to plausible HR."""
    if not isinstance(payload, dict):
        return None
    metrics = payload.get("allMetrics")
    metrics_map = metrics.get("metricsMap") if isinstance(metrics, dict) else None
    series = (
        metrics_map.get("WELLNESS_RESTING_HEART_RATE") if isinstance(metrics_map, dict) else None
    )
    if isinstance(series, list):
        for item in series:
            if isinstance(item, dict):
                hr = _plausible_hr(item.get("value"))
                if hr is not None:
                    return hr
    return None


def _extract_body_battery_by_date(payload: object) -> dict[str, int]:
    """Highest Body Battery level per day from a get_body_battery range payload
    (a list of day dicts, each with a bodyBatteryValuesArray of [ts, status,
    level, …] rows). Best-effort: any level in the 0-100 band is a candidate; the
    daily max approximates the morning peak. Display-only, so shape surprises just
    yield fewer entries, never an error."""
    out: dict[str, int] = {}
    if not isinstance(payload, list):
        return out
    for day in payload:
        if not isinstance(day, dict):
            continue
        date_str = day.get("date")
        values = day.get("bodyBatteryValuesArray")
        if not isinstance(date_str, str) or not isinstance(values, list):
            continue
        high: int | None = None
        for row in values:
            if not isinstance(row, list):
                continue
            for cell in row:
                if (
                    isinstance(cell, (int, float))
                    and not isinstance(cell, bool)
                    and 0 <= cell <= 100
                ):
                    level = int(cell)
                    if high is None or level > high:
                        high = level
        if high is not None:
            out[date_str] = high
    return out


def _fetch_wellness_range_sync(client: garminconnect.Garmin, dates: list[str]) -> list[dict]:
    """Runs in a worker thread. One Body Battery range call plus per-day HRV /
    sleep / resting-HR calls, each guarded independently (a missing metric is
    normal). Sleeps between days to respect Garmin's informal rate limit. Returns
    one record per day that yielded at least one metric."""
    if not dates:
        return []

    body_battery: dict[str, int] = {}
    try:
        body_battery = _extract_body_battery_by_date(client.get_body_battery(dates[0], dates[-1]))
    except Exception:  # noqa: BLE001 — Body Battery is display-only, never fatal
        body_battery = {}

    records: list[dict] = []
    for index, cdate in enumerate(dates):
        record: dict = {"day": cdate}
        for getter, extractor, field in (
            (client.get_hrv_data, _extract_hrv, "hrv"),
            (client.get_sleep_data, _extract_sleep_seconds, "sleep_seconds"),
            (client.get_rhr_day, _extract_rhr, "resting_hr"),
        ):
            try:
                payload = getter(cdate)
            except Exception:  # noqa: BLE001 — each metric is best-effort
                continue
            value = extractor(payload)
            if value is not None:
                record[field] = value
            if field == "sleep_seconds":
                score = _extract_sleep_score(payload)
                if score is not None:
                    record["sleep_score"] = score
        if cdate in body_battery:
            record["body_battery"] = body_battery[cdate]
        if len(record) > 1:  # more than just the "day" key
            records.append(record)
        if index < len(dates) - 1:
            time.sleep(_RATE_LIMIT_DELAY_S)
    return records


async def sync_wellness(
    db: AsyncIOMotorDatabase, user_id: str, client: garminconnect.Garmin
) -> int:
    """Backfill daily wellness (HRV / sleep / resting HR / Body Battery) into
    `wellness_daily`. Best-effort and non-throwing: it enriches the recovery
    signals but must never break the activity sync it runs after. Only fetches
    days not already stored, plus the last two (Garmin revises them), so a routine
    sync makes only a couple of extra requests."""
    today = datetime.now(UTC).date()
    window_start = today - timedelta(days=_WELLNESS_HISTORY_DAYS)
    refresh_from = today - timedelta(days=_WELLNESS_REFRESH_DAYS)

    existing: set[str] = set()
    cursor = db.wellness_daily.find({"user_id": user_id}, {"day": 1})
    async for doc in cursor:
        day = doc.get("day")
        if isinstance(day, str):
            existing.add(day)

    dates: list[str] = []
    day = window_start
    while day <= today:
        iso = day.isoformat()
        if iso not in existing or day >= refresh_from:
            dates.append(iso)
        day += timedelta(days=1)

    if not dates:
        return 0

    try:
        records = await asyncio.to_thread(_fetch_wellness_range_sync, client, dates)
    except Exception:  # noqa: BLE001 — wellness is enrichment, never fatal
        return 0

    stored = 0
    for record in records:
        record["user_id"] = user_id
        record["updated_at"] = datetime.now(UTC)
        await db.wellness_daily.update_one(
            {"user_id": user_id, "day": record["day"]}, {"$set": record}, upsert=True
        )
        stored += 1
    return stored


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

    # Time-in-zone for runs, now that the HR profile above is up to date (the
    # redistribution needs it). Best-effort: without it the load engine still
    # works, it just falls back to average HR.
    try:
        await enrich_run_zone_seconds(db, user_id, client)
    except Exception:  # noqa: BLE001 — enrichment must never fail a sync
        pass

    # Per-lap splits for runs, so the weekly review can read a session's shape
    # (drift, fade, negative split) and not just its averages. Best-effort for
    # the same reason as the zones above.
    try:
        await enrich_run_splits(db, user_id, client)
    except Exception:  # noqa: BLE001 — enrichment must never fail a sync
        pass

    # Enrich with overnight recovery data. Best-effort: never let a wellness
    # hiccup fail an otherwise-successful activity sync.
    try:
        await sync_wellness(db, user_id, client)
    except Exception:  # noqa: BLE001 — recovery data is a nice-to-have
        pass

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
