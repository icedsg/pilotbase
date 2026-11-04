"""saved queries

Revision ID: 0002_saved_queries
Revises: 0001_app_settings
Create Date: 2026-11-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_saved_queries"
down_revision = "0001_app_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_queries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.String(), sa.ForeignKey("db_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("query_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_saved_queries_user_connection", "saved_queries", ["user_id", "connection_id"])


def downgrade() -> None:
    op.drop_index("ix_saved_queries_user_connection", table_name="saved_queries")
    op.drop_table("saved_queries")
