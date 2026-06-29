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
    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]: ...

    @abstractmethod
    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]: ...

    @abstractmethod
    def close(self) -> None: ...

    def get_version(self) -> Optional[str]:
        return None


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

    def create_database(self, db_name: str) -> None:
        from sqlalchemy import text
        if '"' in db_name:
            raise ValueError("Database name cannot contain double quotes")
        if self._db_type == "postgresql":
            with self._engine.connect() as c:
                c = c.execution_options(isolation_level="AUTOCOMMIT")
                c.execute(text(f'CREATE DATABASE "{db_name}"'))
        elif self._db_type in ("mysql", "mariadb"):
            if "`" in db_name:
                raise ValueError("Database name cannot contain backticks")
            with self._engine.begin() as c:
                c.execute(text(f"CREATE DATABASE `{db_name}`"))
        else:
            raise ValueError(f"create_database is not supported for {self._db_type}")

    def create_db_user(self, username: str, password: str, database: Optional[str] = None) -> None:
        from sqlalchemy import text
        if self._db_type == "postgresql":
            if '"' in username:
                raise ValueError("Username cannot contain double quotes")
            with self._engine.begin() as c:
                c.execute(text(f'CREATE USER "{username}" WITH PASSWORD :pw'), {"pw": password})
                if database:
                    if '"' in database:
                        raise ValueError("Database name cannot contain double quotes")
                    c.execute(text(f'GRANT ALL PRIVILEGES ON DATABASE "{database}" TO "{username}"'))
        elif self._db_type in ("mysql", "mariadb"):
            if "'" in username or "\\" in username:
                raise ValueError("Username cannot contain single quotes or backslashes")
            with self._engine.begin() as c:
                c.execute(text(f"CREATE USER '{username}'@'%' IDENTIFIED BY :pw"), {"pw": password})
                if database:
                    if "`" in database:
                        raise ValueError("Database name cannot contain backticks")
                    c.execute(text(f"GRANT ALL PRIVILEGES ON `{database}`.* TO '{username}'@'%'"))
                    c.execute(text("FLUSH PRIVILEGES"))
        else:
            raise ValueError(f"create_db_user is not supported for {self._db_type}")

    _PG_SYSTEM_DBS = frozenset({"postgres", "template0", "template1"})
    _MYSQL_SYSTEM_DBS = frozenset({"information_schema", "mysql", "performance_schema", "sys"})

    def list_databases(self) -> List[str]:
        from sqlalchemy import text
        with self._engine.connect() as c:
            if self._db_type == "postgresql":
                rows = c.execute(text("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"))
                return [r[0] for r in rows if r[0] not in self._PG_SYSTEM_DBS]
            if self._db_type in ("mysql", "mariadb"):
                rows = c.execute(text("SHOW DATABASES"))
                return [r[0] for r in rows if r[0] not in self._MYSQL_SYSTEM_DBS]
        return [self._database or "main"]

    def list_schemas(self) -> List[str]:
        from sqlalchemy import inspect as sa_inspect
        return sa_inspect(self._engine).get_schema_names()

    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
        from sqlalchemy import create_engine, inspect as sa_inspect
        engine = self._engine
        temp_engine = None
        try:
            if database and self._db_type in ("postgresql", "mssql"):
                temp_engine = create_engine(engine.url.set(database=database), pool_pre_ping=True)
                engine = temp_engine
            elif database and self._db_type in ("mysql", "mariadb"):
                schema = database
            inspector = sa_inspect(engine)
            tables = [{"name": t, "type": "table"} for t in inspector.get_table_names(schema=schema)]
            views  = [{"name": v, "type": "view"}  for v in inspector.get_view_names(schema=schema)]
            return tables + views
        finally:
            if temp_engine:
                temp_engine.dispose()

    def describe_table(self, table: str, schema: Optional[str] = None, database: Optional[str] = None) -> Dict[str, Any]:
        from sqlalchemy import create_engine, inspect as sa_inspect
        engine = self._engine
        temp_engine = None
        try:
            if database and self._db_type in ("postgresql", "mssql"):
                temp_engine = create_engine(engine.url.set(database=database), pool_pre_ping=True)
                engine = temp_engine
            elif database and self._db_type in ("mysql", "mariadb"):
                schema = database
            inspector = sa_inspect(engine)
            return {
                "columns":      [{"name": c["name"], "type": str(c["type"]), "nullable": c.get("nullable", True), "default": str(c.get("server_default") or "")} for c in inspector.get_columns(table, schema=schema)],
                "primary_keys": inspector.get_pk_constraint(table, schema=schema).get("constrained_columns", []),
                "foreign_keys": inspector.get_foreign_keys(table, schema=schema),
                "indexes":      inspector.get_indexes(table, schema=schema),
            }
        finally:
            if temp_engine:
                temp_engine.dispose()

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000, database: Optional[str] = None) -> Dict[str, Any]:
        from sqlalchemy import create_engine, text
        engine = self._engine
        temp_engine = None
        try:
            if database and self._db_type in ("postgresql", "mssql"):
                temp_engine = create_engine(engine.url.set(database=database), pool_pre_ping=True)
                engine = temp_engine
            elif database and self._db_type in ("mysql", "mariadb"):
                pass  # MySQL uses qualified table names (db.table) in the query itself
            with engine.begin() as c:
                result = c.execute(text(query), params or {})
                if result.returns_rows:
                    rows = [dict(row._mapping) for row in result.fetchmany(limit)]
                    return {"rows": rows, "columns": list(result.keys()), "row_count": len(rows), "truncated": len(rows) == limit}
                return {"rows": [], "columns": [], "row_count": result.rowcount, "affected": result.rowcount}
        finally:
            if temp_engine:
                temp_engine.dispose()

    def get_version(self) -> Optional[str]:
        from sqlalchemy import text
        try:
            with self._engine.connect() as c:
                if self._db_type == "postgresql":
                    row = c.execute(text("SHOW server_version")).fetchone()
                    return row[0].split()[0] if row else None
                if self._db_type in ("mysql", "mariadb"):
                    row = c.execute(text("SELECT VERSION()")).fetchone()
                    return row[0] if row else None
                if self._db_type == "sqlite":
                    row = c.execute(text("SELECT sqlite_version()")).fetchone()
                    return row[0] if row else None
                if self._db_type == "mssql":
                    row = c.execute(text("SELECT SERVERPROPERTY('ProductVersion')")).fetchone()
                    return str(row[0]) if row else None
        except Exception:
            return None

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

    _SYSTEM_DBS = frozenset({"admin", "local", "config"})

    def list_databases(self) -> List[str]:
        return [db for db in self._client.list_database_names() if db not in self._SYSTEM_DBS]

    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
        db_name = database or schema or self._default_db
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

    def get_version(self) -> Optional[str]:
        try:
            return self._client.server_info().get("version")
        except Exception:
            return None

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

    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
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

    def get_version(self) -> Optional[str]:
        try:
            return self._client.info("server").get("redis_version")
        except Exception:
            return None

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

    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
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

    def delete_chunk(self, collection: str, chunk_id: str) -> None:
        from qdrant_client.models import PointIdsList
        self._client.delete(collection_name=collection, points_selector=PointIdsList(points=[chunk_id]))

    def update_chunk(self, collection: str, chunk_id: str, properties: Dict) -> None:
        payload = {k: v for k, v in properties.items() if k not in ("id", "score")}
        self._client.set_payload(collection_name=collection, payload=payload, points=[chunk_id])

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

    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
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
        n = min(q.get("n_results", q.get("limit", 10)), limit)

        if q.get("scroll"):
            result = col.get(limit=n, include=["documents", "metadatas"])
            rows = []
            for i, doc_id in enumerate(result["ids"]):
                row: Dict[str, Any] = {"id": doc_id}
                if result.get("documents"):
                    row["document"] = result["documents"][i] or ""
                if result.get("metadatas") and result["metadatas"][i]:
                    row["metadata"] = json.dumps(result["metadatas"][i])
                rows.append(row)
            columns = list(rows[0].keys()) if rows else ["id"]
            return {"rows": rows, "columns": columns, "row_count": len(rows), "truncated": False}

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

    def delete_chunk(self, collection: str, chunk_id: str) -> None:
        col = self._client.get_collection(collection)
        col.delete(ids=[chunk_id])

    def update_chunk(self, collection: str, chunk_id: str, properties: Dict) -> None:
        col = self._client.get_collection(collection)
        doc = properties.pop("document", None)
        meta = {k: v for k, v in properties.items() if k != "id"} or None
        if doc is not None:
            col.update(ids=[chunk_id], documents=[doc], metadatas=[meta] if meta else None)
        elif meta:
            col.update(ids=[chunk_id], metadatas=[meta])

    def create_chunk(self, collection: str, properties: Dict) -> str:
        import uuid as _uuid
        col = self._client.get_collection(collection)
        chunk_id = str(_uuid.uuid4())
        doc = properties.pop("document", "")
        meta = {k: v for k, v in properties.items() if k != "id"} or None
        col.add(ids=[chunk_id], documents=[doc], metadatas=[meta] if meta else None)
        return chunk_id

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

    def list_objects(self, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
        schema_data = self._client.schema.get()
        return [{"name": c["class"], "type": "collection"} for c in schema_data.get("classes", [])]

    def execute_query(self, query: str, params: Optional[Dict] = None, limit: int = 1000) -> Dict[str, Any]:
        # Handle JSON scroll/search format
        try:
            q = json.loads(query)
            collection = q.get("collection")
            if collection and q.get("scroll"):
                return self._scroll_objects(collection, min(q.get("limit", 200), limit))
        except (json.JSONDecodeError, TypeError):
            pass

        # Raw GraphQL fallback
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

    def _scroll_objects(self, collection: str, limit: int = 200) -> Dict[str, Any]:
        try:
            result = self._client.data_object.get(
                class_name=collection,
                limit=limit,
            )
            objects = result.get("objects", [])
            if not objects:
                return {"rows": [], "columns": [], "row_count": 0}
            rows = [{"id": obj.get("id", ""), **obj.get("properties", {})} for obj in objects]
            columns = list(rows[0].keys()) if rows else []
            return {"rows": rows, "columns": columns, "row_count": len(rows)}
        except Exception as e:
            return {"error": str(e), "rows": [], "columns": [], "row_count": 0}

    def get_collection_schema(self, collection: str) -> List[Dict]:
        try:
            schema = self._client.schema.get_class(collection)
            return schema.get("properties", [])
        except Exception:
            return []

    def delete_chunk(self, collection: str, chunk_id: str) -> None:
        self._client.data_object.delete(chunk_id, class_name=collection)

    def update_chunk(self, collection: str, chunk_id: str, properties: Dict) -> None:
        props = {k: v for k, v in properties.items() if k != "id"}
        self._client.data_object.update(props, class_name=collection, uuid=chunk_id)

    def create_chunk(self, collection: str, properties: Dict) -> str:
        props = {k: v for k, v in properties.items() if k != "id"}
        return self._client.data_object.create(props, class_name=collection)

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

    def test_connection_params(
        self,
        db_type: str,
        host: Optional[str] = None,
        port: Optional[int] = None,
        database: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        ssl_mode: Optional[str] = None,
        extra_params: Optional[str] = None,
    ) -> tuple:
        """Test connection with raw params (no saved connection needed).
        Returns (success: bool, error: str, databases: List[str])."""
        # For PostgreSQL with no DB specified, use 'postgres' so list_databases works
        effective_db = database
        if db_type == "postgresql" and not effective_db:
            effective_db = "postgres"

        tmp = DbConnection(
            id="__test_params__",
            name="__test__",
            db_type=db_type,
            host=host,
            port=port,
            database=effective_db,
            username=username,
            password_encrypted=self.encrypt_password(password) if password else None,
            ssl_mode=ssl_mode,
            extra_params=extra_params,
            created_by="__system__",
        )

        adapter = None
        try:
            adapter = self._make_adapter(tmp)
            ok = adapter.test_connection()
            if not ok:
                return False, "Connection test failed. Check your credentials.", []
            dbs = adapter.list_databases()
            return True, "", dbs
        except Exception as e:
            return False, str(e), []
        finally:
            if adapter:
                try:
                    adapter.close()
                except Exception:
                    pass

    def list_databases(self, conn: DbConnection) -> List[str]:
        return self.get_adapter(conn).list_databases()

    def list_schemas(self, conn: DbConnection) -> List[str]:
        adapter = self.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return adapter.list_schemas()
        return []

    def list_objects(self, conn: DbConnection, schema: Optional[str] = None, database: Optional[str] = None) -> List[Dict]:
        return self.get_adapter(conn).list_objects(schema, database)

    def describe_table(self, conn: DbConnection, table: str, schema: Optional[str] = None, database: Optional[str] = None) -> Dict[str, Any]:
        adapter = self.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return adapter.describe_table(table, schema, database)
        return {"error": f"describe_table is not supported for {conn.db_type}"}

    def execute_query(
        self,
        conn: DbConnection,
        query: str,
        params: Optional[Dict] = None,
        limit: int = 1000,
        database: Optional[str] = None,
    ) -> Dict[str, Any]:
        adapter = self.get_adapter(conn)
        if isinstance(adapter, SQLAdapter):
            return adapter.execute_query(query, params, limit, database)
        return adapter.execute_query(query, params, limit)

    def get_vector_schema(self, conn: DbConnection, collection: str) -> List[Dict]:
        adapter = self.get_adapter(conn)
        if isinstance(adapter, WeaviateAdapter):
            return adapter.get_collection_schema(collection)
        if isinstance(adapter, ChromaAdapter):
            return [{"name": "document", "dataType": ["text"]}, {"name": "metadata", "dataType": ["object"]}]
        if isinstance(adapter, QdrantAdapter):
            return [{"name": "payload", "dataType": ["object"]}]
        return []

    def delete_vector_chunk(self, conn: DbConnection, collection: str, chunk_id: str) -> None:
        self.get_adapter(conn).delete_chunk(collection, chunk_id)

    def update_vector_chunk(self, conn: DbConnection, collection: str, chunk_id: str, properties: Dict) -> None:
        self.get_adapter(conn).update_chunk(collection, chunk_id, properties)

    def create_vector_chunk(self, conn: DbConnection, collection: str, properties: Dict) -> str:
        return self.get_adapter(conn).create_chunk(collection, properties)

    def get_version(self, conn: DbConnection) -> Optional[str]:
        try:
            return self.get_adapter(conn).get_version()
        except Exception:
            return None

    def create_database(self, conn: DbConnection, db_name: str) -> None:
        adapter = self.get_adapter(conn)
        if not isinstance(adapter, SQLAdapter):
            raise ValueError(f"create_database is not supported for {conn.db_type}")
        adapter.create_database(db_name)

    def create_db_user(self, conn: DbConnection, username: str, password: str, database: Optional[str] = None) -> None:
        adapter = self.get_adapter(conn)
        if not isinstance(adapter, SQLAdapter):
            raise ValueError(f"create_db_user is not supported for {conn.db_type}")
        adapter.create_db_user(username, password, database)


db_service = DatabaseService()
