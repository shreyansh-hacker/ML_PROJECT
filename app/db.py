import asyncpg
from app.config import settings

pool: asyncpg.Pool = None

async def init_db():
    global pool
    pool = await asyncpg.create_pool(dsn=settings.DATABASE_URL, min_size=2, max_size=10)

async def close_db():
    global pool
    if pool:
        await pool.close()

def get_pool() -> asyncpg.Pool:
    return pool