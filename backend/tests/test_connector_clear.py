"""A saved connector value can be removed; a blank secret still means "keep it"."""
from bson import ObjectId

from app.services import connector_settings_service as connectors


async def _org(db) -> str:
    result = await db.organizations.insert_one({"name": "Acme", "connectors": {}})
    return str(result.inserted_id)


async def test_blank_secret_keeps_the_saved_value(db):
    org_id = await _org(db)
    await connectors.update(db, org_id, {"github": {"token": "ghp_saved_value_1234"}})
    view = await connectors.update(db, org_id, {"github": {"token": "", "repo_id": "o/r"}})
    assert view["github"]["token"]["configured"] is True
    assert view["github"]["token"]["masked"].endswith("1234")
    assert view["github"]["repo_id"] == "o/r"


async def test_clear_removes_only_the_named_saved_value(db, monkeypatch):
    monkeypatch.setattr(connectors.settings, "GITHUB_TOKEN", "")
    org_id = await _org(db)
    await connectors.update(db, org_id, {
        "github": {"token": "ghp_saved_value_1234", "repo_id": "o/r"},
        "slack": {"webhook_url": "https://hooks.slack.example/T/B/x"},
    })
    view = await connectors.update(db, org_id, {"clear": {"github": ["token"]}})
    assert view["github"]["token"] == {"configured": False, "masked": None, "source": "none"}
    assert view["github"]["repo_id"] == "o/r"
    assert view["slack"]["webhook_url"]["configured"] is True
    stored = await db.organizations.find_one({"_id": ObjectId(org_id)})
    assert "token" not in stored["connectors"]["github"]


async def test_clearing_falls_back_to_the_server_value_for_a_platform_org(db, monkeypatch):
    monkeypatch.setattr(connectors.settings, "GITHUB_TOKEN", "ghp_from_server_env_9999")
    org_id = await _org(db)
    await connectors.update(db, org_id, {"github": {"token": "ghp_org_value_1111"}})
    await connectors.update(db, org_id, {"clear": {"github": ["token"]}})
    view = connectors.public_view(await connectors.get_raw(db, org_id), platform=True)
    assert view["github"]["token"]["source"] == "env"
    assert view["github"]["token"]["masked"].endswith("9999")


async def test_clear_ignores_unknown_connectors_and_malformed_input(db):
    org_id = await _org(db)
    await connectors.update(db, org_id, {"jira": {"domain": "acme.atlassian.net"}})
    view = await connectors.update(db, org_id, {"clear": {"nope": ["x"], "jira": "domain", "github": [7]}})
    assert view["jira"]["domain"] == "acme.atlassian.net"


async def test_clear_through_the_api(app_client, db):
    from tests.test_ci_metrics import _login

    await _login(app_client, db)
    saved = await app_client.put("/api/orgs/current/connectors", json={"jira": {"domain": "acme.atlassian.net", "token": "jira-token-abcd"}})
    assert saved.status_code == 200 and saved.json()["jira"]["token"]["source"] == "org"
    cleared = await app_client.put("/api/orgs/current/connectors", json={"clear": {"jira": ["token", "domain"]}})
    body = cleared.json()
    assert cleared.status_code == 200
    assert body["jira"]["token"]["source"] != "org" and body["jira"]["domain"] in ("", None)
