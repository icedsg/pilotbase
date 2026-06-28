import { create } from 'zustand'
import type { ChatMessage, DbConnection, QueryResult, UserSession } from '../types'

export interface ColumnViewContext {
  table: string
  connId: string
  db: string | null
  dbType: string
}

export interface AlterScriptEntry {
  ts: string
  sql: string
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
  setActiveQuery: (q: string) => void
  setActiveDatabase: (db: string | null) => void
  setQueryResult: (r: QueryResult | null) => void
  setQueryLoading: (v: boolean) => void

  // ── Column view / ALTER TABLE ─────────────────────────────────────
  columnViewContext: ColumnViewContext | null
  setColumnViewContext: (ctx: ColumnViewContext | null) => void
  alterScriptLog: AlterScriptEntry[]
  appendAlterScript: (sql: string) => void
  clearAlterScripts: () => void

  // ── AI Chat ──────────────────────────────────────────────────────
  chatMessages: ChatMessage[]
  chatLoading: boolean
  addChatMessage: (m: ChatMessage) => void
  setChatLoading: (v: boolean) => void
  clearChat: () => void

  // ── WebSocket ────────────────────────────────────────────────────
  wsConnected: boolean
  setWsConnected: (v: boolean) => void

  // ── Theme ────────────────────────────────────────────────────────
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

export const useStore = create<PilotbaseStore>((set) => ({
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
  setActiveQuery: (activeQuery) => set({ activeQuery }),
  setActiveDatabase: (activeDatabase) => set({ activeDatabase }),
  setQueryResult: (queryResult) => set({ queryResult }),
  setQueryLoading: (queryLoading) => set({ queryLoading }),

  // Column view / ALTER TABLE
  columnViewContext: null,
  setColumnViewContext: (columnViewContext) => set({ columnViewContext }),
  alterScriptLog: [],
  appendAlterScript: (sql) => set((s) => ({
    alterScriptLog: [...s.alterScriptLog, { ts: new Date().toLocaleTimeString(), sql }],
  })),
  clearAlterScripts: () => set({ alterScriptLog: [] }),

  // Chat
  chatMessages: [],
  chatLoading: false,
  addChatMessage: (m) => set((s) => ({ chatMessages: [...s.chatMessages, m] })),
  setChatLoading: (chatLoading) => set({ chatLoading }),
  clearChat: () => set({ chatMessages: [] }),

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
