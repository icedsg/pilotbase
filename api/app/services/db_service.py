"""
Manages live connections to external databases registered by users.
SQL: SQLAlchemy (synchronous, pooled).
NoSQL/Vector: native client adapters (lazy imports so missing optional deps
              only fail at connection time, not at import time).
"""
import json
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet

from app.config import settings
from app.models.connection import DbConnection


# ── Base adapter ──────────────────────────────────────────────────────────────

class BaseAdapter(ABC):
    @abstractmethod
    def test_connection(self) -> bool: ...

    @abstractmethod
    def list_databases(self) -> List[str]: ...

    @abstractmethod
    def list_objects(self, schema: Optional[str] = None) -> List[Dict]: ...

    @abstractmethod
    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]: ...

    @abstractmethod
    def close(self) -> None: ...


# ── SQL (SQLAlchemy) ──────────────────────────────────────────────────────────

class SQLAdapter(BaseAdapter):
    def __init__(self, conn: DbConnection, url: str):
        from sqlalchemy import create_engine
        self._engine = create_engine(url, pool_pre_ping=True, pool_size=3, max_overflow=5)
        self._db_type = conn.db_type
        self._database = conn.database

    def test_connection(self) -> bool:
        from sqlalchemy import text
        try:
            with self._engine.connect() as c:
                c.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def list_databases(self) -> List[str]:
        from sqlalchemy import text
        with self._engine.connect() as c:
            if self._db_type == "postgresql":
                rows = c.execute(text("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"))
                return [r[0] for r in rows]
            if self._db_type in ("mysql", "mariadb"):
                rows = c.execute(text("SHOW DATABASES"))
                return [r[0] for r in rows]
        return [self._database or "main"]

    def list_schemas(self) -> List[str]:
        from sqlalchemy import inspect as sa_inspect
        return sa_inspect(self._engine).get_schema_names()

    def list_objects(self, schema: Optional[str] = None) -> List[Dict]:
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(self._engine)
        tables = [{"name": t, "type": "table"} for t in inspector.get_table_names(schema=schema)]
        views  = [{"name": v, "type": "view"}  for v in inspector.get_view_names(schema=schema)]
        return tables + views

    def describe_table(self, table: str, schema: Optional[str] = None) -> Dict[str, Any]:
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(self._engine)
        return {
            "columns":      [{"name": c["name"], "type": str(c["type"]), "nullable": c.get("nullable", True), "default": str(c.get("server_default") or "")} for c in inspector.get_columns(table, schema=schema)],
            "primary_keys": inspector.get_pk_constraint(table, schema=schema).get("constrained_columns", []),
            "foreign_keys": inspector.get_foreign_keys(table, schema=schema),
            "indexes":      inspector.get_indexes(table, schema=schema),
        }

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        from sqlalchemy import text
        with self._engine.begin() as c:
            result = c.execute(text(query), params or {})
            if result.returns_rows:
                rows = [dict(row._mapping) for row in result.fetchmany(limit)]
                return {"rows": rows, "columns": list(result.keys()), "row_count": len(rows), "truncated": len(rows) == limit}
            return {"rows": [], "columns": [], "row_count": result.rowcount, "affected": result.rowcount}

    def close(self) -> None:
        self._engine.dispose()


# ── MongoDB ───────────────────────────────────────────────────────────────────

