"""Public shapes for the end-of-week review (GET /api/v1/reviews/weekly).

Separate from the Mongo documents, per the project's Pydantic v2 convention.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.models.activity import SportType

# Which signal is allowed to judge a session, per the training-science skill:
# "si conflit allure/FC sur route vallonnée → la FC prime en Z1–Z2, l'allure
# prime en séance qualité sur plat".
GoverningSignal = Literal["hr", "pace", "none"]


class SessionReview(BaseModel):
    """One planned session of the week, next to what was actually recorded.

    Every `actual_*` field is None when nothing was found — a missed session and
    a session done without a HR strap must stay distinguishable."""

    day: str
    slot: Literal["primary", "addon"]
    type: str
    sport: SportType
    priority: Literal["key", "optional"]
    planned_duration_min: int
    planned_pace_low: str | None = None  # "5:10" — the target range's fast end
    planned_pace_high: str | None = None
    planned_hr_zone: int | None = None
    skipped: bool = False

    done: bool
    linked: bool = False  # the athlete attached this activity by hand
    actual_duration_min: int | None = None
    actual_distance_km: float | None = None
    actual_pace_min_per_km: str | None = None
    actual_avg_hr: int | None = None
    actual_elevation_gain_m: float | None = None

    # Read from the per-lap splits: how the session held together. Positive pace
    # drift = the second half was slower; positive HR drift = it cost more.
    pace_drift_pct: float | None = None
    hr_drift_bpm: float | None = None

    # Which of pace or HR is trustworthy here. A hilly quality session is judged
    # on HR, not on the pace it "failed" to hold.
    governing_signal: GoverningSignal = "none"


class WeeklyReviewResponse(BaseModel):
    """The week that just ended, and whether it warrants touching the plan.

    `needs_adjustment` is decided by deterministic rules only — no AI, no cost.
    `summary` is the one AI-written part, and it is filled *only* when an
    adjustment is warranted. It explains and recommends; it never acts. Acting
    stays the athlete's call, exactly as for `replan_suggested`."""

    has_plan: bool
    week_index: int | None = None
    week_start: date | None = None
    week_end: date | None = None

    sessions: list[SessionReview] = []

    key_planned: int = 0
    key_completed: int = 0
    key_missed: int = 0

    # All sports — cross-training is load, per the business rules.
    load_actual: float = 0.0
    ctl: float = 0.0
    atl: float = 0.0
    tsb: float = 0.0
    ctl_ramp_pct: float | None = None  # week-over-week CTL growth; the 10% rule

    needs_adjustment: bool = False
    signals: list[str] = []  # the deterministic triggers that fired, in French
    summary: str | None = None  # AI narrative — present only when adjusting
