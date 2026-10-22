"""Посты (подъёмники/мастера) — CRUD для менеджера: создание, редактирование,
удаление, рабочие часы и дни недели, плюс точечные исключения по датам
(отпуск, внеплановый рабочий день в выходной и т.п.)."""

import uuid
from datetime import date as date_type, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_manager
from app.models import Booking, Post, ScheduleException, User

router = APIRouter(prefix="/posts", tags=["posts"])


def _validate_work_days(value: str) -> str:
    if len(value) != 7 or any(c not in "01" for c in value):
        raise ValueError("work_days должен быть строкой из 7 символов '0'/'1' (пн..вс)")
    return value


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    work_start: str
    work_end: str
    work_days: str


class PostCreate(BaseModel):
    name: str
    work_start: str = "09:00"
    work_end: str = "18:00"
    work_days: str = "1111100"

    @field_validator("work_days")
    @classmethod
    def _check_work_days(cls, v: str) -> str:
        return _validate_work_days(v)


class PostUpdate(BaseModel):
    name: str | None = None
    work_start: str | None = None
    work_end: str | None = None
    work_days: str | None = None

    @field_validator("work_days")
    @classmethod
    def _check_work_days(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_work_days(v)


@router.get("", response_model=list[PostOut])
async def list_posts(manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Post).order_by(Post.name))
    return result.scalars().all()


