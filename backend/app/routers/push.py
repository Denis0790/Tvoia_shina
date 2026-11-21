"""Подписка устройства на push-уведомления."""

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.models.push import PushSubscription
from app.push import enabled

router = APIRouter(prefix="/push", tags=["push"])

# Принимаем только адреса настоящих push-служб браузеров (защита от подмены адреса)
ALLOWED_HOST_SUFFIXES = (
    ".googleapis.com",
    ".push.services.mozilla.com",
    ".push.apple.com",
    ".notify.windows.com",
)


def _check_endpoint(endpoint: str) -> None:
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not any(host.endswith(s) for s in ALLOWED_HOST_SUFFIXES):
        raise HTTPException(status_code=400, detail="Неподдерживаемая служба уведомлений")


class Keys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class SubscribeIn(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: Keys


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(max_length=2000)


@router.get("/public-key")
async def public_key():
    if not enabled():
        raise HTTPException(status_code=404, detail="Уведомления не настроены")
    return {"key": settings.vapid_public_key}


@router.post("/subscribe")
async def subscribe(payload: SubscribeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_endpoint(payload.endpoint)
    row = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint))
    ).scalar_one_or_none()
    if row is None:
        db.add(
            PushSubscription(
                user_id=user.id, endpoint=payload.endpoint, p256dh=payload.keys.p256dh, auth=payload.keys.auth
            )
        )
    else:
        row.user_id = user.id
        row.p256dh = payload.keys.p256dh
        row.auth = payload.keys.auth
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()  # гонка двух одинаковых подписок: уже сохранена
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(payload: UnsubscribeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == user.id)
    )
    await db.commit()
    return {"ok": True}
