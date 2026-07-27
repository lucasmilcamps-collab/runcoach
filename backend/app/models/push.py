"""Web Push subscription shapes. A subscription is the browser's PushManager
object; we store it per user and send to it via VAPID (push_service)."""

from pydantic import BaseModel


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    """The browser subscription (extra fields like expirationTime are ignored)."""

    endpoint: str
    keys: PushKeys


class UnsubscribeIn(BaseModel):
    endpoint: str


class PublicKeyResponse(BaseModel):
    public_key: str | None = None
