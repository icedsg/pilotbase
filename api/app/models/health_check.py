import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.database import Base


class HealthMigrationCheck(Base):
    """The migration last pasted into the Health view, one per user and connection.
    Only the text is kept: the findings are worked out again when it is shown."""

    __tablename__ = "health_migration_checks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("db_connections.id", ondelete="CASCADE"), nullable=False
    )
    sql_text: Mapped[str] = mapped_column(Text, nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "connection_id", name="uq_health_migration_user_connection"),
    )
