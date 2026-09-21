import pytest
from datetime import date, timedelta

from app.models import Post, Service, User


async def login(client, phone: str) -> str:
    r = await client.post("/auth/request-code", params={"phone": phone})
    code = r.json()["debug_code"]
    r = await client.post("/auth/verify-code", params={"phone": phone, "code": code})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_booking_full_cycle(client, db_session):
    tomorrow = date.today() + timedelta(days=2)

    post = Post(name="Пост для теста", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Замена масла", duration_minutes=90)
    db_session.add_all([post, service])
    await db_session.flush()

    client_token = await login(client, "+79165554433")
    client_headers = {"Authorization": f"Bearer {client_token}"}

    r = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "11:00", "service_ids": [str(service.id)]},
        headers=client_headers,
    )
    assert r.status_code == 200
    booking_id = r.json()["id"]
    assert r.json()["duration_minutes"] == 90

    r_dup = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "12:00", "service_ids": [str(service.id)]},
        headers=client_headers,
    )
    assert r_dup.status_code == 409

    # Обычный клиент не может подтверждать чужие записи
    r_forbidden = await client.post(
        f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)}, headers=client_headers
    )
    assert r_forbidden.status_code == 403

    # Заводим менеджера
    manager_token = await login(client, "+79165550001")
    manager_result = await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550001").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r_confirm = await client.post(
        f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)}, headers=manager_headers
    )
    assert r_confirm.status_code == 200

    r_confirm_again = await client.post(
        f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)}, headers=manager_headers
    )
    assert r_confirm_again.status_code == 409


@pytest.mark.asyncio
async def test_get_my_booking(client, db_session):
    tomorrow = date.today() + timedelta(days=3)

    post = Post(name="Пост для get_my_booking", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Диагностика", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()

    token = await login(client, "+79165554499")
    headers = {"Authorization": f"Bearer {token}"}

    r_empty = await client.get("/bookings/me", headers=headers)
    assert r_empty.status_code == 200
    assert r_empty.json() is None

    await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "10:00", "service_ids": [str(service.id)]},
        headers=headers,
    )

    r = await client.get("/bookings/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
