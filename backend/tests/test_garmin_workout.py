"""Unit tests for the session → Garmin workout mapping (no network)."""

from app.models.garmin import WorkoutPushRequest
from app.models.plan import Block, PaceRange
from app.services import garmin_workout_service as gws


def _dump(workout):
    return workout.model_dump()


def test_hr_zone_block_becomes_heart_rate_zone_target():
    req = WorkoutPushRequest(
        session_type="threshold",
        duration_min=20,
        structure=[Block(label="Bloc seuil", duration_min=20, hr_zone=4)],
    )
    workout, name = gws.build_workout(req)
    assert name == "RunCoach — Seuil"
    step = _dump(workout)["workoutSegments"][0]["workoutSteps"][0]
    assert step["targetType"]["workoutTargetTypeKey"] == "heart.rate.zone"
    assert step["zoneNumber"] == 4
    assert step["endConditionValue"] == 20 * 60


def test_pace_block_converts_to_speed_band():
    req = WorkoutPushRequest(
        session_type="easy",
        duration_min=30,
        structure=[
            Block(
                label="Endurance",
                duration_min=30,
                pace_range=PaceRange(min_per_km_low="4:00", min_per_km_high="4:10"),
            )
        ],
    )
    workout, _ = gws.build_workout(req)
    step = _dump(workout)["workoutSegments"][0]["workoutSteps"][0]
    assert step["targetType"]["workoutTargetTypeKey"] == "pace.zone"
    # 4:00 = 240s -> 4.1667 m/s ; 4:10 = 250s -> 4.0 m/s. one <= two.
    assert step["targetValueOne"] == 4.0
    assert round(step["targetValueTwo"], 2) == 4.17


def test_warmup_repeat_and_cooldown_structure():
    req = WorkoutPushRequest(
        session_type="intervals",
        duration_min=45,
        structure=[
            Block(label="Échauffement", duration_min=15, hr_zone=2),
            Block(label="6x800m", duration_min=20, hr_zone=5),
            Block(label="Retour au calme", duration_min=10, hr_zone=1),
        ],
        week_number=3,
    )
    workout, name = gws.build_workout(req)
    assert name == "RunCoach — Fractionné (S3)"
    steps = _dump(workout)["workoutSegments"][0]["workoutSteps"]
    assert steps[0]["stepType"]["stepTypeKey"] == "warmup"
    assert steps[1]["stepType"]["stepTypeKey"] == "repeat"
    assert steps[2]["stepType"]["stepTypeKey"] == "cooldown"
    assert _dump(workout)["estimatedDurationInSecs"] == 45 * 60


def test_repeat_distance_with_recovery():
    req = WorkoutPushRequest(
        session_type="intervals",
        duration_min=30,
        structure=[Block(label="6×800m (récup 200m)", duration_min=30, hr_zone=5)],
    )
    workout, _ = gws.build_workout(req)
    group = _dump(workout)["workoutSegments"][0]["workoutSteps"][0]
    assert group["stepType"]["stepTypeKey"] == "repeat"
    assert group["numberOfIterations"] == 6
    children = group["workoutSteps"]
    assert len(children) == 2
    # Effort: 800m distance, HR zone 5.
    assert children[0]["stepType"]["stepTypeKey"] == "interval"
    assert children[0]["endCondition"]["conditionTypeKey"] == "distance"
    assert children[0]["endConditionValue"] == 800
    assert children[0]["zoneNumber"] == 5
    # Recovery: 200m, no target.
    assert children[1]["stepType"]["stepTypeKey"] == "recovery"
    assert children[1]["endConditionValue"] == 200
    assert children[1]["targetType"]["workoutTargetTypeKey"] == "no.target"


def test_repeat_time_infers_recovery_from_leftover():
    # 5×3min effort = 15min; block is 25min → 10min recovery over 5 reps = 2min.
    req = WorkoutPushRequest(
        session_type="intervals",
        duration_min=25,
        structure=[Block(label="5×3min", duration_min=25, hr_zone=4)],
    )
    workout, _ = gws.build_workout(req)
    group = _dump(workout)["workoutSegments"][0]["workoutSteps"][0]
    children = group["workoutSteps"]
    assert group["numberOfIterations"] == 5
    assert children[0]["endCondition"]["conditionTypeKey"] == "time"
    assert children[0]["endConditionValue"] == 180
    assert children[1]["stepType"]["stepTypeKey"] == "recovery"
    assert children[1]["endConditionValue"] == 120


def test_repeat_time_explicit_recovery_slash():
    req = WorkoutPushRequest(
        session_type="intervals",
        duration_min=30,
        structure=[Block(label="8×2min / 90s", duration_min=30, hr_zone=5)],
    )
    workout, _ = gws.build_workout(req)
    group = _dump(workout)["workoutSegments"][0]["workoutSteps"][0]
    children = group["workoutSteps"]
    assert group["numberOfIterations"] == 8
    assert children[0]["endConditionValue"] == 120
    assert children[1]["endConditionValue"] == 90


def test_non_repeat_interval_stays_single_step():
    req = WorkoutPushRequest(
        session_type="tempo",
        duration_min=20,
        structure=[Block(label="Bloc tempo continu", duration_min=20, hr_zone=3)],
    )
    workout, _ = gws.build_workout(req)
    steps = _dump(workout)["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 1
    assert steps[0]["stepType"]["stepTypeKey"] == "interval"


def test_no_structure_falls_back_to_single_step():
    req = WorkoutPushRequest(session_type="recovery", duration_min=25, hr_zone=1)
    workout, _ = gws.build_workout(req)
    steps = _dump(workout)["workoutSegments"][0]["workoutSteps"]
    assert len(steps) == 1
    assert steps[0]["zoneNumber"] == 1


def test_no_target_when_no_zone_or_pace():
    req = WorkoutPushRequest(
        session_type="easy",
        duration_min=40,
        structure=[Block(label="Footing libre", duration_min=40)],
    )
    workout, _ = gws.build_workout(req)
    step = _dump(workout)["workoutSegments"][0]["workoutSteps"][0]
    assert step["targetType"]["workoutTargetTypeKey"] == "no.target"
