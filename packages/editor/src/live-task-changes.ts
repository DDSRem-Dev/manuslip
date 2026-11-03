import { syntaxTree } from '@codemirror/language'
import type { Transaction } from '@codemirror/state'
import type { LiveModel } from './live-model'

// Match only the checkbox serialization emitted by the semantic renderer.
export function taskCheckboxes(html: string): { html: string; checked: boolean[] } {
  const checked: boolean[] = []
  return {
    html: html.replace(/<input type="checkbox"( checked)? disabled>/g, (_input, value) => {
      checked.push(Boolean(value))
      return '<input type="checkbox" disabled>'
    }),
    checked,
  }
}

/** A task's checked character changes neither source positions nor Markdown layout.
 * Keep the presentation current locally while the authoritative worker catches up.
 * Every other edit still invalidates the semantic model immediately.
 */
export function preserveTaskToggle(model: LiveModel, transaction: Transaction): LiveModel | null {
  const tree = syntaxTree(transaction.startState)
  const toggles = new Map<number, boolean>()
  let valid = true
  transaction.changes.iterChanges((from, to, nextFrom, nextTo, inserted) => {
    const marker = tree.resolveInner(from, 1)
    const value = inserted.toString()
    if (
      from !== nextFrom ||
      to !== nextTo ||
      to !== from + 1 ||
      !/^[ xX]$/.test(value) ||
      marker.name !== 'TaskMarker' ||
      marker.from !== from - 1 ||
      marker.to !== to + 1
    )
      valid = false
    else toggles.set(marker.from, value.toLowerCase() === 'x')
  })
  if (!valid || !toggles.size) return null
  const positions = [...toggles.keys()]
  let changed = false
  const blocks = model.blocks.map((block) => {
    if (!positions.some((from) => block.from <= from && from < block.to)) return block
    const markers: number[] = []
    tree.iterate({
      from: block.from,
      to: block.to,
      enter(node) {
        if (node.name === 'TaskMarker') markers.push(node.from)
      },
    })
    const inputs = taskCheckboxes(block.html)
    if (inputs.checked.length !== markers.length) {
      valid = false
      return block
    }
    let index = 0
    const html = inputs.html.replace(/<input type="checkbox" disabled>/g, (input) => {
      const marker = markers[index]
      const checked =
        (marker === undefined ? undefined : toggles.get(marker)) ?? inputs.checked[index]
      index++
      return checked ? '<input type="checkbox" checked disabled>' : input
    })
    if (html === block.html) return block
    changed = true
    return { ...block, html }
  })
  return valid ? (changed ? { ...model, blocks } : model) : null
}
