"""
Backup service — generates dumps for supported database types.
pg_dump / mysqldump are invoked as subprocesses when available.
For SQL databases without CLI tools, a portable dump (schema DDL + INSERT data)
is generated via SQLAlchemy. MongoDB is dumped as one JSONL file per collection.
Any other db_type (Redis, vector DBs, ...) is reported as unsupported rather than
attempted, since get_engine() only works for SQL adapters.

Every dump can target a specific database on the connection (not just the one
the connection was originally configured with) — this matters because a single
SQL server connection can browse many databases, and the caller (a right-click
on a specific database in the tree) knows which one it actually wants backed up.
"""
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.config import settings
from app.models.connection import DbConnection
from app.services.db_service import db_service

_UNSUPPORTED_TYPES = {"redis", "qdrant", "chroma", "weaviate", "pinecone", "milvus", "cassandra", "dynamodb"}

# Dialects where "database" means a separate catalog reachable only by
# reconnecting with a different database in the connection URL.
_RECONNECT_DIALECTS = {"postgresql", "mssql", "db2", "cockroachdb", "snowflake"}


class BackupUnsupportedError(Exception):
    """Raised when a connection's db_type has no backup strategy."""


def _quote(db_type: str, name: str) -> str:
    if db_type in ("mysql", "mariadb"):
        return f"`{name}`"
    if db_type == "mssql":
        return f"[{name}]"
    return f'"{name}"'