@router.post("", response_model=PostOut)
async def create_post(payload: PostCreate, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    post = Post(
        name=payload.name,
        work_start=payload.work_start,
        work_end=payload.work_end,
        work_days=payload.work_days,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post


@router.put("/{post_id}", response_model=PostOut)
async def update_post(
    post_id: uuid.UUID, payload: PostUpdate, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Пост не найден")

    if payload.name is not None:
        post.name = payload.name
    if payload.work_start is not None:
        post.work_start = payload.work_start
    if payload.work_end is not None:
        post.work_end = payload.work_end
    if payload.work_days is not None:
        post.work_days = payload.work_days

    await db.commit()
    await db.refresh(post)
    return post


@router.delete("/{post_id}")
async def delete_post(post_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Пост не найден")

    await db.delete(post)
    await db.commit()
    return {"ok": True}


class ScheduleExceptionIn(BaseModel):
    date: date_type
    is_working: bool
    work_start: str | None = None
    work_end: str | None = None
    kind: str = "dayoff"
    note: str | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        return _validate_kind(v)


class ScheduleExceptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: date_type
    is_working: bool
    work_start: str | None
    work_end: str | None
    kind: str
    note: str | None


@router.get("/{post_id}/exceptions", response_model=list[ScheduleExceptionOut])
async def list_schedule_exceptions(
    post_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ScheduleException).where(ScheduleException.post_id == post_id).order_by(ScheduleException.date)
    )
    return result.scalars().all()


@router.put("/{post_id}/exceptions", response_model=ScheduleExceptionOut)
async def set_schedule_exception(
    post_id: uuid.UUID,
    payload: ScheduleExceptionIn,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Ставит или обновляет исключение на конкретную дату для поста — например,
    отпуск мастера (is_working=False) или работа в обычно выходной день
    (is_working=True, с опциональным переопределением часов)."""
    result = await db.execute(
        select(ScheduleException).where(ScheduleException.post_id == post_id, ScheduleException.date == payload.date)
    )
    exception = result.scalar_one_or_none()
    if exception is None:
        exception = ScheduleException(
            post_id=post_id,
            date=payload.date,
            is_working=payload.is_working,
            work_start=payload.work_start,
            work_end=payload.work_end,
            kind=payload.kind,
            note=payload.note,
        )
        db.add(exception)
    else:
        exception.is_working = payload.is_working
        exception.work_start = payload.work_start
        exception.work_end = payload.work_end
        exception.kind = payload.kind
        exception.note = payload.note

    await db.commit()
    await db.refresh(exception)
    return exception


EXCEPTION_KINDS = {"dayoff", "vacation", "sick", "repair", "other"}
MAX_EXCEPTION_RANGE_DAYS = 366


def _validate_kind(value: str) -> str:
    if value not in EXCEPTION_KINDS:
        raise ValueError(f"kind должен быть одним из: {', '.join(sorted(EXCEPTION_KINDS))}")
    return value


class ScheduleExceptionRangeIn(BaseModel):
    date_from: date_type
    date_to: date_type
    is_working: bool = False
    work_start: str | None = None
    work_end: str | None = None
    kind: str = "vacation"
    note: str | None = None

    @field_validator("kind")
    @classmethod
    def _check_kind(cls, v: str) -> str:
        return _validate_kind(v)


@router.put("/{post_id}/exceptions/range")
async def set_schedule_exception_range(
    post_id: uuid.UUID,
    payload: ScheduleExceptionRangeIn,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Ставит исключение сразу на период (отпуск, больничный, ремонт): разворачивает
    его в строки по дням, так что календарь и доступность работают без изменений.
    Возвращает число дней и число живых записей клиентов, попавших в период."""
    if payload.date_to < payload.date_from:
        raise HTTPException(status_code=400, detail="Дата окончания раньше даты начала")
    days_count = (payload.date_to - payload.date_from).days + 1
    if days_count > MAX_EXCEPTION_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"Период не может быть длиннее {MAX_EXCEPTION_RANGE_DAYS} дней")

    post_result = await db.execute(select(Post.id).where(Post.id == post_id))
    if post_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Пост не найден")

    start_dt = datetime.combine(payload.date_from, time.min)
    end_dt = datetime.combine(payload.date_to + timedelta(days=1), time.min)

    existing_result = await db.execute(
        select(ScheduleException).where(
            ScheduleException.post_id == post_id,
            ScheduleException.date >= start_dt,
            ScheduleException.date < end_dt,
        )
    )
    existing = {e.date.date(): e for e in existing_result.scalars().all()}

    work_start = payload.work_start if payload.is_working else None
    work_end = payload.work_end if payload.is_working else None
    for i in range(days_count):
        day = payload.date_from + timedelta(days=i)
        exception = existing.get(day)
        if exception is None:
            db.add(
                ScheduleException(
                    post_id=post_id,
                    date=datetime.combine(day, time.min),
                    is_working=payload.is_working,
                    work_start=work_start,
                    work_end=work_end,
                    kind=payload.kind,
                    note=payload.note,
                )
            )
        else:
            exception.is_working = payload.is_working
            exception.work_start = work_start
            exception.work_end = work_end
            exception.kind = payload.kind
            exception.note = payload.note

    conflicts = 0
    if not payload.is_working:
        count_result = await db.execute(
            select(func.count())
            .select_from(Booking)
            .where(
                Booking.post_id == post_id,
                Booking.date >= start_dt,
                Booking.date < end_dt,
                Booking.status.in_(["pending", "confirmed"]),
            )
        )
        conflicts = count_result.scalar_one()

    await db.commit()
    return {"days": days_count, "conflicts": conflicts}


@router.delete("/{post_id}/exceptions/period")
async def delete_schedule_exception_period(
    post_id: uuid.UUID,
    date_from: date_type,
    date_to: date_type,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Снимает все исключения поста в периоде [date_from, date_to] включительно."""
    start_dt = datetime.combine(date_from, time.min)
    end_dt = datetime.combine(date_to + timedelta(days=1), time.min)
    await db.execute(
        delete(ScheduleException).where(
            ScheduleException.post_id == post_id,
            ScheduleException.date >= start_dt,
            ScheduleException.date < end_dt,
        )
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{post_id}/exceptions/{exception_date}")
async def delete_schedule_exception(
    post_id: uuid.UUID,
    exception_date: date_type,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(ScheduleException).where(
            ScheduleException.post_id == post_id, ScheduleException.date == exception_date
        )
    )
    await db.commit()
    return {"ok": True}
