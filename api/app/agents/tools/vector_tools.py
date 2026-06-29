import json

from langchain_core.tools import tool
from app.services.db_service import db_service

_VECTOR_TYPES = {"qdrant", "chroma", "weaviate"}


def make_vector_tools(conn):
    """Return vector DB tools bound to a specific DbConnection. Empty list for non-vector connections."""
    if conn.db_type not in _VECTOR_TYPES:
        return []

    @tool
    def list_vector_collections() -> str:
        """List all vector collections and their document counts."""
        try:
            objects = db_service.list_objects(conn)
            if not objects:
                return "No collections found."
            lines = []
            for o in objects:
                count = f" ({o['count']:,} vectors)" if o.get("count") is not None else ""
                lines.append(f"{o['name']}{count}")
            return "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def browse_vector_collection(collection: str, limit: int = 20, offset: int = 0) -> str:
        """Browse chunks in a vector collection. Returns id and payload for each chunk.
        Use offset to paginate through large collections."""
        try:
            query = json.dumps({"collection": collection, "scroll": True, "limit": limit, "offset": offset})
            result = db_service.execute_query(conn, query)
            if not result.get("rows"):
                return "No chunks found."
            lines = []
            for row in result["rows"]:
                lines.append(f"id={row.get('id')}  payload={row.get('payload', row)}")
            if result.get("next_offset"):
                lines.append(f"\n(next offset: {result['next_offset']})")
            return "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def update_vector_chunk(collection: str, chunk_id: str, properties_json: str) -> str:
        """Update the payload/properties of a vector chunk.
        Pass properties as a JSON object string, e.g. '{\"title\": \"new title\"}'.
        To delete or remove chunks, use the Pilotbase UI — that operation is not available here."""
        try:
            properties = json.loads(properties_json)
        except json.JSONDecodeError as e:
            return f"ERROR: Invalid JSON for properties — {e}"
        try:
            db_service.update_vector_chunk(conn, collection, chunk_id, properties)
            return f"Chunk '{chunk_id}' updated successfully."
        except Exception as e:
            return f"ERROR: {e}"

    return [list_vector_collections, browse_vector_collection, update_vector_chunk]
