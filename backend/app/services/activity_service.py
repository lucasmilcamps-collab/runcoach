from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import ActivityResponse


def _type_key_from_doc(doc: dict) -> str | None:
    # Prefer the stored field; fall back to the raw payload so activities
    # synced before garmin_type_key existed still resolve their real sport.
    stored = doc.get("garmin_type_key")
    if stored:
        return stored
    activity_type = (doc.get("raw") or {}).get("activityType") or {}
    return activity_type.get("typeKey")


async def list_activities(
    db: AsyncIOMotorDatabase, user_id: str, limit: int = 50
) -> list[ActivityResponse]:
    cursor = db.activities.find({"user_id": user_id}).sort("start_time", -1).limit(limit)
    return [
        ActivityResponse(
            id=str(doc["_id"]),
            garmin_activity_id=doc["garmin_activity_id"],
            sport=doc["sport"],
            garmin_type_key=_type_key_from_doc(doc),
            start_time=doc["start_time"],
            duration_s=doc["duration_s"],
            distance_m=doc.get("distance_m"),
            avg_hr=doc.get("avg_hr"),
            max_hr=doc.get("max_hr"),
            training_load=doc.get("training_load"),
        )
        async for doc in cursor
    ]
