import { type Nodes, utf8Bytes } from '@manuslip/core'
import { compactBindingBytes, compactTranslationUnit } from './compact-bindings'
import {
  TranslationError,
  type TranslationUnit,
  translationLimits,
  type UnitKind,
} from './contracts'
import type { ExtractionMemory } from './extraction-memory'
import { projectTranslationUnit } from './unit-projection'

export const translationUnitKinds = new Set(['paragraph', 'heading', 'tableCell', 'defListTerm'])

/** Shared native/packed unit semantics. The caller owns each input subtree and its projection workspace. */
export class UnitExtraction {
  #count = 0
  readonly #ids = new Set<string>()
  #payloadBytes = 0
  constructor(
    private readonly memory?: ExtractionMemory,
    private readonly beforeIdentity?: (bytes: number) => void,
  ) {}
  get count() {
    return this.#count
  }
  get payloadBytes() {
    return this.#payloadBytes
  }
  unit(
    node: Nodes,
    source: string,
    path: number[],
    depth: number,
    occurrence: (range: { from: number; to: number; kind: UnitKind }) => string,
  ): TranslationUnit | undefined {
    if (!translationUnitKinds.has(node.type)) throw new TranslationError('translation-invalid')
    const memory = this.memory
    const kind = node.type as UnitKind
    const from = node.position?.start.offset
    const to = node.position?.end.offset
    if (from === undefined || to === undefined || from < 0 || to > source.length || from > to)
      throw new TranslationError('translation-invalid')
    let projection: ReturnType<typeof projectTranslationUnit> | null = null
    try {
      projection = projectTranslationUnit(node, kind, source, depth, memory)
    } catch (error) {
      if (!(error instanceof TranslationError && error.code === 'translation-limit')) throw error
    }
    if (projection && !projection.prose) return undefined
    if (this.#count >= translationLimits.units) throw new TranslationError('translation-limit')
    const occurrenceId = occurrence({ from, to, kind })
    if (!occurrenceId || this.#ids.has(occurrenceId))
      throw new TranslationError('translation-invalid')
    const spelling = projection && !projection.large ? JSON.stringify(projection.payload) : ''
    const size = projection ? utf8Bytes(spelling) : 0
    const limited = !projection || projection.large || size > translationLimits.payload
    if (!limited) this.#payloadBytes += size
    if (this.#payloadBytes > translationLimits.plan) throw new TranslationError('translation-limit')
    memory?.charge(
      384 +
        occurrenceId.length * 2 +
        path.length * 8 +
        (projection && !limited
          ? memory?.compactBindings
            ? compactBindingBytes(projection.bindings.length)
            : projection.bindings.length * 104
          : 0),
    )
    this.beforeIdentity?.(96 + occurrenceId.length * 2)
    this.#ids.add(occurrenceId)
    if (memory && projection && !limited)
      projection.payload = memory.intern(projection.payload, spelling, projection.bindings)
    const unit: TranslationUnit = {
      occurrenceId,
      kind,
      from,
      to,
      path,
      payload: !limited && projection ? projection.payload : null,
      bindings: !limited && projection ? projection.bindings : [],
      error: limited ? 'translation-unit-large' : null,
    }
    this.#count++
    return memory?.compactBindings ? compactTranslationUnit(unit) : unit
  }
}
