"""
Default connections loaded automatically on startup.

Connections defined here are created on first run (if not already present)
and cannot be deleted from the UI.

Modify this file to pre-configure connections for your deployment.
Restart the server after making changes.
"""

DEFAULT_CONNECTIONS: list[dict] = [
    {
        "name": "Local PostgreSQL",
        "db_type": "postgresql",
        "host": "localhost",
        "port": 5432,
        "database": "postgres",       # optional — leave blank to see all databases
        "username": "postgres",
        "password": "",
        "ssl_mode": None,
    }
]

# ── Examples ──────────────────────────────────────────────────────────────────
# Uncomment and edit as needed. All fields except name, db_type are optional.
#
# DEFAULT_CONNECTIONS = [
#     {
#         "name": "Local PostgreSQL",
#         "db_type": "postgresql",
#         "host": "localhost",
#         "port": 5432,
#         "database": "mydb",       # optional — leave blank to see all databases
#         "username": "admin",
#         "password": "secret",
#         "ssl_mode": None,
#     },
#     {
#         "name": "Staging MySQL",
#         "db_type": "mysql",
#         "host": "staging-db.internal",
#         "port": 3306,
#         "database": None,
#         "username": "readonly",
#         "password": "readonly_pass",
#     },
#     {
#         "name": "Dev Redis",
#         "db_type": "redis",
#         "host": "localhost",
#         "port": 6379,
#         "database": "0",
#         "password": None,
#     },
# ]
