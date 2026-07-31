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
_CONFIDENCE_ORDER: tuple[Confidence, ...] = ("high", "medium", "low")


@dataclass(frozen=True)
class TimeEstimate:
    seconds: float
    confidence: Confidence


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


def _confidence(recent_distance_km: float, target_distance_km: float, days_ago: int) -> Confidence:
    """Trust the estimate more when the effort is recent and its distance is
    close to the target (Riegel drifts as the ratio grows)."""
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
    index = _CONFIDENCE_ORDER.index(estimate.confidence)
    return TimeEstimate(
        seconds=estimate.seconds,
        confidence=_CONFIDENCE_ORDER[min(index + 1, len(_CONFIDENCE_ORDER) - 1)],
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
        seconds=seconds, confidence=_confidence(recent_distance_km, target_distance_km, days_ago)
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
