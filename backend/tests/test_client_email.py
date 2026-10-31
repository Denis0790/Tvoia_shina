import pytest

from app.models import User
from tests.conftest_helpers import register_and_login


async def _manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _walk_in(db_session, phone, name="Иван"):
    user = User(phone=phone, full_name=name, role="client")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.asyncio
async def test_manager_attaches_email_and_client_claims_account(client, db_session):
    mh = await _manager(client, db_session, "+79165559401")
    walk_in = await _walk_in(db_session, "+79165559402")

    r = await client.put(f"/users/clients/{walk_in.id}/email", json={"email": "Ivan@Example.com"}, headers=mh)
    assert r.status_code == 200
    assert r.json()["email"] == "ivan@example.com"

    # пока пароля нет, вход подсказывает, что делать
    r = await client.post("/auth/login", params={"email": "ivan@example.com", "password": "x"})
    assert r.status_code == 401
    assert "Забыли пароль" in r.json()["detail"]

    # клиент подтверждает почту кодом и задаёт пароль (телефон не нужен: аккаунт уже есть)
    code = (await client.post("/auth/request-code", params={"email": "ivan@example.com"})).json()["debug_code"]
    ticket = (await client.post("/auth/verify-code", params={"email": "ivan@example.com", "code": code})).json()["ticket"]
    r = await client.post("/auth/set-password", params={"ticket": ticket, "password": "pass1234"})
    assert r.status_code == 200
    me = (await client.get("/users/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).json()
    assert me["id"] == str(walk_in.id)
    assert me["phone"] == "+79165559402"


@pytest.mark.asyncio
async def test_email_already_used(client, db_session):
    mh = await _manager(client, db_session, "+79165559403")
    a = await _walk_in(db_session, "+79165559404", "А")
    b = await _walk_in(db_session, "+79165559405", "Б")
    assert (await client.put(f"/users/clients/{a.id}/email", json={"email": "same@example.com"}, headers=mh)).status_code == 200
    r = await client.put(f"/users/clients/{b.id}/email", json={"email": "same@example.com"}, headers=mh)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_bad_email_and_unknown_client(client, db_session):
    import uuid

    mh = await _manager(client, db_session, "+79165559406")
    a = await _walk_in(db_session, "+79165559407")
    assert (await client.put(f"/users/clients/{a.id}/email", json={"email": "nope"}, headers=mh)).status_code == 400
    r = await client.put(f"/users/clients/{uuid.uuid4()}/email", json={"email": "x@example.com"}, headers=mh)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_client_cannot_attach_email(client, db_session):
    token = await register_and_login(client, "+79165559408")
    walk_in = await _walk_in(db_session, "+79165559409")
    r = await client.put(
        f"/users/clients/{walk_in.id}/email",
        json={"email": "x2@example.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (401, 403)
