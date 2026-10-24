"""Чат: REST для истории и действий, WebSocket (+Redis pub/sub) для доставки в реальном времени.

Каналы Redis: chat:c:<client_id> — события для конкретного клиента,
chat:managers — события для всех менеджеров. Каждое событие уходит в оба канала,
поэтому свои же вкладки и устройства тоже обновляются."""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_manager
from app.models import Booking, User
from app.models.chat import Conversation, Message
from app.redis_client import redis_client
from app.routers.bookings import _today_msk
from app.security import decode_access_token

router = APIRouter(prefix="/chat", tags=["chat"])

MAX_TEXT = 4000
EDIT_WINDOW = timedelta(hours=24)
PAGE_SIZE = 50
MANAGERS_CHANNEL = "chat:managers"


def _client_channel(client_id) -> str:
    return f"chat:c:{client_id}"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _is_manager(user: User) -> bool:
    return user.role == "manager"


def _side(user: User) -> str:
    return "manager" if _is_manager(user) else "client"


async def _emit(client_id, event: dict) -> None:
    data = json.dumps(event, ensure_ascii=False)
    await redis_client.publish(_client_channel(client_id), data)
    await redis_client.publish(MANAGERS_CHANNEL, data)


def _msg_dict(m: Message, reply: Message | None = None) -> dict:
    deleted = m.deleted_at is not None
    return {
        "id": str(m.id),
        "conversation_id": str(m.conversation_id),
        "sender_role": m.sender_role,
        "kind": m.kind,
        "text": None if deleted else m.text,
        "deleted": deleted,
        "reply_to": (
            {
                "id": str(reply.id),
                "sender_role": reply.sender_role,
                "text": None if reply.deleted_at else (reply.text or "")[:120],
            }
            if reply is not None
            else None
        ),
        "created_at": _iso(m.created_at),
        "edited_at": _iso(m.edited_at),
        "read": m.read_at is not None,
        "client_msg_id": m.client_msg_id,
    }


async def _with_replies(db: AsyncSession, messages: list[Message]) -> list[dict]:
    ids = {m.reply_to_id for m in messages if m.reply_to_id}
    replies: dict = {}
    if ids:
        rows = await db.execute(select(Message).where(Message.id.in_(ids)))
        replies = {r.id: r for r in rows.scalars().all()}
    return [_msg_dict(m, replies.get(m.reply_to_id)) for m in messages]


def _conv_item(conv: Conversation, client: User) -> dict:
    return {
        "id": str(conv.id),
        "client": {
            "id": str(client.id),
            "name": client.full_name or client.phone or client.login or "Клиент",
            "phone": client.phone,
            "login": client.login,
            "is_org": client.kind == "org",
        },
        "last_message": conv.last_message_preview,
        "last_message_at": _iso(conv.last_message_at),
        "unread": conv.manager_unread,
    }


async def _get_or_create_conv(db: AsyncSession, client_id) -> Conversation:
    result = await db.execute(select(Conversation).where(Conversation.client_id == client_id))
    conv = result.scalar_one_or_none()
    if conv is not None:
        return conv
    db.add(Conversation(client_id=client_id))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    result = await db.execute(select(Conversation).where(Conversation.client_id == client_id))
    return result.scalar_one()


async def _conv_for(db: AsyncSession, conv_id: uuid.UUID, user: User) -> Conversation:
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if conv is None or (not _is_manager(user) and conv.client_id != user.id):
        raise HTTPException(status_code=404, detail="Диалог не найден")
    return conv


class MessageIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=MAX_TEXT)
    reply_to_id: uuid.UUID | None = None
    client_msg_id: str | None = Field(default=None, max_length=36)


class MessageEdit(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=MAX_TEXT)


# ---------- диалоги ----------

