"""End-of-week review — what the week actually looked like, and whether the plan
should move because of it.

Two layers, deliberately separated:

1. **The verdict is deterministic and free.** `compute_review` decides
   `needs_adjustment` from the documented triggers only — ≥2 key sessions missed
   and chronic fatigue (both already constants in `plan_progress`), plus the
   10 %/week CTL ramp ceiling from the business rules. No model call is involved,
   so a normal week costs nothing at all.
2. **The narrative is AI and optional.** `explain` is called *only* when the
   verdict is already positive, and only to say why and what to do about it.

That split is the whole cost story: an athlete having an ordinary week never
triggers an API call, and the review still runs every Sunday.

Nothing here regenerates a plan. Like `replan_suggested`, it produces a
suggestion the athlete accepts or ignores.
"""

import json
import logging
from datetime import UTC, date, datetime, timedelta

import anthropic
from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.models.plan import WEEKDAY_ORDER, Plan, Session
from app.models.review import SessionReview, WeeklyReviewResponse
from app.services import fitness_service, plan_moves_service
from app.services.plan_progress import (
    _CHRONIC_FATIGUE_TSB,
    _MISSED_KEY_TRIGGER,
    _is_key_run,
    _load_linked_dates,
    _load_run_days,
    _make_run_done,
    _plan_start_date,
)

logger = logging.getLogger(__name__)

# Session types that live in Z1–Z2. The skill is explicit that HR governs these
# and pace does not: an easy run up a hill is not a failed easy run.
_EASY_TYPES = frozenset({"easy", "long_run", "recovery"})
# Session types where hitting a pace is the point.
_QUALITY_TYPES = frozenset({"tempo", "threshold", "intervals", "test", "race"})

# Above this much climbing per kilometre, pace stops being comparable and HR
# takes over even on a quality session (training-science: "la FC prime … sur
# route vallonnée"). NOTE: this is a descriptive cut-off for "can we trust the
# pace here", not a physiological constant — it is the one number in this module
# the skill does not pin down.
_HILLY_M_PER_KM = 10.0

# CLAUDE.md business rule + training-science: CTL must not grow more than ~10 %
# week over week. Exceeded, the week was too big regardless of how it felt.
_MAX_CTL_RAMP_PCT = 10.0


def _fmt_pace(seconds_per_km: float) -> str:
    minutes, seconds = divmod(round(seconds_per_km), 60)
    return f"{minutes}:{seconds:02d}"


def _review_week_bounds(start: date, today: date) -> tuple[int, date, date] | None:
    """The most recent plan week that has fully elapsed — including one ending
    today, so a Sunday-evening run reviews the week the athlete just finished
    rather than the one before it.

    Returns (week_index, week_start, week_end) or None when no week is done yet.
    """
    if today < start:
        return None
    week_pos = (today - start).days // 7
    if start + timedelta(days=week_pos * 7 + 6) > today:
        week_pos -= 1  # this week isn't over; review the previous one
    if week_pos < 0:
        return None
    week_start = start + timedelta(days=week_pos * 7)
    return week_pos + 1, week_start, week_start + timedelta(days=6)


def _drift(splits: list[dict]) -> tuple[float | None, float | None]:
    """Second half vs first half of a session, from the per-lap splits.

    Returns (pace drift %, HR drift bpm). Positive pace drift = slowed down.
    Needs at least two laps; anything shorter has no shape to read."""
    usable = [s for s in splits if s.get("distance_m") and s.get("duration_s")]
    if len(usable) < 2:
        return None, None
    midpoint = len(usable) // 2
    halves = (usable[:midpoint], usable[midpoint:])

    paces: list[float] = []
    for half in halves:
        distance = sum(s["distance_m"] for s in half)
        duration = sum(s["duration_s"] for s in half)
        if distance <= 0:
            return None, None
        paces.append(duration / (distance / 1000))
    pace_drift = (paces[1] - paces[0]) / paces[0] * 100 if paces[0] > 0 else None

    hr_drift: float | None = None
    hr_halves = [[s["avg_hr"] for s in half if s.get("avg_hr")] for half in halves]
    if all(hr_halves):
        hr_drift = sum(hr_halves[1]) / len(hr_halves[1]) - sum(hr_halves[0]) / len(hr_halves[0])

    return (
        round(pace_drift, 1) if pace_drift is not None else None,
        round(hr_drift, 1) if hr_drift is not None else None,
    )


