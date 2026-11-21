from datetime import datetime

import pytest
from sqlalchemy import select

from app import push
from app.config import settings
from app.models import Booking, Post, User
from app.models.push import PushSubscription
from app.reminders import send_due_reminders
from tests.conftest_helpers import register_and_login

GOOD = "https://fcm.googleapis.com/fcm/send/abc123"


def _sub(endpoint):
    return {"endpoint": endpoint, "keys": {"p256dh": "p" * 20, "auth": "a" * 10}}


@pytest.mark.asyncio
async def test_public_key_requires_setup(client, monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "")
    monkeypatch.setattr(settings, "vapid_private_key", "")
    assert (await client.get("/push/public-key")).status_code == 404
    monkeypatch.setattr(settings, "vapid_public_key", "PUB")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIV")
    r = await client.get("/push/public-key")
    assert r.status_code == 200
    assert r.json()["key"] == "PUB"


@pytest.mark.asyncio
async def test_subscribe_unsubscribe_and_endpoint_allowlist(client, db_session):
    assert (await client.post("/push/subscribe", json=_sub(GOOD))).status_code in (401, 403)
    token = await register_and_login(client, "+79165558801")
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.post("/push/subscribe", json=_sub("https://evil.example.com/x"), headers=headers)).status_code == 400
    assert (await client.post("/push/subscribe", json=_sub("http://127.0.0.1:8000/x"), headers=headers)).status_code == 400
    assert (await client.post("/push/subscribe", json=_sub(GOOD), headers=headers)).status_code == 200
    assert (await client.post("/push/subscribe", json=_sub(GOOD), headers=headers)).status_code == 200
    rows = (await db_session.execute(select(PushSubscription).where(PushSubscription.endpoint == GOOD))).scalars().all()
    assert len(rows) == 1
    assert (await client.post("/push/unsubscribe", json={"endpoint": GOOD}, headers=headers)).status_code == 200
    rows = (await db_session.execute(select(PushSubscription).where(PushSubscription.endpoint == GOOD))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_reminders_sent_once_within_window(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "PUB")
    monkeypatch.setattr(settings, "vapid_private_key", "PRIV")
    sent = []
    monkeypatch.setattr(
        push, "notify_users", lambda ids, title, body, url="/", tag=None: sent.append((list(ids), title, body))
    )

    await register_and_login(client, "+79165558802")
    user = (await db_session.execute(select(User).where(User.phone == "+79165558802"))).scalar_one()
    post = Post(name="Пост напоминания", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    base = dict(user_id=user.id, post_id=post.id, duration_minutes=60)
    db_session.add_all(
        [
            Booking(date=datetime(2030, 1, 11), start_time="09:00", status="confirmed", **base),
            Booking(date=datetime(2030, 1, 13), start_time="09:00", status="confirmed", **base),
            Booking(date=datetime(2030, 1, 11), start_time="11:00", status="pending", **base),
        ]
    )
    await db_session.flush()

    now = datetime(2030, 1, 10, 9, 0)
    assert await send_due_reminders(db_session, now) == 1
    assert len(sent) == 1
    assert sent[0][0] == [user.id]
    assert "завтра" in sent[0][2] and "09:00" in sent[0][2]
    assert await send_due_reminders(db_session, now) == 0
