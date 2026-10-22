import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_manager
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


def _car_data(payload: CarIn) -> dict:
    """Чистим ввод: пробелы, пустые строки -> None, гос. номер и VIN в верхний регистр."""
    data = payload.model_dump()
    data["make"] = data["make"].strip()
    data["model"] = data["model"].strip()
    if not data["make"] or not data["model"]:
        raise HTTPException(status_code=400, detail="Укажите марку и модель")
    for key in ("color", "vin", "plate"):
        data[key] = (data[key] or "").strip() or None
    if data["vin"]:
        data["vin"] = data["vin"].upper()
        if len(data["vin"]) > 17:
            raise HTTPException(status_code=400, detail="VIN — не больше 17 символов")
    if data["plate"]:
        data["plate"] = data["plate"].upper()
        if len(data["plate"]) > 20:
            raise HTTPException(status_code=400, detail="Слишком длинный гос. номер")
    return data


@router.get("", response_model=list[CarOut])
async def list_cars(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Car).where(Car.user_id == user.id).order_by(Car.created_at))
    return result.scalars().all()


@router.post("", response_model=CarOut)
async def create_car(
    payload: CarIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    car = Car(user_id=user.id, **_car_data(payload))
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


@router.get("/by-user/{user_id}", response_model=list[CarOut])
async def list_cars_for_manager(
    user_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Машины конкретного клиента — только для менеджера, используется
    в развёрнутой карточке клиента в /nord/clients."""
    result = await db.execute(select(Car).where(Car.user_id == user_id).order_by(Car.created_at))
    return result.scalars().all()


@router.put("/{car_id}", response_model=CarOut)
async def update_my_car(
    car_id: uuid.UUID, payload: CarIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Car).where(Car.id == car_id, Car.user_id == user.id))
    car = result.scalar_one_or_none()
    if car is None:
        raise HTTPException(status_code=404, detail="Автомобиль не найден")
    for key, value in _car_data(payload).items():
        setattr(car, key, value)
    await db.commit()
    await db.refresh(car)
    return car


@router.post("/by-user/{user_id}", response_model=CarOut)
async def create_car_for_user(
    user_id: uuid.UUID,
    payload: CarIn,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Менеджер добавляет машину любому клиенту — она сразу видна ему в кабинете."""
    owner = await db.get(User, user_id)
    if owner is None or owner.role != "client":
        raise HTTPException(status_code=404, detail="Клиент не найден")
    car = Car(user_id=user_id, **_car_data(payload))
    db.add(car)
    await db.commit()
    await db.refresh(car)
    return car


@router.put("/by-user/{user_id}/{car_id}", response_model=CarOut)
async def update_car_for_user(
    user_id: uuid.UUID,
    car_id: uuid.UUID,
    payload: CarIn,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Car).where(Car.id == car_id, Car.user_id == user_id))
    car = result.scalar_one_or_none()
    if car is None:
        raise HTTPException(status_code=404, detail="Автомобиль не найден")
    for key, value in _car_data(payload).items():
        setattr(car, key, value)
    await db.commit()
    await db.refresh(car)
    return car
