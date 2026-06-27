import { useEffect, useRef } from 'react'
import { Rows3, Columns3, Eraser, Trash2 } from 'lucide-react'
import type { DbObject } from '../../types'

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
  const label = isTable ? 'Table' : isView ? 'View' : target.type === 'collection' ? 'Collection' : 'Key'

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      className="bg-surface-100 border border-surface-50 rounded-lg shadow-2xl py-1 min-w-[190px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 border-b border-surface-50 mb-1">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
        <div className="font-mono text-xs text-gray-300 truncate mt-0.5">{target.name}</div>
      </div>

      <button className="ctx-item" onClick={() => { onViewRows(); onClose() }}>
        <Rows3 size={12} />
        <span>View Rows</span>
      </button>

      {(isTable || isView) && (
        <button className="ctx-item" onClick={() => { onViewColumns(); onClose() }}>
          <Columns3 size={12} />
          <span>View Columns</span>
        </button>
      )}

      {(isTable || isView) && (
        <>
          <div className="border-t border-surface-50 my-1" />
          {isTable && (
            <button className="ctx-item hover:text-yellow-400" onClick={() => { onTruncate(); onClose() }}>
              <Eraser size={12} />
              <span>Truncate Table</span>
            </button>
          )}
          <button className="ctx-item hover:text-red-400" onClick={() => { onDrop(); onClose() }}>
            <Trash2 size={12} />
            <span>Drop {label}</span>
          </button>
        </>
      )}
    </div>
  )
}
