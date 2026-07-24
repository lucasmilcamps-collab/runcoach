from datetime import date, timedelta

from app.models.activity import SportType
from app.models.plan import (
    FixedSport,
    Phase,
    Plan,
    PlanGoal,
    PlanRequest,
    Session,
    Week,
    Weekday,
)
from app.services import plan_validation

TODAY = date(2026, 7, 24)


def _s(day: Weekday, stype: str, duration: int, sport: SportType = SportType.RUN) -> Session:
    return Session(day=day, sport=sport, type=stype, duration_min=duration, rationale="x")


def _valid_request(**overrides) -> PlanRequest:
    base = {
        "goal_type": "distance",
        "distance_km": 21.1,
        "race_date": None,
        "available_days": list(Weekday),
        "max_run_sessions_per_week": 3,
        "fixed_sports": [],
    }
    base.update(overrides)
    return PlanRequest(**base)


def _valid_plan() -> Plan:
    """3 normal ascending weeks (+≤10%) plus a deload — satisfies every rule."""
    weeks = [
        Week(
            index=1,
            is_deload=False,
            target_load=100.0,
            sessions=[
                _s(Weekday.TUESDAY, "easy", 40),
                _s(Weekday.THURSDAY, "tempo", 45),
                _s(Weekday.SATURDAY, "long_run", 60),
            ],
        ),
        Week(
            index=2,
            is_deload=False,
            target_load=108.0,
            sessions=[
                _s(Weekday.TUESDAY, "easy", 40),
                _s(Weekday.THURSDAY, "tempo", 45),
                _s(Weekday.SATURDAY, "long_run", 75),
            ],
        ),
        Week(
            index=3,
            is_deload=False,
            target_load=116.0,
            sessions=[
                _s(Weekday.TUESDAY, "easy", 40),
                _s(Weekday.THURSDAY, "tempo", 45),
                _s(Weekday.SATURDAY, "long_run", 85),
            ],
        ),
        Week(
            index=4,
            is_deload=True,
            target_load=80.0,
            sessions=[
                _s(Weekday.TUESDAY, "easy", 40),
                _s(Weekday.SATURDAY, "long_run", 60),
            ],
        ),
    ]
    return Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=weeks)],
    )


def test_session_coerces_unknown_sport_to_other():
    session = Session(
        day=Weekday.MONDAY,
        sport="SWIMMING",  # not in SportType — should not raise
        type="cross_training",
        duration_min=40,
        rationale="x",
    )
    assert session.sport == SportType.OTHER


def test_valid_plan_has_no_violations():
    assert plan_validation.validate_plan(_valid_plan(), _valid_request(), TODAY) == []


def test_ramp_over_10_percent_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[1].target_load = 130.0  # +30% vs week 1
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("10%" in v for v in violations)


def test_missing_deload_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[3].is_deload = False  # four straight normal weeks
    plan.phases[0].weeks[3].target_load = 118.0  # keep ramp legal
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("deload" in v for v in violations)


def test_fixed_sport_wrong_day_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[0].sessions.append(
        _s(Weekday.TUESDAY, "cross_training", 90, sport=SportType.PADEL)
    )
    request = _valid_request(
        fixed_sports=[FixedSport(sport=SportType.PADEL, day=Weekday.WEDNESDAY)]
    )
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("contrainte fixe" in v for v in violations)


def test_quality_after_impact_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[0].sessions.append(
        _s(Weekday.WEDNESDAY, "cross_training", 90, sport=SportType.PADEL)
    )
    # Thursday already has a tempo (quality) — the day after the padel session.
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("impacts" in v for v in violations)


def test_taper_not_decreasing_flagged():
    plan = _valid_plan()
    plan.phases[0].name = "taper"
    plan.phases[0].weeks[3].is_deload = False
    plan.phases[0].weeks[3].target_load = 200.0  # final week heavier than previous
    race_date = TODAY + timedelta(weeks=4)
    request = _valid_request(goal_type="race", race_date=race_date)
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("taper" in v for v in violations)


def test_long_run_over_cap_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[2].sessions[-1].duration_min = 200  # cap for 10k is 90
    request = _valid_request(distance_km=10.0)
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("plafond" in v for v in violations)


def test_long_run_jump_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[1].sessions[-1].duration_min = 120  # +60 vs week 1's 60
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("min/sem" in v for v in violations)


def test_too_many_quality_flagged():
    plan = _valid_plan()
    week = plan.phases[0].weeks[0]
    week.sessions.append(_s(Weekday.MONDAY, "intervals", 45))
    week.sessions.append(_s(Weekday.SUNDAY, "threshold", 45))
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("qualité" in v and "max" in v for v in violations)


def test_consecutive_quality_days_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[0].sessions.append(_s(Weekday.FRIDAY, "intervals", 45))
    # Thursday tempo + Friday intervals = back-to-back quality.
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("consécutives" in v for v in violations)


def test_session_outside_available_days_flagged():
    plan = _valid_plan()
    request = _valid_request(available_days=[Weekday.TUESDAY, Weekday.THURSDAY, Weekday.SATURDAY])
    plan.phases[0].weeks[0].sessions.append(_s(Weekday.MONDAY, "easy", 30))
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("jours disponibles" in v for v in violations)


def test_wrong_week_count_for_race_flagged():
    plan = _valid_plan()  # 4 weeks
    race_date = TODAY + timedelta(weeks=12)  # ~12 weeks out
    request = _valid_request(goal_type="race", race_date=race_date)
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("semaines avant la course" in v for v in violations)
