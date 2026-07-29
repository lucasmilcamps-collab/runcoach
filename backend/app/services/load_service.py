"""Training-load maths — the single source of truth for the project's
physiology (see the training-science skill). Every function here is pure and
covered by reference-value tests; nothing in this module touches Garmin, the
DB, or HTTP.
"""

from datetime import date, timedelta

# Lower bound of each zone as a fraction of heart-rate reserve (Karvonen).
# Z1 50–60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90–100%.
_ZONE_LOWER_BOUNDS = (0.50, 0.60, 0.70, 0.80, 0.90)

CTL_TIME_CONSTANT = 42  # fitness, days
ATL_TIME_CONSTANT = 7  # fatigue, days
HISTORY_DAYS_FOR_CONFIDENCE = 90  # seeding CTL needs ~90 days (training-science)


def zone_for_hr(avg_hr: float, hr_max: int, hr_rest: int) -> int:
    """Karvonen zone (1–5) for a heart rate. Never the 220−age formula:
    both bounds come from the athlete's real Garmin values."""
    hrr = hr_max - hr_rest
    if hrr <= 0:
        raise ValueError("hr_max must be greater than hr_rest")
    pct = (avg_hr - hr_rest) / hrr
    # Walk zones high→low; anything at/above a lower bound belongs to it.
    for zone in (5, 4, 3, 2):
        if pct >= _ZONE_LOWER_BOUNDS[zone - 1]:
            return zone
    return 1  # below Z2's floor is still Z1 (recovery), never zero


def edwards_trimp(zone_seconds: list[float] | tuple[float, ...]) -> float:
    """True Edwards TRIMP from time spent per HR zone (Z1..Z5):
    `1·t(Z1) + 2·t(Z2) + … + 5·t(Z5)`, t in minutes. This is the accurate form —
    a 6×800m that averages Z3 but spends 20 min in Z5 is scored on the Z5 time,
    not the Z3 average (training-science skill)."""
    return sum((zone + 1) * (seconds / 60) for zone, seconds in enumerate(zone_seconds))


def compute_trimp(
    duration_s: int,
    avg_hr: float | None,
    hr_max: int | None,
    hr_rest: int | None,
    zone_seconds: list[float] | tuple[float, ...] | None = None,
) -> float | None:
    """Edwards TRIMP for one session. Prefers real time-per-zone when Garmin
    provides it (`zone_seconds`, 5 values Z1..Z5); otherwise falls back to the
    average-HR form: duration(min) × the zone factor of the average HR.
    Sport-agnostic on purpose, so cross-training counts too.

    Returns None when TRIMP can't be derived (no zone times and no usable HR);
    the caller decides how to surface that, never invents a number."""
    if zone_seconds is not None and len(zone_seconds) == 5 and sum(zone_seconds) > 0:
        return edwards_trimp(zone_seconds)
    if avg_hr is None or hr_max is None or hr_rest is None or hr_max <= hr_rest:
        return None
    duration_min = duration_s / 60
    return duration_min * zone_for_hr(avg_hr, hr_max, hr_rest)


def compute_session_rpe_load(duration_s: int, rpe: int | None) -> float | None:
    """Session-RPE fallback (Foster) for a manually-logged session with no HR:
    RPE (1–10) × duration(min) / 10 (training-science skill — the /10 keeps it on
    the same scale as the Edwards TRIMP used everywhere else). Returns None when
    RPE is absent or out of range, so the caller never invents a load."""
    if rpe is None or not 1 <= rpe <= 10:
        return None
    duration_min = duration_s / 60
    return rpe * duration_min / 10


class FitnessPoint:
    __slots__ = ("day", "load", "ctl", "atl", "tsb")

    def __init__(self, day: date, load: float, ctl: float, atl: float, tsb: float):
        self.day = day
        self.load = load
        self.ctl = ctl
        self.atl = atl
        self.tsb = tsb


def compute_fitness_series(
    daily_loads: dict[date, float], today: date
) -> list[FitnessPoint]:
    """Exponentially-weighted CTL/ATL/TSB over a continuous day series.

    daily_loads maps a day to that day's summed TRIMP (missing days = 0).
    The series runs from the earliest loaded day to `today`. CTL and ATL are
    seeded to the mean daily load over the span (training-science: seed to the
    average of available load), then updated with the skill's exact formulas.
    """
    if not daily_loads:
        return []

    start = min(daily_loads)
    span_days = (today - start).days + 1
    mean_load = sum(daily_loads.values()) / span_days

    ctl_prev = mean_load
    atl_prev = mean_load
    series: list[FitnessPoint] = []
    for offset in range(span_days):
        day = start + timedelta(days=offset)
        load = daily_loads.get(day, 0.0)
        tsb = ctl_prev - atl_prev  # form uses yesterday's fitness/fatigue
        ctl = ctl_prev + (load - ctl_prev) / CTL_TIME_CONSTANT
        atl = atl_prev + (load - atl_prev) / ATL_TIME_CONSTANT
        series.append(FitnessPoint(day, load, ctl, atl, tsb))
        ctl_prev, atl_prev = ctl, atl

    return series


def has_low_confidence(daily_loads: dict[date, float], today: date) -> bool:
    """True when there isn't enough history to trust the CTL seed."""
    if not daily_loads:
        return True
    span_days = (today - min(daily_loads)).days + 1
    return span_days < HISTORY_DAYS_FOR_CONFIDENCE
