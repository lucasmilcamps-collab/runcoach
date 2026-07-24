from datetime import date

from pydantic import BaseModel


class FitnessDay(BaseModel):
    """One day on the fitness curve. `load` is that day's summed TRIMP
    (all sports — cross-training counts, per the product truth)."""

    day: date
    load: float
    ctl: float  # fitness (42-day)
    atl: float  # fatigue (7-day)
    tsb: float  # form (fitness − fatigue)


class FitnessResponse(BaseModel):
    """Public shape for GET /api/v1/fitness. Values are recomputed on the fly
    from stored activities + the HR profile, so no resync is ever required."""

    has_profile: bool  # true once we know HRmax and HRrest
    hr_max: int | None = None
    hr_rest: int | None = None
    low_confidence: bool  # too little history to trust the CTL seed
    ctl: float  # current fitness
    atl: float  # current fatigue
    tsb: float  # current form
    series: list[FitnessDay]  # trailing window, oldest → newest
