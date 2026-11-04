"""SQL connections honour the SSL setting and survive special characters in credentials.

Unit part needs nothing. Live part, each host:port:password with a database app:
PB_TLS_MARIADB (--require-secure-transport=ON, user root), PB_PLAIN_MARIADB (--skip-ssl, user root),
PB_PLAIN_PG (no TLS, user postgres).
"""
import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ENCRYPTION_KEY", "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=")

from app.models.connection import DbConnection  # noqa: E402
from app.services.db_service import DatabaseService, SQLAdapter  # noqa: E402


def _conn(**kw) -> DbConnection:
    base = dict(id="t", name="t", db_type="postgresql", host="h", port=5432, database="app", username="admin")
    return DbConnection(**{**base, **kw})


def _url(svc: DatabaseService, conn: DbConnection, password: str):
    conn.password_encrypted = svc.encrypt_password(password)
    return make_url(svc._build_sql_url(conn))


@pytest.fixture
def svc():
    return DatabaseService()


@pytest.mark.parametrize("pw", ["p@ss/w:rd%?#", "plain", "a b+c"])
def test_password_survives_the_url(svc, pw):
    url = _url(svc, _conn(), pw)
    assert url.password == pw and url.host == "h" and url.port == 5432 and url.database == "app"


def test_username_survives_the_url(svc):
    assert _url(svc, _conn(username="me@corp"), "x").username == "me@corp"


@pytest.mark.parametrize("mode,want", [("require", "require"), ("verify-full", "verify-full"), ("on", "require"),
                                       ("disable", "disable")])
def test_postgres_gets_sslmode(svc, mode, want):
    assert _url(svc, _conn(ssl_mode=mode), "x").query["sslmode"] == want


@pytest.mark.parametrize("mode", [None, "", "nonsense"])
def test_postgres_no_sslmode_when_unset(svc, mode):
    assert "sslmode" not in _url(svc, _conn(ssl_mode=mode), "x").query


def test_mysql_tls_args():
    assert "ssl" not in SQLAdapter._connect_args("mariadb", 5, None)
    assert SQLAdapter._connect_args("mysql", 5, "disable")["ssl_disabled"] is True
    assert SQLAdapter._connect_args("mariadb", 5, "require")["ssl"] == {"check_hostname": False}
    full = SQLAdapter._connect_args("mysql", 5, "verify-full")["ssl"]
    assert full["check_hostname"] is True and full["ca"]


def _live(name):
    host, port, password = os.environ[name].split(":", 2)
    return dict(host=host, port=int(port), password=password)


@pytest.mark.skipif(not os.environ.get("PB_TLS_MARIADB"), reason="PB_TLS_MARIADB not set")
def test_live_server_that_demands_tls(svc):
    kw = dict(db_type="mariadb", database="app", username="root", **_live("PB_TLS_MARIADB"))
    off, error, _ = svc.test_connection_params(**kw, ssl_mode="disable")
    assert not off and "secure" in error.lower()
    for mode in (None, "require"):
        ok, error, dbs = svc.test_connection_params(**kw, ssl_mode=mode)
        assert ok, error
        assert "app" in dbs


@pytest.mark.skipif(not os.environ.get("PB_PLAIN_MARIADB"), reason="PB_PLAIN_MARIADB not set")
def test_live_require_refuses_a_mariadb_without_tls(svc):
    kw = dict(db_type="mariadb", database="app", username="root", **_live("PB_PLAIN_MARIADB"))
    assert svc.test_connection_params(**kw, ssl_mode="disable")[0]
    ok, error, _ = svc.test_connection_params(**kw, ssl_mode="require")
    assert not ok and "ssl" in error.lower()


@pytest.mark.skipif(not os.environ.get("PB_PLAIN_PG"), reason="PB_PLAIN_PG not set")
def test_live_require_refuses_a_postgres_without_tls(svc):
    kw = dict(db_type="postgresql", database="app", username="postgres", **_live("PB_PLAIN_PG"))
    assert svc.test_connection_params(**kw)[0]
    ok, error, _ = svc.test_connection_params(**kw, ssl_mode="require")
    assert not ok and "ssl" in error.lower()
