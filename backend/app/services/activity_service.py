from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.activity import ActivityResponse


async def list_activities(
    db: AsyncIOMotorDatabase, user_id: str, limit: int = 20
) -> list[ActivityResponse]:
    cursor = db.activities.find({"user_id": user_id}).sort("start_time", -1).limit(limit)
    return [
        ActivityResponse(
            id=str(doc["_id"]),
            garmin_activity_id=doc["garmin_activity_id"],
            sport=doc["sport"],
            start_time=doc["start_time"],
            duration_s=doc["duration_s"],
            distance_m=doc.get("distance_m"),
            avg_hr=doc.get("avg_hr"),
            max_hr=doc.get("max_hr"),
            training_load=doc.get("training_load"),
        )
        async for doc in cursor
    ]
