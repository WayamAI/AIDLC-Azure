import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.config import settings

_client: AsyncIOMotorClient | None = None


def _make_client() -> AsyncIOMotorClient:
    uri = settings.MONGODB_URI
    kwargs: dict = {"serverSelectionTimeoutMS": 10000}
    # Only attach TLS CA bundle for Atlas (SRV) connections
    if uri.startswith("mongodb+srv://"):
        kwargs["tlsCAFile"] = certifi.where()
    return AsyncIOMotorClient(uri, **kwargs)


async def connect_db() -> None:
    global _client
    try:
        _client = _make_client()
        await _client.admin.command("ping")
        print(f"[DB] Connected to MongoDB at {settings.MONGODB_URI}")
    except Exception as exc:
        print(f"[DB] WARNING: MongoDB connection failed ({exc}). "
              "Server will start anyway DB calls will fail until the connection is available.")
        _client = None


async def ensure_connected() -> None:
    """Lazy connect for serverless cold starts (e.g. Vercel) where lifespan may not run."""
    global _client
    if _client is None:
        await connect_db()


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        print("[DB] MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    global _client
    if _client is None:
        _client = _make_client()
    return _client[settings.MONGODB_DB]