class MongoAdapter(BaseAdapter):
    """
    Query format (JSON string):
      {"collection": "users", "filter": {...}, "projection": {...}}
      {"collection": "users", "pipeline": [...]}          ← aggregation
      {"collection": "users", "database": "mydb", ...}   ← override default db
    """
    def __init__(self, conn: DbConnection, extra: Dict):
        import pymongo
        kwargs: Dict[str, Any] = {
            "host": conn.host or "localhost",
            "port": conn.port or 27017,
        }
        if conn.username:
            kwargs["username"] = conn.username
        password = extra.get("_password")
        if password:
            kwargs["password"] = password
            kwargs["authSource"] = extra.get("auth_source", "admin")
        self._client = pymongo.MongoClient(**kwargs)
        self._default_db = conn.database or "admin"

    def test_connection(self) -> bool:
        try:
            self._client.admin.command("ping")
            return True
        except Exception:
            return False

    def list_databases(self) -> List[str]:
        return self._client.list_database_names()

    def list_objects(self, schema: Optional[str] = None) -> List[Dict]:
        db_name = schema or self._default_db
        return [{"name": c, "type": "collection"} for c in self._client[db_name].list_collection_names()]

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        try:
            q = json.loads(query)
        except json.JSONDecodeError as e:
            return {"error": f"Invalid JSON: {e}", "rows": [], "columns": [], "row_count": 0}

        col_name = q.get("collection")
        if not col_name:
            return {"error": "Missing 'collection' key", "rows": [], "columns": [], "row_count": 0}

        db_name = q.get("database", self._default_db)
        col = self._client[db_name][col_name]

        if "pipeline" in q:
            cursor = col.aggregate(q["pipeline"])
        else:
            cursor = col.find(q.get("filter", {}), q.get("projection"))

        rows: List[Dict] = []
        for doc in cursor:
            doc["_id"] = str(doc["_id"])
            rows.append(doc)
            if len(rows) >= limit:
                break

        columns = list(rows[0].keys()) if rows else []
        return {"rows": rows, "columns": columns, "row_count": len(rows), "truncated": len(rows) == limit}

    def close(self) -> None:
        self._client.close()


# ── Redis ─────────────────────────────────────────────────────────────────────

class RedisAdapter(BaseAdapter):
    """
    Query: plain Redis command string, e.g. "KEYS *", "GET mykey", "HGETALL myhash".
    """
    def __init__(self, conn: DbConnection, extra: Dict):
        import redis as redis_lib
        self._client = redis_lib.Redis(
            host=conn.host or "localhost",
            port=conn.port or 6379,
            db=int(conn.database or 0),
            password=extra.get("_password") or None,
            decode_responses=True,
        )

    def test_connection(self) -> bool:
        try:
            return bool(self._client.ping())
        except Exception:
            return False

    def list_databases(self) -> List[str]:
        # Redis logical DBs are 0–15 by default
        return [str(i) for i in range(16)]

    def list_objects(self, schema: Optional[str] = None) -> List[Dict]:
        keys = self._client.keys("*")
        return [{"name": k, "type": "key"} for k in list(keys)[:500]]

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        parts = query.strip().split()
        if not parts:
            return {"error": "Empty command", "rows": [], "columns": [], "row_count": 0}
        try:
            result = self._client.execute_command(*parts)
        except Exception as e:
            return {"error": str(e), "rows": [], "columns": [], "row_count": 0}

        if isinstance(result, list):
            rows = [{"value": v} for v in result[:limit]]
            return {"rows": rows, "columns": ["value"], "row_count": len(rows), "truncated": len(rows) == limit}
        if isinstance(result, dict):
            rows = [{"key": k, "value": v} for k, v in list(result.items())[:limit]]
            return {"rows": rows, "columns": ["key", "value"], "row_count": len(rows), "truncated": False}
        return {"rows": [{"result": str(result)}], "columns": ["result"], "row_count": 1, "truncated": False}

    def close(self) -> None:
        self._client.close()


# ── Qdrant ────────────────────────────────────────────────────────────────────

class QdrantAdapter(BaseAdapter):
    """
    Query format (JSON string):
      {"collection": "my_col", "vector": [...], "limit": 10}          ← ANN search
      {"collection": "my_col", "scroll": true, "limit": 10}           ← browse all
    """
    def __init__(self, conn: DbConnection, extra: Dict):
        from qdrant_client import QdrantClient
        https = conn.ssl_mode in ("require", "verify-full", "true", "on")
        self._client = QdrantClient(
            host=conn.host or "localhost",
            port=conn.port or 6333,
            api_key=extra.get("api_key") or None,
            https=https,
        )

    def test_connection(self) -> bool:
        try:
            self._client.get_collections()
            return True
        except Exception:
            return False

    def list_databases(self) -> List[str]:
        return ["qdrant"]

    def list_objects(self, schema: Optional[str] = None) -> List[Dict]:
        return [{"name": c.name, "type": "collection"} for c in self._client.get_collections().collections]

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        try:
            q = json.loads(query)
        except json.JSONDecodeError as e:
            return {"error": f"Invalid JSON: {e}", "rows": [], "columns": [], "row_count": 0}

        col = q.get("collection")
        if not col:
            return {"error": "Missing 'collection'", "rows": [], "columns": [], "row_count": 0}

        n = min(q.get("limit", 10), limit)
        if q.get("scroll"):
            results, _ = self._client.scroll(collection_name=col, limit=n)
            rows = [{"id": str(r.id), "payload": json.dumps(r.payload)} for r in results]
            columns = ["id", "payload"]
        else:
            hits = self._client.search(collection_name=col, query_vector=q.get("vector", []), limit=n)
            rows = [{"id": str(h.id), "score": h.score, "payload": json.dumps(h.payload)} for h in hits]
            columns = ["id", "score", "payload"]

        return {"rows": rows, "columns": columns, "row_count": len(rows), "truncated": False}

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass


