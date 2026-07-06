import { create } from 'zustand'
import type {
  ChatMessage, DbConnection, QueryHistoryEntry, QueryResult, UserSession,
  MigrationObjectPick, MigrationPlanObject, MigrationJobState, MigrationJobStep,
} from '../types'

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

export type MigrationStep = 'objects' | 'review' | 'running'

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

// ── Main area tabs ──────────────────────────────────────────────────────────
// Query/vector/nosql/migration views all live as tabs so switching connections
// or between views never destroys in-progress work (see MainTabBar/MainArea).

export type MainTabKind = 'query' | 'vector' | 'nosql' | 'migration'

interface MainTabBase {
  id: string
}

export interface QueryTab extends MainTabBase {
  kind: 'query'
  connectionId: string
  database: string | null
  query: string
  result: QueryResult | null
  loading: boolean
  sqlPanelOpen: boolean
  columnViewContext: ColumnViewContext | null
}

export interface VectorTab extends MainTabBase {
  kind: 'vector'
  context: VectorViewContext
}

export interface NoSQLTab extends MainTabBase {
  kind: 'nosql'
  context: NoSQLViewContext
}

export interface MigrationTab extends MainTabBase {
  kind: 'migration'
  sourceConnId: string
  sourceDb: string | null
  targetConnId: string
  targetDb: string | null
  step: MigrationStep
  migrationKind?: 'sql' | 'mongo'
  scope?: 'schema' | 'schema_data'
  objects?: MigrationObjectPick[]
  plan?: MigrationPlanObject[]
  job?: MigrationJobState | null
  checking: boolean
}

export type MainTab = QueryTab | VectorTab | NoSQLTab | MigrationTab

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

  // ── Main area tabs (query / vector / nosql / migration) ────────────
  mainTabs: MainTab[]
  activeMainTabId: string | null
  ensureQueryTab: (connectionId: string) => string
  focusConnectionQueryTab: (connectionId: string) => string
  updateQueryTab: (tabId: string, patch: Partial<QueryTab>) => void
  openVectorTab: (ctx: VectorViewContext) => string
  openNoSQLTab: (ctx: NoSQLViewContext) => string
  openMigrationTab: (args: { sourceConnId: string; sourceDb: string | null; targetConnId: string; targetDb: string | null }) => string
  updateMigrationTab: (tabId: string, patch: Partial<MigrationTab>) => void
  setMigrationTabJob: (tabId: string, job: MigrationJobState | null) => void
  patchMigrationTabJobStep: (tabId: string, jobId: string, stepKey: string, patch: Partial<MigrationJobStep>) => void
  closeMainTab: (tabId: string) => void
  setActiveMainTab: (tabId: string) => void

  // ── Alter-script audit log (cross-connection) ──────────────────────
  alterScriptLog: AlterScriptEntry[]
  appendAlterScript: (sql: string, executed?: boolean) => void
  clearAlterScripts: () => void
  sqlLogPanelOpen: boolean
  setSqlLogPanelOpen: (v: boolean) => void

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

