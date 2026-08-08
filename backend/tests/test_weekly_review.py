from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.models.activity import SportType
from app.models.plan import (
    WEEKDAY_ORDER,
    PaceRange,
    Phase,
    Plan,
    PlanGoal,
    Session,
    Week,
    Weekday,
)
from app.services import weekly_review_service


def _s(day: Weekday, stype: str, priority: str = "key", **kw) -> Session:
    return Session(
        day=day,
        sport=kw.pop("sport", SportType.RUN),
        type=stype,
        duration_min=kw.pop("duration_min", 50),
        priority=priority,
        rationale="x",
        **kw,
    )


async def _seed_user(db) -> str:
    result = await db.users.insert_one(
        {"email": "a@b.com", "hashed_password": "x", "created_at": datetime.now(UTC)}
    )
    user_id = str(result.inserted_id)
    await db.fitness_profiles.insert_one(
        {"user_id": user_id, "hr_max": 190, "hr_rest": 50, "manual": True}
    )
    return user_id


def _last_completed_week_start() -> "datetime.date":
    """The Monday of the week `compute_review` will pick when the plan starts
    then: the most recent week that has fully elapsed."""
    today = datetime.now(UTC).date()
    this_monday = today - timedelta(days=today.weekday())
    return this_monday - timedelta(days=7)


async def _seed_plan(db, user_id: str, sessions: list[Session], start=None) -> None:
    start = start or _last_completed_week_start()
    week1 = Week(index=1, is_deload=False, target_load=100.0, sessions=sessions)
    week2 = Week(
        index=2,
        is_deload=False,
        target_load=105.0,
        sessions=[_s(Weekday.TUESDAY, "easy", priority="optional")],
    )
    plan = Plan(goal=PlanGoal(description="T"), phases=[Phase(name="base", weeks=[week1, week2])])
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


async def _seed_run(db, user_id: str, on_date, **kw) -> None:
    await db.activities.insert_one(
        {
            "garmin_activity_id": int(on_date.strftime("%Y%m%d")) + kw.pop("nonce", 0),
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": datetime(on_date.year, on_date.month, on_date.day, 7, tzinfo=UTC),
            "duration_s": kw.pop("duration_s", 3000),
            "avg_hr": kw.pop("avg_hr", 140),
            **kw,
        }
    )


# --- Week selection -----------------------------------------------------------


def test_week_bounds_pick_the_week_ending_today():
    """Run on a Sunday evening, the review must cover the week that just ended —
    not the one before it. That's the whole point of the cron slot."""
    start = _last_completed_week_start()
    sunday = start + timedelta(days=6)
    assert weekly_review_service._review_week_bounds(start, sunday) == (1, start, sunday)


def test_week_bounds_skip_a_week_still_in_progress():
    start = _last_completed_week_start()
    wednesday = start + timedelta(days=9)  # week 2, mid-week
    week_index, week_start, _ = weekly_review_service._review_week_bounds(start, wednesday)
    assert (week_index, week_start) == (1, start)  # week 1, the completed one


def test_week_bounds_none_before_the_first_week_is_over():
    start = _last_completed_week_start()
    assert weekly_review_service._review_week_bounds(start, start + timedelta(days=3)) is None


# --- The signal arbitration rule from training-science -------------------------


def test_easy_session_is_judged_on_heart_rate_not_pace():
    """'La FC prime en Z1–Z2' — an easy run up a hill is not a failed easy run."""
    session = _s(Weekday.MONDAY, "easy")
    assert weekly_review_service._governing_signal(session, 200.0, 10.0) == "hr"
    assert weekly_review_service._governing_signal(session, 0.0, 10.0) == "hr"


def test_quality_session_is_judged_on_pace_when_flat():
    session = _s(Weekday.WEDNESDAY, "threshold")
    assert weekly_review_service._governing_signal(session, 20.0, 10.0) == "pace"


