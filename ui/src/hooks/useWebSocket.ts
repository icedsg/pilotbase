import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'
import type { WsMessage, ChatMessage } from '../types'

const BASE_WS = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws')
  : `ws://${window.location.host}`

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const intentionalClose = useRef(false)
  const { setWsConnected, addChatMessage, setChatLoading } = useStore()

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
      } catch {
        // ignore parse errors
      }
    }
  }, [setWsConnected, addChatMessage, setChatLoading])

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
