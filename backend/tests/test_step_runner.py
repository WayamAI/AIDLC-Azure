"""playwright_service._run_step against a fake page: screenshots on request, and no step passes by doing nothing."""
import pytest

from app.services import playwright_service


class FakeLocator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    @property
    def first(self):
        return self

    async def _act(self, name, *args, **_kwargs):
        if self.selector in self.page.broken:
            raise RuntimeError(f"Timeout waiting for {self.selector}")
        self.page.calls.append((name, self.selector, *args))

    async def click(self, **kw):
        await self._act("click")

    async def fill(self, value, **kw):
        await self._act("fill", value)

    async def hover(self, **kw):
        await self._act("hover")

    async def wait_for(self, **kw):
        if self.selector in self.page.broken or self.selector in self.page.absent:
            raise RuntimeError("not there")

    async def count(self):
        return 0 if self.selector in self.page.absent else 1

    async def scroll_into_view_if_needed(self, **kw):
        pass


class FakePage:
    url = "http://app.test/"

    def __init__(self, broken=(), absent=()):
        self.calls: list[tuple] = []
        self.screenshots = 0
        self.broken, self.absent = set(broken), set(absent)
        self.keyboard = self

    def locator(self, selector):
        return FakeLocator(self, selector)

    async def press(self, key):  # page.keyboard.press
        self.calls.append(("key", key))

    async def goto(self, url, **kw):
        self.calls.append(("goto", url))

    async def wait_for_load_state(self, state, **kw):
        pass

    async def wait_for_selector(self, selector, **kw):
        pass

    async def evaluate(self, script, *args):
        return False  # the JS fallbacks find nothing

    async def screenshot(self, **kw):
        self.screenshots += 1
        return b"x" * 4096


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    slept: list[float] = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(playwright_service.asyncio, "sleep", fake_sleep)
    return slept


async def _step(page, step, **kwargs):
    return await playwright_service._run_step(page, step, "http://app.test", "run", "test", 1, **kwargs)


async def test_default_takes_a_screenshot_after_every_step():
    page = FakePage()
    result = await _step(page, {"action": "fill", "selector": "#q", "value": "hi"})
    assert result["status"] == "pass"
    assert page.screenshots == 1 and result["screenshot"]


async def test_on_failure_mode_skips_the_screenshot_and_settle_pauses_for_a_passing_step(_no_sleep):
    page = FakePage()
    result = await _step(page, {"action": "fill", "selector": "#q", "value": "hi"}, screenshot="on_failure")
    assert result["status"] == "pass"
    assert result["screenshot"] is None and page.screenshots == 0
    assert _no_sleep == []


async def test_on_failure_mode_captures_the_failing_step():
    page = FakePage(broken={"#gone"})
    result = await _step(page, {"action": "hover", "selector": "#gone"}, screenshot="on_failure")
    assert result["status"] == "fail" and "Timeout" in result["error"]
    assert page.screenshots == 1 and result["screenshot"]


async def test_never_mode_takes_no_screenshot_even_on_failure():
    page = FakePage(broken={"#gone"})
    result = await _step(page, {"action": "hover", "selector": "#gone"}, screenshot="never")
    assert result["status"] == "fail" and result["screenshot"] is None and page.screenshots == 0


async def test_navigate_keeps_its_render_pause_only_when_a_screenshot_follows(_no_sleep):
    await _step(FakePage(), {"action": "navigate", "value": "/login"}, screenshot="on_failure")
    assert 1.2 not in _no_sleep
    _no_sleep.clear()
    await _step(FakePage(), {"action": "navigate", "value": "/login"})
    assert 1.2 in _no_sleep


@pytest.mark.parametrize("step", [
    {"action": "hover"},
    {"action": "check", "selector": ""},
    {"action": "clear"},
    {"action": "select_option", "selector": "#s"},
    {"action": "press", "selector": "#q"},
    {"action": "type_into", "value": "x"},
])
async def test_a_step_with_nothing_to_act_on_fails_instead_of_passing(step):
    page = FakePage()
    result = await _step(page, step, screenshot="never")
    assert result["status"] == "fail"
    assert "nothing was done" in result["error"]
    assert page.calls == []


async def test_press_without_a_selector_presses_the_key():
    page = FakePage()
    result = await _step(page, {"action": "press", "value": "Enter"}, screenshot="never")
    assert result["status"] == "pass"
    assert page.calls == [("key", "Enter")]


async def test_checkbox_click_that_finds_nothing_is_a_failed_step():
    absent = {
        '[role="checkbox"]:not([disabled])', 'button[role="checkbox"]', '[role="radio"]:not([disabled])',
        '[data-state="unchecked"]', '[data-state="checked"]', '[class*="checkbox"]',
        '[class*="check"]:not(button)', 'input[type="checkbox"]', 'span[data-state]', 'button[data-state]',
        'input[name="checkbox-terms"]',
    }
    page = FakePage(absent=absent)
    result = await _step(page, {"action": "click", "selector": 'input[name="checkbox-terms"]'}, screenshot="never")
    assert result["status"] == "fail"
    assert "checkbox" in result["error"].lower()
