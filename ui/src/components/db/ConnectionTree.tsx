import { useState } from 'react'
import {
  Database, Table2, ChevronRight, ChevronDown,
  Eye, Server, Loader2, Layers, Box, Key,
} from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiListDatabases, apiListObjects, apiRunDdl } from '../../api/client'
import type { DbConnection, DbObject } from '../../types'

interface TreeNode {
  database?: string
  objects?: DbObject[]
  loading?: boolean
  open?: boolean
}

type ConnectionState = Record<string, Record<string, TreeNode>>

const VECTOR_DB_TYPES = new Set(['qdrant', 'chroma', 'weaviate'])

const DB_TYPE_COLORS: Record<string, string> = {
  // SQL
  postgresql: 'text-blue-400',
  mysql:      'text-orange-400',
  mariadb:    'text-orange-400',
  sqlite:     'text-green-400',
  mssql:      'text-red-400',
  // NoSQL
  mongodb:    'text-emerald-400',
  redis:      'text-rose-400',
  // Vector
  qdrant:     'text-violet-400',
  chroma:     'text-fuchsia-400',
  weaviate:   'text-cyan-400',
}

export default function ConnectionTree() {
  const { connections, activeConnectionId, setActiveConnection } = useStore()
  const { userId } = useUserSession()
  const [state, setState] = useState<ConnectionState>({})
  const [openConns, setOpenConns] = useState<Set<string>>(new Set())

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

  if (connections.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-600 text-center">
        No connections yet.<br />Click + to add one.
      </div>
    )
  }

  return (
    <div className="py-1">
      {connections.map((conn) => {
        const isOpen = openConns.has(conn.id)
        const isActive = activeConnectionId === conn.id
        const colorClass = DB_TYPE_COLORS[conn.db_type] || 'text-gray-400'
        const dbNodes = state[conn.id] || {}
        const loading = '__loading' in dbNodes

        return (
          <div key={conn.id}>
            {/* Connection row */}
            <div
              onClick={() => toggleConn(conn)}
              className={`tree-item ${isActive ? 'tree-item-active' : ''}`}
              style={{ paddingLeft: '8px' }}
            >
              {isOpen ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />}
              <Server size={13} className={`flex-shrink-0 ${colorClass}`} />
              <span className="truncate flex-1">{conn.name}</span>
              <span className="text-[10px] text-gray-600 flex-shrink-0">{conn.db_type}</span>
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
                              {/* Group by type */}
                              {(['table', 'view', 'collection', 'key'] as const).map((type) => {
                                const items = (node.objects || []).filter((o) => o.type === type)
                                if (!items.length) return null
                                const Icon  = type === 'table' ? Table2 : type === 'view' ? Eye : type === 'collection' ? Box : Key
                                const label = type === 'table' ? 'Tables' : type === 'view' ? 'Views' : type === 'collection' ? 'Collections' : 'Keys'
                                return (
                                  <div key={type}>
                                    <div
                                      className="tree-item text-gray-600"
                                      style={{ paddingLeft: '32px' }}
                                    >
                                      <Layers size={10} />
                                      <span className="uppercase text-[10px] tracking-wider">{label}</span>
                                    </div>
                                    {items.map((obj) => (
                                      <div
                                        key={obj.name}
                                        className="tree-item"
                                        style={{ paddingLeft: '44px' }}
                                        onClick={() => {
                                          setActiveConnection(conn.id)
                                          // TODO: open table in main area
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
  )
}
