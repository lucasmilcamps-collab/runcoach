"""Settling an elapsed week.

The rule under test: a session nobody decided about is not neutral — adherence
already counts it as missed and that feeds the replan trigger. So "pending" has
to mean exactly "the athlete has not said", and the queue has to be small enough
to actually clear.
"""

from datetime import UTC, datetime, timedelta

from app.models.activity import SportType
from app.models.plan import Phase, Plan, PlanGoal, Session, Week, Weekday
from app.services import plan_completion_service as pcs
from app.services import plan_moves_service, plan_reconcile_service


def _s(day: Weekday, stype: str = "tempo", sport: SportType = SportType.RUN) -> Session:
    return Session(day=day, sport=sport, type=stype, duration_min=50, rationale="x")


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    return str(result.inserted_id)


def _last_monday() -> "datetime.date":
    today = datetime.now(UTC).date()
    return today - timedelta(days=today.weekday()) - timedelta(days=7)


async def _seed_plan(db, user_id: str, weeks: list[Week], start=None):
    """Week 1 is last week (fully elapsed), week 2 is the current one."""
    start = start or _last_monday()
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=weeks)])
    await db.plans.insert_one(
        {
            "user_id": user_id,
            "version": 1,
            "status": "ready",
            "plan": plan.model_dump(mode="json"),
            "start_date": start.isoformat(),
            "created_at": datetime.now(UTC),
        }
    )
    return start


def _week(index: int, sessions: list[Session]) -> Week:
    return Week(index=index, is_deload=False, target_load=100.0, sessions=sessions)


async def _seed_activity(db, user_id: str, on_date, sport=SportType.RUN, duration_s=3000) -> str:
    result = await db.activities.insert_one(
        {
            "user_id": user_id,
            "garmin_activity_id": int(on_date.strftime("%Y%m%d")) + duration_s,
            "sport": sport,
            "start_time": datetime(on_date.year, on_date.month, on_date.day, 7, tzinfo=UTC),
            "duration_s": duration_s,
        }
    )
    return str(result.inserted_id)


# --- What counts as still undecided -------------------------------------------


async def test_only_undecided_sessions_are_pending(db):
    """Linked and skipped are both the athlete's own statement. Everything else
    in an elapsed week is a question nobody has answered."""
    user_id = await _seed_user(db)
    start = await _seed_plan(
        db,
        user_id,
        [
            _week(
                1,
                [
                    _s(Weekday.MONDAY, "long_run"),
                    _s(Weekday.WEDNESDAY, "tempo"),
                    _s(Weekday.FRIDAY, "threshold"),
                ],
            ),
            _week(2, [_s(Weekday.TUESDAY, "easy")]),
        ],
    )
    activity = await _seed_activity(db, user_id, start)
    await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, activity)
    await plan_moves_service.skip_session(db, user_id, 1, Weekday.WEDNESDAY, "primary", True)

    queue = await plan_reconcile_service.pending(db, user_id)

    assert queue.has_pending is True
    assert [(r.week_index, r.day) for r in queue.sessions] == [(1, Weekday.FRIDAY)]
    assert queue.week_indices == [1]


async def test_the_current_week_is_never_pending(db):
    """A week still being lived can't be settled: asking about Saturday on
    Wednesday would report a miss nobody made."""
    user_id = await _seed_user(db)
    today = datetime.now(UTC).date()
    this_monday = today - timedelta(days=today.weekday())
    await _seed_plan(
        db,
        user_id,
        [_week(1, [_s(d) for d in (Weekday.MONDAY, Weekday.SATURDAY)])],
        start=this_monday,
    )

    assert (await plan_reconcile_service.pending(db, user_id)).has_pending is False


async def test_a_rest_day_is_never_pending(db):
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY, "rest")])])

    assert (await plan_reconcile_service.pending(db, user_id)).has_pending is False


async def test_the_queue_stops_at_the_adherence_window(db):
    """The bound that keeps the block from being a wall. Past 14 days a session
    is already ignored by `_counts_in_window`, so settling it changes nothing —
    three weeks away must not cost fifteen decisions for no effect."""
    user_id = await _seed_user(db)
    today = datetime.now(UTC).date()
    # Week 1 starts four weeks back, week 4 is last week.
    start = today - timedelta(days=today.weekday()) - timedelta(weeks=4)
    await _seed_plan(
        db,
        user_id,
        [_week(i, [_s(Weekday.TUESDAY)]) for i in range(1, 5)],
        start=start,
    )

    queue = await plan_reconcile_service.pending(db, user_id)

    # Asserted as the property rather than as week numbers: which weeks straddle
    # the 14-day line depends on what day of the week it is today, and a test
    # that only passes on Tuesdays tests the calendar, not the rule.
    assert queue.sessions
    assert all(row.session_date >= today - timedelta(days=14) for row in queue.sessions)
    assert 4 in queue.week_indices  # last week is always asked about
    assert 1 not in queue.week_indices  # a month ago never is


async def test_no_plan_never_blocks_the_app(db):
    """The app gates on this, so it must not be able to gate on nothing."""
    user_id = await _seed_user(db)
    assert (await plan_reconcile_service.pending(db, user_id)).has_pending is False


# --- The suggestion has to be tappable ----------------------------------------


async def test_a_run_is_suggested_for_a_planned_run(db):
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY, "long_run")])])
    await _seed_activity(db, user_id, start)

    queue = await plan_reconcile_service.pending(db, user_id)

    assert queue.sessions[0].suggested_activity is not None
    assert queue.sessions[0].suggested_activity.sport == SportType.RUN


