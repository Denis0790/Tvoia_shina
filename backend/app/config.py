from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    jwt_secret: str = "dev-secret-change-me"
    jwt_expires_minutes: int = 60 * 24 * 30
    otp_ttl_seconds: int = 300
    otp_resend_seconds: int = 60

    class Config:
        env_file = ".env"


settings = Settings()
