import uuid
from datetime import date as date_type
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User, Booking, Service

router = APIRouter(prefix="/bookings", tags=["bookings"])

MAX_BOOKING_MINUTES = 8 * 60  # не больше одного рабочего дня


class BookingCreate(BaseModel):
    car_id: uuid.UUID | None = None
    date: date_type
    start_time: str
    service_ids: list[uuid.UUID]
    comment: str | None = None


@router.post("")
async def create_booking(
    payload: BookingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Правило: одна активная запись на клиента
    result = await db.execute(
        select(Booking).where(
            Booking.user_id == user.id,
            Booking.status.in_(["pending", "confirmed"]),
        )
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="У вас уже есть активная запись")

    # Длительность — только по нормативам услуг, не вручную
    services_result = await db.execute(select(Service).where(Service.id.in_(payload.service_ids)))
    services = services_result.scalars().all()
    if not services or len(services) != len(payload.service_ids):
        raise HTTPException(status_code=400, detail="Некорректный список услуг")

    total_minutes = sum(s.duration_minutes for s in services)
    total_minutes = min(total_minutes, MAX_BOOKING_MINUTES)

    booking = Booking(
        user_id=user.id,
        car_id=payload.car_id,
        post_id=None,  # пост назначит менеджер при подтверждении
        date=payload.date,
        start_time=payload.start_time,
        duration_minutes=total_minutes,
        status="pending",
        comment=payload.comment,
    )
    db.add(booking)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Этот слот уже занят")

    await db.refresh(booking)
    return {"id": str(booking.id), "status": booking.status, "duration_minutes": booking.duration_minutes}


class BookingConfirm(BaseModel):
    post_id: uuid.UUID
    duration_minutes: int | None = None


@router.post("/{booking_id}/confirm")
async def confirm_booking(booking_id: uuid.UUID, payload: BookingConfirm, db: AsyncSession = Depends(get_db)):
    values = {"status": "confirmed", "post_id": payload.post_id}
    if payload.duration_minutes is not None:
        values["duration_minutes"] = payload.duration_minutes

    result = await db.execute(
        update(Booking).where(Booking.id == booking_id, Booking.status == "pending").values(**values)
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Этот пост уже занят на это время")

    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Запись уже обработана другим менеджером")

    return {"ok": True}


@router.post("/{booking_id}/decline")
async def decline_booking(booking_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        update(Booking).where(Booking.id == booking_id, Booking.status == "pending").values(status="cancelled")
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Запись уже обработана другим менеджером")

    return {"ok": True}
