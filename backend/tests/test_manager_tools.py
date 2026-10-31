import pytest

from app.manager_tools import upsert_manager
from app.models import User
from app.security import hash_password

PASS = "Strong-pass-123"


async def _login(client, login, password):
    return await client.post("/auth/manager-login", params={"login": login, "password": password})


@pytest.mark.asyncio
async def test_create_and_login(client, db_session):
    await upsert_manager(db_session, "mgr_tool1", PASS)
    r = await _login(client, "mgr_tool1", PASS)
    assert r.status_code == 200
    assert r.json()["role"] == "manager"


@pytest.mark.asyncio
async def test_password_change(client, db_session):
    await upsert_manager(db_session, "mgr_tool2", PASS)
    await upsert_manager(db_session, "mgr_tool2", "Another-pass-456")
    assert (await _login(client, "mgr_tool2", PASS)).status_code == 401
    assert (await _login(client, "mgr_tool2", "Another-pass-456")).status_code == 200


@pytest.mark.asyncio
async def test_short_password_rejected(db_session):
    with pytest.raises(ValueError):
        await upsert_manager(db_session, "mgr_tool3", "short")


@pytest.mark.asyncio
async def test_login_taken_by_non_manager(db_session):
    db_session.add(User(login="orgtool1", kind="org", password_hash=hash_password("x" * 12)))
    await db_session.flush()
    with pytest.raises(ValueError):
        await upsert_manager(db_session, "orgtool1", PASS)
