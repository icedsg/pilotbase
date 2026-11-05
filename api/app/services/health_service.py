"""The Health view's reads: slow statements and who blocks whom.

Everything here runs in a read-only transaction and is rolled back. A setting the
database lacks (pg_stat_statements, performance_schema) comes back as a section with
state "off" and the line that would turn it on; Health shows that line and never runs it.

Rows go to the UI as strings: pg_stat_statements' queryid is a 64-bit number that
JavaScript would round, and ui/src/lib/health reads named string columns.
"""
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.engine import Connection

HEALTH_DB_TYPES = frozenset({"postgresql", "mysql", "mariadb"})
STATEMENT_LIMIT = 200
SESSION_LIMIT = 500
_MARK = "pilotbase:health"
_HIDDEN_TEXT = "<insufficient privilege>"

PG_TURN_ON = (
    "-- postgresql.conf, then restart PostgreSQL:\n"
    "shared_preload_libraries = 'pg_stat_statements'\n"
    "-- then in this database:\n"
    "CREATE EXTENSION pg_stat_statements;"
)
MYSQL_TURN_ON = "-- my.cnf, then restart the server:\n[mysqld]\nperformance_schema = ON"
MYSQL_GRANT = "GRANT SELECT ON performance_schema.* TO 'your_user'@'%';"
MYSQL_LOCK_GRANT = "GRANT PROCESS ON *.* TO 'your_user'@'%';\n" + MYSQL_GRANT

PG_LOCK_QUERY = f"""SELECT /* {_MARK} */ a.pid,
       pg_blocking_pids(a.pid) AS blocked_by,
       a.usename, a.application_name, a.client_addr,
       a.state, a.wait_event_type, a.wait_event,
       now() - a.xact_start AS xact_age,
       now() - a.state_change AS state_age,
       l.mode AS waiting_for, l.locktype, l.relation::regclass AS relation,
       left(a.query, 500) AS query
FROM pg_stat_activity a
LEFT JOIN LATERAL (SELECT * FROM pg_locks l WHERE l.pid = a.pid AND NOT l.granted LIMIT 1) l ON true
WHERE a.backend_type = 'client backend' AND a.pid <> pg_backend_pid()
ORDER BY a.xact_start NULLS LAST
LIMIT {SESSION_LIMIT}"""

MYSQL_SLOW_QUERY = f"""SELECT DIGEST, COUNT_STAR, SUM_TIMER_WAIT, AVG_TIMER_WAIT,
       SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_ROWS_AFFECTED, SUM_NO_INDEX_USED,
       SUM_CREATED_TMP_DISK_TABLES, SUM_SORT_MERGE_PASSES,
       LEFT(DIGEST_TEXT, 2000) AS DIGEST_TEXT
FROM performance_schema.events_statements_summary_by_digest
WHERE (:db = '' OR SCHEMA_NAME = :db)
  AND IFNULL(DIGEST_TEXT, '') NOT LIKE '%performance_schema%'
  AND IFNULL(DIGEST_TEXT, '') NOT LIKE '%innodb_trx%'
ORDER BY SUM_TIMER_WAIT DESC
LIMIT {STATEMENT_LIMIT}"""

# {waits}, {requesting}, {blocking} and {lock_row} differ between MySQL 8 and MariaDB / 5.7.
_MYSQL_LOCK_QUERY = """SELECT t.trx_mysql_thread_id AS pid,
       (SELECT GROUP_CONCAT(b.trx_mysql_thread_id)
          FROM {waits} w
          JOIN information_schema.innodb_trx b ON b.trx_id = w.{blocking}
         WHERE w.{requesting} = t.trx_id) AS blocked_by,
       p.USER AS usename, p.HOST AS client_addr,
       CASE WHEN p.COMMAND = 'Sleep' THEN 'idle in transaction' ELSE LOWER(t.trx_state) END AS state,
       TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) AS xact_age,
       COALESCE(TIMESTAMPDIFF(SECOND, t.trx_wait_started, NOW()), p.TIME) AS state_age,
       l.lock_mode AS waiting_for, l.lock_table AS relation,
       LEFT(COALESCE(t.trx_query, p.INFO, ''), 500) AS query
FROM information_schema.innodb_trx t
LEFT JOIN information_schema.PROCESSLIST p ON p.ID = t.trx_mysql_thread_id
LEFT JOIN {lock_row} l ON l.lock_id = t.trx_requested_lock_id
WHERE t.trx_mysql_thread_id <> CONNECTION_ID()
LIMIT """ + str(SESSION_LIMIT)

