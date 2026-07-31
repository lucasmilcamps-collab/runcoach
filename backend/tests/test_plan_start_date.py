"""Choosing when a plan starts.

Week 1 always begins on a Monday, because weeks are the unit a plan is built and
read in. What the athlete controls is *which* Monday.
"""

from datetime import UTC, date, datetime, timedelta

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, PlanRequest, Session, Week, Weekday
from app.services import plan_service


def _request(**overrides) -> PlanRequest:
    payload = {
        "goal_type": "race",
        "distance_km": 21.1,
        "available_days": [Weekday.TUESDAY, Weekday.THURSDAY, Weekday.SUNDAY],
    }
    payload.update(overrides)
    return PlanRequest(**payload)


# A known week: 2026-07-27 is a Monday.
MONDAY = date(2026, 7, 27)


def test_defaults_to_this_week_early_in_the_week():
    for offset, day in [(0, "lundi"), (1, "mardi"), (2, "mercredi")]:
        assert (
            plan_service.resolve_start_date(_request(), MONDAY + timedelta(days=offset)) == MONDAY
        ), day


def test_defaults_to_next_monday_once_the_week_is_spent():
    """The whole point: generating on a Friday must not hand back a week that is
    already five-sevenths gone."""
    for offset, day in [(3, "jeudi"), (4, "vendredi"), (5, "samedi"), (6, "dimanche")]:
        assert plan_service.resolve_start_date(
            _request(), MONDAY + timedelta(days=offset)
        ) == MONDAY + timedelta(days=7), day


def test_an_explicit_choice_wins_over_the_default():
    friday = MONDAY + timedelta(days=4)
    chosen = MONDAY + timedelta(days=21)  # three Mondays out
    assert plan_service.resolve_start_date(_request(start_date=chosen), friday) == chosen


def test_a_chosen_date_is_snapped_back_to_its_monday():
    """Sessions carry weekdays; a plan starting on a Wednesday would shift every
    week of the plan against the calendar."""
    wednesday = MONDAY + timedelta(days=9)  # a Wednesday, in the following week
    assert plan_service.resolve_start_date(
        _request(start_date=wednesday), MONDAY
    ) == MONDAY + timedelta(days=7)


def test_a_past_date_is_pulled_up_to_this_week():
    """Starting in the past would open the plan mid-way, with sessions counted
    as missed that the athlete never had the chance to run."""
    long_ago = MONDAY - timedelta(days=28)
    assert plan_service.resolve_start_date(_request(start_date=long_ago), MONDAY) == MONDAY


def test_week_count_is_measured_from_the_start_not_from_today():
    """A plan asked for on a Friday to start next Monday has one week less
    before the race — counting from today would overshoot race day."""
    friday = MONDAY + timedelta(days=4)
    race = MONDAY + timedelta(days=70)  # 10 weeks after this Monday
    request = _request(race_date=race)

    start = plan_service.resolve_start_date(request, friday)

    assert plan_service._weeks_until(request, start) == 9
    assert "EXACTEMENT 9 semaines" in plan_service._weeks_directive(request, start)


async def test_a_future_plan_says_so_instead_of_saying_it_is_over(db):
    """`week_pos < 0` used to fall into the "plan terminé" branch — the exact
    opposite of the truth for a plan that hasn't started."""
    user = await db.users.insert_one(
        {"email": "start@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(user.inserted_id)
    today = datetime.now(UTC).date()
    next_monday = today + timedelta(days=7 - today.weekday())
    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            Session(
                day=Weekday.TUESDAY,
                sport=SportType.RUN,
                type="easy",
                duration_min=40,
                rationale="x",
            )
        ],
    )
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": Plan(
                goal=PlanGoal(description="Semi"), phases=[Phase(name="base", weeks=[week])]
            ).model_dump(mode="json"),
            "request": None,
            "start_date": next_monday.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )

    result = await plan_service.get_today_session(db, user_id)

    assert result.has_plan is True
    assert result.has_session is False
    assert "démarre" in (result.message or "")
    assert "terminé" not in (result.message or "")
