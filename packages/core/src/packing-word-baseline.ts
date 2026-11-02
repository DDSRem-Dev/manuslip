import { semanticLimits } from './contracts'
import type { PackedCapture, PackedReadScope } from './packing-capture'
import type { PackedDocumentBaseline } from './packing-document-baseline'
import type { PackedRecordKey } from './packing-record-key'
import { type PackedSource, sameIdentity } from './packing-source'
import { packedTextStepCost } from './packing-text-stream'
import type { PackedRootValidationLimits } from './packing-validate-root'
import { validatePackedWords } from './packing-validate-words'
import { validationStreamLimits } from './packing-validation-read'
import type { PackedPath } from './packing-view'
import { PackedWordBuffer } from './packing-word-buffer'
import { type PackedWordCache, packedSubtreeWordTexts } from './packing-word-texts'
import type { PackedWork } from './packing-work'
import type { PackedWorkspace } from './packing-workspace'

const seal = Symbol('validated word baseline')
// Each row stores nodes, depth, text count, prose units, maximum leaf length,
// one-based first chunk and chunk count. A zero first chunk is an unfinished row.
const fields = 7
interface Data {
  capture: PackedCapture
  source: PackedSource
  records: Map<object, Map<number, number>>
  metadata: Uint32Array
  chunks: string[]
}
function* lifetime(baseline: PackedWordBaseline, hold: PackedWorkspace): Generator<void> {
  try {
    yield
    throw new Error('Word baseline lifetime is not a scheduler')
  } finally {
    try {
      baseline.close()
    } finally {
      hold.release()
    }
  }
}
function* inspection(
  active: Set<PackedWork<boolean>>,
  slot: { work?: PackedWork<boolean> },
  inspect: () => Generator<void>,
): Generator<void, boolean> {
  try {
    yield* inspect()
    return true
  } finally {
    if (slot.work) active.delete(slot.work)
  }
}
function record(scope: PackedReadScope): PackedRecordKey | undefined {
  const key = scope.recordKey()
  return key?.range === 0 ? key : undefined
}
// An escaped iterator retains only its revocable owner/key, never the private chunk list
// or typed table. Check the baseline on every advance, including the end-of-stream check.
function* chunkSteps(baseline: PackedWordBaseline, first: number, size: number): Generator<string> {
  for (let index = 0; index < size; index++) yield baseline.chunk(first + index)
  baseline.assertOpen()
}
// Keep the getter in a source-free factory frame. An escaped cache capability must not
// retain the private record/chunk array after its baseline is closed.
function capability(
  baseline: PackedWordBaseline,
  token: object,
  id: number,
  nodes: number,
  depth: number,
  texts: number,
  units: number,
  maximum: number,
): PackedWordCache {
  return Object.freeze({
    cached: true,
    nodes,
    depth,
    texts,
    units,
    maximum,
    get chunks() {
      return baseline.chunks(token, id)
    },
  })
}

/** Exact cached text-node preorder for immutable subtrees. Always rebuilds and segments
 * the complete current prose; no sum of block word counts or source-hash shortcut.
 * Chunks/metadata have their own admission and revoke with the borrowed capture.
 * Construction may reuse complete validation from the exact original document baseline;
 * all cache planning/copying/admission still runs independently.
 */
