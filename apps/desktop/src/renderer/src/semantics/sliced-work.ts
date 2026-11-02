import { semanticLimits } from '@manuslip/core'

export interface SliceStats {
  slices: number
  maxSliceMs: number
  activeMs: number
}
export interface SliceRuntime {
  now(): number
  defer(run: () => void): void
  deferBackground?(run: () => void): void
}
interface WorkOptions<T> {
  valid(): boolean
  beforeComplete?(): Promise<void> | undefined
  discard?(value: T): void
  complete(value: T): void
  finished(stats: SliceStats): void
  failed(error: unknown): void
  measured(start: number): void
}
/** The scheduler only needs advancement and cancellation, not native generator helpers. */
interface SliceIterator<T> {
  next(): IteratorResult<void, T | undefined>
  return(value: T | undefined): IteratorResult<void, T | undefined>
}
export const browserRuntime: SliceRuntime = {
  now: performance.now.bind(performance),
  defer: (run) => {
    if (typeof scheduler !== 'undefined') void scheduler.yield().then(run, () => setTimeout(run, 0))
    else setTimeout(run, 0)
  },
  deferBackground: (run) => {
    if (typeof scheduler !== 'undefined' && typeof scheduler.postTask === 'function') {
      let started = false
      void scheduler
        .postTask(
          () => {
            started = true
            run()
          },
          { priority: 'background' },
        )
        .catch((error: unknown) => {
          if (!started) setTimeout(run, 0)
          else
            queueMicrotask(() => {
              throw error
            })
        })
    } else setTimeout(run, 0)
  },
}

/** Only the active task retains its generator/callbacks. Cancel releases them even while queued. */
export class SlicedWork<T extends object> {
  private iterator: SliceIterator<T> | null
  private options: WorkOptions<T> | null
  private prepared: T | null = null
  private readonly stats: SliceStats = { slices: 0, maxSliceMs: 0, activeMs: 0 }
  constructor(
    iterator: SliceIterator<T>,
    options: WorkOptions<T>,
    private readonly runtime: SliceRuntime = browserRuntime,
  ) {
    this.iterator = iterator
    this.options = options
  }

  cancel(): void {
    const iterator = this.iterator
    const prepared = this.prepared
    const options = this.options
    this.iterator = null
    this.options = null
    this.prepared = null
    iterator?.return(undefined)
    if (prepared) options?.discard?.(prepared)
  }

  private completePrepared = (): void => {
    const options = this.options
    const prepared = this.prepared
    if (!options || !prepared) return
    try {
      if (!options.valid()) {
        this.cancel()
        return
      }
    } catch (error) {
      this.failPrepared(error)
      return
    }
    // Ownership passes to complete, which also owns cleanup if installation throws.
    this.prepared = null
    this.options = null
    try {
      options.complete(prepared)
      options.finished({ ...this.stats })
    } catch (error) {
      options.failed(error)
    }
  }

  private failPrepared = (error: unknown): void => {
    const options = this.options
    if (!options) return
    this.cancel()
    options.failed(error)
  }

  run = (): void => {
    const options = this.options
    const iterator = this.iterator
    if (!options || !iterator) return
    if (!options.valid()) {
      this.cancel()
      return
    }
    const start = this.runtime.now()
    let finished = false
    let waiting: Promise<void> | undefined
    let failure: { error: unknown } | null = null
    try {
      do {
        const result = iterator.next()
        if (result.done) {
          if (!result.value) throw new Error('Incomplete sliced work')
          this.iterator = null
          this.prepared = result.value
          waiting = options.beforeComplete?.()
          if (waiting) break
          this.prepared = null
          this.options = null
          options.complete(result.value)
          finished = true
          break
        }
      } while (this.runtime.now() - start < semanticLimits.applySlice)
    } catch (error) {
      this.cancel()
      failure = { error }
    }
    const duration = this.runtime.now() - start
    this.stats.slices++
    this.stats.activeMs += duration
    this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, duration)
    options.measured(start)
    if (failure) options.failed(failure.error)
    else if (waiting) void waiting.then(this.completePrepared, this.failPrepared)
    else if (finished) options.finished({ ...this.stats })
    else if (this.iterator) this.runtime.defer(this.run)
  }
}
