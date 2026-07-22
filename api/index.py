"""
Vercel serverless entrypoint for the FastAPI backend.

Adds backend/ to sys.path so `from main import app` resolves the same app
used by uvicorn locally.
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from main import app  # noqa: E402
