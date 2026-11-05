"""Health reads. The pure parts always run; the live parts need a database:

  HEALTH_PG_URL      a PostgreSQL database this test may create tables in
  HEALTH_MYSQL_URL   mysql+pymysql://root@127.0.0.1:PORT/shop on MySQL 8 with performance_schema on
  HEALTH_MARIADB_URL the same on MariaDB

The PostgreSQL role needn't be a superuser. Where it can't create pg_stat_statements, the "installed" path runs
against a table with the view's column names instead (see test_pg_slow_reads_the_view_columns).
"""
import os
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ENCRYPTION_KEY", "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=")

from app.services import health_service as hs  # noqa: E402


def adapter_for(url: str, db_type: str):
    from app.services.db_service import SQLAdapter

    engine = create_engine(url, pool_pre_ping=True)
    adapter = SQLAdapter.__new__(SQLAdapter)
    adapter._engine, adapter._db_type, adapter._db_creds = engine, db_type, {}
    adapter._connect_args_used = {}
    return adapter, engine


def test_plain_keeps_big_ids_and_lists_as_text():
    assert hs.plain(9007199254740993) == "9007199254740993"
    assert hs.plain([12, 13]) == "12,13"
    assert hs.plain(None) == ""
    assert hs.plain(b"abc") == "abc"


def test_pg_slow_query_follows_the_server_version():
    new, old = hs.pg_slow_query("public", 180000), hs.pg_slow_query("public", 120000)
    assert "total_exec_time" in new and "wal_bytes" in new
    assert "total_time" in old and "total_exec_time" not in old and "wal_bytes" not in old
    assert '"we""ird".pg_stat_statements' in hs.pg_slow_query('we"ird', 180000)


def test_health_is_only_for_engines_that_have_it():
    with pytest.raises(ValueError):
        hs.snapshot(SimpleNamespace(), "sqlite", None)


def test_merge_mdl_adds_the_waiter_and_its_holder_once():
    sessions = [{"pid": "5", "blocked_by": "", "state": "idle in transaction"}]
    wait = dict(
        pid="9", blocker="5", usename="a", client_addr="h", state_age="3", waiting_for="EXCLUSIVE",
        relation="shop.t", query="ALTER TABLE t", blocker_user="b", blocker_client="h", blocker_command="Sleep",
        blocker_age="60", blocker_query="",
    )
    merged = {s["pid"]: s for s in hs.merge_mdl(sessions, [wait, dict(wait, blocker="6")])}
    assert merged["9"]["blocked_by"] == "5,6"
    assert merged["5"]["state"] == "idle in transaction"  # the transaction row is kept
    assert merged["6"]["state"] == "holds a metadata lock"


def hold_a_lock(engine, holder_sql, waiter_sql, read):
    """Holder keeps a transaction open, a waiter blocks behind it, then `read` runs."""
    holder = engine.connect()
    holder.exec_driver_sql(holder_sql)
    done = threading.Event()

    def wait():
        with engine.connect() as c:
            try:
                c.exec_driver_sql(waiter_sql)
                c.rollback()
            finally:
                done.set()

    t = threading.Thread(target=wait, daemon=True)
    t.start()
    try:
        time.sleep(1.5)
        return read()
    finally:
        holder.rollback()
        holder.close()
        t.join(15)
        assert done.is_set()


PG_URL = os.environ.get("HEALTH_PG_URL")
pg_only = pytest.mark.skipif(not PG_URL, reason="HEALTH_PG_URL not set")


@pg_only
def test_pg_without_the_extension_says_how_to_turn_it_on_and_runs_nothing():
    adapter, engine = adapter_for(PG_URL, "postgresql")
    with engine.begin() as c:
        has = c.exec_driver_sql("SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements'").first()
    if has:
        pytest.skip("this database has the extension")
    snap = hs.snapshot(adapter, "postgresql", None)
    assert snap["engine"] == "postgres"
    assert snap["slow"]["state"] == "off"
    assert "CREATE EXTENSION pg_stat_statements" in snap["slow"]["fix"]
    with engine.connect() as c:
        assert c.exec_driver_sql("SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements'").first() is None


@pg_only
def test_pg_slow_reads_the_view_columns():
    """A stand-in with pg_stat_statements' PostgreSQL 18 column names: proves the statement parses and the row shape,
    not the extension itself."""
    adapter, engine = adapter_for(PG_URL, "postgresql")
    with engine.begin() as c:
        c.exec_driver_sql("DROP SCHEMA IF EXISTS health_standin CASCADE")
        c.exec_driver_sql("CREATE SCHEMA health_standin")
        c.exec_driver_sql(
            """CREATE TABLE health_standin.pg_stat_statements (dbid oid, queryid bigint, calls bigint, total_exec_time float8,
               total_plan_time float8, mean_exec_time float8, rows bigint, shared_blks_hit bigint, shared_blks_read bigint,
               temp_blks_written bigint, wal_bytes numeric, query text)"""
        )
        c.exec_driver_sql("CREATE TABLE health_standin.pg_stat_statements_info (dealloc bigint, stats_reset timestamptz)")
        c.exec_driver_sql("INSERT INTO health_standin.pg_stat_statements_info VALUES (0, now())")
        c.exec_driver_sql(
            """INSERT INTO health_standin.pg_stat_statements
               SELECT oid, 9007199254740993, 5, 500, 1, 100, 5, 10, 90, 0, 0, 'SELECT * FROM orders WHERE note LIKE ''%%x%%'''
               FROM pg_database WHERE datname = current_database()"""
        )
        c.exec_driver_sql(
            """INSERT INTO health_standin.pg_stat_statements
               SELECT oid, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 'SELECT /* pilotbase:health */ 1' FROM pg_database WHERE datname = current_database()"""
        )
    try:
        section = hs.pg_slow_from(hs._Reader(adapter, engine, "postgresql"), "health_standin")
        assert section["state"] == "ok", section["reason"]
        assert [r["queryid"] for r in section["rows"]] == ["9007199254740993"]  # our own reads are left out
        assert section["since"]
    finally:
        with engine.begin() as c:
            c.exec_driver_sql("DROP SCHEMA health_standin CASCADE")