MYSQL8_LOCK_QUERY = _MYSQL_LOCK_QUERY.format(
    waits="performance_schema.data_lock_waits",
    requesting="REQUESTING_ENGINE_TRANSACTION_ID",
    blocking="BLOCKING_ENGINE_TRANSACTION_ID",
    lock_row=(
        "(SELECT ENGINE_LOCK_ID AS lock_id, LOCK_MODE AS lock_mode,"
        " CONCAT(OBJECT_SCHEMA, '.', OBJECT_NAME) AS lock_table FROM performance_schema.data_locks)"
    ),
)
MARIADB_LOCK_QUERY = _MYSQL_LOCK_QUERY.format(
    waits="information_schema.innodb_lock_waits",
    requesting="requesting_trx_id",
    blocking="blocking_trx_id",
    lock_row="information_schema.innodb_locks",
)

# An ALTER TABLE waiting behind an open transaction shows here and not in innodb_trx.
MYSQL8_MDL_QUERY = f"""SELECT DISTINCT wt.PROCESSLIST_ID AS pid, ht.PROCESSLIST_ID AS blocker,
       wt.PROCESSLIST_USER AS usename, wt.PROCESSLIST_HOST AS client_addr,
       wt.PROCESSLIST_TIME AS state_age,
       w.LOCK_TYPE AS waiting_for,
       CONCAT(w.OBJECT_SCHEMA, '.', w.OBJECT_NAME) AS relation,
       LEFT(COALESCE(wt.PROCESSLIST_INFO, ''), 500) AS query,
       ht.PROCESSLIST_USER AS blocker_user, ht.PROCESSLIST_HOST AS blocker_client,
       ht.PROCESSLIST_COMMAND AS blocker_command, ht.PROCESSLIST_TIME AS blocker_age,
       LEFT(COALESCE(ht.PROCESSLIST_INFO, ''), 500) AS blocker_query
FROM performance_schema.metadata_locks w
JOIN performance_schema.metadata_locks h
  ON h.OBJECT_TYPE = w.OBJECT_TYPE AND h.OBJECT_SCHEMA <=> w.OBJECT_SCHEMA AND h.OBJECT_NAME <=> w.OBJECT_NAME
 AND h.LOCK_STATUS = 'GRANTED' AND h.OWNER_THREAD_ID <> w.OWNER_THREAD_ID
JOIN performance_schema.threads wt ON wt.THREAD_ID = w.OWNER_THREAD_ID
JOIN performance_schema.threads ht ON ht.THREAD_ID = h.OWNER_THREAD_ID
WHERE w.LOCK_STATUS = 'PENDING' AND wt.PROCESSLIST_ID IS NOT NULL AND ht.PROCESSLIST_ID IS NOT NULL
LIMIT {SESSION_LIMIT}"""


def pg_slow_query(schema: str, version_num: int) -> str:
    """pg_stat_statements for the current database, in the columns this server has
    (PostgreSQL 13 renamed total_time and added planning time and WAL)."""
    columns = (
        "total_exec_time, total_plan_time, mean_exec_time, rows, shared_blks_hit, shared_blks_read,"
        " temp_blks_written, wal_bytes"
        if version_num >= 130000
        else "total_time, mean_time, rows, shared_blks_hit, shared_blks_read, temp_blks_written"
    )
    order = "total_exec_time" if version_num >= 130000 else "total_time"
    quoted = '"' + schema.replace('"', '""') + '"'
    return (
        f"SELECT /* {_MARK} */ queryid, calls, {columns}, left(query, 2000) AS query\n"
        f"FROM {quoted}.pg_stat_statements\n"
        "WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())\n"
        f"  AND coalesce(query, '') NOT LIKE '%{_MARK}%'\n"
        f"ORDER BY {order} DESC\n"
        f"LIMIT {STATEMENT_LIMIT}"
    )


