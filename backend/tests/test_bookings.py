import pytest
from datetime import date, timedelta

from sqlalchemy import select

from app.models import Booking, Post, Service, User
from tests.conftest_helpers import register_and_login


@pytest.mark.asyncio
async def test_booking_full_cycle(client, db_session):
    tomorrow = date.today() + timedelta(days=2)

    post = Post(name="Пост для теста", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Замена масла", duration_minutes=90)
    db_session.add_all([post, service])
    await db_session.flush()

    client_token = await register_and_login(client, "+79165554433")
    client_headers = {"Authorization": f"Bearer {client_token}"}

    r = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "11:00", "service_ids": [str(service.id)]},
        headers=client_headers,
    )
    assert r.status_code == 200
    booking_id = r.json()["id"]
    assert r.json()["duration_minutes"] == 90

    # то же время второй раз нельзя, а на другое время можно (несколько активных записей)
    r_dup = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "11:00", "service_ids": [str(service.id)]},
        headers=client_headers,
    )
    assert r_dup.status_code == 409
    r_other = await client.post(
        "/bookings",
        json={"date": str(tomorrow), "start_time": "15:00", "service_ids": [str(service.id)]},
        headers=client_headers,
    )
    assert r_other.status_code == 200

    r_forbidden = await client.post(
        f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)}, headers=client_headers
    )
    assert r_forbidden.status_code == 403

    manager_token = await register_and_login(client, "+79165550001")
    await db_session.execute(
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

    token = await register_and_login(client, "+79165554499")
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



@pytest.mark.asyncio
async def test_confirm_booking_rejects_overlapping_post(client, db_session):
    target_date = date.today() + timedelta(days=4)

    post = Post(name="Пост для пересечений", work_start="09:00", work_end="18:00", work_days="1111111")
    # Второй пост нужен, чтобы две пересекающиеся заявки разошлись по постам при автоподборе
    post_b = Post(name="Пост для пересечений 2", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Шиномонтаж", duration_minutes=90)
    db_session.add_all([post, post_b, service])
    await db_session.flush()
    await db_session.execute(
        Post.__table__.update().where(Post.id.notin_([post.id, post_b.id])).values(work_days="0000000")
    )

    client1_token = await register_and_login(client, "+79165554511")
    client2_token = await register_and_login(client, "+79165554522")

    r1 = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "11:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {client1_token}"},
    )
    booking1_id = r1.json()["id"]

    r2 = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "12:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {client2_token}"},
    )
    booking2_id = r2.json()["id"]

    manager_token = await register_and_login(client, "+79165550002")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550002").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r_confirm1 = await client.post(
        f"/bookings/{booking1_id}/confirm", json={"post_id": str(post.id)}, headers=manager_headers
    )
    assert r_confirm1.status_code == 200

    # 11:00-12:30 и 12:00-13:30 пересекаются на одном посту — второй confirm должен быть отклонён
    r_confirm2 = await client.post(
        f"/bookings/{booking2_id}/confirm", json={"post_id": str(post.id)}, headers=manager_headers
    )
    assert r_confirm2.status_code == 409


@pytest.mark.asyncio
async def test_create_booking_rejects_past_time_today(client, db_session):
    service = Service(name="Экспресс-диагностика", duration_minutes=30)
    db_session.add(service)
    await db_session.flush()

    token = await register_and_login(client, "+79165554533")
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post(
        "/bookings",
        json={"date": str(date.today()), "start_time": "00:00", "service_ids": [str(service.id)]},
        headers=headers,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_get_my_booking_hides_finished_today(client, db_session):
    token = await register_and_login(client, "+79165554544")
    headers = {"Authorization": f"Bearer {token}"}

    result = await db_session.execute(select(User).where(User.phone == "+79165554544"))
    user = result.scalar_one()

    booking = Booking(
        user_id=user.id,
        car_id=None,
        post_id=None,
        date=date.today(),
        start_time="00:00",
        duration_minutes=30,
        status="confirmed",
        comment=None,
    )
    db_session.add(booking)
    await db_session.flush()

    r = await client.get("/bookings/me", headers=headers)
    assert r.status_code == 200
    assert r.json() is None


@pytest.mark.asyncio
async def test_confirm_with_start_time_override(client, db_session):
    target_date = date.today() + timedelta(days=5)

    post = Post(name="Пост для переноса времени", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="ТО", duration_minutes=90)
    db_session.add_all([post, service])
    await db_session.flush()

    client_token = await register_and_login(client, "+79165554555")
    r = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "11:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    booking_id = r.json()["id"]

    manager_token = await register_and_login(client, "+79165550003")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550003").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r_confirm = await client.post(
        f"/bookings/{booking_id}/confirm",
        json={"post_id": str(post.id), "start_time": "13:00"},
        headers=manager_headers,
    )
    assert r_confirm.status_code == 200

    result = await db_session.execute(select(User).where(User.phone == "+79165554555"))
    user = result.scalar_one()
    r_history = await client.get(f"/bookings/by-user/{user.id}", headers=manager_headers)
    booking = r_history.json()[0]
    assert booking["start_time"] == "13:00"


@pytest.mark.asyncio
async def test_reschedule_booking_and_rejects_overlap(client, db_session):
    target_date = date.today() + timedelta(days=6)

    post_a = Post(name="Пост А", work_start="09:00", work_end="18:00", work_days="1111111")
    post_b = Post(name="Пост Б", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Балансировка", duration_minutes=60)
    db_session.add_all([post_a, post_b, service])
    await db_session.flush()

    client1_token = await register_and_login(client, "+79165554566")
    client2_token = await register_and_login(client, "+79165554577")

    r1 = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "10:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {client1_token}"},
    )
    booking1_id = r1.json()["id"]

    r2 = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "14:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {client2_token}"},
    )
    booking2_id = r2.json()["id"]

    manager_token = await register_and_login(client, "+79165550004")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550004").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    await client.post(f"/bookings/{booking1_id}/confirm", json={"post_id": str(post_a.id)}, headers=manager_headers)
    await client.post(f"/bookings/{booking2_id}/confirm", json={"post_id": str(post_b.id)}, headers=manager_headers)

    # Переносим booking1 на пост Б на 10:00 — не пересекается с 14:00, должно пройти
    r_ok = await client.post(
        f"/bookings/{booking1_id}/reschedule",
        json={"post_id": str(post_b.id), "start_time": "10:00"},
        headers=manager_headers,
    )
    assert r_ok.status_code == 200

    # Теперь переносим его же на 14:30 на посту Б — пересекается с booking2 (14:00-15:00)
    r_overlap = await client.post(
        f"/bookings/{booking1_id}/reschedule",
        json={"post_id": str(post_b.id), "start_time": "14:30"},
        headers=manager_headers,
    )
    assert r_overlap.status_code == 409


