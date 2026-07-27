"""Convert a plan session into a Garmin structured workout and upload it.

Garmin Connect pushes uploaded workouts to the paired watch on its next sync,
so "send to my watch" = create a running workout in the user's Garmin library.
We keep it best-effort and never store the workout ourselves.
"""

import asyncio
import re

import garminconnect
from garminconnect import workout as gw
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.crypto import decrypt_token_blob
from app.models.garmin import WorkoutPushRequest
from app.services.garmin_sync_service import _restore_client_sync


class GarminNotConnectedError(Exception):
    pass


class GarminAuthExpiredError(Exception):
    pass


class GarminUpstreamError(Exception):
    pass


_RUN_SPORT = {"sportTypeId": gw.SportType.RUNNING, "sportTypeKey": "running", "displayOrder": 1}
_TIME_END = {
    "conditionTypeId": gw.ConditionType.TIME,
    "conditionTypeKey": "time",
    "displayOrder": 2,
    "displayable": True,
}

_SESSION_LABELS = {
    "easy": "Footing",
    "long_run": "Sortie longue",
    "tempo": "Tempo",
    "threshold": "Seuil",
    "intervals": "Fractionné",
    "recovery": "Récupération",
    "cross_training": "Cross-training",
    "rest": "Repos",
}

_WARMUP_RE = re.compile(r"échauff|echauff|warm", re.IGNORECASE)
_COOLDOWN_RE = re.compile(r"retour au calme|retour|cool|calme", re.IGNORECASE)
_RECOVERY_RE = re.compile(r"récup|recup|repos", re.IGNORECASE)
_PACE_RE = re.compile(r"^(\d+):(\d{1,2})$")


def _pace_to_speed(pace: str) -> float | None:
    """min/km ("4:15") → speed in m/s, the unit Garmin pace targets use."""
    m = _PACE_RE.match(pace.strip())
    if not m:
        return None
    sec = int(m.group(1)) * 60 + int(m.group(2))
    if sec <= 0:
        return None
    return round(1000.0 / sec, 4)


def _target_for(hr_zone: int | None, pace_range) -> tuple[dict, dict]:
    """(targetType dict, extra step fields). HR zone wins when present (it maps
    cleanly to Garmin's 5 zones); otherwise a pace band; otherwise no target."""
    if hr_zone is not None and 1 <= hr_zone <= 5:
        return (
            {
                "workoutTargetTypeId": gw.TargetType.HEART_RATE_ZONE,
                "workoutTargetTypeKey": "heart.rate.zone",
                "displayOrder": 1,
            },
            {"zoneNumber": hr_zone},
        )
    if pace_range is not None:
        speeds = [
            s
            for s in (
                _pace_to_speed(pace_range.min_per_km_low),
                _pace_to_speed(pace_range.min_per_km_high),
            )
            if s is not None
        ]
        if speeds:
            return (
                {
                    "workoutTargetTypeId": gw.TargetType.PACE_ZONE,
                    "workoutTargetTypeKey": "pace.zone",
                    "displayOrder": 1,
                },
                {"targetValueOne": min(speeds), "targetValueTwo": max(speeds)},
            )
    return (
        {
            "workoutTargetTypeId": gw.TargetType.NO_TARGET,
            "workoutTargetTypeKey": "no.target",
            "displayOrder": 1,
        },
        {},
    )


def _step_type(label: str, idx: int, total: int) -> tuple[int, str]:
    if _WARMUP_RE.search(label) or (idx == 0 and total > 1):
        return gw.StepType.WARMUP, "warmup"
    if _COOLDOWN_RE.search(label) or (idx == total - 1 and total > 2):
        return gw.StepType.COOLDOWN, "cooldown"
    if _RECOVERY_RE.search(label):
        return gw.StepType.RECOVERY, "recovery"
    return gw.StepType.INTERVAL, "interval"


def _make_step(order, step_type_id, step_type_key, dur_s, target_type, extra):
    return gw.ExecutableStep(
        stepOrder=order,
        stepType={"stepTypeId": step_type_id, "stepTypeKey": step_type_key, "displayOrder": order},
        endCondition=dict(_TIME_END),
        endConditionValue=float(dur_s),
        targetType=target_type,
        **extra,
    )


def build_workout(req: WorkoutPushRequest) -> tuple["gw.RunningWorkout", str]:
    """Pure mapping from a session to a Garmin RunningWorkout + its name.
    Kept import-free of the network so it's unit-testable."""
    label = _SESSION_LABELS.get(req.session_type, "Séance")
    name = f"RunCoach — {label}"
    if req.week_number:
        name = f"{name} (S{req.week_number})"

    blocks = req.structure or []
    steps = []
    if blocks:
        total = len(blocks)
        for i, b in enumerate(blocks):
            step_id, step_key = _step_type(b.label, i, total)
            target_type, extra = _target_for(b.hr_zone, b.pace_range)
            dur_s = max(1, b.duration_min) * 60
            steps.append(_make_step(i + 1, step_id, step_key, dur_s, target_type, extra))
        est = sum(max(1, b.duration_min) for b in blocks) * 60
    else:
        target_type, extra = _target_for(req.hr_zone, req.pace_range)
        dur_s = max(1, req.duration_min) * 60
        steps.append(
            _make_step(1, gw.StepType.INTERVAL, "interval", dur_s, target_type, extra)
        )
        est = max(1, req.duration_min) * 60

    segment = gw.WorkoutSegment(segmentOrder=1, sportType=dict(_RUN_SPORT), workoutSteps=steps)
    workout = gw.RunningWorkout(
        workoutName=name,
        estimatedDurationInSecs=est,
        workoutSegments=[segment],
        description=((req.rationale or "").strip()[:1024] or None),
    )
    return workout, name


def _push_sync(token_blob: str, req: WorkoutPushRequest) -> str:
    client = _restore_client_sync(token_blob)
    workout, name = build_workout(req)
    client.upload_running_workout(workout)
    return name


async def push_session_to_watch(
    db: AsyncIOMotorDatabase, user_id: str, req: WorkoutPushRequest
) -> str:
    """Upload the session as a Garmin workout. Returns the workout name.
    Raises GarminNotConnectedError / GarminAuthExpiredError / GarminUpstreamError."""
    credentials = await db.garmin_credentials.find_one({"user_id": user_id})
    if not credentials or not credentials.get("encrypted_tokens"):
        raise GarminNotConnectedError

    token_blob = decrypt_token_blob(credentials["encrypted_tokens"])
    try:
        return await asyncio.to_thread(_push_sync, token_blob, req)
    except garminconnect.GarminConnectAuthenticationError as exc:
        raise GarminAuthExpiredError from exc
    except (
        garminconnect.GarminConnectConnectionError,
        garminconnect.GarminConnectTooManyRequestsError,
    ) as exc:
        raise GarminUpstreamError from exc
