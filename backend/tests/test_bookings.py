import pytest
from datetime import date, timedelta

from app.models import Post, Service


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

    token = await login(client, "+79165554433")
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "11:00", "service_ids": [str(service.id)]},
        headers=headers,
    )
    assert r.status_code == 200
    booking_id = r.json()["id"]
    assert r.json()["duration_minutes"] == 90

    r_dup = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "12:00", "service_ids": [str(service.id)]},
        headers=headers,
    )
    assert r_dup.status_code == 409

    r_confirm = await client.post(f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)})
    assert r_confirm.status_code == 200

    r_confirm_again = await client.post(f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)})
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
