import { parserVersion, semanticLimits, sourceHash } from '@manuslip/core'
import { createSourceState, StateEffect, type TransactionSpec } from '@manuslip/editor'
import { afterEach, expect, it, vi } from 'vitest'
import { unpackValue } from '../../../../../../../packages/core/src/packing'
import type { PackedCapture } from '../../../../../../../packages/core/src/packing-capture'
import type { PackedReceiveTicket } from '../../../../../../../packages/core/src/packing-receiver'
import * as sourceModule from '../../../../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { parseMarkdown } from '../../../../../../../packages/core/src/parse'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import {
  DocumentPreview,
  initialPreviewStatus,
} from '../../../../../src/renderer/src/preview/controller'
import { OwnedPackedPreview } from '../../../../../src/renderer/src/preview/packed-preparation'
import { PreviewStatusPublication } from '../../../../../src/renderer/src/preview/status-publication'
import type { SemanticFailureReason } from '../../../../../src/renderer/src/semantics/metrics'
import {
  PackedSemanticPort,
  type PackedSemanticResult,
} from '../../../../../src/renderer/src/semantics/packed-port'
import { PackedSemanticReceiver } from '../../../../../src/renderer/src/semantics/packed-receiver'
import { PackedWorkerEndpoint } from '../../../../../src/renderer/src/semantics/packed-worker-endpoint'
import { absoluteNow, type ParseRequest } from '../../../../../src/renderer/src/semantics/protocol'
import {
  type SemanticEvent,
  SemanticService,
} from '../../../../../src/renderer/src/semantics/service'

const MiB = 1024 * 1024
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const makeReceiver = (retained = 64 * MiB) =>
  new PackedSemanticReceiver(
    {
      bytes: 8 * MiB,
      retained,
      staging: 8 * MiB,
      captures: 8,
      readers: 160,
    },
    { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 },
  )
const input = (source: string, revision = 0, sequence = revision + 1): ParseRequest => ({
  kind: 'parse',
  sequence,
  generation: 1,
  documentId: 'port',
  revision,
  source,
  options,
  sentAt: absoluteNow(),
})
afterEach(() => vi.useRealTimers())

it('queues the exact request JSON check without stringifying its source', () => {
  const context = fixture(),
    text = `# JSON scan\n\n${'界\0😀'.repeat(3000)}`,
    stringify = JSON.stringify
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value) => {
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'parse' &&
      'source' in value &&
      value.source === text
    )
      throw new Error('whole request JSON sizing')
    return stringify(value)
  })
  try {
    context.port.postRequestCooperative(input(text))
    expect(context.commands).toHaveLength(0)
    context.flush(() =>
      context.commands.some((value) => (value as { kind?: string }).kind === 'prepare'),
    )
    expect(context.commands).toHaveLength(1)
    expect((context.commands[0] as { input: ParseRequest }).input.source).toBe(text)
  } finally {
    spy.mockRestore()
    context.close()
  }
})

it('reports an oversized queued request without restarting the channel and accepts the next request', () => {
  const context = fixture(),
    baseline = context.receiver.stats.retainedBytes
  try {
    context.port.postRequestCooperative(input('\0'.repeat(semanticLimits.previewBytes)))
    expect(context.results).toHaveLength(0)
    expect(context.commands).toHaveLength(0)
    context.flush()
    expect(context.results).toHaveLength(1)
    expect(context.results[0]).toMatchObject({
      kind: 'error',
      code: 'semantic-limit',
      sequence: 1,
      revision: 0,
    })
    expect(context.results[0]).not.toHaveProperty('source')
    expect(context.failures).toBe(0)
    expect(context.receiver.stats.retainedBytes).toBe(baseline)
    context.port.postRequestCooperative(input('# Next request', 1))
    context.flush()
    expect(context.results[1]).toMatchObject({ kind: 'packed-result', revision: 1 })
    expect(context.failures).toBe(0)
  } finally {
    context.close()
  }
})

it.each(['post', 'postCooperative'] as const)(
  'preserves immediate JSON size rejection in legacy %s',
  (method) => {
    const context = fixture()
    try {
      context.port.post(input('# Valid pending'))
      expect(() =>
        context.port[method](input('\0'.repeat(semanticLimits.previewBytes), 1)),
      ).toThrow('Invalid semantic request')
      context.flush()
      expect(context.results).toHaveLength(1)
      expect(context.results[0]).toMatchObject({ kind: 'packed-result', revision: 0 })
      expect(context.failures).toBe(0)
    } finally {
      context.close()
    }
  },
)

it('uses queued request sizing on the service cold path and recovers from a size limit without a restart', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const context = fixture(),
    events: SemanticEvent[] = [],
    text = '\0'.repeat(semanticLimits.previewBytes),
    stringify = JSON.stringify
  let created = 0
  const service = new SemanticService(() => {
    created++
    return context.port
  })
  const connection = service.connect('port', (event) => events.push(event))
  const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value) => {
    if (
      value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'parse' &&
      'source' in value &&
      value.source === text
    )
      throw new Error('service or port sized the entire source synchronously')
    return stringify(value)
  })
  try {
    connection.request(0, () => text, options)
    await vi.advanceTimersByTimeAsync(150)
    expect(created).toBe(1)
    expect(context.queue).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'error')).toHaveLength(0)
    context.flush()
    expect(events.filter((event) => event.kind === 'error')).toEqual([
      { kind: 'error', code: 'semantic-limit', paused: false },
    ])
    expect(context.failures).toBe(0)
    connection.request(1, () => '# After the limit', options)
    await vi.advanceTimersByTimeAsync(150)
    context.flush()
    expect(created).toBe(1)
    expect(events.filter((event) => event.kind === 'packed-snapshot')).toHaveLength(1)
    expect(context.failures).toBe(0)
  } finally {
    spy.mockRestore()
    connection.dispose()
    service.dispose()
    context.close()
  }
})

