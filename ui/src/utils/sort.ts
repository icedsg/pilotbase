export type SortDirection = 'asc' | 'desc' | null

/** Generic comparator for loosely-typed cell/field values (SQL cells, NoSQL fields, vector payload values). */
export function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull && bNull) return 0
  if (aNull) return -1
  if (bNull) return 1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1

  const aNum = typeof a !== 'object' && a !== '' && !isNaN(Number(a))
  const bNum = typeof b !== 'object' && b !== '' && !isNaN(Number(b))
  if (aNum && bNum) return Number(a) - Number(b)

  const aStr = typeof a === 'object' ? JSON.stringify(a) : String(a)
  const bStr = typeof b === 'object' ? JSON.stringify(b) : String(b)
  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' })
}

/** Sorts a copy of `items` by `getValue(item)` according to `direction`; returns `items` unchanged when direction is null. */
export function sortByDirection<T>(
  items: T[],
  getValue: (item: T) => unknown,
  direction: SortDirection,
): T[] {
  if (!direction) return items
  const sorted = [...items].sort((a, b) => compareValues(getValue(a), getValue(b)))
  return direction === 'desc' ? sorted.reverse() : sorted
}
