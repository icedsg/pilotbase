"""
Generates a standalone .sql script (DDL + optional INSERT data) for one or
more tables in a SQL connection, for the "Export as SQL" tree action.
"""
from typing import List, Optional

import datetime as _dt
import decimal
from sqlalchemy import MetaData, Table, create_engine, text
from sqlalchemy.schema import CreateTable, DropTable

from app.models.connection import DbConnection
from app.services.db_service import SQLAdapter, db_service, duckdb_reflect_columns, duckdb_reflect_constraints

MAX_EXPORT_ROWS = 50_000


def _duckdb_literal(v) -> str:
    """Render a Python value fetched from DuckDB as a DuckDB SQL literal.
    Nested values (LIST/STRUCT/MAP) come back as Python lists/dicts and are
    rendered with DuckDB's own literal syntax so the export round-trips."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float, decimal.Decimal)):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return "'" + "".join(f"\\x{b:02x}" for b in bytes(v)) + "'::BLOB"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_duckdb_literal(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"'{k}': {_duckdb_literal(x)}" for k, x in v.items()) + "}"
    if isinstance(v, (_dt.datetime, _dt.date, _dt.time)):
        v = v.isoformat()
    return "'" + str(v).replace("'", "''") + "'"


def _duckdb_table_sql(engine, table_name: str, schema, create_table: bool, drop_if_exists: bool,
                      include_inserts: bool) -> List[str]:
    """DDL + INSERTs for one DuckDB table, straight from DuckDB's catalog.
    duckdb-engine reflects nested column types as NullType, which SQLAlchemy
    can't compile into DDL, so this path never goes through Table autoload."""
    qname = f'"{schema}"."{table_name}"' if schema else f'"{table_name}"'
    cols = duckdb_reflect_columns(engine, table_name, schema)
    pk_cols = duckdb_reflect_constraints(engine, table_name, schema)[0]
    lines: List[str] = []
    if drop_if_exists:
        lines.append(f"DROP TABLE IF EXISTS {qname};")
    if create_table:
        defs = []
        for c in cols:
            d = f'    "{c["name"]}" {c["type"]}'
            if not c["nullable"]:
                d += " NOT NULL"
            if c["default"]:
                d += f" DEFAULT {c['default']}"
            defs.append(d)
        if pk_cols:
            defs.append("    PRIMARY KEY (" + ", ".join(f'"{c}"' for c in pk_cols) + ")")
        lines.append(f"CREATE TABLE {qname} (\n" + ",\n".join(defs) + "\n);")
    if include_inserts:
        lines.append("")
        col_list = ", ".join(f'"{c["name"]}"' for c in cols)
        with engine.connect() as c:
            result = c.execute(text(f"SELECT {col_list} FROM {qname}"))
            for i, row in enumerate(result):
                if i >= MAX_EXPORT_ROWS:
                    lines.append(f"-- … truncated after {MAX_EXPORT_ROWS} rows")
                    break
                lines.append(f"INSERT INTO {qname} ({col_list}) VALUES ({', '.join(_duckdb_literal(v) for v in row)});")
    return lines


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
                lines.append(f"-- ── {table_name} " + "─" * max(1, 60 - len(table_name)))

                if conn.db_type == "duckdb":
                    lines.extend(_duckdb_table_sql(engine, table_name, schema, create_table, drop_if_exists, include_inserts))
                    lines.append("")
                    continue

                metadata = MetaData()
                table_obj = Table(table_name, metadata, autoload_with=engine, schema=schema)

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