it('keeps the service JSON cap for older ports without queued request sizing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const context = fixture(),
    events: SemanticEvent[] = []
  Object.defineProperty(context.port, 'postRequestCooperative', { value: undefined })
  const post = vi.spyOn(context.port, 'postCooperative')
  const service = new SemanticService(() => context.port)
  const connection = service.connect('port', (event) => events.push(event))
  try {
    connection.request(0, () => '\0'.repeat(semanticLimits.previewBytes), options)
    await vi.advanceTimersByTimeAsync(150)
    expect(post).not.toHaveBeenCalled()
    expect(context.commands).toHaveLength(0)
    expect(events.filter((event) => event.kind === 'error')).toEqual([
      { kind: 'error', code: 'semantic-limit', paused: false },
    ])
  } finally {
    connection.dispose()
    service.dispose()
    context.close()
  }
})

function fixture(receiver = makeReceiver(), prioritized = false) {
  const queue: (() => void)[] = [],
    backgroundQueue: (() => void)[] = [],
    incoming: unknown[] = [],
    commands: unknown[] = []
  const results: PackedSemanticResult[] = []
  let listener: (value: unknown) => void = () => {}
  let failure: (reason?: SemanticFailureReason) => void = () => {}
  const failureReasons: (SemanticFailureReason | undefined)[] = []
  let failed = 0,
    clock = 0,
    terminated = false,
    holdOffers = false
  const held: unknown[] = []
  const runtime = {
    now: () => (clock += 0.6),
    defer: (run: () => void) => queue.push(run),
    ...(prioritized ? { deferBackground: (run: () => void) => backgroundQueue.push(run) } : {}),
  }
  const endpoint = new PackedWorkerEndpoint(
    {
      post(value, transfer) {
        const copy = structuredClone(value, { transfer })
        incoming.push(copy)
        if (holdOffers) held.push(copy)
        else queue.push(() => listener(copy))
      },
    },
    runtime,
  )
  const port = new PackedSemanticPort(
    {
      onMessage: (run) => {
        listener = run
      },
      onFailure: (run) => {
        failure = run
      },
      post(value) {
        if (terminated) throw new Error('Channel terminated')
        const copy = structuredClone(value)
        commands.push(copy)
        queue.push(() => {
          if (terminated) return
          try {
            endpoint.receiveCooperative(copy)
          } catch {
            failure()
          }
        })
      },
      terminate: () => {
        terminated = true
        endpoint.dispose()
      },
    },
    receiver,
    runtime,
  )
  port.onFailure((reason) => {
    failed++
    failureReasons.push(reason)
  })
  port.onResult((result) => results.push(result))
  const flush = (until?: () => boolean, includeBackground = true) => {
    let count = 0
    while ((queue.length || (includeBackground && backgroundQueue.length)) && !until?.()) {
      if (++count > 200000) throw new Error('Transport failed to settle')
      const next = queue.shift() ?? backgroundQueue.shift()
      next?.()
    }
  }
  return {
    port,
    endpoint,
    receiver,
    runtime,
    queue,
    backgroundQueue,
    commands,
    incoming,
    results,
    failureReasons,
    flush,
    get failures() {
      return failed
    },
    get terminated() {
      return terminated
    },
    holdOffers: () => {
      holdOffers = true
    },
    releaseOffers: () => {
      holdOffers = false
      for (const value of held.splice(0)) queue.push(() => listener(value))
    },
    deliver: (value: unknown) => listener(value),
    fail: (reason?: SemanticFailureReason) => failure(reason),
    close(dispose = true) {
      port.terminate()
      flush()
      if (dispose) receiver.dispose()
      expect(endpoint.stats.retainedBytes).toBe(0)
      if (dispose) expect(receiver.stats.retainedBytes).toBe(0)
    },
  }
}

it.each(['before', 'suspended'] as const)(
  'cancels the actual charged source scan %s scheduling',
  (phase) => {
    const context = fixture()
    const baseline = context.receiver.stats.retainedBytes
    const factory = sourceModule.packedSourceSteps
    let source: ReturnType<typeof factory> | undefined
    const observed = vi.spyOn(sourceModule, 'packedSourceSteps').mockImplementation((...args) => {
      source = factory(...args)
      return source
    })
    try {
      context.port.postCooperative(input('x'.repeat(32768)))
      expect(context.commands).toHaveLength(0)
      expect(context.receiver.stats.retainedBytes - baseline).toBeGreaterThanOrEqual(65536)
      if (phase === 'suspended') context.queue.shift()?.()
      expect(context.commands).toHaveLength(0)
      context.port.cancel()
      expect(source?.next()).toEqual({ done: true, value: undefined })
      expect(context.receiver.stats.retainedBytes).toBe(baseline)
      context.flush()
      expect(context.commands).toHaveLength(0)
    } finally {
      observed.mockRestore()
      context.close()
    }
  },
)

it('sends only the newest immutable request after cooperative source preparation', () => {
  const context = fixture()
  const value = { ...input('# Original\n\ntext '.repeat(800)), options: { ...options } }
  const original = value.source
  try {
    context.port.postCooperative(input('obsolete '.repeat(1000)))
    context.queue.shift()?.()
    context.port.postCooperative(value)
    value.source = 'mutated'
    value.options.rawHtml = true
    context.flush()
    expect(
      context.commands.filter((value) => (value as { kind: string }).kind === 'prepare'),
    ).toHaveLength(1)
    expect(context.results).toHaveLength(1)
    const result = context.results[0]
    expect(result?.kind).toBe('packed-result')
    expect(context.receiver.stats.current?.sourceHash).toBe(sourceHash(original))
    expect(
      (
        context.commands.find((value) => (value as { kind: string }).kind === 'prepare') as {
          input: ParseRequest
        }
      ).input.source,
    ).toBe(original)
    expect(
      (
        context.commands.find((value) => (value as { kind: string }).kind === 'prepare') as {
          input: ParseRequest
        }
      ).input.options.rawHtml,
    ).toBe(false)
  } finally {
    context.close()
  }
})

