"""Авторизация. Два независимых механизма с отдельными именами cookie —
это важно, чтобы клиентская и менеджерская сессии могли жить в одном браузере
одновременно (например, ты тестируешь оба личных кабинета сразу), не вытесняя
друг друга при фоновом авто-обновлении токена.

1. Клиенты — регистрация/восстановление пароля через SMS-код (одноразовый),
   дальше обычный вход по телефон+пароль, без SMS на каждый визит.
   Cookie: refresh_token.
2. Персонал — вход по общему логин/паролю без телефона вообще (manager-login).
   Cookie: manager_refresh_token.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, RefreshToken
from app.config import settings
from app.mailer import send_login_code
from app.auth_utils import (
    normalize_phone,
    normalize_email,
    check_otp_rate_limit,
    generate_and_store_otp,
    check_otp,
    generate_refresh_token,
    hash_token,
    generate_verification_ticket,
    store_verified_phone,
    get_verified_phone,
    consume_verification_ticket,
    check_login_allowed,
    register_login_failure,
    clear_login_failures,
)
from app.security import create_access_token, pwd_context, hash_password
from datetime import datetime, timezone

router = APIRouter(prefix="/auth", tags=["auth"])

CLIENT_COOKIE = "refresh_token"
MANAGER_COOKIE = "manager_refresh_token"
REFRESH_GRACE_SECONDS = 30  # столько секунд после обновления старый refresh-токен ещё принимается


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def _issue_tokens(user: User, response: Response, db: AsyncSession, cookie_name: str) -> dict:
    raw_token, token_hash, expires_at = generate_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    await db.commit()

    response.set_cookie(cookie_name, raw_token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=180 * 24 * 3600)
    access_token = create_access_token(str(user.id))
    return {"access_token": access_token, "user_id": str(user.id), "role": user.role}


async def _do_refresh(request: Request, response: Response, db: AsyncSession, cookie_name: str) -> dict:
    raw_token = request.cookies.get(cookie_name)
    if not raw_token:
        raise HTTPException(status_code=401, detail="Нет refresh token")

    token_hash = hash_token(raw_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    token_row = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if token_row is None or token_row.expires_at < now:
        raise HTTPException(status_code=401, detail="Refresh token недействителен")
    if token_row.revoked_at is not None:
        # параллельные запросы (две вкладки, повторная загрузка): токен только что обновили —
        # отдаём доступ без нового cookie, новый уже выдан первому запросу
        if (now - token_row.revoked_at).total_seconds() <= REFRESH_GRACE_SECONDS:
            return {"access_token": create_access_token(str(token_row.user_id))}
        raise HTTPException(status_code=401, detail="Refresh token недействителен")

    token_row.revoked_at = now

    new_raw, new_hash, new_expires = generate_refresh_token()
    db.add(RefreshToken(user_id=token_row.user_id, token_hash=new_hash, expires_at=new_expires))
    await db.commit()

    response.set_cookie(cookie_name, new_raw, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=180 * 24 * 3600)
    access_token = create_access_token(str(token_row.user_id))
    return {"access_token": access_token}


async def _do_logout(request: Request, response: Response, db: AsyncSession, cookie_name: str) -> dict:
    raw_token = request.cookies.get(cookie_name)
    if raw_token:
        token_hash = hash_token(raw_token)
        result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        token_row = result.scalar_one_or_none()
        if token_row is not None and token_row.revoked_at is None:
            token_row.revoked_at = datetime.now(timezone.utc)
            await db.commit()

    response.delete_cookie(cookie_name)
    return {"ok": True}


@router.post("/request-code")
async def request_code(email: str, request: Request):
    """Шлёт код на почту. Используется и для регистрации, и для восстановления пароля."""
    email = normalize_email(email)
    client_ip = request.client.host if request.client else "unknown"
    await check_otp_rate_limit(email, client_ip)
    code = await generate_and_store_otp(email)
    if settings.otp_debug:
        # разработка: код в ответе. В бою OTP_DEBUG=false
        return {"email": email, "debug_code": code}
    await send_login_code(email, code)
    return {"email": email}


@router.post("/verify-code")
async def verify_code(email: str, code: str):
    """Проверяет код и выдаёт одноразовый ticket на 10 минут вместо прямого логина."""
    email = normalize_email(email)
    if not await check_otp(email, code):
        raise HTTPException(status_code=400, detail="Неверный или истёкший код")

    ticket = generate_verification_ticket()
    await store_verified_phone(ticket, email)  # в ticket хранится подтверждённая почта
    return {"ticket": ticket}


@router.post("/set-password")
async def set_password(
    ticket: str,
    password: str,
    response: Response,
    request: Request,
    phone: str | None = None,
    consent: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """По валидному ticket (почта подтверждена кодом) создаёт аккаунт или обновляет пароль.
    Для нового аккаунта обязателен телефон для связи (он не подтверждается, это просто контакт)."""
    email = await get_verified_phone(ticket)
    if email is None:
        raise HTTPException(status_code=400, detail="Ссылка устарела, подтвердите почту заново")

    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    # согласие на обработку ПДн: нужно новому клиенту и тому, кого завёл менеджер (согласия у него ещё нет)
    needs_consent = user is None or user.consent_at is None
    if needs_consent and not consent:
        raise HTTPException(status_code=400, detail="Нужно согласие на обработку персональных данных")

    if user is None:
        if not phone or not phone.strip():
            raise HTTPException(status_code=400, detail="Укажите номер телефона для связи")
        phone = normalize_phone(phone)
        taken = await db.execute(select(User.id).where(User.phone == phone))
        if taken.first() is not None:
            raise HTTPException(
                status_code=409,
                detail="Этот номер уже есть в базе сервиса. Позвоните нам — мы привяжем вашу почту к аккаунту",
            )
        user = User(email=email, phone=phone, password_hash=hash_password(password))
        db.add(user)
        await db.flush()
    else:
        user.password_hash = hash_password(password)

    if needs_consent:
        from datetime import datetime, timezone

        from app.legal import CONSENT_VERSION

        user.consent_at = datetime.now(timezone.utc)
        user.consent_version = CONSENT_VERSION
        user.consent_ip = (_client_ip(request) or "")[:45]

    await consume_verification_ticket(ticket)
    return await _issue_tokens(user, response, db, CLIENT_COOKIE)


@router.post("/login")
async def login(email: str, password: str, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """Обычный вход клиента: почта + пароль."""
    email = normalize_email(email)
    ip = _client_ip(request)
    await check_login_allowed(ip, email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        await register_login_failure(ip, email)
        raise HTTPException(status_code=404, detail="Аккаунт не найден")
    if user.password_hash is None:
        raise HTTPException(
            status_code=401, detail="Пароль ещё не задан — нажмите «Забыли пароль?» и подтвердите почту"
        )
    if not pwd_context.verify(password, user.password_hash):
        await register_login_failure(ip, email)
        raise HTTPException(status_code=401, detail="Неверный пароль")

    await clear_login_failures(ip, email)
    return await _issue_tokens(user, response, db, CLIENT_COOKIE)


@router.post("/org-login")
async def org_login(login: str, password: str, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """Вход организации по логину (ИНН) и паролю, которые выдал менеджер."""
    ip = _client_ip(request)
    ident = "org:" + login.strip().lower()
    await check_login_allowed(ip, ident)
    result = await db.execute(select(User).where(func.lower(User.login) == login.strip().lower(), User.kind == "org"))
    user = result.scalar_one_or_none()

    if user is None or user.password_hash is None or not pwd_context.verify(password, user.password_hash):
        await register_login_failure(ip, ident)
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    await clear_login_failures(ip, ident)
    return await _issue_tokens(user, response, db, CLIENT_COOKIE)


@router.post("/refresh")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    return await _do_refresh(request, response, db, CLIENT_COOKIE)


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    return await _do_logout(request, response, db, CLIENT_COOKIE)


@router.post("/manager-login")
async def manager_login(login: str, password: str, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """Вход для персонала по общему логину/паролю."""
    ip = _client_ip(request)
    ident = "mgr:" + login.strip()
    await check_login_allowed(ip, ident)
    result = await db.execute(select(User).where(User.login == login, User.role == "manager"))
    user = result.scalar_one_or_none()

    if user is None or user.password_hash is None or not pwd_context.verify(password, user.password_hash):
        await register_login_failure(ip, ident)
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    await clear_login_failures(ip, ident)
    return await _issue_tokens(user, response, db, MANAGER_COOKIE)


@router.post("/manager-refresh")
async def manager_refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    return await _do_refresh(request, response, db, MANAGER_COOKIE)


@router.post("/manager-logout")
async def manager_logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    return await _do_logout(request, response, db, MANAGER_COOKIE)
