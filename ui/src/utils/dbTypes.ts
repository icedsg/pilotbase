// JSON-command NoSQL/vector db_types — mirrors the backend's
// NOSQL_READONLY_TYPES (api/app/services/db_service.py). These connections
// take a JSON query envelope (not SQL) and render results as nested
// documents rather than a flat row/column grid.
export const NOSQL_JSON_DB_TYPES = new Set([
  'mongodb',
  'couchdb',
  'dynamodb',
  'qdrant',
  'chroma',
  'weaviate',
  'pinecone',
  'milvus',
])

export function isNoSqlJsonDbType(dbType: string | undefined | null): boolean {
  return !!dbType && NOSQL_JSON_DB_TYPES.has(dbType)
}