@router.get("/conversations/mine")
async def my_conversation(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Диалог клиента с сервисом (создаётся при первом обращении)."""
    if _is_manager(user):
        raise HTTPException(status_code=403, detail="Только для клиентов")
    conv = await _get_or_create_conv(db, user.id)
    return {"id": str(conv.id), "unread": conv.client_unread}


@router.post("/conversations/with/{client_id}")
async def open_with_client(client_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Менеджер открывает (или создаёт) диалог с клиентом — например, из карточки клиента."""
    client = (await db.execute(select(User).where(User.id == client_id, User.role != "manager"))).scalar_one_or_none()
    if client is None:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    conv = await _get_or_create_conv(db, client.id)
    return _conv_item(conv, client)


@router.get("/conversations")
async def list_conversations(
    q: str | None = None,
    limit: int = Query(PAGE_SIZE, ge=1, le=100),
    offset: int = Query(0, ge=0),
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Conversation, User)
        .join(User, User.id == Conversation.client_id)
        .where(Conversation.last_message_at.isnot(None))
        .order_by(Conversation.last_message_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(like), User.phone.ilike(like), User.login.ilike(like)))
    rows = (await db.execute(stmt)).all()
    return [_conv_item(conv, client) for conv, client in rows]


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    conv = await _conv_for(db, conv_id, user)
    if _is_manager(user):
        client = (await db.execute(select(User).where(User.id == conv.client_id))).scalar_one()
        return _conv_item(conv, client)
    return {"id": str(conv.id), "unread": conv.client_unread}


# ---------- сообщения ----------

@router.get("/conversations/{conv_id}/messages")
async def list_messages(
    conv_id: uuid.UUID,
    before_id: uuid.UUID | None = None,
    limit: int = Query(PAGE_SIZE, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Страница истории: новые сначала запрашиваются, но отдаются по возрастанию.
    Для подгрузки старых — before_id = id самого раннего из уже загруженных."""
    conv = await _conv_for(db, conv_id, user)
    stmt = select(Message).where(Message.conversation_id == conv.id)
    if before_id is not None:
        ref = (
            await db.execute(select(Message).where(Message.id == before_id, Message.conversation_id == conv.id))
        ).scalar_one_or_none()
        if ref is not None:
            stmt = stmt.where(Message.created_at < ref.created_at)
    rows = (await db.execute(stmt.order_by(Message.created_at.desc()).limit(limit + 1))).scalars().all()
    has_more = len(rows) > limit
    page = list(reversed(rows[:limit]))
    return {"messages": await _with_replies(db, page), "has_more": has_more}


@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: uuid.UUID,
    payload: MessageIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await _conv_for(db, conv_id, user)
    side = _side(user)

    if payload.client_msg_id:
        existing = (
            await db.execute(
                select(Message).where(Message.conversation_id == conv.id, Message.client_msg_id == payload.client_msg_id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return (await _with_replies(db, [existing]))[0]

    reply = None
    if payload.reply_to_id is not None:
        reply = (
            await db.execute(
                select(Message).where(Message.id == payload.reply_to_id, Message.conversation_id == conv.id)
            )
        ).scalar_one_or_none()
        if reply is None:
            raise HTTPException(status_code=400, detail="Сообщение для ответа не найдено")

    now = _utcnow()
    msg = Message(
        conversation_id=conv.id,
        sender_id=user.id,
        sender_role=side,
        kind="text",
        text=payload.text,
        reply_to_id=reply.id if reply else None,
        client_msg_id=payload.client_msg_id,
        created_at=now,
    )
    db.add(msg)
    unread_col = Conversation.manager_unread if side == "client" else Conversation.client_unread
    unread_name = "manager_unread" if side == "client" else "client_unread"
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conv.id)
        .values(last_message_at=now, last_message_preview=payload.text[:120], **{unread_name: unread_col + 1})
    )
    try:
        await db.commit()
    except IntegrityError:
        # гонка двух одинаковых отправок: отдаём уже сохранённое
        await db.rollback()
        existing = (
            await db.execute(
                select(Message).where(Message.conversation_id == conv.id, Message.client_msg_id == payload.client_msg_id)
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return (await _with_replies(db, [existing]))[0]

    counts = (
        await db.execute(
            select(Conversation.client_unread, Conversation.manager_unread).where(Conversation.id == conv.id)
        )
    ).one()
    data = _msg_dict(msg, reply)
    await _emit(
        conv.client_id,
        {
            "type": "message",
            "conversation_id": str(conv.id),
            "message": data,
            "client_unread": counts[0],
            "manager_unread": counts[1],
        },
    )
    return data


@router.post("/conversations/{conv_id}/read")
async def mark_read(conv_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Пользователь открыл диалог: сообщения другой стороны помечаются прочитанными."""
    conv = await _conv_for(db, conv_id, user)
    side = _side(user)
    other_roles = ["client", "system"] if side == "manager" else ["manager", "system"]
    now = _utcnow()
    await db.execute(
        update(Message)
        .where(Message.conversation_id == conv.id, Message.sender_role.in_(other_roles), Message.read_at.is_(None))
        .values(read_at=now)
    )
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conv.id)
        .values(manager_unread=0 if side == "manager" else Conversation.manager_unread,
                client_unread=0 if side == "client" else Conversation.client_unread)
    )
    await db.commit()
    await _emit(conv.client_id, {"type": "read", "conversation_id": str(conv.id), "by": side, "at": now.isoformat()})
    return {"ok": True}


