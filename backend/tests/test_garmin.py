from unittest.mock import MagicMock, patch

import garminconnect


async def _register_and_get_access_token(client) -> str:
    response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    return response.json()["access_token"]


async def test_connect_garmin_success(client, db):
    access_token = await _register_and_get_access_token(client)

    mock_instance = MagicMock()
    mock_instance.client.dumps.return_value = '{"di_token": "fake"}'

    with patch("app.services.garmin_service.garminconnect.Garmin", return_value=mock_instance):
        response = await client.post(
            "/api/v1/garmin/connect",
            json={"garmin_email": "g@example.com", "garmin_password": "gpw"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "connected"}

    stored = await db.garmin_credentials.find_one({})
    assert stored is not None
    assert stored["encrypted_tokens"] != '{"di_token": "fake"}'  # never stored in clear
    assert "garmin_password" not in str(stored)


async def test_connect_garmin_invalid_credentials(client):
    access_token = await _register_and_get_access_token(client)

    mock_instance = MagicMock()
    mock_instance.login.side_effect = garminconnect.GarminConnectAuthenticationError("bad creds")

    with patch("app.services.garmin_service.garminconnect.Garmin", return_value=mock_instance):
        response = await client.post(
            "/api/v1/garmin/connect",
            json={"garmin_email": "g@example.com", "garmin_password": "wrong"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GARMIN_INVALID_CREDENTIALS"


async def test_connect_garmin_upstream_error(client):
    access_token = await _register_and_get_access_token(client)

    mock_instance = MagicMock()
    mock_instance.login.side_effect = garminconnect.GarminConnectConnectionError("down")

    with patch("app.services.garmin_service.garminconnect.Garmin", return_value=mock_instance):
        response = await client.post(
            "/api/v1/garmin/connect",
            json={"garmin_email": "g@example.com", "garmin_password": "gpw"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "GARMIN_UPSTREAM_ERROR"


async def test_connect_garmin_requires_auth(client):
    response = await client.post(
        "/api/v1/garmin/connect",
        json={"garmin_email": "g@example.com", "garmin_password": "gpw"},
    )
    assert response.status_code in (401, 403)
