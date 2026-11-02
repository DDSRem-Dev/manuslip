import { Text } from '@codemirror/state'
import { OwnedPackedPreview } from '../../../../apps/desktop/src/renderer/src/preview/packed-preparation'
import type { PackedCapture, PackedReadScope } from '../../../../packages/core/src/packing-capture'
import { PackedDocumentBaseline } from '../../../../packages/core/src/packing-document-baseline'
import type { PackedSerializedValue } from '../../../../packages/core/src/packing-serialize'
import { PackedSession } from '../../../../packages/core/src/packing-session'
import { type PackedIdentity, PackedSource } from '../../../../packages/core/src/packing-source'
import type { PackedValue } from '../../../../packages/core/src/packing-value'
import { PackedWordBaseline } from '../../../../packages/core/src/packing-word-baseline'
import type { PackedWork } from '../../../../packages/core/src/packing-work'
import type { RenderOptions } from '../../../../packages/renderer/src/index'
import { PackedProjectionBaseline } from '../../../../packages/renderer/src/packed-projection-baseline'
import {
  type PackedProjectionPrune,
  packedDocumentContextPrune,
} from '../../../../packages/renderer/src/packed-projection-definitions'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const capacity = { ...limits, bytes: 8 * MiB, retained: 64 * MiB, captures: 8, readers: 160 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
let owner: PackedSession | undefined
let capture: PackedCapture | undefined
let source: PackedSource | undefined
let documentBaseline: PackedDocumentBaseline | undefined
let projection: PackedProjectionBaseline | undefined
let words: PackedWordBaseline | undefined
let preview: OwnedPackedPreview | undefined
let serialized: PackedValue<PackedSerializedValue> | undefined
let busy = false
let pauseAtChunks = false
let chunkPaused = false
let resumeCancellation: (() => void) | undefined
const closed: object[] = []
const escapedScopes: PackedReadScope[] = []
const escapedContextPrunes: PackedProjectionPrune[] = []
function revoked(scope: PackedReadScope): boolean {
  try {
    scope.kind()
    return false
  } catch (error) {
    if (!(error instanceof Error) || !/released|expired/.test(error.message)) throw error
    return true
  }
}
const constructions: Record<string, number> = {}
const sampleConstructionSites = new URLSearchParams(location.search).has('construction-sites')
const constructionSites = new Map<string, number>()
let siteSampler = 0x1821abcd
Reflect.set(globalThis, '__packedMemoryCount', (kind: string) => {
  constructions[kind] = (constructions[kind] ?? 0) + 1
  if (sampleConstructionSites && kind === 'scope') {
    siteSampler ^= siteSampler << 13
    siteSampler ^= siteSampler >>> 17
    siteSampler ^= siteSampler << 5
    if ((siteSampler & 4095) === 0) {
      const stack = new Error('Scope construction sample').stack ?? 'unavailable'
      constructionSites.set(stack, (constructionSites.get(stack) ?? 0) + 1)
    }
  }
})
function resetConstructions() {
  for (const key of Object.keys(constructions)) constructions[key] = 0
  constructionSites.clear()
  siteSampler = 0x1821abcd
}
const producerMode = new URLSearchParams(location.search).has('producer')
const loader = producerMode
  ? undefined
  : new Worker(new URL('./loader.worker.ts', import.meta.url), { type: 'module' })
let producer: Worker | undefined
let producerPhase: string | undefined
let cancelProducer: (() => void) | undefined
let producerReport: Record<string, number> | undefined
async function load(url: string, text: string, pauseBeforeEncode = false): Promise<ArrayBuffer> {
  const worker = producerMode
    ? new Worker(new URL('./producer.worker.ts', import.meta.url), { type: 'module' })
    : loader
  if (!worker) throw new Error('Missing diagnostic worker')
  if (producerMode) {
    producer = worker
    producerPhase = 'starting'
    producerReport = undefined
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise((resolve, reject) => {
      let payload: ArrayBuffer | undefined
      timer = setTimeout(() => reject(new Error('Fixture transfer timed out')), 10000)
      cancelProducer = producerMode
        ? () => reject(new Error('Diagnostic producer cancelled'))
        : undefined
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(new Error(event.message))
      }
      worker.onmessage = (
        event: MessageEvent<{
          kind: string
          payload?: ArrayBuffer
          bytes?: number
          message?: string
          phase?: string
          producer?: Record<string, number>
        }>,
      ) => {
        if (event.data.kind === 'phase') {
          producerPhase = event.data.phase
          return
        }
        if (event.data.kind === 'payload') {
          payload = event.data.payload
          producerReport = event.data.producer
        } else {
          clearTimeout(timer)
          worker.onmessage = null
          worker.onerror = null
          if (event.data.kind !== 'detached' || event.data.bytes !== 0 || !payload)
            reject(new Error(event.data.message ?? 'Fixture payload was not detached'))
          else resolve(payload)
        }
      }
      const request = producerMode
        ? {
            kind: 'parse',
            sequence: 1,
            generation: 1,
            documentId: 'packed-renderer-memory',
            revision: 0,
            source: text,
            options,
            sentAt: performance.timeOrigin + performance.now(),
            ...(pauseBeforeEncode ? { pauseBeforeEncode: true } : {}),
          }
        : new URL(url, location.href).href
      worker.postMessage(request)
    })
  } finally {
    clearTimeout(timer)
    worker.onmessage = null
    worker.onerror = null
    if (producerMode) {
      worker.terminate()
      producer = undefined
      cancelProducer = undefined
      producerPhase = undefined
    }
  }
}
const observed = new Map<string, WeakRef<object>[]>()
let seen = new WeakSet<object>()
function watch(kind: string, value: unknown): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  let refs = observed.get(kind)
  if (!refs) {
    refs = []
    observed.set(kind, refs)
  }
  if (refs.length < 8) refs.push(new WeakRef(value))
}
Reflect.set(globalThis, '__packedMemoryObserve', watch)
const tasks = new MessageChannel()
let resume: (() => void) | undefined
tasks.port1.onmessage = () => {
  const next = resume
  resume = undefined
  next?.()
}
const yieldTask = () =>
  new Promise<void>((resolve) => {
    resume = resolve
    tasks.port2.postMessage(0)
  })
