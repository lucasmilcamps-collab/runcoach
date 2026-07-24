"""Programmatic plan validation — the guarantee layer of the plan generator.

`validate_plan` returns a list of violation strings (empty = valid). The AI
proposes; this code decides. On failure the caller re-prompts with the
violations as feedback (plan-generator skill). Every rule encodes the
training-science skill: never +10%/week, deload every 3-4 weeks, taper into the
race, cross-training as a hard constraint, no back-to-back quality.
"""

import math
from datetime import date

from app.models.plan import (
    IMPACT_SPORTS,
    QUALITY_SESSION_TYPES,
    WEEKDAY_ORDER,
    Plan,
    PlanRequest,
    Week,
)

RAMP_MAX_RATIO = 1.10  # weekly load never grows more than 10%
MAX_CONSECUTIVE_NORMAL_WEEKS = 3  # ≥1 deload per 4-week block
MAX_QUALITY_PER_WEEK = 2
LONG_RUN_WEEKLY_STEP_MAX_MIN = 15


def _long_run_cap_min(distance_km: float | None) -> int:
    if distance_km is None:
        return 120
    if distance_km <= 12:  # 5–10 km
        return 90
    if distance_km <= 25:  # half
        return 150
    return 210  # marathon and up


def _flatten_weeks(plan: Plan) -> list[Week]:
    weeks: list[Week] = []
    for phase in plan.phases:
        weeks.extend(phase.weeks)
    return weeks


def _weekday_index(day) -> int:
    return WEEKDAY_ORDER.index(day)


def _check_ramp(weeks: list[Week]) -> list[str]:
    violations: list[str] = []
    last_normal_load: float | None = None
    for week in weeks:
        if week.is_deload:
            continue  # deload weeks are intentionally lower — excluded from ramp
        if last_normal_load is not None and week.target_load > last_normal_load * RAMP_MAX_RATIO:
            pct = (week.target_load / last_normal_load - 1) * 100
            violations.append(
                f"Semaine {week.index} : charge +{pct:.0f}% (> 10% autorisé) "
                "par rapport à la dernière semaine normale."
            )
        last_normal_load = week.target_load
    return violations


def _check_deload(weeks: list[Week]) -> list[str]:
    if len(weeks) < 4:
        return []
    consecutive = 0
    for week in weeks:
        consecutive = 0 if week.is_deload else consecutive + 1
        if consecutive > MAX_CONSECUTIVE_NORMAL_WEEKS:
            return [
                f"Semaine {week.index} : plus de {MAX_CONSECUTIVE_NORMAL_WEEKS} semaines "
                "sans deload (il en faut une par bloc de 4)."
            ]
    return []


def _check_fixed_sports(weeks: list[Week], request: PlanRequest) -> list[str]:
    violations: list[str] = []
    fixed_days = {fs.sport: fs.day for fs in request.fixed_sports}
    for week in weeks:
        for session in week.sessions:
            expected_day = fixed_days.get(session.sport)
            if expected_day is not None and session.day != expected_day:
                violations.append(
                    f"Semaine {week.index} : {session.sport} placé {session.day}, "
                    f"attendu {expected_day} (contrainte fixe)."
                )
    return violations


def _check_no_quality_after_impact(weeks: list[Week]) -> list[str]:
    """No hard run the day after an impact sport (padel/basket) — soreness rule.
    Checks within a week and across the Sunday→Monday boundary."""
    violations: list[str] = []
    # Positions (week-position, weekday-index) that carry an impact sport.
    impact_days: set[tuple[int, int]] = set()
    for pos, week in enumerate(weeks):
        for session in week.sessions:
            if session.sport in IMPACT_SPORTS:
                impact_days.add((pos, _weekday_index(session.day)))
    for pos, week in enumerate(weeks):
        for session in week.sessions:
            if session.type not in QUALITY_SESSION_TYPES:
                continue
            di = _weekday_index(session.day)
            prev_same_week = (pos, di - 1)
            prev_cross_week = (pos - 1, 6)  # previous Sunday
            after_impact = prev_same_week in impact_days or (
                di == 0 and pos > 0 and prev_cross_week in impact_days
            )
            if after_impact:
                violations.append(
                    f"Semaine {week.index} : séance qualité ({session.type}) le lendemain "
                    "d'un sport à impacts."
                )
    return violations


