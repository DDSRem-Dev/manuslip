import { semanticLimits } from '@manuslip/core'
import { finishPackedCleanup } from '../../../../../../packages/core/src/packing-cleanup'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import type { PackedResource } from '../../../../../../packages/core/src/packing-resources'
import type { PackedWireMessage } from '../../../../../../packages/core/src/packing-wire'
import { PackedWork } from '../../../../../../packages/core/src/packing-work'
import { PackedSemanticProducer } from './packed-producer'
import { type PreparedProducerSource, producerSourceSteps } from './packed-producer-source'
import { browserRuntime, type SliceRuntime } from './sliced-work'

type Offer = Exclude<PackedWireMessage, { kind: 'resync' }>
export interface ProducerWorkReport {
  readonly wallMs: number
  readonly steps: number
  readonly largestStepMs: number
  readonly peakRetainedBytes: number
  readonly peakStagingBytes: number
}
export type ProducerHostOutput =
  | { readonly kind: 'offer'; readonly message: Offer; readonly report?: ProducerWorkReport }
  | { readonly kind: 'cached'; readonly ready: boolean; readonly report?: ProducerWorkReport }
interface HostPort {
  post(value: ProducerHostOutput, transfer: ArrayBuffer[]): void
  failed(error: unknown): void
}
interface Progress {
  readonly started: number
  steps: number
  largestStepMs: number
  peakRetainedBytes: number
  peakStagingBytes: number
}
interface Task extends Progress {
  readonly kind: 'offer' | 'cached'
  readonly work: PackedWork<Offer | boolean>
}
export interface ProducerSourceEvents {
  queued(): void
  activated(): void
  cancelled(): void
  failed(error: unknown): void
}
interface SourceTask extends Progress {
  readonly work: PackedWork<PreparedProducerSource>
  readonly events: ProducerSourceEvents
}

/** Shared active time across offer callbacks. Queue waits and source candidates are
 * outside these spans. The read callback owns only this small clock; closing it drops
 * the runtime so completed producer handles cannot retain its scheduled work.
 */
