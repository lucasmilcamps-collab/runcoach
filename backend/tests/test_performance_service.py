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


# --- Isolating the effort inside a structured session -------------------------

# The real session behind this feature, lap for lap (Garmin, half-marathon plan):
# warm-up 12:00 for 1,94 km, effort 9:05 for 2,00 km, cool-down 11:03 for 1,59 km.
# Taken whole it averages 5:49/km, a pace never actually held.
_TEST_SESSION = [
    {"distance_m": 1940.0, "duration_s": 720},
    {"distance_m": 2000.0, "duration_s": 545},
    {"distance_m": 1590.0, "duration_s": 662},
]


def test_effort_is_isolated_from_a_warmup_and_cooldown():
    effort = ps.best_sustained_effort(_TEST_SESSION)

    assert effort is not None
    assert effort.distance_m == 2000.0
    assert effort.time_s == 545
    assert effort.isolated is True
    assert effort.pace_s_per_km == pytest.approx(272.5)  # 4:32/km, not 5:49


def test_the_isolated_effort_fixes_the_estimate():
    """The whole point, in one assertion: the same session predicts 2h15 taken
    whole and ~1h51 taken at its effort. The first number was never run."""
    whole = ps.riegel_predict(5.53, 1927, 21.1)
    effort = ps.best_sustained_effort(_TEST_SESSION)
    isolated = ps.riegel_predict(effort.distance_m / 1000, effort.time_s, 21.1)

    assert whole / 60 == pytest.approx(135, abs=3)  # ~2h15, the bug
    assert isolated / 60 == pytest.approx(111, abs=3)  # ~1h51


def test_an_even_run_has_no_effort_to_isolate():
    """The guard that stops every steady run from becoming a fake personal best:
    a run held at one pace must come back None and be judged whole."""
    even = [{"distance_m": 1000.0, "duration_s": 330} for _ in range(6)]
    assert ps.best_sustained_effort(even) is None


def test_a_mildly_uneven_run_is_still_judged_whole():
    """Every run has a fast patch. Only a deliberate structure counts — a few
    percent of natural variation must not be reinterpreted as an effort."""
    uneven = [
        {"distance_m": 1000.0, "duration_s": 340},
        {"distance_m": 1000.0, "duration_s": 325},
        {"distance_m": 1000.0, "duration_s": 318},
        {"distance_m": 1000.0, "duration_s": 336},
    ]
    assert ps.best_sustained_effort(uneven) is None


def test_a_short_burst_never_qualifies():
    """The anti-"your best kilometre" floor. A 400 m sprint is genuinely the
    fastest stretch here and must still be refused: Riegel from 400 m to a half
    is not an estimate, it's a number."""
    session = [
        {"distance_m": 400.0, "duration_s": 80},  # 3:20/km
        {"distance_m": 3000.0, "duration_s": 1050},  # 5:50/km
    ]
    effort = ps.best_sustained_effort(session)

    assert effort is None or effort.distance_m >= ps.MIN_EFFORT_M


def test_an_effort_spanning_several_laps_is_found():
    """Auto-lap splits a 3 km effort into kilometres. Contiguous windows are what
    make it readable; picking the single fastest lap would report 1 km."""
    session = [
        {"distance_m": 2000.0, "duration_s": 720},  # warm-up, 6:00/km
        {"distance_m": 1000.0, "duration_s": 265},
        {"distance_m": 1000.0, "duration_s": 270},
        {"distance_m": 1000.0, "duration_s": 268},
        {"distance_m": 2000.0, "duration_s": 780},  # cool-down
    ]
    effort = ps.best_sustained_effort(session)

    assert effort is not None
    assert effort.distance_m == 3000.0
    assert effort.time_s == 803


def test_unusable_splits_are_ignored_rather_than_guessed():
    """A lap with no distance would divide by zero; a run with nothing usable
    left has no effort to report."""
    assert ps.best_sustained_effort([]) is None
    assert ps.best_sustained_effort([{"distance_m": 0, "duration_s": 100}]) is None
    assert ps.best_sustained_effort([{"distance_m": None, "duration_s": None}]) is None
    # Too short overall to extrapolate from at all.
    assert ps.best_sustained_effort([{"distance_m": 800.0, "duration_s": 200}]) is None


def test_downgrade_confidence_steps_down_and_floors_at_low():
    high = ps.TimeEstimate(seconds=5000.0, confidence="high")
    stepped = ps.downgrade_confidence(high)
    assert stepped.confidence == "medium"
    assert stepped.seconds == high.seconds  # the estimate itself is kept
    assert ps.downgrade_confidence(stepped).confidence == "low"
    low = ps.TimeEstimate(seconds=5000.0, confidence="low")
    assert ps.downgrade_confidence(low).confidence == "low"