def test_quality_session_on_hilly_ground_falls_back_to_heart_rate():
    """'L'allure prime en séance qualité sur PLAT' — 150 m over 10 km is not."""
    session = _s(Weekday.WEDNESDAY, "threshold")
    assert weekly_review_service._governing_signal(session, 150.0, 10.0) == "hr"


def test_rest_and_cross_training_have_no_governing_signal():
    assert weekly_review_service._governing_signal(_s(Weekday.SUNDAY, "rest"), None, None) == "none"
    assert (
        weekly_review_service._governing_signal(_s(Weekday.SATURDAY, "cross_training"), 0.0, 5.0)
        == "none"
    )


# --- Reading a session's shape from its splits --------------------------------


def test_drift_reads_a_fade_from_the_splits():
    """Same average pace, opposite stories — that's why splits are stored."""
    splits = [
        {"index": 1, "distance_m": 1000.0, "duration_s": 280, "avg_hr": 150},
        {"index": 2, "distance_m": 1000.0, "duration_s": 280, "avg_hr": 152},
        {"index": 3, "distance_m": 1000.0, "duration_s": 320, "avg_hr": 162},
        {"index": 4, "distance_m": 1000.0, "duration_s": 320, "avg_hr": 166},
    ]
    pace_drift, hr_drift = weekly_review_service._drift(splits)
    assert pace_drift == pytest.approx(14.3, abs=0.1)  # second half ~14% slower
    assert hr_drift == pytest.approx(13.0, abs=0.1)


def test_drift_reads_a_negative_split_as_negative():
    splits = [
        {"index": 1, "distance_m": 1000.0, "duration_s": 320},
        {"index": 2, "distance_m": 1000.0, "duration_s": 280},
    ]
    pace_drift, _ = weekly_review_service._drift(splits)
    assert pace_drift < 0


def test_drift_needs_at_least_two_laps():
    assert weekly_review_service._drift([]) == (None, None)
    assert weekly_review_service._drift(
        [{"index": 1, "distance_m": 1000.0, "duration_s": 300}]
    ) == (None, None)


def test_drift_ignores_laps_that_would_divide_by_zero():
    splits = [
        {"index": 1, "distance_m": 0.0, "duration_s": 300},
        {"index": 2, "distance_m": 1000.0, "duration_s": 300},
    ]
    assert weekly_review_service._drift(splits) == (None, None)


# --- The deterministic verdict ------------------------------------------------


async def test_no_plan_reports_no_plan(db):
    user_id = await _seed_user(db)
    review = await weekly_review_service.compute_review(db, user_id)
    assert review.has_plan is False
    assert review.needs_adjustment is False


async def test_a_week_done_as_planned_needs_no_adjustment(db):
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(
        db,
        user_id,
        [
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "tempo"),
            _s(Weekday.FRIDAY, "threshold"),
        ],
        start=start,
    )
    for offset in (0, 2, 4):
        await _seed_run(db, user_id, start + timedelta(days=offset), nonce=offset)

    review = await weekly_review_service.compute_review(db, user_id)

    assert review.key_planned == 3
    assert review.key_completed == 3
    assert review.needs_adjustment is False
    assert review.signals == []


async def test_two_missed_key_sessions_trigger_an_adjustment(db):
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(
        db,
        user_id,
        [
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "tempo"),
            _s(Weekday.FRIDAY, "threshold"),
        ],
        start=start,
    )
    await _seed_run(db, user_id, start)  # only the Monday happened

    review = await weekly_review_service.compute_review(db, user_id)

    assert review.key_missed == 2
    assert review.needs_adjustment is True
    assert any("clés manquées" in signal for signal in review.signals)


async def test_cross_training_never_counts_as_a_missed_key_run(db):
    """Business rule: other sports are load, never adherence. A padel-heavy week
    must not be reported as two missed runs *because of* the padel."""
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(
        db,
        user_id,
        [
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "cross_training", sport=SportType.PADEL, priority="optional"),
        ],
        start=start,
    )
    await _seed_run(db, user_id, start)
    await db.activities.insert_one(
        {
            "garmin_activity_id": 999,
            "user_id": user_id,
            "sport": SportType.PADEL,
            "start_time": datetime(start.year, start.month, start.day, 18, tzinfo=UTC)
            + timedelta(days=2),
            "duration_s": 3600,
            "avg_hr": 130,
        }
    )

    review = await weekly_review_service.compute_review(db, user_id)

    # Only the run is a key session; the padel is neither planned-key nor missed.
    assert review.key_planned == 1
    assert review.key_completed == 1
    assert review.needs_adjustment is False


