export type UserRole = 'admin' | 'user'

export interface UserSession {
  userId: string
  email: string | null
  role: UserRole
  isActive: boolean
}

export interface DbConnection {
  id: string
  name: string
  db_type: string
  host: string | null
  port: number | null
  database: string | null
  username: string | null
  ssl_mode: string | null
  created_at: string
  is_default?: boolean
}

export interface DbObject {
  name: string
  type: 'table' | 'view' | 'collection' | 'key'
  count?: number | null
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default?: string
}

export interface TableInfo {
  columns: ColumnInfo[]
  primary_keys: string[]
  foreign_keys: ForeignKeyInfo[]
  indexes: IndexInfo[]
}

export interface ForeignKeyInfo {
  constrained_columns: string[]
  referred_table: string
  referred_columns: string[]
}

export interface IndexInfo {
  name: string
  column_names: string[]
  unique: boolean
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  columns: string[]
  row_count: number
  truncated?: boolean
  affected?: number
  next_offset?: string | null
  error?: string
  /** Set when the edited SQL contained multiple statements; `results` holds one entry per statement. */
  multi?: boolean
  results?: QueryResult[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface QueryHistoryEntry {
  id: string
  connection_id: string
  user_id: string | null
  query_text: string
  source: 'user' | 'agent'
  success: boolean
  error: string | null
  row_count: number | null
  duration_ms: number
  executed_at: string
}

export type WsMessageType =
  | 'agent_token'
  | 'agent_done'
  | 'query_result'
  | 'query_executed'
  | 'error'
  | 'ping'
  | 'pong'

export interface WsMessage {
  type: WsMessageType
  payload?: Record<string, unknown>
}
