import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import type { PendingPlan } from '../store'
import type { WsMessage, ChatMessage, QueryHistoryEntry, QueryResult } from '../types'

const BASE_WS = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws')
  : `ws://${window.location.host}`

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const intentionalClose = useRef(false)
  const {
    setWsConnected, addTabMessage, setTabLoading, addQueryHistoryEntry, setTabPendingPlan,
    resolveTabForRequest, bindTabSession,
  } = useStore()

  const connect = useCallback((userId: string) => {
    const state = wsRef.current?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return

    intentionalClose.current = false
    const ws = new WebSocket(`${BASE_WS}/ws/${userId}`)
    wsRef.current = ws

    ws.onopen = () => {
      setWsConnected(true)
      // Keepalive ping every 25s
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        } else {
          clearInterval(ping)
        }
      }, 25_000)
    }

    ws.onclose = () => {
      setWsConnected(false)
      if (!intentionalClose.current) {
        reconnectTimer.current = setTimeout(() => connect(userId), 3_000)
      }
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        const payload = msg.payload
        const sessionId = (payload?.session_id as string) || null
        const requestId = (payload?.request_id as string) || null

        if (msg.type === 'agent_done' || msg.type === 'plan_proposed' || msg.type === 'error') {
          const tabId = resolveTabForRequest(requestId, sessionId)
          if (!tabId) return
          if (sessionId) bindTabSession(tabId, sessionId, null)

          if (msg.type === 'agent_done') {
            const content = (payload?.response as string) || ''
            const chatMsg: ChatMessage = {
              id: crypto.randomUUID(), role: 'assistant', content, timestamp: new Date(),
            }
            addTabMessage(tabId, chatMsg)
            setTabLoading(tabId, false)
          }

          if (msg.type === 'plan_proposed' && payload) {
            const summary = (payload.summary as string) || ''
            if (summary) {
              addTabMessage(tabId, { id: crypto.randomUUID(), role: 'assistant', content: summary, timestamp: new Date() })
            }
            setTabPendingPlan(tabId, {
              planId: payload.plan_id as string,
              steps: (payload.steps as PendingPlan['steps']) || [],
              summary,
            })
            setTabLoading(tabId, false)
          }

          if (msg.type === 'error') {
            const chatMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `Error: ${(payload?.message as string) || 'Unknown error'}`,
              timestamp: new Date(),
            }
            addTabMessage(tabId, chatMsg)
            setTabLoading(tabId, false)
          }
        }

        if (msg.type === 'plan_committed') {
          const tabId = resolveTabForRequest(requestId, sessionId)
          if (tabId) {
            addTabMessage(tabId, {
              id: crypto.randomUUID(), role: 'assistant', content: 'Plan approved and applied.', timestamp: new Date(),
            })
            setTabPendingPlan(tabId, null)
          }
        }

        if (msg.type === 'plan_rejected') {
          const tabId = resolveTabForRequest(requestId, sessionId)
          if (tabId) setTabPendingPlan(tabId, null)
        }

        if (msg.type === 'query_executed' && payload) {
          addQueryHistoryEntry(payload as unknown as QueryHistoryEntry)
        }

        // The agent ran a query on the user's behalf — mirror it into the Query
        // Editor / results grid exactly as if the user had typed and run it
        // themselves (see api/app/routers/ai.py: agent_query_applied).
        if (msg.type === 'agent_query_applied' && payload) {
          const store = useStore.getState()
          const connectionId = payload.connection_id as string | undefined
          if (connectionId) store.setActiveConnection(connectionId)
          if (payload.database) store.setActiveDatabase(payload.database as string)
          store.setVectorViewContext(null)
          store.setNosqlViewContext(null)
          store.setMigrationViewContext(null)
          store.setColumnViewContext(null)
          store.setActiveQuery((payload.sql as string) || '')
          store.setQueryResult((payload.result as QueryResult) || null)
          store.setSqlPanelOpen(true)
        }

        // The agent browsed or updated a vector collection — open it in the
        // Vector Chunks view, which fetches its own fresh data on open (see
        // api/app/routers/ai.py: agent_vector_view).
        if (msg.type === 'agent_vector_view' && payload) {
          const store = useStore.getState()
          const connectionId = payload.connection_id as string | undefined
          if (connectionId) store.setActiveConnection(connectionId)
          store.setNosqlViewContext(null)
          store.setMigrationViewContext(null)
          store.setVectorViewContext({
            collection: payload.collection as string,
            connId: connectionId || '',
            db: (payload.database as string) || '',
            dbType: (payload.db_type as string) || '',
          })
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [setWsConnected, addTabMessage, setTabLoading, addQueryHistoryEntry, setTabPendingPlan, resolveTabForRequest, bindTabSession])

  const disconnect = useCallback(() => {
    intentionalClose.current = true
    clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    wsRef.current = null
    setWsConnected(false)
  }, [setWsConnected])

  const send = useCallback((type: string, payload?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }))
    }
  }, [])

  useEffect(() => () => disconnect(), [disconnect])

  return { connect, disconnect, send }
}
