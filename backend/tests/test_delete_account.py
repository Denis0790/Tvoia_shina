import pytest
from sqlalchemy import select

from app.media import storage
from app.models.chat import ChatAttachment, Conversation
from app.models.user import User
from tests.conftest_helpers import register_and_login

pytestmark = pytest.mark.asyncio

PHONE = "+79990001234"


async def test_delete_account_removes_data_and_files(client, db_session):
    token = await register_and_login(client, PHONE)
    headers = {"Authorization": f"Bearer {token}"}
    user = (await db_session.execute(select(User).where(User.phone == PHONE))).scalar_one()

    conv = Conversation(client_id=user.id)
    db_session.add(conv)
    await db_session.flush()
    storage.put("del-test/a.webp", b"x")
    db_session.add(ChatAttachment(conversation_id=conv.id, kind="image", main_key="del-test/a.webp"))
    await db_session.flush()

    r = await client.delete("/users/me", headers=headers)
    assert r.status_code == 200
    assert not storage.path("del-test/a.webp").exists()
    db_session.expire_all()
    assert (await db_session.execute(select(User).where(User.phone == PHONE))).scalar_one_or_none() is None
    assert (await db_session.execute(select(Conversation).where(Conversation.client_id == user.id))).first() is None
    assert (await client.get("/users/me", headers=headers)).status_code >= 400


async def test_manager_cannot_delete_account(client, db_session):
    token = await register_and_login(client, PHONE)
    user = (await db_session.execute(select(User).where(User.phone == PHONE))).scalar_one()
    user.role = "manager"
    await db_session.flush()
    r = await client.delete("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
