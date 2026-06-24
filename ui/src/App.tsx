import { useEffect } from 'react'
import { DndContext } from '@dnd-kit/core'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import TopBar from './components/layout/TopBar'
import LeftPanel from './components/layout/LeftPanel'
import RightPanel from './components/layout/RightPanel'
import MainArea from './components/layout/MainArea'
import { useUserSession } from './hooks/useUserSession'
import { usePanelLayout } from './hooks/usePanelLayout'
import { useWebSocket } from './hooks/useWebSocket'
import { useStore } from './store'
import { apiListConnections } from './api/client'

export default function App() {
  const { userId, initSession } = useUserSession()
  const { panelLayout, handleDragEnd } = usePanelLayout()
  const { connect } = useWebSocket()
  const { setConnections, theme } = useStore()

  useEffect(() => {
    initSession()
  }, [])

  useEffect(() => {
    if (!userId) return
    connect(userId)
    apiListConnections(userId)
      .then(setConnections)
      .catch(() => {})
  }, [userId])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface">
      <TopBar />
      <DndContext onDragEnd={handleDragEnd}>
        <div className="flex-1 flex overflow-hidden">
          <PanelGroup direction="horizontal" autoSaveId="pilotbase-panels">
            <Panel defaultSize={22} minSize={14} maxSize={40} className="overflow-hidden">
              <LeftPanel widgets={panelLayout.left} />
            </Panel>

            <PanelResizeHandle className="panel-resize-handle" />

            <Panel defaultSize={56} minSize={30} className="overflow-hidden">
              <MainArea />
            </Panel>

            <PanelResizeHandle className="panel-resize-handle" />

            <Panel defaultSize={22} minSize={14} maxSize={40} className="overflow-hidden">
              <RightPanel widgets={panelLayout.right} />
            </Panel>
          </PanelGroup>
        </div>
      </DndContext>
    </div>
  )
}
