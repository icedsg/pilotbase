/** Triggers a browser download for an in-memory Blob via a throwaway <a download> link. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [
    columns.map(csvCell).join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
  ].join('\r\n')
}

export function downloadCsv(columns: string[], rows: Record<string, unknown>[], filename = 'pilotbase_result.csv') {
  // The BOM makes Excel detect UTF-8 correctly instead of using the system code page.
  downloadBlob(new Blob(['\uFEFF', rowsToCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), filename)
}

export function downloadJson(rows: Record<string, unknown>[], filename = 'pilotbase_result.json') {
  downloadBlob(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' }), filename)
}
