import pytest
from httpx import AsyncClient, ASGITransport
from mongomock_motor import AsyncMongoMockClient

import app.database as database_module
from app.config import settings


@pytest.fixture
async def db(monkeypatch):
    """A fresh in-memory MongoDB database per test, wired into app.database.get_db()."""
    mock_client = AsyncMongoMockClient()
    # Use the actual configured database name so routes calling get_db() see the same DB
    mock_db = mock_client[settings.MONGODB_DB]
    monkeypatch.setattr(database_module, "_client", mock_client)
    # Don't patch get_db itself; the original function already returns _client[settings.MONGODB_DB]
    # and all route modules have already imported it. Patching _client is sufficient.
    yield mock_db


@pytest.fixture
async def app_client(db):
    """An httpx AsyncClient that talks to the real FastAPI app in-process."""
    from main import app  # imported here so the db monkeypatch above is active first

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
