"""
Generates a standalone .sql script (DDL + optional INSERT data) for one or
more tables in a SQL connection, for the "Export as SQL" tree action.
"""
from typing import List, Optional

from sqlalchemy import MetaData, Table, create_engine
from sqlalchemy.schema import CreateTable, DropTable

from app.models.connection import DbConnection
from app.services.db_service import SQLAdapter, db_service

MAX_EXPORT_ROWS = 50_000


class ExportService:

    def _resolve_engine(self, conn: DbConnection, database: Optional[str]):
        """Mirrors SQLAdapter.list_objects: some dialects need a fresh engine
        pointed at `database`, MySQL/MariaDB just use it as the schema."""
        engine = db_service.get_engine(conn)
        schema = None
        temp_engine = None
        if database and conn.db_type in ("postgresql", "mssql", "db2", "cockroachdb", "snowflake"):
            temp_engine = create_engine(engine.url.set(database=database), pool_pre_ping=True)
            engine = temp_engine
        elif database and conn.db_type in ("mysql", "mariadb"):
            schema = database
        return engine, schema, temp_engine

    def generate_sql(
        self,
        conn: DbConnection,
        database: Optional[str],
        tables: List[str],
        create_table: bool = True,
        drop_if_exists: bool = False,
        include_inserts: bool = False,
    ) -> str:
        if not isinstance(db_service.get_adapter(conn), SQLAdapter):
            raise ValueError(f"Export as SQL is only supported for SQL connections, not {conn.db_type}.")
        if not tables:
            raise ValueError("Select at least one table to export.")

        engine, schema, temp_engine = self._resolve_engine(conn, database)
        try:
            lines: List[str] = [
                "-- Pilotbase SQL export",
                f"-- Connection: {conn.name}" + (f"   Database: {database}" if database else ""),
                "",
            ]
            for table_name in tables:
                metadata = MetaData()
                table_obj = Table(table_name, metadata, autoload_with=engine, schema=schema)

                lines.append(f"-- ── {table_name} " + "─" * max(1, 60 - len(table_name)))

                if drop_if_exists:
                    lines.append(str(DropTable(table_obj, if_exists=True).compile(dialect=engine.dialect)).strip() + ";")

                if create_table:
                    lines.append(str(CreateTable(table_obj).compile(dialect=engine.dialect)).strip() + ";")

                if include_inserts:
                    lines.append("")
                    try:
                        row_count = 0
                        with engine.connect() as c:
                            result = c.execution_options(stream_results=True).execute(table_obj.select())
                            for row in result:
                                if row_count >= MAX_EXPORT_ROWS:
                                    lines.append(f"-- … truncated after {MAX_EXPORT_ROWS} rows")
                                    break
                                stmt = table_obj.insert().values(**dict(row._mapping))
                                compiled = stmt.compile(dialect=engine.dialect, compile_kwargs={"literal_binds": True})
                                lines.append(str(compiled).strip() + ";")
                                row_count += 1
                    except Exception as e:
                        lines.append(f"-- Failed to generate INSERT statements for {table_name}: {e}")

                lines.append("")

            return "\n".join(lines)
        finally:
            if temp_engine:
                temp_engine.dispose()


export_service = ExportService()
