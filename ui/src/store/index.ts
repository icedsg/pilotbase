import { create } from 'zustand'
import type { ChatMessage, DbConnection, QueryHistoryEntry, QueryResult, UserSession } from '../types'

const MAX_QUERY_HISTORY = 500

export interface ColumnViewContext {
  table: string
  connId: string
  db: string | null
  dbType: string
}

export interface VectorViewContext {
  collection: string
  connId: string
  db: string
  dbType: string
  totalCount?: number | null
}

export interface NoSQLViewContext {
  collection: string
  connId: string
  db: string
  dbType: string
}

export interface MigrationViewContext {
  sourceConnId: string
  sourceDb: string | null
  targetConnId: string
  targetDb: string | null
}

export interface AlterScriptEntry {
  ts: string
  sql: string
  executed?: boolean
}

export interface PlanStep {
  tool: string
  sql?: string
  db_name?: string
}

export interface PendingPlan {
  planId: string
  steps: PlanStep[]
  summary: string
}

export const MAX_CHAT_TABS = 3

export interface ChatTab {
  tabId: string                 // client-generated, stable for the tab's lifetime
  sessionId: string | null      // null until the server resolves/creates one on first message
  connectionId: string | null   // captured at tab-open time
  title: string | null          // mirrors ChatSession.title; UI falls back to 'New chat' while null
  messages: ChatMessage[]
  loading: boolean
  pendingPlan: PendingPlan | null
}

interface PilotbaseStore {
  // ── User session ─────────────────────────────────────────────────
  session: UserSession | null
  setSession: (s: UserSession | null) => void

  // ── Connections ──────────────────────────────────────────────────
  connections: DbConnection[]
  activeConnectionId: string | null
  setConnections: (c: DbConnection[]) => void
  addConnection: (c: DbConnection) => void
  updateConnection: (c: DbConnection) => void
  removeConnection: (id: string) => void
  setActiveConnection: (id: string | null) => void

  // ── Query editor ─────────────────────────────────────────────────
  activeQuery: string
  activeDatabase: string | null
  queryResult: QueryResult | null
  queryLoading: boolean
  sqlPanelOpen: boolean
  setActiveQuery: (q: string) => void
  setActiveDatabase: (db: string | null) => void
  setQueryResult: (r: QueryResult | null) => void
  setQueryLoading: (v: boolean) => void
  setSqlPanelOpen: (v: boolean) => void

  // ── Column view / ALTER TABLE ─────────────────────────────────────
  columnViewContext: ColumnViewContext | null
  setColumnViewContext: (ctx: ColumnViewContext | null) => void
  alterScriptLog: AlterScriptEntry[]
  appendAlterScript: (sql: string, executed?: boolean) => void
  clearAlterScripts: () => void
  sqlLogPanelOpen: boolean
  setSqlLogPanelOpen: (v: boolean) => void

  // ── Vector DB view ────────────────────────────────────────────────
  vectorViewContext: VectorViewContext | null
  setVectorViewContext: (ctx: VectorViewContext | null) => void

  // ── NoSQL view ────────────────────────────────────────────────────
  nosqlViewContext: NoSQLViewContext | null
  setNosqlViewContext: (ctx: NoSQLViewContext | null) => void

  // ── Migration compare view ────────────────────────────────────────
  migrationViewContext: MigrationViewContext | null
  setMigrationViewContext: (ctx: MigrationViewContext | null) => void

  // ── Query history (executed scripts, any source) ──────────────────
  queryHistory: QueryHistoryEntry[]
  setQueryHistory: (entries: QueryHistoryEntry[]) => void
  addQueryHistoryEntry: (entry: QueryHistoryEntry) => void
  clearQueryHistory: () => void

  // ── AI Chat (multi-tab, max MAX_CHAT_TABS open at once) ────────────
  chatTabs: ChatTab[]
  activeTabId: string | null
  pendingRequests: Record<string, string>   // request_id -> tabId, for WS routing
  openNewChatTab: (connectionId: string | null) => string | null   // null if already at MAX_CHAT_TABS
  closeChatTab: (tabId: string) => void
  setActiveChatTab: (tabId: string) => void
  addTabMessage: (tabId: string, m: ChatMessage) => void
  setTabMessages: (tabId: string, messages: ChatMessage[]) => void
  setTabLoading: (tabId: string, v: boolean) => void
  setTabPendingPlan: (tabId: string, p: PendingPlan | null) => void
  setTabConnection: (tabId: string, connectionId: string | null) => void
  bindTabSession: (tabId: string, sessionId: string, title: string | null) => void
  clearTabMessages: (tabId: string) => void
  registerPendingRequest: (requestId: string, tabId: string) => void
  resolveTabForRequest: (requestId: string | null | undefined, sessionId: string | null | undefined) => string | null

  // ── WebSocket ────────────────────────────────────────────────────
  wsConnected: boolean
  setWsConnected: (v: boolean) => void

