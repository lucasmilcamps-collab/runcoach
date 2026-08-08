"""Race-time estimation — pure maths, no DB/HTTP/Garmin, reference-tested (same
contract as load_service). Two deterministic models:

- Riegel (`T2 = T1 · (D2/D1)^1.06`): extrapolate a recent performance to the
  target distance. Primary predictor.
- Daniels VDOT: a fitness score from a race, used as a cross-check / paces basis.

No AI. Garmin VO2max isn't stored, so there's no VO2max cross-check yet; the
sanity check on a source effort is the athlete's own median recent pace
(`is_source_pace_implausible`).
"""

import math
from dataclasses import dataclass
from statistics import median
from typing import Literal

RIEGEL_EXPONENT = 1.06

# How much of a relative CTL gain translates into a time improvement, and the
# absolute cap — deliberately conservative (endurance gains are slow).
_CTL_TO_TIME_GAIN = 0.5
_MAX_PROJECTED_IMPROVEMENT = 0.08  # 8%
# Realistic improvement ceiling over a plan, ~0.8%/week capped at 12%.
_IMPROVEMENT_PER_WEEK = 0.008
_MAX_REALISTIC_IMPROVEMENT = 0.12

# A source effort this much faster than the athlete's typical recent pace is
# more likely a measurement artefact (GPS drift, a run cut short, a downhill
# point-to-point) than a breakthrough. 20% is deliberately wide: real progress
# and a good day should pass, only the implausible should trip it.
_OUTLIER_PACE_RATIO = 0.80
# Below this many recent runs there's no meaningful "typical pace" to compare to.
_MIN_RUNS_FOR_PACE_MEDIAN = 4

Confidence = Literal["high", "medium", "low"]
#: Best first. Public so candidate efforts can be ranked by it, not just labelled.
CONFIDENCE_ORDER: tuple[Confidence, ...] = ("high", "medium", "low")

# Shortest window that can stand as a performance. Same 1.5 km the activity-level
# selection already uses — one threshold for "is this long enough to extrapolate
# from", not two that could drift apart.
MIN_EFFORT_M = 1500.0

# How much faster than the whole activity a window must be before it counts as a
# deliberate effort rather than the natural fast patch every run contains.
#
# NOTE: this is the one number in this module the training-science skill does not
# pin down — it is a descriptive cut-off for "was this session structured", not a
# physiological constant. It is set wide on purpose: a steady run's best window
# sits a few percent under its average, while a warm-up/effort/cool-down session
# is 15-25% apart, so nothing in between gets silently reinterpreted.
_EFFORT_GAIN_RATIO = 0.90

# Two windows within this much of each other count as the same pace, so the
# longer one wins. A single second per kilometre should not cost a kilometre of
# source distance.
_PACE_TIE_RATIO = 1.01


@dataclass(frozen=True)
class TimeEstimate:
    seconds: float
    confidence: Confidence


@dataclass(frozen=True)
class Effort:
    """A performance to extrapolate from: a whole run, or the fast part of one."""

    distance_m: float
    time_s: float
    #: False when this is the entire activity, True when it was isolated from it.
    isolated: bool

    @property
    def pace_s_per_km(self) -> float:
        return self.time_s / (self.distance_m / 1000)


def best_sustained_effort(
    splits: list[dict], min_distance_m: float = MIN_EFFORT_M
) -> Effort | None:
    """The fastest sustained stretch inside a run, from its per-lap splits.

    Why this exists: Riegel extrapolates whatever it is handed, and a structured
    session handed over whole is an average of things that were never run
    together. A 12-minute warm-up, a 2 km flat out and an 11-minute cool-down
    average to a pace the athlete never held — worth 22 minutes of error on a
    half marathon.

    Contiguous windows, not "the fastest lap": a single lap can be a GPS artefact
    or a downhill, while a stretch held across laps is an effort. And a floor of
    `min_distance_m` on the window, so this can never degenerate into "your best
    kilometre", which would turn every steady run into a fake personal best.

    Returns None when nothing stands out — the window has to be
    `_EFFORT_GAIN_RATIO` faster than the activity as a whole to count, so an even
    run keeps being judged as an even run. None means "use the whole activity".
    """
    laps = [
        s
        for s in splits
        if isinstance(s, dict)
        and isinstance(s.get("distance_m"), (int, float))
        and isinstance(s.get("duration_s"), (int, float))
        and s["distance_m"] > 0
        and s["duration_s"] > 0
    ]
    if not laps:
        return None

    total_m = sum(lap["distance_m"] for lap in laps)
    total_s = sum(lap["duration_s"] for lap in laps)
    if total_m < min_distance_m:
        return None
    whole_pace = total_s / (total_m / 1000)

    windows: list[Effort] = []
    for start in range(len(laps)):
        distance = time = 0.0
        for end in range(start, len(laps)):
            distance += laps[end]["distance_m"]
            time += laps[end]["duration_s"]
            if distance >= min_distance_m:
                windows.append(Effort(distance_m=distance, time_s=time, isolated=True))
    if not windows:
        return None

    # Fastest window, then the LONGEST among those effectively tied with it.
    # Riegel drifts as the distance ratio grows, so between a 2 km and a 3 km
    # held at the same pace the 3 km is strictly better evidence — and auto-lap
    # splitting one effort into kilometres produces exactly those near-ties.
    fastest = min(window.pace_s_per_km for window in windows)
    best = max(
        (w for w in windows if w.pace_s_per_km <= fastest * _PACE_TIE_RATIO),
        key=lambda w: w.distance_m,
    )

    if best.pace_s_per_km > whole_pace * _EFFORT_GAIN_RATIO:
        return None
    return best