it('releases provisional source ownership after a scheduled read fails', () => {
  const receiver = makeReceiver()
  const baseline = receiver.stats.retainedBytes
  const context = fixture(receiver)
  const text = 'x'.repeat(32768)
  context.port.postCooperative(input(text))
  const original = String.prototype.charCodeAt
  const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === text && index === 4096) throw new Error('source read failed')
    return original.call(this, index)
  })
  try {
    context.flush()
    expect(context.failureReasons).toEqual(['worker-post'])
    expect(context.receiver.stats.retainedBytes).toBe(baseline)
    expect(context.commands).toHaveLength(0)
  } finally {
    observed.mockRestore()
    context.close()
  }
})

it('does not revoke a valid request when provisional source admission fails', () => {
  const context = fixture(makeReceiver(2 * MiB))
  try {
    context.port.post(input('valid'))
    expect(() => context.port.postCooperative(input('x'.repeat(MiB)))).toThrow('limit')
    context.flush()
    expect(context.results[0]?.kind).toBe('packed-result')
    expect(context.failures).toBe(0)
  } finally {
    context.close()
  }
})

it.each(['worker-error', 'message-error'] as const)(
  'preserves a packed channel %s reason while releasing its ownership',
  (reason) => {
    const context = fixture()
    try {
      context.port.post(input('# Retained source'))
      context.fail(reason)
      expect(context.failures).toBe(1)
      expect(context.failureReasons).toEqual([reason])
      expect(context.receiver.stats).toMatchObject({
        requested: null,
        prepared: null,
        captures: 0,
        readers: 0,
      })
    } finally {
      context.close()
    }
  },
)

it('distinguishes a receipt scheduling failure from invalid wire data', () => {
  const context = fixture()
  context.holdOffers()
  try {
    context.port.post(input('# Queued receipt'))
    context.flush()
    expect(context.incoming).toHaveLength(1)
    const defer = vi.spyOn(context.runtime, 'defer').mockImplementation(() => {
      throw new Error('Unable to schedule receipt')
    })
    try {
      context.releaseOffers()
      context.flush()
      expect(context.failureReasons).toEqual(['slice-schedule'])
      expect(context.receiver.stats).toMatchObject({
        requested: null,
        prepared: null,
        captures: 0,
        readers: 0,
      })
    } finally {
      defer.mockRestore()
    }
  } finally {
    context.close()
  }
})

it('distinguishes a cache construction failure after accepting a complete receipt', () => {
  const context = fixture()
  try {
    context.port.post(input('# Accepted receipt'))
    context.flush()
    expect(context.results.at(-1)?.kind).toBe('packed-result')
    const cache = vi.spyOn(context.receiver, 'cacheSteps').mockImplementation(() => {
      throw new Error('Invalid optional cache')
    })
    try {
      context.port.warm()
      context.flush()
      expect(context.failureReasons).toEqual(['packed-cache'])
      expect(context.receiver.stats).toMatchObject({
        requested: null,
        prepared: null,
        captures: 0,
        readers: 0,
      })
    } finally {
      cache.mockRestore()
    }
  } finally {
    context.close()
  }
})

it('keeps mandatory receipts independent of delayed optional cache callbacks', () => {
  const context = fixture(makeReceiver(), true)
  try {
    context.port.post(input('# Original\n\nBody'))
    context.flush()
    context.port.warm()
    expect(context.backgroundQueue).toHaveLength(1)
    expect(context.receiver.stats.cache).toEqual({
      document: false,
      projection: false,
      words: false,
    })
    context.port.post(input('# Latest\n\nBody', 1))
    context.flush(() => context.incoming.length === 2, false)
    // Deliver the offer, leaving mandatory receipt advancement queued in its own slot.
    context.queue.shift()?.()
    const before = context.receiver.stats
    context.backgroundQueue.shift()?.()
    expect(context.receiver.stats).toEqual(before)
    expect(context.results.map((result) => result.revision)).toEqual([0])
    context.flush(undefined, false)
    expect(context.results.map((result) => result.revision)).toEqual([0, 1])
    context.port.warm()
    context.flush()
    expect(context.receiver.stats.cache).toEqual({ document: true, projection: true, words: true })
    expect(context.failures).toBe(0)
  } finally {
    context.close()
  }
})

it.each(['cancel', 'terminate', 'failure'] as const)(
  'revokes an active background cache on %s while its callback stays queued',
  (action) => {
    const context = fixture(makeReceiver(), true)
    try {
      context.port.post(input(`# Original\n\n${'Body text.\n\n'.repeat(100)}`))
      context.flush()
      context.port.warm()
      context.backgroundQueue.shift()?.()
      expect(context.backgroundQueue).toHaveLength(1)
      if (action === 'failure') context.fail()
      else context.port[action]()
      const before = context.receiver.stats
      context.backgroundQueue.shift()?.()
      expect(context.receiver.stats).toEqual(before)
      expect(context.receiver.stats.readers).toBe(0)
      if (action === 'cancel') {
        context.port.post(input('# Replacement', 1))
        context.flush(undefined, false)
        expect(context.results.at(-1)).toMatchObject({ kind: 'packed-result', revision: 1 })
      }
    } finally {
      context.close()
    }
  },
)
function complete(capture: PackedCapture) {
  const output = finishPackedSteps(
    capture.serialize([], {
      bytes: 8 * MiB,
      workspace: 8 * MiB - 65536,
      nodes: 800000,
      depth: 128,
    }),
  )
  if (!output) throw new Error('Missing complete capture')
  try {
    return unpackValue(output.value.payload, {
      bytes: 8 * MiB,
      retained: 64 * MiB,
      staging: 8 * MiB,
    }).value
  } finally {
    output.release()
  }
}
function oracle(source: string) {
  const document = parseMarkdown(source)
  const { projection, layout } = renderProjectionLayout(
    document.root,
    options,
    semanticLimits.rendererBytes,
  )
  return {
    document: { ...document, timings: expect.any(Object) },
    projection: { ...projection, renderMs: expect.any(Number) },
    layout,
  }
}