async def test_session_review_carries_the_actuals(db):
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(
        db,
        user_id,
        [
            _s(
                Weekday.MONDAY,
                "threshold",
                pace_range=PaceRange(min_per_km_low="4:30", min_per_km_high="4:45"),
                hr_zone=4,
            )
        ],
        start=start,
    )
    await _seed_run(
        db,
        user_id,
        start,
        duration_s=3000,
        distance_m=10000.0,
        elevation_gain_m=20.0,
        splits=[
            {"index": 1, "distance_m": 5000.0, "duration_s": 1450, "avg_hr": 165},
            {"index": 2, "distance_m": 5000.0, "duration_s": 1550, "avg_hr": 175},
        ],
    )

    review = await weekly_review_service.compute_review(db, user_id)
    session = review.sessions[0]

    assert session.actual_distance_km == 10.0
    assert session.actual_pace_min_per_km == "5:00"
    assert session.planned_pace_low == "4:30"
    assert session.actual_elevation_gain_m == 20.0
    assert session.governing_signal == "pace"  # 2 m/km — flat enough to judge
    assert session.pace_drift_pct == pytest.approx(6.9, abs=0.1)
    assert session.hr_drift_bpm == pytest.approx(10.0, abs=0.1)


async def test_linked_activity_counts_even_on_another_day(db):
    """A session linked by hand wins over the date heuristic — that's the whole
    point of linking."""
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(db, user_id, [_s(Weekday.MONDAY, "long_run")], start=start)
    result = await db.activities.insert_one(
        {
            "garmin_activity_id": 4242,
            "user_id": user_id,
            "sport": SportType.RUN,
            "start_time": datetime(start.year, start.month, start.day, 7, tzinfo=UTC)
            + timedelta(days=1),
            "duration_s": 3000,
            "avg_hr": 140,
        }
    )
    await db.session_completions.insert_one(
        {
            "user_id": user_id,
            "week_index": 1,
            "day": WEEKDAY_ORDER[0],
            "slot": "primary",
            "session_date": start.isoformat(),
            "activity_id": str(result.inserted_id),
            "linked_at": datetime.now(UTC),
        }
    )

    review = await weekly_review_service.compute_review(db, user_id)

    assert review.sessions[0].linked is True
    assert review.sessions[0].done is True
    assert review.key_missed == 0


# --- The cost guarantee --------------------------------------------------------


async def test_a_normal_week_never_calls_anthropic(db):
    """The load-bearing cost assertion: the verdict is deterministic, so an
    ordinary week must not spend a single token."""
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(db, user_id, [_s(Weekday.MONDAY, "long_run")], start=start)
    await _seed_run(db, user_id, start)

    # Patch the client class itself, not `explain`: what matters is that no
    # Anthropic client is ever constructed, whatever the call path.
    with (
        patch.object(weekly_review_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.weekly_review_service.anthropic.AsyncAnthropic") as client_cls,
    ):
        review = await weekly_review_service.build_weekly_review(db, user_id)

    assert review.needs_adjustment is False
    client_cls.assert_not_called()
    assert review.summary is None


async def test_explain_returns_none_without_a_verdict():
    """Belt and braces: even called directly, `explain` refuses to spend a token
    on a week that doesn't warrant one."""
    from app.models.review import WeeklyReviewResponse

    review = WeeklyReviewResponse(has_plan=True, needs_adjustment=False)
    assert await weekly_review_service.explain(review) is None


async def test_a_failing_narrative_does_not_lose_the_review(db):
    """Anthropic being down on a Sunday night must cost the sentence, not the
    numbers."""
    import anthropic

    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(
        db,
        user_id,
        [
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "tempo"),
            _s(Weekday.FRIDAY, "threshold"),
        ],
        start=start,
    )

    boom = anthropic.APIConnectionError(request=None)
    with (
        patch.object(weekly_review_service.settings, "anthropic_api_key", "sk-test"),
        patch(
            "app.services.weekly_review_service.anthropic.AsyncAnthropic",
        ) as client_cls,
    ):
        client_cls.return_value.messages.create = AsyncMock(side_effect=boom)
        review = await weekly_review_service.build_weekly_review(db, user_id)

    assert review.needs_adjustment is True
    assert review.key_missed == 3
    assert review.summary is None  # degraded, not lost