async function finish<T>(work: PackedWork<T>): Promise<T> {
  const started = performance.now()
  let batch = started,
    advances = 0,
    largestStepMs = 0,
    peakRetained = 0,
    peakStaging = 0
  try {
    while (true) {
      const start = performance.now()
      const next = work.next()
      largestStepMs = Math.max(largestStepMs, performance.now() - start)
      advances++
      const elapsed = performance.now() - batch
      const stats = next.done || elapsed >= 2 ? owner?.stats : undefined
      if (stats) {
        peakRetained = Math.max(peakRetained, stats.retainedBytes)
        peakStaging = Math.max(peakStaging, stats.readerStagingBytes + stats.preparingStagingBytes)
        if (peakRetained > capacity.retained || peakStaging > capacity.staging)
          throw new Error('Ownership budget exceeded')
      }
      if (next.done) {
        if (!next.value) throw new Error('Incomplete packed operation')
        lastWork = {
          advances,
          largestStepMs,
          wallMs: performance.now() - started,
          sampledPeakRetained: peakRetained,
          sampledPeakStaging: peakStaging,
        }
        return next.value
      }
      if (pauseAtChunks && observed.has('word-chunks')) {
        pauseAtChunks = false
        chunkPaused = true
        await new Promise<void>((resolve) => {
          resumeCancellation = resolve
        })
      }
      if (elapsed >= 2) {
        await yieldTask()
        batch = performance.now()
      }
    }
  } finally {
    work.return()
    closed.push(work)
  }
}
let lastWork:
  | {
      advances: number
      largestStepMs: number
      wallMs: number
      sampledPeakRetained: number
      sampledPeakStaging: number
    }
  | undefined
