import { Plus, Trash2, Pencil, Check, X, History, ArrowRight } from 'lucide-react'
import type { MigrationPlanObject } from '../../types'

const STATUS_ICON: Record<string, { Icon: typeof Plus; color: string }> = {
  new_on_source: { Icon: Plus, color: 'text-green-400' },
  new_on_target: { Icon: Trash2, color: 'text-gray-600' },
  common_changed: { Icon: Pencil, color: 'text-amber-400' },
  common_no_change: { Icon: Check, color: 'text-gray-600' },
}

function Badge({ label, tone }: { label: string; tone: 'add' | 'drop' | 'mod' | 'neutral' }) {
  const cls = {
    add: 'bg-green-500/15 text-green-400',
    drop: 'bg-red-500/15 text-red-400',
    mod: 'bg-amber-500/15 text-amber-400',
    neutral: 'bg-surface-300 text-gray-500',
  }[tone]
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${cls}`}>{label}</span>
}

interface Props {
  entry: MigrationPlanObject
  kind: 'sql' | 'mongo'
  onToggleInclude: (name: string) => void
  onToggleVersion: (name: string) => void
}

export default function MigrationObjectRow({ entry, kind, onToggleInclude, onToggleVersion }: Props) {
  const { Icon, color } = STATUS_ICON[entry.status]
  const isNewOnTarget = entry.status === 'new_on_target'
  const isChanged = entry.status === 'common_changed'
  const dim = entry.status === 'common_no_change' || isNewOnTarget

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded border border-surface-50 ${dim ? 'opacity-50' : ''} ${entry.include ? 'bg-surface-200/40' : 'bg-transparent'}`}>
      <Icon size={15} className={`flex-shrink-0 ${color}`} />
      <span className="font-mono text-[13px] font-medium truncate">{entry.name}</span>

      <div className="flex items-center gap-1 flex-shrink-0">
        {isChanged && kind === 'sql' && entry.columns_added.length > 0 && <Badge label={`+${entry.columns_added.length} col`} tone="add" />}
        {isChanged && kind === 'sql' && entry.columns_dropped.length > 0 && <Badge label={`−${entry.columns_dropped.length} col`} tone="drop" />}
        {isChanged && kind === 'sql' && entry.columns_modified.length > 0 && <Badge label={`~${entry.columns_modified.length} col`} tone="mod" />}
        {isChanged && (entry.indexes_added.length > 0 || entry.indexes_dropped.length > 0 || entry.indexes_changed.length > 0) && <Badge label="idx" tone="neutral" />}
        {isChanged && (entry.fks_added.length > 0 || entry.fks_dropped.length > 0) && <Badge label="fk" tone="neutral" />}
      </div>

      {entry.version_instead_of_overwrite && entry.version_name_preview && (
        <div className="flex items-center gap-1 text-[10px] font-mono text-violet-400 bg-violet-500/10 rounded px-1.5 py-0.5 truncate">
          <span>{entry.name}</span>
          <ArrowRight size={10} />
          <span>{entry.version_name_preview}</span>
        </div>
      )}

      <div className="flex-1" />

      {isChanged && (
        <button
          onClick={() => onToggleVersion(entry.name)}
          title="Keep existing as a dated backup instead of overwriting"
          className={`btn-ghost p-1 flex-shrink-0 ${entry.version_instead_of_overwrite ? 'text-violet-400' : ''}`}
        >
          <History size={14} />
        </button>
      )}

      {!isNewOnTarget && (
        <button
          onClick={() => onToggleInclude(entry.name)}
          title={entry.include ? 'Included — click to exclude' : 'Excluded — click to include'}
          className={`p-1 rounded flex-shrink-0 ${entry.include ? 'bg-accent text-white' : 'btn-ghost'}`}
        >
          {entry.include ? <Check size={14} /> : <X size={14} />}
        </button>
      )}
    </div>
  )
}
