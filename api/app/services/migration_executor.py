"""
Live migration execution engine.

Recomputes an authoritative plan from a fresh diff at execute time (only
{name, include, version_instead_of_overwrite} are trusted from the client —
see routers/migration.py), builds an ordered per-object step list, and runs it
in a worker thread (every SQLAlchemy/pymongo call here is blocking), emitting
WS progress via websocket.manager.send_threadsafe as it goes.

Best-effort per object: one object's failure marks that object's remaining
steps as errored and the job moves on to the next object, rather than
aborting the whole run.
"""
import asyncio
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from app.models.connection import DbConnection
from app.services.db_service import db_service
from app.services.migration_service import migration_service, build_create_table_ddl
from app.services.migration_plan_service import migration_plan_service, ObjectStatus, ObjectPlanEntry
from app.websocket.manager import manager

DEFAULT_BATCH_SIZE = 2000


class JobStepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


@dataclass
class JobStep:
    key: str
    object_name: str
    action: Literal["create", "columns", "copy", "version"]
    label: str
    status: JobStepStatus = JobStepStatus.PENDING
    progress_done: int = 0
    progress_total: Optional[int] = None
    error: Optional[str] = None


@dataclass
class MigrationJob:
    job_id: str
    user_id: str
    steps: List[JobStep]
    status: JobStepStatus = JobStepStatus.RUNNING
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None


class MigrationJobRegistry:
    _MAX_JOBS = 200

    def __init__(self):
        self._jobs: "OrderedDict[str, MigrationJob]" = OrderedDict()

    def create(self, user_id: str, steps: List[JobStep]) -> MigrationJob:
        job = MigrationJob(job_id=str(uuid.uuid4()), user_id=user_id, steps=steps)
        self._jobs[job.job_id] = job
        while len(self._jobs) > self._MAX_JOBS:
            self._jobs.popitem(last=False)
        return job

    def get(self, job_id: str) -> Optional[MigrationJob]:
        return self._jobs.get(job_id)

    @staticmethod
    def serialize(job: MigrationJob) -> Dict[str, Any]:
        return asdict(job)


job_registry = MigrationJobRegistry()


