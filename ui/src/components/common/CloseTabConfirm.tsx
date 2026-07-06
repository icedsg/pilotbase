import { AlertTriangle } from 'lucide-react'

interface Props {
  tabLabel: string
  onCancel: () => void
  onConfirm: () => void
  onConfirmDontAskAgain: () => void
}

export default function CloseTabConfirm({ tabLabel, onCancel, onConfirm, onConfirmDontAskAgain }: Props) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl p-6 w-[420px] max-w-[90vw]">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-yellow-500/15">
            <AlertTriangle size={26} className="text-yellow-400" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Close tab?</h2>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          <span className="font-mono text-gray-700 dark:text-gray-300">{tabLabel}</span> will be closed and its state discarded.
          Anything already running on the server (like a migration job) keeps running in the background.
        </p>

        <div className="flex justify-end gap-2 flex-wrap">
          <button onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={onConfirmDontAskAgain}
            className="px-3 py-1.5 rounded text-sm font-medium bg-surface-300 hover:bg-surface-200 text-gray-700 dark:text-gray-300 transition-colors"
          >
            Yes, don't ask again
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
          >
            Yes, close
          </button>
        </div>
      </div>
    </div>
  )
}
