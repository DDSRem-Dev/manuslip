import { semanticLimits } from '../../core/src/contracts'
import type { PackedCapture } from '../../core/src/packing-capture'
import { finishPackedCleanup } from '../../core/src/packing-cleanup'
import type { PackedHold } from '../../core/src/packing-hold'
import type { PackedSource } from '../../core/src/packing-source'
import type { PackedRootValidationLimits } from '../../core/src/packing-validate-root'
import type { PackedValue } from '../../core/src/packing-value'
import type { PackedPath } from '../../core/src/packing-view'
import type { PackedWork } from '../../core/src/packing-work'
import type { RenderOptions } from './index'
import type { PackedPreviewBaselines } from './packed-preview'
import { packedSnapshotSteps } from './packing-validate-snapshot'

const seal = Symbol('complete snapshot validation')
const limitKeys = ['retained', 'staging', 'nodes', 'depth'] as const
interface Data {
  readonly matches: (capture: PackedCapture) => boolean
  readonly path: PackedPath
  readonly policy: string
  readonly limits: Readonly<PackedRootValidationLimits>
}
function validLimits(limits: PackedRootValidationLimits): boolean {
  return (
    limitKeys.every((key) => Number.isSafeInteger(limits[key]) && limits[key] >= 0) &&
    limits.retained <= semanticLimits.rendererBytes &&
    limits.staging <= semanticLimits.messageBytes &&
    limits.nodes <= semanticLimits.blocks * 16 &&
    limits.depth >= 1 &&
    limits.depth <= 128
  )
}
function policy(options: RenderOptions): string | undefined {
  if (
    !options ||
    Object.keys(options).length !== 3 ||
    !Object.keys(options).every((key) =>
      ['rawHtml', 'footnotesLabel', 'footnoteBackLabel'].includes(key),
    ) ||
    typeof options.rawHtml !== 'boolean' ||
    typeof options.footnotesLabel !== 'string' ||
    options.footnotesLabel.length > 200 ||
    typeof options.footnoteBackLabel !== 'string' ||
    options.footnoteBackLabel.length > 200
  )
    return undefined
  return JSON.stringify(options)
}

/** Keep cleanup outside the validation factory's scope. A held, unadvanced handle must
 * not retain that factory's source/capture after revocation, including before first next.
 */
function creationWork(
  capture: PackedCapture,
  validation: Generator<void, PackedSnapshotCertificate, undefined>,
  hold: PackedHold,
): PackedWork<PackedSnapshotCertificate> {
  return capture.work(validation, () => hold.release())
}

/** Complete semantic validation of one exact immutable revision, never a wire assertion.
 * Independently charged source-free metadata survives prepared-capture revocation. Its
 * weak witness retains no graph/source/session; each consumer pins its own capture.
 */
