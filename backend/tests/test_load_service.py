import math
from datetime import date, timedelta

import pytest

from app.services import load_service

# A realistic athlete: HRmax 190, HRrest 50 → HRR 140.
# Zone lower bounds (bpm): Z1 120(50%), Z2 134(60%), Z3 148(70%), Z4 162(80%), Z5 176(90%).
HR_MAX = 190
HR_REST = 50


@pytest.mark.parametrize(
    ("avg_hr", "expected_zone"),
    [
        (110, 1),  # below Z2 floor → Z1
        (120, 1),  # exactly 50% HRR → Z1
        (134, 2),  # 60% HRR → Z2
        (148, 3),  # 70% HRR → Z3
        (162, 4),  # 80% HRR → Z4
        (176, 5),  # 90% HRR → Z5
        (190, 5),  # HRmax → Z5
    ],
)
def test_zone_for_hr_reference_values(avg_hr, expected_zone):
    assert load_service.zone_for_hr(avg_hr, HR_MAX, HR_REST) == expected_zone


def test_zone_for_hr_rejects_invalid_reserve():
    with pytest.raises(ValueError):
        load_service.zone_for_hr(150, 150, 150)


def test_compute_trimp_z2_hour():
    # 60 min in Z2 → 60 × 2 = 120.
    assert load_service.compute_trimp(3600, 134, HR_MAX, HR_REST) == 120.0


def test_compute_trimp_z4_thirty_min():
    # 30 min in Z4 → 30 × 4 = 120.
    assert load_service.compute_trimp(1800, 162, HR_MAX, HR_REST) == 120.0


def test_compute_trimp_none_without_hr():
    assert load_service.compute_trimp(3600, None, HR_MAX, HR_REST) is None


def test_compute_trimp_none_without_profile():
    assert load_service.compute_trimp(3600, 140, None, None) is None


def test_constant_load_keeps_ctl_flat():
    """Seed = mean daily load, and a constant daily load equal to that seed
    leaves CTL and ATL unchanged — the classic steady-state check."""
    today = date(2026, 7, 23)
    days = [today - timedelta(days=i) for i in range(200)]
    daily_loads = {d: 100.0 for d in days}

    series = load_service.compute_fitness_series(daily_loads, today)

    last = series[-1]
    assert math.isclose(last.ctl, 100.0, abs_tol=1e-6)
    assert math.isclose(last.atl, 100.0, abs_tol=1e-6)
    assert math.isclose(last.tsb, 0.0, abs_tol=1e-6)


def test_ramp_up_makes_atl_outrun_ctl():
    """A block that loads harder than the seed pushes fatigue (7-day) above
    fitness (42-day), so TSB on the last day is negative (accumulated
    fatigue)."""
    today = date(2026, 7, 23)
    start = today - timedelta(days=59)
    # First 30 days quiet, last 30 days heavy — a classic ramp.
    daily_loads = {}
    for i in range(60):
        day = start + timedelta(days=i)
        daily_loads[day] = 20.0 if i < 30 else 150.0

    series = load_service.compute_fitness_series(daily_loads, today)

    last = series[-1]
    assert last.atl > last.ctl  # fatigue leads fitness during a build
    assert last.tsb < 0  # form is negative while ramping


def test_single_spike_raises_atl_more_than_ctl():
    today = date(2026, 7, 23)
    start = today - timedelta(days=30)
    daily_loads = {start + timedelta(days=i): 0.0 for i in range(31)}
    daily_loads[today] = 300.0  # one hard session today

    series = load_service.compute_fitness_series(daily_loads, today)

    last = series[-1]
    # A single hard day lifts fatigue (7-day) well above fitness (42-day).
    assert last.atl > last.ctl


def test_low_confidence_flag():
    today = date(2026, 7, 23)
    short = {today - timedelta(days=i): 50.0 for i in range(30)}
    long = {today - timedelta(days=i): 50.0 for i in range(120)}

    assert load_service.has_low_confidence(short, today) is True
    assert load_service.has_low_confidence(long, today) is False
    assert load_service.has_low_confidence({}, today) is True


def test_empty_series():
    assert load_service.compute_fitness_series({}, date(2026, 7, 23)) == []
