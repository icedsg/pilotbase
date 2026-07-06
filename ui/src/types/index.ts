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

export interface ChatSessionSummary {
  id: string
  title: string | null
  connection_id: string | null
  created_at: string
  updated_at: string
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

export interface TableStat {
  src_rows: number | null
  tgt_rows: number | null
  src_size: number | null
  tgt_size: number | null
}

export interface ColumnChange {
  added: string[]
  dropped: string[]
  modified: string[]
}

export interface IndexChange {
  added: string[]
  dropped: string[]
  changed: string[]
}

export interface FkChange {
  added: string[]
  dropped: string[]
}

export interface MigrationDiff {
  added_tables: string[]
  dropped_tables: string[]
  column_changes: Record<string, ColumnChange>
  added_views: string[]
  dropped_views: string[]
  added_routines: string[]
  dropped_routines: string[]
  table_stats: Record<string, TableStat>
  index_changes: Record<string, IndexChange>
  fk_changes: Record<string, FkChange>
}

export interface MigrationObjectPick {
  name: string
  on_source: boolean
  on_target: boolean
  src_rows: number | null
  tgt_rows: number | null
  src_size: number | null
  tgt_size: number | null
  has_changes: boolean
}

export type MigrationObjectStatus = 'new_on_source' | 'new_on_target' | 'common_no_change' | 'common_changed'

export interface MigrationPlanObject {
  name: string
  status: MigrationObjectStatus
  columns_added: string[]
  columns_dropped: string[]
  columns_modified: string[]
  indexes_added: string[]
  indexes_dropped: string[]
  indexes_changed: string[]
  fks_added: string[]
  fks_dropped: string[]
  src_rows: number | null
  tgt_rows: number | null
  src_size: number | null
  tgt_size: number | null
  include: boolean
  version_instead_of_overwrite: boolean
  version_name_preview: string | null
}

export interface MigrationJobStep {
  key: string
  object_name: string
  action: 'create' | 'columns' | 'copy' | 'version'
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress_done: number
  progress_total: number | null
  error?: string | null
}

export interface MigrationJobState {
  jobId: string
  steps: MigrationJobStep[]
  status: 'running' | 'done' | 'error'
  error?: string | null
  summary?: { objects_migrated: number; rows_copied: number; errors: { object: string; message: string }[] } | null
}

export interface PapiConfig {
  connection_id: string
  database: string
  enabled: boolean
  enabled_at: string | null
}

export type WsMessageType =
  | 'agent_token'
  | 'agent_done'
  | 'agent_query_applied'
  | 'agent_vector_view'
  | 'plan_proposed'
  | 'plan_committed'
  | 'plan_rejected'
  | 'query_result'
  | 'query_executed'
  | 'migration_progress'
  | 'migration_step_done'
  | 'migration_done'
  | 'migration_error'
  | 'error'
  | 'ping'
  | 'pong'

export interface WsMessage {
  type: WsMessageType
  payload?: Record<string, unknown>
}
