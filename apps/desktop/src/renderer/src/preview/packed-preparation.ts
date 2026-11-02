import { OccurrenceTracker, type Text } from '@manuslip/editor'
import type { RenderOptions } from '@manuslip/renderer'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import { finishPackedCleanup } from '../../../../../../packages/core/src/packing-cleanup'
import type {
  PackedIdentity,
  PackedSource,
} from '../../../../../../packages/core/src/packing-source'
import type { PackedRootValidationLimits } from '../../../../../../packages/core/src/packing-validate-root'
import type { PackedValue } from '../../../../../../packages/core/src/packing-value'
import type { PackedPath } from '../../../../../../packages/core/src/packing-view'
import type { PackedWork } from '../../../../../../packages/core/src/packing-work'
import {
  type PackedPreviewBaselines,
  type PreparedPackedPreviewInput,
  preparePackedPreviewInput,
} from '../../../../../../packages/renderer/src/packed-preview'
import { PackedCandidateStorage } from './packed-candidate-storage'
import { type PreparedPreview, preparePreview } from './preparation'

interface ModelState {
  tracker?: OccurrenceTracker
  prepared?: PreparedPreview
  readonly sourceLength: number
  readonly descriptors: number
  readonly bytes: number
  readonly identity: PackedIdentity
}
interface ReadyModelState extends ModelState {
  tracker: OccurrenceTracker
  prepared: PreparedPreview
}
function ready(state: ModelState): state is ReadyModelState {
  return state.prepared !== undefined && state.tracker !== undefined
}
type Input = PackedValue<PreparedPackedPreviewInput>

function retainPreview(
  input: Input,
  state: PackedValue<ModelState>,
  candidate?: PackedCandidateStorage,
): PackedPreviewLease {
  const ownedInput = input.retain()
  let ownedState: PackedValue<ModelState> | undefined,
    ownedCandidate: PackedCandidateStorage | undefined
  try {
    ownedState = state.retain()
    ownedCandidate = candidate?.retain()
    return new PackedPreviewLease(ownedInput, ownedState, ownedCandidate)
  } catch (error) {
    finishPackedCleanup([
      () => {
        throw error
      },
      () => ownedCandidate?.release(),
      () => ownedState?.release(),
      () => ownedInput.release(),
    ])
    throw error
  }
}

/** Read-only native consumer lifetime. It cannot map or commit the occurrence tracker.
 * Retaining charges independent handles in the same session; released handles clear all
 * native values. DOM and pending async callbacks must each keep a lease until use ends.
 */
