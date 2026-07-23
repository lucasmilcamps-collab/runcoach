import asyncio
import secrets
import time
from datetime import UTC, datetime

import garminconnect
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.crypto import encrypt_token_blob


class GarminInvalidCredentialsError(Exception):
    pass


class GarminUpstreamError(Exception):
    pass


class GarminMfaInvalidError(Exception):
    """Wrong/expired MFA code, or an mfa_token that doesn't match a pending login."""


_MFA_TOKEN_TTL_SECONDS = 10 * 60

# Garmin's MFA state lives only on the in-progress `Garmin` client instance
# (see garminconnect's Client.login: "MFA state is stored on self"), so it
# can't be serialized across the two HTTP requests of this flow. Holding the
# object in memory, keyed by a short-lived random token, is the pragmatic
# choice for a single-instance deployment; it does not survive a restart
# between the two steps, which is an accepted tradeoff for this solo tool.
_pending_mfa: dict[str, tuple[str, float, "garminconnect.Garmin"]] = {}


def _prune_expired_mfa() -> None:
    now = time.monotonic()
    expired = [
        token
        for token, (_, created_at, _) in _pending_mfa.items()
        if now - created_at > _MFA_TOKEN_TTL_SECONDS
    ]
    for token in expired:
        del _pending_mfa[token]


def _resume_login_sync(client: "garminconnect.Garmin", mfa_code: str) -> str:
    client.resume_login(None, mfa_code)
    return client.client.dumps()


async def _store_credentials(db: AsyncIOMotorDatabase, user_id: str, token_blob: str) -> None:
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


async def connect_garmin(
    db: AsyncIOMotorDatabase, user_id: str, garmin_email: str, garmin_password: str
) -> tuple[str, str | None]:
    """Returns ("connected", None) or ("needs_mfa", mfa_token)."""
    try:
        client = garminconnect.Garmin(garmin_email, garmin_password, return_on_mfa=True)
        mfa_status, _ = await asyncio.to_thread(client.login)
    except garminconnect.GarminConnectAuthenticationError as exc:
        raise GarminInvalidCredentialsError from exc
    except (
        garminconnect.GarminConnectConnectionError,
        garminconnect.GarminConnectTooManyRequestsError,
    ) as exc:
        # Deliberately not retried here: repeated login attempts against
        # Garmin risk a CAPTCHA/account lock (garmin-sync skill).
        raise GarminUpstreamError from exc

    if mfa_status == "needs_mfa":
        _prune_expired_mfa()
        mfa_token = secrets.token_urlsafe(24)
        _pending_mfa[mfa_token] = (user_id, time.monotonic(), client)
        return "needs_mfa", mfa_token

    await _store_credentials(db, user_id, client.client.dumps())
    return "connected", None


async def complete_garmin_mfa(
    db: AsyncIOMotorDatabase, user_id: str, mfa_token: str, mfa_code: str
) -> None:
    _prune_expired_mfa()
    pending = _pending_mfa.get(mfa_token)
    if pending is None or pending[0] != user_id:
        raise GarminMfaInvalidError

    _, _, client = pending
    try:
        token_blob = await asyncio.to_thread(_resume_login_sync, client, mfa_code)
    except garminconnect.GarminConnectAuthenticationError as exc:
        raise GarminMfaInvalidError from exc
    except (
        garminconnect.GarminConnectConnectionError,
        garminconnect.GarminConnectTooManyRequestsError,
    ) as exc:
        raise GarminUpstreamError from exc
    else:
        del _pending_mfa[mfa_token]

    await _store_credentials(db, user_id, token_blob)
