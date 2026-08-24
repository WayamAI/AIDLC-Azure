from app.config import settings
from app.services.ai_service import _MODEL
import uvicorn

print("BOOT_MODEL", settings.OLLAMA_MODEL, _MODEL, flush=True)
uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=False)