it('accounts for complete receive work after validated delivery without exposing document data', () => {
  const context = fixture(),
    measures = vi.spyOn(performance, 'measure'),
    source = '# Private title 文档\n\n> **Bold** [link](/safe).\n\n```ts\nconst value = 1\n```',
    request = input(source),
    observations: unknown[] = []
  context.port.onResult((result) => {
    context.results.push(result)
    observations.push({
      acknowledged: context.commands.some(
        (value) => Reflect.get(value as object, 'kind') === 'ack',
      ),
      measured: measures.mock.calls.some(([name]) => name === 'manuslip:semantic-receive'),
    })
    if (result.kind === 'packed-result') expect(complete(result.capture)).toEqual(oracle(source))
  })
  try {
    context.port.post(request)
    context.flush()
    expect(context.failures).toBe(0)
    expect(context.results).toHaveLength(1)
    expect(observations).toEqual([{ acknowledged: true, measured: false }])
    const receipts = measures.mock.calls.filter(([name]) => name === 'manuslip:semantic-receive'),
      slices = measures.mock.calls.filter(([name]) => name === 'manuslip:semantic-receive-slice')
    expect(receipts).toHaveLength(1)
    const receipt = receipts[0]?.[1] as PerformanceMeasureOptions,
      detail = receipt.detail as Record<string, number | boolean>
    expect(detail).toEqual({
      sequence: request.sequence,
      revision: request.revision,
      accepted: true,
      slices: slices.length,
      maxSliceMs: expect.any(Number),
      activeMs: expect.any(Number),
    })
    expect(slices.length).toBeGreaterThan(1)
    expect(detail.activeMs).toBeGreaterThanOrEqual(detail.maxSliceMs as number)
    for (const [, options] of slices)
      expect((options as PerformanceMeasureOptions).detail).toEqual({
        sequence: request.sequence,
        revision: request.revision,
      })
  } finally {
    measures.mockRestore()
    context.close()
  }
})

it('never reports cancelled receive work as a completed receipt', () => {
  const context = fixture(),
    measures = vi.spyOn(performance, 'measure'),
    baseline = context.receiver.stats.retainedBytes
  try {
    context.port.post(input(`# Cancelled\n\n${'A paragraph.\n\n'.repeat(50)}`))
    context.flush(() =>
      measures.mock.calls.some(([name]) => name === 'manuslip:semantic-receive-slice'),
    )
    expect(context.results).toHaveLength(0)
    context.port.cancel()
    context.flush()
    expect(context.results).toHaveLength(0)
    expect(context.failures).toBe(0)
    expect(context.receiver.stats.retainedBytes).toBe(baseline)
    expect(measures.mock.calls.some(([name]) => name === 'manuslip:semantic-receive')).toBe(false)
  } finally {
    measures.mockRestore()
    context.close()
  }
})

it('keeps validated delivery and ownership intact when local receive diagnostics fail', () => {
  const context = fixture(),
    measures = vi.spyOn(performance, 'measure').mockImplementation(() => {
      throw new Error('Local timing unavailable')
    })
  try {
    context.port.post(input('# Still editable\n\n中文 **text**.'))
    context.flush()
    expect(context.failures).toBe(0)
    expect(context.results).toMatchObject([{ kind: 'packed-result', revision: 0 }])
    expect(
      context.commands.filter((value) => Reflect.get(value as object, 'kind') === 'ack'),
    ).toHaveLength(1)
    expect(context.receiver.stats).toMatchObject({ prepared: null, requested: null })
  } finally {
    measures.mockRestore()
    context.close()
  }
})

it('delivers borrowed captures only after complete validation/ACK and reuses real delta caches', () => {
  const context = fixture(),
    captures: PackedCapture[] = []
  context.port.onResult((result) => {
    context.results.push(result)
    if (result.kind === 'packed-result') captures.push(result.capture.retain())
  })
  try {
    const source =
      '# Heading\n\n> Nested [r] and note[^n]. مرحبا 中文\n\n[r]: /target\n\n[^n]: Note.\n\n' +
      'Unchanged stable paragraph 中文. '.repeat(128)
    for (let revision = 0; revision < 3; revision++) {
      const text = source.replace('Heading', `Heading ${revision}`)
      context.port.post(input(text, revision))
      context.flush()
      expect(context.receiver.stats.cachePhase).toBe(revision ? 'ready' : 'idle')
      context.port.warm()
      context.flush()
      expect(context.failures).toBe(0)
      const result = context.results.at(-1)
      if (result?.kind !== 'packed-result') throw new Error('No packed result')
      expect(() => result.capture.identity).toThrow(/released/)
      expect(result.certificate.matches(captures[revision] as PackedCapture)).toBe(false)
      expect(result.snapshot.retainedBytes).toBe(captures[revision]?.retainedBytes)
      expect(result.snapshot.retainedBytes).toBeGreaterThan(result.snapshot.bytes)
      expect(complete(captures[revision] as PackedCapture)).toEqual(oracle(text))
      expect(context.endpoint.stats).toMatchObject({
        dependencyCache: true,
        current: { revision },
        outgoingReservedBytes: 0,
      })
      expect(context.receiver.stats).toMatchObject({
        cache: { document: true, projection: true, words: true },
        prepared: null,
        requested: null,
      })
    }
    expect(context.incoming.map((value) => Reflect.get(value as object, 'kind'))).toEqual([
      'full',
      'delta',
      'delta',
    ])
    expect(
      context.commands.filter((value) => Reflect.get(value as object, 'kind') === 'ack'),
    ).toHaveLength(3)
    const initial = context.results[0],
      delta = context.results[1]
    if (initial?.kind !== 'packed-result' || delta?.kind !== 'packed-result')
      throw new Error('Missing packed revisions')
    expect(delta.snapshot.bytes).toBeLessThan(initial.snapshot.bytes)
    expect(delta.snapshot.retainedBytes).toBeGreaterThan(initial.snapshot.retainedBytes)
  } finally {
    for (const capture of captures) capture.release()
    context.close()
  }
})

