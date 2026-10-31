"""Отправка писем (код подтверждения). Настройки SMTP — в .env (SMTP_HOST, SMTP_USER, ...)."""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from fastapi import HTTPException

from app.config import settings

log = logging.getLogger("uvicorn.error")


def _send_sync(to: str, subject: str, text: str) -> None:
    sender = settings.smtp_from or settings.smtp_user
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    domain = parseaddr(sender)[1].split("@")[-1] or None
    msg["Message-ID"] = make_msgid(domain=domain)
    msg.set_content(text)

    ctx = ssl.create_default_context()
    if settings.smtp_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=15) as s:
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as s:
            s.starttls(context=ctx)
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)


async def send_email(to: str, subject: str, text: str) -> None:
    if not settings.smtp_host:
        raise HTTPException(status_code=503, detail="Отправка писем пока не настроена")
    try:
        await asyncio.to_thread(_send_sync, to, subject, text)
    except Exception:
        log.exception("Не удалось отправить письмо")  # адрес получателя в журнал не пишем
        raise HTTPException(status_code=503, detail="Не удалось отправить письмо, попробуйте позже")


async def send_login_code(to: str, code: str) -> None:
    minutes = max(1, settings.otp_ttl_seconds // 60)
    text = (
        f"Ваш код подтверждения: {code}\n\n"
        f"Код действует {minutes} мин. Никому его не сообщайте.\n"
        "Если вы не запрашивали код, просто проигнорируйте это письмо.\n\n"
        "Твоя Шина"
    )
    await send_email(to, "Код подтверждения — Твоя Шина", text)
