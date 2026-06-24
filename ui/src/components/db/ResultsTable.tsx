import { Download, AlertCircle, CheckCircle } from 'lucide-react'
import { useStore } from '../../store'

function downloadCsv(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(',')
  const body = rows.map((r) =>
    columns.map((c) => {
      const val = r[c]
      const s = val === null ? '' : String(val)
      return s.includes(',') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  ).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pilotbase_result.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function ResultsTable() {
  const { queryResult, queryLoading } = useStore()

  if (queryLoading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-500">
        <span className="animate-pulse">Running query…</span>
      </div>
    )
  }

  if (!queryResult) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-600">
        Results will appear here
      </div>
    )
  }

  const hasError = (queryResult as any).error

  if (hasError) {
    return (
      <div className="h-full p-4">
        <div className="flex items-start gap-2 text-red-400 text-xs">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap font-mono">{(queryResult as any).error}</pre>
        </div>
      </div>
    )
  }

  if (queryResult.columns.length === 0) {
    return (
      <div className="h-full flex items-center gap-2 justify-center text-xs text-green-400">
        <CheckCircle size={14} />
        <span>
          Query executed. {queryResult.affected !== undefined ? `${queryResult.affected} row(s) affected.` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-surface-200">
      {/* Results toolbar */}
      <div className="flex items-center justify-between px-3 py-1 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        <span className="text-xs text-gray-500">
          {queryResult.row_count} row{queryResult.row_count !== 1 ? 's' : ''}
          {queryResult.truncated && <span className="text-yellow-500 ml-2">(truncated to 1000)</span>}
        </span>
        <button
          onClick={() => downloadCsv(queryResult.columns, queryResult.rows)}
          className="btn-ghost flex items-center gap-1 text-xs"
        >
          <Download size={12} />
          CSV
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full text-xs font-mono">
          <thead className="sticky top-0 bg-surface-300 z-10">
            <tr>
              <th className="px-3 py-1.5 text-left text-[11px] text-gray-500 font-normal border-b border-r border-surface-50 w-10 select-none">
                #
              </th>
              {queryResult.columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-1.5 text-left text-[11px] text-gray-600 dark:text-gray-400 font-medium border-b border-r border-surface-50 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queryResult.rows.map((row, i) => (
              <tr
                key={i}
                className="hover:bg-surface-50 transition-colors"
              >
                <td className="px-3 py-1 text-gray-600 border-b border-r border-surface-50 select-none text-right">
                  {i + 1}
                </td>
                {queryResult.columns.map((col) => {
                  const val = row[col]
                  const isNull = val === null
                  return (
                    <td
                      key={col}
                      className={`px-3 py-1 border-b border-r border-surface-50 max-w-xs truncate ${
                        isNull ? 'text-gray-500 italic' : 'text-gray-700 dark:text-gray-300'
                      }`}
                      title={isNull ? 'NULL' : String(val)}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
