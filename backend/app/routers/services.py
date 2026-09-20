"""Каталог услуг. Публичный — виден без авторизации, это просто прайс/справочник,
а не персональные данные."""

import uuid
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Service

router = APIRouter(prefix="/services", tags=["services"])


class ServiceOut(BaseModel):
    id: uuid.UUID
    name: str
    duration_minutes: int


@router.get("", response_model=list[ServiceOut])
async def list_services(db: AsyncSession = Depends(get_db)):
    """Возвращает все услуги сразу — справочник маленький (десятки записей),
    пагинация тут не нужна."""
    result = await db.execute(select(Service).order_by(Service.name))
    return result.scalars().all()
