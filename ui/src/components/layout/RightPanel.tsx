import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import ConnectionsWidget from '../widgets/ConnectionsWidget'
import AIChatWidget from '../widgets/AIChatWidget'
import type { WidgetId } from '../../types'

const WIDGET_MAP: Record<WidgetId, React.ComponentType> = {
  'connections': ConnectionsWidget,
  'ai-chat': AIChatWidget,
}

interface Props {
  widgets: WidgetId[]
}

export default function RightPanel({ widgets }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: 'right' })

  return (
    <div
      ref={setNodeRef}
      className={`h-full flex flex-col gap-2 p-2 overflow-y-auto transition-colors ${
        isOver ? 'bg-accent/5' : ''
      }`}
    >
      <SortableContext items={widgets} strategy={verticalListSortingStrategy}>
        {widgets.map((id) => {
          const Widget = WIDGET_MAP[id]
          return Widget ? <Widget key={id} /> : null
        })}
      </SortableContext>

      {widgets.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600 border-2 border-dashed border-surface-50 rounded-lg m-2">
          Drag widgets here
        </div>
      )}
    </div>
  )
}
