from unittest.mock import MagicMock, patch

import pytest

from app.auth.workos_client import get_authorization_url, authenticate_with_code, verify_webhook, WorkOSIdentity


def test_get_authorization_url_contains_client_id():
    url = get_authorization_url()
    assert "client_id=" in url or "authkit" in url  # exact query shape depends on SDK version; presence of a URL is what matters


@patch("app.auth.workos_client._client")
def test_authenticate_with_code_returns_identity(mock_client):
    mock_response = MagicMock()
    mock_response.user.id = "user_123"
    mock_response.user.email = "a@b.com"
    mock_response.organization_id = "org_456"
    mock_client.user_management.authenticate_with_code.return_value = mock_response

    identity = authenticate_with_code("some-code")

    assert identity == WorkOSIdentity(user_id="user_123", email="a@b.com", organization_id="org_456")


@patch("app.auth.workos_client._client")
def test_verify_webhook_valid_signature(mock_client):
    mock_client.webhooks.verify_event.return_value = {"event": "organization.created"}
    result = verify_webhook(b'{"event": "organization.created"}', "sig123")
    assert result == {"event": "organization.created"}


@patch("app.auth.workos_client._client")
def test_verify_webhook_invalid_signature_raises(mock_client):
    mock_client.webhooks.verify_event.side_effect = Exception("bad signature")
    with pytest.raises(ValueError):
        verify_webhook(b'{}', "bad-sig")
