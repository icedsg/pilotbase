"""
Schema diff and migration script generator.
Compares the schema of two database connections and returns an ALTER / CREATE / DROP
script to bring the target in line with the source.
"""
from typing import Any, Dict, List

from sqlalchemy import inspect as sa_inspect, text

from app.models.connection import DbConnection
from app.services.db_service import db_service


def _col_sig(col: Dict[str, Any]) -> str:
    return f"{col['name']}:{col['type']}:nullable={col.get('nullable', True)}"


class MigrationService:

    def _get_schema_snapshot(self, conn: DbConnection, schema: str | None = None) -> Dict[str, Any]:
        engine = db_service.get_engine(conn)
        inspector = sa_inspect(engine)
        snapshot: Dict[str, Any] = {}
        for table in inspector.get_table_names(schema=schema):
            snapshot[table] = {
                "columns": {c["name"]: c for c in inspector.get_columns(table, schema=schema)},
                "pk": set(inspector.get_pk_constraint(table, schema=schema).get("constrained_columns", [])),
                "indexes": {i["name"]: i for i in inspector.get_indexes(table, schema=schema)},
            }
        return snapshot

    def diff(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        schema: str | None = None,
    ) -> Dict[str, Any]:
        src = self._get_schema_snapshot(source_conn, schema)
        tgt = self._get_schema_snapshot(target_conn, schema)

        added_tables = sorted(set(src) - set(tgt))
        dropped_tables = sorted(set(tgt) - set(src))
        common = set(src) & set(tgt)

        column_changes: Dict[str, Any] = {}
        for table in common:
            src_cols = src[table]["columns"]
            tgt_cols = tgt[table]["columns"]

            added = sorted(set(src_cols) - set(tgt_cols))
            dropped = sorted(set(tgt_cols) - set(src_cols))
            modified = [
                c for c in set(src_cols) & set(tgt_cols)
                if _col_sig(src_cols[c]) != _col_sig(tgt_cols[c])
            ]
            if added or dropped or modified:
                column_changes[table] = {"added": added, "dropped": dropped, "modified": modified}

        return {
            "added_tables": added_tables,
            "dropped_tables": dropped_tables,
            "column_changes": column_changes,
        }

    def generate_migration_sql(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        schema: str | None = None,
        dialect: str = "postgresql",
    ) -> str:
        diff = self.diff(source_conn, target_conn, schema)
        src = self._get_schema_snapshot(source_conn, schema)
        lines: List[str] = [
            "-- Pilotbase migration script",
            f"-- Source: {source_conn.name}  →  Target: {target_conn.name}",
            "-- Review carefully before running!\n",
        ]

        for table in diff["added_tables"]:
            cols = src[table]["columns"]
            pk = src[table]["pk"]
            col_defs = []
            for name, c in cols.items():
                col_type = str(c["type"])
                null = "" if c.get("nullable", True) else " NOT NULL"
                pk_flag = " PRIMARY KEY" if {name} == pk else ""
                col_defs.append(f"    {name} {col_type}{null}{pk_flag}")
            lines.append(f"CREATE TABLE {table} (\n" + ",\n".join(col_defs) + "\n);\n")

        for table in diff["dropped_tables"]:
            lines.append(f"-- WARNING: DROP TABLE {table};  (commented out for safety)")
            lines.append(f"-- DROP TABLE IF EXISTS {table};\n")

        for table, changes in diff["column_changes"].items():
            for col_name in changes["added"]:
                c = src[table]["columns"][col_name]
                col_type = str(c["type"])
                null = "" if not c.get("nullable", True) else ""
                lines.append(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}{null};\n")

            for col_name in changes["dropped"]:
                lines.append(f"-- WARNING: ALTER TABLE {table} DROP COLUMN {col_name};  (commented out)")
                lines.append(f"-- ALTER TABLE {table} DROP COLUMN {col_name};\n")

            for col_name in changes["modified"]:
                c = src[table]["columns"][col_name]
                col_type = str(c["type"])
                if dialect == "postgresql":
                    lines.append(f"ALTER TABLE {table} ALTER COLUMN {col_name} TYPE {col_type};\n")
                else:
                    lines.append(f"ALTER TABLE {table} MODIFY COLUMN {col_name} {col_type};\n")

        return "\n".join(lines)


migration_service = MigrationService()
