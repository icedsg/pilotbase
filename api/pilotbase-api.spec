# PyInstaller spec for the desktop sidecar binary (docs/desktop-plan.md §6.1).
# Build with:  pyinstaller pilotbase-api.spec
import platform

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hidden_imports = [
    "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on",
    "aiosqlite", "sqlalchemy.dialects.sqlite", "sqlalchemy.dialects.postgresql",
    "sqlalchemy.dialects.mysql", "sqlalchemy.dialects.mssql", "sqlalchemy.dialects.oracle",
    "duckdb_engine", "sqlalchemy_cockroachdb", "snowflake.sqlalchemy",
    "pymysql", "psycopg2", "pymssql", "oracledb", "pymongo", "redis", "cassandra",
    "boto3", "qdrant_client", "chromadb", "weaviate", "pinecone", "pymilvus",
    "langchain_openai", "langgraph", "alembic", "passlib.handlers.bcrypt",
]
if platform.machine().lower() in ("x86_64", "amd64"):
    hidden_imports.append("ibm_db_sa")

for pkg in ("chromadb", "pymilvus", "snowflake", "langchain_core", "langgraph"):
    hidden_imports += collect_submodules(pkg)

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("alembic", "alembic"),
        ("alembic.ini", "."),
        ("../ui/dist", "static"),
        ("../docs", "docs"),
        ("../README.md", "."),
    ],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pilotbase-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="pilotbase-api",
)
