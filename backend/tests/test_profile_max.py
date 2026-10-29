import pytest

from app.models import User
from tests.conftest_helpers import register_and_login


async def _manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_max_link_saved_and_public(client, db_session):
    mh = await _manager(client, db_session, "+79165559101")
    r = await client.put("/profile", json={"max_link": "  https://max.ru/join/abc  "}, headers=mh)
    assert r.status_code == 200
    assert r.json()["max_link"] == "https://max.ru/join/abc"
    pub = await client.get("/profile")
    assert pub.json()["profile"]["max_link"] == "https://max.ru/join/abc"


@pytest.mark.asyncio
async def test_max_link_rejects_bad_scheme(client, db_session):
    mh = await _manager(client, db_session, "+79165559102")
    for bad in ("javascript:alert(1)", "max.ru/abc", "ftp://x.ru"):
        r = await client.put("/profile", json={"max_link": bad}, headers=mh)
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_max_link_can_be_cleared(client, db_session):
    mh = await _manager(client, db_session, "+79165559103")
    await client.put("/profile", json={"max_link": "https://max.ru/join/abc"}, headers=mh)
    r = await client.put("/profile", json={"max_link": ""}, headers=mh)
    assert r.status_code == 200
    assert r.json()["max_link"] is None


@pytest.mark.asyncio
async def test_max_link_requires_manager(client):
    token = await register_and_login(client, "+79165559104")
    r = await client.put(
        "/profile", json={"max_link": "https://max.ru/join/abc"}, headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code in (401, 403)