  // ── Theme ────────────────────────────────────────────────────────
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

export const useStore = create<PilotbaseStore>((set, get) => ({
  // Session
  session: null,
  setSession: (session) => set({ session }),

  // Connections
  connections: [],
  activeConnectionId: null,
  setConnections: (connections) => set({ connections }),
  addConnection: (c) => set((s) => ({ connections: [...s.connections, c] })),
  updateConnection: (c) =>
    set((s) => ({ connections: s.connections.map((x) => (x.id === c.id ? c : x)) })),
  removeConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
    })),
  setActiveConnection: (activeConnectionId) => set({ activeConnectionId }),

  // Query
  activeQuery: '',
  activeDatabase: null,
  queryResult: null,
  queryLoading: false,
  sqlPanelOpen: false,
  setActiveQuery: (activeQuery) => set({ activeQuery }),
  setActiveDatabase: (activeDatabase) => set({ activeDatabase }),
  setQueryResult: (queryResult) => set({ queryResult }),
  setQueryLoading: (queryLoading) => set((s) => ({ queryLoading, sqlPanelOpen: queryLoading || s.sqlPanelOpen })),
  setSqlPanelOpen: (sqlPanelOpen) => set({ sqlPanelOpen }),

  // Column view / ALTER TABLE
  columnViewContext: null,
  setColumnViewContext: (columnViewContext) => set({ columnViewContext }),
  alterScriptLog: [],
  appendAlterScript: (sql, executed) => set((s) => ({
    alterScriptLog: [...s.alterScriptLog, { ts: new Date().toLocaleTimeString(), sql, executed }],
    sqlLogPanelOpen: true,
  })),
  clearAlterScripts: () => set({ alterScriptLog: [] }),
  sqlLogPanelOpen: false,
  setSqlLogPanelOpen: (sqlLogPanelOpen) => set({ sqlLogPanelOpen }),

  // Vector DB view
  vectorViewContext: null,
  setVectorViewContext: (vectorViewContext) => set({ vectorViewContext }),

  // NoSQL view
  nosqlViewContext: null,
  setNosqlViewContext: (nosqlViewContext) => set({ nosqlViewContext }),

  // Migration compare view
  migrationViewContext: null,
  setMigrationViewContext: (migrationViewContext) => set({ migrationViewContext }),

  // Query history
  queryHistory: [],
  setQueryHistory: (queryHistory) => set({ queryHistory }),
  addQueryHistoryEntry: (entry) => set((s) => {
    if (s.queryHistory.some((e) => e.id === entry.id)) return s
    return { queryHistory: [entry, ...s.queryHistory].slice(0, MAX_QUERY_HISTORY) }
  }),
  clearQueryHistory: () => set({ queryHistory: [] }),

  // Chat (multi-tab)
  chatTabs: [],
  activeTabId: null,
  pendingRequests: {},
  openNewChatTab: (connectionId) => {
    let newTabId: string | null = null
    set((s) => {
      if (s.chatTabs.length >= MAX_CHAT_TABS) return s
      newTabId = crypto.randomUUID()
      const tab: ChatTab = {
        tabId: newTabId, sessionId: null, connectionId, title: null,
        messages: [], loading: false, pendingPlan: null,
      }
      return { chatTabs: [...s.chatTabs, tab], activeTabId: newTabId }
    })
    return newTabId
  },
  closeChatTab: (tabId) => set((s) => {
    const chatTabs = s.chatTabs.filter((t) => t.tabId !== tabId)
    const activeTabId = s.activeTabId === tabId
      ? (chatTabs[chatTabs.length - 1]?.tabId ?? null)
      : s.activeTabId
    return { chatTabs, activeTabId }
  }),
  setActiveChatTab: (tabId) => set({ activeTabId: tabId }),
  addTabMessage: (tabId, m) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, messages: [...t.messages, m] } : t),
  })),
  setTabMessages: (tabId, messages) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, messages } : t),
  })),
  setTabLoading: (tabId, loading) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, loading } : t),
  })),
  setTabPendingPlan: (tabId, pendingPlan) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, pendingPlan } : t),
  })),
  setTabConnection: (tabId, connectionId) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, connectionId } : t),
  })),
  bindTabSession: (tabId, sessionId, title) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, sessionId, title: t.title ?? title } : t),
  })),
  clearTabMessages: (tabId) => set((s) => ({
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, messages: [] } : t),
  })),
  registerPendingRequest: (requestId, tabId) => set((s) => ({
    pendingRequests: { ...s.pendingRequests, [requestId]: tabId },
  })),
  resolveTabForRequest: (requestId, sessionId) => {
    const s = get()
    if (requestId && s.pendingRequests[requestId]) {
      const tabId = s.pendingRequests[requestId]
      const { [requestId]: _discard, ...rest } = s.pendingRequests
      set({ pendingRequests: rest })
      return tabId
    }
    if (sessionId) {
      const tab = s.chatTabs.find((t) => t.sessionId === sessionId)
      if (tab) return tab.tabId
    }
    return null
  },

  // WebSocket
  wsConnected: false,
  setWsConnected: (wsConnected) => set({ wsConnected }),

  // Theme
  theme: (localStorage.getItem('pilotbase_theme') as 'dark' | 'light') || 'dark',
  toggleTheme: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('pilotbase_theme', next)
    return { theme: next }
  }),
}))
