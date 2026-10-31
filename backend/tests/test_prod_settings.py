import pytest

from app.config import Settings, check_production, settings


def _s(**kw):
    base = dict(database_url="postgresql+asyncpg://u:p@db/x", redis_url="redis://redis:6379/0")
    base.update(kw)
    return Settings(**base)


def test_dev_defaults_are_allowed():
    check_production(_s())


def test_production_requires_real_secret():
    with pytest.raises(RuntimeError):
        check_production(_s(app_env="production", cookie_secure=True))
    with pytest.raises(RuntimeError):
        check_production(_s(app_env="production", cookie_secure=True, jwt_secret="short"))


def test_production_requires_secure_cookies():
    with pytest.raises(RuntimeError):
        check_production(_s(app_env="production", jwt_secret="x" * 40))


def test_production_ok():
    check_production(_s(app_env="production", jwt_secret="x" * 40, cookie_secure=True))


@pytest.mark.asyncio
async def test_request_code_returns_code_in_debug_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "otp_debug", True)
    r = await client.post("/auth/request-code", params={"email": "debuguser1@example.com"})
    assert r.status_code == 200
    assert r.json()["debug_code"]


@pytest.mark.asyncio
async def test_request_code_hides_code_without_debug(client, monkeypatch):
    monkeypatch.setattr(settings, "otp_debug", False)
    r = await client.post("/auth/request-code", params={"email": "debuguser2@example.com"})
    assert r.status_code == 503
    assert "debug_code" not in r.text


@pytest.mark.asyncio
async def test_cors_only_for_configured_origin(client):
    ok = await client.options(
        "/auth/request-code", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = await client.options(
        "/auth/request-code", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in bad.headers


def test_docs_hidden_in_production():
    from app.config import api_docs_kwargs

    assert api_docs_kwargs("production") == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    assert api_docs_kwargs("dev") == {}


@pytest.mark.asyncio
async def test_docs_available_in_dev(client):
    assert (await client.get("/openapi.json")).status_code == 200


def test_production_requires_mail_unless_debug():
    base = dict(app_env="production", jwt_secret="x" * 40, cookie_secure=True, otp_debug=False)
    with pytest.raises(RuntimeError):
        check_production(_s(**base))
    check_production(_s(smtp_host="smtp.example.ru", **base))
