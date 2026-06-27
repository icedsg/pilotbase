from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.config import settings


def _make_async_url(url: str) -> str:
    """Convert sync SQLAlchemy URL to its async equivalent for the internal DB."""
    return (
        url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
        .replace("postgresql://", "postgresql+asyncpg://")
    )


engine = create_async_engine(
    _make_async_url(settings.database_url),
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables on startup (development). Use Alembic for production migrations."""
    from app.models import user, connection  # noqa: F401 — import to register models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
