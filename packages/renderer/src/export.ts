import type { Root } from '@manuslip/core'
import type { Element, Root as HastRoot } from 'hast'
import type { ProjectionDescription } from './index'
import type { DiagramSyntax } from './diagram'
import { type ProjectionChildren, projectMarkdown, type RenderOptions } from './index'

export interface ExportSlot {
  id: string
  kind: 'math' | 'diagram'
  source: string
  display: boolean
  syntax?: DiagramSyntax
}
export interface ExportProjection {
  html: string
  slots: ExportSlot[]
}
/** One sink per language copy; numbering continues across sequenced blocks/footer. */
export function exportSlotSink(namespace: string, slots: ExportSlot[]) {
  return (element: Element, description: ProjectionDescription): void => {
    if (!['math', 'inlineMath', 'diagram'].includes(description.kind)) return
    if (description.kind === 'diagram' && element.tagName !== 'pre') return
    if (description.kind === 'inlineMath' && element.tagName !== 'code') return
    if (description.kind === 'math' && !['pre', 'code'].includes(element.tagName)) return
    const id = `${namespace}-${slots.length}`
    const display = description.kind !== 'inlineMath'
    slots.push({
      id,
      kind: description.kind === 'diagram' ? 'diagram' : 'math',
      source: description.value,
      display,
      ...(description.syntax ? { syntax: description.syntax } : {}),
    })
    element.tagName = display ? 'div' : 'span'
    element.properties = { dataExportSlot: id }
    element.children = []
  }
}
/** Shares the complete-root projection with preview; only heavy-render sinks become slots. */
export function renderExport(
  root: Root,
  options: RenderOptions,
  namespace = 'slot',
  decorate?: (tree: HastRoot) => void,
  children?: ProjectionChildren,
  serialize?: (tree: HastRoot) => string,
): ExportProjection {
  const slots: ExportSlot[] = []
  const result = projectMarkdown(
    root,
    options,
    exportSlotSink(namespace, slots),
    decorate,
    children,
    serialize,
  )
  return { html: result.html, slots }
}