export class PackedWordBaseline {
  #data: Data | undefined
  #lifetime: PackedWork<void> | undefined
  readonly #active = new Set<PackedWork<boolean>>()
  private constructor(key: typeof seal, data: Data) {
    if (key !== seal) throw new Error('Invalid word baseline provenance')
    this.#data = data
  }
  static create(
    capture: PackedCapture,
    source: PackedSource,
    document: PackedPath,
    limits: PackedRootValidationLimits,
    documentBaseline?: PackedDocumentBaseline,
  ): PackedWork<PackedWordBaseline> {
    capture.reader.at(document)
    if (document.length > 63) throw new Error('Invalid word baseline path')
    const path = [...document],
      budget = { ...limits }
    return capture.work(
      (function* () {
        if (!documentBaseline?.validatesDocument(capture, source, path, budget))
          yield* validatePackedWords(capture, source, path, budget)
        const root = capture.reader.at([...path, 'root'])
        const size = root.length(['children'])
        // No per-record plan, entry or cached-value objects. One admitted typed table
        // serves planning and lookup. One flat chunk list replaces per-record arrays.
        // Per slot: 32 bytes for the 28-byte row and 160 for map membership.
        // Each namespace map adds 256 bytes; text/chunk-list slots are counted below.
        const scratch = 16384 + (budget.depth + 16) * 1024
        const fixed = scratch + size * 192
        if (
          size > semanticLimits.blocks ||
          fixed + (budget.depth + 8) * 512 > budget.retained ||
          scratch > budget.staging
        )
          throw new Error('Word baseline exceeds cache limit')
        const hold = capture.reserveWorkspace(fixed, scratch)
        let transferred = false
        const records = new Map<object, Map<number, number>>()
        const cachedChunks: string[] = []
        let bytes = fixed,
          namespaces = 0,
          largest = 0,
          visited = 1,
          planned = 0
        try {
          const metadata = new Uint32Array(size * fields)
          for (const child of root.elementSteps(['children'])) {
            if (child === undefined) {
              yield
              continue
            }
            const walk = { nodes: 0, depth: 0 }
            let texts = 0,
              units = 0,
              maximum = 0
            for (const text of packedSubtreeWordTexts(
              child,
              source.text.length,
              { nodes: budget.nodes - visited, depth: budget.depth - 1 },
              walk,
            )) {
              if (text !== undefined) {
                const length = text.textLength(['value'])
                maximum = Math.max(maximum, length)
                units += length + Number(texts++ > 0)
              }
              yield
            }
            visited += walk.nodes
            const key = record(child)
            if (key) {
              let table = records.get(key.token)
              if (!table) {
                if (fixed + (namespaces + 1) * 256 + (budget.depth + 8) * 512 > budget.retained)
                  throw new Error('Word baseline exceeds cache limit')
                bytes += 256
                hold.resize(fixed + ++namespaces * 256, scratch)
                table = new Map()
                records.set(key.token, table)
              }
              // A flush needs either 4096 units or 256 nonempty pieces, each >=1 unit.
              // Thus every completed chunk accounts for >=256 distinct prose units.
              const chunks = Math.floor(units / 256) + 1
              bytes += units * 2 + chunks * 128
              largest = Math.max(largest, PackedWordBuffer.bytes(units, texts, 0))
              if (
                bytes +
                  largest +
                  packedTextStepCost.retained +
                  packedTextStepCost.workspace +
                  (budget.depth + 8) * 512 >
                  budget.retained ||
                scratch + largest + packedTextStepCost.workspace + (budget.depth + 8) * 512 >
                  budget.staging
              )
                throw new Error(
                  `Word baseline exceeds cache limit: retained ${bytes + largest + packedTextStepCost.retained + packedTextStepCost.workspace + (budget.depth + 8) * 512}/${budget.retained}, staging ${scratch + largest + packedTextStepCost.workspace + (budget.depth + 8) * 512}/${budget.staging}`,
                )
              const offset = planned * fields
              metadata[offset] = walk.nodes
              metadata[offset + 1] = walk.depth
              metadata[offset + 2] = texts
              metadata[offset + 3] = units
              metadata[offset + 4] = maximum
              table.set(key.record, planned++)
            }
            yield
          }
          hold.resize(bytes, scratch)
          let index = 0
          for (const child of root.elementSteps(['children'])) {
            if (child === undefined) {
              yield
              continue
            }
            const key = record(child)
            if (!key) {
              yield
              continue
            }
            index++
            const row = records.get(key.token)?.get(key.record)
            if (row === undefined) throw new Error('Invalid word baseline plan')
            if (metadata[row * fields + 5]) {
              yield
              continue
            }
            const offset = row * fields,
              nodes = metadata[offset] ?? 0,
              depth = metadata[offset + 1] ?? 0,
              expectedTexts = metadata[offset + 2] ?? 0,
              units = metadata[offset + 3] ?? 0
            const copyBytes = PackedWordBuffer.bytes(units, expectedTexts, 0)
            if (scratch + copyBytes + packedTextStepCost.workspace > budget.staging)
              throw new Error('Word baseline exceeds cache limit')
            const copy = capture.workspace(copyBytes, copyBytes)
            let buffer: PackedWordBuffer | undefined
            try {
              buffer = PackedWordBuffer.create(units)
              let texts = 0
              for (const text of packedSubtreeWordTexts(
                child,
                source.text.length,
                { nodes, depth },
                { nodes: 0, depth: 0 },
              )) {
                if (text !== undefined) {
                  if (texts++ > 0) buffer.append(' ')
                  const cached = text.cachedText(['value'])
                  if (cached !== undefined) buffer.append(cached)
                  else
                    for (const chunk of text.textSteps(['value'], validationStreamLimits)) {
                      if (chunk !== undefined) buffer.append(chunk)
                      yield
                    }
                }
                yield
              }
              if (texts !== expectedTexts) throw new Error('Invalid word baseline text count')
              const chunks = buffer.finishChunks()
              metadata[offset + 5] = cachedChunks.length + 1
              metadata[offset + 6] = chunks.length
              for (const chunk of chunks) {
                cachedChunks.push(chunk)
                yield
              }
              yield
            } finally {
              buffer?.close()
              copy.release()
            }
          }
          if (index !== planned) throw new Error('Invalid word baseline cardinality')
          hold.resize(bytes, 0)
          const baseline = new PackedWordBaseline(seal, {
            capture,
            source,
            records,
            metadata,
            chunks: cachedChunks,
          })
          baseline.#lifetime = capture.work(lifetime(baseline, hold))
          baseline.#lifetime.next()
          transferred = true
          return baseline
        } finally {
          if (!transferred) {
            records.clear()
            cachedChunks.length = 0
            hold.release()
          }
        }
      })(),
    )
  }
  #current(): Data {
    const data = this.#data
    if (!data) throw new Error('Word baseline closed')
    data.capture.identity
    return data
  }
  compatible(capture: PackedCapture, source: PackedSource): boolean {
    if (!this.#data) return false
    const data = this.#current(),
      before = data.source.identity,
      after = source.identity
    return (
      data.capture.sameOwner(capture) &&
      capture.sourceResource === source &&
      before.generation === after.generation &&
      before.documentId === after.documentId &&
      before.parserVersion === after.parserVersion &&
      after.revision > before.revision
    )
  }
  /** Exact original source/owner, for synchronous fragment production over that base.
   * This does not broaden the later-revision validator's compatibility contract.
   */
  matchesBase(capture: PackedCapture): boolean {
    if (!this.#data) return false
    const data = this.#current()
    return (
      data.capture.sameOwner(capture) &&
      capture.sourceResource === data.source &&
      sameIdentity(capture.identity, data.source.identity)
    )
  }
  find(node: PackedReadScope): PackedWordCache | undefined {
    const data = this.#current(),
      key = record(node)
    const row = key ? data.records.get(key.token)?.get(key.record) : undefined
    const offset = (row ?? 0) * fields
    return key && row !== undefined && data.metadata[offset + 5]
      ? capability(
          this,
          key.token,
          key.record,
          data.metadata[offset] ?? 0,
          data.metadata[offset + 1] ?? 0,
          data.metadata[offset + 2] ?? 0,
          data.metadata[offset + 3] ?? 0,
          data.metadata[offset + 4] ?? 0,
        )
      : undefined
  }
  /** Internal admitted inspector access only. Retaining returned native chunks beyond
   * that inspection requires separate ownership, like other native-output inspectors.
   */
  chunks(token: object, id: number): Iterable<string> {
    const data = this.#current(),
      row = data.records.get(token)?.get(id)
    if (row === undefined) throw new Error('Missing word baseline record')
    const offset = row * fields,
      first = data.metadata[offset + 5] ?? 0,
      size = data.metadata[offset + 6] ?? 0
    if (!first) throw new Error('Missing word baseline chunks')
    return chunkSteps(this, first - 1, size)
  }
  /** Internal revocable iterator access; never returns the retained native list. */
  chunk(index: number): string {
    const data = this.#current()
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid word baseline chunk')
    const value = data.chunks[index]
    if (value === undefined) throw new Error('Incomplete word baseline chunks')
    return value
  }
  inspect(inspect: () => Generator<void>): PackedWork<boolean> {
    const data = this.#current(),
      slot: { work?: PackedWork<boolean> } = {}
    const work = data.capture.work(inspection(this.#active, slot, inspect))
    slot.work = work
    this.#active.add(work)
    return work
  }
  assertOpen(): void {
    this.#current()
  }
  close(): void {
    const work = this.#lifetime
    this.#lifetime = undefined
    this.#data?.records.clear()
    if (this.#data) this.#data.chunks.length = 0
    this.#data = undefined
    const active = [...this.#active]
    this.#active.clear()
    let failure: unknown
    for (const item of active) {
      try {
        item.return()
      } catch (error) {
        failure ??= error
      }
    }
    try {
      work?.return()
    } catch (error) {
      failure ??= error
    }
    if (failure) throw failure
  }
}
