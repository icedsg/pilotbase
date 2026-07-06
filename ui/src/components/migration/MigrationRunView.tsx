import { Loader2, Check, X, Circle, RotateCcw } from 'lucide-react'
import { useStore, type MigrationTab } from '../../store'

export default function MigrationRunView({ tab }: { tab: MigrationTab }) {
  const { closeMainTab } = useStore()
  const job = tab.job
  if (!job) return null

  const terminal = job.status === 'done' || job.status === 'error'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-50 flex-shrink-0">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {job.status === 'running' && 'Migration running…'}
          {job.status === 'done' && 'Migration finished'}
          {job.status === 'error' && 'Migration failed'}
        </div>
        {terminal && (
          <button
            onClick={() => closeMainTab(tab.id)}
            className="flex items-center gap-1.5 bg-surface-300 hover:bg-surface-200 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded text-xs font-medium"
          >
            <RotateCcw size={13} /> Close
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
        {job.steps.map((step) => {
          const isActive = step.status === 'running'
          const pct = step.progress_total ? Math.min(100, Math.round((step.progress_done / step.progress_total) * 100)) : null
          return (
            <div
              key={step.key}
              className={`px-3 py-2 rounded border ${isActive ? 'border-accent/40 bg-accent/5' : 'border-surface-50'}`}
            >
              <div className="flex items-center gap-2">
                {step.status === 'pending' && <Circle size={14} className="text-gray-600 flex-shrink-0" />}
                {step.status === 'running' && <Loader2 size={14} className="text-accent animate-spin flex-shrink-0" />}
                {step.status === 'done' && <Check size={14} className="text-green-400 flex-shrink-0" />}
                {step.status === 'error' && <X size={14} className="text-red-400 flex-shrink-0" />}
                <span className="text-xs font-mono truncate">{step.label}</span>
              </div>
              {pct != null && (
                <div className="mt-1.5 h-1 bg-surface-300 rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
              {step.error && <div className="mt-1 text-[11px] font-mono text-red-400">{step.error}</div>}
            </div>
          )
        })}
      </div>

      {job.status === 'done' && job.summary && (
        <div className="px-5 py-3 border-t border-surface-50 flex-shrink-0 flex items-center gap-4 text-xs text-gray-500">
          <span>{job.summary.objects_migrated} objects migrated</span>
          <span>{job.summary.rows_copied.toLocaleString()} rows copied</span>
          {job.summary.errors.length > 0 && <span className="text-red-400">{job.summary.errors.length} errors</span>}
        </div>
      )}
    </div>
  )
}
