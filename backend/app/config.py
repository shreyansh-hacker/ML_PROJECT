from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    database_url: str = Field(
        default="postgresql://cctv_admin:cctv_password123@127.0.0.1:5432/cctv_registry_db",
        validation_alias="DATABASE_URL"
    )
    cors_origins: str = Field(
        default="",
        validation_alias="CORS_ORIGINS"
    )
    environment: str = Field(
        default="development",
        validation_alias="ENVIRONMENT"
    )
    port: int = Field(
        default=8000,
        validation_alias="PORT"
    )
    onvif_credentials_key: str = Field(
        default="",
        validation_alias="ONVIF_CREDENTIALS_KEY"
    )
    sentinel_catalogue_url: str = Field(
        default="https://cctv.corp8.cloud/cameras.json",
        validation_alias="SENTINEL_CATALOGUE_URL"
    )
    sentinel_stream_host: str = Field(
        default="103.250.160.189",
        validation_alias="SENTINEL_STREAM_HOST"
    )
    sentinel_stream_credentials_json: str = Field(
        default="",
        validation_alias="SENTINEL_STREAM_CREDENTIALS_JSON"
    )
    admin_password: str = Field(default="", validation_alias="ADMIN_PASSWORD")
    session_signing_key: str = Field(default="", validation_alias="SESSION_SIGNING_KEY")
    host: str = Field(
        default="0.0.0.0",
        validation_alias="HOST"
    )

    @property
    def DATABASE_URL(self) -> str:
        """Returns a standard PostgreSQL DSN compatible with asyncpg."""
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://")

    @property
    def allowed_cors_origins(self) -> list[str]:
        """Return only explicitly configured browser origins."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False
    )

settings = Settings()