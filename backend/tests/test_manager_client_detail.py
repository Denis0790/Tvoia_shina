"""Тесты для менеджерских эндпоинтов просмотра конкретного клиента:
машины (cars/by-user) и история записей (bookings/by-user) — используются
в развёрнутой карточке клиента в /nord/clients.
"""

import pytest
from datetime import date, timedelta
from sqlalchemy import select

from app.models import Car, Post, Service, User
from tests.conftest_helpers import register_and_login


async def _make_manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(
        User.__table__.update().where(User.phone == phone).values(role="manager")
    )
    await db_session.flush()
    return token


async def _get_user_id(db_session, phone):
    result = await db_session.execute(select(User).where(User.phone == phone))
    return result.scalar_one().id


@pytest.mark.asyncio
async def test_manager_sees_client_cars(client, db_session):
    client_token = await register_and_login(client, "+79165551111")
    client_headers = {"Authorization": f"Bearer {client_token}"}
    user_id = await _get_user_id(db_session, "+79165551111")

    car = Car(make="Toyota", model="Camry", color="Белый", vin="JTDBE32K000000001", plate="А123ВС777", user_id=user_id)
    db_session.add(car)
    await db_session.flush()

    manager_token = await _make_manager(client, db_session, "+79165552222")
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r = await client.get(f"/users/me/cars/by-user/{user_id}", headers=manager_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["vin"] == "JTDBE32K000000001"

    r_forbidden = await client.get(f"/users/me/cars/by-user/{user_id}", headers=client_headers)
    assert r_forbidden.status_code == 403


@pytest.mark.asyncio
async def test_manager_sees_client_bookings_history(client, db_session):
    tomorrow = date.today() + timedelta(days=1)
    post = Post(name="Пост", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="ТО", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()

    client_token = await register_and_login(client, "+79165553333")
    client_headers = {"Authorization": f"Bearer {client_token}"}
    user_id = await _get_user_id(db_session, "+79165553333")

    r = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "10:00", "service_ids": [str(service.id)]},
        headers=client_headers,
    )
    assert r.status_code == 200

    manager_token = await _make_manager(client, db_session, "+79165554444")
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r_hist = await client.get(f"/bookings/by-user/{user_id}", headers=manager_headers)
    assert r_hist.status_code == 200
    data = r_hist.json()
    assert len(data) == 1
    assert data[0]["status"] == "pending"

    r_forbidden = await client.get(f"/bookings/by-user/{user_id}", headers=client_headers)
    assert r_forbidden.status_code == 403


@pytest.mark.asyncio
async def test_manager_client_isolation(client, db_session):
    """Менеджер должен видеть машины именно того клиента, чей id запросил,
    а не случайно чужие данные (защита от перепутывания в запросе)."""
    token_a = await register_and_login(client, "+79165555555")
    user_a_id = await _get_user_id(db_session, "+79165555555")

    await register_and_login(client, "+79165556666")
    user_b_id = await _get_user_id(db_session, "+79165556666")

    car_a = Car(make="Kia", model="Rio", color="Чёрный", vin="XWEPH812BE0000002", plate="В456ОР777", user_id=user_a_id)
    car_b = Car(make="BMW", model="X5", color="Синий", vin="WBAFR9C50BC000003", plate="С789ТУ777", user_id=user_b_id)
    db_session.add_all([car_a, car_b])
    await db_session.flush()

    manager_token = await _make_manager(client, db_session, "+79165557777")
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r = await client.get(f"/users/me/cars/by-user/{user_a_id}", headers=manager_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["vin"] == "XWEPH812BE0000002"
