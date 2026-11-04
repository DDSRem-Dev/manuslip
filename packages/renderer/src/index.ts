import type { MarkdownPlugins, Nodes, Root } from '@manuslip/core'
import type { Element, Root as HastRoot } from 'hast'
import type { DiagramSyntax } from './diagram'
import { projectWithHandlers } from './projection-engine'

export { safeImage, safeLink } from './urls'
export const rendererVersion = 'mdast-hast13-html9/policy10-conventions5'
export interface RenderOptions {
  plugins?: MarkdownPlugins
  rawHtml: boolean
  footnotesLabel: string
  footnoteBackLabel: string
}
export interface RenderedBlock {
  kind:
    | 'defList'
    | 'paragraph'
    | 'heading'
    | 'blockquote'
    | 'list'
    | 'footnoteReference'
    | 'footnoteDefinition'
    | 'table'
    | 'code'
    | 'diagram'
    | 'math'
    | 'inlineMath'
    | 'image'
    | 'link'
    | 'html'
    | 'subscript'
    | 'superscript'
    | 'emoji'
  from: number
  to: number
  html: string
  value: string
  syntax?: DiagramSyntax
  placement?: 'after-document'
  listStart?: number
}
export type ProjectionDescription = Pick<RenderedBlock, 'kind' | 'value' | 'syntax' | 'placement'>
export interface RenderProjection {
  html: string
  blocks: RenderedBlock[]
  renderMs: number
  rendererVersion: string
}
/** Synchronous caller-admitted inline replacement, consumed before returning to the caller. */
export type ProjectionChildren = (node: Nodes) => Nodes[] | undefined

/** Pure serialization, also used in workers/export. Every DOM sink must additionally sanitize. */
export function renderMarkdown(root: Root, options: RenderOptions): RenderProjection {
  return projectMarkdown(root, options)
}
export function projectMarkdown(
  root: Root,
  options: RenderOptions,
  exportSlot?: (element: Element, description: ProjectionDescription) => void,
  decorate?: (tree: HastRoot) => void,
  children?: ProjectionChildren,
  serialize?: (tree: HastRoot) => string,
): RenderProjection {
  return projectWithHandlers(root, options, exportSlot, decorate, {}, children, serialize)
}