def plain(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        return ",".join(plain(v) for v in value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode("utf-8", "replace")
    return str(value)


def plain_rows(result: Dict[str, Any]) -> List[Dict[str, str]]:
    return [{k: plain(v) for k, v in row.items()} for row in result.get("rows", [])]


def section(state: str, rows: Optional[List[Dict[str, str]]] = None, **extra: Any) -> Dict[str, Any]:
    return {"state": state, "rows": rows or [], "reason": "", "fix": "", "note": "", "since": None, **extra}


def is_access_error(message: str) -> bool:
    low = message.lower()
    return "access denied" in low or "permission denied" in low or "command denied" in low


def first_line(error: Exception) -> str:
    orig = getattr(error, "orig", None) or error
    return str(orig).strip().splitlines()[0][:300] if str(orig).strip() else type(error).__name__


class _Reader:
    """Runs one read-only transaction per call, so one failed read can't abort the next."""

    def __init__(self, adapter: Any, engine: Any, db_type: str):
        self.adapter, self.engine, self.db_type = adapter, engine, db_type

    def read(self, fn: Callable[[Connection], Any]) -> Any:
        with self.engine.connect() as c:
            try:
                if self.db_type == "postgresql":
                    c.exec_driver_sql("SET TRANSACTION READ ONLY")
                    c.exec_driver_sql("SET LOCAL statement_timeout = '10s'")
                else:
                    c.exec_driver_sql("START TRANSACTION READ ONLY")
                return fn(c)
            finally:
                c.rollback()

    def rows(self, sql: str, params: Optional[Dict[str, Any]] = None, limit: int = SESSION_LIMIT) -> List[Dict[str, str]]:
        return self.read(lambda c: plain_rows(self.adapter._exec_statement(c, sql, params, limit)))

    def value(self, sql: str) -> str:
        found = self.rows(sql)
        return next(iter(found[0].values()), "") if found else ""


def pg_slow(reader: _Reader) -> Dict[str, Any]:
    schema = reader.value(
        f"SELECT /* {_MARK} */ n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace "
        "WHERE e.extname = 'pg_stat_statements'"
    )
    if not schema:
        return section("off", reason="pg_stat_statements isn't installed in this database.", fix=PG_TURN_ON)
    return pg_slow_from(reader, schema)


def pg_slow_from(reader: _Reader, schema: str) -> Dict[str, Any]:
    version = int(reader.value(f"SELECT /* {_MARK} */ current_setting('server_version_num')") or 0)
    try:
        rows = reader.rows(pg_slow_query(schema, version), limit=STATEMENT_LIMIT)
    except Exception as e:
        message = first_line(e)
        if "shared_preload_libraries" in message:
            return section("off", reason="pg_stat_statements is installed but not loaded.", fix=PG_TURN_ON)
        if is_access_error(message):
            return section(
                "no_access", reason=message,
                fix=f'GRANT USAGE ON SCHEMA "{schema}" TO your_user;\nGRANT pg_read_all_stats TO your_user;',
            )
        return section("error", reason=message)
    note = ""
    if any(r.get("query") == _HIDDEN_TEXT for r in rows):
        note = "This login can't read other users' statements. GRANT pg_read_all_stats TO your_user; shows them."
    since = None
    if version >= 140000:
        try:
            since = reader.value(f'SELECT /* {_MARK} */ stats_reset FROM "{schema.replace(chr(34), chr(34) * 2)}".pg_stat_statements_info') or None
        except Exception:
            since = None  # an extension older than the server has no info view
    return section("ok", rows, note=note, since=since)


def pg_locks(reader: _Reader) -> Dict[str, Any]:
    try:
        rows = reader.rows(PG_LOCK_QUERY)
    except Exception as e:
        return section("error", reason=first_line(e))
    note = ""
    if any(r.get("query") == _HIDDEN_TEXT for r in rows):
        note = "Other users' statements are hidden from this login. GRANT pg_read_all_stats TO your_user; shows them."
    return section("ok", rows, note=note)


def mysql_slow(reader: _Reader, database: Optional[str]) -> Dict[str, Any]:
    try:
        if reader.value("SELECT @@performance_schema") in ("0", ""):
            return section("off", reason="performance_schema is off on this server.", fix=MYSQL_TURN_ON)
        return section("ok", reader.rows(MYSQL_SLOW_QUERY, {"db": database or ""}, STATEMENT_LIMIT))
    except Exception as e:
        message = first_line(e)
        if is_access_error(message):
            return section("no_access", reason=message, fix=MYSQL_GRANT)
        return section("error", reason=message)


def merge_mdl(sessions: List[Dict[str, str]], waits: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Add metadata lock waits to the InnoDB sessions: the waiter, and its holder when no
    transaction row already names that session."""
    by_pid = {s["pid"]: s for s in sessions}
    for w in waits:
        waiter = by_pid.get(w["pid"])
        if waiter is None:
            waiter = by_pid[w["pid"]] = {
                "pid": w["pid"], "blocked_by": "", "usename": w["usename"], "client_addr": w["client_addr"],
                "state": "waiting for metadata lock", "xact_age": "", "state_age": w["state_age"],
                "waiting_for": w["waiting_for"], "relation": w["relation"], "query": w["query"],
            }
        blockers = [b for b in waiter.get("blocked_by", "").split(",") if b]
        if w["blocker"] not in blockers:
            blockers.append(w["blocker"])
        waiter["blocked_by"] = ",".join(blockers)
        if w["blocker"] not in by_pid:
            by_pid[w["blocker"]] = {
                "pid": w["blocker"], "blocked_by": "", "usename": w["blocker_user"], "client_addr": w["blocker_client"],
                "state": "holds a metadata lock", "xact_age": "", "state_age": w["blocker_age"],
                "waiting_for": "", "relation": "", "query": w["blocker_query"],
            }
    return list(by_pid.values())


def mysql_locks(reader: _Reader) -> Dict[str, Any]:
    version = reader.value("SELECT VERSION()")
    legacy = "mariadb" in version.lower() or version.startswith("5.")
    try:
        rows = reader.rows(MARIADB_LOCK_QUERY if legacy else MYSQL8_LOCK_QUERY)
    except Exception as e:
        message = first_line(e)
        low = message.lower()
        if is_access_error(message) or "process privilege" in low or "1227" in low:
            return section("no_access", reason=message, fix=MYSQL_LOCK_GRANT)
        if "doesn't exist" in low or "unknown table" in low:
            return section("off", reason="performance_schema is off on this server.", fix=MYSQL_TURN_ON)
        return section("error", reason=message)
    if legacy:
        return section("ok", rows, note="Row locks only: this server doesn't list metadata locks here.")
    try:
        return section("ok", merge_mdl(rows, reader.rows(MYSQL8_MDL_QUERY)))
    except Exception:
        return section("ok", rows, note="Row locks only: this login can't read metadata locks.")


def snapshot(adapter: Any, db_type: str, database: Optional[str]) -> Dict[str, Any]:
    if db_type not in HEALTH_DB_TYPES:
        raise ValueError(f"Health isn't available for {db_type}.")
    engine, is_temp = adapter.engine_for(database)
    try:
        reader = _Reader(adapter, engine, db_type)
        if db_type == "postgresql":
            return {"engine": "postgres", "slow": pg_slow(reader), "locks": pg_locks(reader)}
        return {"engine": "mysql", "slow": mysql_slow(reader, database), "locks": mysql_locks(reader)}
    finally:
        if is_temp:
            engine.dispose()
