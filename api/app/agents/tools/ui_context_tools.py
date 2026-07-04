"""Exposes a snapshot of the frontend's OTHER open panels (SQL editor,
column/ALTER view, vector/NoSQL view, migration compare view — everything
except the AI chat panel itself) to the agent. This is a passive snapshot
taken by the frontend at send-time (see ChatRequest.ui_context in
routers/ai.py), not a live query — the agent has no way to reach into the
browser, so it can only see what the last message carried."""
from typing import Any, Dict, Optional

from langchain_core.tools import tool


def _format_ui_context(ui_context: Dict[str, Any]) -> str:
    lines = []
    if ui_context.get("activeDatabase"):
        lines.append(f"Active database: {ui_context['activeDatabase']}")
    if ui_context.get("activeQuery"):
        lines.append(f"SQL editor contents:\n{ui_context['activeQuery']}")
    if ui_context.get("queryResult"):
        qr = ui_context["queryResult"]
        lines.append(
            f"Last query result: {qr.get('row_count')} row(s), "
            f"columns={qr.get('columns')}, truncated={qr.get('truncated')}"
        )
    if ui_context.get("columnViewContext"):
        cv = ui_context["columnViewContext"]
        lines.append(f"ALTER TABLE panel open for table '{cv.get('table')}' in database '{cv.get('db')}'")
    if ui_context.get("vectorViewContext"):
        vv = ui_context["vectorViewContext"]
        lines.append(f"Vector collection view open: '{vv.get('collection')}' in database '{vv.get('db')}'")
    if ui_context.get("nosqlViewContext"):
        nv = ui_context["nosqlViewContext"]
        lines.append(f"NoSQL collection view open: '{nv.get('collection')}' in database '{nv.get('db')}'")
    if ui_context.get("migrationViewContext"):
        mv = ui_context["migrationViewContext"]
        lines.append(
            f"Migration compare view open: '{mv.get('sourceDb')}' -> '{mv.get('targetDb')}'"
        )
    return "\n".join(lines) if lines else "No other panels have relevant state open right now."


def make_ui_context_tools(ui_context: Optional[Dict[str, Any]]):
    @tool
    def get_ui_state() -> str:
        """See what the user currently has open elsewhere in the Pilotbase UI —
        the SQL query editor's contents, the active database, the shape of the
        last query result, or an open ALTER TABLE/vector/NoSQL/migration view.
        Does NOT include the AI chat panel itself. Use this when the user refers
        to 'this query', 'what I'm looking at', or similar without repeating it."""
        if not ui_context:
            return "No other panels have relevant state open right now."
        return _format_ui_context(ui_context)

    return [get_ui_state]
