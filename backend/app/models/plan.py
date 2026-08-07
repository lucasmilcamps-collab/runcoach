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

from pydantic import BaseModel, Field, field_validator, model_validator

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

_WEEKDAY_INDEX: dict[Weekday, int] = {day: i for i, day in enumerate(WEEKDAY_ORDER)}


def session_order_key(session: "Session") -> tuple[int, int]:
    """Calendar order for a week's sessions: Monday first, and within a day the
    primary session ahead of its add-on (a short strength block rides along).

    The generator emits sessions in no particular order, so without this a
    Thursday session could sit above a Wednesday one everywhere the plan is
    read. Sorting on the model means it holds for freshly generated plans and
    for the ones already stored in Mongo, with no migration.
    """
    return (_WEEKDAY_INDEX[session.day], 1 if session.slot == "addon" else 0)


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
    # Monday the plan's week 1 begins on. None lets the service choose (see
    # `plan_service.resolve_start_date`): generating on a Friday and being handed
    # a week that is already five-sevenths spent is not a plan, it's a backlog.
    start_date: date | None = None
    available_days: list[Weekday]
    # The athlete commits to `min` key run sessions per week and can do up to
    # `max`. They must differ by default: `_check_session_counts` marks exactly
    # `min` sessions `key`, so min == max leaves no `optional` session at all —
    # and "which one do I drop this week?" is the whole point of the field.
    min_run_sessions_per_week: int = Field(default=2, ge=1, le=7)
    max_run_sessions_per_week: int = Field(default=3, ge=1, le=7)
    fixed_sports: list[FixedSport] = Field(default_factory=list)
    # Whether the plan PRESCRIBES cross-training sessions. This only steers the
    # prompt — it NEVER touches load/fitness: the athlete's real other sports
    # (padel, basket…) always count toward CTL/ATL via fitness_service.
    include_cross_training: bool = False
    strength: StrengthPref = Field(default_factory=StrengthPref)

    @model_validator(mode="after")
    def _check_session_bounds(self) -> "PlanRequest":
        """Reject min > max here rather than at generation time: the validator
        would refuse every candidate plan, so the athlete would wait through
        three model calls only to get "plan invalide" with no usable cause."""
        if self.min_run_sessions_per_week > self.max_run_sessions_per_week:
            raise ValueError(
                "Le minimum de séances de course ne peut pas dépasser le maximum "
                f"({self.min_run_sessions_per_week} > {self.max_run_sessions_per_week})."
            )
        return self


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
    # Runtime-only: set by the per-week override on read (plan_moves_service),
    # never by the generator — it is stripped from the tool schema. A skipped
    # session stays in the plan, visibly struck through, because "I'm not doing
    # this one" is information the athlete wants to keep seeing.
    skipped: bool = False

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

    @field_validator("sessions")
    @classmethod
    def _calendar_order(cls, sessions: list[Session]) -> list[Session]:
        """Normalise session order on the way in — see `session_order_key`.
        Every validation rule reads the week by day rather than by position, so
        reordering here changes presentation only, never the plan itself."""
        return sorted(sessions, key=session_order_key)


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
    status: Literal["generating", "ready", "failed", "cancelled"]
    request: PlanRequest | None = None
    plan: Plan | None = None
    estimated_time_min: int | None = None  # estimated current time at the target
    # How far the estimate can be trusted. It was computed and sent to the model
    # but never stored, so the app showed a race time with the authority of a
    # number while the engine itself rated it "low" — see performance_service.
    estimated_time_confidence: Literal["high", "medium", "low"] | None = None
    projected_time_min: int | None = None  # projected time at the plan's end
    feasibility_warning: str | None = None  # a notice, never a blocker
    error_message: str | None = None


class PlanVersionSummary(BaseModel):
    """One entry in the read-only list of plan versions. Versions are immutable
    (never mutated in place)."""

    version: int
    created_at: datetime.datetime
    status: Literal["ready", "cancelled"] = "ready"
    # Whether this version IS the plan currently driving the app. Derived here
    # rather than in the client: "the newest one" stopped being true once a plan
    # could be stopped, and a client re-deriving the rule gets it wrong the day
    # the rule changes again.
    is_active: bool = False
    goal_description: str | None = None
    race_date: date | None = None
    weeks_total: int | None = None
    reason: str  # "Plan initial" / "Objectif ajusté" / "Reprise après blessure" / "Replanification"
    injury_area: str | None = None
    estimated_time_min: int | None = None
    projected_time_min: int | None = None


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
            v is not None for v in (self.hrv, self.resting_hr, self.sleep_hours, self.body_battery)
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


class WeekAdherence(BaseModel):
    """One week of a plan, planned versus actually done.

    Counts KEY runs only — the sessions the athlete committed to. An optional
    session skipped on a busy week is not a broken week, and counting it as one
    would turn a deliberately flexible plan into a guilt meter.
    """

    week_index: int
    planned: int
    completed: int
    is_deload: bool = False
    # A week is only scored once it is over: an in-progress or future week has
    # nothing to be behind on, and shading it as "missed" would be a lie.
    is_past: bool = False
    is_current: bool = False


class PlanOverview(BaseModel):
    """What a plan's summary screen needs that the plan document alone can't say:
    where the weeks fall on the calendar, and how much of it was actually run.

    Everything derivable from the plan itself (weekly volume, phases, sessions
    per week) is left to the client — sending it twice would be a second copy to
    keep in step."""

    version: int
    start_date: date
    end_date: date
    week_current: int | None = None
    weeks_total: int = 0
    # Totals over ELAPSED weeks only — the denominator the percentage uses.
    planned: int = 0
    completed: int = 0
    weeks: list[WeekAdherence] = Field(default_factory=list)


class SessionLinkRequest(BaseModel):
    """Attach (or detach, when activity_id is null) a recorded activity to a
    planned session, identified by its week index, weekday AND slot.

    The slot matters: a day can hold a run and a strength addon, and linking an
    activity to one must not mark the other done."""

    week_index: int
    day: Weekday
    slot: Literal["primary", "addon"] = "primary"
    activity_id: str | None = None


class SessionLinkInfo(BaseModel):
    session_date: date
    linked: ActivityResponse | None = None


class SessionMoveRequest(BaseModel):
    """Move a session to another weekday for one week only (a per-week override
    on the current plan; the stored plan version is never mutated)."""

    week_index: int
    from_day: Weekday  # the session's currently-shown day
    to_day: Weekday


class SessionDurationRequest(BaseModel):
    """Shorten or lengthen a session for one week only. Same override model as a
    move: the stored plan version is untouched and a replan clears it."""

    week_index: int
    day: Weekday  # the session's currently-shown day
    slot: Literal["primary", "addon"] = "primary"
    duration_min: int = Field(ge=5, le=300)


class SessionSkipRequest(BaseModel):
    """Declare a session skipped (or un-skipped) for one week only.

    Unlike a deletion, this is allowed on runs and is reversible: deleting a run
    silently breaks the plan's guaranteed run count, whereas skipping says "not
    this week" and leaves the session visible, flagged. On a key session the miss
    counts immediately and feeds the replan trigger; it never regenerates
    anything on its own."""

    week_index: int
    day: Weekday  # the session's currently-shown day
    slot: Literal["primary", "addon"] = "primary"
    skipped: bool = True


class SessionDeleteRequest(BaseModel):
    """Drop a session for one week only. Running sessions are refused: removing
    one would silently break the plan's guaranteed run count, which is a replan
    decision, not a per-week tweak."""

    week_index: int
    day: Weekday  # the session's currently-shown day
    slot: Literal["primary", "addon"] = "primary"
