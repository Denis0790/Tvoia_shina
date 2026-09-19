import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import User, Car

router = APIRouter(prefix="/users/me/cars", tags=["cars"])


class CarIn(BaseModel):
    make: str
    model: str
    color: str | None = None
    vin: str | None = None
    plate: str | None = None


class CarOut(CarIn):
    id: uuid.UUID


@router.get("", response_model=list[CarOut])
async def list_cars(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Car).where(Car.user_id == user.id).order_by(Car.created_at))
    return result.scalars().all()


@router.post("", response_model=CarOut)
async def create_car(
    payload: CarIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    car = Car(user_id=user.id, **payload.model_dump())
    db.add(car)
    await db.commit()
    await db.refresh(car)
    return car


@router.delete("/{car_id}")
async def delete_car(
    car_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Car).where(Car.id == car_id, Car.user_id == user.id))
    car = result.scalar_one_or_none()
    if car is None:
        raise HTTPException(status_code=404, detail="Автомобиль не найден")
    await db.delete(car)
    await db.commit()
    return {"ok": True}
