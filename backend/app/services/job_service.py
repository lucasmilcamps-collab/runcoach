from datetime import UTC, datetime

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.job import JobResponse, JobStatus


async def create_job(db: AsyncIOMotorDatabase, user_id: str, job_type: str) -> str:
    now = datetime.now(UTC)
    result = await db.jobs.insert_one(
        {
            "user_id": user_id,
            "type": job_type,
            "status": JobStatus.PENDING,
            "created_at": now,
            "updated_at": now,
            "error_message": None,
            "result_summary": None,
        }
    )
    return str(result.inserted_id)


async def update_job(
    db: AsyncIOMotorDatabase,
    job_id: str,
    job_status: JobStatus,
    error_message: str | None = None,
    result_summary: dict | None = None,
) -> None:
    await db.jobs.update_one(
        {"_id": ObjectId(job_id)},
        {
            "$set": {
                "status": job_status,
                "updated_at": datetime.now(UTC),
                "error_message": error_message,
                "result_summary": result_summary,
            }
        },
    )


async def get_job(db: AsyncIOMotorDatabase, job_id: str, user_id: str) -> JobResponse | None:
    if not ObjectId.is_valid(job_id):
        return None
    doc = await db.jobs.find_one({"_id": ObjectId(job_id), "user_id": user_id})
    if doc is None:
        return None
    return JobResponse(
        id=str(doc["_id"]),
        type=doc["type"],
        status=doc["status"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        error_message=doc.get("error_message"),
        result_summary=doc.get("result_summary"),
    )
