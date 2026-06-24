import { useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import TopBar from './components/layout/TopBar'
import LeftPanel from './components/layout/LeftPanel'
import RightPanel from './components/layout/RightPanel'
import MainArea from './components/layout/MainArea'
import { useUserSession } from './hooks/useUserSession'
import { useWebSocket } from './hooks/useWebSocket'
import { useStore } from './store'
import { apiListConnections } from './api/client'

export default function App() {
  const { userId, initSession } = useUserSession()
  const { connect } = useWebSocket()
  const { setConnections, theme } = useStore()

  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  useEffect(() => { initSession() }, [])

  useEffect(() => {
    if (!userId) return
    connect(userId)
    apiListConnections(userId).then(setConnections).catch(() => {})
  }, [userId])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])

  const toggleLeft = () => {
    if (leftOpen) leftPanelRef.current?.collapse()
    else leftPanelRef.current?.expand()
  }

  const toggleRight = () => {
    if (rightOpen) rightPanelRef.current?.collapse()
    else rightPanelRef.current?.expand()
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface">
      <TopBar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
      />
      <div className="flex-1 flex overflow-hidden">
        <PanelGroup direction="horizontal" autoSaveId="pilotbase-panels">
          <Panel
            ref={leftPanelRef}
            defaultSize={22}
            minSize={14}
            maxSize={40}
            collapsible
            collapsedSize={0}
            onCollapse={() => setLeftOpen(false)}
            onExpand={() => setLeftOpen(true)}
            className="overflow-hidden"
          >
            <LeftPanel onClose={() => leftPanelRef.current?.collapse()} />
          </Panel>

          <PanelResizeHandle className="panel-resize-handle" />

          <Panel defaultSize={56} minSize={30} className="overflow-hidden">
            <MainArea />
          </Panel>

          <PanelResizeHandle className="panel-resize-handle" />

          <Panel
            ref={rightPanelRef}
            defaultSize={22}
            minSize={14}
            maxSize={40}
            collapsible
            collapsedSize={0}
            onCollapse={() => setRightOpen(false)}
            onExpand={() => setRightOpen(true)}
            className="overflow-hidden"
          >
            <RightPanel onClose={() => rightPanelRef.current?.collapse()} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
