"""last migration check per connection, for the Health view

Revision ID: 0003_health_migration_checks
Revises: 0002_saved_queries
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_health_migration_checks"
down_revision = "0002_saved_queries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_migration_checks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.String(), sa.ForeignKey("db_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sql_text", sa.Text(), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "connection_id", name="uq_health_migration_user_connection"),
    )


def downgrade() -> None:
    op.drop_table("health_migration_checks")
