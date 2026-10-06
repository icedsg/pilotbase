import { useState, useEffect, useRef } from 'react'
import {
  Table2, ChevronRight, ChevronDown,
  Eye, Loader2, Layers, Box, Key, Trash2, Settings2, Pencil, RefreshCw,
  DatabaseBackup, GitMerge, Webhook, FileCode, KeyRound,
} from 'lucide-react'
import DbTypeIcon from './DbTypeIcon'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiListDatabases, apiListSchemas, apiListObjects, apiDeleteConnection, apiExecuteQuery, apiDescribeTable, apiRunDdl, apiGetDbVersion } from '../../api/client'
import AdminActionsPanel from './AdminActionsPanel'
import ConnectionForm from './ConnectionForm'
import { LogoIcon } from '../common/Logo'
import TableContextMenu, { type ContextMenuTarget } from './TableContextMenu'
import ConfirmDialog from '../common/ConfirmDialog'
import BackupModal from '../backup/BackupModal'
import MigrationTargetPicker from '../migration/MigrationTargetPicker'
import ApiConfigModal from '../papi/ApiConfigModal'
import ExportSqlModal from './ExportSqlModal'
import DbCredentialsDialog, { DB_LOGIN_TYPES } from './DbCredentialsDialog'
import type { DbConnection, DbObject, QueryResult } from '../../types'
import { isDesktop } from '../../lib/desktop'

interface SchemaNode {
  schema: string
  objects?: DbObject[]
  loading?: boolean
  open?: boolean
  error?: string
}

interface TreeNode {
  database?: string
  objects?: DbObject[]
  loading?: boolean
  open?: boolean
  error?: string
  // Only populated for SCHEMA_CAPABLE_TYPES connections — schemas within this database.
  schemas?: Record<string, SchemaNode>
  schemasLoading?: boolean
  schemasError?: string
}

function extractErrorMessage(err: any): string {
  return err?.response?.data?.detail || err?.message || 'Failed to connect.'
}

type ConnectionState = Record<string, Record<string, TreeNode>>

const VECTOR_DB_TYPES    = new Set(['qdrant', 'chroma', 'weaviate', 'pinecone', 'milvus'])
const ADMIN_CAPABLE_TYPES = new Set(['postgresql', 'mysql', 'mariadb', 'mssql', 'cockroachdb', 'snowflake', 'oracle'])
const NOSQL_DOC_TYPES    = new Set(['mongodb', 'dynamodb'])
// Generated API (papi): server engines only. Hidden in the desktop app, whose
// sidecar only listens on 127.0.0.1 behind a per-launch token, so outside apps
// can't call it (see papi_service._ensure_available).
const PAPI_DB_TYPES      = new Set(['postgresql', 'mysql', 'mariadb', 'mssql', 'mongodb'])
// Engines where "schema" is a distinct namespace within a database, worth its
// own tree level. mysql/mariadb treat schema as a synonym for database (already
// modeled one level up) and sqlite/duckdb are effectively single-schema.
const SCHEMA_CAPABLE_TYPES = new Set(['postgresql', 'cockroachdb', 'mssql', 'oracle', 'db2', 'snowflake'])
const DEFAULT_SCHEMA = 'public'

const DB_TYPE_COLORS: Record<string, string> = {
  postgresql:  'text-blue-400',
  mysql:       'text-orange-400',
  mariadb:     'text-orange-400',
  sqlite:      'text-green-400',
  mssql:       'text-red-400',
  oracle:      'text-orange-500',
  db2:         'text-blue-500',
  cockroachdb: 'text-red-600',
  snowflake:   'text-sky-400',
  mongodb:     'text-emerald-400',
  redis:       'text-rose-400',
  cassandra:   'text-violet-300',
  dynamodb:    'text-sky-400',
  qdrant:      'text-violet-400',
  chroma:      'text-fuchsia-400',
  weaviate:    'text-cyan-400',
  pinecone:    'text-green-400',
  milvus:      'text-indigo-400',
}

const DB_TYPE_BADGE: Record<string, string> = {
  postgresql:  'PG',
  mysql:       'MY',
  mariadb:     'MB',
  sqlite:      'SL',
  mssql:       'MS',
  oracle:      'OR',
  db2:         'DB',
  cockroachdb: 'CR',
  snowflake:   'SF',
  mongodb:     'MG',
  redis:       'RD',
  cassandra:   'CS',
  dynamodb:    'DY',
  qdrant:      'QD',
  chroma:      'CH',
  weaviate:    'WV',
  pinecone:    'PC',
  milvus:      'MV',
}

interface Props {
  refreshKey?: number
}

interface DbCtxMenu {
  connId: string
  db: string
  x: number
  y: number
}

