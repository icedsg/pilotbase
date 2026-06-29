import { useState, useEffect, useRef } from 'react'
import {
  Table2, ChevronRight, ChevronDown,
  Eye, Loader2, Layers, Box, Key, Trash2, Settings2, Pencil, RefreshCw,
} from 'lucide-react'
import DbTypeIcon from './DbTypeIcon'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiListDatabases, apiListObjects, apiDeleteConnection, apiExecuteQuery, apiDescribeTable, apiRunDdl, apiGetDbVersion } from '../../api/client'
import AdminActionsPanel from './AdminActionsPanel'
import ConnectionForm from './ConnectionForm'
import { LogoIcon } from '../common/Logo'
import TableContextMenu, { type ContextMenuTarget } from './TableContextMenu'
import ConfirmDialog from '../common/ConfirmDialog'
import type { DbConnection, DbObject, QueryResult } from '../../types'

interface TreeNode {
  database?: string
  objects?: DbObject[]
  loading?: boolean
  open?: boolean
}

type ConnectionState = Record<string, Record<string, TreeNode>>

const VECTOR_DB_TYPES    = new Set(['qdrant', 'chroma', 'weaviate'])
const ADMIN_CAPABLE_TYPES = new Set(['postgresql', 'mysql', 'mariadb'])

const DB_TYPE_COLORS: Record<string, string> = {
  postgresql: 'text-blue-400',
  mysql:      'text-orange-400',
  mariadb:    'text-orange-400',
  sqlite:     'text-green-400',
  mssql:      'text-red-400',
  mongodb:    'text-emerald-400',
  redis:      'text-rose-400',
  qdrant:     'text-violet-400',
  chroma:     'text-fuchsia-400',
  weaviate:   'text-cyan-400',
}

