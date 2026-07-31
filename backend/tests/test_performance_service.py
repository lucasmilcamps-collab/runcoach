"""Reference-value tests for the race-time estimation maths."""

import pytest

from app.services import performance_service as ps


def test_riegel_5k_to_10k():
    # 5 km in 20:00 → ~41:40 for 10 km (classic Riegel value).
    predicted = ps.riegel_predict(5.0, 20 * 60, 10.0)
    assert 2490 < predicted < 2520  # ~41:42


def test_riegel_10k_to_half():
    # 10 km in 40:00 → ~1h28 for the half.
    predicted = ps.riegel_predict(10.0, 40 * 60, 21.1)
    assert 5250 < predicted < 5350


def test_riegel_same_distance_is_identity():
    assert ps.riegel_predict(10.0, 2400, 10.0) == pytest.approx(2400)


def test_riegel_rejects_nonpositive():
    with pytest.raises(ValueError):
        ps.riegel_predict(0, 1000, 10)


@pytest.mark.parametrize(
    "distance_m, time_s, expected_vdot",
    [
        # Gilbert VO2max estimate (matches Daniels well at 5k, drifts a little
        # longer). 5k 20:00 → ~49.8 is the well-known anchor.
        (5000, 20 * 60, 49.8),
        (5000, 25 * 60, 38.3),
        (10000, 40 * 60, 51.9),
        (21097, 90 * 60, 51.0),
        (3000, 12 * 60, 47.9),
    ],
)
def test_daniels_vdot_reference_values(distance_m, time_s, expected_vdot):
    assert ps.daniels_vdot(distance_m, time_s) == pytest.approx(expected_vdot, abs=0.5)


def test_estimate_confidence_high_when_recent_and_close():
    est = ps.estimate_current_time(10.0, 40 * 60, days_ago=7, target_distance_km=21.1)
    assert est.confidence == "high"
    assert 5250 < est.seconds < 5350


def test_estimate_confidence_low_when_old_and_far():
    est = ps.estimate_current_time(5.0, 25 * 60, days_ago=60, target_distance_km=42.2)
    assert est.confidence == "low"


def test_projection_improves_with_fitness_gain():
    projected = ps.project_time_at_target(3600, ctl_now=40, ctl_projected=60)
    assert projected < 3600  # faster
    assert projected >= 3600 * (1 - 0.08)  # capped at 8%


def test_projection_no_gain_returns_current():
    assert ps.project_time_at_target(3600, ctl_now=50, ctl_projected=50) == 3600
    assert ps.project_time_at_target(3600, ctl_now=0, ctl_projected=60) == 3600


def test_feasibility_flags_unrealistic_goal():
    # Estimated 1h30 half, goal 1h10 in 8 weeks → ~22% improvement, unrealistic.
    warning = ps.feasibility_warning(70 * 60, 90 * 60, weeks=8)
    assert warning is not None
    assert "%" in warning


def test_feasibility_ok_for_modest_goal():
    # Estimated 1h30, goal 1h28 in 12 weeks → tiny improvement, fine.
    assert ps.feasibility_warning(88 * 60, 90 * 60, weeks=12) is None


def test_feasibility_none_when_goal_slower_than_current():
    assert ps.feasibility_warning(100 * 60, 90 * 60, weeks=8) is None


# --- Lot 7.5: Riegel has no sanity check of its own ---


def test_a_source_far_faster_than_usual_is_flagged():
    """5:00/km typical, and one run at 3:30/km — a 30% gap no athlete produces
    between two ordinary weeks. Probably GPS drift or a short-measured run."""
    typical = [300.0, 305.0, 295.0, 310.0, 300.0]
    assert ps.is_source_pace_implausible(210.0, typical) is True


def test_a_good_day_is_not_flagged():
    """A genuine 10% faster effort — a race, or simply a good day — must pass:
    the guard is for artefacts, not for progress."""
    typical = [300.0, 305.0, 295.0, 310.0, 300.0]
    assert ps.is_source_pace_implausible(270.0, typical) is False


def test_no_flag_without_enough_history():
    """Fewer than a handful of runs gives no meaningful median to compare to —
    better no verdict than one built on two data points."""
    assert ps.is_source_pace_implausible(210.0, [300.0, 305.0]) is False


def test_downgrade_confidence_steps_down_and_floors_at_low():
    high = ps.TimeEstimate(seconds=5000.0, confidence="high")
    stepped = ps.downgrade_confidence(high)
    assert stepped.confidence == "medium"
    assert stepped.seconds == high.seconds  # the estimate itself is kept
    assert ps.downgrade_confidence(stepped).confidence == "low"
    low = ps.TimeEstimate(seconds=5000.0, confidence="low")
    assert ps.downgrade_confidence(low).confidence == "low"
