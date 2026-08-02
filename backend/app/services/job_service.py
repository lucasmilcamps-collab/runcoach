from datetime import UTC, datetime, timedelta

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.job import JobResponse, JobStatus

# A job whose worker died leaves its row saying RUNNING for ever, and the client
# polls a status that will never change. Past this, a running job is reported as
# failed: generation is the long one and it is bounded well under this.
_STALE_AFTER = timedelta(minutes=30)


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

    job_status = doc["status"]
    error_message = doc.get("error_message")
    if job_status in (JobStatus.PENDING, JobStatus.RUNNING) and _is_stale(doc["updated_at"]):
        # Reported, not written back: the worker may yet finish, and a row this
        # code rewrote would then contradict it. The client needs an answer now.
        job_status = JobStatus.FAILED
        error_message = "Tâche interrompue (serveur redémarré). Relancez-la."

    return JobResponse(
        id=str(doc["_id"]),
        type=doc["type"],
        status=job_status,
        # Mongo hands datetimes back naive, and a naive datetime serializes with
        # no offset — which a browser then reads as *local* time. The client
        # shows how long a generation has been running, so that silently shifted
        # the elapsed time by the athlete's UTC offset.
        created_at=_as_utc(doc["created_at"]),
        updated_at=_as_utc(doc["updated_at"]),
        error_message=error_message,
        result_summary=doc.get("result_summary"),
    )


def _as_utc(value: datetime) -> datetime:
    """Stored UTC, read back naive — re-attach the timezone it was written with."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _is_stale(updated_at: datetime) -> bool:
    return datetime.now(UTC) - _as_utc(updated_at) > _STALE_AFTER
