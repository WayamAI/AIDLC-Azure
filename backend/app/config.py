from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Always load backend/.env regardless of process cwd (avoids picking up repo-root .env).
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # MongoDB
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "aidlc"

    # Ollama (OpenAI-compatible API)
    # Local: http://localhost:11434 with any non-empty api key.
    # Ollama cloud/pro: https://ollama.com with an API key from ollama.com/settings/keys.
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_API_KEY: str = "ollama"
    OLLAMA_MODEL: str = "kimi-k3:cloud"

    # GitHub
    GITHUB_TOKEN: str = ""
    GITHUB_REPO_ID: str = ""

    # Vercel Deployments
    VERCEL_TOKEN: str = ""
    VERCEL_TEAM_ID: str = ""
    VERCEL_PROJECT_ID: str = ""
    VERCEL_PROJECT_NAME: str = ""

    # Jira
    JIRA_DOMAIN: str = ""
    JIRA_EMAIL: str = ""
    JIRA_TOKEN: str = ""

    # Slack
    SLACK_WEBHOOK_URL: str = ""

    # Datadog
    DATADOG_API_KEY: str = ""
    DATADOG_APP_KEY: str = ""

    # WorkOS AuthKit (real user auth + organizations)
    WORKOS_API_KEY: str = ""
    WORKOS_CLIENT_ID: str = ""
    WORKOS_WEBHOOK_SECRET: str = ""
    WORKOS_REDIRECT_URI: str = "http://localhost:8000/api/auth/callback"

    # Backend-signed session cookie (separate from WorkOS see auth/session.py)
    SESSION_SECRET: str = "dev-only-insecure-secret-change-me"

    # AI Workspace
    WORKSPACE_TEMP_DIR: str = "/tmp/workspaces"
    MAX_FILE_SIZE_KB: int = 500
    MAX_REPO_SIZE_MB: int = 100
    COMMIT_AUTHOR_NAME: str = "SDLC AI"
    COMMIT_AUTHOR_EMAIL: str = "ai@sdlc.dev"

    # App
    APP_ENV: str = "development"
    FRONTEND_URL: str = "http://localhost:8081"
    CORS_ORIGINS: list[str] = [
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:5173",
        "http://localhost:8083",
        "https://localhost:8000",
    ]

    # PR Review Engine
    PR_REVIEW_V2_ENABLED: bool = True
    PR_REVIEW_MAX_FILES: int = 15
    PR_REVIEW_MAX_PATCH_CHARS: int = 3000
    PR_REVIEW_MAX_HUNKS_PER_FILE: int = 8

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Any) -> list[str]:
        """Accept JSON array, comma-separated string, or list from env."""
        if value is None or value == "":
            return []
        if isinstance(value, list):
            return [str(x).strip() for x in value if str(x).strip()]
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                import json

                parsed = json.loads(text)
                return [str(x).strip() for x in parsed if str(x).strip()]
            return [part.strip() for part in text.split(",") if part.strip()]
        return value

    @property
    def jira_base_url(self) -> str:
        """Extract clean Jira base URL from potentially messy JIRA_DOMAIN value."""
        domain = self.JIRA_DOMAIN.strip()
        if not domain:
            return ""
        # Strip query params if present
        if "?" in domain:
            domain = domain.split("?")[0]
        # Ensure https prefix
        if not domain.startswith("http"):
            domain = f"https://{domain}"
        return domain.rstrip("/")


settings = Settings()
