"""Чат: REST для истории и действий, WebSocket (+Redis pub/sub) для доставки в реальном времени.

Каналы Redis: chat:c:<client_id> — события для конкретного клиента,
chat:managers — события для всех менеджеров. Каждое событие уходит в оба канала,
поэтому свои же вкладки и устройства тоже обновляются."""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from urllib.parse import quote, unquote
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import media
from app.database import get_db
from app.deps import get_current_user, require_manager
from app.models import Booking, User
from app.models.chat import ChatAttachment, Conversation, Message, MessageReaction
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


def _msg_dict(m: Message, reply: Message | None = None, reactions: list | None = None, attachments: list | None = None) -> dict:
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
                "text": None if reply.deleted_at else ((reply.text or "").split("\n")[0] if reply.kind == "booking" else (reply.text or ""))[:120],
            }
            if reply is not None
            else None
        ),
        "created_at": _iso(m.created_at),
        "edited_at": _iso(m.edited_at),
        "read": m.read_at is not None,
        "client_msg_id": m.client_msg_id,
        "reactions": reactions or [],
        "attachments": [] if deleted else (attachments or []),
    }


async def _with_replies(db: AsyncSession, messages: list[Message]) -> list[dict]:
    ids = {m.reply_to_id for m in messages if m.reply_to_id}
    replies: dict = {}
    if ids:
        rows = await db.execute(select(Message).where(Message.id.in_(ids)))
        replies = {r.id: r for r in rows.scalars().all()}
    reactions: dict = {}
    if messages:
        rows = await db.execute(select(MessageReaction).where(MessageReaction.message_id.in_([m.id for m in messages])))
        for r in rows.scalars().all():
            reactions.setdefault(r.message_id, []).append({"emoji": r.emoji, "uid": str(r.user_id), "role": r.role})
    atts: dict = {}
    if messages:
        rows = await db.execute(
            select(ChatAttachment).where(ChatAttachment.message_id.in_([m.id for m in messages])).order_by(ChatAttachment.created_at)
        )
        for a in rows.scalars().all():
            atts.setdefault(a.message_id, []).append(_att_dict(a))
    return [_msg_dict(m, replies.get(m.reply_to_id), reactions.get(m.id), atts.get(m.id)) for m in messages]


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
        "pinned": conv.pinned,
        "muted": conv.muted,
        "blocked": client.blocked,
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


async def post_booking_message(
    db: AsyncSession, client: User, actor: str, actor_user: User | None, title: str, lines: list[str]
) -> None:
    """Событие по записи — карточкой в чат клиента. actor: client (клиент сам что-то сделал) или manager."""
    if client.role == "manager":
        return
    if actor == "manager" and not client.password_hash:
        return  # гость без аккаунта: читать некому
    conv = await _get_or_create_conv(db, client.id)
    text = "\n".join([title, *lines])
    now = _utcnow()
    msg = Message(
        conversation_id=conv.id,
        sender_id=actor_user.id if actor_user is not None else client.id,
        sender_role=actor,
        kind="booking",
        text=text,
        created_at=now,
    )
    db.add(msg)
    unread_name = "manager_unread" if actor == "client" else "client_unread"
    unread_col = Conversation.manager_unread if actor == "client" else Conversation.client_unread
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conv.id)
        .values(last_message_at=now, last_message_preview=text.replace("\n", " · ")[:120], **{unread_name: unread_col + 1})
    )
    await db.commit()
    counts = (
        await db.execute(select(Conversation.client_unread, Conversation.manager_unread).where(Conversation.id == conv.id))
    ).one()
    await _emit(
        conv.client_id,
        {
            "type": "message",
            "conversation_id": str(conv.id),
            "message": _msg_dict(msg),
            "client_unread": counts[0],
            "manager_unread": counts[1],
        },
    )


class MessageIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(default="", max_length=MAX_TEXT)
    reply_to_id: uuid.UUID | None = None
    client_msg_id: str | None = Field(default=None, max_length=36)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)


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
    return {"id": str(conv.id), "unread": conv.client_unread, "blocked": user.blocked}


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
        .order_by(Conversation.pinned.desc(), Conversation.last_message_at.desc())
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
    return {"id": str(conv.id), "unread": conv.client_unread, "blocked": user.blocked}


class MarkIn(BaseModel):
    unread: bool


class SettingsIn(BaseModel):
    pinned: bool | None = None
    muted: bool | None = None


class BlockIn(BaseModel):
    blocked: bool


