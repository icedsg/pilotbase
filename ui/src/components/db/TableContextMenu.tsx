import { useEffect, useRef } from 'react'
import { Rows3, Columns3, Eraser, Trash2, Layers, FileText, Hash } from 'lucide-react'
import type { DbObject } from '../../types'

const VECTOR_DB_TYPES = new Set(['qdrant', 'chroma', 'weaviate'])
const NOSQL_DB_TYPES  = new Set(['mongodb'])

export interface ContextMenuTarget {
  connId: string
  connType: string
  db: string
  name: string
  type: DbObject['type']
  x: number
  y: number
}

interface Props {
  target: ContextMenuTarget
  onViewRows: () => void
  onViewColumns: () => void
  onTruncate: () => void
  onDrop: () => void
  onClose: () => void
}

export default function TableContextMenu({ target, onViewRows, onViewColumns, onTruncate, onDrop, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouse)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouse)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const left = Math.min(target.x + 2, window.innerWidth - 200)
  const top = Math.min(target.y, window.innerHeight - 230)

  const isTable = target.type === 'table'
  const isView = target.type === 'view'
  const isVectorCollection = target.type === 'collection' && VECTOR_DB_TYPES.has(target.connType)
  const isNoSQLCollection  = target.type === 'collection' && NOSQL_DB_TYPES.has(target.connType)
  const isRedisKey = target.type === 'key'
  const label = isTable ? 'Table' : isView ? 'View' : target.type === 'collection' ? 'Collection' : 'Key'

  let viewIcon = <Rows3 size={16} />
  let viewLabel = 'View Rows'
  if (isVectorCollection) { viewIcon = <Layers size={16} />; viewLabel = 'View Chunks' }
  else if (isNoSQLCollection) { viewIcon = <FileText size={16} />; viewLabel = 'View Documents' }
  else if (isRedisKey) { viewIcon = <Hash size={16} />; viewLabel = 'View Value' }

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      className="bg-surface-100 border border-surface-50 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1 min-w-[190px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 border-b border-surface-50 mb-1">
        <div className="text-[13px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</div>
        <div className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate mt-0.5">{target.name}</div>
      </div>

      <button className="ctx-item hover:text-gray-900 dark:hover:text-white" onClick={() => { onViewRows(); onClose() }}>
        {viewIcon}
        <span>{viewLabel}</span>
      </button>

      {(isTable || isView) && (
        <button className="ctx-item hover:text-gray-900 dark:hover:text-white" onClick={() => { onViewColumns(); onClose() }}>
          <Columns3 size={16} />
          <span>View Columns</span>
        </button>
      )}

      {(isTable || isView) && (
        <>
          <div className="border-t border-surface-50 my-1" />
          {isTable && (
            <button className="ctx-item hover:text-yellow-600 dark:hover:text-yellow-400" onClick={() => { onTruncate(); onClose() }}>
              <Eraser size={16} />
              <span>Truncate Table</span>
            </button>
          )}
          <button className="ctx-item hover:text-red-600 dark:hover:text-red-400" onClick={() => { onDrop(); onClose() }}>
            <Trash2 size={16} />
            <span>Drop {label}</span>
          </button>
        </>
      )}
    </div>
  )
}
