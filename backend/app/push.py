"""Web Push: отправка уведомлений на устройства. Сбой отправки не ломает основную операцию."""

import asyncio
import json
import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import settings
from app.database import engine
from app.models.push import PushSubscription
from app.models.user import User

log = logging.getLogger(__name__)
_tasks: set = set()


def enabled() -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def _send_one(endpoint: str, p256dh: str, auth: str, payload: str) -> bool:
    """True — подписка мертва (устройство отписалось), её нужно удалить."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=86400,
            timeout=10,
        )
    except WebPushException as e:
        code = getattr(e.response, "status_code", None)
        if code in (404, 410):
            return True
        log.warning("push не доставлен: %s", code or e)
    except Exception:
        log.exception("push: ошибка отправки")
    return False


async def _notify(user_ids: list, managers: bool, title: str, body: str, url: str, tag: str | None) -> None:
    try:
        payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag}, ensure_ascii=False)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            query = select(PushSubscription)
            if managers:
                query = query.join(User, User.id == PushSubscription.user_id).where(User.role == "manager")
            else:
                query = query.where(PushSubscription.user_id.in_(user_ids))
            subs = (await db.execute(query)).scalars().all()
            dead = []
            for s in subs:
                if await asyncio.to_thread(_send_one, s.endpoint, s.p256dh, s.auth, payload):
                    dead.append(s.id)
            if dead:
                await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead)))
                await db.commit()
    except Exception:
        log.exception("push: не удалось разослать")


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def notify_users(user_ids, title: str, body: str, url: str = "/", tag: str | None = None) -> None:
    """Уведомить конкретных пользователей (все их устройства)."""
    if enabled() and user_ids:
        _spawn(_notify(list(user_ids), False, title, body, url, tag))


def notify_managers(title: str, body: str, url: str = "/nord", tag: str | None = None) -> None:
    """Уведомить всех менеджеров."""
    if enabled():
        _spawn(_notify([], True, title, body, url, tag))
