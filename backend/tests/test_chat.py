import asyncio
import json
import uuid

import pytest

from app.models import User
from app.redis_client import redis_client
from tests.conftest_helpers import register_and_login


async def _client(client, phone):
    token = await register_and_login(client, phone)
    headers = {"Authorization": f"Bearer {token}"}
    me = (await client.get("/users/me", headers=headers)).json()
    return headers, me["id"]


async def _manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _conv(client, headers):
    r = await client.get("/chat/conversations/mine", headers=headers)
    assert r.status_code == 200
    return r.json()["id"]


async def _send(client, headers, conv_id, text, **extra):
    return await client.post(f"/chat/conversations/{conv_id}/messages", json={"text": text, **extra}, headers=headers)


@pytest.mark.asyncio
async def test_client_and_manager_exchange_messages(client, db_session):
    ch, _ = await _client(client, "+79165559001")
    mh = await _manager(client, db_session, "+79165559002")
    conv_id = await _conv(client, ch)

    r = await _send(client, ch, conv_id, "  Здравствуйте, нужна замена колодок  ")
    assert r.status_code == 200
    first = r.json()
    assert first["text"] == "Здравствуйте, нужна замена колодок"
    assert first["sender_role"] == "client"
    assert first["read"] is False

    listing = (await client.get("/chat/conversations", headers=mh)).json()
    item = [c for c in listing if c["id"] == conv_id][0]
    assert item["unread"] == 1
    assert item["last_message"].startswith("Здравствуйте")

    counters = (await client.get("/chat/counters", headers=mh)).json()
    assert counters["unread_messages"] >= 1 and counters["unread_dialogs"] >= 1

    reply = await _send(client, mh, conv_id, "Добрый день, приезжайте завтра", reply_to_id=first["id"])
    assert reply.status_code == 200
    assert reply.json()["reply_to"]["id"] == first["id"]
    assert reply.json()["sender_role"] == "manager"

    assert (await client.get("/chat/counters", headers=ch)).json()["unread_messages"] == 1
    assert (await client.get("/chat/conversations/mine", headers=ch)).json()["unread"] == 1

    assert (await client.post(f"/chat/conversations/{conv_id}/read", headers=ch)).status_code == 200
    assert (await client.get("/chat/counters", headers=ch)).json()["unread_messages"] == 0

    history = (await client.get(f"/chat/conversations/{conv_id}/messages", headers=mh)).json()["messages"]
    assert [m["sender_role"] for m in history] == ["client", "manager"]
    assert history[1]["read"] is True  # клиент прочитал ответ
    assert history[0]["read"] is False  # менеджер ещё не открывал

    await client.post(f"/chat/conversations/{conv_id}/read", headers=mh)
    history = (await client.get(f"/chat/conversations/{conv_id}/messages", headers=ch)).json()["messages"]
    assert history[0]["read"] is True


@pytest.mark.asyncio
async def test_duplicate_client_msg_id_and_validation(client, db_session):
    ch, _ = await _client(client, "+79165559011")
    conv_id = await _conv(client, ch)

    a = await _send(client, ch, conv_id, "Привет", client_msg_id="abc-1")
    b = await _send(client, ch, conv_id, "Привет", client_msg_id="abc-1")
    assert a.json()["id"] == b.json()["id"]
    history = (await client.get(f"/chat/conversations/{conv_id}/messages", headers=ch)).json()["messages"]
    assert len(history) == 1

    assert (await _send(client, ch, conv_id, "   ")).status_code == 422
    assert (await _send(client, ch, conv_id, "я" * 4001)).status_code == 422
    assert (await _send(client, ch, conv_id, "ответ", reply_to_id=str(uuid.uuid4()))).status_code == 400


@pytest.mark.asyncio
async def test_access_rules(client, db_session):
    ch1, _ = await _client(client, "+79165559021")
    ch2, _ = await _client(client, "+79165559022")
    mh = await _manager(client, db_session, "+79165559023")
    conv1 = await _conv(client, ch1)

    assert (await _send(client, ch2, conv1, "чужой диалог")).status_code == 404
    assert (await client.get(f"/chat/conversations/{conv1}/messages", headers=ch2)).status_code == 404
    assert (await client.get("/chat/conversations", headers=ch1)).status_code == 403
    assert (await client.get("/chat/conversations/mine", headers=mh)).status_code == 403
    assert (await client.get("/chat/conversations/mine")).status_code == 401


@pytest.mark.asyncio
async def test_edit_and_delete_only_own_messages(client, db_session):
    ch, _ = await _client(client, "+79165559031")
    mh = await _manager(client, db_session, "+79165559032")
    conv_id = await _conv(client, ch)
    msg = (await _send(client, ch, conv_id, "Первый вариант")).json()

    assert (await client.patch(f"/chat/messages/{msg['id']}", json={"text": "Чужое"}, headers=mh)).status_code == 403
    edited = await client.patch(f"/chat/messages/{msg['id']}", json={"text": "Исправленный текст"}, headers=ch)
    assert edited.status_code == 200
    assert edited.json()["text"] == "Исправленный текст"
    assert edited.json()["edited_at"] is not None

    deleted = await client.delete(f"/chat/messages/{msg['id']}", headers=ch)
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True and deleted.json()["text"] is None
    assert (await client.patch(f"/chat/messages/{msg['id']}", json={"text": "ещё"}, headers=ch)).status_code == 409

    history = (await client.get(f"/chat/conversations/{conv_id}/messages", headers=mh)).json()["messages"]
    assert history[0]["deleted"] is True and history[0]["text"] is None