def _check_taper(weeks: list[Week], request: PlanRequest) -> list[str]:
    if request.goal_type != "race" or len(weeks) < 2:
        return []
    if weeks[-1].target_load >= weeks[-2].target_load:
        return [
            f"Semaine {weeks[-1].index} (finale) : la charge ne décroît pas "
            "avant la course (taper)."
        ]
    return []


def _check_long_run(weeks: list[Week], request: PlanRequest) -> list[str]:
    violations: list[str] = []
    cap = _long_run_cap_min(request.distance_km)
    prev_long: int | None = None
    for week in weeks:
        longest = max(
            (s.duration_min for s in week.sessions if s.type == "long_run"),
            default=0,
        )
        if longest > cap:
            violations.append(
                f"Semaine {week.index} : sortie longue {longest} min dépasse le plafond "
                f"de {cap} min pour cette distance."
            )
        if (
            prev_long is not None
            and not week.is_deload
            and longest - prev_long > LONG_RUN_WEEKLY_STEP_MAX_MIN
        ):
            violations.append(
                f"Semaine {week.index} : sortie longue +{longest - prev_long} min "
                f"(> {LONG_RUN_WEEKLY_STEP_MAX_MIN} min/sem)."
            )
        if longest > 0:
            prev_long = longest
    return violations


def _check_quality_spacing(weeks: list[Week]) -> list[str]:
    violations: list[str] = []
    for week in weeks:
        quality = sorted(
            (s for s in week.sessions if s.type in QUALITY_SESSION_TYPES),
            key=lambda s: _weekday_index(s.day),
        )
        if len(quality) > MAX_QUALITY_PER_WEEK:
            violations.append(
                f"Semaine {week.index} : {len(quality)} séances de qualité "
                f"(max {MAX_QUALITY_PER_WEEK})."
            )
        for a, b in zip(quality, quality[1:], strict=False):
            if _weekday_index(b.day) - _weekday_index(a.day) == 1:
                violations.append(
                    f"Semaine {week.index} : deux séances de qualité consécutives "
                    f"({a.day} puis {b.day})."
                )
    return violations


def _check_calendar(weeks: list[Week], request: PlanRequest, today: date) -> list[str]:
    violations: list[str] = []
    allowed_days = set(request.available_days) | {fs.day for fs in request.fixed_sports}
    for week in weeks:
        for session in week.sessions:
            if session.type == "rest":
                continue
            if session.day not in allowed_days:
                violations.append(
                    f"Semaine {week.index} : séance {session.day} hors des jours disponibles."
                )
    if request.race_date is not None and weeks:
        weeks_until = max(1, math.ceil((request.race_date - today).days / 7))
        if abs(len(weeks) - weeks_until) > 1:
            violations.append(
                f"Le plan compte {len(weeks)} semaines mais il reste ~{weeks_until} "
                "semaines avant la course."
            )
    return violations


def validate_plan(plan: Plan, request: PlanRequest, today: date) -> list[str]:
    """Return every rule violation (empty list = the plan may be persisted)."""
    weeks = _flatten_weeks(plan)
    if not weeks:
        return ["Le plan ne contient aucune semaine."]

    violations: list[str] = []
    violations += _check_ramp(weeks)
    violations += _check_deload(weeks)
    violations += _check_fixed_sports(weeks, request)
    violations += _check_no_quality_after_impact(weeks)
    violations += _check_taper(weeks, request)
    violations += _check_long_run(weeks, request)
    violations += _check_quality_spacing(weeks)
    violations += _check_calendar(weeks, request, today)
    return violations
