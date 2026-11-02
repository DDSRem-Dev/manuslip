import {
  Compartment,
  createSourceState,
  EditorSelection,
  isComposing,
  type LiveBlock,
  type LiveModel,
  type LiveOptions,
  liveModel,
  livePreview,
  mountSourceEditor,
  setLiveModel,
} from '@manuslip/editor'
import { OwnedPackedPreview } from '../../../../apps/desktop/src/renderer/src/preview/packed-preparation'
import { renderWidget } from '../../../../apps/desktop/src/renderer/src/preview/widgets'
import type { Result } from '../../../../apps/desktop/src/shared/contracts'
import type { DiagramBridge } from '../../../../apps/desktop/src/shared/diagram-contracts'
import { sourceHash } from '../../../../packages/core/src/contracts'
import { packValue } from '../../../../packages/core/src/packing'
import { PackedSession } from '../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../packages/core/src/packing-source'
import { parseMarkdown } from '../../../../packages/core/src/parse'
import { rendererVersion } from '../../../../packages/renderer/src/index'
import { renderProjectionLayout } from '../../../../packages/renderer/src/projection-layout'
import { statusFixture } from './status'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const owner = new PackedSession({
  ...limits,
  retained: 64 * MiB,
  bytes: 8 * MiB,
  captures: 8,
  readers: 160,
})
const render = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const mode = new Compartment()
const contents: WeakRef<HTMLElement>[] = []
let aborted = 0
const links: string[] = []
let deferredImages = false
const images: { resolve(value: Result<string>): void; reject(error: Error): void }[] = []
const loadImage = () =>
  new Promise<Result<string>>((resolve, reject) => images.push({ resolve, reject }))
let deferredDiagrams = false
const diagrams: { resolve(value: Result<string>): void; reject(error: Error): void }[] = []
const cancellations: ((value: Result<null>) => void)[] = []
const diagramBridge: DiagramBridge = {
  renderDiagram: () => new Promise((resolve, reject) => diagrams.push({ resolve, reject })),
  cancelDiagram: () => new Promise((resolve) => cancellations.push(resolve)),
  onDiagramCapacity: () => () => {},
}
const options: LiveOptions = {
  sourceLabel: () => 'Reveal source',
  taskLabel: () => 'Toggle task',
  openLink: (url) => links.push(url),
  render: (content, block, signal, measure) => {
    contents.push(new WeakRef(content))
    // Keeping an aborted signal also keeps its default DOMException stack, which can
    // retain the widget that called abort(). Observe cancellation without owning it.
    signal.addEventListener('abort', () => aborted++, { once: true })
    renderWidget(
      content,
      block,
      signal,
      measure,
      deferredImages ? loadImage : undefined,
      undefined,
      deferredDiagrams ? { bridge: diagramBridge, documentId: 'browser-preview' } : undefined,
      false,
      current?.retain(),
    )
  },
}
let current: OwnedPackedPreview | undefined
const reactStatus = statusFixture(owner, () => current)
let revision = 0
const host = document.querySelector<HTMLElement>('#editor')
const status = document.querySelector<HTMLElement>('#status')
if (!host || !status) throw new Error('Missing fixture elements')
const view = mountSourceEditor(
  host,
  createSourceState('', {
    extensions: [liveModel, isComposing, mode.of(livePreview(options))],
    onUpdate: (update) => {
      for (const transaction of update.transactions)
        if (transaction.docChanged) {
          current?.map(transaction.changes)
          revision++
        }
    },
  }),
)

