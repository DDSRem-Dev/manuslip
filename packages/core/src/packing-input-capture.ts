import type { PackedCapture, PackedReadScope } from './packing-capture'
import { finishPackedCleanup } from './packing-cleanup'
import type { PackedEncodingBudget } from './packing-encode-budget'
import type { PackedPath } from './packing-view'

export type PackedTextReplay = () => Generator<string | undefined, unknown, undefined>
export type PackedReadValue =
  | { reader: PackedReadScope; records: boolean }
  | { text: PackedTextReplay }
class Input {
  constructor(
    readonly source: PackedCaptureInput,
    readonly value: PackedReadValue,
  ) {
    Object.freeze(this)
  }
}
export interface PackedCaptureInputs {
  adopt(inputs: readonly PackedCaptureInput[]): void
  assertOpen(): void
  get(value: unknown): PackedReadValue | undefined
  track<T extends Iterator<unknown, unknown, undefined>>(iterator: T): T
  forget(iterator: object): void
  close(preserveFailure?: boolean): void
}

/** Internal trusted adapters over revocable readers. Claiming transfers one retained
 * capture per source to the encoder. Borrowed scopes/replay callbacks must come from
 * this capture or an enclosing same-owner inspector and remain stable until closure.
 * No arena, raw view, native tree or joined string crosses the adapter.
 */
export class PackedCaptureInput {
  #capture: PackedCapture | undefined
  #owner: object | undefined
  #used = false
  constructor(
    capture: PackedCapture,
    private readonly records = false,
  ) {
    this.#capture = capture.retain()
    Object.freeze(this)
  }
  at(path: PackedPath = []): unknown {
    if (!this.#capture) throw new Error('Packed capture input closed')
    return this.read(this.#capture.reader.at(path))
  }
  read(reader: PackedReadScope): unknown {
    if (!this.#capture) throw new Error('Packed capture input closed')
    reader.assertOpen()
    return new Input(this, { reader, records: this.records })
  }
  text(replay: PackedTextReplay): unknown {
    if (!this.#capture || typeof replay !== 'function')
      throw new Error('Invalid packed capture text input')
    return new Input(this, { text: replay })
  }
  return(): void {
    const capture = this.#capture
    this.#capture = undefined
    this.#owner = undefined
    this.#used = true
    capture?.release()
  }
  static own(
    sources: readonly PackedCaptureInput[],
    budget: PackedEncodingBudget,
  ): PackedCaptureInputs {
    if (!Array.isArray(sources)) throw new Error('Invalid packed capture inputs')
    budget.charge(512)
    const inputs = new Set<PackedCaptureInput>()
    let first: PackedCapture | undefined
    const owner = Object.freeze({})
    const iterators = new Set<Iterator<unknown, unknown, undefined>>()
    let closed = false
    const adopt = (sources: readonly PackedCaptureInput[]) => {
      if (closed || !Array.isArray(sources)) throw new Error('Invalid packed capture inputs')
      budget.charge(sources.length * 256)
      const pending = new Set<PackedCaptureInput>()
      let candidate = first
      for (const input of sources) {
        if (
          !input ||
          typeof input !== 'object' ||
          !(#capture in input) ||
          !input.#capture ||
          input.#used ||
          inputs.has(input) ||
          pending.has(input)
        )
          throw new Error('Invalid or consumed packed capture input')
        if (candidate && !candidate.sameOwner(input.#capture))
          throw new Error('Packed capture inputs require the same owner')
        candidate ??= input.#capture
        pending.add(input)
      }
      first = candidate
      for (const input of pending) {
        input.#owner = owner
        input.#used = true
        inputs.add(input)
      }
    }
    adopt(sources)
    return {
      adopt,
      assertOpen() {
        if (closed) throw new Error('Packed capture inputs closed')
        for (const input of inputs) {
          if (input.#owner !== owner || !input.#capture)
            throw new Error('Packed capture input cancelled')
          input.#capture.identity
        }
      },
      get(value) {
        if (!(value instanceof Input)) return undefined
        const source = value.source
        if (closed || source.#owner !== owner || !source.#capture)
          throw new Error('Undeclared or cancelled packed capture input')
        return value.value
      },
      track(iterator) {
        budget.charge(128)
        iterators.add(iterator)
        return iterator
      },
      forget(iterator) {
        if (iterators.delete(iterator as Iterator<unknown, unknown, undefined>)) budget.release(128)
      },
      close(preserveFailure = false) {
        if (closed) return
        closed = true
        try {
          finishPackedCleanup(
            (function* () {
              for (const iterator of iterators) yield () => iterator.return?.()
              for (const input of inputs) yield () => input.return()
            })(),
            preserveFailure,
          )
        } finally {
          iterators.clear()
          inputs.clear()
          first = undefined
        }
      },
    }
  }
}
