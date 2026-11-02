interface TabDocument {
  readonly id: string
  readonly title: string
  readonly path: string | null
}
export interface DocumentTabLabel {
  readonly title: string
  readonly context: string | null
  readonly label: string
}

/** Display-only paths. File identity and all commands continue to use the session ID.
 * Qualify colliding names with the shortest distinct parent below their common folder.
 * Splitting both separators handles Windows display paths without importing Node in UI.
 */
export function documentTabLabels(
  documents: readonly TabDocument[],
): ReadonlyMap<string, DocumentTabLabel> {
  const groups = new Map<string, TabDocument[]>()
  const labels = new Map<string, DocumentTabLabel>()
  for (const document of documents) {
    const group = groups.get(document.title)
    if (group) group.push(document)
    else groups.set(document.title, [document])
    labels.set(document.id, { title: document.title, context: null, label: document.title })
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const parents = group.flatMap((document) =>
      document.path === null
        ? []
        : [
            {
              document,
              parts: document.path.split(/[\\/]/).slice(0, -1),
            },
          ],
    )
    let common = parents.length > 1 ? (parents[0]?.parts.length ?? 0) : 0
    for (const parent of parents) {
      common = Math.min(common, parent.parts.length)
      for (let index = 0; index < common; index++)
        if (parent.parts[index] !== parents[0]?.parts[index]) {
          common = index
          break
        }
    }
    const relative = parents.map((parent) => ({ ...parent, parts: parent.parts.slice(common) }))
    for (const parent of relative) {
      let depth = 1
      while (
        depth < parent.parts.length &&
        relative.some(
          (other) =>
            other !== parent &&
            other.parts.slice(-depth).join('/') === parent.parts.slice(-depth).join('/'),
        )
      )
        depth++
      const context = parent.parts.slice(-depth).join('/') || '/'
      const { document } = parent
      labels.set(document.id, {
        title: document.title,
        context,
        label: `${document.title} — ${context}`,
      })
    }
  }
  return labels
}
