import { randomUUID } from 'node:crypto'
import { type DiagramRequest, diagramLimits } from '@manuslip/renderer/diagram'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramBroker, type HostFactory } from '../../../../src/main/diagrams/broker'
import { FileOperationError } from '../../../../src/main/files/errors'

function request(overrides: Partial<DiagramRequest> = {}): DiagramRequest {
  return {
    jobId: randomUUID(),
    documentId: randomUUID(),
    occurrenceId: randomUUID(),
    source: 'flowchart LR\nA-->B',
    theme: 'light',
    priority: 'visible',
    retry: false,
    ...overrides,
  }
}
function harness() {
  const jobs: {
    request: DiagramRequest
    resolve(svg: string): void
    reject(error: Error): void
  }[] = []
  let active: (typeof jobs)[number] | undefined
  const factory: HostFactory = {
    create: vi.fn(async () => ({
      render: (request: DiagramRequest) =>
        new Promise<string>((resolve, reject) => {
          active = { request, resolve, reject }
          jobs.push(active)
        }),
      destroy: () => factory.destroy(),
    })),
    destroy: vi.fn(() => {
      active?.reject(new FileOperationError('diagram-process'))
      active = undefined
    }),
  }
  const capacity = vi.fn()
  return { broker: new DiagramBroker(factory, capacity), factory, jobs, capacity }
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
afterEach(() => vi.useRealTimers())

describe('isolated diagram scheduler', () => {
  it('keeps legacy formats separate in the cache and shares the default Mermaid format', async () => {
    const { broker, jobs } = harness()
    for (const [index, syntax] of [undefined, 'sequence', 'flowchart'].entries()) {
      const job = broker.render(request({ syntax: syntax as DiagramRequest['syntax'] }))
      await tick()
      expect(jobs).toHaveLength(index + 1)
      expect(jobs[index]?.request.syntax).toBe(syntax)
      jobs[index]?.resolve(`<svg>${index}</svg>`)
      await expect(job).resolves.toBe(`<svg>${index}</svg>`)
      await tick()
    }
    await expect(broker.render(request({ syntax: 'mermaid' }))).resolves.toBe('<svg>0</svg>')
    await expect(broker.render(request({ syntax: 'sequence' }))).resolves.toBe('<svg>1</svg>')
    expect(jobs).toHaveLength(3)
    broker.dispose()
  })
  it('runs one job, caps pending work and prioritizes visible consumers', async () => {
    const { broker, jobs } = harness()
    const first = broker.render(request())
    await tick()
    const nearby = Array.from({ length: 3 }, (_, i) =>
      broker.render(request({ priority: 'nearby', source: `flowchart LR\nA-->N${i}` })),
    )
    const visibleRequest = request({ source: 'flowchart LR\nA-->Visible' })
    const visible = broker.render(visibleRequest)
    await expect(broker.render(request())).rejects.toMatchObject({ code: 'diagram-busy' })
    expect(broker.diagnostics).toMatchObject({ running: 1, pending: 4 })
    jobs[0]?.resolve('<svg/>')
    await first
    await tick()
    expect(jobs[1]?.request.jobId).toBe(visibleRequest.jobId)
    jobs[1]?.resolve('<svg/>')
    await visible
    const cancelled = nearby.map((job) =>
      expect(job).rejects.toMatchObject({ code: 'diagram-cancelled' }),
    )
    broker.dispose()
    await Promise.all(cancelled)
  })
  it('supersedes the same occurrence even when the latest value is cached', async () => {
    const { broker, jobs } = harness()
    const original = request()
    const first = broker.render(original)
    await tick()
    jobs[0]?.resolve('<svg/>')
    await first
    await tick()
    const obsolete = expect(
      broker.render({ ...original, jobId: randomUUID(), source: 'flowchart LR\nX-->Y' }),
    ).rejects.toMatchObject({ code: 'diagram-cancelled' })
    await tick()
    await expect(broker.render({ ...original, jobId: randomUUID() })).resolves.toBe('<svg/>')
    await obsolete
    jobs[1]?.resolve('<svg>obsolete</svg>')
    await tick()
    expect(broker.diagnostics.running).toBe(0)
    broker.dispose()
  })
  it('kills hangs, permits only three automatic restarts per minute and allows explicit retry', async () => {
    vi.useFakeTimers()
    const { broker, factory } = harness()
    for (let i = 0; i < 4; i++) {
      const result = expect(broker.render(request())).rejects.toMatchObject({
        code: 'diagram-timeout',
      })
      await vi.advanceTimersByTimeAsync(diagramLimits.timeout)
      await result
    }
    expect(factory.create).toHaveBeenCalledTimes(4)
    expect(factory.destroy).toHaveBeenCalledTimes(4)
    await expect(broker.render(request())).rejects.toMatchObject({ code: 'diagram-paused' })
    const retry = expect(broker.render(request({ retry: true }))).rejects.toMatchObject({
      code: 'diagram-cancelled',
    })
    await tick()
    expect(factory.create).toHaveBeenCalledTimes(5)
    broker.dispose()
    await retry
  })
  it('expires the restart budget, rejects configuration and UTF-8 overflow before host admission', async () => {
    vi.useFakeTimers()
    const { broker, factory } = harness()
    await expect(
      broker.render(
        request({ source: '%%{init: {securityLevel: "loose"}}%%\nflowchart LR\nA-->B' }),
      ),
    ).rejects.toMatchObject({ code: 'diagram-config' })
    await expect(broker.render(request({ source: '界'.repeat(22_000) }))).rejects.toMatchObject({
      code: 'diagram-limit',
    })
    expect(factory.create).not.toHaveBeenCalled()
    for (let i = 0; i < 4; i++) {
      const result = expect(broker.render(request())).rejects.toMatchObject({
        code: 'diagram-timeout',
      })
      await vi.advanceTimersByTimeAsync(diagramLimits.timeout)
      await result
    }
    await vi.advanceTimersByTimeAsync(diagramLimits.restartWindow)
    const next = expect(broker.render(request())).rejects.toMatchObject({
      code: 'diagram-cancelled',
    })
    await tick()
    expect(factory.create).toHaveBeenCalledTimes(5)
    broker.dispose()
    await next
  })
  it('counts hung obsolete jobs against the restart budget', async () => {
    vi.useFakeTimers()
    const { broker } = harness()
    for (let i = 0; i < 4; i++) {
      const job = request()
      const cancelled = expect(broker.render(job)).rejects.toMatchObject({
        code: 'diagram-cancelled',
      })
      await tick()
      broker.cancel(job.jobId)
      await cancelled
      await vi.advanceTimersByTimeAsync(diagramLimits.timeout)
    }
    await expect(broker.render(request())).rejects.toMatchObject({ code: 'diagram-paused' })
    broker.dispose()
  })
  it('cancels the owning document and recovers without counting deliberate revocation as failure', async () => {
    const { broker, jobs, factory } = harness()
    const own = request()
    const cancelled = expect(broker.render(own)).rejects.toMatchObject({
      code: 'diagram-cancelled',
    })
    await tick()
    const otherRequest = request({ source: 'flowchart LR\nOther-->Document' })
    const other = broker.render(otherRequest)
    broker.closeDocument(own.documentId)
    await cancelled
    await tick()
    expect(factory.destroy).toHaveBeenCalledTimes(2)
    expect(jobs[1]?.request.documentId).toBe(otherRequest.documentId)
    jobs[1]?.resolve('<svg/>')
    await other
    expect(broker.diagnostics.failures).toBe(0)
    broker.dispose()
  })
  it('bounds UTF-16 cache memory, separates themes and rejects oversized SVG output', async () => {
    const { broker, jobs } = harness()
    for (let i = 0; i < 5; i++) {
      const result = broker.render(request({ source: `flowchart LR\nA-->B${i}` }))
      await tick()
      jobs[i]?.resolve(`<svg>${' '.repeat(1_000_000)}</svg>`)
      await result
      await tick()
      expect(broker.diagnostics.cacheBytes).toBeLessThanOrEqual(diagramLimits.cache)
    }
    const dark = broker.render(request({ source: 'flowchart LR\nA-->B4', theme: 'dark' }))
    await tick()
    expect(jobs).toHaveLength(6)
    jobs[5]?.resolve('<svg/>')
    await dark
    await tick()
    const oversized = expect(
      broker.render(request({ source: 'flowchart LR\nA-->Big' })),
    ).rejects.toMatchObject({ code: 'diagram-limit' })
    await tick()
    jobs[6]?.resolve(`<svg>${' '.repeat(diagramLimits.svg)}</svg>`)
    await oversized
    broker.dispose()
  })
})