it.each(['before-offer', 'validating', 'warming'] as const)(
  'supersedes %s work without publishing obsolete data',
  (phase) => {
    const context = fixture()
    try {
      context.port.post(input(`# Old\n\n${'A [r].\n\n'.repeat(100)}[r]: /target`))
      if (phase === 'validating') context.flush(() => context.incoming.length === 1)
      else if (phase === 'warming') {
        context.flush(() => context.results.length === 1)
        context.port.warm()
      }
      const published = context.results.length
      context.port.post(input('# Latest **current** 中文', 1))
      context.flush()
      expect(context.results.slice(published)).toMatchObject([
        { kind: 'packed-result', revision: 1 },
      ])
      expect(context.failures).toBe(0)
      expect(context.endpoint.stats.current?.revision).toBe(1)
    } finally {
      context.close()
    }
  },
)

it('ignores delayed ACK/cancel/offer traffic after a new request takes ownership', () => {
  const context = fixture()
  try {
    context.port.post(input('# Initial'))
    context.flush()
    const ack = context.commands.find((value) => Reflect.get(value as object, 'kind') === 'ack')
    const first = context.commands[0] as { exchange: PackedReceiveTicket }
    context.holdOffers()
    context.port.post(input('# Next', 1))
    context.flush()
    const before = context.endpoint.stats
    context.endpoint.receive(ack)
    context.endpoint.receive({
      kind: 'cancel',
      sequence: first.exchange.sequence,
      requestToken: first.exchange.requestToken,
    })
    expect(context.endpoint.stats).toEqual(before)
    context.deliver(context.incoming[0])
    context.releaseOffers()
    context.flush()
    expect(context.results.map((result) => result.revision)).toEqual([0, 1])
    expect(context.failures).toBe(0)
  } finally {
    context.close()
  }
})

it.each(['cancel', 'terminate'] as const)(
  'revokes queued receipt on %s before any acceptance',
  (action) => {
    const context = fixture()
    try {
      context.port.post(input(`# Pending\n\n${'Body\n\n'.repeat(100)}`))
      context.flush(() => context.incoming.length > 0)
      if (action === 'cancel') context.port.cancel()
      else context.port.terminate()
      context.flush()
      expect(context.results).toEqual([])
      expect(context.endpoint.stats.current).toBeNull()
      expect(context.receiver.stats).toMatchObject({
        requested: null,
        prepared: null,
        captures: 0,
        readers: 0,
      })
      expect(context.failures).toBe(0)
    } finally {
      context.close()
    }
  },
)

it('keeps old captures admitted through Worker failure/replacement in the same renderer session', () => {
  const receiver = makeReceiver(),
    first = fixture(receiver)
  let old: PackedCapture | undefined
  first.port.onResult((result) => {
    if (result.kind === 'packed-result') old = result.capture.retain()
  })
  try {
    first.port.post(input('# Accepted old\n\nBody'))
    first.flush()
    if (!old) throw new Error('No old consumer')
    first.fail()
    expect(first.failures).toBe(1)
    expect(old.identity.revision).toBe(0)
    expect(receiver.stats.retainedBytes).toBeGreaterThan(8192)
    const second = fixture(receiver)
    try {
      second.port.post(input('# New worker', 1))
      second.flush()
      expect(second.results).toMatchObject([{ kind: 'packed-result', revision: 1 }])
      expect(complete(old)).toEqual(oracle('# Accepted old\n\nBody'))
      expect(receiver.stats.retainedBytes).toBeLessThanOrEqual(64 * MiB)
      expect(second.failures).toBe(0)
    } finally {
      second.close(false)
    }
  } finally {
    old?.release()
    first.close()
  }
})

it('rejects malformed active data without ACK and leaves stale traffic harmless', () => {
  const context = fixture()
  try {
    context.holdOffers()
    context.port.post(input('# Validation'))
    context.flush()
    const offer = context.incoming[0] as Record<string, unknown>
    context.deliver({ ...offer, requestToken: 'stale', protocol: 'wrong' })
    expect(context.failures).toBe(0)
    context.deliver({ ...offer, protocol: 'wrong' })
    expect(context.failures).toBe(1)
    expect(context.terminated).toBe(true)
    expect(context.commands.some((value) => Reflect.get(value as object, 'kind') === 'ack')).toBe(
      false,
    )
    expect(context.results).toEqual([])
  } finally {
    context.close()
  }
})

