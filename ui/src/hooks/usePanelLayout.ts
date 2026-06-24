import { useEffect } from 'react'
import Cookies from 'js-cookie'
import { useStore } from '../store'
import type { PanelLayout, WidgetId } from '../types'
import type { DragEndEvent } from '@dnd-kit/core'

const COOKIE_KEY = 'pilotbase_layout'
const COOKIE_DAYS = 365

function saveLayout(layout: PanelLayout) {
  Cookies.set(COOKIE_KEY, JSON.stringify(layout), { expires: COOKIE_DAYS, sameSite: 'Lax' })
}

function loadLayout(): PanelLayout | null {
  try {
    const raw = Cookies.get(COOKIE_KEY)
    return raw ? (JSON.parse(raw) as PanelLayout) : null
  } catch {
    return null
  }
}

export function usePanelLayout() {
  const { panelLayout, setPanelLayout, moveWidget } = useStore()

  // Restore from cookie on mount
  useEffect(() => {
    const saved = loadLayout()
    if (saved) setPanelLayout(saved)
  }, [])

  // Persist to cookie whenever layout changes
  useEffect(() => {
    saveLayout(panelLayout)
  }, [panelLayout])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const widgetId = active.id as WidgetId
    const targetPanel = over.id as 'left' | 'right'

    if (targetPanel === 'left' || targetPanel === 'right') {
      moveWidget(widgetId, targetPanel)
    }
  }

  return { panelLayout, handleDragEnd }
}