def riegel_predict(
    known_distance_km: float, known_time_s: float, target_distance_km: float
) -> float:
    """Predicted time (s) at the target distance from a known performance."""
    if known_distance_km <= 0 or known_time_s <= 0 or target_distance_km <= 0:
        raise ValueError("distances and time must be positive")
    return known_time_s * (target_distance_km / known_distance_km) ** RIEGEL_EXPONENT


def daniels_vdot(distance_m: float, time_s: float) -> float:
    """Daniels/Gilbert VDOT from a race performance."""
    if distance_m <= 0 or time_s <= 0:
        raise ValueError("distance and time must be positive")
    t_min = time_s / 60.0
    velocity = distance_m / t_min  # m/min
    vo2 = -4.60 + 0.182258 * velocity + 0.000104 * velocity**2
    pct_max = (
        0.8 + 0.1894393 * math.exp(-0.012778 * t_min) + 0.2989558 * math.exp(-0.1932605 * t_min)
    )
    return vo2 / pct_max


def confidence_for(
    recent_distance_km: float, target_distance_km: float, days_ago: int
) -> Confidence:
    """Trust the estimate more when the effort is recent and its distance is
    close to the target (Riegel drifts as the ratio grows).

    Public because it also RANKS candidate efforts, not just labels the chosen
    one: picking a source on pace alone would always hand a 2 km flat out to
    Riegel over a recent 10 km, and the short one carries the bigger drift."""
    ratio = max(target_distance_km, recent_distance_km) / min(
        target_distance_km, recent_distance_km
    )
    if days_ago <= 21 and ratio <= 2.2:  # e.g. a recent 10k for a half
        return "high"
    if days_ago <= 45 and ratio <= 4.0:
        return "medium"
    return "low"


def is_source_pace_implausible(
    source_pace_s_per_km: float, recent_paces_s_per_km: list[float]
) -> bool:
    """True when the effort an estimate is built on is too fast to be believed
    against the athlete's own recent runs.

    Riegel extrapolates whatever it is given: one GPS-mangled or short-measured
    run becomes a fast "current time", which then drives both the prescribed
    paces and the feasibility warning. There is no VO2max cross-check to catch
    it (Garmin's value isn't stored), so the athlete's own median pace stands in
    — a comparison that needs no extra data and no model."""
    if source_pace_s_per_km <= 0 or len(recent_paces_s_per_km) < _MIN_RUNS_FOR_PACE_MEDIAN:
        return False
    return source_pace_s_per_km < median(recent_paces_s_per_km) * _OUTLIER_PACE_RATIO


def downgrade_confidence(estimate: TimeEstimate) -> TimeEstimate:
    """One notch down, never up, and never below `low`. The estimate itself is
    kept: discarding it would leave no anchor at all, which is worse than a
    flagged one — the caller and the UI decide how much to lean on it."""
    index = CONFIDENCE_ORDER.index(estimate.confidence)
    return TimeEstimate(
        seconds=estimate.seconds,
        confidence=CONFIDENCE_ORDER[min(index + 1, len(CONFIDENCE_ORDER) - 1)],
    )


def estimate_current_time(
    recent_distance_km: float,
    recent_time_s: float,
    days_ago: int,
    target_distance_km: float,
) -> TimeEstimate:
    """Estimated current time at the target distance from a recent effort."""
    seconds = riegel_predict(recent_distance_km, recent_time_s, target_distance_km)
    return TimeEstimate(
        seconds=seconds,
        confidence=confidence_for(recent_distance_km, target_distance_km, days_ago),
    )


def project_time_at_target(current_time_s: float, ctl_now: float, ctl_projected: float) -> float:
    """Projected time at the plan's end, scaling the current estimate by the
    projected fitness (CTL) gain — a conservative heuristic, capped."""
    if current_time_s <= 0 or ctl_now <= 0 or ctl_projected <= ctl_now:
        return current_time_s
    relative_gain = (ctl_projected - ctl_now) / ctl_now
    improvement = min(relative_gain * _CTL_TO_TIME_GAIN, _MAX_PROJECTED_IMPROVEMENT)
    return current_time_s * (1 - improvement)


def feasibility_warning(target_time_s: float, estimated_current_s: float, weeks: int) -> str | None:
    """Warn (never block) when the goal implies an unrealistic improvement over
    the weeks available."""
    if target_time_s <= 0 or estimated_current_s <= 0 or weeks <= 0:
        return None
    if target_time_s >= estimated_current_s:
        return None  # goal is at or above current level — always feasible
    required = 1 - target_time_s / estimated_current_s
    realistic = min(weeks * _IMPROVEMENT_PER_WEEK, _MAX_REALISTIC_IMPROVEMENT)
    if required > realistic:
        return (
            f"Objectif ambitieux : il demande ~{required * 100:.0f}% de progression en "
            f"{weeks} semaines, au-delà de ce qui est réaliste (~{realistic * 100:.0f}%). "
            "Le plan vise l'objectif, mais reste prudent."
        )
    return None