it('rejects malformed endpoint controls before disturbing a valid transferred offer', () => {
  const context = fixture()
  try {
    context.holdOffers()
    context.port.post(input('# Still pending'))
    context.flush()
    const offer = context.incoming[0] as {
      protocol: string
      sequence: number
      requestToken: string
      resultToken: string
      result: { revision: number }
    }
    const before = context.endpoint.stats
    expect(() =>
      context.endpoint.receive({
        kind: 'prepare',
        input: {},
        exchange: (context.commands[0] as { exchange: unknown }).exchange,
      }),
    ).toThrow()
    expect(() =>
      context.endpoint.receive({
        kind: 'ack',
        acknowledgement: {
          protocol: offer.protocol,
          kind: 'accepted',
          sequence: offer.sequence,
          requestToken: offer.requestToken,
          resultToken: offer.resultToken,
          result: { ...offer.result, revision: 999 },
        },
      }),
    ).toThrow()
    const getter = vi.fn(() => 'cancel')
    expect(() =>
      context.endpoint.receive(Object.defineProperty({}, 'kind', { get: getter })),
    ).toThrow()
    expect(getter).not.toHaveBeenCalled()
    expect(() =>
      context.endpoint.receive({
        kind: 'cancel',
        sequence: offer.sequence,
        requestToken: offer.requestToken,
        extra: true,
      }),
    ).toThrow()
    expect(context.endpoint.stats).toEqual(before)
    context.releaseOffers()
    context.flush()
    expect(context.results).toMatchObject([{ kind: 'packed-result' }])
    expect(context.failures).toBe(0)
  } finally {
    context.close()
  }
})

// Full parser-capacity rejection took 15–16 s on the instrumented Intel CI runner.
it('returns a correlated semantic limit error for a valid request exceeding parser capacity', () => {
  const context = fixture()
  try {
    context.port.post(input('p\n\n'.repeat(semanticLimits.blocks + 1)))
    context.flush()
    expect(context.results).toMatchObject([{ kind: 'error', code: 'semantic-limit', revision: 0 }])
    expect(context.failures).toBe(0)
    expect(context.endpoint.stats).toMatchObject({ prepared: null, requested: null, phase: 'idle' })
  } finally {
    context.close()
  }
}, 30_000)

it('bounds full resync attempts when the complete result cannot fit receiver admission', () => {
  const context = fixture(makeReceiver(80 * 1024))
  try {
    context.port.post(input(`# Capacity\n\n${'p\n\n'.repeat(1000)}`))
    context.flush()
    expect(context.results).toMatchObject([{ kind: 'error', code: 'semantic-limit' }])
    expect(
      context.commands.filter((value) => Reflect.get(value as object, 'kind') === 'prepare'),
    ).toHaveLength(2)
    expect(context.commands.some((value) => Reflect.get(value as object, 'kind') === 'ack')).toBe(
      false,
    )
    expect(context.failures).toBe(0)
    expect(context.receiver.stats).toMatchObject({
      current: null,
      requested: null,
      prepared: null,
      captures: 0,
    })
  } finally {
    context.close()
  }
})

it('declines optional warmup when independent readers exhaust capture admission', () => {
  const context = fixture(),
    captures: PackedCapture[] = []
  try {
    context.port.post(input('# Accepted current'))
    context.flush()
    for (let index = 0; index < 8; index++) captures.push(context.receiver.capture())
    const before = context.receiver.stats
    expect(() => context.port.warm()).not.toThrow()
    context.flush()
    expect(context.receiver.stats).toEqual(before)
    expect(context.failures).toBe(0)
    expect(context.results).toMatchObject([{ kind: 'packed-result' }])
    for (const capture of captures.splice(0)) capture.release()
    context.port.warm()
    context.flush()
    expect(context.receiver.stats.cache).toEqual({ document: true, projection: true, words: true })
  } finally {
    for (const capture of captures) capture.release()
    context.close()
  }
})

it('retains service debounce/backpressure and rejects stale same-revision policy results', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const context = fixture(),
    events: SemanticEvent[] = []
  const service = new SemanticService(() => context.port)
  const connection = service.connect('port', (event) => events.push(event))
  try {
    const first = vi.fn(() => '# Unpublished'),
      latest = vi.fn(() => '# Latest')
    connection.request(1, first, options)
    await vi.advanceTimersByTimeAsync(100)
    connection.request(1, latest, { ...options, rawHtml: true })
    await vi.advanceTimersByTimeAsync(150)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
    connection.request(1, () => '# Final policy', options)
    await vi.advanceTimersByTimeAsync(150)
    context.flush()
    const delivered = events.filter((event) => event.kind === 'packed-snapshot')
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.revision).toBe(1)
    expect(context.failures).toBe(0)
  } finally {
    connection.dispose()
    service.dispose()
    context.close()
  }
})

it.each(['message', 'failure'] as const)(
  'recovers from repeated %s setup failures without leaking reservations or old captures',
  async (stage) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const receiver = makeReceiver()
    const previous = fixture(receiver)
    const contexts: ReturnType<typeof fixture>[] = []
    const revisions: number[] = []
    let old: PackedCapture | undefined
    previous.port.onResult((result) => {
      if (result.kind === 'packed-result') old = result.capture.retain()
    })
    let created = 0
    const terminate = vi.fn()
    const service = new SemanticService(() => {
      if (++created <= 3)
        return new PackedSemanticPort(
          {
            onMessage() {
              if (stage === 'message') throw new Error('Message registration failed')
            },
            onFailure() {
              if (stage === 'failure') throw new Error('Failure registration failed')
            },
            post: () => {
              throw new Error('Uninitialized channel must not receive a request')
            },
            terminate,
          },
          receiver,
        )
      const context = fixture(receiver)
      contexts.push(context)
      return context.port
    })
    const connection = service.connect('port', (event) => {
      if (event.kind === 'packed-snapshot') {
        revisions.push(event.revision)
        expect(complete(event.capture)).toEqual(
          oracle(event.revision === 3 ? '# Recovery\n\nBody 界😀' : '# Newest\n\nBody 界😀'),
        )
      }
    })
    try {
      previous.port.post(input('# Previous\n\nIndependent consumer 界😀'))
      previous.flush()
      previous.fail()
      if (!old) throw new Error('Missing independent old capture')
      const retained = receiver.stats
      connection.request(3, () => '# Recovery\n\nBody 界😀', options)
      await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
      expect(created).toBe(4)
      expect(terminate).toHaveBeenCalledTimes(3)
      expect(contexts).toHaveLength(1)
      contexts[0]?.flush()
      expect(revisions).toEqual([3])
      connection.request(4, () => '# Newest\n\nBody 界😀', options)
      await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
      contexts[0]?.flush()
      expect(revisions).toEqual([3, 4])
      expect(complete(old)).toEqual(oracle('# Previous\n\nIndependent consumer 界😀'))
      await vi.advanceTimersByTimeAsync(semanticLimits.watchdog)
      expect(created).toBe(4)
      expect(contexts[0]?.terminated).toBe(false)
      connection.dispose()
      service.dispose()
      expect(receiver.stats).toEqual(retained)
    } finally {
      connection.dispose()
      service.dispose()
      for (const context of contexts) context.close(false)
      old?.release()
      previous.close()
    }
  },
)

