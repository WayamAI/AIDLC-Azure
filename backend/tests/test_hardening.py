"""Process-wide limits and request guards."""
import asyncio
import threading

import pytest

from app.routes import ai_ide
from app.services import playwright_service


class _FakeBrowser:
    def __init__(self):
        self._handlers = []

    def on(self, event, handler):
        assert event == "disconnected"
        self._handlers.append(handler)

    def disconnect(self):
        for handler in self._handlers:
            handler(self)


class _FakeChromium:
    def __init__(self, fail=False):
        self.fail = fail

    async def launch(self, **kwargs):
        if self.fail:
            raise RuntimeError("no browser")
        return _FakeBrowser()


class _FakePlaywright:
    def __init__(self, fail=False):
        self.chromium = _FakeChromium(fail)


@pytest.mark.anyio
async def test_browser_slots_cap_concurrent_launches(monkeypatch):
    monkeypatch.setattr(playwright_service, "_BROWSER_SLOTS", threading.BoundedSemaphore(2))
    first = await playwright_service.launch_chromium(_FakePlaywright())
    second = await playwright_service.launch_chromium(_FakePlaywright())

    third = asyncio.create_task(playwright_service.launch_chromium(_FakePlaywright()))
    await asyncio.sleep(0.2)
    assert not third.done()          # both slots are taken

    first.disconnect()               # closing (or crashing) a browser frees its slot
    assert isinstance(await asyncio.wait_for(third, 2), _FakeBrowser)
    first.disconnect()               # a second disconnect must not release twice
    second.disconnect()


@pytest.mark.anyio
async def test_failed_launch_returns_its_slot(monkeypatch):
    monkeypatch.setattr(playwright_service, "_BROWSER_SLOTS", threading.BoundedSemaphore(1))
    with pytest.raises(RuntimeError):
        await playwright_service.launch_chromium(_FakePlaywright(fail=True))
    browser = await asyncio.wait_for(playwright_service.launch_chromium(_FakePlaywright()), 2)
    browser.disconnect()


class _Socket:
    def __init__(self, headers):
        self.headers = headers


def test_socket_origin_must_be_the_app(monkeypatch):
    monkeypatch.setattr(ai_ide.settings, "FRONTEND_URL", "https://chakram.example")
    monkeypatch.setattr(ai_ide.settings, "CORS_ORIGINS", ["https://other-allowed.example"])
    ok = ai_ide._ws_origin_allowed
    assert ok(_Socket({"origin": "https://chakram.example", "host": "api.internal"}))
    assert ok(_Socket({"origin": "https://other-allowed.example", "host": "api.internal"}))
    assert ok(_Socket({"origin": "http://localhost:8081", "host": "localhost:8081"}))   # same origin
    assert ok(_Socket({"host": "localhost:8001"}))                                      # non-browser client
    assert not ok(_Socket({"origin": "https://evil.example", "host": "chakram.example"}))


@pytest.mark.anyio
async def test_slow_request_gets_a_readable_504(app_client, monkeypatch):
    import main

    monkeypatch.setattr(main.settings, "REQUEST_TIMEOUT_SECONDS", 0.2)

    async def _slow():
        await asyncio.sleep(2)
        return {"status": "late"}

    route = next(r for r in main.app.routes if getattr(r, "path", "") == "/api")
    original = route.dependant.call
    route.dependant.call = _slow
    try:
        resp = await app_client.get("/api")
    finally:
        route.dependant.call = original
    assert resp.status_code == 504
    assert "took too long" in resp.json()["detail"]