@pytest.mark.asyncio
async def test_history_pagination_and_search(client, db_session):
    ch, _ = await _client(client, "+79165559041")
    mh = await _manager(client, db_session, "+79165559042")
    conv_id = await _conv(client, ch)
    for i in range(5):
        assert (await _send(client, ch, conv_id, f"сообщение {i}")).status_code == 200

    page1 = (await client.get(f"/chat/conversations/{conv_id}/messages", params={"limit": 2}, headers=ch)).json()
    assert [m["text"] for m in page1["messages"]] == ["сообщение 3", "сообщение 4"]
    assert page1["has_more"] is True

    page2 = (
        await client.get(
            f"/chat/conversations/{conv_id}/messages",
            params={"limit": 2, "before_id": page1["messages"][0]["id"]},
            headers=ch,
        )
    ).json()
    assert [m["text"] for m in page2["messages"]] == ["сообщение 1", "сообщение 2"]

    found = (await client.get("/chat/conversations", params={"q": "9165559041"}, headers=mh)).json()
    assert [c["id"] for c in found] == [conv_id]
    assert (await client.get("/chat/conversations", params={"q": "нет-такого"}, headers=mh)).json() == []


@pytest.mark.asyncio
async def test_manager_can_open_dialog_with_client(client, db_session):
    ch, client_id = await _client(client, "+79165559051")
    mh = await _manager(client, db_session, "+79165559052")

    opened = await client.post(f"/chat/conversations/with/{client_id}", headers=mh)
    assert opened.status_code == 200
    conv_id = opened.json()["id"]
    assert opened.json()["client"]["phone"] == "+79165559051"

    # пустой диалог в списке не показываем, пока нет сообщений
    assert conv_id not in [c["id"] for c in (await client.get("/chat/conversations", headers=mh)).json()]
    await _send(client, mh, conv_id, "Здравствуйте! Ваш автомобиль готов")
    assert conv_id in [c["id"] for c in (await client.get("/chat/conversations", headers=mh)).json()]
    assert (await client.get("/chat/conversations/mine", headers=ch)).json()["unread"] == 1


async def _next_event(pubsub, timeout=3.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        m = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
        if m:
            return json.loads(m["data"])
    return None


@pytest.mark.asyncio
async def test_new_message_is_published_for_client_and_managers(client, db_session):
    ch, client_id = await _client(client, "+79165559061")
    mh = await _manager(client, db_session, "+79165559062")
    conv_id = await _conv(client, ch)

    client_sub = redis_client.pubsub()
    manager_sub = redis_client.pubsub()
    await client_sub.subscribe(f"chat:c:{client_id}")
    await manager_sub.subscribe("chat:managers")
    try:
        await _send(client, mh, conv_id, "Ждём вас завтра в 10:00")
        for sub in (client_sub, manager_sub):
            event = await _next_event(sub)
            assert event is not None
            assert event["type"] == "message"
            assert event["message"]["text"] == "Ждём вас завтра в 10:00"
            assert event["client_unread"] == 1
    finally:
        await client_sub.aclose()
        await manager_sub.aclose()


@pytest.mark.asyncio
async def test_reactions(client, db_session):
    ch, _ = await _client(client, "+79165559071")
    mh = await _manager(client, db_session, "+79165559072")
    other, _ = await _client(client, "+79165559073")
    conv_id = await _conv(client, ch)
    msg = (await _send(client, ch, conv_id, "Привет")).json()
    url = f"/chat/messages/{msg['id']}/reaction"

    r = await client.put(url, json={"emoji": "👍"}, headers=mh)
    assert r.status_code == 200
    assert [(x["emoji"], x["role"]) for x in r.json()["reactions"]] == [("👍", "manager")]

    await client.put(url, json={"emoji": "❤"}, headers=ch)  # без селектора варианта — тоже ❤️
    r = await client.put(url, json={"emoji": "👍"}, headers=ch)  # заменила ❤️ на 👍
    assert sorted(x["emoji"] for x in r.json()["reactions"]) == ["👍", "👍"]

    r = await client.put(url, json={"emoji": "👍"}, headers=ch)  # повтор снимает
    assert [x["role"] for x in r.json()["reactions"]] == ["manager"]

    assert (await client.put(url, json={"emoji": "🤡"}, headers=ch)).status_code == 400
    assert (await client.put(url, json={"emoji": "👍"}, headers=other)).status_code == 404

    history = (await client.get(f"/chat/conversations/{conv_id}/messages", headers=ch)).json()["messages"]
    assert [x["emoji"] for x in history[0]["reactions"]] == ["👍"]
