import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_auth_full_cycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/auth/request-code", params={"phone": "+79161234567"})
        assert r.status_code == 200
        code = r.json()["debug_code"]

        r = await client.post(
            "/auth/verify-code", params={"phone": "+79161234567", "code": code}
        )
        assert r.status_code == 200
        assert "access_token" in r.json()
        assert "refresh_token" in r.cookies

        r_bad = await client.post(
            "/auth/verify-code", params={"phone": "+79161234567", "code": "000000"}
        )
        assert r_bad.status_code == 400

        r_refresh = await client.post("/auth/refresh")
        assert r_refresh.status_code == 200
        assert "access_token" in r_refresh.json()


@pytest.mark.asyncio
async def test_logout_revokes_refresh_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/auth/request-code", params={"phone": "+79031234455"})
        code = r.json()["debug_code"]
        await client.post("/auth/verify-code", params={"phone": "+79031234455", "code": code})

        r_logout = await client.post("/auth/logout")
        assert r_logout.status_code == 200

        r_refresh = await client.post("/auth/refresh")
        assert r_refresh.status_code == 401
