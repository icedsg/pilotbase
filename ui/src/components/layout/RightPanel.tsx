import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Send, Trash2, Bot, X, Check, Ban, Loader2, Plus, Clock } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useStore, MAX_CHAT_TABS } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import {
  apiChatViaWs, apiCommitPlan, apiRejectPlan,
  apiListChatSessions, apiGetChatSessionMessages,
} from '../../api/client'
import { formatChatTimestamp } from '../../lib/formatTimestamp'
import ChatCodeBlock from './ChatCodeBlock'
import type { ChatMessage, ChatSessionSummary } from '../../types'

// Snapshot of the OTHER open panels (never the AI chat panel itself) sent
// along with each message so the agent's get_ui_state tool has something to
// read — see api/app/agents/tools/ui_context_tools.py.
function buildUiContext(): Record<string, unknown> {
  const s = useStore.getState()
  const ctx: Record<string, unknown> = {}
  if (s.activeDatabase) ctx.activeDatabase = s.activeDatabase
  if (s.activeQuery.trim()) ctx.activeQuery = s.activeQuery
  if (s.queryResult) {
    ctx.queryResult = {
      row_count: s.queryResult.row_count,
      columns: s.queryResult.columns,
      truncated: s.queryResult.truncated,
    }
  }
  if (s.columnViewContext) ctx.columnViewContext = s.columnViewContext
  if (s.vectorViewContext) ctx.vectorViewContext = s.vectorViewContext
  if (s.nosqlViewContext) ctx.nosqlViewContext = s.nosqlViewContext
  if (s.migrationViewContext) ctx.migrationViewContext = s.migrationViewContext
  return ctx
}

const markdownComponents = {
  code({ className, children }: { className?: string; children?: ReactNode }) {
    const match = /language-(\w+)/.exec(className || '')
    const code = String(children).replace(/\n$/, '')
    if (match) return <ChatCodeBlock language={match[1]} code={code} />
    return <code className="bg-black text-gray-200 rounded px-1 py-0.5 text-[12px]">{children}</code>
  },
}

interface Props {
  onClose: () => void
}

