from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    database_url: str = Field(
        default="postgresql://cctv_admin:cctv_password123@127.0.0.1:5432/ml_project",
        validation_alias="DATABASE_URL"
    )

    @property
    def DATABASE_URL(self) -> str:
        """Returns a standard PostgreSQL DSN compatible with asyncpg."""
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False
    )

settings = Settings()