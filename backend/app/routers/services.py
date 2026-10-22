"""Каталог услуг с нормативами. Публичный список (только активные) виден без
авторизации — это справочник, а не персональные данные; править может менеджер."""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_manager
from app.models import Service, User

router = APIRouter(prefix="/services", tags=["services"])

_ORDER = (Service.category.is_(None), Service.category, Service.name)


class ServiceOut(BaseModel):
    id: uuid.UUID
    name: str
    duration_minutes: int
    category: str | None = None
    is_active: bool = True

    model_config = {"from_attributes": True}


class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    duration_minutes: int = Field(ge=5, le=4800)
    category: str | None = Field(None, max_length=60)
    is_active: bool | None = None


@router.get("", response_model=list[ServiceOut])
async def list_services(db: AsyncSession = Depends(get_db)):
    """Активные услуги — справочник небольшой (десятки записей), пагинация не нужна."""
    result = await db.execute(select(Service).where(Service.is_active.is_(True)).order_by(*_ORDER))
    return result.scalars().all()


@router.get("/all", response_model=list[ServiceOut])
async def list_all_services(manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Все услуги, включая скрытые, — для страницы управления."""
    result = await db.execute(select(Service).order_by(*_ORDER))
    return result.scalars().all()


async def _assert_name_free(db: AsyncSession, name: str, exclude_id: uuid.UUID | None = None):
    query = select(Service.id).where(func.lower(Service.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Service.id != exclude_id)
    if (await db.execute(query)).first() is not None:
        raise HTTPException(status_code=409, detail="Такая услуга уже есть")


def _clean(payload: ServiceIn) -> tuple[str, str | None]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название не может быть пустым")
    category = payload.category.strip() if payload.category else None
    return name, category or None


@router.post("", response_model=ServiceOut)
async def create_service(payload: ServiceIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    name, category = _clean(payload)
    await _assert_name_free(db, name)
    service = Service(id=uuid.uuid4(), name=name, duration_minutes=payload.duration_minutes, category=category, is_active=True)
    db.add(service)
    await db.commit()
    return service


async def _get(db: AsyncSession, service_id: uuid.UUID) -> Service:
    service = (await db.execute(select(Service).where(Service.id == service_id))).scalar_one_or_none()
    if service is None:
        raise HTTPException(status_code=404, detail="Услуга не найдена")
    return service


@router.put("/{service_id}", response_model=ServiceOut)
async def update_service(
    service_id: uuid.UUID, payload: ServiceIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    service = await _get(db, service_id)
    name, category = _clean(payload)
    await _assert_name_free(db, name, exclude_id=service_id)
    service.name = name
    service.duration_minutes = payload.duration_minutes
    service.category = category
    if payload.is_active is not None:
        service.is_active = payload.is_active
    await db.commit()
    return service


@router.delete("/{service_id}")
async def hide_service(service_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Скрывает услугу из выбора (история записей сохраняется); вернуть можно через PUT is_active=true."""
    service = await _get(db, service_id)
    service.is_active = False
    await db.commit()
    return {"ok": True}