const refs: WeakRef<object>[] = []
function watchModel(model: LiveModel) {
  refs.push(new WeakRef(model), new WeakRef(model.blocks))
  for (const block of model.blocks) refs.push(new WeakRef(block))
}
const api = {
  reactStatus,
  setSource(text: string) {
    api.clear()
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: 0 },
    })
  },
  native(blocks: LiveBlock[]) {
    view.dispatch({ effects: setLiveModel.of({ blocks }) })
  },
  deferImages() {
    deferredImages = true
  },
  deferDiagrams() {
    deferredDiagrams = true
  },
  settleDiagrams(result: Result<string>, rejected = false) {
    for (const job of diagrams.splice(0)) {
      if (rejected) job.reject(new Error('Diagram bridge rejected'))
      else job.resolve(result)
    }
  },
  settleCancellations() {
    for (const resolve of cancellations.splice(0)) resolve({ ok: true, value: null })
  },
  settleImages(result: Result<string>, rejected = false) {
    for (const job of images.splice(0)) {
      if (rejected) job.reject(new Error('Image loader rejected'))
      else job.resolve(result)
    }
  },
  async owned() {
    const text = view.state.doc.toString(),
      document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(document.root, render, 8 * MiB)
    const source = new PackedSource(
      {
        generation: 1,
        revision,
        documentId: 'browser-preview',
        sourceHash: sourceHash(text),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(render),
      },
      text,
    )
    owner.commit(
      owner.prepareFull(
        owner.beginPrepared(source),
        source.identity,
        packValue({ snapshot: { document, projection, layout } }, 8 * MiB),
      ),
    )
    const capture = owner.capture()
    const work = OwnedPackedPreview.prepare(
      capture,
      source,
      view.state.doc,
      ['snapshot'],
      render,
      limits,
      current,
    )
    let next = work.next(),
      started = performance.now()
    while (!next.done) {
      if (performance.now() - started > 1) {
        await scheduler.yield()
        started = performance.now()
      }
      next = work.next()
    }
    const prepared = next.value
    if (!prepared?.commit()) throw new Error('Incomplete fixture preview')
    const old = current
    current = prepared
    view.dispatch({ effects: setLiveModel.of(prepared.model) })
    status.textContent = `${prepared.status.wordCount} words; ${prepared.status.characterCount} characters; ${prepared.status.outline.map((heading) => heading.text).join(', ')}`
    capture.release()
    old?.release()
    return owner.stats
  },
  observeCurrent() {
    if (!current) throw new Error('Missing current preview')
    watchModel(current.model)
    refs.push(new WeakRef(current.status), new WeakRef(current.status.outline))
    for (const heading of current.status.outline) refs.push(new WeakRef(heading))
    return refs.length
  },
  clear() {
    view.dispatch({ effects: setLiveModel.of(null) })
    status.textContent = ''
    current?.release()
    current = undefined
    owner.evict()
  },
  sourceMode() {
    view.dispatch({ effects: mode.reconfigure([]) })
  },
  liveMode() {
    view.dispatch({ effects: mode.reconfigure(livePreview(options)) })
  },
  select(ranges: [number, number][]) {
    view.dispatch({
      selection: EditorSelection.create(
        ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
      ),
    })
    view.focus()
  },
  selections() {
    return view.state.selection.ranges.map(({ anchor, head }) => [anchor, head])
  },
  counts() {
    return {
      mounts: contents.length,
      aborted,
      connected: contents.filter((content) => content.deref()?.isConnected).length,
      holds: owner.stats.holds,
      readers: owner.stats.readers,
      bytes: owner.stats.retainedBytes,
      links: [...links],
      images: images.length,
      diagrams: diagrams.length,
      cancellations: cancellations.length,
    }
  },
  collected() {
    return {
      observed: refs.length,
      alive: refs.filter((ref) => ref.deref()).length,
      retained: refs.flatMap((ref, index) => {
        const value = ref.deref()
        return value ? [{ index, kind: Reflect.get(value, 'kind') ?? value.constructor.name }] : []
      }),
    }
  },
  snapshot() {
    return {
      text: view.state.doc.toString(),
      selection: view.state.selection.main.anchor,
      ids: view.state.field(liveModel)?.blocks.map((block) => block.id) ?? [],
    }
  },
  async dispose() {
    reactStatus.dispose()
    api.clear()
    api.settleImages({ ok: false, error: 'Cancelled', code: 'cancelled' })
    view.destroy()
    const deadline = performance.now() + 10000
    while (owner.stats.holds) {
      if (performance.now() > deadline)
        throw new Error(`Unsettled widget borrowers: ${JSON.stringify(api.counts())}`)
      api.settleDiagrams({ ok: false, error: 'Cancelled', code: 'diagram-cancelled' })
      api.settleCancellations()
      // Teardown must also let worker messages, network tasks and watchdogs run.
      // Repeated user-visible scheduler tasks can starve those task queues.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    owner.dispose()
  },
}
declare global {
  interface Window {
    previewLifetime: typeof api
  }
}
window.previewLifetime = api