export default function ConnectionTree({ refreshKey }: Props) {
  const {
    connections, activeConnectionId, setActiveConnection, removeConnection, updateConnection,
    ensureQueryTab, focusConnectionQueryTab, updateQueryTab, setActiveMainTab,
    openVectorTab, openNoSQLTab, appendAlterScript,
  } = useStore()
  const { userId } = useUserSession()
  const [state,      setState]      = useState<ConnectionState>({})
  const [connErrors, setConnErrors] = useState<Record<string, string>>({})
  const [openConns,  setOpenConns]  = useState<Set<string>>(new Set())
  const [versions,   setVersions]   = useState<Record<string, string>>({})
  const fetchedVersions             = useRef<Set<string>>(new Set())
  const [adminConn,      setAdminConn]      = useState<DbConnection | null>(null)
  const [editConn,       setEditConn]       = useState<DbConnection | null>(null)
  const [deleting,       setDeleting]       = useState<string | null>(null)
  const [ctxMenu,        setCtxMenu]        = useState<ContextMenuTarget | null>(null)
  const [confirmAction,  setConfirmAction]  = useState<
    | { type: 'truncate' | 'drop'; target: ContextMenuTarget }
    | { type: 'drop_database'; connId: string; db: string }
    | null
  >(null)
  const [dbCtxMenu,      setDbCtxMenu]      = useState<DbCtxMenu | null>(null)
  const dbCtxRef                            = useRef<HTMLDivElement>(null)
  const [backupTarget,     setBackupTarget]     = useState<DbCtxMenu | null>(null)
  const [migrationSource,  setMigrationSource]  = useState<DbCtxMenu | null>(null)
  const [apiConfigTarget,  setApiConfigTarget]  = useState<DbCtxMenu | null>(null)
  const [exportSqlTarget,  setExportSqlTarget]  = useState<{ connId: string; db: string; table?: string } | null>(null)
  const [loginTarget,      setLoginTarget]      = useState<{ connId: string; db: string; reason?: string } | null>(null)

  // Shown under a database's error: lets the user retry with a different
  // user/password for just this database on the same server.
  const loginLink = (conn: DbConnection, db: string, reason: string) =>
    DB_LOGIN_TYPES.has(conn.db_type) && (
      <button
        onClick={(e) => { e.stopPropagation(); setLoginTarget({ connId: conn.id, db, reason }) }}
        className="block mt-1 text-accent hover:underline"
      >
        Try a different user/password for this database
      </button>
    )

  useEffect(() => {
    if (!userId) return
    connections.forEach(conn => {
      if (!fetchedVersions.current.has(conn.id)) {
        fetchedVersions.current.add(conn.id)
        apiGetDbVersion(userId, conn.id)
          .then(({ version }) => { if (version) setVersions(v => ({ ...v, [conn.id]: version })) })
          .catch(() => {})
      }
    })
  }, [connections, userId])

  useEffect(() => {
    if (refreshKey === undefined || refreshKey === 0) return
    setState({})
    setOpenConns(new Set())
    fetchedVersions.current = new Set()
    setVersions({})
  }, [refreshKey])

  useEffect(() => {
    if (!dbCtxMenu) return
    const handler = (e: MouseEvent) => {
      if (dbCtxRef.current && !dbCtxRef.current.contains(e.target as Node)) setDbCtxMenu(null)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDbCtxMenu(null) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [dbCtxMenu])

  const refreshDb = async (connId: string, db: string) => {
    const node = state[connId]?.[db]
    if (!node) return
    const conn = connections.find(c => c.id === connId)
    if (conn && SCHEMA_CAPABLE_TYPES.has(conn.db_type)) {
      await loadSchemas(connId, db, node)
      return
    }
    setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: true, open: true, error: undefined } } }))
    try {
      const { objects } = await apiListObjects(userId, connId, db)
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: false, objects, open: true, error: undefined } } }))
    } catch (err) {
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: false, open: true, error: extractErrorMessage(err) } } }))
    }
  }

  // Fetch the schema list for a database and default-expand `public` (or the
  // first schema, if there's no `public`) so the tree isn't empty on open.
  const loadSchemas = async (connId: string, db: string, node: TreeNode) => {
    setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, open: true, schemasLoading: true, schemasError: undefined } } }))
    try {
      const { schemas } = await apiListSchemas(userId, connId, db)
      const schemaMap: Record<string, SchemaNode> = {}
      schemas.forEach(sc => { schemaMap[sc] = { schema: sc, objects: undefined, open: false } })
      const defaultSchema = schemas.includes(DEFAULT_SCHEMA) ? DEFAULT_SCHEMA : schemas[0]
      setState(s => {
        const dbNode = s[connId]?.[db]
        if (!dbNode) return s
        return { ...s, [connId]: { ...s[connId], [db]: { ...dbNode, open: true, schemasLoading: false, schemas: schemaMap, schemasError: undefined } } }
      })
      if (defaultSchema) await toggleSchema(connId, db, defaultSchema, true)
    } catch (err) {
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, open: true, schemasLoading: false, schemasError: extractErrorMessage(err) } } }))
    }
  }

  const toggleSchema = async (connId: string, db: string, schema: string, forceOpen = false) => {
    const dbNode = state[connId]?.[db]
    const schemaNode = dbNode?.schemas?.[schema]
    if (!dbNode || !schemaNode) return

    if (schemaNode.open && !forceOpen) {
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...dbNode, schemas: { ...dbNode.schemas, [schema]: { ...schemaNode, open: false } } } } }))
      return
    }

    setState(s => {
      const curDb = s[connId]?.[db]
      if (!curDb) return s
      const curSchema = curDb.schemas?.[schema] || schemaNode
      return { ...s, [connId]: { ...s[connId], [db]: { ...curDb, schemas: { ...curDb.schemas, [schema]: { ...curSchema, open: true, loading: true, error: undefined } } } } }
    })

    try {
      const { objects } = await apiListObjects(userId, connId, db, schema)
      setState(s => {
        const curDb = s[connId]?.[db]
        if (!curDb) return s
        const curSchema = curDb.schemas?.[schema] || schemaNode
        return { ...s, [connId]: { ...s[connId], [db]: { ...curDb, schemas: { ...curDb.schemas, [schema]: { ...curSchema, open: true, loading: false, objects, error: undefined } } } } }
      })
    } catch (err) {
      setState(s => {
        const curDb = s[connId]?.[db]
        if (!curDb) return s
        const curSchema = curDb.schemas?.[schema] || schemaNode
        return { ...s, [connId]: { ...s[connId], [db]: { ...curDb, schemas: { ...curDb.schemas, [schema]: { ...curSchema, open: true, loading: false, objects: [], error: extractErrorMessage(err) } } } } }
      })
    }
  }

  const refreshConnDbs = async (connId: string) => {
    setState(s => ({ ...s, [connId]: { __loading: { loading: true } } }))
    setConnErrors(e => ({ ...e, [connId]: '' }))
    try {
      const { databases } = await apiListDatabases(userId, connId)
      const dbMap: Record<string, TreeNode> = {}
      databases.forEach(db => { dbMap[db] = { database: db, objects: undefined, open: false } })
      setState(s => ({ ...s, [connId]: dbMap }))
    } catch (err) {
      setState(s => ({ ...s, [connId]: {} }))
      setConnErrors(e => ({ ...e, [connId]: extractErrorMessage(err) }))
    }
  }

  const toggleConn = (conn: DbConnection) => {
    setActiveConnection(conn.id)
    focusConnectionQueryTab(conn.id)
    const isOpen = openConns.has(conn.id)
    if (isOpen) {
      setOpenConns((s) => { const n = new Set(s); n.delete(conn.id); return n })
      return
    }
    setOpenConns((s) => new Set(s).add(conn.id))

    if (!state[conn.id]) {
      setState((s) => ({ ...s, [conn.id]: { __loading: { loading: true } } }))
      setConnErrors(e => ({ ...e, [conn.id]: '' }))
      apiListDatabases(userId, conn.id).then(({ databases }) => {
        const dbMap: Record<string, TreeNode> = {}
        databases.forEach((db) => { dbMap[db] = { database: db, objects: undefined, open: false } })
        setState((s) => ({ ...s, [conn.id]: dbMap }))
      }).catch((err) => {
        setState((s) => ({ ...s, [conn.id]: {} }))
        setConnErrors(e => ({ ...e, [conn.id]: extractErrorMessage(err) }))
      })
    }
  }

  const toggleDb = async (conn: DbConnection, db: string) => {
    const node = state[conn.id]?.[db]
    if (!node) return

    setActiveConnection(conn.id)
    updateQueryTab(ensureQueryTab(conn.id), { database: db })

    if (node.open) {
      setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: false } } }))
      return
    }

    if (SCHEMA_CAPABLE_TYPES.has(conn.db_type)) {
      await loadSchemas(conn.id, db, node)
      return
    }

    setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: true, loading: true, error: undefined } } }))

    try {
      const { objects } = await apiListObjects(userId, conn.id, db)
      setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: true, loading: false, objects, error: undefined } } }))
    } catch (err) {
      setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: true, loading: false, objects: [], error: extractErrorMessage(err) } } }))
    }
  }

  const handleDelete = async (conn: DbConnection, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Remove connection "${conn.name}"? This cannot be undone.`)) return
    setDeleting(conn.id)
    try {
      await apiDeleteConnection(userId, conn.id)
      removeConnection(conn.id)
      setState((s) => { const n = { ...s }; delete n[conn.id]; return n })
      setOpenConns((s) => { const n = new Set(s); n.delete(conn.id); return n })
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to delete connection.')
    } finally {
      setDeleting(null)
    }
  }

  const handleViewRows = async (target: ContextMenuTarget, mode: 'all' | 'latest50' = 'all') => {
    const conn = connections.find(c => c.id === target.connId)
    if (!conn) return

    setActiveConnection(target.connId)

    // Vector DB → dedicated chunks view
    if (VECTOR_DB_TYPES.has(conn.db_type)) {
      const obj = Object.values(state[target.connId]?.[target.db] ?? {}).flatMap(n => (n as any).objects ?? []).find((o: any) => o.name === target.name)
      openVectorTab({ collection: target.name, connId: target.connId, db: target.db, dbType: conn.db_type, totalCount: obj?.count })
      return
    }

    // MongoDB / DynamoDB → dedicated document view
    if (NOSQL_DOC_TYPES.has(conn.db_type)) {
      openNoSQLTab({ collection: target.name, connId: target.connId, db: target.db, dbType: conn.db_type })
      return
    }

    const limit = mode === 'latest50' ? 50 : 500
    const isOrderable = mode === 'latest50' && (target.type === 'table' || target.type === 'view') && conn.db_type !== 'redis' && conn.db_type !== 'cassandra'
    let pkCols: string[] = []
    if (isOrderable) {
      try {
        const info = await apiDescribeTable(userId, target.connId, target.name, target.schema, target.db)
        pkCols = info.primary_keys ?? []
      } catch {}
    }

    // Non-default schemas need explicit "schema"."table" qualification —
    // Postgres/CockroachDB otherwise resolve unqualified names against
    // search_path (public), which silently queries the wrong table.
    const hasSchema = !!target.schema && target.schema !== DEFAULT_SCHEMA

    // SQL / Redis / Cassandra → query result table
    let sql: string
    let queryDb: string | undefined
    if (conn.db_type === 'mysql' || conn.db_type === 'mariadb') {
      const orderBy = pkCols.length ? ` ORDER BY ${pkCols.map(c => `\`${c}\` DESC`).join(', ')}` : ''
      sql = `SELECT * FROM \`${target.db}\`.\`${target.name}\`${orderBy} LIMIT ${limit}`
    } else if (conn.db_type === 'redis') {
      sql = `GET ${target.name}`
    } else if (conn.db_type === 'mssql') {
      const orderBy = pkCols.length ? ` ORDER BY ${pkCols.map(c => `[${c}] DESC`).join(', ')}` : ''
      const qualified = hasSchema ? `[${target.schema}].[${target.name}]` : `[${target.name}]`
      sql = `SELECT TOP ${limit} * FROM ${qualified}${orderBy}`
      queryDb = target.db
    } else if (conn.db_type === 'cassandra') {
      sql = `SELECT * FROM ${target.db}.${target.name} LIMIT ${limit}`
    } else {
      const orderBy = pkCols.length ? ` ORDER BY ${pkCols.map(c => `"${c}" DESC`).join(', ')}` : ''
      const qualified = hasSchema ? `"${target.schema}"."${target.name}"` : `"${target.name}"`
      sql = `SELECT * FROM ${qualified}${orderBy} LIMIT ${limit}`
      queryDb = target.db
    }

    const tabId = ensureQueryTab(target.connId)
    updateQueryTab(tabId, { database: queryDb || null, query: sql, loading: true, result: null, columnViewContext: null })
    setActiveMainTab(tabId)
    try {
      const result = await apiExecuteQuery(userId, target.connId, sql, queryDb)
      updateQueryTab(tabId, { result, loading: false })
    } catch (err: any) {
      updateQueryTab(tabId, {
        result: { rows: [], columns: [], row_count: 0, error: err?.response?.data?.detail || 'Query failed' } as any,
        loading: false,
      })
    }
  }

  const handleViewColumns = async (target: ContextMenuTarget) => {
    const conn = connections.find(c => c.id === target.connId)
    if (!conn) return

    setActiveConnection(target.connId)
    const tabId = ensureQueryTab(target.connId)
    updateQueryTab(tabId, {
      loading: true, result: null,
      columnViewContext: { table: target.name, connId: target.connId, db: target.db || null, dbType: conn.db_type },
    })
    setActiveMainTab(tabId)
    try {
      const info = await apiDescribeTable(userId, target.connId, target.name, target.schema, target.db)
      const result: QueryResult = {
        columns: ['column', 'type', 'nullable', 'default', 'pk'],
        rows: info.columns.map(col => ({
          column: col.name,
          type: col.type,
          nullable: col.nullable ? 'YES' : 'NO',
          default: col.default || '',
          pk: info.primary_keys.includes(col.name) ? '✓' : '',
        })),
        row_count: info.columns.length,
      }
      updateQueryTab(tabId, { result, loading: false })
    } catch {
      updateQueryTab(tabId, { loading: false })
    }
  }

  const handleExportSql = (target: ContextMenuTarget) => {
    // Export currently only supports the connection's default/public schema.
    setExportSqlTarget({ connId: target.connId, db: target.db, table: target.name })
  }

  const handleTruncate = (target: ContextMenuTarget) => {
    setConfirmAction({ type: 'truncate', target })
  }

  const handleDrop = (target: ContextMenuTarget) => {
    setConfirmAction({ type: 'drop', target })
  }

  const executeConfirmedAction = async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)

    if (action.type === 'drop_database') {
      try {
        await apiRunDdl(userId, action.connId, 'drop_database', action.db, 'database')
        appendAlterScript(`DROP DATABASE ${action.db};`, true)
        await refreshConnDbs(action.connId)
      } catch (err: any) {
        alert(err?.response?.data?.detail || 'Drop database failed.')
      }
      return
    }

    const { type, target } = action
    if (type === 'truncate') {
      try {
        await apiRunDdl(userId, target.connId, 'truncate', target.name, 'table', target.db, target.schema)
        appendAlterScript(`TRUNCATE TABLE ${target.name};`, true)
      } catch (err: any) {
        alert(err?.response?.data?.detail || 'Truncate failed.')
      }
    } else {
      const isView = target.type === 'view'
      const ddlAction = isView ? 'drop_view' : 'drop_table'
      const objType = isView ? 'view' : 'table'
      try {
        await apiRunDdl(userId, target.connId, ddlAction, target.name, objType, target.db, target.schema)
        appendAlterScript(isView ? `DROP VIEW ${target.name};` : `DROP TABLE ${target.name};`, true)
        await refreshObjectList(target.connId, target.db, target.schema)
      } catch (err: any) {
        alert(err?.response?.data?.detail || 'Drop failed.')
      }
    }
  }

  // Re-list objects after a drop, targeting the schema node when the
  // connection has one, or the database node's flat object list otherwise.
  const refreshObjectList = async (connId: string, db: string, schema?: string) => {
    if (schema) {
      const dbNode = state[connId]?.[db]
      const schemaNode = dbNode?.schemas?.[schema]
      if (!dbNode || !schemaNode) return
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...dbNode, schemas: { ...dbNode.schemas, [schema]: { ...schemaNode, loading: true } } } } }))
      try {
        const { objects } = await apiListObjects(userId, connId, db, schema)
        setState(s => {
          const curDb = s[connId]?.[db]
          if (!curDb) return s
          const curSchema = curDb.schemas?.[schema] || schemaNode
          return { ...s, [connId]: { ...s[connId], [db]: { ...curDb, schemas: { ...curDb.schemas, [schema]: { ...curSchema, loading: false, objects } } } } }
        })
      } catch {
        setState(s => {
          const curDb = s[connId]?.[db]
          if (!curDb) return s
          const curSchema = curDb.schemas?.[schema] || schemaNode
          return { ...s, [connId]: { ...s[connId], [db]: { ...curDb, schemas: { ...curDb.schemas, [schema]: { ...curSchema, loading: false } } } } }
        })
      }
      return
    }
    const node = state[connId]?.[db]
    if (!node) return
    setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: true } } }))
    try {
      const { objects } = await apiListObjects(userId, connId, db)
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: false, objects } } }))
    } catch {
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: false } } }))
    }
  }

  // Renders the Tables/Views/Collections/Keys groups shared by both the
  // flat database-level object list and the per-schema object list.
  const renderObjects = (conn: DbConnection, db: string, schema: string | undefined, objects: DbObject[], indent: number) => (
    <>
      {(['table', 'view', 'collection', 'key'] as const).map((type) => {
        const items = objects.filter((o) => o.type === type).sort((a, b) => a.name.localeCompare(b.name))
        if (!items.length) return null
        const Icon  = type === 'table' ? Table2 : type === 'view' ? Eye : type === 'collection' ? Box : Key
        const label = type === 'table' ? 'Tables' : type === 'view' ? 'Views' : type === 'collection' ? 'Collections' : 'Keys'
        return (
          <div key={type}>
            <div className="tree-item text-gray-600" style={{ paddingLeft: `${indent}px` }}>
              <Layers size={13} />
              <span className="uppercase text-[13px] tracking-wider">{label}</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">({items.length})</span>
            </div>
            {items.map((obj) => {
              const isVectorCollection = VECTOR_DB_TYPES.has(conn.db_type) && obj.type === 'collection'
              return (
                <div
                  key={obj.name}
                  className={`tree-item ${ctxMenu?.connId === conn.id && ctxMenu?.db === db && ctxMenu?.schema === schema && ctxMenu?.name === obj.name ? 'tree-item-ctx-active' : ''}`}
                  style={{ paddingLeft: `${indent + 12}px` }}
                  onClick={() => {
                    setActiveConnection(conn.id)
                    if (isVectorCollection) {
                      openVectorTab({ collection: obj.name, connId: conn.id, db, dbType: conn.db_type, totalCount: obj.count })
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!isVectorCollection) {
                      setCtxMenu({ connId: conn.id, connType: conn.db_type, db, schema, name: obj.name, type: obj.type, x: e.clientX, y: e.clientY })
                    }
                  }}
                >
                  <Icon size={16} className="flex-shrink-0 text-gray-400" />
                  <span className="truncate font-mono text-[16px] font-medium flex-1 min-w-0">{obj.name}</span>
                  {isVectorCollection && obj.count != null && (
                    <span className="text-[10px] text-gray-600 flex-shrink-0 tabular-nums ml-1">{obj.count.toLocaleString()}</span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      {objects.length === 0 && (
        <div className="tree-item text-gray-600" style={{ paddingLeft: `${indent}px` }}>No objects found</div>
      )}
    </>
  )

  if (connections.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-600 text-center">
        No connections yet.<br />Click + to add one.
      </div>
    )
  }

  return (
    <>
      <div className="py-1">
        {connections.map((conn) => {
          const isOpen   = openConns.has(conn.id)
          const isActive = activeConnectionId === conn.id
          const colorClass = DB_TYPE_COLORS[conn.db_type] || 'text-gray-400'
          const dbNodes  = state[conn.id] || {}
          const loading  = '__loading' in dbNodes
          const isDeleting = deleting === conn.id

          return (
            <div key={conn.id}>
              {/* Connection row */}
              <div
                onClick={() => toggleConn(conn)}
                className={`tree-item group ${isActive ? 'tree-item-active' : ''}`}
                style={{ paddingLeft: '8px' }}
              >
                {isOpen ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
                <DbTypeIcon dbType={conn.db_type} size={18} />
                <span className="truncate flex-1">
                  {conn.name}
                  {versions[conn.id] && (
                    <span className="text-[13px] text-gray-500 ml-1">[{versions[conn.id]}]</span>
                  )}
                </span>

                {/* DB type badge — hidden on hover to show action buttons */}
                <span className={`text-[12px] font-bold font-mono flex-shrink-0 group-hover:hidden ${colorClass} opacity-70`}>
                  {DB_TYPE_BADGE[conn.db_type] ?? conn.db_type.slice(0, 2).toUpperCase()}
                </span>

                {/* Action buttons — shown on hover */}
                <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                  {openConns.has(conn.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); refreshConnDbs(conn.id) }}
                      className="btn-ghost p-0.5"
                      title="Refresh databases"
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                  {ADMIN_CAPABLE_TYPES.has(conn.db_type) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAdminConn(conn) }}
                      className="btn-ghost p-0.5"
                      title="Admin: create database / user"
                    >
                      <Settings2 size={14} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditConn(conn) }}
                    className="btn-ghost p-0.5"
                    title="Edit connection"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(conn, e)}
                    disabled={isDeleting}
                    className="btn-ghost p-0.5 hover:text-red-400"
                    title="Delete connection"
                  >
                    {isDeleting
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Trash2 size={14} />
                    }
                  </button>
                </div>
              </div>

              {/* Databases */}
              {isOpen && (
                <div>
                  {loading ? (
                    <div className="tree-item pl-8 text-gray-600">
                      <Loader2 size={14} className="animate-spin" />
                      <span>Loading…</span>
                    </div>
                  ) : connErrors[conn.id] ? (
                    <div className="pl-8 pr-2 py-1.5 text-[13px] text-red-400 break-words flex items-start gap-1.5">
                      <span className="flex-1">{connErrors[conn.id]}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); refreshConnDbs(conn.id) }}
                        className="btn-ghost p-0.5 flex-shrink-0"
                        title="Retry"
                      >
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  ) : (
                    Object.entries(dbNodes).map(([db, node]) => (
                      <div key={db}>
                        {/* Database row */}
                        <div
                          onClick={() => toggleDb(conn, db)}
                          onContextMenu={(e) => { e.preventDefault(); setDbCtxMenu({ connId: conn.id, db, x: e.clientX, y: e.clientY }) }}
                          className={`tree-item group/db ${dbCtxMenu?.connId === conn.id && dbCtxMenu?.db === db ? 'tree-item-ctx-active' : ''}`}
                          style={{ paddingLeft: '20px' }}
                        >
                          {node.open ? <ChevronDown size={14} className="flex-shrink-0" /> : <ChevronRight size={14} className="flex-shrink-0" />}
                          {VECTOR_DB_TYPES.has(conn.db_type)
                            ? <Box size={16} className="flex-shrink-0 text-yellow-500" />
                            : <LogoIcon size={16} className="flex-shrink-0" />
                          }
                          <span className="truncate flex-1">{db}</span>
                          {(() => {
                            const login = conn.db_credentials?.find(c => c.database === db)
                            return login && (
                              <span title={`Uses login "${login.username}"`} className="flex-shrink-0 text-gray-500">
                                <KeyRound size={12} />
                              </span>
                            )
                          })()}
                          <button
                            onClick={(e) => { e.stopPropagation(); refreshDb(conn.id, db) }}
                            className="hidden group-hover/db:flex btn-ghost p-0.5 flex-shrink-0"
                            title="Refresh database"
                          >
                            <RefreshCw size={13} />
                          </button>
                        </div>

                        {/* Schemas (multi-schema engines) or Tables & Views directly (everyone else) */}
                        {node.open && (
                          <div>
                            {SCHEMA_CAPABLE_TYPES.has(conn.db_type) ? (
                              node.schemasLoading ? (
                                <div className="tree-item pl-12 text-gray-600">
                                  <Loader2 size={13} className="animate-spin" />
                                  <span>Loading…</span>
                                </div>
                              ) : node.schemasError ? (
                                <div className="pl-12 pr-2 py-1.5 text-[13px] text-red-400 break-words flex items-start gap-1.5">
                                  <span className="flex-1">{node.schemasError}{loginLink(conn, db, node.schemasError)}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); refreshDb(conn.id, db) }}
                                    className="btn-ghost p-0.5 flex-shrink-0"
                                    title="Retry"
                                  >
                                    <RefreshCw size={13} />
                                  </button>
                                </div>
                              ) : (
                                Object.entries(node.schemas || {}).sort(([a], [b]) => a.localeCompare(b)).map(([schema, schemaNode]) => (
                                  <div key={schema}>
                                    <div
                                      onClick={() => toggleSchema(conn.id, db, schema)}
                                      className="tree-item"
                                      style={{ paddingLeft: '32px' }}
                                    >
                                      {schemaNode.open ? <ChevronDown size={13} className="flex-shrink-0" /> : <ChevronRight size={13} className="flex-shrink-0" />}
                                      <Layers size={14} className="flex-shrink-0 text-gray-500" />
                                      <span className="truncate flex-1 text-[15px]">
                                        {schema}
                                        {schema === DEFAULT_SCHEMA && <span className="text-[11px] text-gray-500 ml-1">(default)</span>}
                                      </span>
                                    </div>
                                    {schemaNode.open && (
                                      <div>
                                        {schemaNode.loading ? (
                                          <div className="tree-item pl-16 text-gray-600">
                                            <Loader2 size={13} className="animate-spin" />
                                            <span>Loading…</span>
                                          </div>
                                        ) : schemaNode.error ? (
                                          <div className="pl-16 pr-2 py-1.5 text-[13px] text-red-400 break-words flex items-start gap-1.5">
                                            <span className="flex-1">{schemaNode.error}{loginLink(conn, db, schemaNode.error)}</span>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); toggleSchema(conn.id, db, schema, true) }}
                                              className="btn-ghost p-0.5 flex-shrink-0"
                                              title="Retry"
                                            >
                                              <RefreshCw size={13} />
                                            </button>
                                          </div>
                                        ) : (
                                          renderObjects(conn, db, schema, schemaNode.objects || [], 44)
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))
                              )
                            ) : node.loading ? (
                              <div className="tree-item pl-12 text-gray-600">
                                <Loader2 size={13} className="animate-spin" />
                                <span>Loading…</span>
                              </div>
                            ) : node.error ? (
                              <div className="pl-12 pr-2 py-1.5 text-[13px] text-red-400 break-words flex items-start gap-1.5">
                                <span className="flex-1">{node.error}{loginLink(conn, db, node.error)}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); refreshDb(conn.id, db) }}
                                  className="btn-ghost p-0.5 flex-shrink-0"
                                  title="Retry"
                                >
                                  <RefreshCw size={13} />
                                </button>
                              </div>
                            ) : (
                              renderObjects(conn, db, undefined, node.objects || [], 32)
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {adminConn && (
        <AdminActionsPanel conn={adminConn} onClose={() => setAdminConn(null)} />
      )}

      {editConn && (
        <ConnectionForm
          connection={editConn}
          onClose={() => setEditConn(null)}
          onSaved={(updated) => {
            if (updated) updateConnection(updated)
            setEditConn(null)
          }}
        />
      )}

      {ctxMenu && (
        <TableContextMenu
          target={ctxMenu}
          onViewRows={() => handleViewRows(ctxMenu)}
          onViewLatest50={() => handleViewRows(ctxMenu, 'latest50')}
          onViewColumns={() => handleViewColumns(ctxMenu)}
          onExportSql={() => handleExportSql(ctxMenu)}
          onTruncate={() => handleTruncate(ctxMenu)}
          onDrop={() => handleDrop(ctxMenu)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {dbCtxMenu && (() => {
        const dbCtxConnType = connections.find(c => c.id === dbCtxMenu.connId)?.db_type || ''
        const canEnableApi = !isDesktop && PAPI_DB_TYPES.has(dbCtxConnType)
        const canExportSql = !VECTOR_DB_TYPES.has(dbCtxConnType) && !NOSQL_DOC_TYPES.has(dbCtxConnType) && dbCtxConnType !== 'redis'
        return (
        <div
          ref={dbCtxRef}
          style={{ position: 'fixed', left: Math.min(dbCtxMenu.x + 2, window.innerWidth - 220), top: Math.min(dbCtxMenu.y, window.innerHeight - 120), zIndex: 9999 }}
          className="bg-surface-100 border border-surface-50 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1 min-w-[200px]"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-3 py-1.5 border-b border-surface-50 mb-1">
            <div className="text-[13px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Database</div>
            <div className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate mt-0.5">{dbCtxMenu.db}</div>
          </div>
          <button
            className="ctx-item hover:text-gray-900 dark:hover:text-white"
            onClick={() => { refreshDb(dbCtxMenu.connId, dbCtxMenu.db); setDbCtxMenu(null) }}
          >
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
          {DB_LOGIN_TYPES.has(dbCtxConnType) && (
            <button
              className="ctx-item hover:text-gray-900 dark:hover:text-white"
              onClick={() => { setLoginTarget({ connId: dbCtxMenu.connId, db: dbCtxMenu.db }); setDbCtxMenu(null) }}
            >
              <KeyRound size={15} />
              <span>Database Login…</span>
            </button>
          )}
          <div className="border-t border-surface-50 my-1" />
          <button
            className="ctx-item hover:text-gray-900 dark:hover:text-white"
            onClick={() => { setBackupTarget(dbCtxMenu); setDbCtxMenu(null) }}
          >
            <DatabaseBackup size={15} />
            <span>Run Backup</span>
          </button>
          <button
            className="ctx-item hover:text-gray-900 dark:hover:text-white"
            onClick={() => { setMigrationSource(dbCtxMenu); setDbCtxMenu(null) }}
          >
            <GitMerge size={15} />
            <span>Plan Migration</span>
          </button>
          {canEnableApi && (
            <button
              className="ctx-item hover:text-gray-900 dark:hover:text-white"
              onClick={() => { setApiConfigTarget(dbCtxMenu); setDbCtxMenu(null) }}
            >
              <Webhook size={15} />
              <span>Enable API</span>
            </button>
          )}
          {canExportSql && (
            <button
              className="ctx-item hover:text-gray-900 dark:hover:text-white"
              onClick={() => { setExportSqlTarget({ connId: dbCtxMenu.connId, db: dbCtxMenu.db }); setDbCtxMenu(null) }}
            >
              <FileCode size={15} />
              <span>Export as SQL</span>
            </button>
          )}
          <div className="border-t border-surface-50 my-1" />
          <button
            className="ctx-item hover:text-red-600 dark:hover:text-red-400"
            onClick={() => { setConfirmAction({ type: 'drop_database', connId: dbCtxMenu.connId, db: dbCtxMenu.db }); setDbCtxMenu(null) }}
          >
            <Trash2 size={15} />
            <span>Drop Database</span>
          </button>
        </div>
        )
      })()}

      {backupTarget && (
        <BackupModal connId={backupTarget.connId} database={backupTarget.db} onClose={() => setBackupTarget(null)} />
      )}
      {migrationSource && (
        <MigrationTargetPicker
          sourceConnId={migrationSource.connId}
          sourceDb={migrationSource.db}
          onClose={() => setMigrationSource(null)}
        />
      )}
      {apiConfigTarget && (
        <ApiConfigModal connId={apiConfigTarget.connId} database={apiConfigTarget.db} onClose={() => setApiConfigTarget(null)} />
      )}
      {loginTarget && (() => {
        const conn = connections.find(c => c.id === loginTarget.connId)
        if (!conn) return null
        return (
          <DbCredentialsDialog
            conn={conn}
            database={loginTarget.db}
            reason={loginTarget.reason}
            onClose={() => setLoginTarget(null)}
            onSaved={(db_credentials) => {
              updateConnection({ ...conn, db_credentials })
              setLoginTarget(null)
              const node = state[conn.id]?.[loginTarget.db]
              if (node?.open) refreshDb(conn.id, loginTarget.db)
            }}
          />
        )
      })()}
      {exportSqlTarget && (
        <ExportSqlModal
          connId={exportSqlTarget.connId}
          database={exportSqlTarget.db}
          table={exportSqlTarget.table}
          onClose={() => setExportSqlTarget(null)}
        />
      )}

      {confirmAction && (() => {
        if (confirmAction.type === 'drop_database') {
          return (
            <ConfirmDialog
              title="Drop Database"
              description={`"${confirmAction.db}" and all its tables and data will be permanently removed. This cannot be undone.`}
              confirmWord="drop"
              variant="danger"
              onConfirm={executeConfirmedAction}
              onCancel={() => setConfirmAction(null)}
            />
          )
        }
        const { type, target } = confirmAction
        return (
          <ConfirmDialog
            title={type === 'truncate' ? 'Truncate Table' : `Drop ${target.type === 'view' ? 'View' : 'Table'}`}
            description={
              type === 'truncate'
                ? `All rows in "${target.name}" will be permanently deleted. The table structure remains intact.`
                : `"${target.name}" and all its data will be permanently removed from the database. This cannot be undone.`
            }
            confirmWord={type}
            variant={type === 'truncate' ? 'warning' : 'danger'}
            onConfirm={executeConfirmedAction}
            onCancel={() => setConfirmAction(null)}
          />
        )
      })()}
    </>
  )
}
