import pytest
from datetime import date, timedelta

from app.models import Post, User
from tests.conftest_helpers import register_and_login


async def _manager_headers(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_post_requires_manager(client, db_session):
    client_token = await register_and_login(client, "+79165551111")
    r = await client.post(
        "/posts",
        json={"name": "Илья", "work_start": "09:00", "work_end": "18:00", "work_days": "1111100"},
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_update_delete_post(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165552222")

    r_create = await client.post(
        "/posts",
        json={"name": "Дима", "work_start": "10:00", "work_end": "19:00", "work_days": "1111110"},
        headers=headers,
    )
    assert r_create.status_code == 200
    post = r_create.json()
    assert post["name"] == "Дима"
    assert post["work_days"] == "1111110"

    r_update = await client.put(
        f"/posts/{post['id']}",
        json={"work_end": "20:00"},
        headers=headers,
    )
    assert r_update.status_code == 200
    assert r_update.json()["work_end"] == "20:00"
    assert r_update.json()["name"] == "Дима"

    r_list = await client.get("/posts", headers=headers)
    assert any(p["id"] == post["id"] for p in r_list.json())

    r_delete = await client.delete(f"/posts/{post['id']}", headers=headers)
    assert r_delete.status_code == 200

    r_list_after = await client.get("/posts", headers=headers)
    assert all(p["id"] != post["id"] for p in r_list_after.json())


@pytest.mark.asyncio
async def test_create_post_rejects_invalid_work_days(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165553333")

    r = await client.post(
        "/posts",
        json={"name": "Руслан", "work_start": "09:00", "work_end": "18:00", "work_days": "11111"},
        headers=headers,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_schedule_exceptions_crud(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165554444")

    post = Post(name="Пост для исключений", work_start="09:00", work_end="18:00", work_days="1111100")
    db_session.add(post)
    await db_session.flush()

    vacation_day = date.today() + timedelta(days=10)
    r_set = await client.put(
        f"/posts/{post.id}/exceptions",
        json={"date": str(vacation_day), "is_working": False},
        headers=headers,
    )
    assert r_set.status_code == 200
    assert r_set.json()["is_working"] is False

    # Повторная установка на ту же дату — апдейт, а не дубликат
    saturday = date.today() + timedelta(days=11)
    r_set2 = await client.put(
        f"/posts/{post.id}/exceptions",
        json={"date": str(saturday), "is_working": True, "work_start": "10:00", "work_end": "14:00"},
        headers=headers,
    )
    assert r_set2.status_code == 200
    assert r_set2.json()["work_start"] == "10:00"

    r_list = await client.get(f"/posts/{post.id}/exceptions", headers=headers)
    assert len(r_list.json()) == 2

    r_delete = await client.delete(f"/posts/{post.id}/exceptions/{vacation_day}", headers=headers)
    assert r_delete.status_code == 200

    r_list_after = await client.get(f"/posts/{post.id}/exceptions", headers=headers)
    assert len(r_list_after.json()) == 1


@pytest.mark.asyncio
async def test_set_exception_range_expands_into_days(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165558801")
    post = Post(name="Пост отпуск", work_start="09:00", work_end="18:00", work_days="1111100")
    db_session.add(post)
    await db_session.flush()

    start = date.today() + timedelta(days=30)
    end = start + timedelta(days=13)
    r = await client.put(
        f"/posts/{post.id}/exceptions/range",
        json={"date_from": str(start), "date_to": str(end), "kind": "vacation", "note": "Отпуск"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json() == {"days": 14, "conflicts": 0}

    r_list = await client.get(f"/posts/{post.id}/exceptions", headers=headers)
    items = r_list.json()
    assert len(items) == 14
    assert all(i["kind"] == "vacation" and i["note"] == "Отпуск" and i["is_working"] is False for i in items)
    assert items[0]["date"] == str(start)
    assert items[-1]["date"] == str(end)


@pytest.mark.asyncio
async def test_exception_range_overwrites_existing_day(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165558802")
    post = Post(name="Пост перезапись", work_start="09:00", work_end="18:00", work_days="1111100")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=40)
    r_single = await client.put(
        f"/posts/{post.id}/exceptions",
        json={"date": str(day), "is_working": True, "work_start": "10:00", "work_end": "14:00"},
        headers=headers,
    )
    assert r_single.status_code == 200
    assert r_single.json()["kind"] == "dayoff"

    r_range = await client.put(
        f"/posts/{post.id}/exceptions/range",
        json={"date_from": str(day), "date_to": str(day + timedelta(days=2)), "kind": "sick"},
        headers=headers,
    )
    assert r_range.status_code == 200

    items = (await client.get(f"/posts/{post.id}/exceptions", headers=headers)).json()
    assert len(items) == 3
    assert all(i["kind"] == "sick" and i["is_working"] is False and i["work_start"] is None for i in items)


@pytest.mark.asyncio
async def test_exception_range_validation(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165558803")
    post = Post(name="Пост валидация", work_start="09:00", work_end="18:00", work_days="1111100")
    db_session.add(post)
    await db_session.flush()

    day = date.today() + timedelta(days=50)
    url = f"/posts/{post.id}/exceptions/range"

    r_reversed = await client.put(
        url, json={"date_from": str(day + timedelta(days=3)), "date_to": str(day)}, headers=headers
    )
    assert r_reversed.status_code == 400

    r_too_long = await client.put(
        url, json={"date_from": str(day), "date_to": str(day + timedelta(days=400))}, headers=headers
    )
    assert r_too_long.status_code == 400

    r_bad_kind = await client.put(
        url, json={"date_from": str(day), "date_to": str(day), "kind": "party"}, headers=headers
    )
    assert r_bad_kind.status_code == 422


@pytest.mark.asyncio
async def test_exception_range_reports_booking_conflicts(client, db_session):
    from app.models import Service

    headers = await _manager_headers(client, db_session, "+79165558804")
    post = Post(name="Пост конфликт", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Услуга для конфликта", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()

    day = date.today() + timedelta(days=20)
    client_token = await register_and_login(client, "+79165558805")
    r_book = await client.post(
        "/bookings",
        json={
            "date": str(day),
            "start_time": "10:00",
            "service_ids": [str(service.id)],
            "post_id": str(post.id),
        },
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert r_book.status_code == 200

    r = await client.put(
        f"/posts/{post.id}/exceptions/range",
        json={"date_from": str(day - timedelta(days=1)), "date_to": str(day + timedelta(days=1)), "kind": "repair"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json() == {"days": 3, "conflicts": 1}

    # рабочий день (is_working=True) конфликтов не считает
    r_working = await client.put(
        f"/posts/{post.id}/exceptions/range",
        json={"date_from": str(day), "date_to": str(day), "is_working": True, "work_start": "10:00", "work_end": "14:00", "kind": "other"},
        headers=headers,
    )
    assert r_working.json()["conflicts"] == 0


@pytest.mark.asyncio
async def test_delete_exception_period(client, db_session):
    headers = await _manager_headers(client, db_session, "+79165558806")
    post = Post(name="Пост снятие", work_start="09:00", work_end="18:00", work_days="1111100")
    db_session.add(post)
    await db_session.flush()

    start = date.today() + timedelta(days=60)
    await client.put(
        f"/posts/{post.id}/exceptions/range",
        json={"date_from": str(start), "date_to": str(start + timedelta(days=4)), "kind": "vacation"},
        headers=headers,
    )

    r_del = await client.delete(
        f"/posts/{post.id}/exceptions/period",
        params={"date_from": str(start + timedelta(days=1)), "date_to": str(start + timedelta(days=3))},
        headers=headers,
    )
    assert r_del.status_code == 200

    items = (await client.get(f"/posts/{post.id}/exceptions", headers=headers)).json()
    assert [i["date"] for i in items] == [str(start), str(start + timedelta(days=4))]
