from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DB_USER: str = "cctv_admin"
    DB_PASSWORD: str = "cctv_password123"
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "cctv_registry_db"

    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    class Config:
        env_file = ".env"

settings = Settings()