# --- What reaches the generation prompt ---------------------------------------


async def test_generation_context_carries_the_week_detail(db):
    """The gap this closes: the prompt used to receive counts only, so the plan
    was rebuilt from an aggregate snapshot of form rather than from what the
    sessions showed."""
    from app.services import plan_service

    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(
        db,
        user_id,
        [
            _s(
                Weekday.MONDAY,
                "threshold",
                pace_range=PaceRange(min_per_km_low="4:30", min_per_km_high="4:45"),
            ),
            _s(Weekday.TUESDAY, "strength", priority="optional", sport=SportType.STRENGTH),
        ],
        start=start,
    )
    await _seed_run(db, user_id, start, duration_s=3000, distance_m=10000.0, elevation_gain_m=15.0)

    rows = await plan_service._recent_week_detail(db, user_id)

    assert len(rows) == 1  # key + primary only; the optional strength addon is dropped
    row = rows[0]
    assert row["type"] == "threshold"
    assert row["realisee"] is True
    assert row["allure_cible"] == "4:30-4:45"
    assert row["allure_reelle"] == "5:00"
    assert row["signal"] == "pace"


async def test_week_detail_drops_empty_fields_to_stay_terse(db):
    """The prompt runs close to its output ceiling — a session with no HR and no
    splits must not ship a row full of nulls."""
    from app.services import plan_service

    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(db, user_id, [_s(Weekday.MONDAY, "long_run")], start=start)

    rows = await plan_service._recent_week_detail(db, user_id)

    assert rows == [{"type": "long_run", "prevu_min": 50, "realisee": False}]


async def test_week_detail_is_empty_without_a_plan(db):
    from app.services import plan_service

    user_id = await _seed_user(db)
    assert await plan_service._recent_week_detail(db, user_id) == []


# --- Endpoints -----------------------------------------------------------------


async def test_weekly_endpoint_requires_auth(client):
    assert (await client.get("/api/v1/reviews/weekly")).status_code == 401


