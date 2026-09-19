import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.mark.asyncio
async def test_me_requires_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/users/me")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_data():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post("/auth/request-code", params={"phone": "+79261112233"})
        code = r.json()["debug_code"]

        r = await client.post(
            "/auth/verify-code", params={"phone": "+79261112233", "code": code}
        )
        access_token = r.json()["access_token"]

        r_me = await client.get(
            "/users/me", headers={"Authorization": f"Bearer {access_token}"}
        )
        assert r_me.status_code == 200
        assert r_me.json()["phone"] == "+79261112233"
