"""A week's sessions are always read in calendar order.

The generator emits `sessions` in no particular order, and nothing used to sort
it — so a Thursday session could render above a Wednesday one, and the
"Séance n/N" numbering counted in that same wrong order. Normalising on the
model covers freshly generated plans and the ones already stored in Mongo.
"""

from datetime import UTC, datetime

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_moves_service as pms
from app.services import plan_service


def _s(
    day: Weekday, stype: str, slot: str = "primary", sport: SportType = SportType.RUN
) -> Session:
    return Session(day=day, sport=sport, type=stype, duration_min=40, rationale="x", slot=slot)


def _days(week: Week) -> list[Weekday]:
    return [s.day for s in week.sessions]


def test_week_sorts_sessions_by_weekday():
    # The order reported from the app: Tuesday, then THURSDAY, then Wednesday.
    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            _s(Weekday.TUESDAY, "tempo"),
            _s(Weekday.THURSDAY, "easy"),
            _s(Weekday.WEDNESDAY, "cross_training", sport=SportType.BASKETBALL),
            _s(Weekday.SUNDAY, "long_run"),
            _s(Weekday.MONDAY, "recovery"),
        ],
    )
    assert _days(week) == [
        Weekday.MONDAY,
        Weekday.TUESDAY,
        Weekday.WEDNESDAY,
        Weekday.THURSDAY,
        Weekday.SUNDAY,
    ]


def test_addon_follows_its_primary_on_the_same_day():
    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[
            _s(Weekday.WEDNESDAY, "strength", slot="addon", sport=SportType.STRENGTH),
            _s(Weekday.WEDNESDAY, "cross_training", sport=SportType.BASKETBALL),
        ],
    )
    assert [s.slot for s in week.sessions] == ["primary", "addon"]


def test_order_survives_a_round_trip_through_mongo_json():
    """Plans already stored keep the generator's order in the document; parsing
    them back must still yield calendar order (no migration needed)."""
    scrambled = Plan(
        goal=PlanGoal(description="Semi"),
        phases=[
            Phase(
                name="base",
                weeks=[
                    Week(
                        index=1,
                        is_deload=False,
                        target_load=100.0,
                        sessions=[_s(Weekday.FRIDAY, "easy"), _s(Weekday.MONDAY, "tempo")],
                    )
                ],
            )
        ],
    )
    reparsed = Plan.model_validate(scrambled.model_dump(mode="json"))
    assert _days(reparsed.phases[0].weeks[0]) == [Weekday.MONDAY, Weekday.FRIDAY]


async def test_moving_a_session_keeps_the_week_in_order(db):
    """`apply_moves` rewrites days in place, so the model validator doesn't
    re-run — the service has to re-sort or the moved session lands out of order."""
    user = await db.users.insert_one(
        {"email": "order@test.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(user.inserted_id)

    week = Week(
        index=1,
        is_deload=False,
        target_load=100.0,
        sessions=[_s(Weekday.TUESDAY, "tempo"), _s(Weekday.SATURDAY, "long_run")],
    )
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=[week])])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": datetime.now(UTC).date().isoformat(),
            "created_at": datetime.now(UTC),
        }
    )

    # Move the Saturday long run to Monday: it must lead the week, not trail it.
    await pms.move_session(db, user_id, 1, Weekday.SATURDAY, Weekday.MONDAY)
    current = (await plan_service.get_current_plan(db, user_id)).plan
    assert _days(current.phases[0].weeks[0]) == [Weekday.MONDAY, Weekday.TUESDAY]