export default function RightPanel({ onClose }: Props) {
  const { userId } = useUserSession()
  const {
    chatTabs, activeTabId, connections, activeConnectionId,
    openNewChatTab, closeChatTab, setActiveChatTab,
    addTabMessage, setTabMessages, setTabLoading, setTabPendingPlan, bindTabSession, clearTabMessages,
    registerPendingRequest, setTabConnection,
  } = useStore()

  const activeTab = chatTabs.find((t) => t.tabId === activeTabId) ?? null
  const activeConnection = connections.find((c) => c.id === activeTab?.connectionId) ?? null

  const [input, setInput] = useState('')
  const [planBusy, setPlanBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySessions, setHistorySessions] = useState<ChatSessionSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Ensure there's always at least one open tab. Reads fresh state (not the
  // render-time closure) so React StrictMode's double-invoke in dev can't
  // open two tabs.
  useEffect(() => {
    if (useStore.getState().chatTabs.length === 0) openNewChatTab(activeConnectionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the current chat's connection in sync with whatever the user picks
  // in the left sidebar, as long as the chat hasn't started yet — once a
  // conversation exists we don't want to silently switch its target db.
  useEffect(() => {
    const tab = activeTab
    if (!tab || tab.connectionId === activeConnectionId) return
    if (tab.messages.length === 0 && !tab.sessionId) setTabConnection(tab.tabId, activeConnectionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (activeTab && !activeTab.loading) inputRef.current?.focus()
  }, [activeTab?.messages, activeTab?.loading])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 4000)
    return () => clearTimeout(t)
  }, [banner])

  const handleNewTab = () => {
    const tabId = openNewChatTab(activeConnectionId)
    if (!tabId) setBanner('Maximum 3 chats open — close one first.')
  }

  const openHistory = async () => {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next) {
      setHistoryLoading(true)
      try {
        const { sessions } = await apiListChatSessions(userId)
        setHistorySessions(sessions)
      } catch {
        setHistorySessions([])
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  const openPastSession = async (s: ChatSessionSummary) => {
    setHistoryOpen(false)
    const existing = chatTabs.find((t) => t.sessionId === s.id)
    if (existing) {
      setActiveChatTab(existing.tabId)
      return
    }
    const tabId = openNewChatTab(s.connection_id)
    if (!tabId) {
      setBanner('Maximum 3 chats open — close one first.')
      return
    }
    bindTabSession(tabId, s.id, s.title)
    try {
      const { messages } = await apiGetChatSessionMessages(userId, s.id)
      setTabMessages(tabId, messages.map((m): ChatMessage => ({
        id: m.id, role: m.role, content: m.content, timestamp: new Date(m.created_at),
      })))
    } catch {
      // leave the tab empty if history couldn't be fetched
    }
  }

  const sendMessage = async () => {
    const text = input.trim()
    const tab = activeTab
    if (!text || !tab || !tab.connectionId || tab.loading) return

    const tabId = tab.tabId
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    addTabMessage(tabId, userMsg)
    setInput('')
    setTabLoading(tabId, true)

    const requestId = crypto.randomUUID()
    registerPendingRequest(requestId, tabId)

    try {
      const ack = await apiChatViaWs(userId, tab.connectionId, text, tab.sessionId, requestId, buildUiContext())
      const fresh = useStore.getState().chatTabs.find((t) => t.tabId === tabId)
      bindTabSession(tabId, ack.session_id, fresh?.title ? null : text.slice(0, 80))
    } catch {
      addTabMessage(tabId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'AI agent unavailable. Check the server configuration.',
        timestamp: new Date(),
      })
      setTabLoading(tabId, false)
    }
  }

  const approvePlan = async () => {
    const tab = activeTab
    if (!tab?.pendingPlan) return
    setPlanBusy(true)
    try {
      await apiCommitPlan(userId, tab.pendingPlan.planId)
    } catch {
      addTabMessage(tab.tabId, { id: crypto.randomUUID(), role: 'assistant', content: 'Failed to apply the plan.', timestamp: new Date() })
      setTabPendingPlan(tab.tabId, null)
    } finally {
      setPlanBusy(false)
    }
  }

  const rejectPlan = async () => {
    const tab = activeTab
    if (!tab?.pendingPlan) return
    setPlanBusy(true)
    try {
      await apiRejectPlan(userId, tab.pendingPlan.planId)
    } finally {
      setPlanBusy(false)
      setTabPendingPlan(tab.tabId, null)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden border-l border-surface-50">
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-50 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Bot size={17} className="text-gray-500 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex-shrink-0">AI Agent</span>
          {activeConnection && (
            <span className="text-xs text-accent truncate" title={activeConnection.name}>
              · {activeConnection.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => activeTab && clearTabMessages(activeTab.tabId)}
            className="btn-ghost p-1"
            title="Clear chat"
          >
            <Trash2 size={16} />
          </button>
          <button onClick={onClose} className="btn-ghost p-1" title="Close panel">
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-50 flex-shrink-0 overflow-x-auto">
        {chatTabs.map((tab) => (
          <div
            key={tab.tabId}
            onClick={() => setActiveChatTab(tab.tabId)}
            className={`group flex items-center gap-1 pl-2 pr-1 py-1 rounded text-xs max-w-[120px] flex-shrink-0 cursor-pointer ${
              tab.tabId === activeTabId ? 'bg-accent/20 text-accent' : 'text-gray-600 dark:text-gray-400 hover:bg-surface-300'
            }`}
          >
            <Bot size={12} className="flex-shrink-0" />
            <span className="truncate">{tab.title ?? 'New chat'}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeChatTab(tab.tabId) }}
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:text-red-500"
              title="Close chat"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <button
          onClick={handleNewTab}
          disabled={chatTabs.length >= MAX_CHAT_TABS}
          className="btn-ghost p-1 flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          title={chatTabs.length >= MAX_CHAT_TABS ? 'Maximum 3 chats open' : 'New chat'}
        >
          <Plus size={14} />
        </button>

        <div className="relative flex-shrink-0">
          <button onClick={openHistory} className={`btn-ghost p-1 ${historyOpen ? 'text-accent' : ''}`} title="Past chats">
            <Clock size={14} />
          </button>
          {historyOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 max-h-72 overflow-y-auto bg-surface-200 border border-surface-50 rounded shadow-lg z-20">
              {historyLoading && <div className="p-2 text-[11px] text-gray-500">Loading…</div>}
              {!historyLoading && historySessions.length === 0 && (
                <div className="p-2 text-[11px] text-gray-500">No past chats yet.</div>
              )}
              {!historyLoading && historySessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openPastSession(s)}
                  className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-surface-300 truncate block"
                  title={s.title ?? 'New chat'}
                >
                  {s.title ?? 'New chat'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {banner && (
        <div className="text-[11px] text-amber-600 bg-amber-500/10 px-2 py-1 flex-shrink-0">{banner}</div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
        {activeTab && activeTab.messages.length === 0 && (
          <div className="text-center text-gray-600 mt-4 px-4">
            <Bot size={31} className="mx-auto mb-2 text-gray-700" />
            {activeConnection
              ? <p>Ask me anything about <span className="text-accent">{activeConnection.name}</span>.</p>
              : <><p>Ask me anything about your database.</p><p className="mt-1 text-gray-700">Select a connection first.</p></>
            }
          </div>
        )}
        {activeTab?.messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === 'user'
                  ? 'bg-accent/20 text-gray-800 dark:text-gray-200'
                  : 'bg-surface-300 text-gray-700 dark:text-gray-300'
              }`}
            >
              <p className="text-[11px] text-gray-600 mb-1">{formatChatTimestamp(msg.timestamp)}</p>
              {msg.role === 'assistant' ? (
                <div className="flex items-start gap-1.5">
                  <Bot size={14} className="flex-shrink-0 mt-0.5 text-gray-500" />
                  <div className="prose dark:prose-invert max-w-none leading-relaxed text-[13px]
                    prose-p:my-1 prose-pre:my-1 prose-pre:bg-transparent prose-pre:p-0
                    prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                    <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
        {activeTab?.loading && (
          <div className="flex justify-start">
            <div className="bg-surface-300 rounded-lg px-3 py-2 text-gray-500 flex items-center gap-1">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse delay-75">●</span>
              <span className="animate-pulse delay-150">●</span>
            </div>
          </div>
        )}

        {activeTab?.pendingPlan && (
          <div className="border border-accent/40 bg-accent/5 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Proposed changes — nothing has run yet
            </div>
            <ul className="space-y-1">
              {activeTab.pendingPlan.steps.map((step, i) => (
                <li key={i} className="text-[11px] font-mono bg-surface-300 rounded px-2 py-1 break-all">
                  {step.tool === 'create_database'
                    ? `create database '${step.db_name}'`
                    : step.sql}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1">
              <button
                onClick={approvePlan}
                disabled={planBusy}
                className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-white px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50"
              >
                {planBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Approve &amp; commit
              </button>
              <button
                onClick={rejectPlan}
                disabled={planBusy}
                className="flex items-center gap-1 bg-surface-300 hover:bg-surface-200 text-gray-700 dark:text-gray-300 px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50"
              >
                <Ban size={13} />
                Reject
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-2 border-t border-surface-50 flex-shrink-0">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={activeTab?.connectionId ? 'Ask about your data…' : 'Select a connection first'}
            disabled={!activeTab?.connectionId || !!activeTab?.loading}
            className="flex-1 bg-surface-300 text-gray-800 dark:text-gray-200 text-xs rounded px-2 py-1.5 border border-surface-50 focus:outline-none focus:border-accent disabled:opacity-50 placeholder-gray-500 dark:placeholder-gray-600"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || !activeTab?.connectionId || !!activeTab?.loading}
            className="btn-primary px-2 py-1.5"
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