@pytest.mark.asyncio
async def test_cancel_confirmed_booking(client, db_session):
    target_date = date.today() + timedelta(days=7)

    post = Post(name="Пост для отмены", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Замена колодок", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()

    client_token = await register_and_login(client, "+79165554588")
    r = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "09:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    booking_id = r.json()["id"]

    manager_token = await register_and_login(client, "+79165550005")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550005").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    await client.post(f"/bookings/{booking_id}/confirm", json={"post_id": str(post.id)}, headers=manager_headers)

    r_cancel = await client.post(f"/bookings/{booking_id}/cancel", headers=manager_headers)
    assert r_cancel.status_code == 200

    result = await db_session.execute(select(User).where(User.phone == "+79165554588"))
    user = result.scalar_one()
    r_history = await client.get(f"/bookings/by-user/{user.id}", headers=manager_headers)
    assert r_history.json()[0]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_create_booking_auto_assigns_free_post(client, db_session):
    target_date = date.today() + timedelta(days=8)

    post = Post(name="Единственный пост", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Развал-схождение", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()
    await db_session.execute(
        Post.__table__.update().where(Post.id != post.id).values(work_days="0000000")
    )

    token = await register_and_login(client, "+79165555511")
    r = await client.post(
        "/bookings",
        json={"date": str(target_date), "start_time": "10:00", "service_ids": [str(service.id)]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    manager_token = await register_and_login(client, "+79165550006")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550006").values(role="manager")
    )
    await db_session.flush()
    r_cal = await client.get(
        f"/bookings/calendar?target_date={target_date}",
        headers={"Authorization": f"Bearer {manager_token}"},
    )
    cal_posts = r_cal.json()["posts"]
    assert "pending" not in r_cal.json()
    post_data = next(p for p in cal_posts if p["post_id"] == str(post.id))
    slot = next(s for s in post_data["slots"] if s["time"] == "10:00")
    assert slot["status"] == "pending"
    assert slot["booking"]["post_id"] == str(post.id)


@pytest.mark.asyncio
async def test_create_booking_with_specific_post_and_rejects_when_busy(client, db_session):
    target_date = date.today() + timedelta(days=9)

    post_a = Post(name="Пост А2", work_start="09:00", work_end="18:00", work_days="1111111")
    post_b = Post(name="Пост Б2", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Чистка форсунок", duration_minutes=60)
    db_session.add_all([post_a, post_b, service])
    await db_session.flush()

    token1 = await register_and_login(client, "+79165555522")
    r1 = await client.post(
        "/bookings",
        json={
            "date": str(target_date),
            "start_time": "11:00",
            "service_ids": [str(service.id)],
            "post_id": str(post_a.id),
        },
        headers={"Authorization": f"Bearer {token1}"},
    )
    assert r1.status_code == 200

    token2 = await register_and_login(client, "+79165555533")
    r2 = await client.post(
        "/bookings",
        json={
            "date": str(target_date),
            "start_time": "11:00",
            "service_ids": [str(service.id)],
            "post_id": str(post_a.id),
        },
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert r2.status_code == 409

    r_unknown = await client.post(
        "/bookings",
        json={
            "date": str(target_date),
            "start_time": "11:00",
            "service_ids": [str(service.id)],
            "post_id": "00000000-0000-0000-0000-000000000000",
        },
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert r_unknown.status_code == 404


@pytest.mark.asyncio
async def test_create_booking_respects_schedule_exception_day_off(client, db_session):
    from app.models import ScheduleException

    target_date = date.today() + timedelta(days=12)

    post = Post(name="Единственный пост на отдыхе", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Мойка", duration_minutes=30)
    db_session.add_all([post, service])
    await db_session.flush()

    db_session.add(ScheduleException(post_id=post.id, date=target_date, is_working=False))
    await db_session.flush()

    token = await register_and_login(client, "+79165555544")
    r = await client.post(
        "/bookings",
        json={
            "date": str(target_date),
            "start_time": "10:00",
            "service_ids": [str(service.id)],
            "post_id": str(post.id),
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_move_pending_booking(client, db_session):
    target_date = date.today() + timedelta(days=13)

    post_a = Post(name="Пост В", work_start="09:00", work_end="18:00", work_days="1111111")
    post_b = Post(name="Пост Г", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Шумоизоляция", duration_minutes=60)
    db_session.add_all([post_a, post_b, service])
    await db_session.flush()

    token = await register_and_login(client, "+79165555555")
    r = await client.post(
        "/bookings",
        json={
            "date": str(target_date),
            "start_time": "10:00",
            "service_ids": [str(service.id)],
            "post_id": str(post_a.id),
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    booking_id = r.json()["id"]

    manager_token = await register_and_login(client, "+79165550007")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165550007").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r_move = await client.post(
        f"/bookings/{booking_id}/move",
        json={"post_id": str(post_b.id), "start_time": "13:00"},
        headers=manager_headers,
    )
    assert r_move.status_code == 200

    result = await db_session.execute(select(User).where(User.phone == "+79165555555"))
    user = result.scalar_one()
    r_history = await client.get(f"/bookings/by-user/{user.id}", headers=manager_headers)
    assert r_history.json()[0]["start_time"] == "13:00"


@pytest.mark.asyncio
async def test_move_pending_booking_to_another_date(client, db_session):
    target_date = date.today() + timedelta(days=15)
    new_date = target_date + timedelta(days=1)

    post = Post(name="Пост Д", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Полировка", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()

    token = await register_and_login(client, "+79165557701")
    r = await client.post(
        "/bookings",
        json={
            "date": str(target_date),
            "start_time": "10:00",
            "service_ids": [str(service.id)],
            "post_id": str(post.id),
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    booking_id = r.json()["id"]

    manager_token = await register_and_login(client, "+79165557702")
    await db_session.execute(
        User.__table__.update().where(User.phone == "+79165557702").values(role="manager")
    )
    await db_session.flush()
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    r_move = await client.post(
        f"/bookings/{booking_id}/move",
        json={"post_id": str(post.id), "start_time": "14:00", "date": str(new_date)},
        headers=manager_headers,
    )
    assert r_move.status_code == 200

    result = await db_session.execute(select(User).where(User.phone == "+79165557701"))
    user = result.scalar_one()
    r_history = await client.get(f"/bookings/by-user/{user.id}", headers=manager_headers)
    moved = r_history.json()[0]
    assert moved["start_time"] == "14:00"
    assert str(moved["date"])[:10] == str(new_date)


async def _manual_manager_headers(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_manual_booking_for_unregistered_client_then_claimed_on_registration(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559901")
    post = Post(name="Пост запись с улицы", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=25)
    guest_phone = "+79165559902"
    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(day),
            "start_time": "10:00",
            "duration_minutes": 60,
            "phone": guest_phone,
            "client_name": "Иван",
            "car_make": "Toyota",
            "car_model": "Camry",
            "vin": "xta12345678901234",
            "comment": "Замена колодок",
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["created_user"] is True
    guest_user_id = r.json()["user_id"]

    r_cal = await client.get(f"/bookings/calendar?target_date={day}", headers=headers)
    post_data = next(p for p in r_cal.json()["posts"] if p["post_id"] == str(post.id))
    slot = next(s for s in post_data["slots"] if s["time"] == "10:00")
    assert slot["status"] == "confirmed"
    assert slot["booking"]["client_name"] == "Иван"
    assert slot["booking"]["car"]["vin"] == "XTA12345678901234"

    # клиент позже пытается зарегистрироваться с этим же номером: сразу привязать нельзя (номер не подтверждается),
    # его просят позвонить, а менеджер привязывает почту
    from app.redis_client import redis_client

    email = "guest-claim@example.com"
    code = (await client.post("/auth/request-code", params={"email": email})).json()["debug_code"]
    ticket = (await client.post("/auth/verify-code", params={"email": email, "code": code})).json()["ticket"]
    r_reg = await client.post(
        "/auth/set-password", params={"ticket": ticket, "password": "pass1234", "phone": guest_phone, "consent": True}
    )
    assert r_reg.status_code == 409

    r_mail = await client.put(f"/users/clients/{guest_user_id}/email", json={"email": email}, headers=headers)
    assert r_mail.status_code == 200

    # после привязки почты клиент входит по коду и попадает в тот же профиль, запись у него
    await redis_client.delete(f"otp_cooldown:{email}")
    code = (await client.post("/auth/request-code", params={"email": email})).json()["debug_code"]
    ticket = (await client.post("/auth/verify-code", params={"email": email, "code": code})).json()["ticket"]
    r_pw = await client.post("/auth/set-password", params={"ticket": ticket, "password": "pass1234", "consent": True})
    assert r_pw.status_code == 200
    client_token = r_pw.json()["access_token"]
    users = (await db_session.execute(select(User).where(User.phone == guest_phone))).scalars().all()
    assert len(users) == 1
    assert str(users[0].id) == guest_user_id

    r_me = await client.get("/bookings/me", headers={"Authorization": f"Bearer {client_token}"})
    assert r_me.status_code == 200
    assert r_me.json()["status"] == "confirmed"


@pytest.mark.asyncio
async def test_manual_booking_reuses_existing_client_by_phone(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559903")
    post = Post(name="Пост повторный клиент", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=26)
    base = {"post_id": str(post.id), "phone": "+79165559904", "duration_minutes": 30}
    r1 = await client.post("/bookings/manual", json={**base, "date": str(day), "start_time": "10:00"}, headers=headers)
    r2 = await client.post(
        "/bookings/manual", json={**base, "date": str(day), "start_time": "12:00"}, headers=headers
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["created_user"] is True
    assert r2.json()["created_user"] is False
    assert r1.json()["user_id"] == r2.json()["user_id"]


@pytest.mark.asyncio
async def test_manual_booking_rejects_overlap(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559905")
    post = Post(name="Пост пересечение вручную", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=27)
    r1 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "10:00", "duration_minutes": 90, "phone": "+79165559906"},
        headers=headers,
    )
    assert r1.status_code == 200
    r2 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "11:00", "duration_minutes": 60, "phone": "+79165559907"},
        headers=headers,
    )
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_manual_booking_requires_manager(client, db_session):
    post = Post(name="Пост доступ", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    token = await register_and_login(client, "+79165559908")
    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(date.today() + timedelta(days=28)),
            "start_time": "10:00",
            "phone": "+79165559909",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_manual_booking_without_phone(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559911")
    post = Post(name="Пост без телефона", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=29)
    r1 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "10:00", "duration_minutes": 60, "client_name": "Сергей"},
        headers=headers,
    )
    r2 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "12:00", "duration_minutes": 30},
        headers=headers,
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["created_user"] is True and r2.json()["created_user"] is True
    assert r1.json()["user_id"] != r2.json()["user_id"]

    r_cal = await client.get(f"/bookings/calendar?target_date={day}", headers=headers)
    assert r_cal.status_code == 200
    post_data = next(p for p in r_cal.json()["posts"] if p["post_id"] == str(post.id))
    names = {s["time"]: s["booking"]["client_name"] for s in post_data["slots"] if s.get("booking")}
    assert names["10:00"] == "Сергей"
    assert names["12:00"] == "Гость"


@pytest.mark.asyncio
async def test_manual_booking_lookup_and_existing_car(client, db_session):
    from app.models import Car

    headers = await _manual_manager_headers(client, db_session, "+79165559912")
    post = Post(name="Пост подстановка", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=30)
    phone = "+79165559913"

    r_none = await client.get("/bookings/manual/client", params={"phone": phone}, headers=headers)
    assert r_none.status_code == 200
    assert r_none.json() == {"found": False}

    r1 = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id), "date": str(day), "start_time": "10:00", "duration_minutes": 60,
            "phone": phone, "client_name": "Пётр", "car_make": "Kia", "car_model": "Rio", "vin": "KIA12345678901234",
        },
        headers=headers,
    )
    assert r1.status_code == 200

    r_found = await client.get("/bookings/manual/client", params={"phone": phone}, headers=headers)
    found = r_found.json()
    assert found["found"] is True
    assert found["full_name"] == "Пётр"
    assert len(found["cars"]) == 1
    assert found["cars"][0]["vin"] == "KIA12345678901234"
    car_id = found["cars"][0]["id"]

    # вторая запись — на уже существующую машину клиента, без дубля
    r2 = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id), "date": str(day), "start_time": "13:00", "duration_minutes": 60,
            "phone": phone, "car_id": car_id,
        },
        headers=headers,
    )
    assert r2.status_code == 200
    assert r2.json()["created_user"] is False

    cars = (await db_session.execute(select(Car).where(Car.user_id == found["user_id"]))).scalars().all()
    assert len(cars) == 1

    r_cal = await client.get(f"/bookings/calendar?target_date={day}", headers=headers)
    post_data = next(p for p in r_cal.json()["posts"] if p["post_id"] == str(post.id))
    slot = next(s for s in post_data["slots"] if s["time"] == "13:00")
    assert slot["booking"]["car"]["vin"] == "KIA12345678901234"

    # чужая машина не принимается
    r_other = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id), "date": str(day), "start_time": "15:00", "duration_minutes": 60,
            "phone": "+79165559914", "car_id": car_id,
        },
        headers=headers,
    )
    assert r_other.status_code == 400


@pytest.mark.asyncio
async def test_manual_booking_client_search_by_phone_prefix(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559915")
    post = Post(name="Пост поиск", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=31)
    for i, phone in enumerate(["+79161110001", "+79161110002"]):
        r = await client.post(
            "/bookings/manual",
            json={
                "post_id": str(post.id), "date": str(day), "start_time": f"{10 + i}:00", "duration_minutes": 30,
                "phone": phone, "client_name": f"Клиент {i + 1}", "car_make": "Lada", "car_model": "Vesta",
            },
            headers=headers,
        )
        assert r.status_code == 200

    r_two = await client.get("/bookings/manual/clients", params={"q": "9161110"}, headers=headers)
    assert r_two.status_code == 200
    assert sorted(u["phone"] for u in r_two.json()) == ["+79161110001", "+79161110002"]
    assert r_two.json()[0]["cars"][0]["model"] == "Vesta"

    r_one = await client.get("/bookings/manual/clients", params={"q": "9161110002"}, headers=headers)
    assert [u["phone"] for u in r_one.json()] == ["+79161110002"]

    r_short = await client.get("/bookings/manual/clients", params={"q": "91"}, headers=headers)
    assert r_short.json() == []

    r_none = await client.get("/bookings/manual/clients", params={"q": "9990009"}, headers=headers)
    assert r_none.json() == []


@pytest.mark.asyncio
async def test_manual_client_search_limits_to_three_most_relevant(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559916")
    post = Post(name="Пост релевантность", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    base_day = date.today() + timedelta(days=40)
    # у клиента с бо́льшим номером запись позже — он должен быть первым
    for i in range(1, 5):
        r = await client.post(
            "/bookings/manual",
            json={
                "post_id": str(post.id),
                "date": str(base_day + timedelta(days=i)),
                "start_time": "10:00",
                "duration_minutes": 30,
                "phone": f"+7916222000{i}",
                "client_name": f"Клиент {i}",
            },
            headers=headers,
        )
        assert r.status_code == 200

    r = await client.get("/bookings/manual/clients", params={"q": "9162220"}, headers=headers)
    assert r.status_code == 200
    assert [u["phone"] for u in r.json()] == ["+79162220004", "+79162220003", "+79162220002"]


@pytest.mark.asyncio
async def test_manual_booking_reuses_car_by_make_model_and_orders_by_recent_use(client, db_session):
    from app.models import Car

    headers = await _manual_manager_headers(client, db_session, "+79165559917")
    post = Post(name="Пост машины", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    base_day = date.today() + timedelta(days=50)
    phone = "+79163330001"

    def payload(offset, make, model, vin=None):
        return {
            "post_id": str(post.id), "date": str(base_day + timedelta(days=offset)), "start_time": "10:00",
            "duration_minutes": 30, "phone": phone, "car_make": make, "car_model": model, "vin": vin,
        }

    assert (await client.post("/bookings/manual", json=payload(0, "Kia", "Rio"), headers=headers)).status_code == 200
    # та же машина без VIN, другой регистр — не создаёт дубль
    assert (await client.post("/bookings/manual", json=payload(1, "kia", "RIO"), headers=headers)).status_code == 200
    # другая машина
    assert (await client.post("/bookings/manual", json=payload(2, "Lada", "Vesta"), headers=headers)).status_code == 200
    # снова Kia Rio — последняя использованная должна быть первой в списке
    assert (await client.post("/bookings/manual", json=payload(3, "Kia", "Rio"), headers=headers)).status_code == 200

    found = (await client.get("/bookings/manual/clients", params={"q": "9163330001"}, headers=headers)).json()
    assert len(found) == 1
    cars = found[0]["cars"]
    assert len(cars) == 2
    assert (cars[0]["make"], cars[0]["model"]) == ("Kia", "Rio")
    assert (cars[1]["make"], cars[1]["model"]) == ("Lada", "Vesta")


@pytest.mark.asyncio
async def test_manual_booking_reuses_car_by_make_model_and_orders_by_recent_use(client, db_session):
    from app.models import Car

    headers = await _manual_manager_headers(client, db_session, "+79165559917")
    post = Post(name="Пост машины", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    base_day = date.today() + timedelta(days=50)
    phone = "+79163330001"

    def payload(offset, make, model, vin=None):
        return {
            "post_id": str(post.id), "date": str(base_day + timedelta(days=offset)), "start_time": "10:00",
            "duration_minutes": 30, "phone": phone, "car_make": make, "car_model": model, "vin": vin,
        }

    assert (await client.post("/bookings/manual", json=payload(0, "Kia", "Rio"), headers=headers)).status_code == 200
    # та же машина без VIN, другой регистр — не создаёт дубль
    assert (await client.post("/bookings/manual", json=payload(1, "kia", "RIO"), headers=headers)).status_code == 200
    # другая машина
    assert (await client.post("/bookings/manual", json=payload(2, "Lada", "Vesta"), headers=headers)).status_code == 200
    # снова Kia Rio — последняя использованная должна быть первой в списке
    assert (await client.post("/bookings/manual", json=payload(3, "Kia", "Rio"), headers=headers)).status_code == 200

    found = (await client.get("/bookings/manual/clients", params={"q": "9163330001"}, headers=headers)).json()
    assert len(found) == 1
    cars = found[0]["cars"]
    assert len(cars) == 2
    assert (cars[0]["make"], cars[0]["model"]) == ("Kia", "Rio")
    assert (cars[1]["make"], cars[1]["model"]) == ("Lada", "Vesta")


@pytest.mark.asyncio
async def test_manual_client_search_shows_upcoming_bookings(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559918")
    post = Post(name="Пост подсказка", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    d1 = date.today() + timedelta(days=60)
    d2 = date.today() + timedelta(days=61)
    phone = "+79164440001"

    def payload(day):
        return {
            "post_id": str(post.id), "date": str(day), "start_time": "10:00",
            "duration_minutes": 30, "phone": phone,
        }

    r_late = await client.post("/bookings/manual", json=payload(d2), headers=headers)
    r_early = await client.post("/bookings/manual", json=payload(d1), headers=headers)
    assert r_late.status_code == 200 and r_early.status_code == 200

    found = (await client.get("/bookings/manual/clients", params={"q": "9164440001"}, headers=headers)).json()
    assert len(found) == 1
    assert found[0]["upcoming_total"] == 2
    assert found[0]["upcoming"][0] == {
        "date": str(d1), "start_time": "10:00", "post_name": "Пост подсказка", "status": "confirmed",
    }
    assert found[0]["upcoming"][1]["date"] == str(d2)

    # отменённая запись в «уже записан» не попадает
    r_cancel = await client.post(f"/bookings/{r_late.json()['id']}/cancel", headers=headers)
    assert r_cancel.status_code == 200
    found = (await client.get("/bookings/manual/clients", params={"q": "9164440001"}, headers=headers)).json()
    assert found[0]["upcoming_total"] == 1


@pytest.mark.asyncio
async def test_cancelled_booking_does_not_block_same_slot(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559919")
    post = Post(name="Пост отмена слот", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=45)

    def payload(phone):
        return {
            "post_id": str(post.id), "date": str(day), "start_time": "11:00",
            "duration_minutes": 60, "phone": phone,
        }

    r1 = await client.post("/bookings/manual", json=payload("+79165559920"), headers=headers)
    assert r1.status_code == 200

    # пока запись активна — то же время занято
    r_busy = await client.post("/bookings/manual", json=payload("+79165559921"), headers=headers)
    assert r_busy.status_code == 409

    r_cancel = await client.post(f"/bookings/{r1.json()['id']}/cancel", headers=headers)
    assert r_cancel.status_code == 200

    # после отмены то же время снова свободно
    r2 = await client.post("/bookings/manual", json=payload("+79165559921"), headers=headers)
    assert r2.status_code == 200


@pytest.mark.asyncio
async def test_manual_booking_saves_services(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559941")
    post = Post(name="Пост услуги ручная", work_start="09:00", work_end="18:00", work_days="1111111")
    s1 = Service(name="Замена масла ручная", duration_minutes=45)
    s2 = Service(name="Развал-схождение ручная", duration_minutes=60)
    db_session.add_all([post, s1, s2])
    await db_session.flush()

    day = date.today() + timedelta(days=26)
    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(day),
            "start_time": "10:00",
            "duration_minutes": 105,
            "phone": "+79165559942",
            "service_ids": [str(s1.id), str(s2.id), str(s1.id)],  # дубликат не мешает
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text

    history = await client.get(f"/users/clients/{r.json()['user_id']}/bookings", headers=headers)
    assert sorted(x["name"] for x in history.json()[0]["services"]) == sorted([s1.name, s2.name])


@pytest.mark.asyncio
async def test_manual_booking_rejects_unknown_service(client, db_session):
    import uuid

    headers = await _manual_manager_headers(client, db_session, "+79165559943")
    post = Post(name="Пост услуги ручная 2", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(date.today() + timedelta(days=27)),
            "start_time": "10:00",
            "duration_minutes": 60,
            "service_ids": [str(uuid.uuid4())],
        },
        headers=headers,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_manual_booking_services_text(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559944")
    post = Post(name="Пост текст услуг", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=28)
    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(day),
            "start_time": "10:00",
            "duration_minutes": 60,
            "phone": "+79165559945",
            "services_text": "  Замена масла, балансировка  ",
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    booking_id = r.json()["id"]

    cal = await client.get("/bookings/calendar", params={"target_date": str(day)}, headers=headers)
    found = [
        s["booking"]
        for p in cal.json()["posts"]
        for s in p["slots"]
        if s.get("booking") and s["booking"]["id"] == booking_id
    ]
    assert found and found[0]["services_text"] == "Замена масла, балансировка"

    history = await client.get(f"/users/clients/{r.json()['user_id']}/bookings", headers=headers)
    assert history.json()[0]["services_text"] == "Замена масла, балансировка"


@pytest.mark.asyncio
async def test_manual_booking_services_text_too_long(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559946")
    post = Post(name="Пост текст услуг 2", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(date.today() + timedelta(days=29)),
            "start_time": "10:00",
            "duration_minutes": 60,
            "services_text": "x" * 501,
        },
        headers=headers,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_cannot_book_or_reschedule_into_the_past(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559961")
    post = Post(name="Пост прошлое", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    yesterday = date.today() - timedelta(days=1)
    body = {"post_id": str(post.id), "date": str(yesterday), "start_time": "10:00", "duration_minutes": 30}
    r = await client.post("/bookings/manual", json=body, headers=headers)
    assert r.status_code == 400

    # сегодня записать можно с текущего получасового слота (клиент уже в сервисе)
    from app.routers.bookings import _now_msk

    now = _now_msk()
    slot = now.hour * 60 + now.minute
    slot -= slot % 30
    r = await client.post(
        "/bookings/manual",
        json={**body, "date": str(now.date()), "start_time": f"{slot // 60:02d}:{slot % 60:02d}"},
        headers=headers,
    )
    assert r.status_code == 200
    booking_id = r.json()["id"]

    r = await client.post(
        f"/bookings/{booking_id}/reschedule",
        json={"post_id": str(post.id), "start_time": "11:00", "date": str(yesterday)},
        headers=headers,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_cannot_move_pending_into_the_past(client, db_session):
    from datetime import datetime, time as dtime

    headers = await _manual_manager_headers(client, db_session, "+79165559962")
    owner = (await db_session.execute(select(User).where(User.phone == "+79165559962"))).scalar_one()
    post = Post(name="Пост прошлое 2", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    booking = Booking(
        user_id=owner.id,
        post_id=post.id,
        date=datetime.combine(date.today() + timedelta(days=3), dtime()),
        start_time="12:00",
        duration_minutes=30,
        status="pending",
    )
    db_session.add(booking)
    await db_session.flush()

    r = await client.post(
        f"/bookings/{booking.id}/move",
        json={"post_id": str(post.id), "start_time": "13:00", "date": str(date.today() - timedelta(days=1))},
        headers=headers,
    )
    assert r.status_code == 400



# ---------- перенос длинных записей по дням ----------

async def _day_blocks(client, headers, day, post_id):
    r = await client.get("/bookings/calendar", params={"target_date": str(day)}, headers=headers)
    assert r.status_code == 200, r.text
    p = next(p for p in r.json()["posts"] if p["post_id"] == str(post_id))
    return [s["booking"] for s in p["slots"] if s.get("booking") and s["is_start"]]


async def _long_post(db_session, name):
    post = Post(name=name, work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    return post


@pytest.mark.asyncio
async def test_long_manual_booking_carries_over_to_next_day(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559971")
    post = await _long_post(db_session, "Пост перенос 1")
    day = date.today() + timedelta(days=70)

    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "13:00", "duration_minutes": 600, "phone": "+79165559972"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["segments"] == 2

    d1 = await _day_blocks(client, headers, day, post.id)
    d2 = await _day_blocks(client, headers, day + timedelta(days=1), post.id)
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d1] == [("13:00", 300, 0)]
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d2] == [("09:00", 300, 1)]
    assert d1[0]["group_id"] == d2[0]["group_id"] and d1[0]["group_id"] is not None


@pytest.mark.asyncio
async def test_short_booking_has_no_group(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559973")
    post = await _long_post(db_session, "Пост перенос 2")
    day = date.today() + timedelta(days=71)

    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "10:00", "duration_minutes": 120, "phone": "+79165559974"},
        headers=headers,
    )
    assert r.status_code == 200 and r.json()["segments"] == 1
    blocks = await _day_blocks(client, headers, day, post.id)
    assert blocks[0]["group_id"] is None and blocks[0]["part"] == 0


@pytest.mark.asyncio
async def test_carry_over_skips_days_off(client, db_session):
    from datetime import datetime, time
    from app.models import ScheduleException

    headers = await _manual_manager_headers(client, db_session, "+79165559975")
    post = await _long_post(db_session, "Пост перенос 3")
    day = date.today() + timedelta(days=72)
    db_session.add(
        ScheduleException(post_id=post.id, date=datetime.combine(day + timedelta(days=1), time()), is_working=False, kind="vacation")
    )
    await db_session.flush()

    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "16:00", "duration_minutes": 180, "phone": "+79165559976"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert [b["duration_minutes"] for b in await _day_blocks(client, headers, day, post.id)] == [120]
    assert await _day_blocks(client, headers, day + timedelta(days=1), post.id) == []
    d3 = await _day_blocks(client, headers, day + timedelta(days=2), post.id)
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d3] == [("09:00", 60, 1)]


@pytest.mark.asyncio
async def test_carry_over_goes_around_busy_morning(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559977")
    post = await _long_post(db_session, "Пост перенос 4")
    day = date.today() + timedelta(days=73)
    nxt = day + timedelta(days=1)

    r0 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(nxt), "start_time": "09:00", "duration_minutes": 120, "phone": "+79165559978"},
        headers=headers,
    )
    assert r0.status_code == 200
    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "17:00", "duration_minutes": 120, "phone": "+79165559979"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    d2 = await _day_blocks(client, headers, nxt, post.id)
    assert sorted((b["start_time"], b["part"]) for b in d2) == [("09:00", 0), ("11:00", 1)]


@pytest.mark.asyncio
async def test_long_booking_first_segment_must_be_free(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559980")
    post = await _long_post(db_session, "Пост перенос 5")
    day = date.today() + timedelta(days=74)

    r0 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "15:00", "duration_minutes": 60, "phone": "+79165559981"},
        headers=headers,
    )
    assert r0.status_code == 200
    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "14:00", "duration_minutes": 600, "phone": "+79165559982"},
        headers=headers,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_cancel_and_reschedule_apply_to_whole_group(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559983")
    post = await _long_post(db_session, "Пост перенос 6")
    day = date.today() + timedelta(days=75)

    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "13:00", "duration_minutes": 600, "phone": "+79165559984"},
        headers=headers,
    )
    first_id = r.json()["id"]
    cont = (await _day_blocks(client, headers, day + timedelta(days=1), post.id))[0]

    # продолжение само по себе не двигается
    r_bad = await client.post(
        f"/bookings/{cont['id']}/reschedule",
        json={"post_id": str(post.id), "start_time": "10:00", "date": str(day + timedelta(days=3))},
        headers=headers,
    )
    assert r_bad.status_code == 409

    # первая часть двигается — продолжение раскладывается заново
    new_day = day + timedelta(days=5)
    r_move = await client.post(
        f"/bookings/{first_id}/reschedule",
        json={"post_id": str(post.id), "start_time": "14:00", "date": str(new_day)},
        headers=headers,
    )
    assert r_move.status_code == 200, r_move.text
    assert await _day_blocks(client, headers, day, post.id) == []
    assert await _day_blocks(client, headers, day + timedelta(days=1), post.id) == []
    n1 = await _day_blocks(client, headers, new_day, post.id)
    n2 = await _day_blocks(client, headers, new_day + timedelta(days=1), post.id)
    assert [(b["start_time"], b["duration_minutes"]) for b in n1] == [("14:00", 240)]
    assert [(b["start_time"], b["duration_minutes"]) for b in n2] == [("09:00", 360)]

    # отмена — вся группа
    r_cancel = await client.post(f"/bookings/{first_id}/cancel", headers=headers)
    assert r_cancel.status_code == 200
    assert await _day_blocks(client, headers, new_day, post.id) == []
    assert await _day_blocks(client, headers, new_day + timedelta(days=1), post.id) == []


@pytest.mark.asyncio
async def test_manual_duration_limit_is_80_hours(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559985")
    post = await _long_post(db_session, "Пост перенос 7")
    r = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(date.today() + timedelta(days=76)), "start_time": "10:00", "duration_minutes": 4801},
        headers=headers,
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_client_long_booking_is_capped_at_8h_and_carries_over(client, db_session):
    manager = await _manual_manager_headers(client, db_session, "+79165559986")
    post = await _long_post(db_session, "Пост клиент перенос")
    service = Service(name="Долгая работа клиент перенос", duration_minutes=720)
    db_session.add(service)
    await db_session.flush()
    day = date.today() + timedelta(days=77)

    token = await register_and_login(client, "+79165559987")
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        "/bookings",
        json={"date": str(day), "start_time": "14:00", "service_ids": [str(service.id)], "post_id": str(post.id)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["duration_minutes"] == 480

    d1 = await _day_blocks(client, manager, day, post.id)
    d2 = await _day_blocks(client, manager, day + timedelta(days=1), post.id)
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d1] == [("14:00", 240, 0)]
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d2] == [("09:00", 240, 1)]

    me = await client.get("/bookings/me", headers=headers)
    assert me.json()["id"] == r.json()["id"]
    pending_ids = [x["id"] for x in (await client.get("/bookings/pending", headers=manager)).json()]
    assert r.json()["id"] in pending_ids and d2[0]["id"] not in pending_ids

    # менеджер подтверждает — подтверждается вся группа
    rc = await client.post(f"/bookings/{r.json()['id']}/confirm", json={"post_id": str(post.id)}, headers=manager)
    assert rc.status_code == 200
    d2_after = await _day_blocks(client, manager, day + timedelta(days=1), post.id)
    assert d2_after[0]["part"] == 1


@pytest.mark.asyncio
async def test_slots_in_the_past_are_not_free(client, db_session):
    post = Post(name="Пост слоты прошлое", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    async def slots_for(day):
        r = await client.get("/availability/slots", params={"target_date": str(day)})
        return next(p for p in r.json()["posts"] if p["post_id"] == str(post.id))["slots"]

    past = await slots_for(date.today() - timedelta(days=1))
    assert past and not any(s["free"] for s in past)
    future = await slots_for(date.today() + timedelta(days=3))
    assert future and all(s["free"] for s in future)


@pytest.mark.asyncio
async def test_cannot_book_earlier_today_client_or_manager(client, db_session):
    from app.routers.bookings import _today_msk
    from app.routers.bookings import _now_msk

    if _now_msk().hour == 0 and _now_msk().minute < 30:
        pytest.skip("первые полчаса суток: слот 00:00 ещё текущий")

    post = Post(name="Пост сегодня раньше", work_start="00:00", work_end="23:30", work_days="1111111")
    service = Service(name="Услуга сегодня раньше", duration_minutes=30)
    db_session.add_all([post, service])
    await db_session.flush()
    today = _today_msk()

    token = await register_and_login(client, "+79165559996")
    r_client = await client.post(
        "/bookings",
        json={"date": str(today), "start_time": "00:00", "service_ids": [str(service.id)], "post_id": str(post.id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r_client.status_code == 400

    manager = await _manual_manager_headers(client, db_session, "+79165559997")
    r_manager = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(today), "start_time": "00:00", "duration_minutes": 30, "phone": "+79165559998"},
        headers=manager,
    )
    assert r_manager.status_code == 400


@pytest.mark.asyncio
async def test_confirm_with_long_duration_carries_over(client, db_session):
    manager = await _manual_manager_headers(client, db_session, "+79165559966")
    post = await _long_post(db_session, "Пост подтверждение перенос")
    service = Service(name="Услуга подтверждение перенос", duration_minutes=120)
    db_session.add(service)
    await db_session.flush()
    day = date.today() + timedelta(days=82)

    token = await register_and_login(client, "+79165559967")
    r = await client.post(
        "/bookings",
        json={"date": str(day), "start_time": "13:00", "service_ids": [str(service.id)], "post_id": str(post.id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text

    rc = await client.post(
        f"/bookings/{r.json()['id']}/confirm",
        json={"post_id": str(post.id), "duration_minutes": 600},
        headers=manager,
    )
    assert rc.status_code == 200, rc.text

    d1 = await _day_blocks(client, manager, day, post.id)
    d2 = await _day_blocks(client, manager, day + timedelta(days=1), post.id)
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d1] == [("13:00", 300, 0)]
    assert [(b["start_time"], b["duration_minutes"], b["part"]) for b in d2] == [("09:00", 300, 1)]

    again = await client.post(f"/bookings/{r.json()['id']}/confirm", json={"post_id": str(post.id)}, headers=manager)
    assert again.status_code == 409
    too_long = await client.post(f"/bookings/{r.json()['id']}/confirm", json={"post_id": str(post.id), "duration_minutes": 5000}, headers=manager)
    assert too_long.status_code in (400, 409)


async def _client_booker(client, db_session, phone):
    day = date.today() + timedelta(days=2)
    post = Post(name="Пост для нескольких записей", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Быстрая услуга", duration_minutes=30)
    db_session.add_all([post, service])
    await db_session.flush()
    token = await register_and_login(client, phone)
    headers = {"Authorization": f"Bearer {token}"}

    async def book(start_time):
        return await client.post(
            "/bookings",
            json={"date": str(day), "start_time": start_time, "service_ids": [str(service.id)]},
            headers=headers,
        )

    return book


@pytest.mark.asyncio
async def test_client_can_have_several_active_bookings(client, db_session):
    book = await _client_booker(client, db_session, "+79165557788")
    assert (await book("09:00")).status_code == 200
    assert (await book("11:00")).status_code == 200
    r_same_time = await book("09:00")
    assert r_same_time.status_code == 409
    assert "на это время" in r_same_time.json()["detail"]


@pytest.mark.asyncio
async def test_client_active_bookings_are_capped_at_five(client, db_session):
    book = await _client_booker(client, db_session, "+79165557799")
    for t in ("09:00", "10:00", "11:00", "12:00", "13:00"):
        r = await book(t)
        assert r.status_code == 200, (t, r.text)
    r6 = await book("14:00")
    assert r6.status_code == 409
    assert "Не больше 5" in r6.json()["detail"]


@pytest.mark.asyncio
async def test_my_bookings_lists_all_active_in_order(client, db_session):
    day = date.today() + timedelta(days=2)
    post = Post(name="Пост для списка", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Замена колодок", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()
    token = await register_and_login(client, "+79165557711")
    headers = {"Authorization": f"Bearer {token}"}

    for t in ("14:00", "10:00"):
        r = await client.post(
            "/bookings",
            json={"date": str(day), "start_time": t, "service_ids": [str(service.id)]},
            headers=headers,
        )
        assert r.status_code == 200, r.text

    r = await client.get("/bookings/mine", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert [b["start_time"] for b in data] == ["10:00", "14:00"]
    assert data[0]["services"] == ["Замена колодок"]
    assert data[0]["car"] is None
    assert data[0]["carry_over"] is False

    other_token = await register_and_login(client, "+79165557722")
    r2 = await client.get("/bookings/mine", headers={"Authorization": f"Bearer {other_token}"})
    assert r2.status_code == 200
    assert r2.json() == []


async def _client_with_booking(client, db_session, phone, start="10:00", duration=60):
    day = date.today() + timedelta(days=2)
    post = Post(name=f"Пост {phone}", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name=f"Услуга {phone}", duration_minutes=duration)
    db_session.add_all([post, service])
    await db_session.flush()
    token = await register_and_login(client, phone)
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post(
        "/bookings",
        json={"date": str(day), "start_time": start, "service_ids": [str(service.id)], "post_id": str(post.id)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return headers, r.json()["id"], post, day


@pytest.mark.asyncio
async def test_client_cancels_own_booking_only(client, db_session):
    headers, bid, _post, _day = await _client_with_booking(client, db_session, "+79165557801")

    other = await register_and_login(client, "+79165557802")
    r_other = await client.post(f"/bookings/{bid}/cancel-mine", headers={"Authorization": f"Bearer {other}"})
    assert r_other.status_code == 404

    r = await client.post(f"/bookings/{bid}/cancel-mine", headers=headers)
    assert r.status_code == 200
    assert (await client.get("/bookings/mine", headers=headers)).json() == []

    r_again = await client.post(f"/bookings/{bid}/cancel-mine", headers=headers)
    assert r_again.status_code == 409


@pytest.mark.asyncio
async def test_client_cancels_confirmed_booking_far_ahead(client, db_session):
    headers, bid, post, _day = await _client_with_booking(client, db_session, "+79165557803")
    manager = await _manual_manager_headers(client, db_session, "+79165557804")
    r_confirm = await client.post(f"/bookings/{bid}/confirm", json={"post_id": str(post.id)}, headers=manager)
    assert r_confirm.status_code == 200

    r = await client.post(f"/bookings/{bid}/cancel-mine", headers=headers)
    assert r.status_code == 200
    assert (await client.get("/bookings/mine", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_client_reschedule_goes_back_to_pending(client, db_session):
    headers, bid, post, day = await _client_with_booking(client, db_session, "+79165557805")
    manager = await _manual_manager_headers(client, db_session, "+79165557806")
    r_confirm = await client.post(f"/bookings/{bid}/confirm", json={"post_id": str(post.id)}, headers=manager)
    assert r_confirm.status_code == 200

    r = await client.post(
        f"/bookings/{bid}/reschedule-mine", json={"date": str(day), "start_time": "13:00"}, headers=headers
    )
    assert r.status_code == 200, r.text
    mine = (await client.get("/bookings/mine", headers=headers)).json()
    assert len(mine) == 1
    assert mine[0]["start_time"] == "13:00"
    assert mine[0]["status"] == "pending"
    assert mine[0]["total_minutes"] == 60

    other = await register_and_login(client, "+79165557807")
    r_other = await client.post(
        f"/bookings/{bid}/reschedule-mine",
        json={"date": str(day), "start_time": "15:00"},
        headers={"Authorization": f"Bearer {other}"},
    )
    assert r_other.status_code == 404


@pytest.mark.asyncio
async def test_calendar_shows_bookings_on_post_day_off(client, db_session):
    from app.models import ScheduleException

    headers, bid, post, day = await _client_with_booking(client, db_session, "+79165557811", start="10:00", duration=60)
    manager = await _manual_manager_headers(client, db_session, "+79165557812")
    db_session.add(ScheduleException(post_id=post.id, date=day, is_working=False))
    await db_session.flush()

    r = await client.get("/bookings/calendar", params={"target_date": str(day)}, headers=manager)
    assert r.status_code == 200
    col = [p for p in r.json()["posts"] if p["post_id"] == str(post.id)][0]
    assert col["working"] is False
    assert col["day_off"] is True
    assert [s["time"] for s in col["slots"]] == ["10:00", "10:30"]
    assert all(s["booking"] is not None and s["booking"]["id"] == bid for s in col["slots"])


@pytest.mark.asyncio
async def test_car_history_lists_finished_confirmed_bookings(client, db_session):
    import uuid
    from datetime import datetime

    token = await register_and_login(client, "+79165557821")
    headers = {"Authorization": f"Bearer {token}"}
    car_body = {"color": None, "vin": None, "plate": None}
    kia = (await client.post("/users/me/cars", json={"make": "Kia", "model": "Rio", **car_body}, headers=headers)).json()
    skoda = (await client.post("/users/me/cars", json={"make": "Skoda", "model": "Octavia", **car_body}, headers=headers)).json()

    user = (await db_session.execute(select(User).where(User.phone == "+79165557821"))).scalar_one()
    service = Service(name="Замена масла (история)", duration_minutes=60)
    db_session.add(service)
    await db_session.flush()

    past = datetime.combine(date.today() - timedelta(days=5), datetime.min.time())

    def make(car, status):
        return Booking(
            user_id=user.id, car_id=uuid.UUID(car["id"]), date=past, start_time="10:00",
            duration_minutes=60, status=status, part=0,
        )

    done_kia = make(kia, "confirmed")
    done_kia.services = [service]
    db_session.add_all([done_kia, make(kia, "cancelled"), make(skoda, "confirmed")])
    await db_session.flush()

    r = await client.get("/bookings/history", params={"car_id": kia["id"]}, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["services"] == ["Замена масла (история)"]

    r_all = await client.get("/bookings/history", headers=headers)
    assert len(r_all.json()) == 2

    other = await register_and_login(client, "+79165557822")
    r_other = await client.get("/bookings/history", headers={"Authorization": f"Bearer {other}"})
    assert r_other.json() == []


@pytest.mark.asyncio
async def test_slots_can_exclude_own_booking(client, db_session):
    headers, bid, post, day = await _client_with_booking(client, db_session, "+79165557831", start="10:00", duration=60)

    def free_map(resp):
        col = [p for p in resp.json()["posts"] if p["post_id"] == str(post.id)][0]
        return {s["time"]: s["free"] for s in col["slots"]}

    busy = free_map(await client.get("/availability/slots", params={"target_date": str(day)}))
    assert busy["10:00"] is False and busy["10:30"] is False

    own = free_map(
        await client.get("/availability/slots", params={"target_date": str(day), "exclude_booking_id": bid})
    )
    assert own["10:00"] is True and own["10:30"] is True


@pytest.mark.asyncio
async def test_change_booking_duration(client, db_session):
    headers = await _manual_manager_headers(client, db_session, "+79165559931")
    post = Post(name="Пост длительность", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=29)
    r1 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "10:00", "duration_minutes": 60, "phone": "+79165559932"},
        headers=headers,
    )
    assert r1.status_code == 200
    r2 = await client.post(
        "/bookings/manual",
        json={"post_id": str(post.id), "date": str(day), "start_time": "11:30", "duration_minutes": 60, "phone": "+79165559933"},
        headers=headers,
    )
    assert r2.status_code == 200
    bid = r1.json()["id"]

    # +30 мин: до 11:30 свободно
    r = await client.post(f"/bookings/{bid}/duration", json={"delta_minutes": 30}, headers=headers)
    assert r.status_code == 200
    assert r.json()["duration_minutes"] == 90
    # ещё +30 упирается в следующую запись
    r = await client.post(f"/bookings/{bid}/duration", json={"delta_minutes": 30}, headers=headers)
    assert r.status_code == 409
    # убавить можно
    r = await client.post(f"/bookings/{bid}/duration", json={"delta_minutes": -30}, headers=headers)
    assert r.status_code == 200
    assert r.json()["duration_minutes"] == 60
    # шаг не по 30 минут
    r = await client.post(f"/bookings/{bid}/duration", json={"delta_minutes": 20}, headers=headers)
    assert r.status_code == 400
    # короче 15 минут нельзя
    r = await client.post(f"/bookings/{bid}/duration", json={"delta_minutes": -60}, headers=headers)
    assert r.status_code == 400