export class PackedPreviewLease {
  #candidate: PackedCandidateStorage | undefined
  constructor(
    private readonly input: Input,
    private readonly state: PackedValue<ModelState>,
    candidate?: PackedCandidateStorage,
  ) {
    this.#candidate = candidate
    Object.freeze(this)
  }
  private current() {
    this.input.value
    const state = this.state.value
    if (!ready(state)) throw new Error('Incomplete packed preview model')
    return state
  }
  get model() {
    return this.current().prepared.model
  }
  get status() {
    return this.current().prepared.status
  }
  retain(): PackedPreviewLease {
    this.current()
    return retainPreview(this.input, this.state, this.#candidate)
  }
  release(): void {
    const candidate = this.#candidate
    this.#candidate = undefined
    finishPackedCleanup([
      () => this.state.release(),
      () => this.input.release(),
      () => candidate?.release(),
    ])
  }
}

/** Experimental controller lifetime. Consumers either end their native uses before
 * release or retain an independent read-only lease. Input and occurrence/model storage
 * stay admitted after capture closure. The controller uses this for bounded snapshots
 * from both the native and experimental packed Worker paths. Receiver certificates can
 * reuse complete validation of the exact immutable graph; native output stays admitted.
 */
export class OwnedPackedPreview {
  #version = 0
  #previous: { value: OwnedPackedPreview; version: number } | undefined
  #candidate: PackedCandidateStorage | undefined
  private constructor(
    private readonly input: Input,
    private readonly state: PackedValue<ModelState>,
    previous?: { value: OwnedPackedPreview; version: number },
    private root?: { capture: PackedCapture; path: PackedPath },
    candidate?: PackedCandidateStorage,
  ) {
    this.#previous = previous
    this.#candidate = candidate
  }
  get model() {
    return this.current().prepared.model
  }
  get status() {
    return this.current().prepared.status
  }
  get cost() {
    return (
      this.current().bytes + (this.#candidate?.bytes ?? 0) + this.input.value.cost.retainedBytes
    )
  }
  /** Control/status output is independently owned in the same session as the model. */
  reserveMetadata(bytes: number) {
    this.current()
    if (!this.root) throw new Error('Packed preview root ownership unavailable')
    return this.root.capture.own({}, bytes)
  }
  canFork(capture: PackedCapture): boolean {
    this.current()
    if (!this.root?.capture.sameOwner(capture)) return false
    const before = this.root.capture.identity,
      after = capture.identity
    return (
      before.revision <= after.revision &&
      (['generation', 'documentId', 'parserVersion', 'rendererVersion', 'options'] as const).every(
        (key) => before[key] === after[key],
      )
    )
  }
  retain(): PackedPreviewLease {
    this.current()
    return retainPreview(this.input, this.state, this.#candidate)
  }
  captureRoot(): { capture: PackedCapture; path: PackedPath } | undefined {
    this.current()
    return this.root ? { capture: this.root.capture.retain(), path: this.root.path } : undefined
  }
  private current() {
    this.input.value
    const state = this.state.value
    if (!ready(state)) throw new Error('Incomplete packed preview model')
    return state
  }
  private version(): number {
    this.current()
    return this.#version
  }
  private unchanged(version: number): boolean {
    try {
      return this.version() === version
    } catch {
      return false
    }
  }
  map(changes: Parameters<OccurrenceTracker['map']>[0]): void {
    this.current().tracker.map(changes)
    this.#version++
  }
  commit(): boolean {
    const state = this.current()
    const previous = this.#previous
    if (previous && !previous.value.unchanged(previous.version)) return false
    const accepted = state.prepared.commit()
    if (accepted) {
      // Only one replacement may commit against this predecessor version. The old
      // native model stays readable, but competing forks must prepare again.
      if (previous) previous.value.#version++
      this.#previous = undefined
      this.#version++
      this.#candidate?.commit()
    }
    return accepted
  }
  release(): void {
    const root = this.root,
      candidate = this.#candidate
    this.root = undefined
    this.#candidate = undefined
    this.#previous = undefined
    this.#version++
    finishPackedCleanup([
      () => root?.capture.release(),
      () => this.state.release(),
      () => this.input.release(),
      () => candidate?.release(),
    ])
  }

  /** The old model stays usable while its fork is prepared. Same-session ownership and
   * exact source checks are mandatory; capacity failures never replace the old model.
   * Construction admits both old/new index candidates and source storage. Commit ends
   * the old-range reservation; uncommitted read-only leases retain it independently.
   * These remain experimental admission weights requiring heap calibration.
   */
  static prepare(
    capture: PackedCapture,
    source: PackedSource,
    document: Text,
    path: PackedPath,
    options: RenderOptions,
    limits: PackedRootValidationLimits,
    previous?: OwnedPackedPreview,
    baselines: PackedPreviewBaselines = {},
    retainRoot = false,
  ): PackedWork<OwnedPackedPreview> {
    capture.reader.at(path)
    if (path.length > 62) throw new Error('Invalid packed preview model path')
    const prior = previous ? { value: previous, version: previous.version() } : undefined
    const selected = [...path],
      render = { ...options },
      budget = { ...limits },
      reuse = { ...baselines }
    return capture.work(
      (function* () {
        let input: Input | undefined,
          state: PackedValue<ModelState> | undefined,
          preparation: PackedWork<Input> | undefined
        let root: PackedCapture | undefined
        let candidate: PackedCandidateStorage | undefined
        let transferred = false
        const valid = () => {
          if (prior && !prior.value.unchanged(prior.version))
            throw new Error('Superseded packed preview')
        }
        try {
          if (capture.sourceResource !== source || document.length !== source.text.length)
            throw new Error('Packed preview editor source mismatch')
          const sourceHold = capture.workspace(32768, 32768)
          try {
            for (let at = 0; at < document.length; at += 4096) {
              valid()
              if (document.sliceString(at, at + 4096) !== source.text.slice(at, at + 4096))
                throw new Error('Packed preview editor source mismatch')
              yield
            }
          } finally {
            sourceHold.release()
          }
          preparation = preparePackedPreviewInput(
            capture,
            source,
            selected,
            render,
            budget,
            reuse,
            'widgets',
          )
          while (true) {
            valid()
            const next = preparation.next()
            if (next.done) {
              input = next.value
              break
            }
            yield
          }
          if (!input) throw new Error('Incomplete packed preview input')
          const old = prior?.value.current()
          if (prior && !input.sameOwner(prior.value.input))
            throw new Error('Packed preview owner mismatch')
          if (
            old &&
            (
              ['generation', 'documentId', 'parserVersion', 'rendererVersion', 'options'] as const
            ).some((key) => old.identity[key] !== source.identity[key])
          )
            throw new Error('Packed preview document mismatch')
          if (old && old.identity.revision > source.identity.revision)
            throw new Error('Packed preview revision mismatch')
          const descriptors = input.value.input.document.blocks.length
          const bytes = 65536 + document.length * 2 + descriptors * 1024
          const data: ModelState = {
            sourceLength: document.length,
            descriptors,
            bytes,
            identity: source.identity,
          }
          state = capture.own(data, bytes)
          const previousBytes = (old?.sourceLength ?? 0) * 2 + (old?.descriptors ?? 0) * 1024
          if (previousBytes) candidate = new PackedCandidateStorage(capture, previousBytes)
          const tracker = old?.tracker.fork() ?? new OccurrenceTracker()
          data.tracker = tracker
          const work: Iterator<void, PreparedPreview | undefined> = preparePreview(
            input.value.input,
            document,
            tracker,
          )
          try {
            while (true) {
              valid()
              const next = work.next()
              if (next.done) {
                if (!next.value) throw new Error('Incomplete packed model preparation')
                data.prepared = next.value
                break
              }
              yield
            }
          } finally {
            work.return?.()
          }
          valid()
          if (retainRoot) root = capture.retain()
          const output = new OwnedPackedPreview(
            input,
            state,
            prior,
            root
              ? { capture: root, path: Object.freeze([...selected, 'document', 'root']) }
              : undefined,
            candidate,
          )
          yield
          valid()
          transferred = true
          return output
        } finally {
          finishPackedCleanup([
            () => {
              if (!transferred) state?.release()
            },
            () => {
              if (!transferred) input?.release()
            },
            () => {
              if (!transferred) root?.release()
            },
            () => {
              if (!transferred) candidate?.release()
            },
            () => preparation?.return(),
          ])
        }
      })(),
    )
  }
}
