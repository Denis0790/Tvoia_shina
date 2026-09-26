import pytest
from tests.conftest_helpers import register_and_login


@pytest.mark.asyncio
async def test_me_requires_auth(client):
    r = await client.get("/users/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_data(client):
    access_token = await register_and_login(client, "+79261112233")

    r_me = await client.get("/users/me", headers={"Authorization": f"Bearer {access_token}"})
    assert r_me.status_code == 200
    assert r_me.json()["phone"] == "+79261112233"