def _governing_signal(session: Session, elevation_gain_m: float | None, distance_km: float | None):
    """Which of pace or HR is allowed to judge this session.

    training-science, "Allures cibles": on a conflict over hilly ground, HR wins
    in Z1–Z2 and pace wins on a flat quality session. So: easy work is always
    judged on HR; quality work is judged on pace only when the ground was flat
    enough for pace to mean anything."""
    if session.type in _EASY_TYPES:
        return "hr"
    if session.type not in _QUALITY_TYPES:
        return "none"
    if elevation_gain_m is None or not distance_km:
        return "pace"
    return "hr" if elevation_gain_m / distance_km > _HILLY_M_PER_KM else "pace"


async def _activity_for(
    db: AsyncIOMotorDatabase,
    user_id: str,
    week_index: int,
    session: Session,
    session_date: date,
) -> tuple[dict | None, bool]:
    """The activity that stands for this session, and whether it was linked by
    hand. An explicit link wins over the date heuristic — that is the whole
    point of linking, and it lets an activity count on a different day."""
    completion = await db.session_completions.find_one(
        {
            "user_id": user_id,
            "week_index": week_index,
            "day": session.day,
            "slot": {"$in": [session.slot, None]} if session.slot == "primary" else session.slot,
        }
    )
    if completion and completion.get("activity_id"):
        try:
            oid = ObjectId(completion["activity_id"])
        except (InvalidId, TypeError):
            oid = None
        if oid is not None:
            doc = await db.activities.find_one({"_id": oid, "user_id": user_id})
            if doc is not None:
                return doc, True

    day_start = datetime(session_date.year, session_date.month, session_date.day, tzinfo=UTC)
    doc = await db.activities.find_one(
        {
            "user_id": user_id,
            "sport": session.sport.value,
            "start_time": {"$gte": day_start, "$lt": day_start + timedelta(days=1)},
        },
        sort=[("duration_s", -1)],
    )
    return doc, False


def _to_session_review(session: Session, doc: dict | None, linked: bool, done: bool):
    review = SessionReview(
        day=session.day,
        slot=session.slot,
        type=session.type,
        sport=session.sport,
        priority=session.priority,
        planned_duration_min=session.duration_min,
        planned_pace_low=session.pace_range.min_per_km_low if session.pace_range else None,
        planned_pace_high=session.pace_range.min_per_km_high if session.pace_range else None,
        planned_hr_zone=session.hr_zone,
        skipped=session.skipped,
        done=done,
        linked=linked,
    )
    if doc is None:
        return review

    duration_s = doc.get("duration_s") or 0
    distance_m = doc.get("distance_m")
    review.actual_duration_min = duration_s // 60
    review.actual_avg_hr = doc.get("avg_hr")
    review.actual_elevation_gain_m = doc.get("elevation_gain_m")
    distance_km = None
    if distance_m:
        distance_km = distance_m / 1000
        review.actual_distance_km = round(distance_km, 2)
        if duration_s > 0:
            review.actual_pace_min_per_km = _fmt_pace(duration_s / distance_km)

    splits = doc.get("splits")
    if isinstance(splits, list) and splits:
        review.pace_drift_pct, review.hr_drift_bpm = _drift(splits)

    review.governing_signal = _governing_signal(
        session, review.actual_elevation_gain_m, distance_km
    )
    return review


