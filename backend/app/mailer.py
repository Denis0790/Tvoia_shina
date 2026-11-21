"""Отправка писем (код подтверждения). Настройки SMTP — в .env (SMTP_HOST, SMTP_USER, ...)."""

import asyncio
import html as html_lib
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from fastapi import HTTPException

from app.config import settings

log = logging.getLogger("uvicorn.error")

# Логотип лежит в frontend/public и отдаётся сайтом
LOGO_URL = "https://sto-tyre4u.ru/logo-email.png"


def _send_sync(to: str, subject: str, text: str, html: str | None = None) -> None:
    sender = settings.smtp_from or settings.smtp_user
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    domain = parseaddr(sender)[1].split("@")[-1] or None
    msg["Message-ID"] = make_msgid(domain=domain)
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")

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


async def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    if not settings.smtp_host:
        raise HTTPException(status_code=503, detail="Отправка писем пока не настроена")
    try:
        await asyncio.to_thread(_send_sync, to, subject, text, html)
    except Exception:
        log.exception("Не удалось отправить письмо")  # адрес получателя в журнал не пишем
        raise HTTPException(status_code=503, detail="Не удалось отправить письмо, попробуйте позже")


def _login_code_html(code: str, minutes: int) -> str:
    code = html_lib.escape(code)
    return f"""<!doctype html>
<html lang="ru"><body style="margin:0;padding:0;background:#f3f4f8;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1c2333;">
<tr><td align="center" style="background:#02167f;padding:20px;">
<img src="{LOGO_URL}" width="72" height="72" alt="Твоя Шина" style="display:block;border:0;">
</td></tr>
<tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.5;">Ваш код подтверждения:</td></tr>
<tr><td align="center" style="padding:8px 28px;">
<div style="display:inline-block;background:#f3f4f8;border-radius:12px;padding:14px 28px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#02167f;">{code}</div>
</td></tr>
<tr><td style="padding:16px 28px 28px;font-size:14px;line-height:1.5;color:#5b6475;">
Код действует {minutes} мин. Никому его не сообщайте.<br>
Если вы не запрашивали код, просто проигнорируйте это письмо.
</td></tr>
<tr><td align="center" style="padding:14px;background:#f3f4f8;font-size:12px;color:#8a92a3;">Твоя Шина</td></tr>
</table>
</td></tr></table>
</body></html>"""


async def send_login_code(to: str, code: str) -> None:
    minutes = max(1, settings.otp_ttl_seconds // 60)
    text = (
        f"Ваш код подтверждения: {code}\n\n"
        f"Код действует {minutes} мин. Никому его не сообщайте.\n"
        "Если вы не запрашивали код, просто проигнорируйте это письмо.\n\n"
        "Твоя Шина"
    )
    await send_email(to, "Код подтверждения — Твоя Шина", text, _login_code_html(code, minutes))
