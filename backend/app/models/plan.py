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

from app.models.activity import ActivityResponse, SportType


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
    A hard constraint: it appears on its day and blocks a hard run the next day.

    Declare the same sport on several days for a multi-day commitment. When
    `flexible` is true the sport only needs to land on ONE of its declared days
    (e.g. a weekend match whose day varies), not on every one."""

    sport: SportType
    day: Weekday
    flexible: bool = False


class StrengthPref(BaseModel):
    """Strength-training preference. The plan prescribes a slot + intention only
    (RPE, focus), never exercises — the athlete runs those from Freeletics."""

    enabled: bool = False
    sessions_per_week: int = Field(default=1, ge=1, le=2)
    duration_min: int = Field(default=20, ge=10, le=45)


class PlanRequest(BaseModel):
    """Athlete intent. Stored per user, editable; changing it regenerates."""

    goal_type: Literal["race", "distance", "fitness"]
    distance_km: float | None = None  # required for race/distance, None for fitness
    race_date: date | None = None
    target_time_min: int | None = None  # optional — "finishing" is a valid goal
    available_days: list[Weekday]
    # The athlete commits to `min` key run sessions per week and can do up to `max`.
    min_run_sessions_per_week: int = 3
    max_run_sessions_per_week: int = 3
    fixed_sports: list[FixedSport] = Field(default_factory=list)
    # Whether the plan PRESCRIBES cross-training sessions. This only steers the
    # prompt — it NEVER touches load/fitness: the athlete's real other sports
    # (padel, basket…) always count toward CTL/ATL via fitness_service.
    include_cross_training: bool = False
    strength: StrengthPref = Field(default_factory=StrengthPref)


class InjuryReport(BaseModel):
    """A user-declared injury/soreness — a structural replan trigger (plan-
    generator skill). Drives a comeback: an eased-off period then a gradual ramp.
    Never a medical assessment; the plan only adapts training load."""

    area: str = Field(min_length=1, max_length=120)  # free text: "mollet droit"
    severity: Literal["gene", "douleur", "arret"]  # gêne légère / douleur / arrêt
    days_off: int = Field(ge=0, le=365)  # days the athlete can't run


class PaceRange(BaseModel):
    min_per_km_low: str  # "5:10"
    min_per_km_high: str  # "5:30"


class Block(BaseModel):
    """One segment of a session (warm-up, 6×800m, cool-down). Per-block target
    zone/pace are optional: the model fills them for run segments, leaves them
    null for cross-training or when only a session-level target makes sense."""

    label: str
    duration_min: int
    hr_zone: int | None = None
    pace_range: PaceRange | None = None


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
        "strength",  # short muscular reinforcement (Freeletics) — an addon slot
        "test",  # a level-assessment effort (feeds performance estimation)
        "race",  # race day — makes "race on D-day" representable/verifiable
        "rest",
    ]
    duration_min: int
    structure: list[Block] = Field(default_factory=list)
    pace_range: PaceRange | None = None
    hr_zone: int | None = None
    # "key" = the athlete should not skip it; "optional" = droppable on a busy week.
    priority: Literal["key", "optional"] = "key"
    # "addon" sessions (e.g. a 15-min strength block) share a day with a primary
    # session and don't count as a run day; "primary" own the day.
    slot: Literal["primary", "addon"] = "primary"
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


class PlanVersionSummary(BaseModel):
    """One entry in the read-only plan history. Versions are immutable (never
    mutated in place); the newest is always the active plan."""

    version: int
    created_at: datetime.datetime
    goal_description: str | None = None
    race_date: date | None = None
    weeks_total: int | None = None
    reason: str  # "Plan initial" / "Objectif ajusté" / "Reprise après blessure" / "Replanification"
    injury_area: str | None = None


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
    """The plan's sessions for today, adjusted for current form. A day can hold
    more than one (e.g. a run + a short strength addon)."""

    date: date
    has_plan: bool
    has_session: bool  # false on rest days / off-plan days
    week_index: int | None = None
    sessions: list[Session] = Field(default_factory=list)
    adjustment: DailyAdjustment | None = None  # applies to the primary session
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


class SessionLinkRequest(BaseModel):
    """Attach (or detach, when activity_id is null) a recorded activity to a
    planned session, identified by its week index and weekday."""

    week_index: int
    day: Weekday
    activity_id: str | None = None


class SessionLinkInfo(BaseModel):
    session_date: date
    linked: ActivityResponse | None = None
