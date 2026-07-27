from datetime import datetime

from pydantic import BaseModel

from app.models.plan import Block, PaceRange


class GarminConnectRequest(BaseModel):
    garmin_email: str
    garmin_password: str


class GarminConnectResponse(BaseModel):
    status: str  # "connected" | "needs_mfa"
    mfa_token: str | None = None


class GarminMfaRequest(BaseModel):
    mfa_token: str
    mfa_code: str


class GarminSyncResponse(BaseModel):
    status: str  # "done" | "failed" | "skipped"
    activities_synced: int | None = None
    error_message: str | None = None


class WorkoutPushRequest(BaseModel):
    """A plan session to convert into a Garmin structured workout and upload
    to Garmin Connect (which then syncs it to the watch)."""

    session_type: str
    duration_min: int
    structure: list[Block] = []
    pace_range: PaceRange | None = None
    hr_zone: int | None = None
    rationale: str | None = None
    week_number: int | None = None


class WorkoutPushResponse(BaseModel):
    status: str  # "done" | "failed"
    workout_name: str | None = None
    error_message: str | None = None


class GarminCredentialsDocument(BaseModel):
    """Shape of a `garmin_credentials` collection document.

    The user's Garmin password is never persisted — only the encrypted,
    serialized Garmin session (see app/core/crypto.py).
    """

    user_id: str
    encrypted_tokens: str
    needs_relogin: bool = False
    connected_at: datetime
