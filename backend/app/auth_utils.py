import hashlib
import secrets
import random
from datetime import datetime, timedelta, timezone

from app.redis_client import redis_client
from app.config import settings


def normalize_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("8"):
        digits = "7" + digits[1:]
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
