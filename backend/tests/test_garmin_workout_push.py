"""The /garmin/workout endpoint's failure taxonomy.

python-garminconnect 0.3.x raises the same GarminConnectConnectionError for an
expired session, a refused payload and a rate limit — the status only survives
inside the message. These tests pin the classification, because the athlete's
next move differs for each: reconnect, wait, or stop retrying.
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import garminconnect
import pytest
import requests

from app.core.crypto import encrypt_token_blob


async def _register_and_get_access_token(client) -> str:
    response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    return response.json()["access_token"]


async def _connect_garmin(db, access_token: str, needs_relogin: bool = False) -> None:
    from app.core.security import decode_token

    user_id = decode_token(access_token, expected_type="access")
    await db.garmin_credentials.insert_one(
        {
            "user_id": user_id,
            "encrypted_tokens": encrypt_token_blob('{"di_token": "fake"}'),
            "needs_relogin": needs_relogin,
            "connected_at": datetime.now(UTC),
        }
    )


_SESSION = {
    "session_type": "easy",
    "duration_min": 40,
    "structure": [],
    "pace_range": None,
    "hr_zone": 2,
}


async def _push(client, access_token: str):
    return await client.post(
        "/api/v1/garmin/workout",
        json=_SESSION,
        headers={"Authorization": f"Bearer {access_token}"},
    )


async def test_push_without_garmin_account_is_a_conflict(client):
    access_token = await _register_and_get_access_token(client)
    response = await _push(client, access_token)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "GARMIN_NOT_CONNECTED"


async def test_push_succeeds(client, db):
    access_token = await _register_and_get_access_token(client)
    await _connect_garmin(db, access_token)

    garmin = MagicMock()
    with patch("app.services.garmin_workout_service._restore_client_sync", return_value=garmin):
        response = await _push(client, access_token)

    assert response.status_code == 200
    assert response.json() == {
        "status": "done",
        "workout_name": "Relay — Footing",
        "error_message": None,
    }
    garmin.upload_running_workout.assert_called_once()


@pytest.mark.parametrize(
    ("upstream", "expected_status", "expected_code"),
    [
        # An expired session: Garmin answers 401 to the upload, and the library
        # reports it as a *connection* error. Told to "retry in a few minutes",
        # the athlete would retry forever — only reconnecting fixes this.
        (
            garminconnect.GarminConnectConnectionError("API Error 401 - Unauthorized"),
            409,
            "GARMIN_RELOGIN",
        ),
        (
            garminconnect.GarminConnectConnectionError("API Error 403 - Forbidden"),
            409,
            "GARMIN_RELOGIN",
        ),
        # Rate limited: waiting is the right advice, and it's the only case
        # where it is.
        (
            garminconnect.GarminConnectConnectionError("API Error 429 - Too Many"),
            429,
            "GARMIN_RATE_LIMITED",
        ),
        (
            garminconnect.GarminConnectTooManyRequestsError("slow down"),
            429,
            "GARMIN_RATE_LIMITED",
        ),
        # Garmin refused the workout itself — our payload is the problem, so
        # the message must not promise that retrying helps.
        (
            garminconnect.GarminConnectConnectionError("API Error 400 - Bad workout"),
            502,
            "GARMIN_WORKOUT_REJECTED",
        ),
        # A genuine outage, the only thing the old message ever described.
        (
            garminconnect.GarminConnectConnectionError("API Error 503 - unavailable"),
            502,
            "GARMIN_UPSTREAM_ERROR",
        ),
        # No status to read: treated as an outage rather than guessed at.
        (
            garminconnect.GarminConnectConnectionError("connection reset"),
            502,
            "GARMIN_UPSTREAM_ERROR",
        ),
        # Timeouts never reach the library's wrapper — the upload is made with
        # a plain requests.Session — and used to escape as a bare 500.
        (requests.Timeout("timed out"), 502, "GARMIN_UPSTREAM_ERROR"),
        (requests.ConnectionError("no route"), 502, "GARMIN_UPSTREAM_ERROR"),
        # Anything unforeseen is still an answer the app can render.
        (RuntimeError("boom"), 502, "GARMIN_WORKOUT_FAILED"),
    ],
)
async def test_upload_failures_are_classified(client, db, upstream, expected_status, expected_code):
    access_token = await _register_and_get_access_token(client)
    await _connect_garmin(db, access_token)

    garmin = MagicMock()
    garmin.upload_running_workout.side_effect = upstream
    with patch("app.services.garmin_workout_service._restore_client_sync", return_value=garmin):
        response = await _push(client, access_token)

    assert response.status_code == expected_status
    assert response.json()["detail"]["code"] == expected_code


async def test_auth_failure_marks_the_connection_for_relogin(client, db):
    access_token = await _register_and_get_access_token(client)
    await _connect_garmin(db, access_token)

    garmin = MagicMock()
    garmin.upload_running_workout.side_effect = garminconnect.GarminConnectConnectionError(
        "API Error 401 - Unauthorized"
    )
    with patch("app.services.garmin_workout_service._restore_client_sync", return_value=garmin):
        await _push(client, access_token)

    stored = await db.garmin_credentials.find_one({})
    assert stored["needs_relogin"] is True


async def test_a_connection_known_dead_never_calls_garmin(client, db):
    access_token = await _register_and_get_access_token(client)
    await _connect_garmin(db, access_token, needs_relogin=True)

    with patch("app.services.garmin_workout_service._restore_client_sync") as restore:
        response = await _push(client, access_token)

    restore.assert_not_called()
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "GARMIN_RELOGIN"


async def test_unrestorable_tokens_ask_for_a_reconnection(client, db):
    access_token = await _register_and_get_access_token(client)
    await _connect_garmin(db, access_token)

    # `loads()` reports missing tokens as a *connection* error, so the
    # exception type carries no signal — a client we can't rebuild is a dead
    # session, whatever it raised.
    with patch(
        "app.services.garmin_workout_service._restore_client_sync",
        side_effect=garminconnect.GarminConnectConnectionError("loads() failed"),
    ):
        response = await _push(client, access_token)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "GARMIN_RELOGIN"
    stored = await db.garmin_credentials.find_one({})
    assert stored["needs_relogin"] is True
