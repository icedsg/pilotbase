import { useEffect, useRef } from 'react'
import { ArrowUp, ArrowDown, X } from 'lucide-react'

export interface SortMenuTarget {
  label: string
  x: number
  y: number
}

interface Props {
  target: SortMenuTarget
  hasSort: boolean
  onSortAsc: () => void
  onSortDesc: () => void
  onClearSort: () => void
  onClose: () => void
}

export default function SortContextMenu({ target, hasSort, onSortAsc, onSortDesc, onClearSort, onClose }: Props) {
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
  const top = Math.min(target.y, window.innerHeight - 150)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      className="bg-surface-100 border border-surface-50 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1 min-w-[190px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 border-b border-surface-50 mb-1">
        <div className="text-[13px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Sort</div>
        <div className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate mt-0.5">{target.label}</div>
      </div>

      <button className="ctx-item hover:text-gray-900 dark:hover:text-white" onClick={() => { onSortAsc(); onClose() }}>
        <ArrowUp size={16} />
        <span>Sort Ascending</span>
      </button>

      <button className="ctx-item hover:text-gray-900 dark:hover:text-white" onClick={() => { onSortDesc(); onClose() }}>
        <ArrowDown size={16} />
        <span>Sort Descending</span>
      </button>

      {hasSort && (
        <>
          <div className="border-t border-surface-50 my-1" />
          <button className="ctx-item hover:text-gray-900 dark:hover:text-white" onClick={() => { onClearSort(); onClose() }}>
            <X size={16} />
            <span>Clear Sort</span>
          </button>
        </>
      )}
    </div>
  )
}
