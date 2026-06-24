from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class DbConnection(Base):
    __tablename__ = "db_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    db_type: Mapped[str] = mapped_column(String, nullable=False)  # postgresql, mysql, sqlite, …
    host: Mapped[str | None] = mapped_column(String)
    port: Mapped[int | None] = mapped_column(Integer)
    database: Mapped[str | None] = mapped_column(String)
    username: Mapped[str | None] = mapped_column(String)
    password_encrypted: Mapped[str | None] = mapped_column(Text)
    ssl_mode: Mapped[str | None] = mapped_column(String)
    extra_params: Mapped[str | None] = mapped_column(Text)  # JSON blob for driver-specific extras
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())

    accesses: Mapped[list["ConnectionAccess"]] = relationship(
        "ConnectionAccess", back_populates="connection", cascade="all, delete-orphan"
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])  # type: ignore[name-defined]


class ConnectionAccess(Base):
    __tablename__ = "connection_accesses"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    connection_id: Mapped[str] = mapped_column(String, ForeignKey("db_connections.id"))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    can_read: Mapped[bool] = mapped_column(Boolean, default=True)
    can_write: Mapped[bool] = mapped_column(Boolean, default=False)
    can_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    connection: Mapped["DbConnection"] = relationship("DbConnection", back_populates="accesses")
    user: Mapped["User"] = relationship("User", back_populates="connection_accesses")  # type: ignore[name-defined]


class InviteToken(Base):
    __tablename__ = "invite_tokens"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    connection_id: Mapped[str | None] = mapped_column(String, ForeignKey("db_connections.id"), nullable=True)
    role_grant: Mapped[str] = mapped_column(String, default="user")
    is_used: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    creator: Mapped["User"] = relationship("User", back_populates="invite_tokens")  # type: ignore[name-defined]
