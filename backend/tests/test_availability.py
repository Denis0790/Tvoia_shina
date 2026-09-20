import pytest
from datetime import date, timedelta

from app.models import Post, Booking, User


@pytest.mark.asyncio
async def test_availability_marks_booked_slots(client, db_session):
    tomorrow = date.today() + timedelta(days=1)

    post = Post(name="Тестовый пост", work_start="09:00", work_end="12:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    user = User(phone="+79997776655")
    db_session.add(user)
    await db_session.flush()

    booking = Booking(
        user_id=user.id, post_id=post.id, date=tomorrow,
        start_time="10:00", duration_minutes=60, status="confirmed",
    )
    db_session.add(booking)
    await db_session.flush()

    r = await client.get("/availability/slots", params={"target_date": str(tomorrow)})
    assert r.status_code == 200
    data = r.json()

    post_data = next(p for p in data["posts"] if p["post_id"] == str(post.id))
    slots_by_time = {s["time"]: s["free"] for s in post_data["slots"]}

    assert slots_by_time["09:00"] is True
    assert slots_by_time["10:00"] is False
    assert slots_by_time["10:30"] is False
    assert slots_by_time["11:00"] is True