async def test_a_padel_game_is_never_suggested_for_a_run(db):
    """`set_session_link` refuses it with a 409 — offering it would put a button
    on screen that cannot work."""
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY, "long_run")])])
    await _seed_activity(db, user_id, start, sport=SportType.PADEL)

    queue = await plan_reconcile_service.pending(db, user_id)

    assert queue.sessions[0].suggested_activity is None


async def test_an_activity_already_linked_is_not_offered_again(db):
    """Two sessions on the same day would otherwise both point at the one run,
    and confirming both would mark a session done on someone else's activity."""
    user_id = await _seed_user(db)
    start = await _seed_plan(
        db,
        user_id,
        [
            _week(
                1,
                [
                    _s(Weekday.MONDAY, "long_run"),
                    Session(
                        day=Weekday.MONDAY,
                        sport=SportType.STRENGTH,
                        type="strength",
                        duration_min=20,
                        slot="addon",
                        priority="optional",
                        rationale="x",
                    ),
                ],
            )
        ],
    )
    activity = await _seed_activity(db, user_id, start)
    await pcs.set_session_link(db, user_id, 1, Weekday.MONDAY, activity, slot="primary")

    queue = await plan_reconcile_service.pending(db, user_id)

    addon = next(r for r in queue.sessions if r.slot == "addon")
    assert addon.suggested_activity is None


async def test_the_longest_activity_of_the_day_wins(db):
    """A warm-up logged separately must not stand in for the session."""
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY, "long_run")])])
    await _seed_activity(db, user_id, start, duration_s=600)
    await _seed_activity(db, user_id, start, duration_s=4200)

    queue = await plan_reconcile_service.pending(db, user_id)

    assert queue.sessions[0].suggested_activity.duration_s == 4200


# --- Settling the week in one tap ---------------------------------------------


async def test_skip_all_empties_the_queue(db):
    """A week that went badly settles in one tap — the other half of what makes
    a blocking screen acceptable."""
    user_id = await _seed_user(db)
    await _seed_plan(
        db,
        user_id,
        [_week(1, [_s(d) for d in (Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY)])],
    )

    settled = await plan_reconcile_service.resolve_all_missed(db, user_id)

    assert settled == 3
    assert (await plan_reconcile_service.pending(db, user_id)).has_pending is False


async def test_a_moved_session_can_still_be_settled(db):
    """The failure that would trap someone in a blocking screen.

    `pending` reports the day a session is SHOWING on, while a skip is stored
    against the plan's original day. If those two disagreed, the skip would never
    take, the session would stay pending, and the app would block for ever with
    no way out. Verified rather than assumed."""
    user_id = await _seed_user(db)
    await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY, "long_run")])])
    await plan_moves_service.move_session(db, user_id, 1, Weekday.MONDAY, Weekday.THURSDAY)

    queue = await plan_reconcile_service.pending(db, user_id)
    assert [r.day for r in queue.sessions] == [Weekday.THURSDAY]  # the shown day

    settled = await plan_reconcile_service.resolve_all_missed(db, user_id)

    assert settled == 1
    assert (await plan_reconcile_service.pending(db, user_id)).has_pending is False


async def test_confirm_all_links_every_suggestion(db):
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY), _s(Weekday.WEDNESDAY)])])
    await _seed_activity(db, user_id, start)
    await _seed_activity(db, user_id, start + timedelta(days=2))

    linked = await plan_reconcile_service.confirm_all_suggested(db, user_id)

    assert linked == 2
    assert (await plan_reconcile_service.pending(db, user_id)).has_pending is False


async def test_confirm_all_leaves_the_unsuggestable_pending(db):
    """Honest rather than tidy: a session with nothing to link to stays a
    question, and the athlete answers it with "pas faite"."""
    user_id = await _seed_user(db)
    start = await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY), _s(Weekday.WEDNESDAY)])])
    await _seed_activity(db, user_id, start)  # Monday only

    linked = await plan_reconcile_service.confirm_all_suggested(db, user_id)

    assert linked == 1
    queue = await plan_reconcile_service.pending(db, user_id)
    assert [r.day for r in queue.sessions] == [Weekday.WEDNESDAY]


async def test_settling_feeds_the_adherence_numbers(db):
    """The whole point: a settled week is one the plan can reason about. Three
    key runs declared missed have to show up as missed."""
    from app.services import plan_progress

    user_id = await _seed_user(db)
    await _seed_plan(
        db,
        user_id,
        [_week(1, [_s(d) for d in (Weekday.MONDAY, Weekday.WEDNESDAY, Weekday.FRIDAY)])],
    )
    await plan_reconcile_service.resolve_all_missed(db, user_id)

    progress = await plan_progress.compute_progress(db, user_id)

    assert progress.recent_key_missed == 3
    assert progress.replan_suggested is True


# --- Endpoints ----------------------------------------------------------------


async def test_reconcile_endpoint_requires_auth(client):
    assert (await client.get("/api/v1/plans/reconcile")).status_code == 401


async def test_reconcile_endpoints_settle_a_week(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    headers = {"Authorization": f"Bearer {register.json()['access_token']}"}
    me = await db.users.find_one({"email": "a@b.com"})
    user_id = str(me["_id"])
    await _seed_plan(db, user_id, [_week(1, [_s(Weekday.MONDAY), _s(Weekday.WEDNESDAY)])])

    listed = await client.get("/api/v1/plans/reconcile", headers=headers)
    assert listed.json()["has_pending"] is True
    assert len(listed.json()["sessions"]) == 2

    settled = await client.post("/api/v1/plans/reconcile/skip-all", headers=headers)
    assert settled.json() == {"skipped": 2}

    after = await client.get("/api/v1/plans/reconcile", headers=headers)
    assert after.json()["has_pending"] is False