function newQueryTab(connectionId: string): QueryTab {
  return {
    id: crypto.randomUUID(), kind: 'query', connectionId,
    database: null, query: '', result: null, loading: false,
    sqlPanelOpen: false, columnViewContext: null,
  }
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

  // Main area tabs
  mainTabs: [],
  activeMainTabId: null,
  ensureQueryTab: (connectionId) => {
    const existing = get().mainTabs.find((t): t is QueryTab => t.kind === 'query' && t.connectionId === connectionId)
    if (existing) return existing.id
    const tab = newQueryTab(connectionId)
    set((s) => ({ mainTabs: [...s.mainTabs, tab] }))
    return tab.id
  },
  focusConnectionQueryTab: (connectionId) => {
    const tabId = get().ensureQueryTab(connectionId)
    set({ activeMainTabId: tabId })
    return tabId
  },
  updateQueryTab: (tabId, patch) => set((s) => ({
    mainTabs: s.mainTabs.map((t) => {
      if (t.id !== tabId || t.kind !== 'query') return t
      // Starting a query run always reveals the editor/results panel — mirrors the
      // old global setQueryLoading behavior — unless the patch itself says otherwise.
      const sqlPanelOpen = 'sqlPanelOpen' in patch ? patch.sqlPanelOpen! : (patch.loading ? true : t.sqlPanelOpen)
      return { ...t, ...patch, sqlPanelOpen }
    }),
  })),
  openVectorTab: (ctx) => {
    const existing = get().mainTabs.find(
      (t): t is VectorTab => t.kind === 'vector' && t.context.connId === ctx.connId && t.context.db === ctx.db && t.context.collection === ctx.collection,
    )
    const tabId = existing ? existing.id : crypto.randomUUID()
    set((s) => ({
      mainTabs: existing
        ? s.mainTabs.map((t) => t.id === tabId ? { ...t, context: ctx } as VectorTab : t)
        : [...s.mainTabs, { id: tabId, kind: 'vector', context: ctx } as VectorTab],
      activeMainTabId: tabId,
    }))
    return tabId
  },
  openNoSQLTab: (ctx) => {
    const existing = get().mainTabs.find(
      (t): t is NoSQLTab => t.kind === 'nosql' && t.context.connId === ctx.connId && t.context.db === ctx.db && t.context.collection === ctx.collection,
    )
    const tabId = existing ? existing.id : crypto.randomUUID()
    set((s) => ({
      mainTabs: existing
        ? s.mainTabs.map((t) => t.id === tabId ? { ...t, context: ctx } as NoSQLTab : t)
        : [...s.mainTabs, { id: tabId, kind: 'nosql', context: ctx } as NoSQLTab],
      activeMainTabId: tabId,
    }))
    return tabId
  },
  openMigrationTab: ({ sourceConnId, sourceDb, targetConnId, targetDb }) => {
    const existing = get().mainTabs.find(
      (t): t is MigrationTab => t.kind === 'migration' && t.sourceConnId === sourceConnId && t.sourceDb === sourceDb
        && t.targetConnId === targetConnId && t.targetDb === targetDb,
    )
    if (existing) {
      set({ activeMainTabId: existing.id })
      return existing.id
    }
    const tab: MigrationTab = {
      id: crypto.randomUUID(), kind: 'migration', sourceConnId, sourceDb, targetConnId, targetDb,
      step: 'objects', checking: true,
    }
    set((s) => ({ mainTabs: [...s.mainTabs, tab], activeMainTabId: tab.id }))
    return tab.id
  },
  updateMigrationTab: (tabId, patch) => set((s) => ({
    mainTabs: s.mainTabs.map((t) => (t.id === tabId && t.kind === 'migration') ? { ...t, ...patch } : t),
  })),
  setMigrationTabJob: (tabId, job) => set((s) => ({
    mainTabs: s.mainTabs.map((t) => (t.id === tabId && t.kind === 'migration') ? { ...t, job } : t),
  })),
  patchMigrationTabJobStep: (tabId, jobId, stepKey, patch) => set((s) => ({
    mainTabs: s.mainTabs.map((t) => {
      if (t.id !== tabId || t.kind !== 'migration' || !t.job || t.job.jobId !== jobId) return t
      return { ...t, job: { ...t.job, steps: t.job.steps.map((step) => step.key === stepKey ? { ...step, ...patch } : step) } }
    }),
  })),
  closeMainTab: (tabId) => set((s) => {
    const mainTabs = s.mainTabs.filter((t) => t.id !== tabId)
    const activeMainTabId = s.activeMainTabId === tabId
      ? (mainTabs[mainTabs.length - 1]?.id ?? null)
      : s.activeMainTabId
    return { mainTabs, activeMainTabId }
  }),
  setActiveMainTab: (tabId) => set({ activeMainTabId: tabId }),

  // Alter-script audit log
  alterScriptLog: [],
  appendAlterScript: (sql, executed) => set((s) => ({
    alterScriptLog: [...s.alterScriptLog, { ts: new Date().toLocaleTimeString(), sql, executed }],
    sqlLogPanelOpen: true,
  })),
  clearAlterScripts: () => set({ alterScriptLog: [] }),
  sqlLogPanelOpen: false,
  setSqlLogPanelOpen: (sqlLogPanelOpen) => set({ sqlLogPanelOpen }),

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
    chatTabs: s.chatTabs.map((t) => t.tabId === tabId ? { ...t, sessionId: t.sessionId ?? sessionId, title: t.title ?? title } : t),
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
