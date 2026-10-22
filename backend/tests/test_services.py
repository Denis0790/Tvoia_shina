from datetime import date, timedelta

import pytest

from app.models import Post, User
from tests.conftest_helpers import register_and_login


async def _mgr(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_only_manager_can_edit_catalog(client, db_session):
    token = await register_and_login(client, "+79165559951")
    r = await client.post(
        "/services", json={"name": "Тест-услуга хак", "duration_minutes": 30}, headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 403
    assert (await client.get("/services/all", headers={"Authorization": f"Bearer {token}"})).status_code == 403


@pytest.mark.asyncio
async def test_create_update_and_validation(client, db_session):
    headers = await _mgr(client, db_session, "+79165559952")
    r = await client.post(
        "/services", json={"name": "  Тест-услуга норматив 1  ", "duration_minutes": 90, "category": " Шиномонтаж "}, headers=headers
    )
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert r.json()["name"] == "Тест-услуга норматив 1" and r.json()["category"] == "Шиномонтаж"

    dup = await client.post("/services", json={"name": "тест-УСЛУГА норматив 1", "duration_minutes": 30}, headers=headers)
    assert dup.status_code == 409
    assert (await client.post("/services", json={"name": "Тест-услуга 0", "duration_minutes": 1}, headers=headers)).status_code == 422
    assert (await client.post("/services", json={"name": "   ", "duration_minutes": 30}, headers=headers)).status_code == 400

    up = await client.put(f"/services/{sid}", json={"name": "Тест-услуга норматив 1", "duration_minutes": 120, "category": ""}, headers=headers)
    assert up.status_code == 200 and up.json()["duration_minutes"] == 120 and up.json()["category"] is None
    assert (await client.put(f"/services/{sid}x", json={"name": "a", "duration_minutes": 30}, headers=headers)).status_code == 422


@pytest.mark.asyncio
async def test_hide_and_restore_keeps_history(client, db_session):
    headers = await _mgr(client, db_session, "+79165559953")
    post = Post(name="Пост справочник", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    sid = (await client.post("/services", json={"name": "Тест-услуга норматив 2", "duration_minutes": 45}, headers=headers)).json()["id"]

    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id), "date": str(date.today() + timedelta(days=80)), "start_time": "10:00",
            "duration_minutes": 45, "phone": "+79165559954", "service_ids": [sid],
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text

    assert (await client.delete(f"/services/{sid}", headers=headers)).status_code == 200
    assert sid not in [s["id"] for s in (await client.get("/services")).json()]
    all_items = {s["id"]: s for s in (await client.get("/services/all", headers=headers)).json()}
    assert all_items[sid]["is_active"] is False

    history = await client.get(f"/users/clients/{r.json()['user_id']}/bookings", headers=headers)
    assert [x["name"] for x in history.json()[0]["services"]] == ["Тест-услуга норматив 2"]

    back = await client.put(
        f"/services/{sid}", json={"name": "Тест-услуга норматив 2", "duration_minutes": 45, "is_active": True}, headers=headers
    )
    assert back.json()["is_active"] is True
    assert sid in [s["id"] for s in (await client.get("/services")).json()]
