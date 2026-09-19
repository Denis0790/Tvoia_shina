from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str
    redis_url: str
    jwt_secret: str = "dev-secret-change-me"
    jwt_expires_minutes: int = 60 * 24 * 30
    otp_ttl_seconds: int = 300
    otp_resend_seconds: int = 60


settings = Settings()
