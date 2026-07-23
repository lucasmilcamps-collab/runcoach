from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobResponse(BaseModel):
    id: str
    type: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None
    result_summary: dict | None = None
