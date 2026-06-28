import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { getTypeCategories, type KnowledgeTypeEntry } from '../../knowledge'

interface Props {
  value: string
  onChange: (v: string) => void
  dbType: string
  autoFocus?: boolean
}

export default function TypeSelector({ value, onChange, dbType, autoFocus }: Props) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const [hovered, setHovered] = useState<KnowledgeTypeEntry | null>(null)
  const containerRef          = useRef<HTMLDivElement>(null)
  const searchRef             = useRef<HTMLInputElement>(null)

  const categories = getTypeCategories(dbType)

  const filtered = search.trim()
    ? categories
        .map(cat => ({
          ...cat,
          types: cat.types.filter(t => {
            const q = search.toLowerCase()
            return (
              t.name.toLowerCase().includes(q) ||
              t.aliases.some(a => a.toLowerCase().includes(q)) ||
              t.description.toLowerCase().includes(q)
            )
          }),
        }))
        .filter(cat => cat.types.length > 0)
    : categories

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
        setHovered(null)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30)
  }, [open])

  const pick = (entry: KnowledgeTypeEntry) => {
    onChange(entry.default_expr)
    setOpen(false)
    setSearch('')
    setHovered(null)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className={`flex items-stretch h-[22px] rounded border bg-surface-200 transition-colors ${open ? 'border-accent ring-1 ring-accent' : 'border-accent'}`}>
        <input
          className="flex-1 min-w-0 bg-transparent text-gray-200 px-1.5 text-xs font-mono outline-none"
          value={value}
          onChange={e => onChange(e.target.value)}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setOpen(p => !p)}
          className="flex-shrink-0 px-1.5 border-l border-accent/40 text-gray-500 hover:text-gray-200 hover:bg-surface-100 rounded-r transition-colors"
          title="Browse types"
        >
          <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-0.5 w-80 bg-surface-300 border border-surface-50 rounded shadow-xl flex flex-col"
          style={{ maxHeight: '340px' }}
        >
          {/* Search bar */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-surface-50 flex-shrink-0">
            <Search size={12} className="text-gray-600 flex-shrink-0" />
            <input
              ref={searchRef}
              className="flex-1 bg-transparent text-xs text-gray-200 outline-none placeholder-gray-600"
              placeholder={`Search ${dbType} types…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Type list */}
            <div className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-gray-600">No matching types</p>
              )}
              {filtered.map(cat => (
                <div key={cat.category}>
                  <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
                    {cat.category}
                  </div>
                  {cat.types.map(t => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => pick(t)}
                      onMouseEnter={() => setHovered(t)}
                      onMouseLeave={() => setHovered(null)}
                      className="w-full text-left px-3 py-1 text-xs hover:bg-surface-50 flex items-baseline gap-2 group"
                    >
                      <span className="font-mono text-gray-200 group-hover:text-accent transition-colors">
                        {t.name}
                      </span>
                      {t.params && (
                        <span className="text-gray-600 text-[11px] font-mono">{t.params}</span>
                      )}
                      {t.storage && (
                        <span className="ml-auto text-[10px] text-gray-700 flex-shrink-0">{t.storage}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Description tooltip panel */}
            {hovered && (
              <div className="w-44 flex-shrink-0 border-l border-surface-50 p-2 text-[11px] text-gray-400 overflow-y-auto">
                <p className="font-mono text-accent font-semibold mb-1">{hovered.name}</p>
                {hovered.aliases.length > 0 && (
                  <p className="text-gray-600 mb-1">
                    alias: {hovered.aliases.join(', ')}
                  </p>
                )}
                <p className="leading-relaxed">{hovered.description}</p>
                {hovered.min_version && (
                  <p className="mt-1 text-gray-600">
                    Since: v{hovered.min_version}
                  </p>
                )}
                {hovered.notes && (
                  <p className="mt-1 text-yellow-600 leading-relaxed">{hovered.notes}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
