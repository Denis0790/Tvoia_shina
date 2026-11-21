import pytest

from app import mailer
from app.config import settings
from app.redis_client import redis_client


async def _register(client, email, phone, password="pass1234"):
    await redis_client.delete(f"otp_cooldown:{email}")  # между запросами кода есть минутная пауза
    code = (await client.post("/auth/request-code", params={"email": email})).json()["debug_code"]
    ticket = (await client.post("/auth/verify-code", params={"email": email, "code": code})).json()["ticket"]
    params = {"ticket": ticket, "password": password}
    if phone is not None:
        params["phone"] = phone
    return await client.post("/auth/set-password", params={"consent": True, **params})


@pytest.mark.asyncio
async def test_register_with_email_and_phone(client):
    r = await _register(client, "newuser1@example.com", "8 916 555-93-01")
    assert r.status_code == 200
    me = (await client.get("/users/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).json()
    assert me["email"] == "newuser1@example.com"
    assert me["phone"] == "+79165559301"
    # вход по почте и паролю, регистр букв не важен
    r = await client.post("/auth/login", params={"email": "NewUser1@Example.com", "password": "pass1234"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_phone_required_for_new_account(client):
    r = await _register(client, "newuser2@example.com", None)
    assert r.status_code == 400
    assert "телефон" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_phone_already_taken(client):
    assert (await _register(client, "newuser3@example.com", "+79165559303")).status_code == 200
    r = await _register(client, "newuser4@example.com", "+79165559303")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_bad_email_rejected(client):
    for bad in ("nope", "a@b", "@x.ru", "a b@x.ru"):
        r = await client.post("/auth/request-code", params={"email": bad})
        assert r.status_code == 400


@pytest.mark.asyncio
async def test_unknown_email_login_404(client):
    r = await client.post("/auth/login", params={"email": "nobody@example.com", "password": "x"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_password_reset_needs_no_phone(client):
    assert (await _register(client, "newuser5@example.com", "+79165559305")).status_code == 200
    r = await _register(client, "newuser5@example.com", None, password="newpass99")
    assert r.status_code == 200
    assert (await client.post("/auth/login", params={"email": "newuser5@example.com", "password": "pass1234"})).status_code == 401
    assert (await client.post("/auth/login", params={"email": "newuser5@example.com", "password": "newpass99"})).status_code == 200


@pytest.mark.asyncio
async def test_code_goes_by_email_without_debug(client, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "otp_debug", False)
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(mailer, "_send_sync", lambda to, subject, text, html=None: sent.append((to, subject, text)))

    r = await client.post("/auth/request-code", params={"email": "mailuser1@example.com"})
    assert r.status_code == 200
    assert "debug_code" not in r.text
    assert len(sent) == 1 and sent[0][0] == "mailuser1@example.com"
    code = [w for w in sent[0][2].split() if w.isdigit() and len(w) == 6][0]

    r = await client.post("/auth/verify-code", params={"email": "mailuser1@example.com", "code": code})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_mail_failure_gives_503(client, monkeypatch):
    def boom(to, subject, text):
        raise OSError("smtp down")

    monkeypatch.setattr(settings, "otp_debug", False)
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(mailer, "_send_sync", boom)
    r = await client.post("/auth/request-code", params={"email": "mailuser2@example.com"})
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_code_burns_after_5_wrong_attempts(client):
    email = "brute@example.com"
    await redis_client.delete(f"otp_cooldown:{email}")
    code = (await client.post("/auth/request-code", params={"email": email})).json()["debug_code"]
    wrong = "111111" if code != "111111" else "222222"
    for _ in range(5):
        r = await client.post("/auth/verify-code", params={"email": email, "code": wrong})
        assert r.status_code == 400
    # код сгорел: даже верный больше не подходит
    r = await client.post("/auth/verify-code", params={"email": email, "code": code})
    assert r.status_code == 400
    # новый запрос выдаёт новый рабочий код
    await redis_client.delete(f"otp_cooldown:{email}")
    code2 = (await client.post("/auth/request-code", params={"email": email})).json()["debug_code"]
    assert (await client.post("/auth/verify-code", params={"email": email, "code": code2})).status_code == 200
