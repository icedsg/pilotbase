import { useState } from 'react'
import {
  Database, Table2, ChevronRight, ChevronDown,
  Eye, Server, Loader2, Layers, Box, Key, Trash2, Settings2, Pencil,
} from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiListDatabases, apiListObjects, apiDeleteConnection, apiExecuteQuery, apiDescribeTable, apiRunDdl } from '../../api/client'
import AdminActionsPanel from './AdminActionsPanel'
import ConnectionForm from './ConnectionForm'
import TableContextMenu, { type ContextMenuTarget } from './TableContextMenu'
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

export default function ConnectionTree() {
  const { connections, activeConnectionId, setActiveConnection, removeConnection, updateConnection, setActiveQuery, setQueryResult, setQueryLoading } = useStore()
  const { userId } = useUserSession()
  const [state,      setState]      = useState<ConnectionState>({})
  const [openConns,  setOpenConns]  = useState<Set<string>>(new Set())
  const [adminConn,  setAdminConn]  = useState<DbConnection | null>(null)
  const [editConn,   setEditConn]   = useState<DbConnection | null>(null)
  const [deleting,   setDeleting]   = useState<string | null>(null)
  const [ctxMenu,    setCtxMenu]    = useState<ContextMenuTarget | null>(null)

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

    let sql: string
    let queryDb: string | undefined
    if (conn.db_type === 'mysql' || conn.db_type === 'mariadb') {
      sql = `SELECT * FROM \`${target.db}\`.\`${target.name}\` LIMIT 500`
    } else if (conn.db_type === 'mongodb') {
      sql = JSON.stringify({ collection: target.name, scroll: true, limit: 100 }, null, 2)
    } else if (conn.db_type === 'redis') {
      sql = `GET ${target.name}`
    } else {
      sql = `SELECT * FROM "${target.name}" LIMIT 500`
      queryDb = target.db
    }

    setActiveConnection(target.connId)
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
    setActiveConnection(target.connId)
    setQueryLoading(true)
    setQueryResult(null)
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

  const handleTruncate = async (target: ContextMenuTarget) => {
    if (!window.confirm(`TRUNCATE TABLE "${target.name}"?\n\nThis will delete ALL rows permanently.`)) return
    try {
      await apiRunDdl(userId, target.connId, 'truncate', target.name, 'table')
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Truncate failed.')
    }
  }

  const handleDrop = async (target: ContextMenuTarget) => {
    const isView = target.type === 'view'
    const action = isView ? 'drop_view' : 'drop_table'
    const objType = isView ? 'view' : 'table'
    const dLabel = isView ? 'VIEW' : 'TABLE'
    if (!window.confirm(`DROP ${dLabel} "${target.name}"?\n\nThis cannot be undone.`)) return
    try {
      await apiRunDdl(userId, target.connId, action, target.name, objType)
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
                {isOpen ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />}
                <Server size={13} className={`flex-shrink-0 ${colorClass}`} />
                <span className="truncate flex-1">{conn.name}</span>

                {/* Type label — hidden on hover to show action buttons */}
                <span className="text-[10px] text-gray-600 flex-shrink-0 group-hover:hidden">
                  {conn.db_type}
                </span>

                {/* Action buttons — shown on hover */}
                <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                  {ADMIN_CAPABLE_TYPES.has(conn.db_type) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAdminConn(conn) }}
                      className="btn-ghost p-0.5"
                      title="Admin: create database / user"
                    >
                      <Settings2 size={11} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditConn(conn) }}
                    className="btn-ghost p-0.5"
                    title="Edit connection"
                  >
                    <Pencil size={11} />
                  </button>
                  {!conn.is_default && (
                    <button
                      onClick={(e) => handleDelete(conn, e)}
                      disabled={isDeleting}
                      className="btn-ghost p-0.5 hover:text-red-400"
                      title="Delete connection"
                    >
                      {isDeleting
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Trash2 size={11} />
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
                      <Loader2 size={11} className="animate-spin" />
                      <span>Loading…</span>
                    </div>
                  ) : (
                    Object.entries(dbNodes).map(([db, node]) => (
                      <div key={db}>
                        {/* Database row */}
                        <div
                          onClick={() => toggleDb(conn, db)}
                          className="tree-item"
                          style={{ paddingLeft: '20px' }}
                        >
                          {node.open ? <ChevronDown size={11} className="flex-shrink-0" /> : <ChevronRight size={11} className="flex-shrink-0" />}
                          {VECTOR_DB_TYPES.has(conn.db_type)
                            ? <Box size={12} className="flex-shrink-0 text-yellow-500" />
                            : <Database size={12} className="flex-shrink-0 text-yellow-500" />
                          }
                          <span className="truncate">{db}</span>
                        </div>

                        {/* Tables & Views */}
                        {node.open && (
                          <div>
                            {node.loading ? (
                              <div className="tree-item pl-12 text-gray-600">
                                <Loader2 size={10} className="animate-spin" />
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
                                        <Layers size={10} />
                                        <span className="uppercase text-[10px] tracking-wider">{label}</span>
                                      </div>
                                      {items.map((obj) => (
                                        <div
                                          key={obj.name}
                                          className="tree-item"
                                          style={{ paddingLeft: '44px' }}
                                          onClick={() => setActiveConnection(conn.id)}
                                          onContextMenu={(e) => {
                                            e.preventDefault()
                                            setCtxMenu({ connId: conn.id, connType: conn.db_type, db, name: obj.name, type: obj.type, x: e.clientX, y: e.clientY })
                                          }}
                                        >
                                          <Icon size={11} className="flex-shrink-0 text-gray-500" />
                                          <span className="truncate font-mono text-[11px]">{obj.name}</span>
                                        </div>
                                      ))}
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
    </>
  )
}
