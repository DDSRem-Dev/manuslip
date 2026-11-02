export type SlideBoundary = 'break' | 'heading' | 'content' | 'blank'

/** Explicit thematic breaks take precedence over level-one heading boundaries. */
export function slideGroups<T>(
  rows: readonly T[],
  boundary: (row: T) => SlideBoundary,
  maximum = 200,
): T[][] {
  const kinds = rows.map(boundary)
  const explicit = kinds.includes('break'),
    groups: T[][] = []
  let current: T[] = []
  function finish(): void {
    if (!current.length) return
    if (groups.length >= maximum) throw new Error('presentation-limit')
    groups.push(current)
    current = []
  }
  for (let index = 0; index < rows.length; index++) {
    const kind = kinds[index]
    if (kind === 'blank') continue
    if (kind === 'break') {
      finish()
      continue
    }
    if (!explicit && kind === 'heading') finish()
    current.push(rows[index] as T)
  }
  finish()
  if (!groups.length) throw new Error('presentation-empty')
  return groups
}
