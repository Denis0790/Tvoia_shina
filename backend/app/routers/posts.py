"""Посты (подъёмники/мастера). Список нужен менеджеру, чтобы назначить пост
при подтверждении заявки — сам пост как сущность управляется пока напрямую
через БД (UI настройки постов на фронте ещё не собран)."""

import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_manager
from app.models import Post, User

router = APIRouter(prefix="/posts", tags=["posts"])


class PostOut(BaseModel):
    id: uuid.UUID
    name: str
    work_start: str
    work_end: str
    work_days: str


@router.get("", response_model=list[PostOut])
async def list_posts(manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Post).order_by(Post.name))
    return result.scalars().all()
