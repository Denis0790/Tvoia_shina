"""Авторизация. Два независимых механизма:

1. Клиенты — регистрация/восстановление пароля через SMS-код (одноразовый),
   дальше обычный вход по телефон+пароль, без SMS на каждый визит.
2. Персонал — вход по общему логин/паролю без телефона вообще (manager-login).

Оба линяют к одному и тому же выпуску access+refresh токенов (_issue_tokens)."""

from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, RefreshToken
from app.auth_utils import (
    normalize_phone,
    check_otp_rate_limit,
    generate_and_store_otp,
    check_otp,
    generate_refresh_token,
    hash_token,
    generate_verification_ticket,
    store_verified_phone,
    get_verified_phone,
    consume_verification_ticket,
)
from app.security import create_access_token, pwd_context, hash_password
from datetime import datetime, timezone

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "refresh_token"


async def _issue_tokens(user: User, response: Response, db: AsyncSession) -> dict:
    raw_token, token_hash, expires_at = generate_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    await db.commit()

    response.set_cookie(
        REFRESH_COOKIE, raw_token, httponly=True, samesite="lax", max_age=180 * 24 * 3600,
    )
    access_token = create_access_token(str(user.id))
    return {"access_token": access_token, "user_id": str(user.id), "role": user.role}


@router.post("/request-code")
async def request_code(phone: str, request: Request):
    """Шлёт SMS-код. Используется и для регистрации, и для восстановления пароля —
    на этом шаге ещё не знаем, есть пользователь или нет, это неважно.
    Защищено лимитами (см. check_otp_rate_limit), иначе это открытый вектор
    для накрутки платных SMS на чужой номер."""
    phone = normalize_phone(phone)
    client_ip = request.client.host if request.client else "unknown"
    await check_otp_rate_limit(phone, client_ip)
    code = await generate_and_store_otp(phone)
    # TODO: подключить реального SMS-провайдера. Пока возвращаем код в ответе для теста.
    return {"phone": phone, "debug_code": code}


@router.post("/verify-code")
async def verify_code(phone: str, code: str):
    """Проверяет код и выдаёт одноразовый ticket на 10 минут вместо прямого логина —
    дальше по ticket либо создаётся аккаунт (регистрация), либо меняется пароль
    (восстановление), это решает /auth/set-password."""
    phone = normalize_phone(phone)
    if not await check_otp(phone, code):
        raise HTTPException(status_code=400, detail="Неверный или истёкший код")

    ticket = generate_verification_ticket()
    await store_verified_phone(ticket, phone)
    return {"ticket": ticket}


@router.post("/set-password")
async def set_password(ticket: str, password: str, response: Response, db: AsyncSession = Depends(get_db)):
    """По валидному ticket создаёт пользователя (если его ещё не было) или
    обновляет пароль (если был) — единый механизм для регистрации и восстановления."""
    phone = await get_verified_phone(ticket)
    if phone is None:
        raise HTTPException(status_code=400, detail="Ссылка устарела, подтвердите номер заново")

    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий")

    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(phone=phone, password_hash=hash_password(password))
        db.add(user)
        await db.flush()
    else:
        user.password_hash = hash_password(password)

    await consume_verification_ticket(ticket)
    return await _issue_tokens(user, response, db)


@router.post("/login")
async def login(phone: str, password: str, response: Response, db: AsyncSession = Depends(get_db)):
    """Обычный вход клиента: телефон + пароль, без SMS."""
    phone = normalize_phone(phone)
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    if user.password_hash is None or not pwd_context.verify(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный пароль")

    return await _issue_tokens(user, response, db)


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


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    raw_token = request.cookies.get(REFRESH_COOKIE)
    if raw_token:
        token_hash = hash_token(raw_token)
        result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        token_row = result.scalar_one_or_none()
        if token_row is not None and token_row.revoked_at is None:
            token_row.revoked_at = datetime.now(timezone.utc)
            await db.commit()

    response.delete_cookie(REFRESH_COOKIE)
    return {"ok": True}


@router.post("/manager-login")
async def manager_login(login: str, password: str, response: Response, db: AsyncSession = Depends(get_db)):
    """Вход для персонала по общему логину/паролю — отдельно от клиентского флоу."""
    result = await db.execute(select(User).where(User.login == login, User.role == "manager"))
    user = result.scalar_one_or_none()

    if user is None or user.password_hash is None or not pwd_context.verify(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    return await _issue_tokens(user, response, db)
