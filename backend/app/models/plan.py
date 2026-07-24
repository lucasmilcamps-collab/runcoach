"""Training-plan schema — the contract the AI must fill and the code validates.

`PlanRequest` is the athlete-provided intent (captured in-app, editable, never
hardcoded). `Plan` and its children are the structured output the model must
produce; `plan_validation.validate_plan` is the gate every generated plan passes
before persistence (plan-generator skill: the AI proposes, the code guarantees).
"""

import datetime
from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.activity import SportType


class Weekday(StrEnum):
    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"
    SATURDAY = "SATURDAY"
    SUNDAY = "SUNDAY"


WEEKDAY_ORDER: tuple[Weekday, ...] = (
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
    Weekday.SUNDAY,
)

# Run sessions that carry real intensity — capped and never back-to-back.
QUALITY_SESSION_TYPES: frozenset[str] = frozenset({"tempo", "threshold", "intervals"})
# Cross-training sports with impact/soreness that shouldn't precede a hard run.
IMPACT_SPORTS: frozenset[SportType] = frozenset({SportType.PADEL, SportType.BASKETBALL})


class FixedSport(BaseModel):
    """A recurring commitment the plan must honour (e.g. padel every Wednesday).
    A hard constraint: it appears on its day and blocks a hard run the next day."""

    sport: SportType
    day: Weekday


class PlanRequest(BaseModel):
    """Athlete intent. Stored per user, editable; changing it regenerates."""

    goal_type: Literal["race", "distance", "fitness"]
    distance_km: float | None = None  # required for race/distance, None for fitness
    race_date: date | None = None
    target_time_min: int | None = None  # optional — "finishing" is a valid goal
    available_days: list[Weekday]
    max_run_sessions_per_week: int
    fixed_sports: list[FixedSport] = Field(default_factory=list)


class Block(BaseModel):
    """One segment of a session (warm-up, 6×800m, cool-down)."""

    label: str
    duration_min: int


class PaceRange(BaseModel):
    min_per_km_low: str  # "5:10"
    min_per_km_high: str  # "5:30"


class Session(BaseModel):
    day: Weekday
    sport: SportType
    type: Literal[
        "easy",
        "long_run",
        "tempo",
        "threshold",
        "intervals",
        "recovery",
        "cross_training",
        "rest",
    ]
    duration_min: int
    structure: list[Block] = Field(default_factory=list)
    pace_range: PaceRange | None = None
    hr_zone: int | None = None
    rationale: str  # one sentence — feeds UI transparency

    @field_validator("sport", mode="before")
    @classmethod
    def _coerce_sport(cls, value: object) -> object:
        """The model often emits sports outside our enum (swimming, yoga, "rest")
        for cross-training/rest days. Everything unrecognised is OTHER — the UI
        labels sessions by `type`, not `sport`, so nothing is lost, and
        generation never fails on an unexpected sport."""
        if isinstance(value, str):
            try:
                return SportType(value.upper())
            except ValueError:
                return SportType.OTHER
        return value


class Week(BaseModel):
    index: int  # 1-based
    is_deload: bool
    target_load: float  # weekly TRIMP target
    sessions: list[Session]


class Phase(BaseModel):
    name: Literal["base", "build", "peak", "taper"]
    weeks: list[Week]


class PlanGoal(BaseModel):
    description: str
    distance_km: float | None = None
    race_date: date | None = None


class Plan(BaseModel):
    goal: PlanGoal
    phases: list[Phase]


class PlanResponse(BaseModel):
    """Public shape for a stored plan (api-conventions: never leaks user_id)."""

    id: str
    status: Literal["generating", "ready", "failed"]
    request: PlanRequest | None = None
    plan: Plan | None = None
    error_message: str | None = None


class DailyAdjustment(BaseModel):
    adjusted: bool  # true if the planned session was downgraded
    original_type: str
    suggested_type: str
    reason: str  # plain-language explanation, always shown


class RecoverySummary(BaseModel):
    """Overnight recovery readings behind today's adjustment, for UI transparency.
    Every field is optional — Garmin may not have provided it yet."""

    hrv: float | None = None
    hrv_baseline: float | None = None
    resting_hr: float | None = None
    resting_hr_baseline: float | None = None
    sleep_hours: float | None = None
    body_battery: int | None = None
    # `datetime.date` (not bare `date`): the field name `date` shadows the type
    # within the class body once its default binds.
    date: datetime.date | None = None  # the day these readings are from

    @property
    def has_any(self) -> bool:
        return any(
            v is not None
            for v in (self.hrv, self.resting_hr, self.sleep_hours, self.body_battery)
        )


class TodaySession(BaseModel):
    """The plan's session for today, adjusted for current form."""

    date: date
    has_plan: bool
    has_session: bool  # false on rest days / off-plan days
    week_index: int | None = None
    session: Session | None = None
    adjustment: DailyAdjustment | None = None
    tsb: float
    recovery: RecoverySummary | None = None
    message: str | None = None  # e.g. "Plan terminé", "Aucun plan actif"


class PlanProgress(BaseModel):
    """Adherence over the recent window, and whether a replan is warranted."""

    has_plan: bool
    week_current: int | None = None
    weeks_total: int | None = None
    recent_key_planned: int = 0
    recent_key_completed: int = 0
    recent_key_missed: int = 0
    tsb: float = 0.0
    replan_suggested: bool = False
    replan_reason: str | None = None
