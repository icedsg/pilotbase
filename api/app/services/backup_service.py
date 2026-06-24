"""
Backup service — generates SQL dumps for supported database types.
pg_dump / mysqldump are invoked as subprocesses when available.
For databases without CLI tools, a portable SQL INSERT dump is generated via SQLAlchemy.
"""
import os
import subprocess
import json
from datetime import datetime, timezone
from typing import Optional

from app.config import settings
from app.models.connection import DbConnection
from app.services.db_service import db_service


class BackupService:

    def __init__(self):
        os.makedirs(settings.backups_dir, exist_ok=True)

    def _filename(self, conn: DbConnection) -> str:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in conn.name)
        return os.path.join(settings.backups_dir, f"{safe_name}_{ts}.sql")

    def _pg_dump(self, conn: DbConnection, out_path: str) -> str:
        password = db_service.decrypt_password(conn.password_encrypted or "")
        env = os.environ.copy()
        env["PGPASSWORD"] = password

        cmd = [
            "pg_dump",
            "-h", conn.host or "localhost",
            "-p", str(conn.port or 5432),
            "-U", conn.username or "postgres",
            "-d", conn.database or "postgres",
            "-f", out_path,
            "--no-password",
        ]
        result = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"pg_dump failed: {result.stderr}")
        return out_path

    def _mysql_dump(self, conn: DbConnection, out_path: str) -> str:
        password = db_service.decrypt_password(conn.password_encrypted or "")
        cmd = [
            "mysqldump",
            f"-h{conn.host or 'localhost'}",
            f"-P{conn.port or 3306}",
            f"-u{conn.username or 'root'}",
            f"-p{password}",
            conn.database or "",
        ]
        with open(out_path, "w") as f:
            result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"mysqldump failed: {result.stderr}")
        return out_path

    def _generic_dump(self, conn: DbConnection, out_path: str) -> str:
        """Portable INSERT-based dump via SQLAlchemy — works for any driver."""
        from sqlalchemy import text, inspect
        engine = db_service.get_engine(conn)
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        with open(out_path, "w") as f:
            f.write(f"-- Pilotbase generic dump of {conn.name}\n")
            f.write(f"-- Generated: {datetime.now(timezone.utc).isoformat()}\n\n")

            with engine.connect() as c:
                for table in tables:
                    f.write(f"-- Table: {table}\n")
                    rows = c.execute(text(f'SELECT * FROM "{table}"'))
                    cols = list(rows.keys())
                    for row in rows:
                        values = ", ".join(
                            f"'{str(v).replace(chr(39), chr(39)*2)}'" if v is not None else "NULL"
                            for v in row
                        )
                        col_list = ", ".join(f'"{c}"' for c in cols)
                        f.write(f'INSERT INTO "{table}" ({col_list}) VALUES ({values});\n')
                    f.write("\n")
        return out_path

    def run_backup(self, conn: DbConnection) -> str:
        out_path = self._filename(conn)

        if conn.db_type == "postgresql":
            try:
                return self._pg_dump(conn, out_path)
            except FileNotFoundError:
                pass  # pg_dump not available, fall through to generic

        if conn.db_type in ("mysql", "mariadb"):
            try:
                return self._mysql_dump(conn, out_path)
            except FileNotFoundError:
                pass

        return self._generic_dump(conn, out_path)

    def list_backups(self, conn_name: Optional[str] = None) -> list:
        files = []
        for fname in sorted(os.listdir(settings.backups_dir), reverse=True):
            if conn_name and not fname.startswith(conn_name):
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
