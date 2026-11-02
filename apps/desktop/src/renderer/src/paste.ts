import { utf8Bytes } from '@manuslip/core/text'
import {
  EditorSelection,
  type EditorState,
  EditorView,
  isolateHistory,
  type Text,
  type Transaction,
  type TransactionSpec,
} from '@manuslip/editor'
import type { AssetBridge } from '../../shared/asset-contracts'
import { preparePasteText } from './paste-text'
import { semanticMetric } from './semantics/metrics'
import { browserRuntime, SlicedWork, type SliceRuntime } from './semantics/sliced-work'

interface PasteAccess {
  id: string
  state(): EditorState
  canApply(): boolean
  named(): boolean
  save(): Promise<boolean>
  dispatch(spec: TransactionSpec): void
  status(pasting: boolean, error?: string): void
}
interface Pending {
  ranges: { from: number; to: number }[]
  main: number
  valid: boolean
  cancelled: boolean
  stop?: () => void
}

/** Tracks the original insertion ranges while conversion or Save As is in flight. */
export class DocumentPaste {
  private pending: Pending | null = null
  private plainUntil = 0
  constructor(
    private readonly document: PasteAccess,
    private readonly bridge: AssetBridge,
    private readonly runtime: SliceRuntime = browserRuntime,
  ) {}
  readonly extension = EditorView.domEventHandlers({
    keydown: (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v')
        this.plainUntil = Date.now() + 1000
      return false
    },
    paste: (event, view) => {
      const plain = this.plainUntil > Date.now()
      this.plainUntil = 0
      if (view.composing || view.state.readOnly || !this.document.canApply()) return false
      const text = event.clipboardData?.getData('text/plain') || ''
      const hasText = event.clipboardData?.types.includes('text/plain') || text.length > 0
      const image = [...(event.clipboardData?.items || [])].some(
        (item) => item.kind === 'file' && item.type.startsWith('image/'),
      )
      // A clipboard may offer text, HTML and an image for the same selection.
      // Always preserve its plain-text representation when one is available.
      const importImage = !plain && !hasText && image
      if (!importImage && text.length < 256 * 1024) return false
      event.preventDefault()
      if (this.pending) {
        this.document.status(true, 'paste-busy')
        return true
      }
      if (importImage && !event.isTrusted) {
        this.document.status(false, 'asset-capture')
        return true
      }
      void this.run(importImage ? { image: true } : { text })
      return true
    },
  })

  map(transactions: readonly Transaction[]): void {
    const pending = this.pending
    if (!pending?.valid) return
    for (const transaction of transactions) {
      if (!transaction.docChanged) continue
      for (const range of pending.ranges) {
        if (range.to > range.from && transaction.changes.touchesRange(range.from, range.to))
          pending.valid = false
        range.from = transaction.changes.mapPos(range.from, 1)
        range.to = Math.max(range.from, transaction.changes.mapPos(range.to, -1))
      }
      if (!pending.valid) pending.stop?.()
    }
  }
  cancel(): boolean {
    const pending = this.pending
    if (!pending) return false
    pending.valid = false
    pending.cancelled = true
    pending.stop?.()
    this.pending = null
    this.document.status(false)
    return true
  }
  async run(input: { html: string } | { image: true } | { text: string }): Promise<void> {
    if (this.pending || !this.document.canApply()) return
    const started = performance.now()
    const selection = this.document.state().selection
    const pending: Pending = {
      ranges: selection.ranges.map(({ from, to }) => ({ from, to })),
      main: selection.mainIndex,
      valid: true,
      cancelled: false,
    }
    this.pending = pending
    this.document.status(true)
    let captureId: string | null = null
    try {
      let insert: string | Text
      if ('text' in input) {
        const prepared = await new Promise<Text | null>((resolve, reject) => {
          const work = new SlicedWork<Text>(
            preparePasteText(input.text),
            {
              valid: () => {
                const valid = pending.valid && this.document.canApply()
                if (!valid) resolve(null)
                return valid
              },
              complete: resolve,
              finished: () => {},
              failed: reject,
              measured: (start) => semanticMetric('paste-prepare-slice', start),
            },
            this.runtime,
          )
          pending.stop = () => {
            work.cancel()
            resolve(null)
          }
          this.runtime.defer(work.run)
        })
        pending.stop = undefined
        if (!prepared) throw new Error('paste-interrupted')
        insert = prepared
        if (!insert.length) return
      } else if ('image' in input) {
        const captured = await this.bridge.captureClipboardImage(this.document.id)
        if (!captured.ok) throw new Error(captured.code || 'asset-capture')
        captureId = captured.value
        if (!pending.valid || !this.document.canApply()) throw new Error('paste-interrupted')
        if (!this.document.named() && !(await this.document.save())) return
        if (!this.document.named()) throw new Error('asset-save-first')
        if (!pending.valid || !this.document.canApply()) throw new Error('paste-interrupted')
        const imported = await this.bridge.importClipboardImage(this.document.id, captureId)
        if (!imported.ok) throw new Error(imported.code || 'file-io')
        insert = `![Image](${imported.value})`
      } else {
        if (utf8Bytes(input.html) > 1024 * 1024) throw new Error('paste-large')
        const converted = await this.bridge.convertClipboardHtml(this.document.id, input.html)
        if (!converted.ok) throw new Error(converted.code || 'paste-failed')
        insert = converted.value
        if (!insert) return
      }
      if (!pending.valid || !this.document.canApply()) throw new Error('paste-interrupted')
      pending.valid = false
      this.document.status(true)
      const state = this.document.state()
      // Match native plain-text paste: one clipboard line per captured selection when
      // their counts match. Slice the prepared Text so long lines stay in its rope.
      const byLine =
        'text' in input && typeof insert !== 'string' && insert.lines === pending.ranges.length
          ? insert
          : undefined
      const insertions = pending.ranges.map((range, index) => {
        const line = byLine?.line(index + 1)
        return { ...range, insert: byLine && line ? byLine.slice(line.from, line.to) : insert }
      })
      const changes = state.changes(insertions)
      this.document.dispatch({
        changes,
        selection: EditorSelection.create(
          insertions.map((range) =>
            EditorSelection.cursor(
              changes.mapPos(range.from, -1) + range.insert.length,
              byLine ? -1 : 0,
            ),
          ),
          pending.main,
        ),
        annotations: isolateHistory.of('full'),
        userEvent: 'input.paste',
        scrollIntoView: true,
      })
      semanticMetric('paste-commit', started)
    } catch (error) {
      if (pending.cancelled) return
      const code = error instanceof Error ? error.message : 'paste-failed'
      this.document.status(
        true,
        /^(?:paste|asset|file|workspace)-[a-z-]+$/.test(code) ? code : 'paste-failed',
      )
    } finally {
      if (captureId)
        await this.bridge.discardClipboardImage(this.document.id, captureId).catch(() => {})
      if (this.pending === pending) {
        this.pending = null
        this.document.status(false)
      }
    }
  }
}