class ProducerActiveTime {
  #elapsed = 0
  #started: number | undefined
  #depth = 0
  #now: (() => number) | undefined
  constructor(now: () => number) {
    this.#now = now
  }
  readonly read = () =>
    this.#elapsed +
    (this.#started === undefined ? 0 : (this.#now?.() ?? this.#started) - this.#started)
  start(at: number): void {
    if (!this.#now) return
    if (!this.#depth++) this.#started = at
  }
  stop(at: number): void {
    if (this.#depth && !--this.#depth) {
      this.#elapsed += at - (this.#started ?? at)
      this.#started = undefined
    }
  }
  close(): void {
    this.#started = undefined
    this.#depth = 0
    this.#now = undefined
  }
}

/** Worker-side scheduling over the application producer. One queued callback reads the
 * current task; supersession never leaves a queued closure holding an obsolete generator.
 * Transfer must finish before an exact ACK can commit. Ordinary JSON transport remains
 * separate until receiver/consumer integration and release gates have been established.
 */
export class PackedProducerHost {
  readonly #producer: PackedSemanticProducer
  readonly #activeTime: ProducerActiveTime
  #task: Task | undefined
  #source: SourceTask | undefined
  #lastSource = false
  readonly #hold: PackedHold
  #port: HostPort | undefined
  #scheduled = false
  #disposed = false
  constructor(
    port: HostPort,
    private readonly runtime: SliceRuntime = browserRuntime,
    private readonly profile = false,
  ) {
    this.#activeTime = new ProducerActiveTime(runtime.now.bind(runtime))
    this.#producer = new PackedSemanticProducer(
      {
        bytes: semanticLimits.messageBytes,
        retained: semanticLimits.workerCacheBytes,
        staging: semanticLimits.messageBytes,
        captures: 8,
        readers: 64,
      },
      this.#activeTime.read,
    )
    this.#port = port
    try {
      this.#hold = this.#producer.retain({ resources: () => [{ key: this, bytes: 4096 }] })
    } catch (error) {
      finishPackedCleanup([() => this.#producer.dispose(), () => this.#activeTime.close()], true)
      throw error
    }
  }
  get stats() {
    return this.#producer.stats
  }
  /** Trusted bounded channel metadata shares the same producer session allowance. */
  retain(resource: { resources(): Iterable<PackedResource> }) {
    this.#alive()
    return this.#producer.retain(resource)
  }
  #alive(): void {
    if (this.#disposed) throw new Error('Packed producer host disposed')
  }
  prepare(input: unknown, exchange: unknown): void {
    this.#alive()
    // The producer validates both inputs before revoking valid in-flight work.
    const work = this.#producer.prepare(input, exchange)
    try {
      this.cancelSource()
    } catch (error) {
      work.return()
      throw error
    }
    this.#replace('offer', work)
  }
  /** One latest candidate shares the existing callback with the active offer. Invalid
   * source bytes/digest leave that offer intact; only complete validation can promote.
   */
  prepareCooperative(input: unknown, exchange: unknown, events: ProducerSourceEvents): void {
    this.#alive()
    const source = producerSourceSteps(input, exchange)
    let hold: PackedHold | undefined
    let work: PackedWork<PreparedProducerSource> | undefined
    try {
      this.cancelSource()
      hold = this.#producer.retain({
        resources: () => [{ key: source, bytes: source.retainedBytes }],
      })
      const ownership = hold
      work = new PackedWork(
        (function* () {
          return yield* source
        })(),
        () => {
          try {
            source.return()
          } finally {
            ownership.release()
          }
        },
      )
      const task: SourceTask = { work, events, ...this.#progress() }
      this.#source = task
      events.queued()
      this.#defer()
    } catch (error) {
      const candidate = this.#source
      if (work && candidate?.work === work) this.#source = undefined
      finishPackedCleanup(
        [
          () => {
            work?.return()
          },
          () => {
            source.return()
          },
          () => {
            hold?.release()
          },
          () => {
            if (work && candidate?.work === work) events.cancelled()
          },
        ],
        true,
      )
      throw error
    }
  }
  acknowledge(value: unknown): void {
    this.#alive()
    this.#producer.acknowledge(value)
  }
  cache(): void {
    this.#alive()
    if (this.#source) return
    this.#replace('cached', this.#producer.cacheSteps())
  }
  #progress(): Progress {
    return {
      started: this.runtime.now(),
      steps: 0,
      largestStepMs: 0,
      peakRetainedBytes: 0,
      peakStagingBytes: 0,
    }
  }
  #replace(kind: Task['kind'], work: Task['work'], progress = this.#progress()): void {
    this.#task?.work.return()
    this.#task = {
      kind,
      work,
      started: progress.started,
      steps: progress.steps,
      largestStepMs: progress.largestStepMs,
      peakRetainedBytes: progress.peakRetainedBytes,
      peakStagingBytes: progress.peakStagingBytes,
    }
    this.#defer()
  }
  #defer(): void {
    if (this.#scheduled || (!this.#task && !this.#source) || this.#disposed) return
    this.#scheduled = true
    try {
      this.runtime.defer(() => {
        this.#scheduled = false
        this.#run()
      })
    } catch (error) {
      this.#scheduled = false
      this.#fail(error)
    }
  }
  #fail(error: unknown): void {
    const source = this.#source
    this.#source = undefined
    finishPackedCleanup([
      () => {
        source?.work.return()
      },
      () => this.cancelOffer(),
      () => {
        source?.events.failed(error)
      },
      () => {
        this.#port?.failed(error)
      },
    ])
  }
  #run(): void {
    if (this.#disposed) return
    const source = this.#source
    // Alternate when both exist. Each uses the same bounded Worker callback slot.
    if (source && (!this.#task || !this.#lastSource)) {
      this.#lastSource = true
      this.#runSource(source)
    } else {
      this.#lastSource = false
      this.#runOffer()
    }
    this.#defer()
  }
  #measure(task: Progress, before: number): void {
    if (!this.profile) return
    const stats = this.#producer.stats
    task.steps++
    task.largestStepMs = Math.max(task.largestStepMs, this.runtime.now() - before)
    task.peakRetainedBytes = Math.max(task.peakRetainedBytes, stats.retainedBytes)
    task.peakStagingBytes = Math.max(task.peakStagingBytes, stats.readerStagingBytes)
  }
  #runSource(task: SourceTask): void {
    const start = this.runtime.now()
    const prior = this.#task
    let promoted: Task['work'] | undefined
    try {
      do {
        const before = this.profile ? this.runtime.now() : 0
        const result = task.work.next()
        if (this.#source !== task || this.#disposed) return
        this.#measure(task, before)
        if (result.done) {
          if (!result.value) throw new Error('Incomplete producer source preparation')
          const work = this.#producer.preparePrepared(result.value)
          promoted = work
          task.events.activated()
          if (this.#source !== task || this.#disposed) {
            work.return()
            return
          }
          this.#source = undefined
          this.#replace('offer', work, task)
          promoted = undefined
          return
        }
      } while (this.runtime.now() - start < 2)
    } catch (error) {
      if (this.#source !== task) throw error
      this.#source = undefined
      finishPackedCleanup([
        () => {
          task.work.return()
        },
        () => {
          if (promoted) {
            promoted.return()
            if (this.#task === prior) this.#task = undefined
          }
        },
        () => task.events.failed(error),
        () => {
          if (promoted) this.#port?.failed(error)
        },
      ])
    }
  }
  #runOffer(): void {
    const task = this.#task
    if (!task || this.#disposed) return
    const start = this.runtime.now()
    this.#activeTime.start(start)
    try {
      do {
        const before = this.profile ? this.runtime.now() : 0
        const result = task.work.next()
        // A reentrant callback can cancel or replace work during an advancement.
        if (this.#task !== task || this.#disposed) return
        this.#measure(task, before)
        if (result.done) {
          this.#task = undefined
          const measured = this.profile
            ? {
                report: {
                  wallMs: this.runtime.now() - task.started,
                  steps: task.steps,
                  largestStepMs: task.largestStepMs,
                  peakRetainedBytes: task.peakRetainedBytes,
                  peakStagingBytes: task.peakStagingBytes,
                },
              }
            : {}
          const value = result.value
          if (task.kind === 'offer' && value && typeof value === 'object') {
            this.#port?.post({ kind: 'offer', message: value, ...measured }, [value.payload])
            if (value.payload.byteLength !== 0) throw new Error('Packed offer was not transferred')
          } else if (task.kind === 'cached' && typeof value === 'boolean') {
            this.#port?.post({ kind: 'cached', ready: value, ...measured }, [])
          } else throw new Error('Incomplete packed producer host work')
          return
        }
      } while (this.runtime.now() - start < 2)
    } catch (error) {
      this.#fail(error)
    } finally {
      this.#activeTime.stop(this.runtime.now())
    }
  }
  cancelSource(): void {
    const source = this.#source
    this.#source = undefined
    try {
      source?.work.return()
    } finally {
      source?.events.cancelled()
    }
  }
  cancelOffer(): void {
    const task = this.#task
    this.#task = undefined
    try {
      task?.work.return()
    } finally {
      this.#producer.cancel()
    }
  }
  cancel(): void {
    finishPackedCleanup([() => this.cancelSource(), () => this.cancelOffer()])
  }
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#port = undefined
    try {
      this.cancel()
    } finally {
      finishPackedCleanup([
        () => this.#hold.release(),
        () => this.#producer.dispose(),
        () => this.#activeTime.close(),
      ])
    }
  }
}
