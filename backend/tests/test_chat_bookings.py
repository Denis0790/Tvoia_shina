import uuid
from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.models import Booking, User
from app.models.chat import Conversation
from app.routers.bookings import _notify_booking
from tests.conftest_helpers import register_and_login


async def _client_user(client, phone):
    token = await register_and_login(client, phone)
    headers = {"Authorization": f"Bearer {token}"}
    me = (await client.get("/users/me", headers=headers)).json()
    return headers, uuid.UUID(me["id"])


async def _manager_user(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    user = (await db_session.execute(select(User).where(User.phone == phone))).scalar_one()
    return {"Authorization": f"Bearer {token}"}, user


def _booking(user_id, day=15, start="10:00", status="confirmed", **extra):
    return Booking(
        user_id=user_id, date=datetime(2030, 1, day), start_time=start, duration_minutes=60, status=status, **extra
    )


@pytest.mark.asyncio
async def test_confirmation_with_comment_goes_to_client_chat(client, db_session):
    ch, client_id = await _client_user(client, "+79165558001")
    mh, manager = await _manager_user(client, db_session, "+79165558002")
    b = _booking(client_id, comment="Скрипит колодка")
    db_session.add(b)
    await db_session.flush()

    await _notify_booking(
        db_session, "confirmed", booking_id=b.id, actor="manager", actor_user=manager,
        note="Ждём вас, привезите ключи от секреток",
    )

    conv = (await client.get("/chat/conversations/mine", headers=ch)).json()
    assert conv["unread"] == 1
    msgs = (await client.get(f"/chat/conversations/{conv['id']}/messages", headers=ch)).json()["messages"]
    assert len(msgs) == 1
    m = msgs[0]
    assert m["kind"] == "booking" and m["sender_role"] == "manager"
    assert m["text"].startswith("Запись подтверждена")
    assert "Когда: 15 января (вт), 10:00" in m["text"]
    assert "Комментарий сервиса: Ждём вас, привезите ключи от секреток" in m["text"]

    listing = (await client.get("/chat/conversations", headers=mh)).json()
    assert any(c["id"] == conv["id"] and c["last_message"].startswith("Запись подтверждена") for c in listing)

    # карточку записи нельзя править как обычное сообщение
    manager_msg_edit = await client.patch(f"/chat/messages/{m['id']}", json={"text": "x"}, headers=mh)
    assert manager_msg_edit.status_code == 409


@pytest.mark.asyncio
async def test_guest_without_account_gets_no_chat(client, db_session):
    _, manager = await _manager_user(client, db_session, "+79165558012")
    guest = User(phone="+79165558011", full_name="Гость", role="client")
    db_session.add(guest)
    await db_session.flush()
    b = _booking(guest.id)
    db_session.add(b)
    await db_session.flush()

    await _notify_booking(db_session, "confirmed", booking_id=b.id, actor="manager", actor_user=manager)

    count = (
        await db_session.execute(select(func.count()).select_from(Conversation).where(Conversation.client_id == guest.id))
    ).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_new_booking_is_duplicated_to_managers(client, db_session):
    ch, client_id = await _client_user(client, "+79165558021")
    mh, _ = await _manager_user(client, db_session, "+79165558022")
    b = _booking(client_id, status="pending", comment="Нужна проценка запчастей")
    db_session.add(b)
    await db_session.flush()

    await _notify_booking(db_session, "new", booking_id=b.id, actor="client")

    conv = (await client.get("/chat/conversations/mine", headers=ch)).json()
    assert conv["unread"] == 0  # своё действие клиенту непрочитанным не считается
    msgs = (await client.get(f"/chat/conversations/{conv['id']}/messages", headers=mh)).json()["messages"]
    assert msgs[0]["kind"] == "booking" and msgs[0]["sender_role"] == "client"
    assert msgs[0]["text"].startswith("Новая запись")
    assert "Комментарий: Нужна проценка запчастей" in msgs[0]["text"]
    listing = (await client.get("/chat/conversations", headers=mh)).json()
    item = [c for c in listing if c["id"] == conv["id"]][0]
    assert item["unread"] == 1


@pytest.mark.asyncio
async def test_pending_days_counts_only_pending_requests(client, db_session):
    _, client_id = await _client_user(client, "+79165558031")
    mh, _ = await _manager_user(client, db_session, "+79165558032")
    db_session.add_all(
        [
            _booking(client_id, 15, "10:00", "pending"),
            _booking(client_id, 15, "11:00", "pending"),
            _booking(client_id, 16, "10:00", "pending"),
            _booking(client_id, 17, "10:00", "confirmed"),
            _booking(client_id, 18, "10:00", "pending", part=1, group_id=uuid.uuid4()),
        ]
    )
    await db_session.flush()

    r = await client.get("/bookings/pending-days", params={"start": "2030-01-14", "days": 7}, headers=mh)
    assert r.status_code == 200
    assert r.json() == {"2030-01-15": 2, "2030-01-16": 1}

    cl, _ = await _client_user(client, "+79165558033")
    assert (await client.get("/bookings/pending-days", params={"start": "2030-01-14"}, headers=cl)).status_code == 403


@pytest.mark.asyncio
async def test_conversation_bookings_reminder(client, db_session):
    ch, client_id = await _client_user(client, "+79165558041")
    mh, _ = await _manager_user(client, db_session, "+79165558042")
    oh, other_id = await _client_user(client, "+79165558043")
    db_session.add_all(
        [
            _booking(client_id, 16, "11:00", "pending"),
            _booking(client_id, 15, "10:00", "confirmed"),
            _booking(client_id, 17, "12:00", "cancelled"),
            _booking(other_id, 15, "13:00", "confirmed"),
        ]
    )
    await db_session.flush()
    conv = (await client.get("/chat/conversations/mine", headers=ch)).json()

    for headers in (ch, mh):
        r = await client.get(f"/chat/conversations/{conv['id']}/bookings", headers=headers)
        assert r.status_code == 200
        assert [(b["date"], b["start_time"], b["status"]) for b in r.json()] == [
            ("2030-01-15", "10:00", "confirmed"),
            ("2030-01-16", "11:00", "pending"),
        ]
    assert (await client.get(f"/chat/conversations/{conv['id']}/bookings", headers=oh)).status_code == 404


@pytest.mark.asyncio
async def test_client_cancel_notifies_managers(client, db_session):
    ch, client_id = await _client_user(client, "+79165558051")
    mh, _ = await _manager_user(client, db_session, "+79165558052")
    b = _booking(client_id, 15, "10:00", "confirmed")
    db_session.add(b)
    await db_session.flush()

    r = await client.post(f"/bookings/{b.id}/cancel-mine", headers=ch)
    assert r.status_code == 200

    conv = (await client.get("/chat/conversations/mine", headers=ch)).json()
    msgs = (await client.get(f"/chat/conversations/{conv['id']}/messages", headers=mh)).json()["messages"]
    assert msgs[-1]["sender_role"] == "client"
    assert msgs[-1]["text"].startswith("Запись отменена клиентом")
    listing = (await client.get("/chat/conversations", headers=mh)).json()
    assert [c for c in listing if c["id"] == conv["id"]][0]["unread"] == 1