async def compute_review(db: AsyncIOMotorDatabase, user_id: str) -> WeeklyReviewResponse:
    """The deterministic half. No model call, ever — this runs every week for
    every athlete, so it has to be free."""
    today = datetime.now(UTC).date()
    fitness = await fitness_service.compute_fitness(db, user_id)

    doc = await db.plans.find_one({"user_id": user_id, "status": "ready"}, sort=[("version", -1)])
    if doc is None or not doc.get("plan"):
        return WeeklyReviewResponse(
            has_plan=False, ctl=fitness.ctl, atl=fitness.atl, tsb=fitness.tsb
        )

    start = _plan_start_date(doc, today)
    bounds = _review_week_bounds(start, today)
    if bounds is None:
        return WeeklyReviewResponse(
            has_plan=False, ctl=fitness.ctl, atl=fitness.atl, tsb=fitness.tsb
        )
    week_index, week_start, week_end = bounds

    plan = Plan.model_validate(doc["plan"])
    await plan_moves_service.apply_overrides(db, user_id, plan, doc["version"])
    week = next(
        (w for phase in plan.phases for w in phase.weeks if w.index == week_index),
        None,
    )
    if week is None:
        return WeeklyReviewResponse(
            has_plan=False, ctl=fitness.ctl, atl=fitness.atl, tsb=fitness.tsb
        )

    # Same "was this run actually done?" rule as the adherence read-out — two
    # copies of it would drift, and the day they disagree the athlete is told
    # two different things about the same session.
    run_minutes = await _load_run_days(db, user_id, week_start)
    linked_dates = await _load_linked_dates(db, user_id)
    run_done = _make_run_done(run_minutes, linked_dates)

    sessions: list[SessionReview] = []
    key_planned = key_completed = 0
    for session in week.sessions:
        session_date = week_start + timedelta(days=WEEKDAY_ORDER.index(session.day))
        activity, linked = await _activity_for(db, user_id, week_index, session, session_date)

        if _is_key_run(session):
            key_planned += 1
            done = not session.skipped and run_done(session_date, session.duration_min)
            if done:
                key_completed += 1
        else:
            done = activity is not None

        sessions.append(_to_session_review(session, activity, linked, done))

    load_actual = sum(point.load for point in fitness.series if week_start <= point.day <= week_end)
    ramp = _ctl_ramp_pct(fitness, week_start, week_end)

    key_missed = key_planned - key_completed
    signals: list[str] = []
    if key_missed >= _MISSED_KEY_TRIGGER:
        signals.append(f"{key_missed} séances clés manquées cette semaine.")
    if fitness.tsb < _CHRONIC_FATIGUE_TSB:
        signals.append(f"Fatigue élevée (TSB {fitness.tsb:+.0f}).")
    if ramp is not None and ramp > _MAX_CTL_RAMP_PCT:
        signals.append(f"Charge en hausse de {ramp:.0f} % — au-delà des 10 % hebdomadaires.")

    return WeeklyReviewResponse(
        has_plan=True,
        week_index=week_index,
        week_start=week_start,
        week_end=week_end,
        sessions=sessions,
        key_planned=key_planned,
        key_completed=key_completed,
        key_missed=key_missed,
        load_actual=round(load_actual, 1),
        ctl=fitness.ctl,
        atl=fitness.atl,
        tsb=fitness.tsb,
        ctl_ramp_pct=ramp,
        needs_adjustment=bool(signals),
        signals=signals,
    )


def _ctl_ramp_pct(fitness, week_start: date, week_end: date) -> float | None:
    """CTL growth across the reviewed week, in percent. None when the series
    doesn't cover both ends — a ramp computed off a missing endpoint would be
    an invented number."""
    by_day = {point.day: point.ctl for point in fitness.series}
    before = by_day.get(week_start - timedelta(days=1))
    after = by_day.get(week_end)
    if before is None or after is None or before <= 0:
        return None
    return round((after - before) / before * 100, 1)


# --- The narrative half: one short call, only when the verdict already fired ---

_MAX_SUMMARY_TOKENS = 700
_SUMMARY_TIMEOUT_S = 60.0

_SUMMARY_SYSTEM = (
    "Tu es le coach de cet athlète. On te donne le bilan chiffré de sa semaine "
    "écoulée : ce qui était prévu, ce qui a été fait, et les signaux qui ont "
    "déclenché une alerte.\n\n"
    "Écris un bilan court en français, 4 phrases maximum, à la deuxième personne. "
    "Dis ce qui s'est passé, pourquoi c'est un problème, et ce que tu recommandes "
    "d'ajuster. Sois concret et appuie-toi sur les chiffres fournis.\n\n"
    "Règles de lecture, à respecter strictement :\n"
    "- `governing_signal` dit quel signal est fiable pour chaque séance. À 'hr', "
    "juge sur la fréquence cardiaque et IGNORE l'allure : une séance en côte n'est "
    "pas une séance ratée. À 'pace', juge sur l'allure.\n"
    "- Les séances d'autres sports (padel, basket, renfo) comptent dans la charge "
    "mais jamais dans l'adhérence course. Ne reproche jamais une séance clé "
    "manquée à cause d'un autre sport.\n"
    "- Ne donne aucun conseil médical. Si les signaux évoquent un surentraînement "
    "sévère, recommande du repos et de consulter un professionnel, rien de plus.\n"
    "- Tu proposes, tu ne décides pas : l'athlète accepte ou ignore."
)


