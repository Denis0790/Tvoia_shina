from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str
    redis_url: str
    jwt_secret: str = "dev-secret-change-me"
    jwt_expires_minutes: int = 60 * 24 * 30
    otp_ttl_seconds: int = 300
    otp_resend_seconds: int = 60
    app_env: str = "dev"  # "production" на сервере
    cors_origins: str = "http://localhost:3000"  # через запятую
    cookie_secure: bool = False  # в бою true (только HTTPS)
    otp_debug: bool = True  # true — код входа в ответе API (только разработка / закрытый тест)
    smtp_host: str = ""  # почта для отправки кодов (Timeweb Mail и т. п.)
    smtp_port: int = 465
    smtp_ssl: bool = True  # true — SSL на порту 465, false — STARTTLS (порт 587/2525)
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    # S3-хранилище файлов чата (Timeweb Cloud S3 и т. п.); пусто — файлы лежат на диске сервера
    s3_endpoint: str = ""
    s3_region: str = "ru-1"
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:support@sto-tyre4u.ru"


def check_production(s: Settings) -> None:
    """В боевом режиме не даём запуститься с небезопасными настройками."""
    if s.app_env != "production":
        return
    if s.jwt_secret == "dev-secret-change-me" or len(s.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET не задан или короче 32 символов")
    if not s.cookie_secure:
        raise RuntimeError("В боевом режиме нужно COOKIE_SECURE=true")
    if not s.otp_debug and not s.smtp_host:
        raise RuntimeError("Не настроена почта: задайте SMTP_HOST (и SMTP_USER, SMTP_PASSWORD, SMTP_FROM)")


def api_docs_kwargs(app_env: str) -> dict:
    """В бою публичная документация API (/docs, /redoc, /openapi.json) отключена."""
    if app_env == "production":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


settings = Settings()
check_production(settings)
