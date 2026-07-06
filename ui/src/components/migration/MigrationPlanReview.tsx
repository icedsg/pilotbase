import { useState } from 'react'
import { Loader2, AlertCircle, Play } from 'lucide-react'
import { apiMigrationExecute } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore, type MigrationTab } from '../../store'
import MigrationObjectRow from './MigrationObjectRow'

export default function MigrationPlanReview({ tab }: { tab: MigrationTab }) {
  const { userId } = useUserSession()
  const { updateMigrationTab, setMigrationTabJob } = useStore()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  if (!tab.plan) return null
  const { plan, migrationKind: kind = 'sql' } = tab

  const toggleInclude = (name: string) => {
    updateMigrationTab(tab.id, {
      plan: plan.map((o) => o.name === name ? { ...o, include: !o.include } : o),
    })
  }

  const toggleVersion = (name: string) => {
    updateMigrationTab(tab.id, {
      plan: plan.map((o) => o.name === name ? { ...o, version_instead_of_overwrite: !o.version_instead_of_overwrite } : o),
    })
  }

  const includedCount = plan.filter((o) => o.include).length

  const runMigration = async () => {
    setRunning(true)
    setError('')
    try {
      const job = await apiMigrationExecute(
        userId, tab.sourceConnId, tab.targetConnId,
        plan.map((o) => ({ name: o.name, status: o.status, include: o.include, version_instead_of_overwrite: o.version_instead_of_overwrite })),
        tab.scope || 'schema',
      )
      setMigrationTabJob(tab.id, { jobId: job.job_id, steps: job.steps, status: job.status, error: job.error })
      updateMigrationTab(tab.id, { step: 'running' })
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to start migration.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-50 flex-shrink-0">
        <div className="text-sm text-gray-700 dark:text-gray-300">Review migration plan</div>
        <button
          onClick={runMigration}
          disabled={running || includedCount === 0}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
          Run Migration
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 px-5 py-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
        {plan.map((entry) => (
          <MigrationObjectRow
            key={entry.name}
            entry={entry}
            kind={kind}
            onToggleInclude={toggleInclude}
            onToggleVersion={toggleVersion}
          />
        ))}
      </div>
    </div>
  )
}