it('keeps one replacement packed port after a real channel send reports failure and throws', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const receiver = makeReceiver(),
    contexts: ReturnType<typeof fixture>[] = [],
    revisions: number[] = [],
    sourceQueue: (() => void)[] = []
  let created = 0,
    terminated = 0
  const service = new SemanticService(() => {
    if (++created === 1)
      return new PackedSemanticPort(
        {
          onMessage: () => {},
          onFailure: () => {},
          post: () => {
            throw new Error('Channel send failed')
          },
          terminate: () => terminated++,
        },
        receiver,
        { now: () => 0, defer: (run) => sourceQueue.push(run) },
      )
    const context = fixture(receiver)
    contexts.push(context)
    return context.port
  })
  const connection = service.connect('port', (event) => {
    if (event.kind === 'packed-snapshot') {
      revisions.push(event.revision)
      expect(
        event.capture.reader.scalar(['document', 'root', 'children', 0, 'children', 0, 'value'], {
          retained: 1024,
          staging: 1024,
        }),
      ).toBe(event.revision === 3 ? 'Recovery' : 'Newest')
    }
  })
  try {
    connection.request(3, () => '# Recovery\n\nBody 界😀', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    expect(created).toBe(1)
    sourceQueue.shift()?.()
    expect(created).toBe(2)
    expect(terminated).toBe(1)
    expect(contexts).toHaveLength(1)
    const replacement = contexts[0]
    expect(replacement?.terminated).toBe(false)
    expect(replacement?.commands).toEqual([])
    replacement?.flush(() => (replacement?.commands.length ?? 0) > 0)
    expect(replacement?.commands).toEqual([
      expect.objectContaining({
        kind: 'prepare',
        input: expect.objectContaining({ sequence: 2, revision: 3 }),
      }),
    ])
    replacement?.flush()
    expect(revisions).toEqual([3])
    connection.request(4, () => '# Newest\n\nBody', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    replacement?.flush()
    expect(revisions).toEqual([3, 4])
    await vi.advanceTimersByTimeAsync(semanticLimits.watchdog)
    expect(created).toBe(2)
    expect(replacement?.terminated).toBe(false)
  } finally {
    connection.dispose()
    service.dispose()
    for (const context of contexts) context.close(false)
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
})

it('keeps an acknowledged packed base and reentrant request after a consumer throws', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let newestHeading: unknown
  const receiver = makeReceiver(),
    contexts: ReturnType<typeof fixture>[] = [],
    revisions: number[] = []
  const service = new SemanticService(() => {
    const context = fixture(receiver)
    contexts.push(context)
    return context.port
  })
  const connection = service.connect('port', (event) => {
    if (event.kind !== 'packed-snapshot') return
    revisions.push(event.revision)
    if (event.revision === 0) {
      connection.request(1, () => '# Newest\n\nBody 界😀', options)
      connection.retry()
      throw new Error('Consumer failed after requesting the newest revision')
    }
    newestHeading = event.capture.reader.scalar(
      ['document', 'root', 'children', 0, 'children', 0, 'value'],
      { retained: 1024, staging: 1024 },
    )
  })
  try {
    connection.request(0, () => '# Original\n\nBody 界😀', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    contexts[0]?.flush()
    expect(contexts).toHaveLength(1)
    const context = contexts[0]
    expect(context?.terminated).toBe(false)
    expect(revisions).toEqual([0, 1])
    expect(newestHeading).toBe('Newest')
    expect(context?.incoming.map((message) => (message as { kind: string }).kind)).toEqual([
      'full',
      'delta',
    ])
    expect(receiver.stats.current?.revision).toBe(1)
    expect(receiver.stats).toMatchObject({
      prepared: null,
      captures: 0,
      readers: 0,
      readerStagingBytes: 0,
    })
    connection.warm()
    context?.flush()
    expect(receiver.stats.cache).toEqual({ document: true, projection: true, words: true })
    await vi.advanceTimersByTimeAsync(semanticLimits.watchdog)
    expect(contexts).toHaveLength(1)
    expect(context?.terminated).toBe(false)
  } finally {
    connection.dispose()
    service.dispose()
    for (const context of contexts) context.close(false)
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
})

it('keeps a packed worker after a throwing semantic-limit consumer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const receiver = makeReceiver(),
    contexts: ReturnType<typeof fixture>[] = []
  const service = new SemanticService(() => {
    const context = fixture(receiver)
    contexts.push(context)
    return context.port
  })
  const events: SemanticEvent[] = []
  const connection = service.connect('port', (event) => {
    events.push(event)
    if (event.kind === 'error' && event.code === 'semantic-limit')
      throw new Error('Consumer failed')
  })
  try {
    connection.request(0, () => 'a\n\n'.repeat(semanticLimits.blocks + 1), options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    contexts[0]?.flush()
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.terminated).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'error', code: 'semantic-limit', paused: false })
    connection.request(1, () => '# Retry\n\nBody', options)
    await vi.advanceTimersByTimeAsync(semanticLimits.debounce)
    contexts[0]?.flush()
    expect(events.at(-1)).toMatchObject({ kind: 'packed-snapshot', revision: 1 })
    expect(receiver.stats).toMatchObject({
      prepared: null,
      captures: 0,
      readers: 0,
      readerStagingBytes: 0,
    })
    await vi.advanceTimersByTimeAsync(semanticLimits.watchdog)
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.terminated).toBe(false)
  } finally {
    connection.dispose()
    service.dispose()
    for (const context of contexts) context.close(false)
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
}, 30_000)

