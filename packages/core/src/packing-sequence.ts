import { finishPackedCleanup } from './packing-cleanup'
import type { PackedEncodingBudget } from './packing-encode-budget'
import { PackedArrayInput, type PackedArrayInputs } from './packing-input-array'
import { PackedCaptureInput, type PackedCaptureInputs } from './packing-input-capture'
import { PackedWork } from './packing-work'

type Checkpoint = (admit?: (bytes: number) => void) => Generator<void, ArrayBuffer, undefined>

/** Internal append-only encoding transaction. Keys and supplied siblings must follow
 * Object.keys order. The coordinator validates/renders between parked boundaries;
 * streamed native inputs may still advance their parser inside encoding steps.
 * Input lists transfer only as they are claimed. Unclaimed inputs remain caller-owned.
 */
export class PackedSequence {
  readonly value: Record<string, object>
  readonly inputs: PackedArrayInputs
  readonly captures: PackedCaptureInputs
  readonly work: PackedWork<ArrayBuffer>
  readonly #slots: object[]
  #index = 0
  #boundary: number | undefined
  #pending: unknown
  #ready = false
  #consuming = false
  #open = true
  #borrowing = false
  #checkpoint: Checkpoint | undefined
  #copy: PackedWork<ArrayBuffer> | undefined

  constructor(
    keys: readonly string[],
    budget: PackedEncodingBudget,
    create: (sequence: PackedSequence) => Generator<void, ArrayBuffer | undefined, undefined>,
  ) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 64)
      throw new Error('Invalid packed sequence keys')
    const names = [...keys]
    if (names.some((key) => typeof key !== 'string') || new Set(names).size !== names.length)
      throw new Error('Invalid packed sequence keys')
    budget.charge(1024 + names.length * 64)
    this.#slots = names.map(() => Object.freeze({}))
    this.value = Object.freeze(
      Object.fromEntries(names.map((key, index) => [key, this.#slots[index]])),
    )
    // Integer property names enumerate first in numeric order. A reordered envelope
    // would visit a future opaque slot before its sibling has been supplied.
    if (Object.keys(this.value).some((key, index) => key !== names[index]))
      throw new Error('Invalid packed sequence keys')
    this.inputs = PackedArrayInput.own([], budget)
    this.captures = PackedCaptureInput.own([], budget)
    const raw = create(this)
    // One revocable work owns the raw encoder. The thin iterator checks only active
    // captures; native document advances do not scan unopened sibling registries.
    const prototype = Object.getPrototypeOf(
      (function* () {
        yield
      })(),
    )
    const iterator: Generator<void, ArrayBuffer | undefined, undefined> = Object.assign(
      Object.create(prototype),
      {
        next: () => {
          this.#assertOpen()
          if (this.#borrowing) this.captures.assertOpen()
          const next = raw.next()
          if (!this.#open) return { done: true, value: undefined }
          if (this.#borrowing) this.captures.assertOpen()
          return next
        },
        return: () => raw.return(undefined),
        throw: (error: unknown) => raw.throw(error),
        [Symbol.iterator]: () => iterator,
        [Symbol.dispose]: () => {
          this.close()
        },
      },
    )
    this.work = new PackedWork(iterator, () => this.close())
  }

  get token(): object | undefined {
    return this.#slots[this.#index]
  }
  get borrowing(): boolean {
    return this.#borrowing
  }
  get boundary(): number | undefined {
    return this.#boundary
  }
  #assertOpen(): void {
    if (!this.#open) throw new Error('Packed sequence closed')
  }

  supply(
    value: unknown,
    arrays: readonly PackedArrayInput[] = [],
    captures: readonly PackedCaptureInput[] = [],
  ): void {
    this.#assertOpen()
    if (this.#ready || this.#consuming || (this.#index && this.#boundary === undefined))
      throw new Error('Packed sequence is not waiting for input')
    if (this.#boundary !== undefined && this.#index + 1 === this.#slots.length)
      throw new Error('Packed sequence has no remaining input')
    try {
      this.inputs.adopt(arrays)
      this.captures.adopt(captures)
    } catch (error) {
      finishPackedCleanup([() => this.close()], true)
      throw error
    }
    this.#copy?.return()
    this.#copy = undefined
    this.#checkpoint = undefined
    if (this.#boundary !== undefined) this.#index++
    this.#boundary = undefined
    this.#pending = value
    this.#ready = true
    this.#borrowing ||= captures.length > 0
  }

  take(): unknown {
    this.#assertOpen()
    if (!this.#ready || this.#consuming) throw new Error('Missing packed sequence input')
    const value = this.#pending
    this.#pending = undefined
    this.#ready = false
    this.#consuming = true
    return value
  }

  park(checkpoint: Checkpoint): void {
    this.#assertOpen()
    if (!this.#consuming) throw new Error('Invalid packed sequence boundary')
    this.#consuming = false
    this.#boundary = this.#index
    this.#checkpoint = checkpoint
  }

  resume(): void {
    this.#assertOpen()
    if (this.#boundary === undefined) return
    if (this.#index + 1 !== this.#slots.length)
      throw new Error('Packed sequence resumed without input')
    this.#copy?.return()
    this.#copy = undefined
    this.#checkpoint = undefined
    this.#boundary = undefined
  }

  copy(admit?: (bytes: number) => void): PackedWork<ArrayBuffer> {
    this.#assertOpen()
    const checkpoint = this.#checkpoint
    if (this.#boundary === undefined || !checkpoint)
      throw new Error('Packed sequence checkpoint unavailable')
    this.#checkpoint = undefined
    const raw = checkpoint(admit)
    const sequence = this
    this.#copy = new PackedWork(
      (function* () {
        try {
          while (true) {
            sequence.#assertOpen()
            const next = raw.next()
            if (!sequence.#open) return undefined
            if (next.done) return next.value
            yield
          }
        } finally {
          raw.return(undefined as never)
        }
      })(),
      () => {},
    )
    return this.#copy
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    this.#pending = undefined
    this.#checkpoint = undefined
    const copy = this.#copy
    this.#copy = undefined
    finishPackedCleanup([
      () => copy?.return(),
      () => this.work?.return(),
      () => this.inputs.close(),
      () => this.captures.close(),
    ])
  }
}
