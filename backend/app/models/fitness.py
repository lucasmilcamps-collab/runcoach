from datetime import date

from pydantic import BaseModel, Field, model_validator


class FitnessDay(BaseModel):
    """One day on the fitness curve. `load` is that day's summed TRIMP
    (all sports — cross-training counts, per the product truth)."""

    day: date
    load: float
    ctl: float  # fitness (42-day)
    atl: float  # fatigue (7-day)
    tsb: float  # form (fitness − fatigue)


class FitnessProfileUpdate(BaseModel):
    """Athlete-provided HRmax/HRrest — the legitimate fallback when Garmin
    doesn't expose them (e.g. the watch isn't worn for daily resting HR). These
    take priority: a later Garmin sync never overwrites manual values. Bounds
    reject impossible input; the reserve check keeps Karvonen zones meaningful."""

    hr_max: int = Field(ge=120, le=230)
    hr_rest: int = Field(ge=25, le=120)

    @model_validator(mode="after")
    def _check_reserve(self) -> "FitnessProfileUpdate":
        if self.hr_max - self.hr_rest < 20:
            raise ValueError("hr_max doit dépasser hr_rest d'une marge réaliste")
        return self


class FitnessResponse(BaseModel):
    """Public shape for GET /api/v1/fitness. Values are recomputed on the fly
    from stored activities + the HR profile, so no resync is ever required."""

    has_profile: bool  # true once we know HRmax and HRrest
    hr_max: int | None = None
    hr_rest: int | None = None
    manual: bool = False  # HRmax/HRrest were entered by the athlete, not Garmin
    low_confidence: bool  # too little history to trust the CTL seed
    ctl: float  # current fitness
    atl: float  # current fatigue
    tsb: float  # current form
    series: list[FitnessDay]  # trailing window, oldest → newest