async def _manager_conv(db: AsyncSession, conv_id: uuid.UUID) -> tuple[Conversation, User]:
    conv = (await db.execute(select(Conversation).where(Conversation.id == conv_id))).scalar_one_or_none()
    if conv is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    client = (await db.execute(select(User).where(User.id == conv.client_id))).scalar_one()
    return conv, client


async def _emit_conv_event(conv: Conversation, client: User, *, to_client: bool) -> None:
    """Настройки диалога поменялись: списки менеджеров обновятся сразу. Клиенту уходит только признак блокировки."""
    if to_client:
        await _emit(conv.client_id, {"type": "conversation", "conversation_id": str(conv.id), "blocked": client.blocked})
    else:
        data = json.dumps({"type": "conversation", "conversation_id": str(conv.id)}, ensure_ascii=False)
        await redis_client.publish(MANAGERS_CHANNEL, data)


@router.post("/conversations/{conv_id}/mark")
async def mark_conversation(
    conv_id: uuid.UUID, payload: MarkIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Пометить диалог непрочитанным / прочитанным. Отметки «прочитано» у клиента при этом не меняются."""
    conv, client = await _manager_conv(db, conv_id)
    conv.manager_unread = max(conv.manager_unread, 1) if payload.unread else 0
    await db.commit()
    await _emit_conv_event(conv, client, to_client=False)
    return _conv_item(conv, client)


@router.patch("/conversations/{conv_id}/settings")
async def conversation_settings(
    conv_id: uuid.UUID, payload: SettingsIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    conv, client = await _manager_conv(db, conv_id)
    if payload.pinned is not None:
        conv.pinned = payload.pinned
    if payload.muted is not None:
        conv.muted = payload.muted
    await db.commit()
    await _emit_conv_event(conv, client, to_client=False)
    return _conv_item(conv, client)


@router.put("/conversations/{conv_id}/block")
async def block_client(
    conv_id: uuid.UUID, payload: BlockIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Заблокировать клиента: не пишет в чат и не записывается онлайн. Менеджеры по-прежнему могут писать ему."""
    conv, client = await _manager_conv(db, conv_id)
    if client.role == "manager":
        raise HTTPException(status_code=400, detail="Сотрудника заблокировать нельзя")
    client.blocked = payload.blocked
    await db.commit()
    await _emit_conv_event(conv, client, to_client=True)
    return _conv_item(conv, client)


DAILY_ATTACH_LIMIT = 60
RETENTION_DAYS = 365 * 3  # история переписки хранится 3 года
_VIDEO_LOCK = asyncio.Semaphore(1)  # видео перекодируем по одному — не грузим сервер
_tasks: set = set()


def _att_dict(a: ChatAttachment) -> dict:
    d = {
        "id": str(a.id),
        "kind": a.kind,
        "status": a.status,
        "width": a.width,
        "height": a.height,
        "duration_ms": a.duration_ms,
        "size": a.size_bytes or 0,
        "name": a.original_name,
    }
    if a.status == "ready":
        t = media.sign_media(a.id)
        d["url"] = f"/chat/media/{a.id}/main?t={t}"
        if a.thumb_key:
            d["thumb_url"] = f"/chat/media/{a.id}/thumb?t={t}"
    return d


def _attach_preview(atts: list) -> str:
    if any(a.kind == "video" for a in atts):
        return "🎥 Видео"
    if any(a.kind == "image" for a in atts):
        return "📷 Фото"
    return ("📎 " + (atts[0].original_name or "Файл"))[:120]


def _iter_file(path: Path, start: int, length: int):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            data = f.read(min(262144, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def _file_response(path: Path, request: Request, media_type: str, extra: dict | None = None) -> Response:
    """Отдача файла с поддержкой Range: без неё видео нельзя перематывать (и не играет в Safari)."""
    size = path.stat().st_size
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400"}
    headers.update(extra or {})
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        try:
            a, b = rng[6:].split(",")[0].split("-", 1)
            if a == "":
                start, end = max(0, size - int(b)), size - 1
            else:
                start, end = int(a), (int(b) if b else size - 1)
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        end = min(end, size - 1)
        if start > end or start >= size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        length = end - start + 1
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)})
        return StreamingResponse(_iter_file(path, start, length), status_code=206, headers=headers, media_type=media_type)
    headers["Content-Length"] = str(size)
    return StreamingResponse(_iter_file(path, 0, size), headers=headers, media_type=media_type)


def _delete_attachment_files(a: ChatAttachment) -> None:
    media.storage.delete(a.main_key)
    media.storage.delete(a.thumb_key)
    for suffix in ("src", "upload"):
        media.storage.path(f"{a.conversation_id}/{a.id}.{suffix}").unlink(missing_ok=True)