# ── ChromaDB ──────────────────────────────────────────────────────────────────

class ChromaAdapter(BaseAdapter):
    """
    Query format (JSON string):
      {"collection": "my_col", "query_texts": ["search text"], "n_results": 5}
      {"collection": "my_col", "query_embeddings": [[...]], "n_results": 5}
      {"collection": "my_col"}                                         ← list first N ids
    """
    def __init__(self, conn: DbConnection, extra: Dict):
        import chromadb
        kwargs: Dict[str, Any] = {"host": conn.host or "localhost", "port": conn.port or 8000}
        api_key = extra.get("api_key")
        if api_key:
            kwargs["headers"] = {"Authorization": f"Bearer {api_key}"}
        self._client = chromadb.HttpClient(**kwargs)

    def test_connection(self) -> bool:
        try:
            self._client.heartbeat()
            return True
        except Exception:
            return False

    def list_databases(self) -> List[str]:
        return ["chroma"]

    def list_objects(self, schema: Optional[str] = None) -> List[Dict]:
        return [{"name": c.name, "type": "collection"} for c in self._client.list_collections()]

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        try:
            q = json.loads(query)
        except json.JSONDecodeError as e:
            return {"error": f"Invalid JSON: {e}", "rows": [], "columns": [], "row_count": 0}

        col_name = q.get("collection")
        if not col_name:
            return {"error": "Missing 'collection'", "rows": [], "columns": [], "row_count": 0}

        col = self._client.get_collection(col_name)
        n = min(q.get("n_results", 10), limit)

        if "query_texts" in q or "query_embeddings" in q:
            kwargs: Dict[str, Any] = {"n_results": n}
            if "query_texts" in q:
                kwargs["query_texts"] = q["query_texts"]
            else:
                kwargs["query_embeddings"] = q["query_embeddings"]
            results = col.query(**kwargs)
            rows = [
                {"id": doc_id, "document": doc, "distance": dist}
                for doc_id, doc, dist in zip(
                    results["ids"][0], results["documents"][0], results["distances"][0]
                )
            ]
            return {"rows": rows, "columns": ["id", "document", "distance"], "row_count": len(rows), "truncated": False}

        # Default: list ids
        ids = col.get()["ids"][:n]
        rows = [{"id": i} for i in ids]
        return {"rows": rows, "columns": ["id"], "row_count": len(rows), "truncated": False}

    def close(self) -> None:
        pass


# ── Weaviate ──────────────────────────────────────────────────────────────────

class WeaviateAdapter(BaseAdapter):
    """
    Query: GraphQL string, e.g.:
      { Get { Article(limit: 5) { title content } } }
    """
    def __init__(self, conn: DbConnection, extra: Dict):
        import weaviate
        api_key = extra.get("api_key")
        auth = weaviate.auth.AuthApiKey(api_key=api_key) if api_key else None
        scheme = "https" if conn.ssl_mode in ("require", "verify-full", "true", "on") else "http"
        url = f"{scheme}://{conn.host or 'localhost'}:{conn.port or 8080}"
        self._client = weaviate.Client(url, auth_client_secret=auth)

    def test_connection(self) -> bool:
        try:
            return bool(self._client.is_ready())
        except Exception:
            return False

    def list_databases(self) -> List[str]:
        return ["weaviate"]

    def list_objects(self, schema: Optional[str] = None) -> List[Dict]:
        schema_data = self._client.schema.get()
        return [{"name": c["class"], "type": "collection"} for c in schema_data.get("classes", [])]

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        try:
            result = self._client.query.raw(query)
            data = result.get("data", {})
            for op in data.values():
                for items in op.values():
                    if isinstance(items, list):
                        rows = items[:limit]
                        columns = list(rows[0].keys()) if rows else []
                        return {"rows": rows, "columns": columns, "row_count": len(rows), "truncated": len(rows) == limit}
            return {"rows": [], "columns": [], "row_count": 0, "truncated": False}
        except Exception as e:
            return {"error": str(e), "rows": [], "columns": [], "row_count": 0}

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass


