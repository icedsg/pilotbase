"""Qdrant vector search goes through query_points; QdrantClient.search is gone from current clients."""
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.db_service import QdrantAdapter  # noqa: E402


class FakeClient:
    def query_points(self, collection_name, query, limit, with_payload):
        assert (collection_name, query, limit, with_payload) == ("items", [0.1, 0.2], 2, True)
        return SimpleNamespace(points=[SimpleNamespace(id=7, score=0.5, payload={"name": "Lamp"})])


def test_vector_search_keeps_its_rows():
    adapter = QdrantAdapter.__new__(QdrantAdapter)
    adapter._client = FakeClient()
    result = adapter.execute_query('{"collection": "items", "vector": [0.1, 0.2], "limit": 2}')
    assert result["columns"] == ["id", "score", "payload"]
    assert result["rows"] == [{"id": "7", "score": 0.5, "payload": '{"name": "Lamp"}'}]
    assert result["row_count"] == 1
