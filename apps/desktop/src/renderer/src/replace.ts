import {
  ChangeSet,
  type EditorState,
  EditorView,
  getSearchQuery,
  isolateHistory,
  type Transaction,
  type TransactionSpec,
  ViewPlugin,
} from '@manuslip/editor'
import { type Replacement, type ReplaceOutput, replaceLimits } from '@manuslip/editor/replace'
import { semanticMetric } from './semantics/metrics'
import { browserRuntime, type SliceRuntime, SlicedWork } from './semantics/sliced-work'

interface ReplaceAccess {
  state(): EditorState
  canApply(): boolean
  dispatch(spec: TransactionSpec): void
  status(replacing: boolean, error?: string): void
}
interface ReplaceWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage(value: unknown): void
  terminate(): void
}
interface Job {
  sequence: number
  state: EditorState
  worker: ReplaceWorker | null
  work: { cancel(): void } | null
  timer: ReturnType<typeof setTimeout> | null
  started: number
  workerStarted: boolean
}

/** One replace-all job. Native panel activation is routed here before its synchronous handler. */
export class DocumentReplace {
  private job: Job | null = null
  private sequence = 0
  constructor(
    private readonly document: ReplaceAccess,
    private readonly createWorker: () => ReplaceWorker = () =>
      new Worker(new URL('./replace.worker.ts', import.meta.url), {
        type: 'module',
        name: 'manuslip-replace',
      }),
    private readonly runtime: SliceRuntime = browserRuntime,
  ) {}
  readonly extension = ViewPlugin.define((view) => {
    const click = (event: MouseEvent) => {
      const button =
        event.target instanceof Element
          ? event.target.closest('.cm-search button[name=replaceAll]')
          : null
      if (!(button instanceof HTMLButtonElement) || button.disabled) return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.start()
    }
    view.dom.addEventListener('click', click, true)
    return {
      destroy: () => {
        view.dom.removeEventListener('click', click, true)
        this.cancel()
      },
    }
  })

