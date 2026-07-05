from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class PapiConfig(Base):
    """Generated-CRUD-API ('papi') configuration for one database on one
    connection. A single connection can browse multiple databases (see
    db_service's per-call `database` override on list_objects/execute_query),
    so this is keyed by (connection_id, database) rather than connection_id
    alone — enabling the API from one database's context menu must not affect
    any other database reachable through the same connection.
    Lives in Pilotbase's own internal metadata DB — not the user's target
    database — since the JWT signing secret must not be reachable through the
    generated API itself."""
    __tablename__ = "papi_configs"

    connection_id: Mapped[str] = mapped_column(String, ForeignKey("db_connections.id"), primary_key=True)
    database: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    jwt_secret_encrypted: Mapped[str] = mapped_column(Text)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