class MigrationExecutor:
    def __init__(self):
        # job_id -> (source_conn, target_conn, plan_objects, kind, scope, schema),
        # stashed by prepare_job (called off-loop, may block) and consumed by run
        # (scheduled as an event-loop task so asyncio.create_task works) — kept out
        # of the MigrationJob dataclass itself since that gets asdict()-serialized
        # for GET /jobs/{id} and shouldn't leak connection objects.
        self._contexts: Dict[str, tuple] = {}

    # ── Step-list construction (fast — no I/O beyond the plan's own diff call) ──

    def _build_steps(self, objects: List[ObjectPlanEntry], kind: str, scope: str) -> List[JobStep]:
        noun = "table" if kind == "sql" else "collection"
        steps: List[JobStep] = []
        for entry in objects:
            if entry.status == ObjectStatus.NEW_ON_TARGET or not entry.include:
                continue
            name = entry.name

            if entry.version_instead_of_overwrite and entry.status == ObjectStatus.COMMON_CHANGED:
                version_name = entry.version_name_preview or f"{name}_till_versioned"
                steps.append(JobStep(f"{name}:version", name, "version", f"Renaming {name} → {version_name}…"))
                steps.append(JobStep(f"{name}:create", name, "create", f"Creating {noun} {name}…"))
                if scope == "schema_data":
                    steps.append(JobStep(f"{name}:copy", name, "copy", f"Copying data for {name}…", progress_total=entry.src_rows))
            elif entry.status == ObjectStatus.NEW_ON_SOURCE:
                steps.append(JobStep(f"{name}:create", name, "create", f"Creating {noun} {name}…"))
                if scope == "schema_data":
                    steps.append(JobStep(f"{name}:copy", name, "copy", f"Copying data for {name}…", progress_total=entry.src_rows))
            elif entry.status == ObjectStatus.COMMON_CHANGED:
                if kind == "sql" and entry.columns_added:
                    steps.append(JobStep(f"{name}:columns", name, "columns", f"Adding columns to {name}…"))
                if scope == "schema_data":
                    steps.append(JobStep(f"{name}:copy", name, "copy", f"Copying data for {name}…", progress_total=entry.src_rows))
            elif entry.status == ObjectStatus.COMMON_NO_CHANGE:
                if scope == "schema_data":
                    steps.append(JobStep(f"{name}:copy", name, "copy", f"Copying data for {name}…", progress_total=entry.src_rows))
        return steps

    def prepare_job(
        self,
        source_conn: DbConnection,
        target_conn: DbConnection,
        object_specs: List[Dict[str, Any]],
        scope: Literal["schema", "schema_data"],
        schema: Optional[str],
        user_id: str,
    ) -> MigrationJob:
        """Blocking (does a fresh diff) — call via `await db_service.run_off_loop(...)`
        from the route handler. Registers the job and stashes what `run()` needs to
        actually execute it, but does not start execution itself."""
        included_names = [o["name"] for o in object_specs if o.get("include")]
        plan = migration_plan_service.build_plan(source_conn, target_conn, included_names, scope, schema)

        version_flags = {o["name"]: bool(o.get("version_instead_of_overwrite")) for o in object_specs}
        for entry in plan.objects:
            entry.include = True  # build_plan already restricted to included_names
            entry.version_instead_of_overwrite = version_flags.get(entry.name, False)

        steps = self._build_steps(plan.objects, plan.kind, scope)
        job = job_registry.create(user_id, steps)
        self._contexts[job.job_id] = (source_conn, target_conn, plan.objects, plan.kind, scope, schema)
        return job

    # ── Execution ────────────────────────────────────────────────────────────

    async def run(self, job: MigrationJob) -> None:
        """Call as `asyncio.create_task(migration_executor.run(job))` from the route
        handler, right after `prepare_job` — must run on the event loop thread since
        it schedules the worker-thread body via asyncio.to_thread."""
        ctx = self._contexts.pop(job.job_id, None)
        if ctx is None:
            return
        source_conn, target_conn, objects, kind, scope, schema = ctx
        await asyncio.to_thread(self._run_job_sync, job, source_conn, target_conn, objects, kind, scope, schema)

    def _run_job_sync(
        self,
        job: MigrationJob,
        source_conn: DbConnection,
        target_conn: DbConnection,
        objects: List[ObjectPlanEntry],
        kind: str,
        scope: str,
        schema: Optional[str],
    ) -> None:
        try:
            if kind == "sql":
                source_engine = db_service.get_engine(source_conn)
                target_engine = db_service.get_engine(target_conn)
                src_snapshot = migration_service.get_snapshot(source_conn, schema)
                tgt_snapshot = migration_service.get_snapshot(target_conn, schema)
                existing_target_names = set(tgt_snapshot["tables"].keys())
                for entry in objects:
                    self._run_sql_object(job, entry, source_engine, target_engine, target_conn, src_snapshot["tables"], existing_target_names)
            else:
                source_client, source_db_name = db_service.get_mongo_client(source_conn)
                target_client, target_db_name = db_service.get_mongo_client(target_conn)
                source_db = source_client[source_conn.database or source_db_name]
                target_db = target_client[target_conn.database or target_db_name]
                existing_target_names = set(target_db.list_collection_names())
                for entry in objects:
                    self._run_mongo_object(job, entry, source_db, target_db, existing_target_names)
        except Exception as e:
            job.status = JobStepStatus.ERROR
            job.error = str(e)
            job.finished_at = time.time()
            manager.send_threadsafe(job.user_id, "migration_error", {"job_id": job.job_id, "message": str(e)})
            return

        job.status = JobStepStatus.ERROR if any(s.status == JobStepStatus.ERROR for s in job.steps) else JobStepStatus.DONE
        job.finished_at = time.time()
        errors = [{"object": s.object_name, "message": s.error} for s in job.steps if s.status == JobStepStatus.ERROR]
        rows_copied = sum(s.progress_done for s in job.steps if s.action == "copy")
        objects_migrated = len({s.object_name for s in job.steps if s.status == JobStepStatus.DONE})
        manager.send_threadsafe(job.user_id, "migration_done", {
            "job_id": job.job_id,
            "summary": {"objects_migrated": objects_migrated, "rows_copied": rows_copied, "errors": errors},
        })

    # ── Per-object dispatch ──────────────────────────────────────────────────

    @staticmethod
    def _find_step(job: MigrationJob, object_name: str, action: str) -> Optional[JobStep]:
        return next((s for s in job.steps if s.object_name == object_name and s.action == action), None)

    def _set_running(self, job: MigrationJob, step: JobStep) -> None:
        step.status = JobStepStatus.RUNNING
        manager.send_threadsafe(job.user_id, "migration_progress", {
            "job_id": job.job_id, "step_key": step.key, "done": step.progress_done, "total": step.progress_total, "label": step.label,
        })

    def _set_done(self, job: MigrationJob, step: JobStep) -> None:
        step.status = JobStepStatus.DONE
        manager.send_threadsafe(job.user_id, "migration_step_done", {"job_id": job.job_id, "step_key": step.key, "status": "done"})

    def _fail_running_steps(self, job: MigrationJob, steps: List[Optional[JobStep]], error: str) -> None:
        for step in steps:
            if step and step.status == JobStepStatus.RUNNING:
                step.status = JobStepStatus.ERROR
                step.error = error
                manager.send_threadsafe(job.user_id, "migration_step_done", {"job_id": job.job_id, "step_key": step.key, "status": "error", "error": error})

    def _run_sql_object(
        self,
        job: MigrationJob,
        entry: ObjectPlanEntry,
        source_engine,
        target_engine,
        target_conn: DbConnection,
        src_tables: Dict[str, Any],
        existing_target_names: set,
    ) -> None:
        from sqlalchemy import text
        name = entry.name
        version_step = self._find_step(job, name, "version")
        create_step = self._find_step(job, name, "create")
        columns_step = self._find_step(job, name, "columns")
        copy_step = self._find_step(job, name, "copy")

        try:
            if version_step:
                self._set_running(job, version_step)
                new_name = migration_plan_service.compute_version_name(name, existing_target_names, datetime.now())
                db_service.rename_table(target_conn, name, new_name)
                existing_target_names.add(new_name)
                self._set_done(job, version_step)

            if create_step:
                self._set_running(job, create_step)
                cols = src_tables[name]["columns"]
                pk = src_tables[name]["pk"]
                ddl = build_create_table_ddl(name, cols, pk)
                with target_engine.begin() as c:
                    c.execute(text(ddl))
                existing_target_names.add(name)
                self._set_done(job, create_step)

            if columns_step:
                self._set_running(job, columns_step)
                cols = src_tables[name]["columns"]
                with target_engine.begin() as c:
                    for col_name in entry.columns_added:
                        col_type = str(cols[col_name]["type"])
                        c.execute(text(f"ALTER TABLE {name} ADD COLUMN {col_name} {col_type}"))
                self._set_done(job, columns_step)

            if copy_step:
                self._set_running(job, copy_step)
                pk_cols = list(src_tables[name]["pk"])
                pk_col = pk_cols[0] if len(pk_cols) == 1 else None
                self._copy_sql_rows(job, copy_step, source_engine, target_engine, name, pk_col, target_conn.db_type)
                self._set_done(job, copy_step)
        except Exception as e:
            self._fail_running_steps(job, [version_step, create_step, columns_step, copy_step], str(e))

    def _run_mongo_object(
        self,
        job: MigrationJob,
        entry: ObjectPlanEntry,
        source_db,
        target_db,
        existing_target_names: set,
    ) -> None:
        name = entry.name
        version_step = self._find_step(job, name, "version")
        create_step = self._find_step(job, name, "create")
        copy_step = self._find_step(job, name, "copy")

        try:
            if version_step:
                self._set_running(job, version_step)
                new_name = migration_plan_service.compute_version_name(name, existing_target_names, datetime.now())
                target_db[name].rename(new_name)
                existing_target_names.add(new_name)
                self._set_done(job, version_step)

            if create_step:
                self._set_running(job, create_step)
                if name not in target_db.list_collection_names():
                    target_db.create_collection(name)
                existing_target_names.add(name)
                self._set_done(job, create_step)

            if copy_step:
                self._set_running(job, copy_step)
                self._copy_mongo_docs(job, copy_step, source_db[name], target_db[name])
                self._set_done(job, copy_step)
        except Exception as e:
            self._fail_running_steps(job, [version_step, create_step, copy_step], str(e))

    # ── Batched data copy ────────────────────────────────────────────────────

    def _emit_copy_progress(self, job: MigrationJob, step: JobStep, done: int) -> None:
        step.progress_done = done
        total_txt = f"{step.progress_total:,}" if step.progress_total else "?"
        label = f"Copying rows for {step.object_name} ({done:,} / {total_txt})…"
        manager.send_threadsafe(job.user_id, "migration_progress", {
            "job_id": job.job_id, "step_key": step.key, "done": done, "total": step.progress_total, "label": label,
        })

    def _copy_sql_rows(self, job: MigrationJob, step: JobStep, source_engine, target_engine, table_name: str, pk_col: Optional[str], target_db_type: str) -> None:
        from sqlalchemy import Table, MetaData, select
        src_table = Table(table_name, MetaData(), autoload_with=source_engine)
        tgt_table = Table(table_name, MetaData(), autoload_with=target_engine)

        done = 0
        last_pk = None
        with source_engine.connect() as src_conn:
            while True:
                if pk_col is not None:
                    col = src_table.c[pk_col]
                    stmt = select(src_table).order_by(col).limit(DEFAULT_BATCH_SIZE)
                    if last_pk is not None:
                        stmt = stmt.where(col > last_pk)
                else:
                    stmt = select(src_table).offset(done).limit(DEFAULT_BATCH_SIZE)

                rows = [dict(r._mapping) for r in src_conn.execute(stmt)]
                if not rows:
                    break

                self._insert_ignore(target_engine, tgt_table, rows, target_db_type)
                done += len(rows)
                if pk_col is not None:
                    last_pk = rows[-1][pk_col]
                self._emit_copy_progress(job, step, done)

                if len(rows) < DEFAULT_BATCH_SIZE:
                    break

    @staticmethod
    def _insert_ignore(engine, table, rows: List[Dict[str, Any]], db_type: str) -> None:
        if not rows:
            return
        try:
            if db_type in ("postgresql", "cockroachdb", "duckdb"):
                # duckdb-engine's dialect subclasses the Postgres dialect and
                # DuckDB supports the same ON CONFLICT DO NOTHING clause.
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                stmt = pg_insert(table).values(rows).on_conflict_do_nothing()
                with engine.begin() as c:
                    c.execute(stmt)
            elif db_type in ("mysql", "mariadb"):
                from sqlalchemy.dialects.mysql import insert as mysql_insert
                stmt = mysql_insert(table).values(rows).prefix_with("IGNORE")
                with engine.begin() as c:
                    c.execute(stmt)
            elif db_type == "sqlite":
                from sqlalchemy.dialects.sqlite import insert as sqlite_insert
                stmt = sqlite_insert(table).values(rows).prefix_with("OR IGNORE")
                with engine.begin() as c:
                    c.execute(stmt)
            else:
                with engine.begin() as c:
                    c.execute(table.insert(), rows)
        except Exception:
            # Dialect without a native "ignore duplicates" path taken, or a
            # non-PK conflict in the batch — fall back to per-row inserts so
            # one bad row doesn't sink the whole batch.
            for row in rows:
                try:
                    with engine.begin() as c:
                        c.execute(table.insert(), [row])
                except Exception:
                    pass

    def _copy_mongo_docs(self, job: MigrationJob, step: JobStep, source_col, target_col) -> None:
        buffer: List[Dict[str, Any]] = []
        done = 0
        for doc in source_col.find({}, batch_size=DEFAULT_BATCH_SIZE):
            buffer.append(doc)
            if len(buffer) >= DEFAULT_BATCH_SIZE:
                done += self._insert_many_ignore(target_col, buffer)
                buffer = []
                self._emit_copy_progress(job, step, done)
        if buffer:
            done += self._insert_many_ignore(target_col, buffer)
            self._emit_copy_progress(job, step, done)

    @staticmethod
    def _insert_many_ignore(col, docs: List[Dict[str, Any]]) -> int:
        try:
            col.insert_many(docs, ordered=False)
            return len(docs)
        except Exception as e:
            from pymongo.errors import BulkWriteError
            if isinstance(e, BulkWriteError):
                return e.details.get("nInserted", 0)
            return 0


migration_executor = MigrationExecutor()
