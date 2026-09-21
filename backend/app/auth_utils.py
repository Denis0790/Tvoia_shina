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
