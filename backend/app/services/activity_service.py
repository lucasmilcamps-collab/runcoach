from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import ActivityResponse, ManualActivityCreate
from app.services import load_service


def _type_key_from_doc(doc: dict) -> str | None:
    # Prefer the stored field; fall back to the raw payload so activities
    # synced before garmin_type_key existed still resolve their real sport.
    stored = doc.get("garmin_type_key")
    if stored:
        return stored
    activity_type = (doc.get("raw") or {}).get("activityType") or {}
    return activity_type.get("typeKey")


def _to_response(doc: dict) -> ActivityResponse:
    return ActivityResponse(
        id=str(doc["_id"]),
        garmin_activity_id=doc.get("garmin_activity_id"),
        sport=doc["sport"],
        garmin_type_key=_type_key_from_doc(doc),
        start_time=doc["start_time"],
        duration_s=doc["duration_s"],
        distance_m=doc.get("distance_m"),
        avg_hr=doc.get("avg_hr"),
        max_hr=doc.get("max_hr"),
        training_load=doc.get("training_load"),
        manual=bool(doc.get("manual")),
        rpe=doc.get("rpe"),
        note=doc.get("note"),
    )


async def list_activities(
    db: AsyncIOMotorDatabase, user_id: str, limit: int = 50
) -> list[ActivityResponse]:
    cursor = db.activities.find({"user_id": user_id}).sort("start_time", -1).limit(limit)
    return [_to_response(doc) async for doc in cursor]


async def create_manual_activity(
    db: AsyncIOMotorDatabase, user_id: str, payload: ManualActivityCreate
) -> ActivityResponse:
    """Store a hand-logged session. Its load is session-RPE (no HR), computed and
    stored here so the list can show it; fitness_service recomputes it anyway."""
    duration_s = payload.duration_min * 60
    start = payload.start_time
    start_utc = start.replace(tzinfo=UTC) if start.tzinfo is None else start.astimezone(UTC)

    doc = {
        "user_id": user_id,
        "garmin_activity_id": None,
        "manual": True,
        "sport": payload.sport,
        "garmin_type_key": None,
        "start_time": start_utc,
        "duration_s": duration_s,
        "distance_m": payload.distance_km * 1000 if payload.distance_km is not None else None,
        "avg_hr": None,
        "max_hr": None,
        "rpe": payload.rpe,
        "note": payload.note,
        "training_load": load_service.compute_session_rpe_load(duration_s, payload.rpe),
        "created_at": datetime.now(UTC),
    }
    result = await db.activities.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _to_response(doc)


async def delete_manual_activity(db: AsyncIOMotorDatabase, user_id: str, activity_id: str) -> bool:
    """Delete a manually-logged activity. Garmin-synced activities are never
    deletable here (they'd reappear on the next sync); only `manual` ones are."""
    try:
        oid = ObjectId(activity_id)
    except (InvalidId, TypeError):
        return False
    result = await db.activities.delete_one({"_id": oid, "user_id": user_id, "manual": True})
    return result.deleted_count == 1