class BackupService:

    def __init__(self):
        os.makedirs(settings.backups_dir, exist_ok=True)

    @staticmethod
    def safe_name(name: str) -> str:
        return "".join(c if c.isalnum() or c in "-_" else "_" for c in name)

    def _filename(self, conn: DbConnection, ext: str = "sql", database: Optional[str] = None) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        parts = [self.safe_name(conn.name)]
        if database:
            parts.append(self.safe_name(database))
        parts.append(ts)
        return os.path.join(settings.backups_dir, "_".join(parts) + f".{ext}")

    def _pg_dump(self, conn: DbConnection, out_path: str, database: Optional[str] = None) -> str:
        password = db_service.decrypt_password(conn.password_encrypted or "")
        env = os.environ.copy()
        env["PGPASSWORD"] = password

        cmd = [
            "pg_dump",
            "-h", conn.host or "localhost",
            "-p", str(conn.port or 5432),
            "-U", conn.username or "postgres",
            "-d", database or conn.database or "postgres",
            "-f", out_path,
            "--no-password",
        ]
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {result.stderr}")
        return out_path

    def _mysql_dump(self, conn: DbConnection, out_path: str, database: Optional[str] = None) -> str:
        if shutil.which("mysqldump") is None:
            raise FileNotFoundError("mysqldump")

        password = db_service.decrypt_password(conn.password_encrypted or "")
        cmd = [
            "mysqldump",
            f"-h{conn.host or 'localhost'}",
            f"-P{conn.port or 3306}",
            f"-u{conn.username or 'root'}",
            f"-p{password}",
            database or conn.database or "",
        ]
        with open(out_path, "w") as f:
            result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"mysqldump failed: {result.stderr}")
        return out_path

    def _generic_dump(self, conn: DbConnection, out_path: str, database: Optional[str] = None) -> int:
        """Portable schema (CREATE TABLE) + data (INSERT) dump via SQLAlchemy —
        works for any SQL driver, used whenever pg_dump/mysqldump aren't available.
        Returns the number of tables written (0 usually means the target database
        was wrong/empty, not that the dump failed)."""
        from sqlalchemy import create_engine, inspect, text

        base_engine = db_service.get_engine(conn)
        engine = base_engine
        temp_engine = None
        schema: Optional[str] = None
        try:
            if database and conn.db_type in _RECONNECT_DIALECTS:
                temp_engine = create_engine(base_engine.url.set(database=database), pool_pre_ping=True)
                engine = temp_engine
            elif database and conn.db_type in ("mysql", "mariadb"):
                schema = database

            inspector = inspect(engine)
            tables = inspector.get_table_names(schema=schema)
            target_label = database or conn.database or "(default)"

            def qualified(table: str) -> str:
                if schema:
                    return f"{_quote(conn.db_type, schema)}.{_quote(conn.db_type, table)}"
                return _quote(conn.db_type, table)

            with open(out_path, "w") as f:
                f.write(f"-- Pilotbase generic dump of {conn.name} (database: {target_label})\n")
                f.write(f"-- Generated: {datetime.now(timezone.utc).isoformat()}\n\n")

                if not tables:
                    f.write(
                        f"-- WARNING: no tables found in database '{target_label}'. "
                        "This is usually a sign the wrong database was targeted "
                        "(e.g. the connection's default database instead of the one you're using).\n"
                    )

                with engine.connect() as c:
                    for table in tables:
                        cols = inspector.get_columns(table, schema=schema)
                        pk = set(inspector.get_pk_constraint(table, schema=schema).get("constrained_columns", []))

                        f.write(f"-- Table: {table}\n")
                        col_defs = []
                        for col in cols:
                            null = "" if col.get("nullable", True) else " NOT NULL"
                            pk_flag = " PRIMARY KEY" if {col["name"]} == pk else ""
                            col_defs.append(f'    {_quote(conn.db_type, col["name"])} {col["type"]}{null}{pk_flag}')
                        f.write(f"CREATE TABLE IF NOT EXISTS {qualified(table)} (\n" + ",\n".join(col_defs) + "\n);\n")

                        cols_sql = ", ".join(_quote(conn.db_type, c["name"]) for c in cols)
                        rows = c.execute(text(f"SELECT {cols_sql} FROM {qualified(table)}"))
                        col_names = list(rows.keys())
                        for row in rows:
                            values = ", ".join(
                                f"'{str(v).replace(chr(39), chr(39) * 2)}'" if v is not None else "NULL"
                                for v in row
                            )
                            col_list = ", ".join(_quote(conn.db_type, c) for c in col_names)
                            f.write(f"INSERT INTO {qualified(table)} ({col_list}) VALUES ({values});\n")
                        f.write("\n")
            return len(tables)
        finally:
            if temp_engine:
                temp_engine.dispose()

    def _mongo_dump(self, conn: DbConnection, out_path: str, database: Optional[str] = None) -> int:
        """One JSON-Lines block per collection, written into a single .jsonl file.
        Returns the number of collections written."""
        client, default_db = db_service.get_mongo_client(conn)
        db_name = database or default_db
        colls = client[db_name].list_collection_names()
        with open(out_path, "w") as f:
            f.write(f"-- Pilotbase Mongo dump of {conn.name} (database: {db_name})\n")
            if not colls:
                f.write(f"-- WARNING: no collections found in database '{db_name}'.\n")
            for coll_name in colls:
                f.write(f"-- Collection: {coll_name}\n")
                for doc in client[db_name][coll_name].find({}):
                    doc["_id"] = str(doc["_id"])
                    f.write(json.dumps(doc, default=str) + "\n")
        return len(colls)

    def run_backup(self, conn: DbConnection, database: Optional[str] = None) -> Dict[str, Any]:
        """Returns {path, filename, method, object_count, warning?}."""
        if conn.db_type == "mongodb":
            path = self._filename(conn, "jsonl", database)
            count = self._mongo_dump(conn, path, database)
            return self._result(path, "mongo", count, "collections", database, conn)

        if conn.db_type in _UNSUPPORTED_TYPES:
            raise BackupUnsupportedError(f"Backup not supported for {conn.db_type}")

        out_path = self._filename(conn, database=database)

        if conn.db_type == "postgresql":
            try:
                path = self._pg_dump(conn, out_path, database)
                return self._result(path, "pg_dump", None, "tables", database, conn)
            except FileNotFoundError:
                pass  # pg_dump not available, fall through to generic

        if conn.db_type in ("mysql", "mariadb"):
            try:
                path = self._mysql_dump(conn, out_path, database)
                return self._result(path, "mysqldump", None, "tables", database, conn)
            except FileNotFoundError:
                pass

        count = self._generic_dump(conn, out_path, database)
        return self._result(out_path, "generic", count, "tables", database, conn)

    @staticmethod
    def _result(path: str, method: str, count: Optional[int], unit: str,
                database: Optional[str], conn: DbConnection) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "path": path,
            "filename": os.path.basename(path),
            "method": method,
            "object_count": count,
            "database": database or conn.database,
        }
        if count == 0:
            result["warning"] = (
                f"No {unit} found in database '{database or conn.database}' — "
                "double check this is the database you meant to back up."
            )
        return result

    def list_backups(self, conn_name: Optional[str] = None) -> list:
        # Filenames on disk are sanitized via safe_name() (spaces/punctuation → "_"),
        # so the filter must sanitize conn_name the same way or it never matches
        # connection names containing anything but alnum/-/_ characters.
        prefix = f"{self.safe_name(conn_name)}_" if conn_name else None
        files = []
        for fname in sorted(os.listdir(settings.backups_dir), reverse=True):
            if prefix and not fname.startswith(prefix):
                continue
            fpath = os.path.join(settings.backups_dir, fname)
            files.append({
                "filename": fname,
                "path": fpath,
                "size_bytes": os.path.getsize(fpath),
                "created_at": datetime.fromtimestamp(os.path.getctime(fpath), tz=timezone.utc).isoformat(),
            })
        return files


backup_service = BackupService()
