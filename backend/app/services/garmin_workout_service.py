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
from app.models.plan import Block
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
_DISTANCE_END = {
    "conditionTypeId": gw.ConditionType.DISTANCE,
    "conditionTypeKey": "distance",
    "displayOrder": 3,
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

# "6×800m", "10 x 400m", "5×(3min)" — count then the effort descriptor.
_REP_RE = re.compile(r"(\d+)\s*[x×✕╳*]\s*(.+)", re.IGNORECASE)
# Where the effort ends and the recovery begins inside a rep descriptor.
_RECOVERY_MARKER = re.compile(
    r"r[ée]cup[ée]?(?:ration)?|repos|\brec\b|/|\+|\br(?=\s*\d)",
    re.IGNORECASE,
)
# A distance ("800m", "1km") — the unit must not be followed by another letter,
# so "3min" is never read as 3 metres.
_DIST_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(km|m)(?![a-zà-ÿ])", re.IGNORECASE)
_MIN_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:min|mn|minutes?|’|')(?![a-zà-ÿ])", re.IGNORECASE)
_SEC_RE = re.compile(r"(\d+)\s*(?:sec(?:ondes?)?|s|”|\")(?![a-zà-ÿ])", re.IGNORECASE)


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
                "workoutTargetTypeId": gw.TargetType.HEART_RATE,
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
            # Garmin expresses a running pace band as a *speed* target: the
            # values are m/s (see `_pace_to_speed`) and the watch renders them
            # back as min/km. `TargetType.SPEED` (5) is the id the library
            # documents for the "speed.zone" key — there is no pace constant.
            return (
                {
                    "workoutTargetTypeId": gw.TargetType.SPEED,
                    "workoutTargetTypeKey": "speed.zone",
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


def _dist_or_time(text: str) -> tuple[str, int] | None:
    """First distance (metres) or duration (seconds) in a fragment, or None."""
    md = _DIST_RE.search(text)
    if md:
        value = float(md.group(1).replace(",", "."))
        metres = value * 1000 if md.group(2).lower() == "km" else value
        return "distance", round(metres)
    mm = _MIN_RE.search(text)
    if mm:
        return "time", round(float(mm.group(1).replace(",", ".")) * 60)
    ms = _SEC_RE.search(text)
    if ms:
        return "time", int(ms.group(1))
    return None


def _parse_repeat(label: str, block_total_s: int) -> dict | None:
    """Detect an interval set ("6×800m récup 200m") in a block label. Returns
    {iterations, work: (kind, value), recovery: (kind, value) | None} or None
    when the label isn't a repetition."""
    m = _REP_RE.search(label)
    if not m:
        return None
    iterations = int(m.group(1))
    if not 2 <= iterations <= 40:
        return None

    descriptor = m.group(2)
    marker = _RECOVERY_MARKER.search(descriptor)
    if marker:
        work_text, recovery_text = descriptor[: marker.start()], descriptor[marker.end() :]
    else:
        work_text, recovery_text = descriptor, ""

    work = _dist_or_time(work_text)
    if work is None:
        return None

    recovery = _dist_or_time(recovery_text) if recovery_text else None
    # No explicit recovery but the effort is timed: split the leftover block
    # time evenly between reps as jog recovery.
    if recovery is None and work[0] == "time":
        leftover = block_total_s - iterations * work[1]
        if leftover > 0:
            recovery = ("time", round(leftover / iterations))
    return {"iterations": iterations, "work": work, "recovery": recovery}


def _end_condition(kind: str) -> dict:
    return dict(_DISTANCE_END) if kind == "distance" else dict(_TIME_END)


def _make_step(order, step_type_id, step_type_key, end_condition, end_value, target_type, extra):
    return gw.ExecutableStep(
        stepOrder=order,
        stepType={
            "stepTypeId": step_type_id,
            "stepTypeKey": step_type_key,
            "displayOrder": step_type_id,
        },
        endCondition=end_condition,
        endConditionValue=float(end_value),
        targetType=target_type,
        **extra,
    )


def _build_repeat_group(order: int, rep: dict, block: Block) -> tuple["gw.RepeatGroup", int]:
    """A REPEAT group of [effort, (recovery)] steps. Returns (group, next_order)."""
    group_order = order
    order += 1

    target_type, extra = _target_for(block.hr_zone, block.pace_range)
    work_kind, work_value = rep["work"]
    children = [
        _make_step(
            order,
            gw.StepType.INTERVAL,
            "interval",
            _end_condition(work_kind),
            work_value,
            target_type,
            extra,
        )
    ]
    order += 1

    if rep["recovery"] is not None:
        rec_kind, rec_value = rep["recovery"]
        no_target, no_extra = _target_for(None, None)
        children.append(
            _make_step(
                order,
                gw.StepType.RECOVERY,
                "recovery",
                _end_condition(rec_kind),
                rec_value,
                no_target,
                no_extra,
            )
        )
        order += 1

    return gw.create_repeat_group(rep["iterations"], children, group_order), order


def build_workout(req: WorkoutPushRequest) -> tuple["gw.RunningWorkout", str]:
    """Pure mapping from a session to a Garmin RunningWorkout + its name.
    Kept import-free of the network so it's unit-testable."""
    label = _SESSION_LABELS.get(req.session_type, "Séance")
    name = f"RunCoach — {label}"
    if req.week_number:
        name = f"{name} (S{req.week_number})"

    blocks = req.structure or []
    steps: list = []
    order = 1
    if blocks:
        total = len(blocks)
        for i, b in enumerate(blocks):
            block_total_s = max(1, b.duration_min) * 60
            rep = _parse_repeat(b.label, block_total_s)
            if rep is not None:
                group, order = _build_repeat_group(order, rep, b)
                steps.append(group)
                continue
            step_id, step_key = _step_type(b.label, i, total)
            target_type, extra = _target_for(b.hr_zone, b.pace_range)
            steps.append(
                _make_step(
                    order,
                    step_id,
                    step_key,
                    _end_condition("time"),
                    block_total_s,
                    target_type,
                    extra,
                )
            )
            order += 1
        est = sum(max(1, b.duration_min) for b in blocks) * 60
    else:
        target_type, extra = _target_for(req.hr_zone, req.pace_range)
        steps.append(
            _make_step(
                1,
                gw.StepType.INTERVAL,
                "interval",
                _end_condition("time"),
                max(1, req.duration_min) * 60,
                target_type,
                extra,
            )
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
