"""
stdio <-> HTTP bridge so local MCP clients (Claude Desktop / Cowork) can reach
the MCP server inside the running desktop sidecar.

The desktop app launches the sidecar on a random port with a per-launch token
and writes both to <data-dir>/mcp-endpoint.json. This bridge reads that file
and forwards each JSON-RPC line from stdin as a POST to the sidecar's /mcp
endpoint (stateless, JSON responses), writing replies to stdout. The file is
re-read on every connection failure, since the sidecar restarts on a new port.

Run as: pilotbase-api --mcp-bridge --data-dir <userData>
Nothing but protocol messages may go to stdout — diagnostics go to stderr.
"""
import json
import os
import sys

import httpx

ENDPOINT_FILE = "mcp-endpoint.json"


def _log(msg: str) -> None:
    print(f"[pilotbase-mcp-bridge] {msg}", file=sys.stderr, flush=True)


def _load_endpoint(data_dir: str) -> dict:
    with open(os.path.join(data_dir, ENDPOINT_FILE), encoding="utf-8") as f:
        return json.load(f)


def _error(req_id, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": message}}


def _write(obj) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _forward(client: httpx.Client, data_dir: str, line: str):
    """POST one message; returns the parsed response body, or None for
    notifications (202, empty body). Retries once with a fresh endpoint file."""
    last_err = None
    for _attempt in range(2):
        try:
            ep = _load_endpoint(data_dir)
            resp = client.post(
                ep["url"],
                content=line,
                headers={
                    "X-Pilotbase-Token": ep.get("token", ""),
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": "2025-06-18",
                },
            )
            if resp.status_code == 202 or not resp.content:
                return None
            return resp.json()
        except (OSError, httpx.TransportError, KeyError, ValueError) as e:
            last_err = e
    raise ConnectionError(str(last_err))


def run(data_dir: str) -> None:
    if not data_dir:
        _log("--data-dir is required")
        sys.exit(2)
    _log(f"forwarding to endpoint in {os.path.join(data_dir, ENDPOINT_FILE)}")
    with httpx.Client(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req_id = json.loads(line).get("id")
            except (ValueError, AttributeError):
                req_id = None
            try:
                reply = _forward(client, data_dir, line)
            except ConnectionError as e:
                _log(f"sidecar unreachable: {e}")
                if req_id is not None:
                    _write(_error(req_id, "Pilotbase is not running. Open the Pilotbase desktop app and try again."))
                continue
            if reply is not None:
                _write(reply)
