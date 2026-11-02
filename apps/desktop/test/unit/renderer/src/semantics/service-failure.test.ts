import { parseMarkdown, semanticLimits } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { SemanticFailureReason } from '../../../../../src/renderer/src/semantics/metrics'
import type {
  ParseRequest,
  ParseResponse,
} from '../../../../../src/renderer/src/semantics/protocol'
import {
  type SemanticEvent,
  SemanticService,
  type WorkerPort,
} from '../../../../../src/renderer/src/semantics/service'

const measure = 'manuslip:semantic-failure'
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
class Port implements WorkerPort {
  messages: ParseRequest[] = []
  receive: (value: unknown) => void = () => {}
  fail: (reason?: SemanticFailureReason) => void = () => {}
  terminated = false
  onMessage(listener: (value: unknown) => void): void {
    this.receive = listener
  }
  onFailure(listener: (reason?: SemanticFailureReason) => void): void {
    this.fail = listener
  }
  post(request: ParseRequest): void {
    this.messages.push(request)
  }
  terminate(): void {
    this.terminated = true
  }
  finish(): void {
    const request = this.messages.at(-1)
    if (!request) throw new Error('Missing request')
    const document = parseMarkdown(request.source)
    this.receive({
      ...request,
      kind: 'result',
      sentAt: performance.timeOrigin + performance.now(),
      snapshot: {
        document,
        projection: renderMarkdown(document.root, request.options),
        bytes: 100,
        cached: false,
        transportInMs: 0,
        serializeMs: 0,
      },
    } satisfies ParseResponse)
  }
}
const records = () => performance.getEntriesByName(measure) as PerformanceMeasure[]
function timers(): void {
  // Keep the real User Timing store while advancing the scheduler and its elapsed clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - performance.timeOrigin)
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  performance.clearMeasures(measure)
})

it.each([
  'worker-create',
  'message-listener',
  'failure-listener',
  'worker-post',
  'watchdog',
  'native-response',
  'worker-failure',
  'worker-error',
  'message-error',
  'unrecognized-reason',
] as const)(
  'records %s before recovery without storing document or exception text',
  async (stage) => {
    timers()
    performance.clearMeasures(measure)
    const secret = 'PRIVATE_DOCUMENT_PATH_AND_EXCEPTION_世界'
    const ports: Port[] = []
    let attempts = 0
    const service = new SemanticService(() => {
      const first = attempts++ === 0
      if (first && stage === 'worker-create') throw new Error(secret)
      const port = new Port()
      ports.push(port)
      if (first) {
        if (stage === 'message-listener')
          port.onMessage = () => {
            throw new Error(secret)
          }
        if (stage === 'failure-listener')
          port.onFailure = () => {
            throw new Error(secret)
          }
        if (stage === 'worker-post')
          port.post = () => {
            throw new Error(secret)
          }
      }
      return port
    })
    const notify = vi.fn()
    const connection = service.connect(secret, notify)
    try {
      connection.request(1, () => secret, { ...options, footnotesLabel: secret })
      await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
      const first = ports[0]
      if (stage === 'watchdog') await vi.advanceTimersByTimeAsync(semanticLimits.watchdog)
      else if (stage === 'native-response') first?.receive({ private: secret })
      else if (stage === 'worker-failure') first?.fail()
      else if (stage === 'worker-error' || stage === 'message-error') first?.fail(stage)
      else if (stage === 'unrecognized-reason') first?.fail(secret as SemanticFailureReason)
      expect(records()).toHaveLength(1)
      const detail = records()[0]?.detail
      expect(detail).toEqual({
        reason: stage.endsWith('-listener')
          ? 'worker-listener'
          : stage === 'unrecognized-reason'
            ? 'worker-failure'
            : stage,
        requestActive: true,
        requestAgeMs: expect.any(Number),
        workerPresent: stage !== 'worker-create',
      })
      expect(detail.requestAgeMs).toBeGreaterThanOrEqual(0)
      if (stage === 'watchdog')
        expect(detail.requestAgeMs).toBeGreaterThanOrEqual(semanticLimits.watchdog)
      expect(JSON.stringify(records().map((row) => row.toJSON()))).not.toContain(secret)
      expect(attempts).toBe(2)
      const replacement = ports.at(-1)
      expect(replacement?.terminated).toBe(false)
      replacement?.finish()
      expect(notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'snapshot', revision: 1 }),
      )
      if (first !== replacement) {
        first?.fail('worker-error')
        expect(records()).toHaveLength(1)
      }
    } finally {
      service.dispose()
    }
  },
)