function current() {
  if (!owner || !capture || !source) throw new Error('No packed snapshot')
  return { owner, capture, source }
}
function stats() {
  return {
    owner: owner?.stats,
    busy,
    chunkPaused,
    ...(producerMode
      ? { producerPhase, producerRunning: producer !== undefined, producerReport }
      : {}),
    constructions: { ...constructions },
    ...(sampleConstructionSites
      ? {
          constructionSites: [...constructionSites]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 40)
            .map(([stack, samples]) => ({ stack, samples })),
        }
      : {}),
    closedHandles: closed.length,
    retainedChildScopes: escapedScopes.length,
    retainedContextPrunes: escapedContextPrunes.length,
    watched: Object.fromEntries(
      [...observed].map(([kind, refs]) => [
        kind,
        {
          observed: refs.length,
          alive: refs.reduce((count, ref) => count + Number(!!ref.deref()), 0),
        },
      ]),
    ),
  }
}
const diagnostic = {
  capacity,
  limits,
  options,
  stats,
  retainChildScopes() {
    if (busy) throw new Error('Diagnostic operation in progress')
    const { capture, source } = current()
    const selected = capture.reader.at(['document']).at(['root'])
    const items = selected.elements(['children'])
    const first = items.next()
    if (first.done) throw new Error('Missing diagnostic child')
    const child = first.value.at([]).at([])
    items.return()
    if (selected.kind() !== 'object' || !revoked(child))
      throw new Error('Composed child scope guard failed')
    escapedScopes.push(selected, child)
    closed.push(selected, child, items)
    const prune = packedDocumentContextPrune(
      capture,
      source,
      ['document', 'root'],
      limits,
      documentBaseline,
    )
    if (!prune?.(selected.at(['children', 0])))
      throw new Error('Missing diagnostic document context proof')
    escapedContextPrunes.push(prune)
    closed.push(prune)
    return stats()
  },
  armChunkCancellation() {
    if (busy || !documentBaseline || !projection || words)
      throw new Error('Cannot arm partial word-cache cancellation')
    pauseAtChunks = true
  },
  cancelAtChunks() {
    if (!busy || !chunkPaused || !resumeCancellation)
      throw new Error('No partial native chunks suspended')
    capture?.release()
    chunkPaused = false
    const resume = resumeCancellation
    resumeCancellation = undefined
    resume()
    return stats()
  },
  async open(text: string, identity: PackedIdentity, url: string) {
    if (busy || owner) throw new Error('Packed diagnostic already open')
    busy = true
    resetConstructions()
    observed.clear()
    seen = new WeakSet()
    lastWork = undefined
    pauseAtChunks = false
    chunkPaused = false
    resumeCancellation = undefined
    try {
      const bytes = await load(url, text)
      source = new PackedSource(identity, text)
      watch('source', source)
      owner = new PackedSession(capacity)
      const prepared = await finish(
        owner.prepareFullSteps(owner.beginPrepared(source), source.identity, bytes),
      )
      owner.commit(prepared)
      capture = owner.capture()
      if (bytes.byteLength !== 0) throw new Error('Packed admission did not transfer its input')
      return {
        ...stats(),
        work: lastWork,
        descriptors: capture.reader.length(['document', 'blocks']),
      }
    } finally {
      busy = false
    }
  },
  async producePending(text: string) {
    if (!producerMode || busy || !preview) throw new Error('Cannot start pending producer')
    busy = true
    try {
      await load('', text, true)
      throw new Error('Paused producer unexpectedly published output')
    } finally {
      busy = false
    }
  },
  cancelProducer() {
    if (!producer || producerPhase !== 'paused-native-snapshot' || !cancelProducer)
      throw new Error('No suspended native producer')
    cancelProducer()
  },
  async run(phase: 'document' | 'projection' | 'words' | 'preview' | 'serialize') {
    if (busy) throw new Error('Concurrent diagnostic operation')
    busy = true
    resetConstructions()
    try {
      const { capture, source } = current()
      if (phase === 'document') {
        if (documentBaseline) throw new Error('Duplicate document baseline')
        documentBaseline = await finish(
          PackedDocumentBaseline.create(capture, source, ['document'], limits),
        )
      } else if (phase === 'projection') {
        if (!documentBaseline || projection) throw new Error('Invalid projection phase')
        projection = await finish(
          PackedProjectionBaseline.create(capture, source, [], options, limits, documentBaseline),
        )
      } else if (phase === 'words') {
        if (!documentBaseline || words) throw new Error('Invalid word phase')
        words = await finish(
          PackedWordBaseline.create(capture, source, ['document'], limits, documentBaseline),
        )
      } else if (phase === 'preview') {
        if (!documentBaseline || !projection || !words || preview)
          throw new Error('Invalid preview phase')
        const text = Text.of(source.text.split('\n'))
        watch('editor-text', text)
        preview = await finish(
          OwnedPackedPreview.prepare(
            capture,
            source,
            text,
            [],
            options,
            { ...limits, retained: 32 * MiB },
            undefined,
            { document: documentBaseline, projection, words },
            true,
          ),
        )
        if (!preview.commit()) throw new Error('Preview commit refused')
      } else {
        if (!preview || serialized) throw new Error('Invalid serialization phase')
        const root = preview.captureRoot()
        if (!root) throw new Error('Missing complete root')
        try {
          serialized = await finish(
            root.capture.serialize(root.path, {
              bytes: 8 * MiB - 65536,
              workspace: 3 * MiB,
              nodes: 800000,
              depth: 128,
            }),
          )
          watch('serialized-payload', serialized.value.payload)
        } finally {
          root.capture.release()
        }
      }
      return {
        ...stats(),
        work: lastWork,
        preview: preview
          ? {
              cost: preview.cost,
              widgets: preview.model.blocks.length,
              status: preview.status,
            }
          : undefined,
        serializedBytes: serialized?.value.payload.byteLength,
      }
    } finally {
      busy = false
    }
  },
  dropBaselines() {
    if (busy) throw new Error('Diagnostic operation in progress')
    for (const cache of [documentBaseline, projection, words]) {
      cache?.close()
      if (cache) closed.push(cache)
    }
    documentBaseline = undefined
    projection = undefined
    words = undefined
    if (capture)
      for (const prune of escapedContextPrunes)
        if (prune(capture.reader) !== undefined)
          throw new Error('Closed document context proof survived cleanup')
    return stats()
  },
  encodedRoot() {
    if (busy || !serialized) throw new Error('No complete serialized root')
    const bytes = new Uint8Array(serialized.value.payload)
    let binary = ''
    for (let from = 0; from < bytes.length; from += 4096)
      binary += String.fromCharCode(...bytes.subarray(from, from + 4096))
    return btoa(binary)
  },
  clear() {
    if (busy) throw new Error('Diagnostic operation in progress')
    diagnostic.dropBaselines()
    serialized?.release()
    preview?.release()
    capture?.release()
    owner?.dispose()
    for (const scope of escapedScopes)
      if (!revoked(scope)) throw new Error('Retained child scope survived cleanup')
    const finalOwner = owner?.stats
    for (const handle of [serialized, preview, capture, owner]) if (handle) closed.push(handle)
    serialized = undefined
    preview = undefined
    capture = undefined
    source = undefined
    owner = undefined
    lastWork = undefined
    pauseAtChunks = false
    chunkPaused = false
    resumeCancellation = undefined
    return { ...stats(), finalOwner }
  },
}
declare global {
  interface Window {
    packedMemory: typeof diagnostic
  }
}
window.packedMemory = Object.freeze(diagnostic)
