import mongomock_motor
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.db import get_db
from app.main import app


@pytest.fixture
def db():
    mock_client = mongomock_motor.AsyncMongoMockClient()
    return mock_client["runcoach_test"]


@pytest.fixture
async def client(db):
    app.dependency_overrides[get_db] = lambda: db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
