# MCP (Model Context Protocol)

Pilotbase exposes its database-management features as MCP tools, so Claude Desktop, Claude Cowork skills, and other MCP clients can explore your databases through Pilotbase. This uses the connections you've already saved in Pilotbase. Pilotbase's own AI assistant is not exposed.

## Desktop app setup

1. Open Pilotbase Desktop. The MCP endpoint only exists while the app is running.
2. **Help → Copy Claude MCP config** copies a snippet like this:
   ```json
   {
     "mcpServers": {
       "pilotbase": {
         "command": "C:\\Program Files\\Pilotbase\\resources\\sidecar\\pilotbase-api.exe",
         "args": ["--mcp-bridge", "--data-dir", "C:\\Users\\you\\AppData\\Roaming\\Pilotbase"]
       }
     }
   }
   ```
3. Merge it into Claude Desktop's `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude Desktop.

### Status indicator

The top-right status panel in the desktop app shows an **MCP** indicator next to **API** and **AI Agent**:

| Indicator | Meaning |
|---|---|
| `MCP: read-only` (green) | Server is running; only read tools are available (default) |
| `MCP: read-write` (green) | Server is running with `MCP_ALLOW_WRITES=true` |
| `MCP: off` (red) | Disabled with `MCP_ENABLED=false` |

Hover the indicator to see how many tools are exposed. The same information is returned by `GET /api/v1/health` under `mcp`. The indicator only appears in the desktop app.

### How it works

The desktop backend runs on a random port with a per-launch token. On each start, the app writes both to `<data-dir>/mcp-endpoint.json`. `pilotbase-api --mcp-bridge` is a small stdio bridge that reads that file and forwards MCP messages to `http://127.0.0.1:<port>/mcp`. If the app is closed, tool calls return "Pilotbase is not running".

## Docker / server

The endpoint is served at `/mcp` (streamable HTTP, stateless). Point any MCP client that supports HTTP transports at `http://<host>:8000/mcp`.

## Tools

Read-only, always available:

| Tool | Purpose |
|---|---|
| `list_connections` | Saved connections and their ids |
| `test_connection`, `get_server_version` | Reachability and version |
| `list_databases`, `list_schemas`, `list_objects`, `describe_table` | Browse structure |
| `query_format` | Query shape for NoSQL and vector databases |
| `run_query` | Run a query (read-only statements unless writes are enabled) |
| `query_history` | Recent queries |
| `export_sql` | Generate a CREATE/INSERT script |
| `schema_diff`, `migration_script`, `migration_objects`, `migration_plan`, `migration_job_status` | Compare schemas and plan migrations |
| `list_backups`, `vector_schema` | Backups and vector collection fields |
| `papi_status`, `papi_list_tables`, `papi_list_rows`, `papi_get_row` | Generated REST API |

With `MCP_ALLOW_WRITES=true`, these are added: `create_connection`, `update_connection`, `delete_connection`, `test_connection_params`, `run_ddl`, `admin_create_database`, `admin_create_user`, `migration_execute`, `run_backup`, `vector_update_chunk`, `vector_delete_chunk`, `papi_enable`/`papi_disable`, `papi_enable_table`/`papi_disable_table`, and `papi_create_row`/`papi_update_row`/`papi_delete_row`. Writes through `run_query` are allowed as well.

For the desktop app, set `MCP_ALLOW_WRITES=true` in the environment before launching Pilotbase.

## Settings

| Variable | Default | Description |
|---|---|---|
| `MCP_ENABLED` | `true` | Serve `/mcp` |
| `MCP_ALLOW_WRITES` | `false` | Register mutating tools |
| `MCP_USER_ANON_ID` | _(empty)_ | Pilotbase user that MCP calls act as (default: the first admin) |
