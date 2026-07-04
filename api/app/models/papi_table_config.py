from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class PapiTableConfig(Base):
    """Per-table record of which tables have had their generated CRUD API
    deliberately activated — the connection-level PapiConfig switch alone
    doesn't say which tables are actually meant to be public; this is that
    registry, so Pilotbase can enumerate/enforce exactly what's hosted."""
    __tablename__ = "papi_table_configs"

    connection_id: Mapped[str] = mapped_column(String, ForeignKey("db_connections.id"), primary_key=True)
    table_name: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    activated_by: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
