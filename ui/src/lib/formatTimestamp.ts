export function formatChatTimestamp(d: Date, now: Date = new Date()): string {
  const isToday = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()

  if (isToday) {
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
    const diffHr = Math.round(diffMin / 60)
    return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d)
}
