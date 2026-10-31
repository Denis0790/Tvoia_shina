import pytest
from sqlalchemy import select

from app.legal import CONSENT_VERSION
from app.models.user import User
from app.redis_client import redis_client

pytestmark = pytest.mark.asyncio


async def _ticket(client, email):
    await redis_client.delete(f"otp_cooldown:{email}")
    code = (await client.post("/auth/request-code", params={"email": email})).json()["debug_code"]
    return (await client.post("/auth/verify-code", params={"email": email, "code": code})).json()["ticket"]


async def test_registration_without_consent_rejected(client, db_session):
    email = "noconsent@example.com"
    ticket = await _ticket(client, email)
    r = await client.post(
        "/auth/set-password", params={"ticket": ticket, "password": "pass1234", "phone": "+79991112233"}
    )
    assert r.status_code == 400
    assert (await db_session.execute(select(User).where(User.email == email))).scalar_one_or_none() is None


async def test_registration_records_consent(client, db_session):
    email = "consent@example.com"
    ticket = await _ticket(client, email)
    r = await client.post(
        "/auth/set-password",
        params={"ticket": ticket, "password": "pass1234", "phone": "+79991112234", "consent": True},
    )
    assert r.status_code == 200
    user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
    assert user.consent_at is not None
    assert user.consent_version == CONSENT_VERSION
    assert user.consent_ip


async def test_missing_consent_keeps_ticket_valid(client, db_session):
    email = "retry@example.com"
    ticket = await _ticket(client, email)
    params = {"ticket": ticket, "password": "pass1234", "phone": "+79991112235"}
    assert (await client.post("/auth/set-password", params=params)).status_code == 400
    assert (await client.post("/auth/set-password", params={**params, "consent": True})).status_code == 200


async def test_manager_created_client_must_consent_on_first_login(client, db_session):
    email = "guest@example.com"
    db_session.add(User(email=email, phone="+79991112236"))
    await db_session.flush()
    ticket = await _ticket(client, email)
    assert (
        await client.post("/auth/set-password", params={"ticket": ticket, "password": "pass1234"})
    ).status_code == 400
    r = await client.post("/auth/set-password", params={"ticket": ticket, "password": "pass1234", "consent": True})
    assert r.status_code == 200
    user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
    assert user.consent_at is not None