const DB_TYPE_BADGE: Record<string, string> = {
  postgresql: 'PG',
  mysql:      'MY',
  mariadb:    'MB',
  sqlite:     'SL',
  mssql:      'MS',
  mongodb:    'MG',
  redis:      'RD',
  qdrant:     'QD',
  chroma:     'CH',
  weaviate:   'WV',
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
  const { connections, activeConnectionId, setActiveConnection, removeConnection, updateConnection, setActiveQuery, setQueryResult, setQueryLoading, setActiveDatabase, setColumnViewContext, appendAlterScript, setVectorViewContext, setNosqlViewContext } = useStore()
  const { userId } = useUserSession()
  const [state,      setState]      = useState<ConnectionState>({})
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
    setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: true, open: true } } }))
    try {
      const { objects } = await apiListObjects(userId, connId, db)
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: false, objects, open: true } } }))
    } catch {
      setState(s => ({ ...s, [connId]: { ...s[connId], [db]: { ...node, loading: false, open: true } } }))
    }
  }

  const refreshConnDbs = async (connId: string) => {
    setState(s => ({ ...s, [connId]: { __loading: { loading: true } } }))
    try {
      const { databases } = await apiListDatabases(userId, connId)
      const dbMap: Record<string, TreeNode> = {}
      databases.forEach(db => { dbMap[db] = { database: db, objects: undefined, open: false } })
      setState(s => ({ ...s, [connId]: dbMap }))
    } catch {
      setState(s => ({ ...s, [connId]: {} }))
    }
  }

  const toggleConn = async (conn: DbConnection) => {
    setActiveConnection(conn.id)
    const isOpen = openConns.has(conn.id)
    if (isOpen) {
      setOpenConns((s) => { const n = new Set(s); n.delete(conn.id); return n })
      return
    }
    setOpenConns((s) => new Set(s).add(conn.id))

    if (!state[conn.id]) {
      setState((s) => ({ ...s, [conn.id]: { __loading: { loading: true } } }))
      try {
        const { databases } = await apiListDatabases(userId, conn.id)
        const dbMap: Record<string, TreeNode> = {}
        databases.forEach((db) => { dbMap[db] = { database: db, objects: undefined, open: false } })
        setState((s) => ({ ...s, [conn.id]: dbMap }))
      } catch {
        setState((s) => ({ ...s, [conn.id]: {} }))
      }
    }
  }

  const toggleDb = async (conn: DbConnection, db: string) => {
    const node = state[conn.id]?.[db]
    if (!node) return

    setActiveDatabase(db)

    if (node.open) {
      setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: false } } }))
      return
    }

    setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: true, loading: true } } }))

    try {
      const { objects } = await apiListObjects(userId, conn.id, db)
      setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: true, loading: false, objects } } }))
    } catch {
      setState((s) => ({ ...s, [conn.id]: { ...s[conn.id], [db]: { ...node, open: true, loading: false, objects: [] } } }))
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

  const handleViewRows = async (target: ContextMenuTarget) => {
    const conn = connections.find(c => c.id === target.connId)
    if (!conn) return

    setColumnViewContext(null)
    setActiveConnection(target.connId)

    // Vector DB → dedicated chunks view
    if (VECTOR_DB_TYPES.has(conn.db_type)) {
      const obj = Object.values(state[target.connId]?.[target.db] ?? {}).flatMap(n => (n as any).objects ?? []).find((o: any) => o.name === target.name)
      setVectorViewContext({ collection: target.name, connId: target.connId, db: target.db, dbType: conn.db_type, totalCount: obj?.count })
      setNosqlViewContext(null)
      return
    }

    // MongoDB → dedicated document view
    if (conn.db_type === 'mongodb') {
      setNosqlViewContext({ collection: target.name, connId: target.connId, db: target.db, dbType: conn.db_type })
      setVectorViewContext(null)
      return
    }

    // SQL / Redis → query result table
    setVectorViewContext(null)
    setNosqlViewContext(null)

    let sql: string
    let queryDb: string | undefined
    if (conn.db_type === 'mysql' || conn.db_type === 'mariadb') {
      sql = `SELECT * FROM \`${target.db}\`.\`${target.name}\` LIMIT 500`
    } else if (conn.db_type === 'redis') {
      sql = `GET ${target.name}`
    } else {
      sql = `SELECT * FROM "${target.name}" LIMIT 500`
      queryDb = target.db
    }

    setActiveDatabase(queryDb || null)
    setActiveQuery(sql)
    setQueryLoading(true)
    setQueryResult(null)
    try {
      const result = await apiExecuteQuery(userId, target.connId, sql, queryDb)
      setQueryResult(result)
    } catch (err: any) {
      setQueryResult({ rows: [], columns: [], row_count: 0, error: err?.response?.data?.detail || 'Query failed' } as any)
    } finally {
      setQueryLoading(false)
    }
  }

  const handleViewColumns = async (target: ContextMenuTarget) => {
    const conn = connections.find(c => c.id === target.connId)
    setActiveConnection(target.connId)
    setVectorViewContext(null)
    setNosqlViewContext(null)
    setQueryLoading(true)
    setQueryResult(null)
    if (conn) {
      setColumnViewContext({ table: target.name, connId: target.connId, db: target.db || null, dbType: conn.db_type })
    }
    try {
      const info = await apiDescribeTable(userId, target.connId, target.name, undefined, target.db)
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
      setQueryResult(result)
    } catch {
      // silent
    } finally {
      setQueryLoading(false)
    }
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
        await apiRunDdl(userId, target.connId, 'truncate', target.name, 'table', target.db)
        appendAlterScript(`TRUNCATE TABLE ${target.name};`, true)
      } catch (err: any) {
        alert(err?.response?.data?.detail || 'Truncate failed.')
      }
    } else {
      const isView = target.type === 'view'
      const ddlAction = isView ? 'drop_view' : 'drop_table'
      const objType = isView ? 'view' : 'table'
      try {
        await apiRunDdl(userId, target.connId, ddlAction, target.name, objType, target.db)
        appendAlterScript(isView ? `DROP VIEW ${target.name};` : `DROP TABLE ${target.name};`, true)
        const node = state[target.connId]?.[target.db]
        if (node) {
          setState(s => ({ ...s, [target.connId]: { ...s[target.connId], [target.db]: { ...node, loading: true } } }))
          try {
            const { objects } = await apiListObjects(userId, target.connId, target.db)
            setState(s => ({ ...s, [target.connId]: { ...s[target.connId], [target.db]: { ...node, loading: false, objects } } }))
          } catch {
            setState(s => ({ ...s, [target.connId]: { ...s[target.connId], [target.db]: { ...node, loading: false } } }))
          }
        }
      } catch (err: any) {
        alert(err?.response?.data?.detail || 'Drop failed.')
      }
    }
  }

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
                  {!conn.is_default && (
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
                  )}
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
                  ) : (
                    Object.entries(dbNodes).map(([db, node]) => (
                      <div key={db}>
                        {/* Database row */}
                        <div
                          onClick={() => toggleDb(conn, db)}
                          onContextMenu={(e) => { e.preventDefault(); setDbCtxMenu({ connId: conn.id, db, x: e.clientX, y: e.clientY }) }}
                          className="tree-item group/db"
                          style={{ paddingLeft: '20px' }}
                        >
                          {node.open ? <ChevronDown size={14} className="flex-shrink-0" /> : <ChevronRight size={14} className="flex-shrink-0" />}
                          {VECTOR_DB_TYPES.has(conn.db_type)
                            ? <Box size={16} className="flex-shrink-0 text-yellow-500" />
                            : <LogoIcon size={16} className="flex-shrink-0" />
                          }
                          <span className="truncate flex-1">{db}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); refreshDb(conn.id, db) }}
                            className="hidden group-hover/db:flex btn-ghost p-0.5 flex-shrink-0"
                            title="Refresh database"
                          >
                            <RefreshCw size={13} />
                          </button>
                        </div>

                        {/* Tables & Views */}
                        {node.open && (
                          <div>
                            {node.loading ? (
                              <div className="tree-item pl-12 text-gray-600">
                                <Loader2 size={13} className="animate-spin" />
                                <span>Loading…</span>
                              </div>
                            ) : (
                              <>
                                {(['table', 'view', 'collection', 'key'] as const).map((type) => {
                                  const items = (node.objects || []).filter((o) => o.type === type)
                                  if (!items.length) return null
                                  const Icon  = type === 'table' ? Table2 : type === 'view' ? Eye : type === 'collection' ? Box : Key
                                  const label = type === 'table' ? 'Tables' : type === 'view' ? 'Views' : type === 'collection' ? 'Collections' : 'Keys'
                                  return (
                                    <div key={type}>
                                      <div className="tree-item text-gray-600" style={{ paddingLeft: '32px' }}>
                                        <Layers size={13} />
                                        <span className="uppercase text-[13px] tracking-wider">{label}</span>
                                        <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1">({items.length})</span>
                                      </div>
                                      {items.map((obj) => {
                                        const isVectorCollection = VECTOR_DB_TYPES.has(conn.db_type) && obj.type === 'collection'
                                        return (
                                          <div
                                            key={obj.name}
                                            className="tree-item"
                                            style={{ paddingLeft: '44px' }}
                                            onClick={() => {
                                              if (isVectorCollection) {
                                                setVectorViewContext({ collection: obj.name, connId: conn.id, db, dbType: conn.db_type, totalCount: obj.count })
                                                setNosqlViewContext(null)
                                                setColumnViewContext(null)
                                                setActiveConnection(conn.id)
                                              } else {
                                                setActiveConnection(conn.id)
                                              }
                                            }}
                                            onContextMenu={(e) => {
                                              e.preventDefault()
                                              if (!isVectorCollection) {
                                                setCtxMenu({ connId: conn.id, connType: conn.db_type, db, name: obj.name, type: obj.type, x: e.clientX, y: e.clientY })
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
                                {(node.objects || []).length === 0 && (
                                  <div className="tree-item text-gray-600 pl-12">No objects found</div>
                                )}
                              </>
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
          onViewColumns={() => handleViewColumns(ctxMenu)}
          onTruncate={() => handleTruncate(ctxMenu)}
          onDrop={() => handleDrop(ctxMenu)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {dbCtxMenu && (
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
          <div className="border-t border-surface-50 my-1" />
          <button
            className="ctx-item hover:text-red-600 dark:hover:text-red-400"
            onClick={() => { setConfirmAction({ type: 'drop_database', connId: dbCtxMenu.connId, db: dbCtxMenu.db }); setDbCtxMenu(null) }}
          >
            <Trash2 size={15} />
            <span>Drop Database</span>
          </button>
        </div>
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
