import asyncio
from datetime import UTC, datetime

import garminconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.crypto import encrypt_token_blob


class GarminInvalidCredentialsError(Exception):
    pass


class GarminUpstreamError(Exception):
    pass


def _login_sync(email: str, password: str) -> str:
    """python-garminconnect is a synchronous client; call it via asyncio.to_thread.

    Garmin has no public OAuth app flow (see garmin-sync skill) — the user's
    own credentials are used once, here, and never persisted. Only the
    resulting session (client.client.dumps()) is kept, and it is encrypted
    by the caller before it ever reaches the database.
    """
    client = garminconnect.Garmin(email, password)
    client.login()
    return client.client.dumps()


async def connect_garmin(
    db: AsyncIOMotorDatabase, user_id: str, garmin_email: str, garmin_password: str
) -> None:
    try:
        token_blob = await asyncio.to_thread(_login_sync, garmin_email, garmin_password)
    except garminconnect.GarminConnectAuthenticationError as exc:
        raise GarminInvalidCredentialsError from exc
    except (
        garminconnect.GarminConnectConnectionError,
        garminconnect.GarminConnectTooManyRequestsError,
    ) as exc:
        # Deliberately not retried here: repeated login attempts against
        # Garmin risk a CAPTCHA/account lock (garmin-sync skill).
        raise GarminUpstreamError from exc

    await db.garmin_credentials.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "encrypted_tokens": encrypt_token_blob(token_blob),
                "needs_relogin": False,
                "connected_at": datetime.now(UTC),
            }
        },
        upsert=True,
    )
