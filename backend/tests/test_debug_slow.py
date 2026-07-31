"""TEMPORARY — delete with app/api/debug.py once the inbound request limit is
measured (see the plan-generator skill)."""

from unittest.mock import AsyncMock, patch

from app.core.config import settings


async def test_slow_endpoint_is_closed_by_default(client):
    """The flag is off in every environment that hasn't opted in, including
    production: an endpoint that holds a worker for minutes must not be
    reachable by accident."""
    assert settings.enable_debug_slow is False
    response = await client.get("/debug/slow?seconds=1")
    assert response.status_code == 404


async def test_slow_endpoint_holds_the_request_when_enabled(client):
    sleep_mock = AsyncMock()
    with (
        patch.object(settings, "enable_debug_slow", True),
        patch("app.api.debug.asyncio.sleep", sleep_mock),
    ):
        response = await client.get("/debug/slow?seconds=150")

    assert response.status_code == 200
    assert response.json()["slept_s"] == 150
    sleep_mock.assert_awaited_once_with(150)


async def test_slow_endpoint_bounds_the_sleep(client):
    with patch.object(settings, "enable_debug_slow", True):
        assert (await client.get("/debug/slow?seconds=0")).status_code == 422
        assert (await client.get("/debug/slow?seconds=99999")).status_code == 422
