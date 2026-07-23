from datetime import datetime

from pydantic import BaseModel


class GarminConnectRequest(BaseModel):
    garmin_email: str
    garmin_password: str


class GarminConnectResponse(BaseModel):
    status: str = "connected"


class GarminCredentialsDocument(BaseModel):
    """Shape of a `garmin_credentials` collection document.

    The user's Garmin password is never persisted — only the encrypted,
    serialized Garmin session (see app/core/crypto.py).
    """

    user_id: str
    encrypted_tokens: str
    needs_relogin: bool = False
    connected_at: datetime