async def _purge_message_attachments(db: AsyncSession, msg_id: uuid.UUID) -> None:
    rows = (await db.execute(select(ChatAttachment).where(ChatAttachment.message_id == msg_id))).scalars().all()
    for a in rows:
        _delete_attachment_files(a)
    await db.execute(delete(ChatAttachment).where(ChatAttachment.message_id == msg_id))


async def _emit_attachment_update(db: AsyncSession, att: ChatAttachment) -> None:
    if att.message_id is None:
        return
    msg = (await db.execute(select(Message).where(Message.id == att.message_id))).scalar_one_or_none()
    conv = (await db.execute(select(Conversation).where(Conversation.id == att.conversation_id))).scalar_one_or_none()
    if msg is None or conv is None:
        return
    data = (await _with_replies(db, [msg]))[0]
    await _emit(conv.client_id, {"type": "message_updated", "conversation_id": str(conv.id), "message": data})


async def process_video_attachment(db: AsyncSession, att_id: uuid.UUID) -> None:
    """Проверка, перекодирование в MP4 720p и постер. Исходник после обработки удаляется."""
    async with _VIDEO_LOCK:
        att = (await db.execute(select(ChatAttachment).where(ChatAttachment.id == att_id))).scalar_one_or_none()
        if att is None or att.status != "processing":
            return
        conv_key = str(att.conversation_id)
        src = media.storage.path(f"{conv_key}/{att.id}.src")
        main_key = f"{conv_key}/{att.id}.mp4"
        thumb_key = f"{conv_key}/{att.id}_thumb.webp"
        try:
            info = await media.probe_video(src)
            if info["duration"] > media.MAX_VIDEO_SECONDS + 1:
                raise media.MediaError("Видео длиннее минуты")
            dst = media.storage.path(main_key)
            await media.transcode_video(src, dst)
            out = await media.probe_video(dst)
            media.storage.put(thumb_key, await media.make_poster(dst))
            att.status = "ready"
            att.main_key = main_key
            att.thumb_key = thumb_key
            att.size_bytes = dst.stat().st_size
            att.width = out["width"]
            att.height = out["height"]
            att.duration_ms = int(out["duration"] * 1000)
        except media.MediaError as e:
            att.status = "failed"
            att.error = str(e)[:200]
            media.storage.delete(main_key)
            media.storage.delete(thumb_key)
        except Exception:
            logging.getLogger(__name__).exception("видео не обработано")
            att.status = "failed"
            att.error = "Не удалось обработать видео"
            media.storage.delete(main_key)
            media.storage.delete(thumb_key)
        finally:
            src.unlink(missing_ok=True)
        await db.commit()
    await _emit_attachment_update(db, att)


async def _run_video_job(att_id: uuid.UUID) -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.database import engine

    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            await process_video_attachment(db, att_id)
    except Exception:
        logging.getLogger(__name__).exception("фоновая обработка видео упала")


