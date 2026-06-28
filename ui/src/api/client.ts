import axios from 'axios'
import type {
  DbConnection,
  DbObject,
  QueryResult,
  TableInfo,
  UserSession,
  ChatMessage,
} from '../types'

const BASE = import.meta.env.VITE_API_URL || ''

const http = axios.create({
  baseURL: `${BASE}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
})

// ── Auth ──────────────────────────────────────────────────────────────────────

export const apiGetOrCreateSession = (userId: string, email?: string): Promise<UserSession> =>
  http.post('/auth/session', { user_anon_id: userId, user_email: email }).then(r => r.data)

export const apiCreateInvite = (userId: string, connectionId?: string, roleGrant = 'user') =>
  http.post('/auth/invite', { user_anon_id: userId, connection_id: connectionId, role_grant: roleGrant }).then(r => r.data)

export const apiRedeemInvite = (token: string, userId: string, email?: string) =>
  http.post('/auth/redeem', { token, user_anon_id: userId, user_email: email }).then(r => r.data)

// ── Connections ───────────────────────────────────────────────────────────────

export const apiListConnections = (userId: string): Promise<DbConnection[]> =>
  http.get('/connections/', { params: { user_anon_id: userId } }).then(r => r.data)

export const apiCreateConnection = (userId: string, data: Omit<DbConnection, 'id' | 'created_at'> & { password?: string }) =>
  http.post('/connections/', { user_anon_id: userId, ...data }).then(r => r.data)

export const apiUpdateConnection = (userId: string, connId: string, data: Partial<DbConnection> & { password?: string }) =>
  http.put(`/connections/${connId}`, { user_anon_id: userId, ...data }).then(r => r.data)

export const apiDeleteConnection = (userId: string, connId: string) =>
  http.delete(`/connections/${connId}`, { params: { user_anon_id: userId } }).then(r => r.data)

export const apiTestConnection = (userId: string, connId: string): Promise<{ success: boolean }> =>
  http.post(`/connections/${connId}/test`, { user_anon_id: userId }).then(r => r.data)

export const apiTestConnectionParams = (
  userId: string,
  params: {
    db_type: string
    host?: string
    port?: number
    database?: string
    username?: string
    password?: string
    ssl_mode?: string
    extra_params?: string
  }
): Promise<{ success: boolean; error: string; databases: string[] }> =>
  http.post('/connections/test-params', { user_anon_id: userId, ...params }).then(r => r.data)

export const apiAdminCreateDatabase = (userId: string, connId: string, dbName: string): Promise<{ message: string }> =>
  http.post(`/connections/${connId}/admin/create-database`, { user_anon_id: userId, db_name: dbName }).then(r => r.data)

export const apiAdminCreateUser = (
  userId: string,
  connId: string,
  username: string,
  password: string,
  database?: string
): Promise<{ message: string }> =>
  http.post(`/connections/${connId}/admin/create-user`, { user_anon_id: userId, username, password, database }).then(r => r.data)

export const apiGetDbVersion = (userId: string, connId: string): Promise<{ version: string | null }> =>
  http.get(`/connections/${connId}/version`, { params: { user_anon_id: userId } }).then(r => r.data)

export const apiListDatabases = (userId: string, connId: string): Promise<{ databases: string[] }> =>
  http.get(`/connections/${connId}/databases`, { params: { user_anon_id: userId } }).then(r => r.data)

export const apiListObjects = (userId: string, connId: string, database?: string, schema?: string): Promise<{ objects: DbObject[] }> =>
  http.get(`/connections/${connId}/objects`, { params: { user_anon_id: userId, database, schema } }).then(r => r.data)

export const apiDescribeTable = (userId: string, connId: string, table: string, schema?: string, database?: string): Promise<TableInfo> =>
  http.get(`/connections/${connId}/table/${table}`, { params: { user_anon_id: userId, schema, database } }).then(r => r.data)

// ── Query ─────────────────────────────────────────────────────────────────────

export const apiExecuteQuery = (userId: string, connId: string, query: string, database?: string): Promise<QueryResult> =>
  http.post('/query/execute', { user_anon_id: userId, connection_id: connId, query, database }).then(r => r.data)

export const apiRunDdl = (userId: string, connId: string, action: string, objectName: string, objectType: string, database?: string) =>
  http.post('/query/ddl', { user_anon_id: userId, connection_id: connId, action, object_name: objectName, object_type: objectType, database }).then(r => r.data)

// ── Backup ────────────────────────────────────────────────────────────────────

export const apiRunBackup = (userId: string, connId: string) =>
  http.post('/backup/run', { user_anon_id: userId, connection_id: connId }).then(r => r.data)

export const apiListBackups = (userId: string, connName?: string) =>
  http.get('/backup/list', { params: { user_anon_id: userId, connection_name: connName } }).then(r => r.data)

// ── Migration ─────────────────────────────────────────────────────────────────

export const apiSchemaDiff = (userId: string, sourceId: string, targetId: string) =>
  http.post('/migration/diff', { user_anon_id: userId, source_connection_id: sourceId, target_connection_id: targetId }).then(r => r.data)

export const apiMigrationScript = (userId: string, sourceId: string, targetId: string) =>
  http.post('/migration/script', { user_anon_id: userId, source_connection_id: sourceId, target_connection_id: targetId }).then(r => r.data)

// ── Vector DB chunk management ────────────────────────────────────────────────

export const apiGetVectorSchema = (
  userId: string, connId: string, collection: string,
): Promise<{ properties: { name: string; dataType: string[] }[] }> =>
  http.get('/vector/schema', { params: { user_anon_id: userId, connection_id: connId, collection } }).then(r => r.data)

export const apiDeleteVectorChunk = (
  userId: string, connId: string, collection: string, chunkId: string,
): Promise<{ ok: boolean }> =>
  http.delete('/vector/chunk', { data: { user_anon_id: userId, connection_id: connId, collection, chunk_id: chunkId } }).then(r => r.data)

export const apiUpdateVectorChunk = (
  userId: string, connId: string, collection: string, chunkId: string, properties: Record<string, unknown>,
): Promise<{ ok: boolean }> =>
  http.patch('/vector/chunk', { user_anon_id: userId, connection_id: connId, collection, chunk_id: chunkId, properties }).then(r => r.data)

export const apiUploadVectorChunks = (
  userId: string, connId: string, collection: string, textField: string, files: File[],
): Promise<{ created: number; errors: { file: string; error: string }[] }> => {
  const form = new FormData()
  form.append('user_anon_id', userId)
  form.append('connection_id', connId)
  form.append('collection', collection)
  form.append('text_field', textField)
  files.forEach(f => form.append('files', f))
  return http.post('/vector/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}

// ── AI ────────────────────────────────────────────────────────────────────────

export const apiChat = (userId: string, connId: string, message: string): Promise<{ response: string }> =>
  http.post('/ai/chat', { user_anon_id: userId, connection_id: connId, message }).then(r => r.data)

export const apiChatViaWs = (userId: string, connId: string, message: string) =>
  http.post('/ai/chat/ws', { user_anon_id: userId, connection_id: connId, message }).then(r => r.data)

export const apiChatStreamUrl = (userId: string, connId: string) =>
  `${BASE}/api/v1/ai/chat/stream`
