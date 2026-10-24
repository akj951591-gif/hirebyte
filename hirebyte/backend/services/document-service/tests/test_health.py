def test_health_ok(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "document-service"}


def test_request_id_is_echoed(client):
    res = client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert res.headers["X-Request-ID"] == "abc-123"


def test_request_id_generated_when_missing(client):
    res = client.get("/health")
    assert len(res.headers["X-Request-ID"]) > 0