it('applies the service watchdog/restart limit to packed workers and supports explicit retry', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const receiver = makeReceiver(),
    contexts: ReturnType<typeof fixture>[] = [],
    events: SemanticEvent[] = []
  const service = new SemanticService(() => {
    const next = fixture(receiver)
    contexts.push(next)
    return next.port
  })
  const connection = service.connect('port', (event) => events.push(event))
  try {
    connection.request(3, () => '# Watchdog newest', options)
    await vi.advanceTimersByTimeAsync(150 + semanticLimits.watchdog * 4)
    expect(contexts).toHaveLength(4)
    expect(contexts.every((context) => context.terminated)).toBe(true)
    expect(events.at(-1)).toEqual({ kind: 'error', code: 'semantic-worker', paused: true })
    expect(receiver.stats).toMatchObject({
      current: null,
      requested: null,
      prepared: null,
      captures: 0,
      readers: 0,
    })
    connection.retry()
    expect(contexts).toHaveLength(5)
    contexts[4]?.flush()
    expect(events.at(-1)).toMatchObject({ kind: 'packed-snapshot', revision: 3 })
  } finally {
    connection.dispose()
    service.dispose()
    for (const context of contexts) context.close(false)
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
})

it.each(['accepted', 'capture-limit', 'prepare-limit', 'invalid-preparation'] as const)(
  'installs an owned packed model or handles %s without restarting the Worker',
  async (mode) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const context = fixture()
    let workers = 0
    const subscribe = context.port.onResult.bind(context.port)
    context.port.onResult = (listener) =>
      subscribe((result) => {
        const held: PackedCapture[] = []
        let preparation: ReturnType<typeof vi.spyOn> | undefined
        try {
          if (result.kind === 'packed-result' && mode === 'capture-limit') {
            for (let index = 1; index < 8; index++) held.push(result.capture.retain())
          } else if (mode === 'prepare-limit' || mode === 'invalid-preparation') {
            preparation = vi.spyOn(OwnedPackedPreview, 'prepare').mockImplementationOnce(() => {
              throw new Error(
                mode === 'prepare-limit'
                  ? 'Packed preview exceeds retained limit'
                  : 'Invalid packed preview',
              )
            })
          }
          listener(result)
        } finally {
          preparation?.mockRestore()
          for (const capture of held) capture.release()
        }
      })
    const service = new SemanticService(() => {
      workers++
      return context.port
    })
    const publications = new PreviewStatusPublication(),
      ui = publications.subscribe()
    let state = createSourceState('# Heading\n\nBody **strong** 中文\n\n```js\nlet x = 1\n```\n'),
      revision = 0
    let status = { ...initialPreviewStatus }
    const preview = new DocumentPreview(
      {
        id: 'port',
        state: () => state,
        view: () => null,
        revision: () => revision,
        bytes: () => state.doc.length,
        dispatch(spec: TransactionSpec) {
          const transaction = state.update(spec)
          state = transaction.state
          if (transaction.docChanged) revision++
          preview.changed([transaction])
        },
        status: (patch) => {
          status = { ...status, ...patch }
        },
        reserveStatus: (acquire) => {
          const reservation = publications.prepare(acquire)
          return {
            publish: (patch) => {
              status = { ...status, ...patch, previewPublication: reservation.publish() }
            },
            release: () => reservation.release(),
          }
        },
        openLink: () => {},
      },
      () => service,
      context.runtime,
    )
    state = state.update({ effects: StateEffect.appendConfig.of(preview.extensions) }).state
    let reading: Awaited<ReturnType<DocumentPreview['captureReading']>> | undefined
    try {
      preview.attach()
      await vi.advanceTimersByTimeAsync(150)
      context.flush()
      expect(workers).toBe(1)
      expect(context.failures).toBe(0)
      if (mode !== 'accepted') {
        expect(status).toMatchObject({
          mode: 'source',
          semantic: mode === 'invalid-preparation' ? 'error' : 'limit',
          semanticError: mode === 'invalid-preparation' ? 'semantic-parse' : 'semantic-limit',
        })
        expect(preview.currentSnapshot()).toBeNull()
        expect(context.receiver.stats.captures).toBe(0)
        return
      }
      expect(status.semantic).toBe('ready')
      expect(preview.currentSnapshot()).toMatchObject({ kind: 'packed' })
      expect(status.outline[0]?.text).toBe('Heading')
      expect(status.wordCount).toBe(parseMarkdown(state.doc.toString()).counts.words)
      reading = await preview.captureReading(revision, new AbortController().signal)
      if (reading.kind !== 'packed') throw new Error('Reading expanded the native AST')
      expect(reading.retainedBytes).toBe(reading.capture.retainedBytes)
      expect(reading.path).toEqual(['document', 'root'])
      expect(reading.capture.identity.parserVersion).toBe(`${parserVersion}/manuslip`)
      preview.suspend()
      expect(reading.capture.identity.revision).toBe(0)
      expect(publications.stats.publications).toBe(1)
      ui.acknowledge(status.previewPublication)
      expect(context.failures).toBe(0)
      expect(context.receiver.stats.retainedBytes).toBeLessThanOrEqual(64 * MiB)
    } finally {
      if (reading?.kind === 'packed') reading.capture.release()
      ui.release()
      publications.close()
      preview.dispose()
      service.dispose()
      context.close()
    }
  },
)
