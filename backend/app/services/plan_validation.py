"""Programmatic plan validation — the guarantee layer of the plan generator.

`validate_plan` returns a list of violation strings (empty = valid). The AI
proposes; this code decides. On failure the caller re-prompts with the
violations as feedback (plan-generator skill). Every rule encodes the
training-science skill: never +10%/week, deload every 3-4 weeks, taper into the
race, cross-training as a hard constraint, no back-to-back quality.
"""

import math
from collections import defaultdict
from datetime import date

from app.models.activity import SportType
from app.models.plan import (
    IMPACT_SPORTS,
    QUALITY_SESSION_TYPES,
    WEEKDAY_ORDER,
    Plan,
    PlanRequest,
    Week,
    Weekday,
)

RAMP_MAX_RATIO = 1.10  # weekly load never grows more than 10%
INITIAL_RAMP_MAX_RATIO = 1.10  # week 1 vs the athlete's real recent load
DELOAD_MAX_RATIO = 0.85  # a deload week is at most 85% of the last normal week
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
    # A plan that is entirely deload would slip through both this rule and the
    # ramp rule (which skips deload weeks) — a full escape hatch.
    if all(week.is_deload for week in weeks):
        return [
            "Toutes les semaines sont marquées deload : le plan n'a aucune semaine "
            "d'entraînement normale."
        ]

    violations: list[str] = []
    consecutive = 0
    last_normal_load: float | None = None
    for week in weeks:
        if week.is_deload:
            consecutive = 0
            # A deload must actually reduce the load, else the marker just bypasses
            # the ramp rule while keeping the load high.
            if (
                last_normal_load is not None
                and week.target_load > last_normal_load * DELOAD_MAX_RATIO
            ):
                pct = week.target_load / last_normal_load * 100
                violations.append(
                    f"Semaine {week.index} : marquée deload mais charge à {pct:.0f}% "
                    "de la dernière semaine normale (≤ 85% attendu)."
                )
            continue
        consecutive += 1
        last_normal_load = week.target_load
        if consecutive > MAX_CONSECUTIVE_NORMAL_WEEKS:
            violations.append(
                f"Semaine {week.index} : plus de {MAX_CONSECUTIVE_NORMAL_WEEKS} semaines "
                "sans deload (il en faut une par bloc de 4)."
            )
    return violations


