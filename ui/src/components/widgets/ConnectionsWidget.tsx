import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, RefreshCw } from 'lucide-react'
import ConnectionTree from '../db/ConnectionTree'
import { useStore } from '../../store'
import { apiListConnections } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useState } from 'react'
import ConnectionForm from '../db/ConnectionForm'

export default function ConnectionsWidget() {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: 'connections',
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

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
    <div ref={setNodeRef} style={style} className="widget-card flex-1 min-h-0">
      <div className="widget-header">
        <div className="flex items-center gap-1.5">
          <GripVertical size={12} className="text-gray-600 cursor-grab active:cursor-grabbing" {...attributes} {...listeners} />
          <span>Connections</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="btn-ghost p-0.5"
            title="Refresh"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="btn-ghost p-0.5"
            title="Add connection"
          >
            <Plus size={13} />
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
