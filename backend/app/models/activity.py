from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class SportType(StrEnum):
    RUN = "RUN"
    PADEL = "PADEL"
    BASKETBALL = "BASKETBALL"
    BIKE = "BIKE"
    STRENGTH = "STRENGTH"
    OTHER = "OTHER"


# activityTypeDTO.typeKey -> our enum (garmin-sync skill). Anything unmapped
# still gets ingested as OTHER — the business rule is everything counts
# toward load, nothing is dropped. The raw type key is preserved separately
# (garmin_type_key) so the UI can still show the real sport for OTHER.
_GARMIN_TYPE_KEY_MAP: dict[str, SportType] = {
    "running": SportType.RUN,
    "treadmill_running": SportType.RUN,
    "trail_running": SportType.RUN,
    "track_running": SportType.RUN,
    "virtual_run": SportType.RUN,
    "tennis": SportType.PADEL,
    "padel": SportType.PADEL,
    "basketball": SportType.BASKETBALL,
    "cycling": SportType.BIKE,
    "road_biking": SportType.BIKE,
    "mountain_biking": SportType.BIKE,
    "gravel_cycling": SportType.BIKE,
    "indoor_cycling": SportType.BIKE,
    "virtual_ride": SportType.BIKE,
    "strength_training": SportType.STRENGTH,
    "indoor_cardio": SportType.STRENGTH,
}


def map_garmin_sport(type_key: str | None) -> SportType:
    if not type_key:
        return SportType.OTHER
    return _GARMIN_TYPE_KEY_MAP.get(type_key.lower(), SportType.OTHER)


class ActivityResponse(BaseModel):
    """Public shape — never includes `raw` or `user_id` (api-conventions)."""

    id: str
    garmin_activity_id: int
    sport: SportType
    garmin_type_key: str | None = None  # raw Garmin type, so the UI shows the real sport
    start_time: datetime
    duration_s: int
    distance_m: float | None = None
    avg_hr: int | None = None
    max_hr: int | None = None
    training_load: float | None = None
