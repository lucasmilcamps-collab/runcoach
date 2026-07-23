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
    mock_instance.login.return_value = (None, None)
    mock_instance.client.dumps.return_value = '{"di_token": "fake"}'

    with patch("app.services.garmin_service.garminconnect.Garmin", return_value=mock_instance):
        response = await client.post(
            "/api/v1/garmin/connect",
            json={"garmin_email": "g@example.com", "garmin_password": "gpw"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "connected", "mfa_token": None}

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


async def test_connect_garmin_mfa_flow(client, db):
    access_token = await _register_and_get_access_token(client)

    mock_instance = MagicMock()
    mock_instance.login.return_value = ("needs_mfa", None)
    mock_instance.client.dumps.return_value = '{"di_token": "after-mfa"}'

    with patch("app.services.garmin_service.garminconnect.Garmin", return_value=mock_instance):
        connect_response = await client.post(
            "/api/v1/garmin/connect",
            json={"garmin_email": "g@example.com", "garmin_password": "gpw"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert connect_response.status_code == 200
    body = connect_response.json()
    assert body["status"] == "needs_mfa"
    mfa_token = body["mfa_token"]
    assert mfa_token

    # No credentials collection write yet — MFA isn't complete.
    assert await db.garmin_credentials.find_one({}) is None

    mfa_response = await client.post(
        "/api/v1/garmin/connect/mfa",
        json={"mfa_token": mfa_token, "mfa_code": "123456"},
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert mfa_response.status_code == 200
    assert mfa_response.json() == {"status": "connected", "mfa_token": None}
    mock_instance.resume_login.assert_called_once_with(None, "123456")

    stored = await db.garmin_credentials.find_one({})
    assert stored is not None
    assert stored["encrypted_tokens"] != '{"di_token": "after-mfa"}'


async def test_connect_garmin_mfa_wrong_code(client):
    access_token = await _register_and_get_access_token(client)

    mock_instance = MagicMock()
    mock_instance.login.return_value = ("needs_mfa", None)
    mock_instance.resume_login.side_effect = garminconnect.GarminConnectAuthenticationError("bad")

    with patch("app.services.garmin_service.garminconnect.Garmin", return_value=mock_instance):
        connect_response = await client.post(
            "/api/v1/garmin/connect",
            json={"garmin_email": "g@example.com", "garmin_password": "gpw"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        mfa_token = connect_response.json()["mfa_token"]

        response = await client.post(
            "/api/v1/garmin/connect/mfa",
            json={"mfa_token": mfa_token, "mfa_code": "000000"},
            headers={"Authorization": f"Bearer {access_token}"},
        )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GARMIN_MFA_INVALID"


async def test_connect_garmin_mfa_unknown_token(client):
    access_token = await _register_and_get_access_token(client)

    response = await client.post(
        "/api/v1/garmin/connect/mfa",
        json={"mfa_token": "not-a-real-token", "mfa_code": "123456"},
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GARMIN_MFA_INVALID"
