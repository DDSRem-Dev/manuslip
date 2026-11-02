import { randomUUID } from 'node:crypto'
import type { DiagramRequest } from '@manuslip/renderer/diagram'
import { describe, expect, it, vi } from 'vitest'
import { PackedSession } from '../../../../../../../packages/core/src/packing-session'
import { DiagramConsumers } from '../../../../../src/renderer/src/preview/diagrams'
import type { Result } from '../../../../../src/shared/contracts'
import type { DiagramBridge } from '../../../../../src/shared/diagram-contracts'

const request = (priority: DiagramRequest['priority'] = 'visible'): DiagramRequest => ({
  jobId: randomUUID(),
  documentId: randomUUID(),
  occurrenceId: randomUUID(),
  source: 'flowchart LR\nA-->B',
  theme: 'light',
  priority,
  retry: false,
})
const tick = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function bridge() {
  let notify = (): void => {}
  const unsubscribe = vi.fn()
  const jobs: { request: DiagramRequest; resolve(result: Result<string>): void }[] = []
  const api: DiagramBridge = {
    renderDiagram: vi.fn(
      (request: DiagramRequest) =>
        new Promise<Result<string>>((resolve) => jobs.push({ request, resolve })),
    ),
    cancelDiagram: vi.fn(async (): Promise<Result<null>> => ({ ok: true, value: null })),
    onDiagramCapacity: (listener) => {
      notify = listener
      return unsubscribe
    },
  }
  return { api, jobs, unsubscribe, notify: () => notify() }
}
describe('viewport diagram consumers', () => {
  it('keeps a native lease through both cancelled IPC promises and releases queued jobs immediately', async () => {
    const owner = new PackedSession({
      retained: 65536,
      bytes: 8192,
      staging: 8192,
      captures: 4,
      readers: 16,
    })
    const data = owner.own({ source: 'native diagram input' }, 4096)
    const client = new DiagramConsumers(),
      host = bridge()
    let cancel: ((result: Result<null>) => void) | undefined
    host.api.cancelDiagram = () =>
      new Promise((resolve) => {
        cancel = resolve
      })
    const controllers = Array.from({ length: 6 }, () => new AbortController())
    const pending = controllers.map((controller) =>
      client
        .render(host.api, request(), controller.signal, data)
        .catch((error: Error) => error.message),
    )
    expect(host.jobs).toHaveLength(5)
    expect(owner.stats.holds).toBe(7)
    controllers[5]?.abort()
    expect(owner.stats.holds).toBe(6)
    data.release()
    controllers[0]?.abort()
    await tick()
    expect(await pending[0]).toBe('diagram-cancelled')
    expect(owner.stats.holds).toBe(5)
    host.jobs[0]?.resolve({ ok: true, value: '<svg/>' })
    await tick()
    expect(owner.stats.holds).toBe(5)
    cancel?.({ ok: true, value: null })
    await tick()
    expect(owner.stats.holds).toBe(4)
    for (const job of host.jobs.slice(1)) job.resolve({ ok: true, value: '<svg/>' })
    await Promise.all(pending)
    await tick()
    expect(owner.stats).toMatchObject({ holds: 0, retainedBytes: 256 })
    owner.dispose()
  })
  it('retains a native lease between busy attempts and closes it after success', async () => {
    const owner = new PackedSession({
      retained: 65536,
      bytes: 8192,
      staging: 8192,
      captures: 4,
      readers: 16,
    })
    const data = owner.own({ source: 'native diagram input' }, 4096)
    const client = new DiagramConsumers(),
      host = bridge()
    const result = client.render(host.api, request(), new AbortController().signal, data)
    data.release()
    host.jobs[0]?.resolve({ ok: false, code: 'diagram-busy', error: 'Busy' })
    await tick()
    expect(owner.stats.holds).toBe(1)
    host.notify()
    expect(host.jobs).toHaveLength(2)
    host.jobs[1]?.resolve({ ok: true, value: '<svg/>' })
    await result
    await tick()
    expect(owner.stats).toMatchObject({ holds: 0, retainedBytes: 256 })
    owner.dispose()
  })
  it('releases native leases when either bridge registration or invocation throws', async () => {
    const owner = new PackedSession({
      retained: 65536,
      bytes: 8192,
      staging: 8192,
      captures: 4,
      readers: 16,
    })
    const data = owner.own({ source: 'native diagram input' }, 4096)
    const client = new DiagramConsumers(),
      host = bridge()
    const subscribe = host.api.onDiagramCapacity
    host.api.onDiagramCapacity = () => {
      throw new Error('Registration failed')
    }
    await expect(
      client.render(host.api, request(), new AbortController().signal, data),
    ).rejects.toThrow('Registration failed')
    expect(owner.stats.holds).toBe(1)
    host.api.onDiagramCapacity = subscribe
    host.api.renderDiagram = () => {
      throw new Error('Invocation failed')
    }
    await expect(
      client.render(host.api, request(), new AbortController().signal, data),
    ).rejects.toThrow('diagram-process')
    await tick()
    expect(owner.stats.holds).toBe(1)
    expect(host.unsubscribe).toHaveBeenCalledOnce()
    data.release()
    expect(owner.stats.retainedBytes).toBe(256)
    owner.dispose()
  })
  it('caps IPC admission, schedules visible consumers first and revokes aborted work', async () => {
    const client = new DiagramConsumers()
    const host = bridge()
    const controllers = Array.from({ length: 7 }, () => new AbortController())
    const pending = controllers.map((controller, i) =>
      client
        .render(host.api, request(i === 6 ? 'visible' : 'nearby'), controller.signal)
        .catch((error: Error) => error.message),
    )
    expect(host.jobs).toHaveLength(5)
    host.jobs[0]?.resolve({ ok: true, value: '<svg/>' })
    await tick()
    expect(host.jobs[5]?.request.priority).toBe('visible')
    for (const controller of controllers) controller.abort()
    for (const job of host.jobs) job.resolve({ ok: true, value: '<svg/>' })
    await Promise.all(pending)
    await tick()
    expect(host.api.cancelDiagram).toHaveBeenCalled()
    expect(host.unsubscribe).toHaveBeenCalledOnce()
  })
  it('handles capacity arriving before the busy reply without losing the wake-up', async () => {
    const client = new DiagramConsumers()
    const host = bridge()
    const result = client.render(host.api, request(), new AbortController().signal)
    host.notify()
    host.jobs[0]?.resolve({ ok: false, code: 'diagram-busy', error: 'Busy' })
    await tick()
    expect(host.jobs).toHaveLength(2)
    host.jobs[1]?.resolve({ ok: true, value: '<svg/>' })
    await expect(result).resolves.toBe('<svg/>')
    await tick()
    expect(host.unsubscribe).toHaveBeenCalledOnce()
  })
  it('waits for capacity after a busy reply and rejects configuration before IPC', async () => {
    const client = new DiagramConsumers()
    const host = bridge()
    await expect(
      client.render(
        host.api,
        { ...request(), source: '%%{init: {}}%%' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('diagram-config')
    expect(host.jobs).toHaveLength(0)
    const result = client.render(host.api, request(), new AbortController().signal)
    host.jobs[0]?.resolve({ ok: false, code: 'diagram-busy', error: 'Busy' })
    await tick()
    expect(host.jobs).toHaveLength(1)
    host.notify()
    expect(host.jobs).toHaveLength(2)
    host.jobs[1]?.resolve({ ok: true, value: '<svg/>' })
    await result
    await tick()
  })
})
