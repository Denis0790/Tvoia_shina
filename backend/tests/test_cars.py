import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


async def login(client: AsyncClient, phone: str) -> str:
    r = await client.post("/auth/request-code", params={"phone": phone})
    code = r.json()["debug_code"]
    r = await client.post("/auth/verify-code", params={"phone": phone, "code": code})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_car_crud_and_isolation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token_a = await login(client, "+79161110001")
        token_b = await login(client, "+79161110002")

        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}

        r = await client.post(
            "/users/me/cars",
            json={"make": "Kia", "model": "Rio 3", "color": "чёрная"},
            headers=headers_a,
        )
        assert r.status_code == 200
        car_id = r.json()["id"]

        r = await client.get("/users/me/cars", headers=headers_a)
        assert len(r.json()) == 1

        r = await client.get("/users/me/cars", headers=headers_b)
        assert len(r.json()) == 0

        r = await client.delete(f"/users/me/cars/{car_id}", headers=headers_b)
        assert r.status_code == 404

        r = await client.delete(f"/users/me/cars/{car_id}", headers=headers_a)
        assert r.status_code == 200
