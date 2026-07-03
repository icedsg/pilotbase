import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import type { PendingPlan } from '../store'
import type { WsMessage, ChatMessage, QueryHistoryEntry } from '../types'

const BASE_WS = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws')
  : `ws://${window.location.host}`

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const intentionalClose = useRef(false)
  const { setWsConnected, addChatMessage, setChatLoading, addQueryHistoryEntry, setPendingPlan } = useStore()

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

        if (msg.type === 'agent_done') {
          const content = (msg.payload?.response as string) || ''
          const chatMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content,
            timestamp: new Date(),
          }
          addChatMessage(chatMsg)
          setChatLoading(false)
        }

        if (msg.type === 'plan_proposed' && msg.payload) {
          const summary = (msg.payload.summary as string) || ''
          if (summary) {
            addChatMessage({ id: crypto.randomUUID(), role: 'assistant', content: summary, timestamp: new Date() })
          }
          setPendingPlan({
            planId: msg.payload.plan_id as string,
            steps: (msg.payload.steps as PendingPlan['steps']) || [],
            summary,
          })
          setChatLoading(false)
        }

        if (msg.type === 'plan_committed') {
          addChatMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Plan approved and applied.',
            timestamp: new Date(),
          })
          setPendingPlan(null)
        }

        if (msg.type === 'plan_rejected') {
          setPendingPlan(null)
        }

        if (msg.type === 'error') {
          const chatMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Error: ${(msg.payload?.message as string) || 'Unknown error'}`,
            timestamp: new Date(),
          }
          addChatMessage(chatMsg)
          setChatLoading(false)
        }

        if (msg.type === 'query_executed' && msg.payload) {
          addQueryHistoryEntry(msg.payload as unknown as QueryHistoryEntry)
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [setWsConnected, addChatMessage, setChatLoading, addQueryHistoryEntry, setPendingPlan])

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