def _check_fixed_sports(weeks: list[Week], request: PlanRequest) -> list[str]:
    """Flexibility is per DAY, not per sport, so a sport can mix both — e.g.
    basket = Wednesday training (fixed, exact day) + a match one of Fri/Sat/Sun
    (flexible pool). Fixed days must each appear every week; the flexible pool
    needs at least one of its days each week. The two are independent."""
    violations: list[str] = []
    fixed_days: dict[SportType, set[Weekday]] = defaultdict(set)  # each must appear
    flexible_days: dict[SportType, set[Weekday]] = defaultdict(set)  # one must appear
    all_days: dict[SportType, set[Weekday]] = defaultdict(set)
    for fs in request.fixed_sports:
        (flexible_days if fs.flexible else fixed_days)[fs.sport].add(fs.day)
        all_days[fs.sport].add(fs.day)

    # 1. A fixed sport that appears must land on one of its declared days.
    for week in weeks:
        for session in week.sessions:
            days = all_days.get(session.sport)
            if days is not None and session.day not in days:
                expected = ", ".join(sorted(d.value for d in days))
                violations.append(
                    f"Semaine {week.index} : {session.sport} placé {session.day}, "
                    f"attendu {expected} (contrainte fixe)."
                )

    # 2. Presence, per week.
    for week in weeks:
        present: dict[SportType, set[Weekday]] = defaultdict(set)
        for session in week.sessions:
            present[session.sport].add(session.day)
        for sport, days in fixed_days.items():
            for day in days:
                if day not in present[sport]:
                    violations.append(
                        f"Semaine {week.index} : {sport} manquant le {day} (contrainte fixe)."
                    )
        for sport, days in flexible_days.items():
            if not (present[sport] & days):
                expected = ", ".join(sorted(d.value for d in days))
                violations.append(
                    f"Semaine {week.index} : {sport} absent (attendu l'un de "
                    f"{expected}, contrainte fixe)."
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
    # Compare each normal week to the previous *normal* week only: returning to the
    # pre-deload level after a (lower) deload week is legitimate, not a jump.
    prev_long_normal: int | None = None
    for week in weeks:
        longest = max(
            (s.duration_min for s in week.sessions if s.type == "long_run"),
            default=0,
        )
        if longest > cap:  # absolute cap applies to every week, deload included
            violations.append(
                f"Semaine {week.index} : sortie longue {longest} min dépasse le plafond "
                f"de {cap} min pour cette distance."
            )
        if (
            prev_long_normal is not None
            and not week.is_deload
            and longest - prev_long_normal > LONG_RUN_WEEKLY_STEP_MAX_MIN
        ):
            violations.append(
                f"Semaine {week.index} : sortie longue +{longest - prev_long_normal} min "
                f"(> {LONG_RUN_WEEKLY_STEP_MAX_MIN} min/sem)."
            )
        if longest > 0 and not week.is_deload:
            prev_long_normal = longest
    return violations


def _check_quality_spacing(weeks: list[Week]) -> list[str]:
    violations: list[str] = []

    # Per-week count cap.
    for week in weeks:
        count = sum(1 for s in week.sessions if s.type in QUALITY_SESSION_TYPES)
        if count > MAX_QUALITY_PER_WEEK:
            violations.append(
                f"Semaine {week.index} : {count} séances de qualité (max {MAX_QUALITY_PER_WEEK})."
            )

    # No two quality sessions on consecutive days — including the Sunday→Monday
    # boundary between weeks (same pattern as _check_no_quality_after_impact).
    quality_days: set[tuple[int, int]] = set()
    for pos, week in enumerate(weeks):
        for session in week.sessions:
            if session.type in QUALITY_SESSION_TYPES:
                quality_days.add((pos, _weekday_index(session.day)))
    for pos, week in enumerate(weeks):
        for session in week.sessions:
            if session.type not in QUALITY_SESSION_TYPES:
                continue
            di = _weekday_index(session.day)
            prev_same_week = (pos, di - 1)
            prev_cross_week = (pos - 1, 6)  # previous Sunday
            if prev_same_week in quality_days or (
                di == 0 and pos > 0 and prev_cross_week in quality_days
            ):
                violations.append(
                    f"Semaine {week.index} : deux séances de qualité consécutives "
                    f"(le {session.day} suit une séance de qualité la veille)."
                )
    return violations


def _check_initial_load(weeks: list[Week], context: dict | None) -> list[str]:
    """The most dangerous jump in a plan is the join between the athlete's real
    current load and week 1 — _check_ramp only guards ramps *inside* the plan.
    A ceiling only (never a floor): starting below the real load is fine
    (e.g. an injury comeback)."""
    if not context:
        return []
    baseline = context.get("avg_weekly_load_4w")
    if not baseline or baseline <= 0:  # no reliable recent load → nothing to anchor to
        return []
    first = weeks[0].target_load
    if first > baseline * INITIAL_RAMP_MAX_RATIO:
        pct = (first / baseline - 1) * 100
        return [
            f"Semaine 1 : charge {first:.0f} TRIMP, +{pct:.0f}% au-dessus de la charge "
            f"réelle récente ({baseline:.0f}) — départ trop haut (≤ +10% attendu)."
        ]
    return []


def _run_sessions(week: Week) -> list:
    """Primary run sessions (addons like a strength block don't count as a run day)."""
    return [
        s
        for s in week.sessions
        if s.sport == SportType.RUN and s.type != "rest" and s.slot == "primary"
    ]


def _check_session_counts(weeks: list[Week], request: PlanRequest) -> list[str]:
    """At most `max` run sessions per week, and — on normal weeks — exactly `min`
    marked `key` so the athlete knows which ones not to skip. Deload weeks are
    lighter and exempt from the min-key floor."""
    violations: list[str] = []
    for week in weeks:
        runs = _run_sessions(week)
        total = len(runs)
        key = sum(1 for s in runs if s.priority == "key")
        if total > request.max_run_sessions_per_week:
            violations.append(
                f"Semaine {week.index} : {total} séances de course "
                f"(max {request.max_run_sessions_per_week} demandé)."
            )
        if not week.is_deload and key != request.min_run_sessions_per_week:
            violations.append(
                f"Semaine {week.index} : {key} séance(s) de course marquée(s) 'key' "
                f"(exactement {request.min_run_sessions_per_week} attendues)."
            )
    return violations


def _check_strength_placement(weeks: list[Week]) -> list[str]:
    """Hard days hard, easy days easy: no strength the day before a long run or a
    quality session, and ≥48h between two strength sessions in a week."""
    violations: list[str] = []
    hard_types = QUALITY_SESSION_TYPES | {"long_run"}
    strength_days: set[tuple[int, int]] = set()
    hard_days: set[tuple[int, int]] = set()
    for pos, week in enumerate(weeks):
        for session in week.sessions:
            if session.type == "strength":
                strength_days.add((pos, _weekday_index(session.day)))
            if session.type in hard_types:
                hard_days.add((pos, _weekday_index(session.day)))

    for pos, di in strength_days:
        next_same = (pos, di + 1)
        next_cross = (pos + 1, 0)
        if next_same in hard_days or (di == 6 and next_cross in hard_days):
            violations.append(
                f"Semaine {weeks[pos].index} : renforcement la veille d'une séance "
                "clé (sortie longue ou qualité)."
            )

    by_week: dict[int, list[int]] = defaultdict(list)
    for pos, di in strength_days:
        by_week[pos].append(di)
    for pos, days in by_week.items():
        days.sort()
        if any(b - a < 2 for a, b in zip(days, days[1:], strict=False)):
            violations.append(
                f"Semaine {weeks[pos].index} : deux renforcements à moins de 48 h."
            )
    return violations


def _check_calendar(weeks: list[Week], request: PlanRequest, start: date) -> list[str]:
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
        weeks_until = max(1, math.ceil((request.race_date - start).days / 7))
        if abs(len(weeks) - weeks_until) > 1:
            violations.append(
                f"Le plan compte {len(weeks)} semaines mais il reste ~{weeks_until} "
                "semaines avant la course."
            )
    return violations


def validate_plan(
    plan: Plan, request: PlanRequest, start: date, context: dict | None = None
) -> list[str]:
    """Return every rule violation (empty list = the plan may be persisted).

    `context` is the build_context dict; when present it anchors week 1's load
    on the athlete's real recent load. Optional so existing callers/tests keep
    working unchanged."""
    weeks = _flatten_weeks(plan)
    if not weeks:
        return ["Le plan ne contient aucune semaine."]

    violations: list[str] = []
    violations += _check_ramp(weeks)
    violations += _check_initial_load(weeks, context)
    violations += _check_deload(weeks)
    violations += _check_fixed_sports(weeks, request)
    violations += _check_session_counts(weeks, request)
    violations += _check_strength_placement(weeks)
    violations += _check_no_quality_after_impact(weeks)
    violations += _check_taper(weeks, request)
    violations += _check_long_run(weeks, request)
    violations += _check_quality_spacing(weeks)
    violations += _check_calendar(weeks, request, start)
    return violations
