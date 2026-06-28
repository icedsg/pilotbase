import { useState, useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  title: string
  description: string
  confirmWord: string
  variant?: 'warning' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ title, description, confirmWord, variant = 'danger', onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isWarning = variant === 'warning'
  const matches = value.trim().toLowerCase() === confirmWord.toLowerCase()

  useEffect(() => {
    inputRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl p-6 w-[400px] max-w-[90vw]">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-lg ${isWarning ? 'bg-yellow-500/15' : 'bg-red-500/15'}`}>
            <AlertTriangle size={26} className={isWarning ? 'text-yellow-400' : 'text-red-400'} />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">{description}</p>

        <div className="mb-5">
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 block">
            Type <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{confirmWord}</span> to confirm
          </label>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches) onConfirm() }}
            placeholder={confirmWord}
            className="w-full px-3 py-2 text-sm bg-surface-300 border border-surface-50 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-accent font-mono"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-white ${
              isWarning ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-red-500 hover:bg-red-600'
            }`}
          >
            {title}
          </button>
        </div>
      </div>
    </div>
  )
}