def _bad(e: media.MediaError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.post("/conversations/{conv_id}/attachments")
async def upload_attachment(
    conv_id: uuid.UUID, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Загрузка фото или видео «сырым» телом запроса (Content-Type: image/* или video/*)."""
    conv = await _conv_for(db, conv_id, user)
    if not _is_manager(user) and user.blocked:
        raise HTTPException(status_code=403, detail="Чат недоступен. Пожалуйста, позвоните нам")
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    kind = "image" if ctype.startswith("image/") else "video" if ctype.startswith("video/") else "file"
    fname = ""
    if kind == "file":
        try:
            fname = media.clean_filename(request.query_params.get("name") or unquote(request.headers.get("x-file-name") or ""))
        except media.MediaError as e:
            raise _bad(e)
    limit = media.MAX_VIDEO_BYTES if kind == "video" else media.MAX_IMAGE_BYTES
    too_big = HTTPException(
        status_code=413, detail={"image": "Фото больше 25 МБ", "video": "Видео больше 100 МБ", "file": "Файл больше 25 МБ"}[kind]
    )
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > limit:
        raise too_big
    used = (
        await db.execute(
            select(func.count()).select_from(ChatAttachment).where(
                ChatAttachment.uploader_id == user.id, ChatAttachment.created_at >= _utcnow() - timedelta(hours=24)
            )
        )
    ).scalar_one()
    if used >= DAILY_ATTACH_LIMIT:
        raise HTTPException(status_code=429, detail="Слишком много файлов за сутки, попробуйте завтра")

    att_id = uuid.uuid4()
    tmp = media.storage.path(f"{conv.id}/{att_id}.upload")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        total = 0
        with open(tmp, "wb") as f:
            async for chunk in request.stream():
                total += len(chunk)
                if total > limit:
                    raise too_big
                f.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Пустой файл")

        if kind == "image":
            try:
                result = await asyncio.to_thread(media.process_image, tmp.read_bytes())
            except media.MediaError as e:
                raise _bad(e)
            main_key, thumb_key = f"{conv.id}/{att_id}.webp", f"{conv.id}/{att_id}_thumb.webp"
            media.storage.put(main_key, result["main"])
            media.storage.put(thumb_key, result["thumb"])
            att = ChatAttachment(
                id=att_id, conversation_id=conv.id, uploader_id=user.id, kind="image", status="ready",
                size_bytes=len(result["main"]), width=result["width"], height=result["height"],
                main_key=main_key, thumb_key=thumb_key,
            )
            tmp.unlink(missing_ok=True)
        elif kind == "file":
            with open(tmp, "rb") as f:
                head = f.read(8192)
            try:
                media.check_file(fname, head)
            except media.MediaError as e:
                raise _bad(e)
            main_key = f"{conv.id}/{att_id}.bin"
            tmp.rename(media.storage.path(main_key))
            att = ChatAttachment(
                id=att_id, conversation_id=conv.id, uploader_id=user.id, kind="file", status="ready",
                size_bytes=total, main_key=main_key, original_name=fname,
            )
        else:
            with open(tmp, "rb") as f:
                head = f.read(12)
            if not (head[4:8] == b"ftyp" or head[:4] == b"\x1a\x45\xdf\xa3"):
                raise HTTPException(status_code=400, detail="Формат видео не поддерживается (нужен MP4, MOV или WebM)")
            tmp.rename(media.storage.path(f"{conv.id}/{att_id}.src"))
            att = ChatAttachment(
                id=att_id, conversation_id=conv.id, uploader_id=user.id, kind="video", status="processing", size_bytes=total
            )
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    db.add(att)
    await db.commit()
    if kind == "video" and media.RUN_BACKGROUND:
        task = asyncio.create_task(_run_video_job(att.id))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    return _att_dict(att)


@router.get("/media/{att_id}/{variant}")
async def get_media(
    att_id: uuid.UUID, variant: str, request: Request, t: str = Query(...), db: AsyncSession = Depends(get_db)
):
    """Файл вложения. Доступ — по подписанной ссылке из ответа API (на сутки), без неё файл не открыть."""
    if variant not in ("main", "thumb") or not media.verify_media(t, att_id):
        raise HTTPException(status_code=403, detail="Нет доступа")
    a = (await db.execute(select(ChatAttachment).where(ChatAttachment.id == att_id))).scalar_one_or_none()
    key = None if a is None or a.status != "ready" else (a.main_key if variant == "main" else a.thumb_key)
    if not key:
        raise HTTPException(status_code=404, detail="Файл не найден")
    path = media.storage.path(key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Файл не найден")
    if a.kind == "file":
        disp = {"Content-Disposition": "attachment; filename*=UTF-8''" + quote(a.original_name or "file"), "X-Content-Type-Options": "nosniff"}
        return _file_response(path, request, "application/octet-stream", disp)
    ctype = "video/mp4" if (a.kind == "video" and variant == "main") else "image/webp"
    return _file_response(path, request, ctype)


async def cleanup_media(db: AsyncSession) -> dict:
    """Раз в час: чистим неприкреплённые файлы, зависшую обработку и переписку старше срока хранения."""
    now = _utcnow()
    orphans = (
        await db.execute(
            select(ChatAttachment).where(ChatAttachment.message_id.is_(None), ChatAttachment.created_at < now - timedelta(hours=24))
        )
    ).scalars().all()
    for a in orphans:
        _delete_attachment_files(a)
        await db.delete(a)
    stuck = (
        await db.execute(
            select(ChatAttachment).where(ChatAttachment.status == "processing", ChatAttachment.created_at < now - timedelta(minutes=30))
        )
    ).scalars().all()
    for a in stuck:
        a.status = "failed"
        a.error = "Обработка прервана"
        _delete_attachment_files(a)
    cutoff = now - timedelta(days=RETENTION_DAYS)
    old = (
        await db.execute(
            select(ChatAttachment).join(Message, Message.id == ChatAttachment.message_id).where(Message.created_at < cutoff)
        )
    ).scalars().all()
    for a in old:
        _delete_attachment_files(a)
    res = await db.execute(delete(Message).where(Message.created_at < cutoff))
    await db.commit()
    return {"orphans": len(orphans), "stuck": len(stuck), "old_attachments": len(old), "old_messages": res.rowcount}


@router.get("/conversations/{conv_id}/bookings")
async def conversation_bookings(conv_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Ближайшие активные записи клиента — напоминание над перепиской."""
    conv = await _conv_for(db, conv_id, user)
    rows = (
        await db.execute(
            select(Booking)
            .where(
                Booking.user_id == conv.client_id,
                Booking.status.in_(["pending", "confirmed"]),
                Booking.part == 0,
                Booking.date >= _today_msk(),
            )
            .order_by(Booking.date, Booking.start_time)
            .limit(6)
        )
    ).scalars().all()
    return [
        {"id": str(b.id), "date": str(b.date)[:10], "start_time": str(b.start_time)[:5], "status": b.status}
        for b in rows
    ]


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
    if not _is_manager(user) and user.blocked:
        raise HTTPException(status_code=403, detail="Чат недоступен. Пожалуйста, позвоните нам")
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

    atts: list[ChatAttachment] = []
    if payload.attachment_ids:
        wanted = set(payload.attachment_ids)
        atts = list(
            (
                await db.execute(
                    select(ChatAttachment).where(
                        ChatAttachment.id.in_(wanted),
                        ChatAttachment.conversation_id == conv.id,
                        ChatAttachment.uploader_id == user.id,
                        ChatAttachment.message_id.is_(None),
                    )
                )
            ).scalars().all()
        )
        if len(atts) != len(wanted):
            raise HTTPException(status_code=400, detail="Вложение не найдено")
    if not payload.text and not atts:
        raise HTTPException(status_code=422, detail="Пустое сообщение")

    now = _utcnow()
    msg_id = uuid.uuid4()
    msg = Message(
        id=msg_id,
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
    if atts:
        await db.flush()  # сначала сообщение, потом привязка файлов (внешний ключ)
    for a in atts:
        a.message_id = msg_id
    unread_col = Conversation.manager_unread if side == "client" else Conversation.client_unread
    unread_name = "manager_unread" if side == "client" else "client_unread"
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conv.id)
        .values(last_message_at=now, last_message_preview=(payload.text[:120] or _attach_preview(atts)), **{unread_name: unread_col + 1})
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
    data = (await _with_replies(db, [msg]))[0]
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


ALLOWED_REACTIONS = ["👍", "👎", "❤️", "🔥", "😂", "😮", "😢", "🙏"]
_CANON = {e.replace("\ufe0f", ""): e for e in ALLOWED_REACTIONS}


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


@router.put("/messages/{msg_id}/reaction")
async def set_reaction(msg_id: uuid.UUID, payload: ReactionIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Поставить реакцию; та же реакция повторно — снимает; другая — заменяет."""
    msg = (await db.execute(select(Message).where(Message.id == msg_id))).scalar_one_or_none()
    if msg is None:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    conv = await _conv_for(db, msg.conversation_id, user)
    if msg.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Сообщение удалено")
    emoji = _CANON.get(payload.emoji.replace("\ufe0f", ""))
    if emoji is None:
        raise HTTPException(status_code=400, detail="Такой реакции нет")
    existing = (
        await db.execute(select(MessageReaction).where(MessageReaction.message_id == msg.id, MessageReaction.user_id == user.id))
    ).scalar_one_or_none()
    if existing is not None and existing.emoji == emoji:
        await db.delete(existing)
    elif existing is not None:
        existing.emoji = emoji
    else:
        db.add(MessageReaction(message_id=msg.id, user_id=user.id, role=_side(user), emoji=emoji))
    await db.commit()
    data = (await _with_replies(db, [msg]))[0]
    await _emit(conv.client_id, {"type": "reaction", "conversation_id": str(conv.id), "message": data})
    return data


@router.patch("/messages/{msg_id}")
async def edit_message(msg_id: uuid.UUID, payload: MessageEdit, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    msg, conv = await _own_message(db, msg_id, user)
    if msg.kind != "text":
        raise HTTPException(status_code=409, detail="Это сообщение нельзя редактировать")
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
    await _purge_message_attachments(db, msg.id)
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
                    func.coalesce(func.sum(Conversation.manager_unread).filter(Conversation.muted.is_(False)), 0),
                    func.count().filter(Conversation.manager_unread > 0, Conversation.muted.is_(False)),
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