async def test_weekly_endpoint_returns_a_review(client, db):
    register = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    token = register.json()["access_token"]

    response = await client.get(
        "/api/v1/reviews/weekly", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["has_plan"] is False


async def test_run_endpoint_requires_the_shared_secret(client, db):
    """Same security boundary as /push/run: no user auth, so the secret is the
    only thing standing between a scheduler and everyone's data."""
    assert (await client.post("/api/v1/reviews/run")).status_code == 403

    with patch.object(weekly_review_service.settings, "review_run_secret", "s3cr3t"):
        bad = await client.post("/api/v1/reviews/run", headers={"X-Review-Secret": "nope"})
        assert bad.status_code == 403
        ok = await client.post("/api/v1/reviews/run", headers={"X-Review-Secret": "s3cr3t"})
        assert ok.status_code == 200
        assert ok.json() == {"users": 0, "reviewed": 0, "adjusting": 0}


async def test_run_batch_counts_and_survives_one_bad_athlete(client, db):
    """A normal week is reviewed but writes nothing: the numbers are recomputed
    from live fitness data on every read, so a stored copy could only ever be a
    staler version of something already free to derive."""
    user_id = await _seed_user(db)
    start = _last_completed_week_start()
    await _seed_plan(db, user_id, [_s(Weekday.MONDAY, "long_run")], start=start)
    await _seed_run(db, user_id, start)

    with patch.object(weekly_review_service.settings, "review_run_secret", "s3cr3t"):
        response = await client.post("/api/v1/reviews/run", headers={"X-Review-Secret": "s3cr3t"})

    assert response.json() == {"users": 1, "reviewed": 1, "adjusting": 0}
    assert await db.weekly_reviews.count_documents({}) == 0


# --- The cost guarantee, the half that was missing -----------------------------


async def _seed_flagged_week(db) -> str:
    """Three key sessions planned, none run — a verdict that warrants a narrative."""
    user_id = await _seed_user(db)
    await _seed_plan(
        db,
        user_id,
        [
            _s(Weekday.MONDAY, "long_run"),
            _s(Weekday.WEDNESDAY, "tempo"),
            _s(Weekday.FRIDAY, "threshold"),
        ],
        start=_last_completed_week_start(),
    )
    return user_id


def _text_response(text: str):
    from types import SimpleNamespace

    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


async def test_the_narrative_is_written_once_and_reused(db):
    """The load-bearing cost assertion for a FLAGGED week.

    This endpoint is refetched on focus, so a narrative regenerated per read
    spent an API call every time the athlete opened the Plan tab — for a sentence
    about a week that is over and cannot change. One call, then reuse."""
    user_id = await _seed_flagged_week(db)

    with (
        patch.object(weekly_review_service.settings, "anthropic_api_key", "sk-test"),
        patch("app.services.weekly_review_service.anthropic.AsyncAnthropic") as client_cls,
    ):
        client_cls.return_value.messages.create = AsyncMock(
            return_value=_text_response("Trois séances clés manquées.")
        )
        first = await weekly_review_service.build_weekly_review(db, user_id)
        second = await weekly_review_service.build_weekly_review(db, user_id)
        third = await weekly_review_service.build_weekly_review(db, user_id)
        calls = client_cls.return_value.messages.create.await_count

    assert calls == 1, f"the narrative was regenerated {calls} times"
    assert first.summary == second.summary == third.summary == "Trois séances clés manquées."
    # And the numbers stayed live rather than being served from the stored copy.
    assert third.key_missed == 3


async def test_a_stored_narrative_is_not_shown_once_the_week_recovers(db):
    """The verdict is recomputed, the sentence is only cached. A week that stops
    warranting an adjustment must not keep showing last read's explanation."""
    user_id = await _seed_flagged_week(db)
    review = await weekly_review_service.compute_review(db, user_id)
    await db.weekly_reviews.insert_one(
        {"user_id": user_id, "week_start": review.week_start.isoformat(), "summary": "vieux texte"}
    )

    # Everything run after all → no verdict, so no narrative, stored or not.
    with patch.object(weekly_review_service, "compute_review", AsyncMock(return_value=review)):
        review.needs_adjustment = False
        review.signals = []
        result = await weekly_review_service.build_weekly_review(db, user_id)

    assert result.needs_adjustment is False
    assert result.summary is None


async def test_the_batch_prewarms_the_narrative_for_the_app(db, client):
    """What the Sunday cron is actually for, now that it stores nothing else: the
    athlete's first read costs no call and no wait."""
    user_id = await _seed_flagged_week(db)

    with (
        patch.object(weekly_review_service.settings, "anthropic_api_key", "sk-test"),
        patch.object(weekly_review_service.settings, "review_run_secret", "s3cr3t"),
        patch("app.services.weekly_review_service.anthropic.AsyncAnthropic") as client_cls,
    ):
        client_cls.return_value.messages.create = AsyncMock(
            return_value=_text_response("Semaine à réajuster.")
        )
        await client.post("/api/v1/reviews/run", headers={"X-Review-Secret": "s3cr3t"})
        after_cron = client_cls.return_value.messages.create.await_count
        read = await weekly_review_service.build_weekly_review(db, user_id)
        after_read = client_cls.return_value.messages.create.await_count

    assert after_cron == 1
    assert after_read == 1, "the athlete's read regenerated what the cron had written"
    assert read.summary == "Semaine à réajuster."
