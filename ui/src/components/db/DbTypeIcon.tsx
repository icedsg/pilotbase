import {
  siPostgresql, siMysql, siMariadb, siSqlite, siDuckdb,
  siMongodb, siRedis, siApachecouchdb, siQdrant,
  siSnowflake, siCockroachlabs, siApachecassandra, siMilvus,
} from 'simple-icons'
import { Server } from 'lucide-react'

// Dark-mode-friendly hex colors keyed by db_type
const FILL_COLORS: Record<string, string> = {
  postgresql:  '#60a5fa', // blue-400
  mysql:       '#fb923c', // orange-400
  mariadb:     '#fb923c', // orange-400
  sqlite:      '#4ade80', // green-400
  duckdb:      '#eab308', // yellow-500
  mssql:       '#f87171', // red-400
  oracle:      '#f97316', // orange-500
  db2:         '#3b82f6', // blue-500
  cockroachdb: '#dc2626', // red-600
  snowflake:   '#38bdf8', // sky-400
  mongodb:     '#34d399', // emerald-400
  redis:       '#fb7185', // rose-400
  cassandra:   '#c4b5fd', // violet-300
  couchdb:     '#ef4444', // red-500
  dynamodb:    '#38bdf8', // sky-400 (AWS blue)
  qdrant:      '#a78bfa', // violet-400
  chroma:      '#e879f9', // fuchsia-400
  weaviate:    '#22d3ee', // cyan-400
  pinecone:    '#4ade80', // green-400
  milvus:      '#818cf8', // indigo-400
}

const SI_PATHS: Record<string, string> = {
  postgresql: siPostgresql.path,
  mysql:      siMysql.path,
  mariadb:    siMariadb.path,
  sqlite:     siSqlite.path,
  duckdb:     siDuckdb.path,
  mongodb:    siMongodb.path,
  redis:      siRedis.path,
  couchdb:    siApachecouchdb.path,
  qdrant:     siQdrant.path,
  snowflake:  siSnowflake.path,
  cockroachdb: siCockroachlabs.path,
  cassandra:  siApachecassandra.path,
  milvus:     siMilvus.path,
}

interface Props {
  dbType: string
  size?: number
}

export default function DbTypeIcon({ dbType, size = 18 }: Props) {
  const path = SI_PATHS[dbType]
  const color = FILL_COLORS[dbType] ?? '#9ca3af'

  if (path) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill={color}
        className="flex-shrink-0"
        aria-label={dbType}
      >
        <path d={path} />
      </svg>
    )
  }

  // Fallback for db types not in simple-icons (mssql, weaviate, chroma, oracle, db2, dynamodb, pinecone)
  return <Server size={size} className="flex-shrink-0" style={{ color }} />
}