async def explain(review: WeeklyReviewResponse) -> str | None:
    """Turn a positive verdict into a sentence the athlete can act on.

    Called ONLY when `needs_adjustment` is already true — a normal week must not
    cost an API call. Returns None rather than raising: the numbers are the
    product, the narrative is a bonus, and a rate limit on Sunday night is not a
    reason to lose the whole review."""
    if not review.needs_adjustment:
        return None
    if not settings.anthropic_api_key:
        logger.info("Weekly review: no Anthropic key configured, skipping the narrative.")
        return None

    payload = review.model_dump(mode="json", exclude={"summary"})
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        timeout=_SUMMARY_TIMEOUT_S,
        max_retries=0,
    )
    try:
        response = await client.messages.create(
            model=settings.plan_model,
            max_tokens=_MAX_SUMMARY_TOKENS,
            system=_SUMMARY_SYSTEM,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except anthropic.APIError as exc:
        # Every failure mode is the same here: no narrative, review still stands.
        logger.warning("Weekly review narrative unavailable: %s", exc)
        return None

    text = "".join(
        block.text for block in response.content if getattr(block, "type", None) == "text"
    ).strip()
    return text or None


async def build_weekly_review(db: AsyncIOMotorDatabase, user_id: str) -> WeeklyReviewResponse:
    """The full review: deterministic verdict, plus the narrative when — and only
    when — the verdict warrants one.

    The narrative is written ONCE per athlete per week and reused afterwards.
    Without that, every read regenerated it: the app refetches this on focus, so
    a flagged week spent an API call each time the athlete opened the Plan tab —
    tens of calls for a sentence that describes a week which is already over and
    cannot change. The cost promise of this feature is one short call per flagged
    week, and this is what actually keeps it.

    Only the sentence is cached. The numbers are recomputed on every call, so the
    TSB and adherence on screen stay live.
    """
    review = await compute_review(db, user_id)
    if not review.needs_adjustment:
        return review

    key = {"user_id": user_id, "week_start": review.week_start.isoformat()}
    stored = await db.weekly_reviews.find_one(key)
    if stored and stored.get("summary"):
        review.summary = stored["summary"]
        return review

    review.summary = await explain(review)
    if review.summary:
        # `$set` on the summary alone, never the whole review: a mid-week write of
        # the full snapshot would leave stale numbers sitting in the collection
        # looking authoritative. The unique (user_id, week_start) index makes this
        # a real upsert.
        await db.weekly_reviews.update_one(
            key,
            {"$set": {**key, "summary": review.summary, "summary_at": datetime.now(UTC)}},
            upsert=True,
        )
    return review


async def run_due_reviews(db: AsyncIOMotorDatabase) -> dict:
    """Build every athlete's weekly review, for the Sunday-evening scheduler.

    It writes nothing itself: `build_weekly_review` already persists the one
    thing worth keeping — the narrative, once per athlete per week. The batch's
    job is to get that written before the athlete opens the app, so their first
    read on Sunday evening is instant and no API call happens while they wait.

    The numbers are deliberately NOT stored. They are recomputed on every read
    from live fitness data, so a stored copy could only ever be a staler version
    of something already free to derive — and it would be a second copy of health
    data to protect for no gain.

    Returns counts only: no health data leaves this function, and none is logged.
    """
    user_ids: list[str] = await db.plans.distinct("user_id", {"status": "ready"})
    reviewed = 0
    adjusting = 0
    for user_id in user_ids:
        try:
            review = await build_weekly_review(db, user_id)
        except Exception:  # noqa: BLE001 — one athlete's bad week must not stop the batch
            logger.exception("Weekly review failed for one athlete")
            continue
        if not review.has_plan:
            continue
        reviewed += 1
        if review.needs_adjustment:
            adjusting += 1
    return {"users": len(user_ids), "reviewed": reviewed, "adjusting": adjusting}
