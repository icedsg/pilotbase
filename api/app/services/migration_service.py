"""
Schema diff and migration script generator.
Compares the schema (and, for SQL connections, row counts / data sizes) of two
database connections and returns an ALTER / CREATE / DROP script to bring the
target in line with the source.

Supports SQL-to-SQL (any SQLAlchemy-inspectable dialect) and MongoDB-to-MongoDB
comparisons. Comparing across the two families (e.g. SQL vs Mongo) is rejected
with a clear error rather than attempted, since "table" and "collection" aren't
directly comparable.
"""
from typing import Any, Dict, List, Optional

from sqlalchemy import inspect as sa_inspect, text

from app.models.connection import DbConnection
from app.services.db_service import MongoAdapter, SQLAdapter, db_service


def _col_sig(col: Dict[str, Any]) -> str:
    return f"{col['name']}:{col['type']}:nullable={col.get('nullable', True)}"


def _index_sig(idx: Dict[str, Any]) -> str:
    return f"{sorted(idx.get('column_names', []))}:unique={idx.get('unique', False)}"


def _fk_sig(fk: Dict[str, Any]) -> str:
    return f"{fk.get('constrained_columns')}→{fk.get('referred_table')}.{fk.get('referred_columns')}"


# ── Row-count / size estimates, per SQL dialect ────────────────────────────────

def _table_stats_sql(engine, db_type: str, tables: List[str]) -> Dict[str, Dict[str, Optional[int]]]:
    """Best-effort {table: {rows, size_bytes}}. Uses cheap catalog estimates where
    available (fast, may be stale); falls back to COUNT(*) with no size figure."""
    stats: Dict[str, Dict[str, Optional[int]]] = {t: {"rows": None, "size_bytes": None} for t in tables}

    try:
        with engine.connect() as c:
            if db_type == "postgresql":
                rows = c.execute(text(
                    "SELECT relname, n_live_tup FROM pg_stat_user_tables"
                )).fetchall()
                counts = {r[0]: r[1] for r in rows}
                for t in tables:
                    if t in counts:
                        stats[t]["rows"] = counts[t]
                    try:
                        size = c.execute(
                            text("SELECT pg_total_relation_size(:t)"), {"t": t}
                        ).scalar()
                        stats[t]["size_bytes"] = size
                    except Exception:
                        pass
            elif db_type in ("mysql", "mariadb"):
                rows = c.execute(text(
                    "SELECT table_name, table_rows, data_length + index_length "
                    "FROM information_schema.tables WHERE table_schema = DATABASE()"
                )).fetchall()
                for name, row_count, size in rows:
                    if name in stats:
                        stats[name]["rows"] = row_count
                        stats[name]["size_bytes"] = size
            else:
                for t in tables:
                    try:
                        cnt = c.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
                        stats[t]["rows"] = cnt
                    except Exception:
                        pass
    except Exception:
        pass

    return stats


def _list_routines(engine, db_type: str) -> List[str]:
    """Stored procedures / functions. Empty for dialects with no such catalog (SQLite)."""
    try:
        with engine.connect() as c:
            if db_type == "postgresql":
                rows = c.execute(text(
                    "SELECT routine_name FROM information_schema.routines "
                    "WHERE routine_schema = 'public'"
                )).fetchall()
                return sorted({r[0] for r in rows})
            if db_type in ("mysql", "mariadb"):
                rows = c.execute(text(
                    "SELECT routine_name FROM information_schema.routines "
                    "WHERE routine_schema = DATABASE()"
                )).fetchall()
                return sorted({r[0] for r in rows})
            if db_type == "mssql":
                rows = c.execute(text("SELECT name FROM sys.procedures")).fetchall()
                return sorted({r[0] for r in rows})
    except Exception:
        pass
    return []


