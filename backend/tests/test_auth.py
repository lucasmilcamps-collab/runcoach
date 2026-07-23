async def test_register_returns_tokens(client):
    response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    assert response.status_code == 201
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data


async def test_register_duplicate_email_fails(client):
    await client.post("/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"})
    response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EMAIL_ALREADY_EXISTS"


async def test_login_wrong_password_fails(client):
    await client.post("/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"})
    response = await client.post(
        "/api/v1/auth/login", json={"email": "a@b.com", "password": "wrongpass"}
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_CREDENTIALS"


async def test_login_unknown_email_fails(client):
    response = await client.post(
        "/api/v1/auth/login", json={"email": "nope@b.com", "password": "password123"}
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_CREDENTIALS"


async def test_login_success(client):
    await client.post("/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"})
    response = await client.post(
        "/api/v1/auth/login", json={"email": "a@b.com", "password": "password123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()


async def test_refresh_token_flow(client):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    refresh_token = register_response.json()["refresh_token"]

    response = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert response.status_code == 200
    assert "access_token" in response.json()


async def test_refresh_with_access_token_fails(client):
    register_response = await client.post(
        "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
    )
    access_token = register_response.json()["access_token"]

    response = await client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_TOKEN"


async def test_refresh_with_garbage_token_fails(client):
    response = await client.post("/api/v1/auth/refresh", json={"refresh_token": "not-a-jwt"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "INVALID_TOKEN"
