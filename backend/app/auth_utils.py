"""Утилиты для OTP-авторизации по телефону: нормализация номера, генерация
и проверка кода через Redis (с TTL — код сам "истекает", ничего не чистим руками),
и генерация refresh token в виде случайной строки, а не JWT (хранится как хеш в БД,
что бы утечка базы не давала возможность использовать токены напрямую)."""

import hashlib
import secrets
import random
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from app.redis_client import redis_client
from app.config import settings


def normalize_phone(phone: str) -> str:
    """Приводит любой ввод к единому формату +7XXXXXXXXXX, чтобы один и тот же
    номер не мог зарегистрироваться дважды из-за разного написания (с 8, без
    +, с пробелами и т.д.). Бросает 400 на всё, что не похоже на российский номер."""
    digits = "".join(ch for ch in phone if ch.isdigit())

    if len(digits) == 11 and digits[0] == "8":
        digits = "7" + digits[1:]
    elif len(digits) == 10 and digits[0] == "9":
        digits = "7" + digits

    if len(digits) != 11 or digits[0] != "7":
        raise HTTPException(status_code=400, detail="Введите номер в формате +7 999 123-45-67 (11 цифр, российский номер)")

    return "+" + digits


async def check_otp_rate_limit(phone: str, ip: str) -> None:
    """Защита от спама SMS-кодами: кулдаун между запросами на один номер,
    дневной лимит на номер, отдельный дневной лимит на IP (чтобы нельзя было
    заваливать кодами разные чужие номера подряд с одного источника)."""
    cooldown_key = f"otp_cooldown:{phone}"
    if await redis_client.get(cooldown_key):
        raise HTTPException(status_code=429, detail="Код уже отправлен, попробуйте через минуту")

    phone_daily_key = f"otp_daily:{phone}"
    phone_count = await redis_client.incr(phone_daily_key)
    if phone_count == 1:
        await redis_client.expire(phone_daily_key, 24 * 3600)
    if phone_count > 5:
        raise HTTPException(status_code=429, detail="Слишком много попыток для этого номера, попробуйте завтра")

    ip_daily_key = f"otp_ip_daily:{ip}"
    ip_count = await redis_client.incr(ip_daily_key)
    if ip_count == 1:
        await redis_client.expire(ip_daily_key, 24 * 3600)
    if ip_count > 20:
        raise HTTPException(status_code=429, detail="Слишком много запросов, попробуйте позже")

    await redis_client.set(cooldown_key, "1", ex=settings.otp_resend_seconds)


async def generate_and_store_otp(phone: str) -> str:
    code = f"{random.randint(0, 999999):06d}"
    await redis_client.set(f"otp:{phone}", code, ex=settings.otp_ttl_seconds)
    return code


async def check_otp(phone: str, code: str) -> bool:
    stored = await redis_client.get(f"otp:{phone}")
    if stored is None or stored != code:
        return False
    await redis_client.delete(f"otp:{phone}")
    return True


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_refresh_token() -> tuple[str, str, datetime]:
    raw = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=180)
    return raw, hash_token(raw), expires_at


def generate_verification_ticket() -> str:
    return secrets.token_urlsafe(24)


async def store_verified_phone(ticket: str, phone: str) -> None:
    await redis_client.set(f"verified_phone:{ticket}", phone, ex=600)


async def get_verified_phone(ticket: str) -> str | None:
    return await redis_client.get(f"verified_phone:{ticket}")


async def consume_verification_ticket(ticket: str) -> None:
    await redis_client.delete(f"verified_phone:{ticket}")
