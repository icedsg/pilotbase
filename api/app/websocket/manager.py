"""
WebSocket connection manager.

UI connects to /ws/{user_id} and receives JSON messages of the form:
  { "type": "...", "payload": { ... } }

Message types:
  agent_token    — streaming token from AI agent
  agent_done     — agent turn complete
  query_result   — result from an async query
  error          — error notification
  ping / pong    — keepalive
"""
import asyncio
import json
import logging
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("pilotbase.ws")

ws_router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self._connections: Dict[str, list[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(user_id, []).append(ws)
        log.info(f"WS connected: {user_id} (total sockets: {len(self._connections[user_id])})")

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        sockets = self._connections.get(user_id, [])
        if ws in sockets:
            sockets.remove(ws)
        if not sockets:
            self._connections.pop(user_id, None)
        log.info(f"WS disconnected: {user_id}")

    async def send(self, user_id: str, msg_type: str, payload: dict) -> None:
        sockets = self._connections.get(user_id, [])
        message = json.dumps({"type": msg_type, "payload": payload})
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    async def broadcast(self, msg_type: str, payload: dict) -> None:
        for user_id in list(self._connections.keys()):
            await self.send(user_id, msg_type, payload)


manager = ConnectionManager()


@ws_router.websocket("/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(user_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                msg_type = data.get("type", "")

                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))

                # Additional client→server message types handled here as features grow.

            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "payload": {"message": "Invalid JSON"}}))

    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)