export class PackedSnapshotCertificate {
  #value: PackedValue<Data> | undefined
  private constructor(key: typeof seal, value: PackedValue<Data>) {
    if (key !== seal) throw new Error('Invalid snapshot certificate provenance')
    this.#value = value
    Object.freeze(this)
  }
  /** Check the private factory brand before invoking the sealed authorization method.
   * Prototype copies, proxies and caller-supplied methods cannot grant validation reuse.
   */
  static validates(
    certificate: unknown,
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: PackedRootValidationLimits,
  ): boolean {
    return (
      typeof certificate === 'object' &&
      certificate !== null &&
      #value in certificate &&
      PackedSnapshotCertificate.prototype.validatesSnapshot.call(
        certificate,
        capture,
        source,
        snapshot,
        options,
        limits,
      )
    )
  }
  static create(
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: PackedRootValidationLimits,
    baselines: Omit<PackedPreviewBaselines, 'snapshot'> = {},
  ): PackedWork<PackedSnapshotCertificate> {
    const { validation, hold } = PackedSnapshotCertificate.#prepare(
      capture,
      source,
      snapshot,
      options,
      limits,
      baselines,
    )
    try {
      return creationWork(capture, validation, hold)
    } catch (error) {
      hold.release()
      throw error
    }
  }
  /** Internal composition: call from an already running capture-owned generator and
   * delegate immediately. That parent owns revocation of this complete chain. Setup
   * runs when the active parent calls this method; queued cancellation never calls it.
   * Independent callers must use create(), including its immediate setup/admission.
   */
  static createSteps(
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: PackedRootValidationLimits,
    baselines: Omit<PackedPreviewBaselines, 'snapshot'> = {},
  ): Generator<void, PackedSnapshotCertificate | undefined, undefined> {
    return PackedSnapshotCertificate.#prepare(capture, source, snapshot, options, limits, baselines)
      .validation
  }
  static #prepare(
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: PackedRootValidationLimits,
    baselines: Omit<PackedPreviewBaselines, 'snapshot'>,
  ): {
    validation: Generator<void, PackedSnapshotCertificate, undefined>
    hold: PackedHold
  } {
    capture.reader.at(snapshot)
    const renderPolicy = policy(options)
    if (snapshot.length > 62 || renderPolicy === undefined || !validLimits(limits))
      throw new Error('Invalid snapshot certificate request')
    const bytes =
      4096 +
      renderPolicy.length * 2 +
      snapshot.reduce<number>((sum, part) => sum + 64 + String(part).length * 2, 0)
    const hold = capture.workspace(bytes, 0)
    let path: PackedPath,
      render: RenderOptions,
      budget: Readonly<PackedRootValidationLimits>,
      reuse: Omit<PackedPreviewBaselines, 'snapshot'>
    try {
      path = Object.freeze([...snapshot])
      render = Object.freeze({ ...options })
      budget = Object.freeze({ ...limits })
      reuse = { ...baselines }
      const validation = (function* () {
        let value: PackedValue<Data> | undefined
        let transferred = false
        let failed = false
        try {
          yield* packedSnapshotSteps(
            capture,
            source,
            path,
            render,
            budget,
            reuse.projection,
            reuse.document,
            reuse.words,
          )
          // The factory never trusts a supplied certificate in lieu of validation.
          const data = Object.freeze({
            matches: capture.revisionWitness(),
            path,
            policy: renderPolicy,
            limits: budget,
          })
          hold.release()
          value = capture.own(data, bytes)
          const certificate = new PackedSnapshotCertificate(seal, value)
          transferred = true
          return certificate
        } catch (error) {
          failed = true
          throw error
        } finally {
          finishPackedCleanup(
            [
              () => {
                if (!transferred) value?.release()
              },
              () => hold.release(),
            ],
            failed,
          )
        }
      })()
      return { validation, hold }
    } catch (error) {
      hold.release()
      throw error
    }
  }
  validatesSnapshot(
    capture: PackedCapture,
    source: PackedSource,
    snapshot: PackedPath,
    options: RenderOptions,
    limits: PackedRootValidationLimits,
  ): boolean {
    if (!this.#value) return false
    const data = this.#value.value
    return (
      capture.sourceResource === source &&
      data.matches(capture) &&
      snapshot.length === data.path.length &&
      snapshot.every((part, index) => part === data.path[index]) &&
      policy(options) === data.policy &&
      validLimits(limits) &&
      limitKeys.every((key) => limits[key] >= data.limits[key])
    )
  }
  /** Graph identity alone; consumer authorization still checks policy/path/limits. */
  matches(capture: PackedCapture): boolean {
    return !!this.#value && this.#value.value.matches(capture)
  }
  retain(): PackedSnapshotCertificate {
    if (!this.#value) throw new Error('Snapshot certificate closed')
    return new PackedSnapshotCertificate(seal, this.#value.retain())
  }
  close(): void {
    const value = this.#value
    this.#value = undefined
    value?.release()
  }
}

Object.freeze(PackedSnapshotCertificate.prototype)
Object.freeze(PackedSnapshotCertificate)