@pg_only
def test_pg_reads_are_read_only():
    adapter, engine = adapter_for(PG_URL, "postgresql")
    reader = hs._Reader(adapter, engine, "postgresql")
    with pytest.raises(Exception, match="read-only"):
        reader.rows("CREATE TABLE health_should_not_exist (a int)")


@pg_only
def test_pg_locks_show_who_blocks_whom():
    adapter, engine = adapter_for(PG_URL, "postgresql")
    with engine.begin() as c:
        c.exec_driver_sql("DROP TABLE IF EXISTS health_lock_test")
        c.exec_driver_sql("CREATE TABLE health_lock_test (id int primary key, a int)")
        c.exec_driver_sql("INSERT INTO health_lock_test VALUES (1, 1)")
    try:
        snap = hold_a_lock(
            engine,
            "UPDATE health_lock_test SET a = 2 WHERE id = 1",
            "ALTER TABLE health_lock_test ADD COLUMN b int",
            lambda: hs.snapshot(adapter, "postgresql", None),
        )
    finally:
        with engine.begin() as c:
            c.exec_driver_sql("DROP TABLE health_lock_test")
    assert snap["locks"]["state"] == "ok"
    waiters = [r for r in snap["locks"]["rows"] if r["blocked_by"]]
    assert len(waiters) == 1
    assert waiters[0]["waiting_for"] == "AccessExclusiveLock"
    assert waiters[0]["relation"] == "health_lock_test"
    holder = next(r for r in snap["locks"]["rows"] if r["pid"] == waiters[0]["blocked_by"])
    assert holder["state"] == "idle in transaction"


def run_mysql_case(url, db_type, holder, waiter, expect_mode):
    adapter, engine = adapter_for(url, db_type)
    with engine.begin() as c:
        c.exec_driver_sql("DROP TABLE IF EXISTS health_lock_test")
        c.exec_driver_sql("CREATE TABLE health_lock_test (id int primary key, a int)")
        c.exec_driver_sql("INSERT INTO health_lock_test VALUES (1, 1)")
        for _ in range(3):
            c.exec_driver_sql("SELECT a FROM health_lock_test WHERE a = 1")
    try:
        db = engine.url.database
        snap = hold_a_lock(engine, holder, waiter, lambda: hs.snapshot(adapter, db_type, db))
    finally:
        with engine.begin() as c:
            c.exec_driver_sql("DROP TABLE health_lock_test")
    return snap


MYSQL_URL = os.environ.get("HEALTH_MYSQL_URL")
MARIADB_URL = os.environ.get("HEALTH_MARIADB_URL")


@pytest.mark.skipif(not MYSQL_URL, reason="HEALTH_MYSQL_URL not set")
def test_mysql_row_lock_and_slow_statements():
    snap = run_mysql_case(
        MYSQL_URL, "mysql", "UPDATE health_lock_test SET a = 2 WHERE id = 1", "UPDATE health_lock_test SET a = 3 WHERE id = 1", "X",
    )
    assert snap["engine"] == "mysql"
    assert snap["slow"]["state"] == "ok", snap["slow"]["reason"]
    assert any("health_lock_test" in r["DIGEST_TEXT"].lower() for r in snap["slow"]["rows"])
    assert not any("performance_schema" in r["DIGEST_TEXT"] for r in snap["slow"]["rows"])
    waiters = [r for r in snap["locks"]["rows"] if r["blocked_by"]]
    assert len(waiters) == 1, snap["locks"]
    assert waiters[0]["waiting_for"].startswith("X")
    assert waiters[0]["relation"].endswith("health_lock_test")


@pytest.mark.skipif(not MYSQL_URL, reason="HEALTH_MYSQL_URL not set")
def test_mysql_alter_waiting_on_a_metadata_lock_is_shown():
    snap = run_mysql_case(
        MYSQL_URL, "mysql", "UPDATE health_lock_test SET a = 2 WHERE id = 1", "ALTER TABLE health_lock_test ADD COLUMN b int", "EXCLUSIVE",
    )
    waiters = [r for r in snap["locks"]["rows"] if r["blocked_by"]]
    assert len(waiters) == 1, snap["locks"]
    assert "ALTER TABLE" in waiters[0]["query"]
    holder = next(r for r in snap["locks"]["rows"] if r["pid"] == waiters[0]["blocked_by"])
    assert holder["state"] == "idle in transaction"


@pytest.mark.skipif(not MARIADB_URL, reason="HEALTH_MARIADB_URL not set")
def test_mariadb_row_lock():
    snap = run_mysql_case(
        MARIADB_URL, "mariadb", "UPDATE health_lock_test SET a = 2 WHERE id = 1", "UPDATE health_lock_test SET a = 3 WHERE id = 1", "X",
    )
    assert snap["slow"]["state"] in ("ok", "off"), snap["slow"]["reason"]
    waiters = [r for r in snap["locks"]["rows"] if r["blocked_by"]]
    assert len(waiters) == 1, snap["locks"]
    assert "Row locks only" in snap["locks"]["note"]
