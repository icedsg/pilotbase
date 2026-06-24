import { useState, useRef, useEffect } from 'react'
import { Send, Trash2, Bot, X } from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiChatViaWs } from '../../api/client'
import type { ChatMessage } from '../../types'

interface Props {
  onClose: () => void
}

export default function RightPanel({ onClose }: Props) {
  const { userId } = useUserSession()
  const { chatMessages, chatLoading, addChatMessage, setChatLoading, clearChat, activeConnectionId } = useStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !activeConnectionId || chatLoading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    addChatMessage(userMsg)
    setInput('')
    setChatLoading(true)

    try {
      await apiChatViaWs(userId, activeConnectionId, text)
    } catch {
      addChatMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to reach the AI agent. Check that ANTHROPIC_API_KEY is set.',
        timestamp: new Date(),
      })
      setChatLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden border-l border-surface-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-50 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Bot size={13} className="text-gray-500" />
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI Agent</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={clearChat} className="btn-ghost p-1" title="Clear chat">
            <Trash2 size={12} />
          </button>
          <button onClick={onClose} className="btn-ghost p-1" title="Close panel">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
        {chatMessages.length === 0 && (
          <div className="text-center text-gray-600 mt-4 px-4">
            <Bot size={24} className="mx-auto mb-2 text-gray-700" />
            <p>Ask me anything about your database.</p>
            <p className="mt-1 text-gray-700">Select a connection first.</p>
          </div>
        )}
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === 'user'
                  ? 'bg-accent/20 text-gray-800 dark:text-gray-200'
                  : 'bg-surface-300 text-gray-700 dark:text-gray-300'
              }`}
            >
              <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
              <p className="text-[10px] text-gray-600 mt-1">{msg.timestamp.toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
        {chatLoading && (
          <div className="flex justify-start">
            <div className="bg-surface-300 rounded-lg px-3 py-2 text-gray-500 flex items-center gap-1">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse delay-75">●</span>
              <span className="animate-pulse delay-150">●</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-2 border-t border-surface-50 flex-shrink-0">
        <div className="flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={activeConnectionId ? 'Ask about your data…' : 'Select a connection first'}
            disabled={!activeConnectionId || chatLoading}
            className="flex-1 bg-surface-300 text-gray-800 dark:text-gray-200 text-xs rounded px-2 py-1.5 border border-surface-50 focus:outline-none focus:border-accent disabled:opacity-50 placeholder-gray-500 dark:placeholder-gray-600"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !activeConnectionId || chatLoading}
            className="btn-primary px-2 py-1.5"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
