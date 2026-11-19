from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.models.user import RefreshToken
from tests.conftest_helpers import register_and_login


async def test_parallel_refresh_with_same_cookie_is_accepted(client):
    await register_and_login(client, "+79990005555")
    old = client.cookies.get("refresh_token")
    r1 = await client.post("/auth/refresh")
    assert r1.status_code == 200
    # второй «параллельный» запрос приходит со старым cookie
    r2 = await client.post("/auth/refresh", headers={"Cookie": f"refresh_token={old}"})
    assert r2.status_code == 200
    assert r2.json()["access_token"]
    assert "set-cookie" not in r2.headers


async def test_old_refresh_cookie_rejected_after_grace(client, db_session):
    await register_and_login(client, "+79990005556")
    old = client.cookies.get("refresh_token")
    assert (await client.post("/auth/refresh")).status_code == 200
    await db_session.execute(
        update(RefreshToken)
        .where(RefreshToken.revoked_at.is_not(None))
        .values(revoked_at=datetime.now(timezone.utc) - timedelta(minutes=5))
    )
    await db_session.flush()
    r = await client.post("/auth/refresh", headers={"Cookie": f"refresh_token={old}"})
    assert r.status_code == 401