  cancel(): boolean {
    const job = this.job
    if (!job) return false
    this.job = null
    job.work?.cancel()
    this.stopWorker(job)
    if (job.timer) clearTimeout(job.timer)
    this.document.status(false)
    return true
  }
  changed(transactions: readonly Transaction[]): void {
    const job = this.job
    if (
      job &&
      transactions.some(
        (transaction) => transaction.docChanged || !this.sameQuery(transaction.state, job.state),
      )
    )
      this.cancel()
  }
  start(): void {
    this.cancel()
    if (!this.document.canApply()) return
    const state = this.document.state()
    if (state.readOnly) return
    const query = getSearchQuery(state)
    if (!query.valid || query.test) {
      this.document.status(false, 'replace-query')
      return
    }
    const job: Job = {
      sequence: ++this.sequence,
      state,
      worker: null,
      work: null,
      timer: null,
      started: performance.now(),
      workerStarted: false,
    }
    this.job = job
    this.document.status(true)
    job.timer = setTimeout(() => this.failed(job, 'replace-timeout'), replaceLimits.watchdog)
    const work = new SlicedWork<{ lines: string[] }>(
      this.source(state),
      {
        valid: () => this.valid(job),
        complete: ({ lines }) => {
          job.work = null
          const worker = this.createWorker()
          job.worker = worker
          worker.onmessage = (event) => this.received(job, event.data)
          worker.onerror = worker.onmessageerror = () => this.failed(job, 'replace-failed')
          const wordChars =
            state.languageDataAt<string>('wordChars', state.selection.main.head)[0] || ''
          worker.postMessage({
            sequence: job.sequence,
            lines,
            wordChars,
            query: {
              search: query.search,
              replace: query.replace,
              regexp: query.regexp,
              caseSensitive: query.caseSensitive,
              wholeWord: query.wholeWord,
              literal: query.literal,
            },
          })
        },
        failed: () => this.failed(job, 'replace-failed'),
        finished: () => {},
        measured: (start) => semanticMetric('replace-source-slice', start),
      },
      this.runtime,
    )
    job.work = work
    this.runtime.defer(work.run)
  }
  private *source(state: EditorState): Generator<void, { lines: string[] }> {
    const lines: string[] = []
    const iterator = state.doc.iterLines()
    for (let index = 0; !iterator.next().done; index++) {
      lines.push(iterator.value)
      if (index % 256 === 0) yield
    }
    return { lines }
  }
  private valid(job: Job): boolean {
    const valid =
      this.job === job &&
      this.document.canApply() &&
      this.document.state().doc === job.state.doc &&
      this.sameQuery(this.document.state(), job.state)
    if (!valid && this.job === job) this.cancel()
    return valid
  }
  private failed(job: Job, error: string): void {
    if (this.job !== job) return
    this.cancel()
    this.document.status(false, error)
  }
  private sameQuery(current: EditorState, captured: EditorState): boolean {
    const query = getSearchQuery(current)
    const previous = getSearchQuery(captured)
    return query.eq(previous) && query.literal === previous.literal
  }
  private stopWorker(job: Job): void {
    const worker = job.worker
    job.worker = null
    if (!worker) return
    worker.onmessage = worker.onerror = worker.onmessageerror = null
    worker.terminate()
  }
  private received(job: Job, value: unknown): void {
    if (this.job !== job) return
    if (!this.valid(job)) {
      this.cancel()
      return
    }
    try {
      if (
        !value ||
        typeof value !== 'object' ||
        !('sequence' in value) ||
        value.sequence !== job.sequence
      )
        throw new Error('replace-failed')
      if ('error' in value) {
        this.failed(
          job,
          typeof value.error === 'string' &&
            ['replace-query', 'replace-limit', 'file-large'].includes(value.error)
            ? value.error
            : 'replace-failed',
        )
        return
      }
      if ('kind' in value && value.kind === 'started') {
        if (job.workerStarted) throw new Error('replace-failed')
        job.workerStarted = true
        semanticMetric('replace-worker-start', job.started)
        return
      }
      if (
        !('payload' in value) ||
        !(value.payload instanceof ArrayBuffer) ||
        value.payload.byteLength + 1024 > replaceLimits.message
      )
        throw new Error('replace-failed')
      const output: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(value.payload),
      )
      if (
        !output ||
        typeof output !== 'object' ||
        !('changes' in output) ||
        !Array.isArray(output.changes) ||
        output.changes.length > replaceLimits.changes ||
        !('matches' in output) ||
        !Number.isSafeInteger(output.matches) ||
        Number(output.matches) < output.changes.length ||
        Number(output.matches) > job.state.doc.length + 1
      )
        throw new Error('replace-failed')
      this.stopWorker(job)
      const result = output as ReplaceOutput
      const work = new SlicedWork<ChangeSet>(
        this.prepare(job.state, result.changes),
        {
          valid: () => this.valid(job),
          complete: (changes) => {
            if (!this.valid(job)) return
            this.cancel()
            if (!changes.empty)
              this.document.dispatch({
                changes,
                annotations: isolateHistory.of('full'),
                effects: EditorView.announce.of(
                  `${job.state.phrase('replaced $ matches', result.matches)}.`,
                ),
                userEvent: 'input.replace.all',
              })
            semanticMetric('replace-commit', job.started, { matches: result.matches })
          },
          failed: () => this.failed(job, 'replace-failed'),
          finished: () => {},
          measured: (start) => semanticMetric('replace-prepare-slice', start),
        },
        this.runtime,
      )
      job.work = work
      this.runtime.defer(work.run)
    } catch {
      this.failed(job, 'replace-failed')
    }
  }
  private *prepare(state: EditorState, replacements: Replacement[]): Generator<void, ChangeSet> {
    const levels: (ChangeSet | undefined)[] = []
    let previous = 0
    for (let index = 0; index < replacements.length; index += 64) {
      const batch = replacements.slice(index, index + 64).map((value) => {
        if (
          !Array.isArray(value) ||
          value.length !== 3 ||
          !Number.isSafeInteger(value[0]) ||
          !Number.isSafeInteger(value[1]) ||
          value[0] < previous ||
          value[1] < value[0] ||
          value[1] > state.doc.length ||
          typeof value[2] !== 'string'
        )
          throw new Error('replace-failed')
        previous = value[1]
        return { from: value[0], to: value[1], insert: value[2] }
      })
      let run = ChangeSet.of(batch, state.doc.length)
      let level = 0
      while (levels[level]) {
        const earlier = levels[level]
        if (!earlier) break
        run = earlier.compose(run.map(earlier))
        levels[level] = undefined
        level++
        yield
      }
      levels[level] = run
      yield
    }
    let result = ChangeSet.empty(state.doc.length)
    for (const run of levels.reverse()) {
      if (run) result = result.compose(run.map(result))
      yield
    }
    return result
  }
}
