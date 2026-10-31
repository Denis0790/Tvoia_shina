import pytest

from app.models import User
from app.redis_client import redis_client
from app.security import hash_password

LIMIT = 10
PASS = "Correct-pass-123"


async def _reset():
    async for key in redis_client.scan_iter(match="login_fail:*"):
        await redis_client.delete(key)


async def _manager(db_session, login):
    db_session.add(User(login=login, role="manager", password_hash=hash_password(PASS)))
    await db_session.flush()


async def _try(client, login, password):
    return await client.post("/auth/manager-login", params={"login": login, "password": password})


@pytest.mark.asyncio
async def test_login_blocked_after_failures(client, db_session):
    await _reset()
    await _manager(db_session, "limit_mgr1")
    for _ in range(LIMIT):
        assert (await _try(client, "limit_mgr1", "wrong")).status_code == 401
    assert (await _try(client, "limit_mgr1", "wrong")).status_code == 429
    # пока блокировка действует, не пускает даже с верным паролем
    assert (await _try(client, "limit_mgr1", PASS)).status_code == 429
    await _reset()


@pytest.mark.asyncio
async def test_success_resets_counter(client, db_session):
    await _reset()
    await _manager(db_session, "limit_mgr2")
    for _ in range(LIMIT - 1):
        assert (await _try(client, "limit_mgr2", "wrong")).status_code == 401
    assert (await _try(client, "limit_mgr2", PASS)).status_code == 200
    for _ in range(LIMIT - 1):
        assert (await _try(client, "limit_mgr2", "wrong")).status_code == 401
    assert (await _try(client, "limit_mgr2", PASS)).status_code == 200
    await _reset()


@pytest.mark.asyncio
async def test_block_is_per_account(client, db_session):
    await _reset()
    await _manager(db_session, "limit_mgr3")
    await _manager(db_session, "limit_mgr4")
    for _ in range(LIMIT):
        await _try(client, "limit_mgr3", "wrong")
    assert (await _try(client, "limit_mgr3", PASS)).status_code == 429
    assert (await _try(client, "limit_mgr4", PASS)).status_code == 200
    await _reset()


@pytest.mark.asyncio
async def test_client_login_limited(client):
    await _reset()
    for _ in range(LIMIT):
        r = await client.post("/auth/login", params={"email": "limit@example.com", "password": "x"})
        assert r.status_code == 404
    r = await client.post("/auth/login", params={"email": "limit@example.com", "password": "x"})
    assert r.status_code == 429
    await _reset()