class MigrationService:

    # ── SQL snapshot ────────────────────────────────────────────────────────────

    def _get_sql_snapshot(self, conn: DbConnection, schema: Optional[str] = None) -> Dict[str, Any]:
        engine = db_service.get_engine(conn)
        inspector = sa_inspect(engine)
        tables: Dict[str, Any] = {}
        for table in inspector.get_table_names(schema=schema):
            tables[table] = {
                "columns": {c["name"]: c for c in inspector.get_columns(table, schema=schema)},
                "pk": set(inspector.get_pk_constraint(table, schema=schema).get("constrained_columns", [])),
                "indexes": {i["name"]: i for i in inspector.get_indexes(table, schema=schema)},
                "foreign_keys": inspector.get_foreign_keys(table, schema=schema),
            }
        views = sorted(inspector.get_view_names(schema=schema))
        routines = _list_routines(engine, conn.db_type)
        stats = _table_stats_sql(engine, conn.db_type, list(tables))
        return {"kind": "sql", "tables": tables, "views": views, "routines": routines, "stats": stats}

    # ── Mongo snapshot ───────────────────────────────────────────────────────────

    def _get_mongo_snapshot(self, conn: DbConnection) -> Dict[str, Any]:
        client, db_name = db_service.get_mongo_client(conn)
        db = client[db_name]
        collections = sorted(db.list_collection_names())
        stats: Dict[str, Dict[str, Optional[int]]] = {}
        for coll in collections:
            try:
                coll_stats = db.command("collStats", coll)
                stats[coll] = {"rows": coll_stats.get("count"), "size_bytes": coll_stats.get("size")}
            except Exception:
                stats[coll] = {"rows": None, "size_bytes": None}
        return {"kind": "mongo", "tables": collections, "stats": stats}

    def _get_snapshot(self, conn: DbConnection, schema: Optional[str] = None) -> Dict[str, Any]:
        adapter = db_service.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return self._get_sql_snapshot(conn, schema)
        if isinstance(adapter, MongoAdapter):
            return self._get_mongo_snapshot(conn)
        raise ValueError(f"Schema comparison is not supported for {conn.db_type}")

    # ── Diff ─────────────────────────────────────────────────────────────────────

    def diff(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        schema: Optional[str] = None,
    ) -> Dict[str, Any]:
        src = self._get_snapshot(source_conn, schema)
        tgt = self._get_snapshot(target_conn, schema)

        if src["kind"] != tgt["kind"]:
            raise ValueError(
                f"Cannot compare a {src['kind']} connection with a {tgt['kind']} connection."
            )

        if src["kind"] == "mongo":
            return self._diff_mongo(src, tgt)
        return self._diff_sql(src, tgt)

    def _diff_mongo(self, src: Dict[str, Any], tgt: Dict[str, Any]) -> Dict[str, Any]:
        src_colls, tgt_colls = set(src["tables"]), set(tgt["tables"])
        table_stats = {
            name: {
                "src_rows": src["stats"].get(name, {}).get("rows"),
                "tgt_rows": tgt["stats"].get(name, {}).get("rows"),
                "src_size": src["stats"].get(name, {}).get("size_bytes"),
                "tgt_size": tgt["stats"].get(name, {}).get("size_bytes"),
            }
            for name in src_colls | tgt_colls
        }
        return {
            "added_tables": sorted(src_colls - tgt_colls),
            "dropped_tables": sorted(tgt_colls - src_colls),
            "column_changes": {},
            "added_views": [], "dropped_views": [],
            "added_routines": [], "dropped_routines": [],
            "table_stats": table_stats,
            "index_changes": {}, "fk_changes": {},
        }

    def _diff_sql(self, src: Dict[str, Any], tgt: Dict[str, Any]) -> Dict[str, Any]:
        src_tables, tgt_tables = src["tables"], tgt["tables"]
        added_tables = sorted(set(src_tables) - set(tgt_tables))
        dropped_tables = sorted(set(tgt_tables) - set(src_tables))
        common = set(src_tables) & set(tgt_tables)

        column_changes: Dict[str, Any] = {}
        index_changes: Dict[str, Any] = {}
        fk_changes: Dict[str, Any] = {}

        for table in common:
            src_cols = src_tables[table]["columns"]
            tgt_cols = tgt_tables[table]["columns"]

            added = sorted(set(src_cols) - set(tgt_cols))
            dropped = sorted(set(tgt_cols) - set(src_cols))
            modified = [
                c for c in set(src_cols) & set(tgt_cols)
                if _col_sig(src_cols[c]) != _col_sig(tgt_cols[c])
            ]
            if added or dropped or modified:
                column_changes[table] = {"added": added, "dropped": dropped, "modified": modified}

            src_idx = src_tables[table]["indexes"]
            tgt_idx = tgt_tables[table]["indexes"]
            idx_added = sorted(set(src_idx) - set(tgt_idx))
            idx_dropped = sorted(set(tgt_idx) - set(src_idx))
            idx_changed = [
                n for n in set(src_idx) & set(tgt_idx)
                if _index_sig(src_idx[n]) != _index_sig(tgt_idx[n])
            ]
            if idx_added or idx_dropped or idx_changed:
                index_changes[table] = {"added": idx_added, "dropped": idx_dropped, "changed": idx_changed}

            src_fks = {_fk_sig(fk) for fk in src_tables[table]["foreign_keys"]}
            tgt_fks = {_fk_sig(fk) for fk in tgt_tables[table]["foreign_keys"]}
            fk_added = sorted(src_fks - tgt_fks)
            fk_dropped = sorted(tgt_fks - src_fks)
            if fk_added or fk_dropped:
                fk_changes[table] = {"added": fk_added, "dropped": fk_dropped}

        src_views, tgt_views = set(src["views"]), set(tgt["views"])
        src_routines, tgt_routines = set(src["routines"]), set(tgt["routines"])

        table_stats = {
            name: {
                "src_rows": src["stats"].get(name, {}).get("rows"),
                "tgt_rows": tgt["stats"].get(name, {}).get("rows"),
                "src_size": src["stats"].get(name, {}).get("size_bytes"),
                "tgt_size": tgt["stats"].get(name, {}).get("size_bytes"),
            }
            for name in set(src_tables) | set(tgt_tables)
        }

        return {
            "added_tables": added_tables,
            "dropped_tables": dropped_tables,
            "column_changes": column_changes,
            "added_views": sorted(src_views - tgt_views),
            "dropped_views": sorted(tgt_views - src_views),
            "added_routines": sorted(src_routines - tgt_routines),
            "dropped_routines": sorted(tgt_routines - src_routines),
            "table_stats": table_stats,
            "index_changes": index_changes,
            "fk_changes": fk_changes,
        }

    # ── Script generation (SQL only) ─────────────────────────────────────────────

    def generate_migration_sql(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        schema: Optional[str] = None,
        dialect: str = "postgresql",
    ) -> str:
        diff = self.diff(source_conn, target_conn, schema)
        src = self._get_snapshot(source_conn, schema)
        if src["kind"] != "sql":
            raise ValueError("Migration script generation is only supported for SQL connections.")
        src_tables = src["tables"]

        lines: List[str] = [
            "-- Pilotbase migration script",
            f"-- Source: {source_conn.name}  →  Target: {target_conn.name}",
            "-- Review carefully before running!\n",
        ]

        for table in diff["added_tables"]:
            cols = src_tables[table]["columns"]
            pk = src_tables[table]["pk"]
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
                c = src_tables[table]["columns"][col_name]
                col_type = str(c["type"])
                lines.append(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type};\n")

            for col_name in changes["dropped"]:
                lines.append(f"-- WARNING: ALTER TABLE {table} DROP COLUMN {col_name};  (commented out)")
                lines.append(f"-- ALTER TABLE {table} DROP COLUMN {col_name};\n")

            for col_name in changes["modified"]:
                c = src_tables[table]["columns"][col_name]
                col_type = str(c["type"])
                if dialect == "postgresql":
                    lines.append(f"ALTER TABLE {table} ALTER COLUMN {col_name} TYPE {col_type};\n")
                else:
                    lines.append(f"ALTER TABLE {table} MODIFY COLUMN {col_name} {col_type};\n")

        return "\n".join(lines)


migration_service = MigrationService()
