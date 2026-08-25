from app.database import redact_mongo_uri


def test_redact_mongo_uri_strips_password():
    uri = "mongodb+srv://user:s3cret@cluster0.example.net/aidlc"
    redacted = redact_mongo_uri(uri)
    assert "s3cret" not in redacted
    assert "user:***@" in redacted
    assert "cluster0.example.net" in redacted


def test_redact_mongo_uri_leaves_unauthenticated():
    uri = "mongodb://localhost:27017"
    assert redact_mongo_uri(uri) == uri
