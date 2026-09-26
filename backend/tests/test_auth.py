import pytest
from tests.conftest_helpers import register_and_login


@pytest.mark.asyncio
async def test_registration_and_login_cycle(client):
    phone = "+79161234567"

    # Регистрация: код -> ticket -> пароль
    r = await client.post("/auth/request-code", params={"phone": phone})
    assert r.status_code == 200
    code = r.json()["debug_code"]

    r_bad_code = await client.post("/auth/verify-code", params={"phone": phone, "code": "000000"})
    assert r_bad_code.status_code == 400

    r = await client.post("/auth/verify-code", params={"phone": phone, "code": code})
    assert r.status_code == 200
    ticket = r.json()["ticket"]

    r = await client.post("/auth/set-password", params={"ticket": ticket, "password": "mypassword"})
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert "refresh_token" in r.cookies

    # Просроченный/использованный ticket больше не работает
    r_reuse = await client.post("/auth/set-password", params={"ticket": ticket, "password": "another"})
    assert r_reuse.status_code == 400

    # Обычный вход по телефону + паролю
    r_login = await client.post("/auth/login", params={"phone": phone, "password": "mypassword"})
    assert r_login.status_code == 200
    assert "access_token" in r_login.json()

    r_wrong = await client.post("/auth/login", params={"phone": phone, "password": "wrong"})
    assert r_wrong.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_account(client):
    r = await client.post("/auth/login", params={"phone": "+79999999999", "password": "x"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_refresh_and_logout(client):
    access_token = await register_and_login(client, "+79031234455")
    assert access_token

    r_refresh = await client.post("/auth/refresh")
    assert r_refresh.status_code == 200
    assert "access_token" in r_refresh.json()

    r_logout = await client.post("/auth/logout")
    assert r_logout.status_code == 200

    r_refresh_after = await client.post("/auth/refresh")
    assert r_refresh_after.status_code == 401
