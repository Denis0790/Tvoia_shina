from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, RefreshToken
from app.auth_utils import normalize_phone, generate_and_store_otp, check_otp, generate_refresh_token, hash_token
from app.security import create_access_token
from datetime import datetime, timezone

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"


@router.post("/request-code")
async def request_code(phone: str):
    phone = normalize_phone(phone)
    code = await generate_and_store_otp(phone)
    # TODO: подключить реального SMS-провайдера. Пока возвращаем код в ответе для теста.
    return {"phone": phone, "debug_code": code}


@router.post("/verify-code")
async def verify_code(phone: str, code: str, response: Response, db: AsyncSession = Depends(get_db)):
    phone = normalize_phone(phone)
    if not await check_otp(phone, code):
        raise HTTPException(status_code=400, detail="Неверный или истёкший код")

    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(phone=phone)
        db.add(user)
        await db.flush()

    raw_token, token_hash, expires_at = generate_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    await db.commit()

    response.set_cookie(
        REFRESH_COOKIE, raw_token, httponly=True, samesite="lax", max_age=180 * 24 * 3600,
    )
    access_token = create_access_token(str(user.id))
    return {"access_token": access_token, "user_id": str(user.id)}


@router.post("/refresh")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    raw_token = request.cookies.get(REFRESH_COOKIE)
    if not raw_token:
        raise HTTPException(status_code=401, detail="Нет refresh token")

    token_hash = hash_token(raw_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    token_row = result.scalar_one_or_none()

    if (
        token_row is None
        or token_row.revoked_at is not None
        or token_row.expires_at < datetime.now(timezone.utc)
    ):
        raise HTTPException(status_code=401, detail="Refresh token недействителен")

    token_row.revoked_at = datetime.now(timezone.utc)

    new_raw, new_hash, new_expires = generate_refresh_token()
    db.add(RefreshToken(user_id=token_row.user_id, token_hash=new_hash, expires_at=new_expires))
    await db.commit()

    response.set_cookie(
        REFRESH_COOKIE, new_raw, httponly=True, samesite="lax", max_age=180 * 24 * 3600,
    )
    access_token = create_access_token(str(token_row.user_id))
    return {"access_token": access_token}
