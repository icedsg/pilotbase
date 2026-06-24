import { useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import ConnectionTree from '../db/ConnectionTree'
import ConnectionForm from '../db/ConnectionForm'
import { useStore } from '../../store'
import { apiListConnections } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'

interface Props {
  onClose: () => void
}

export default function LeftPanel({ onClose }: Props) {
  const { userId } = useUserSession()
  const { setConnections } = useStore()
  const [showForm, setShowForm] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    if (!userId) return
    setRefreshing(true)
    try {
      const data = await apiListConnections(userId)
      setConnections(data)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden border-r border-surface-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-50 flex-shrink-0">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Connections</span>
        <div className="flex items-center gap-0.5">
          <button onClick={refresh} className="btn-ghost p-1" title="Refresh">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowForm(true)} className="btn-ghost p-1" title="Add connection">
            <Plus size={13} />
          </button>
          <button onClick={onClose} className="btn-ghost p-1" title="Close panel">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ConnectionTree />
      </div>

      {showForm && (
        <ConnectionForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh() }}
        />
      )}
    </div>
  )
}