it('does not classify a throwing accepted consumer as a Worker failure', async () => {
  timers()
  performance.clearMeasures(measure)
  const port = new Port(),
    factory = vi.fn(() => port)
  const service = new SemanticService(factory)
  const connection = service.connect('document', (event: SemanticEvent) => {
    if (event.kind === 'snapshot') throw new Error('A consumer failed after acceptance')
  })
  try {
    connection.request(1, () => '# Source', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    port.finish()
    expect(records()).toEqual([])
    expect(port.terminated).toBe(false)
    expect(factory).toHaveBeenCalledTimes(1)
  } finally {
    service.dispose()
  }
})

it('keeps failure history bounded across explicit retries', async () => {
  timers()
  performance.clearMeasures(measure)
  let port = new Port()
  const service = new SemanticService(() => (port = new Port()))
  const connection = service.connect('one', () => {})
  try {
    connection.request(1, () => 'source', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    for (let index = 0; index < 205; index++) {
      port.fail('message-error')
      connection.retry()
      expect(records().length).toBeLessThanOrEqual(200)
    }
    expect(records().length).toBeGreaterThan(0)
    expect(records().at(-1)?.detail.reason).toBe('message-error')
    port.finish()
  } finally {
    service.dispose()
  }
})

it('recovers normally when the diagnostic timing API throws', async () => {
  timers()
  const original = performance.measure.bind(performance)
  vi.spyOn(performance, 'measure').mockImplementation((name, ...args) => {
    if (name === measure) throw new Error('Timing API unavailable')
    return original(name, ...args)
  })
  const ports: Port[] = []
  const service = new SemanticService(() => {
    const port = new Port()
    ports.push(port)
    return port
  })
  const notify = vi.fn(),
    connection = service.connect('one', notify)
  try {
    connection.request(1, () => '# Unchanged source', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    ports[0]?.fail('worker-error')
    expect(ports).toHaveLength(2)
    expect(ports[1]?.terminated).toBe(false)
    ports[1]?.finish()
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'snapshot', revision: 1 }),
    )
  } finally {
    service.dispose()
  }
})

it('keeps healthy requests and accepted responses when ordinary timing measurements throw', async () => {
  timers()
  vi.spyOn(performance, 'measure').mockImplementation(() => {
    throw new Error('Diagnostic measurement failed')
  })
  const port = new Port(),
    factory = vi.fn(() => port)
  const service = new SemanticService(factory)
  const notify = vi.fn(),
    connection = service.connect('one', notify)
  try {
    for (let revision = 0; revision <= semanticLimits.restarts; revision++) {
      connection.request(revision, () => '# Preserved source', options)
      await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
      expect(port.terminated).toBe(false)
      port.finish()
      expect(notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'snapshot', revision }),
      )
    }
    expect(factory).toHaveBeenCalledTimes(1)
  } finally {
    service.dispose()
  }
})

it.each(['worker-error', 'message-error'] as const)(
  'preserves the native browser adapter %s reason through a real service replacement',
  async (reason) => {
    timers()
    performance.clearMeasures(measure)
    const workers: BrowserWorker[] = []
    class BrowserWorker extends Port {
      onmessage: (event: MessageEvent) => void = () => {}
      onerror: (event: ErrorEvent) => void = () => {}
      onmessageerror: () => void = () => {}
      constructor() {
        super()
        this.receive = (value) => this.onmessage(new MessageEvent('message', { data: value }))
        workers.push(this)
      }
      postMessage(request: ParseRequest): void {
        this.post(request)
      }
    }
    vi.stubGlobal('Worker', BrowserWorker)
    vi.resetModules()
    const { getSemanticService } = await import('../../../../../src/renderer/src/semantics/browser')
    const service = getSemanticService(),
      notify = vi.fn()
    const connection = service.connect('one', notify)
    try {
      connection.request(1, () => '# Browser source', options)
      await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
      const first = workers[0]
      if (reason === 'worker-error') {
        const preventDefault = vi.fn()
        first?.onerror({ preventDefault, message: 'PRIVATE_ERROR_TEXT' } as unknown as ErrorEvent)
        expect(preventDefault).toHaveBeenCalledTimes(1)
      } else first?.onmessageerror()
      expect(workers).toHaveLength(2)
      expect(first?.terminated).toBe(true)
      expect(records()).toHaveLength(1)
      expect(records()[0]?.detail.reason).toBe(reason)
      expect(JSON.stringify(records().map((row) => row.toJSON()))).not.toContain(
        'PRIVATE_ERROR_TEXT',
      )
      workers[1]?.finish()
      expect(notify).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'snapshot', revision: 1 }),
      )
    } finally {
      service.dispose()
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  },
)
