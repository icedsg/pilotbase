"""
Structured, per-object migration planning.

Builds on top of migration_service's diff() (which already knows how to compare
SQL↔SQL and Mongo↔Mongo snapshots) but reshapes the result into one entry per
table/collection so the UI can show a checkbox picker and a per-object review
list, instead of the flat added/dropped/changed lists diff() returns.

No I/O side effects live here — this module never writes to a database. See
migration_executor.py for the part that actually runs a migration.
"""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

from app.models.connection import DbConnection
from app.services.migration_service import migration_service


class ObjectStatus(str, Enum):
    NEW_ON_SOURCE = "new_on_source"        # missing on target — will be created
    NEW_ON_TARGET = "new_on_target"        # missing on source — informational only, never auto-dropped
    COMMON_NO_CHANGE = "common_no_change"
    COMMON_CHANGED = "common_changed"


class MigrationObjectRow(BaseModel):
    name: str
    on_source: bool
    on_target: bool
    src_rows: Optional[int] = None
    tgt_rows: Optional[int] = None
    src_size: Optional[int] = None
    tgt_size: Optional[int] = None
    has_changes: bool


class ObjectPlanEntry(BaseModel):
    name: str
    status: ObjectStatus
    columns_added: List[str] = []
    columns_dropped: List[str] = []
    columns_modified: List[str] = []
    indexes_added: List[str] = []
    indexes_dropped: List[str] = []
    indexes_changed: List[str] = []
    fks_added: List[str] = []
    fks_dropped: List[str] = []
    src_rows: Optional[int] = None
    tgt_rows: Optional[int] = None
    src_size: Optional[int] = None
    tgt_size: Optional[int] = None
    include: bool = True
    version_instead_of_overwrite: bool = False
    version_name_preview: Optional[str] = None


class MigrationPlan(BaseModel):
    kind: Literal["sql", "mongo"]
    scope: Literal["schema", "schema_data"]
    objects: List[ObjectPlanEntry]


class MigrationPlanService:

    def list_objects(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        schema: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Every table/collection on either side, with presence flags and row/size
        stats — feeds the checkbox picker (step 1)."""
        diff = migration_service.diff(source_conn, target_conn, schema)
        kind = "mongo" if self._is_mongo(source_conn, target_conn) else "sql"

        added = set(diff["added_tables"])      # on source only
        dropped = set(diff["dropped_tables"])  # on target only
        changed = set(diff["column_changes"]) | set(diff["index_changes"]) | set(diff["fk_changes"])
        all_names = sorted(diff["table_stats"].keys())

        rows: List[MigrationObjectRow] = []
        for name in all_names:
            on_source = name not in dropped
            on_target = name not in added
            has_changes = name in added or name in dropped or name in changed
            stats = diff["table_stats"].get(name, {})
            rows.append(MigrationObjectRow(
                name=name,
                on_source=on_source,
                on_target=on_target,
                src_rows=stats.get("src_rows"),
                tgt_rows=stats.get("tgt_rows"),
                src_size=stats.get("src_size"),
                tgt_size=stats.get("tgt_size"),
                has_changes=has_changes,
            ))
        return {"kind": kind, "objects": [r.model_dump() for r in rows]}

    @staticmethod
    def _is_mongo(source_conn: DbConnection, target_conn: DbConnection) -> bool:
        from app.services.db_service import db_service, MongoAdapter
        return isinstance(db_service.get_adapter(source_conn), MongoAdapter)

    def build_plan(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        object_names: List[str],
        scope: Literal["schema", "schema_data"],
        schema: Optional[str] = None,
    ) -> MigrationPlan:
        """Restricts diff() to the caller's selected object_names and reshapes it
        into one ObjectPlanEntry per object (step 2 payload, before review)."""
        diff = migration_service.diff(source_conn, target_conn, schema)
        kind = "mongo" if self._is_mongo(source_conn, target_conn) else "sql"

        added = set(diff["added_tables"])
        dropped = set(diff["dropped_tables"])
        wanted = set(object_names)

        existing_target_names = {n for n in diff["table_stats"] if n not in added}

        entries: List[ObjectPlanEntry] = []
        for name in sorted(wanted):
            if name not in diff["table_stats"]:
                continue
            stats = diff["table_stats"][name]
            col_c = diff["column_changes"].get(name, {})
            idx_c = diff["index_changes"].get(name, {})
            fk_c = diff["fk_changes"].get(name, {})

            if name in added:
                status = ObjectStatus.NEW_ON_SOURCE
            elif name in dropped:
                status = ObjectStatus.NEW_ON_TARGET
            elif col_c or idx_c or fk_c:
                status = ObjectStatus.COMMON_CHANGED
            else:
                status = ObjectStatus.COMMON_NO_CHANGE

            version_preview = None
            if status == ObjectStatus.COMMON_CHANGED:
                version_preview = self.compute_version_name(name, existing_target_names)

            entries.append(ObjectPlanEntry(
                name=name,
                status=status,
                columns_added=col_c.get("added", []),
                columns_dropped=col_c.get("dropped", []),
                columns_modified=col_c.get("modified", []),
                indexes_added=idx_c.get("added", []),
                indexes_dropped=idx_c.get("dropped", []),
                indexes_changed=idx_c.get("changed", []),
                fks_added=fk_c.get("added", []),
                fks_dropped=fk_c.get("dropped", []),
                src_rows=stats.get("src_rows"),
                tgt_rows=stats.get("tgt_rows"),
                src_size=stats.get("src_size"),
                tgt_size=stats.get("tgt_size"),
                include=status != ObjectStatus.COMMON_NO_CHANGE and status != ObjectStatus.NEW_ON_TARGET,
                version_instead_of_overwrite=False,
                version_name_preview=version_preview,
            ))

        return MigrationPlan(kind=kind, scope=scope, objects=entries)

    def compute_version_name(
        self,
        base_name: str,
        existing_names: set,
        now: Optional[datetime] = None,
    ) -> str:
        """`{base_name}_till{day}{month}{year}`, e.g. orders_till6july2026 — lowercase,
        no separators inside the date token. Collision-safe: bumps _2, _3, ... if the
        name is already taken. Called once for a preview at plan time and again
        authoritatively (against a live name list) right before the rename at execute
        time, since the plan may sit open for a while."""
        now = now or datetime.now()
        # Full month name (not abbreviated) matches the "_till4july" style the
        # feature was requested in.
        month_name = now.strftime("%B").lower()
        candidate = f"{base_name}_till{now.day}{month_name}{now.year}"
        if candidate not in existing_names:
            return candidate
        i = 2
        while f"{candidate}_{i}" in existing_names:
            i += 1
        return f"{candidate}_{i}"


migration_plan_service = MigrationPlanService()
