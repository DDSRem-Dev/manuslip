import { StateEffect, StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

export interface LiveBlock {
  id: string
  from: number
  to: number
  kind: string
  html: string
  value: string
  syntax?: 'mermaid' | 'sequence' | 'flowchart'
  lines: number
}
export interface LiveModel {
  blocks: readonly LiveBlock[]
}
export function inlineProjection(kind: string): boolean {
  return [
    'inlineMath',
    'image',
    'link',
    'subscript',
    'superscript',
    'emoji',
    'footnoteReference',
  ].includes(kind)
}
export function proseProjection(kind: string): boolean {
  return ['paragraph', 'heading', 'blockquote', 'list', 'defList', 'footnoteDefinition'].includes(
    kind,
  )
}
export interface LiveOptions {
  sourceLabel(): string
  taskLabel(): string
  editTableLabel?(): string
  editTable?(block: LiveBlock): void
  render(container: HTMLElement, block: LiveBlock, signal: AbortSignal, measure: () => void): void
  openLink(url: string): void
}
export const setLiveModel = StateEffect.define<LiveModel | null>()
export const composingEffect = StateEffect.define<boolean>()
export const liveModel = StateField.define<LiveModel | null>({
  create: () => null,
  update: (model, transaction) => {
    if (transaction.docChanged) model = null
    for (const effect of transaction.effects) if (effect.is(setLiveModel)) model = effect.value
    return model
  },
})
export const isComposing = StateField.define<boolean>({
  create: () => false,
  update: (composing, transaction) => {
    for (const effect of transaction.effects)
      if (effect.is(composingEffect)) composing = effect.value
    return composing
  },
})

export function revealSource(view: EditorView, dom: HTMLElement): void {
  const anchor = view.posAtDOM(dom)
  view.dispatch({ selection: { anchor }, scrollIntoView: true })
  view.focus()
}
