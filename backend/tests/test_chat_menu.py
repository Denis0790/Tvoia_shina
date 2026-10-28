import pytest
from pydantic import ValidationError

from app.models import User
from app.routers.bookings import BookingCreate
from tests.conftest_helpers import register_and_login


async def _client(client, phone):
    token = await register_and_login(client, phone)
    h = {"Authorization": f"Bearer {token}"}
    conv = (await client.get("/chat/conversations/mine", headers=h)).json()["id"]
    return h, conv


async def _manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _say(client, h, conv, text="привет"):
    r = await client.post(f"/chat/conversations/{conv}/messages", json={"text": text}, headers=h)
    assert r.status_code == 200
    return r


async def _list(client, mh):
    return (await client.get("/chat/conversations?limit=100", headers=mh)).json()


async def _unread(client, mh):
    return (await client.get("/chat/counters", headers=mh)).json()["unread_messages"]


def test_comment_limit():
    base = dict(date="2030-01-10", start_time="10:00", service_ids=[])
    assert BookingCreate(**base, comment="x" * 200).comment == "x" * 200
    with pytest.raises(ValidationError):
        BookingCreate(**base, comment="x" * 201)


@pytest.mark.asyncio
async def test_mark_pin_mute(client, db_session):
    a, conv_a = await _client(client, "+79165558001")
    mh = await _manager(client, db_session, "+79165558002")
    base = await _unread(client, mh)

    await _say(client, a, conv_a)
    assert await _unread(client, mh) == base + 1

    r = await client.post(f"/chat/conversations/{conv_a}/mark", json={"unread": False}, headers=mh)
    assert r.status_code == 200 and r.json()["unread"] == 0
    assert await _unread(client, mh) == base
    # отметка «прочитано» клиенту не уходит
    msgs = (await client.get(f"/chat/conversations/{conv_a}/messages", headers=mh)).json()["messages"]
    assert msgs[-1]["read"] is False

    r = await client.post(f"/chat/conversations/{conv_a}/mark", json={"unread": True}, headers=mh)
    assert r.json()["unread"] == 1 and await _unread(client, mh) == base + 1

    # без звука: в счётчик не входит, в списке остаётся
    r = await client.patch(f"/chat/conversations/{conv_a}/settings", json={"muted": True}, headers=mh)
    assert r.json()["muted"] is True
    assert await _unread(client, mh) == base
    item = [c for c in await _list(client, mh) if c["id"] == conv_a][0]
    assert item["muted"] is True and item["unread"] == 1
    await client.patch(f"/chat/conversations/{conv_a}/settings", json={"muted": False}, headers=mh)
    assert await _unread(client, mh) == base + 1

    # закрепление: старый диалог выше нового
    b, conv_b = await _client(client, "+79165558003")
    await _say(client, b, conv_b)
    ids = [c["id"] for c in await _list(client, mh)]
    assert ids.index(conv_b) < ids.index(conv_a)
    await client.patch(f"/chat/conversations/{conv_a}/settings", json={"pinned": True}, headers=mh)
    ids = [c["id"] for c in await _list(client, mh)]
    assert ids.index(conv_a) < ids.index(conv_b)

    # клиент этим пользоваться не может
    assert (await client.post(f"/chat/conversations/{conv_a}/mark", json={"unread": True}, headers=a)).status_code == 403
    assert (await client.patch(f"/chat/conversations/{conv_a}/settings", json={"pinned": False}, headers=a)).status_code == 403


@pytest.mark.asyncio
async def test_block_client(client, db_session):
    ch, conv = await _client(client, "+79165558011")
    mh = await _manager(client, db_session, "+79165558012")
    block = f"/chat/conversations/{conv}/block"

    assert (await client.put(block, json={"blocked": True}, headers=ch)).status_code == 403  # сам себя не блокирует
    r = await client.put(block, json={"blocked": True}, headers=mh)
    assert r.status_code == 200 and r.json()["blocked"] is True
    assert (await client.get("/chat/conversations/mine", headers=ch)).json()["blocked"] is True

    sent = await client.post(f"/chat/conversations/{conv}/messages", json={"text": "привет"}, headers=ch)
    assert sent.status_code == 403 and "позвоните" in sent.json()["detail"]
    up = await client.post(
        f"/chat/conversations/{conv}/attachments", content=b"x", headers={**ch, "Content-Type": "image/jpeg"}
    )
    assert up.status_code == 403
    booking = await client.post(
        "/bookings", json={"date": "2030-01-10", "start_time": "10:00", "service_ids": []}, headers=ch
    )
    assert booking.status_code == 403 and "позвоните" in booking.json()["detail"]

    await _say(client, mh, conv, "ответ менеджера")  # менеджер писать по-прежнему может

    r = await client.put(block, json={"blocked": False}, headers=mh)
    assert r.json()["blocked"] is False
    await _say(client, ch, conv, "снова могу")