async def _own_message(db: AsyncSession, msg_id: uuid.UUID, user: User) -> tuple[Message, Conversation]:
    msg = (await db.execute(select(Message).where(Message.id == msg_id))).scalar_one_or_none()
    if msg is None:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    conv = await _conv_for(db, msg.conversation_id, user)
    if msg.sender_id != user.id:
        raise HTTPException(status_code=403, detail="Можно менять только свои сообщения")
    if msg.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Сообщение удалено")
    return msg, conv


@router.patch("/messages/{msg_id}")
async def edit_message(msg_id: uuid.UUID, payload: MessageEdit, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    msg, conv = await _own_message(db, msg_id, user)
    if _utcnow() - msg.created_at > EDIT_WINDOW:
        raise HTTPException(status_code=409, detail="Редактировать можно в течение суток")
    msg.text = payload.text
    msg.edited_at = _utcnow()
    await db.commit()
    data = (await _with_replies(db, [msg]))[0]
    await _emit(conv.client_id, {"type": "message_updated", "conversation_id": str(conv.id), "message": data})
    return data


@router.delete("/messages/{msg_id}")
async def delete_message(msg_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    msg, conv = await _own_message(db, msg_id, user)
    msg.deleted_at = _utcnow()
    await db.commit()
    data = _msg_dict(msg)
    await _emit(conv.client_id, {"type": "message_deleted", "conversation_id": str(conv.id), "message": data})
    return data


# ---------- счётчики для меню ----------

@router.get("/counters")
async def counters(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if _is_manager(user):
        total, dialogs = (
            await db.execute(
                select(
                    func.coalesce(func.sum(Conversation.manager_unread), 0),
                    func.count().filter(Conversation.manager_unread > 0),
                )
            )
        ).one()
        pending = (
            await db.execute(
                select(func.count()).select_from(Booking).where(
                    Booking.status == "pending", Booking.part == 0, Booking.date >= _today_msk()
                )
            )
        ).scalar_one()
        return {"unread_messages": int(total), "unread_dialogs": int(dialogs), "pending_bookings": int(pending)}

    unread = (
        await db.execute(select(Conversation.client_unread).where(Conversation.client_id == user.id))
    ).scalar_one_or_none() or 0
    return {"unread_messages": unread, "unread_dialogs": 1 if unread else 0, "pending_bookings": 0}


# ---------- WebSocket ----------

async def _ws_target(user_id, is_manager: bool, conv_id: str | None):
    """(id диалога, id клиента) для события «печатает»; None, если доступа нет."""
    agen = get_db()
    db = await agen.__anext__()
    try:
        if is_manager:
            try:
                cid = uuid.UUID(conv_id or "")
            except ValueError:
                return None
            row = (await db.execute(select(Conversation.id, Conversation.client_id).where(Conversation.id == cid))).first()
        else:
            row = (await db.execute(select(Conversation.id, Conversation.client_id).where(Conversation.client_id == user_id))).first()
        return (row[0], row[1]) if row else None
    finally:
        await agen.aclose()


@router.websocket("/ws")
async def chat_ws(ws: WebSocket, token: str = Query(...)):
    user_id = decode_access_token(token)
    if user_id is None:
        await ws.close(code=4401)
        return

    agen = get_db()
    db = await agen.__anext__()
    try:
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        uid, manager = (user.id, _is_manager(user)) if user else (None, False)
    finally:
        await agen.aclose()
    if uid is None:
        await ws.close(code=4401)
        return

    await ws.accept()
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(MANAGERS_CHANNEL if manager else _client_channel(uid))

    async def pump() -> None:
        while True:
            m = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if m and m.get("type") == "message":
                await ws.send_text(m["data"])

    async def listen() -> None:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            kind = data.get("type")
            if kind == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
            elif kind == "typing":
                target = await _ws_target(uid, manager, data.get("conversation_id"))
                if target:
                    await _emit(target[1], {"type": "typing", "conversation_id": str(target[0]), "by": "manager" if manager else "client"})

    tasks = [asyncio.create_task(pump()), asyncio.create_task(listen())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tasks:
            t.cancel()
        try:
            await pubsub.unsubscribe()
            await pubsub.aclose()
        except Exception:
            pass
