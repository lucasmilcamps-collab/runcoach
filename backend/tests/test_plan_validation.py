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


# --- Lot 0 fixes ---


def test_deload_without_load_reduction_flagged():
    plan = _valid_plan()
    # Week 4 is marked deload but keeps the full load of week 3.
    plan.phases[0].weeks[3].target_load = 116.0
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("deload mais charge" in v for v in violations)


def test_all_weeks_marked_deload_flagged():
    plan = _valid_plan()
    for week in plan.phases[0].weeks:
        week.is_deload = True
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("aucune semaine" in v for v in violations)


def test_long_run_returns_to_prior_level_after_deload_is_ok():
    weeks = [
        Week(
            index=1,
            is_deload=False,
            target_load=100.0,
            sessions=[_s(Weekday.SATURDAY, "long_run", 75)],
        ),
        Week(
            index=2,
            is_deload=False,
            target_load=108.0,
            sessions=[_s(Weekday.SATURDAY, "long_run", 88)],
        ),
        Week(
            index=3,
            is_deload=False,
            target_load=116.0,
            sessions=[_s(Weekday.SATURDAY, "long_run", 90)],
        ),
        Week(
            index=4,
            is_deload=True,
            target_load=80.0,
            sessions=[_s(Weekday.SATURDAY, "long_run", 60)],
        ),
        Week(
            index=5,
            is_deload=False,
            target_load=118.0,
            sessions=[_s(Weekday.SATURDAY, "long_run", 95)],
        ),
    ]
    plan = Plan(
        goal=PlanGoal(description="Semi", distance_km=21.1),
        phases=[Phase(name="base", weeks=weeks)],
    )
    # Week 5's 95 min returns near the pre-deload 90 — legitimate, not a jump.
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert not any("min/sem" in v for v in violations)


def test_quality_sunday_then_monday_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[0].sessions.append(_s(Weekday.SUNDAY, "threshold", 45))
    plan.phases[0].weeks[1].sessions.append(_s(Weekday.MONDAY, "intervals", 45))
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("consécutives" in v for v in violations)


def test_fixed_sport_two_days_both_accepted():
    plan = _valid_plan()
    for week in plan.phases[0].weeks:
        week.sessions.append(_s(Weekday.WEDNESDAY, "cross_training", 60, sport=SportType.BIKE))
        week.sessions.append(_s(Weekday.FRIDAY, "cross_training", 60, sport=SportType.BIKE))
    request = _valid_request(
        fixed_sports=[
            FixedSport(sport=SportType.BIKE, day=Weekday.WEDNESDAY),
            FixedSport(sport=SportType.BIKE, day=Weekday.FRIDAY),
        ]
    )
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert not any("contrainte fixe" in v for v in violations)


def test_missing_fixed_sport_flagged():
    plan = _valid_plan()  # contains no BIKE session
    request = _valid_request(fixed_sports=[FixedSport(sport=SportType.BIKE, day=Weekday.WEDNESDAY)])
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("manquant" in v for v in violations)


# --- Lot 2: anchor initial load + run-session cap ---


def test_initial_load_above_real_load_flagged():
    plan = _valid_plan()  # week 1 target_load = 100
    context = {"avg_weekly_load_4w": 80.0}  # real load 80 → ceiling 88
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY, context)
    assert any("trop haut" in v for v in violations)


def test_initial_load_check_skipped_without_context():
    plan = _valid_plan()
    assert plan_validation.validate_plan(plan, _valid_request(), TODAY) == []
    zero = {"avg_weekly_load_4w": 0.0}
    assert plan_validation.validate_plan(plan, _valid_request(), TODAY, zero) == []


def test_too_many_run_sessions_flagged():
    plan = _valid_plan()  # weeks 1-3 have 3 run sessions each
    request = _valid_request(max_run_sessions_per_week=2)
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert any("séances de course" in v for v in violations)


# --- Lot 3: session counts, strength placement, flexible fixed sports ---


def _strength(day: Weekday) -> Session:
    return Session(
        day=day,
        sport=SportType.STRENGTH,
        type="strength",
        duration_min=20,
        slot="addon",
        priority="optional",
        rationale="x",
    )


def test_not_enough_key_runs_flagged():
    plan = _valid_plan()  # 3 key runs/week, min defaults to 3
    plan.phases[0].weeks[0].sessions[0].priority = "optional"  # now only 2 key
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("'key'" in v for v in violations)


def test_strength_day_before_long_run_flagged():
    plan = _valid_plan()  # long_run is Saturday
    plan.phases[0].weeks[0].sessions.append(_strength(Weekday.FRIDAY))
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("renforcement la veille" in v for v in violations)


def test_strength_same_day_as_quality_ok():
    plan = _valid_plan()  # tempo is Thursday
    plan.phases[0].weeks[0].sessions.append(_strength(Weekday.THURSDAY))
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert not any("renforcement" in v for v in violations)


def test_two_strength_within_48h_flagged():
    plan = _valid_plan()
    plan.phases[0].weeks[0].sessions.append(_strength(Weekday.MONDAY))
    plan.phases[0].weeks[0].sessions.append(_strength(Weekday.TUESDAY))
    violations = plan_validation.validate_plan(plan, _valid_request(), TODAY)
    assert any("48" in v for v in violations)


def test_flexible_fixed_sport_one_day_ok():
    plan = _valid_plan()
    for week in plan.phases[0].weeks:
        week.sessions.append(_s(Weekday.SATURDAY, "cross_training", 60, sport=SportType.BIKE))
    request = _valid_request(
        fixed_sports=[
            FixedSport(sport=SportType.BIKE, day=Weekday.SATURDAY, flexible=True),
            FixedSport(sport=SportType.BIKE, day=Weekday.SUNDAY, flexible=True),
        ]
    )
    violations = plan_validation.validate_plan(plan, request, TODAY)
    assert not any("contrainte fixe" in v for v in violations)


def test_fixed_and_flexible_days_same_sport():
    """Basket = Wednesday training (fixed) + a match one of Fri/Sat/Sun (flexible)."""
    request = _valid_request(
        fixed_sports=[
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.WEDNESDAY, flexible=False),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.FRIDAY, flexible=True),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.SATURDAY, flexible=True),
            FixedSport(sport=SportType.BASKETBALL, day=Weekday.SUNDAY, flexible=True),
        ]
    )

    def basket(day: Weekday) -> Session:
        return _s(day, "cross_training", 90, sport=SportType.BASKETBALL)

    # Wed + Sat each week → satisfies the fixed day and the flexible pool.
    ok = _valid_plan()
    for week in ok.phases[0].weeks:
        week.sessions.append(basket(Weekday.WEDNESDAY))
        week.sessions.append(basket(Weekday.SUNDAY))
    assert not any(
        "contrainte fixe" in v for v in plan_validation.validate_plan(ok, request, TODAY)
    )

    # Missing Wednesday → fixed-day violation.
    no_wed = _valid_plan()
    for week in no_wed.phases[0].weeks:
        week.sessions.append(basket(Weekday.SATURDAY))
    assert any("manquant" in v for v in plan_validation.validate_plan(no_wed, request, TODAY))

    # Wednesday only, no match → flexible-pool violation.
    no_match = _valid_plan()
    for week in no_match.phases[0].weeks:
        week.sessions.append(basket(Weekday.WEDNESDAY))
    assert any("absent" in v for v in plan_validation.validate_plan(no_match, request, TODAY))