# ── Service ───────────────────────────────────────────────────────────────────

_ADAPTER_MAP = {
    "mongodb":  MongoAdapter,
    "redis":    RedisAdapter,
    "qdrant":   QdrantAdapter,
    "chroma":   ChromaAdapter,
    "weaviate": WeaviateAdapter,
}

_SQL_TYPES = {"postgresql", "mysql", "mariadb", "sqlite", "mssql"}

_SQL_DRIVERS = {
    "postgresql": "postgresql+psycopg2",
    "mysql":      "mysql+pymysql",
    "mariadb":    "mysql+pymysql",
    "sqlite":     "sqlite",
    "mssql":      "mssql+pyodbc",
}


class DatabaseService:
    def __init__(self):
        self._adapters: Dict[str, BaseAdapter] = {}
        self._cipher = Fernet(settings.encryption_key.encode())

    # ── Encryption ────────────────────────────────────────────────────────────

    def encrypt_password(self, password: str) -> str:
        return self._cipher.encrypt(password.encode()).decode()

    def decrypt_password(self, encrypted: str) -> str:
        return self._cipher.decrypt(encrypted.encode()).decode()

    # ── Adapter lifecycle ─────────────────────────────────────────────────────

    def _build_sql_url(self, conn: DbConnection) -> str:
        password = self.decrypt_password(conn.password_encrypted) if conn.password_encrypted else ""
        driver = _SQL_DRIVERS.get(conn.db_type, conn.db_type)
        if conn.db_type == "sqlite":
            return f"sqlite:///{conn.database}"
        host_port = f"{conn.host}:{conn.port}" if conn.port else conn.host
        db_part = f"/{conn.database}" if conn.database else ""
        return f"{driver}://{conn.username}:{password}@{host_port}{db_part}"

    def _make_adapter(self, conn: DbConnection) -> BaseAdapter:
        if conn.db_type in _SQL_TYPES:
            return SQLAdapter(conn, self._build_sql_url(conn))

        cls = _ADAPTER_MAP.get(conn.db_type)
        if cls is None:
            raise ValueError(f"Unsupported db_type: {conn.db_type}")

        extra: Dict[str, Any] = json.loads(conn.extra_params) if conn.extra_params else {}
        if conn.password_encrypted:
            extra["_password"] = self.decrypt_password(conn.password_encrypted)
        return cls(conn, extra)  # type: ignore[call-arg]

    def get_adapter(self, conn: DbConnection) -> BaseAdapter:
        if conn.id not in self._adapters:
            self._adapters[conn.id] = self._make_adapter(conn)
        return self._adapters[conn.id]

    def drop_adapter(self, connection_id: str) -> None:
        if connection_id in self._adapters:
            try:
                self._adapters[connection_id].close()
            except Exception:
                pass
            del self._adapters[connection_id]

    # Backward-compat names used by existing routers
    def get_engine(self, conn: DbConnection):
        adapter = self.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return adapter._engine
        raise ValueError(f"{conn.db_type} is not a SQL database; use get_adapter()")

    def drop_engine(self, connection_id: str) -> None:
        self.drop_adapter(connection_id)

    # ── Public API (used by routers) ──────────────────────────────────────────

    def test_connection(self, conn: DbConnection) -> bool:
        try:
            return self.get_adapter(conn).test_connection()
        except Exception:
            return False

    def list_databases(self, conn: DbConnection) -> List[str]:
        return self.get_adapter(conn).list_databases()

    def list_schemas(self, conn: DbConnection) -> List[str]:
        adapter = self.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return adapter.list_schemas()
        return []

    def list_objects(self, conn: DbConnection, schema: Optional[str] = None) -> List[Dict]:
        return self.get_adapter(conn).list_objects(schema)

    def describe_table(self, conn: DbConnection, table: str, schema: Optional[str] = None) -> Dict[str, Any]:
        adapter = self.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return adapter.describe_table(table, schema)
        return {"error": f"describe_table is not supported for {conn.db_type}"}

    def execute_query(
        self,
        conn: DbConnection,
        query: str,
        params: Optional[Dict] = None,
        limit: int = 1000,
    ) -> Dict[str, Any]:
        return self.get_adapter(conn).execute_query(query, params, limit)


db_service = DatabaseService()
