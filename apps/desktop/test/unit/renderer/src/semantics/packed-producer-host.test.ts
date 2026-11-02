import { parserVersion, semanticLimits, sourceHash } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import { expect, it, vi } from 'vitest'
import { unpackValue } from '../../../../../../../packages/core/src/packing'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { parseMarkdown } from '../../../../../../../packages/core/src/parse'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import {
  PackedProducerHost,
  type ProducerHostOutput,
  type ProducerSourceEvents,
} from '../../../../../src/renderer/src/semantics/packed-producer-host'
import { PackedSemanticReceiver } from '../../../../../src/renderer/src/semantics/packed-receiver'
import { absoluteNow, type ParseRequest } from '../../../../../src/renderer/src/semantics/protocol'

const MiB = 1024 * 1024
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
function fixture(profile = false, transfer = true, idleMs = 0) {
  const queue: (() => void)[] = []
  const messages: ProducerHostOutput[] = []
  const errors: unknown[] = []
  let clock = 0
  let sequence = 0
  let postFailure: false | 'before' | 'after' = false
  let deferFailure = false
  const host = new PackedProducerHost(
    {
      post(value, buffers) {
        if (postFailure === 'before') throw new Error('Closed channel')
        messages.push(structuredClone(value, { transfer: transfer ? buffers : [] }))
        if (postFailure === 'after') throw new Error('Channel failed after transfer')
      },
      failed: (error) => errors.push(error),
    },
    {
      now: () => clock++,
      defer: (run) => {
        if (deferFailure) throw new Error('Scheduler unavailable')
        queue.push(run)
      },
    },
    profile,
  )
  const receiver = new PackedSemanticReceiver(limits, {
    retained: 32 * MiB,
    staging: 8 * MiB,
    nodes: 800000,
    depth: 128,
  })
  const flush = () => {
    let advances = 0
    while (queue.length) {
      if (++advances > 100000) throw new Error('Worker did not settle')
      clock += idleMs
      queue.shift()?.()
    }
  }
  const begin = (text: string, revision = 0) => {
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'host',
        revision,
        sourceHash: sourceHash(text),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const input: ParseRequest = {
      kind: 'parse',
      sequence: ++sequence,
      generation: 1,
      documentId: 'host',
      revision,
      source: text,
      options: { ...options },
      sentAt: absoluteNow(),
    }
    const ticket = receiver.begin(sequence, source, options)
    return { input, ticket }
  }
  const prepare = (text: string, revision = 0) => {
    const request = begin(text, revision)
    host.prepare(request.input, structuredClone(request.ticket))
    return request
  }
  const accept = (request: ReturnType<typeof begin>) => {
    flush()
    const output = messages.at(-1)
    if (output?.kind !== 'offer') throw new Error('No offer')
    expect(output.message.payload.byteLength).toBeGreaterThan(0)
    expect(host.stats.phase).toBe('offered')
    const accepted = finishPackedSteps(receiver.receiveSteps(request.ticket, output.message))
    if (accepted?.kind !== 'accepted') throw new Error('No accepted result')
    const encoded = finishPackedSteps(
      accepted.capture.serialize([], {
        bytes: limits.bytes,
        workspace: limits.staging - 65536,
        nodes: 800000,
        depth: 128,
      }),
    )
    if (!encoded) throw new Error('No complete result')
    try {
      const result = unpackValue(encoded.value.payload, limits).value
      const document = parseMarkdown(request.input.source)
      const { projection, layout } = renderProjectionLayout(
        document.root,
        options,
        semanticLimits.rendererBytes,
      )
      expect(result).toEqual({
        document: { ...document, timings: expect.any(Object) },
        projection: { ...projection, renderMs: expect.any(Number) },
        layout,
      })
    } finally {
      encoded.release()
      accepted.capture.release()
    }
    host.acknowledge(structuredClone(accepted.acknowledgement))
    expect(host.stats.current?.revision).toBe(request.input.revision)
    return { output, acknowledgement: accepted.acknowledgement }
  }
  return {
    host,
    emptyRetained: host.stats.retainedBytes,
    receiver,
    queue,
    messages,
    errors,
    begin,
    prepare,
    accept,
    flush,
    breakChannel: (when: 'before' | 'after' = 'before') => {
      postFailure = when
    },
    breakScheduler: () => {
      deferFailure = true
    },
    close() {
      host.dispose()
      receiver.dispose()
      flush()
      expect(host.stats.retainedBytes).toBe(0)
      expect(host.stats.readers).toBe(0)
      expect(host.stats.captures).toBe(0)
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  }
}

function sourceEvents() {
  const states: string[] = [],
    failures: unknown[] = []
  const events: ProducerSourceEvents = {
    queued: () => {
      states.push('queued')
    },
    activated: () => {
      states.push('activated')
    },
    cancelled: () => {
      states.push('cancelled')
    },
    failed: (error) => {
      states.push('failed')
      failures.push(error)
    },
  }
  return { states, failures, events }
}

it('prepares complete cooperative Worker sources and warmed deltas under one callback slot', () => {
  const context = fixture(true)
  try {
    const text = '# Heading\n\n> Nested [link][r]. مرحبا 中文\n\n[r]: https://example.invalid/\n'
    for (let revision = 0; revision < 3; revision++) {
      const pending = context.begin(text.replace('Heading', `Heading ${revision}`), revision)
      const events = sourceEvents()
      context.host.prepareCooperative(pending.input, structuredClone(pending.ticket), events.events)
      expect(events.states).toEqual(['queued'])
      expect(context.queue).toHaveLength(1)
      const accepted = context.accept(pending)
      expect(events.states).toEqual(['queued', 'activated'])
      expect(accepted.output.message.kind).toBe(revision ? 'delta' : 'full')
      expect(accepted.output.report?.steps).toBeGreaterThan(1)
      expect(events.failures).toEqual([])
      context.host.cache()
      context.flush()
    }
    expect(context.errors).toEqual([])
  } finally {
    context.close()
  }
})

it('keeps a valid pending offer after a candidate source digest fails', () => {
  const context = fixture()
  try {
    const old = context.prepare('# Valid offer')
    context.flush()
    const events = sourceEvents(),
      text = 'x'.repeat(9000)
    context.host.prepareCooperative(
      { ...old.input, sequence: 2, revision: 1, source: text },
      {
        ...old.ticket,
        sequence: 2,
        identity: { ...old.ticket.identity, revision: 1, sourceHash: 'claimed:wrong' },
      },
      events.events,
    )
    context.flush()
    expect(events.states).toEqual(['queued', 'failed'])
    expect(String(events.failures[0])).toContain('source mismatch')
    expect(context.host.stats.phase).toBe('offered')
    expect(context.messages).toHaveLength(1)
    context.accept(old)
    expect(context.errors).toEqual([])
  } finally {
    context.close()
  }
})

it('keeps a valid offer after an actual suspended source read fails', () => {
  const context = fixture(true),
    text = 'x'.repeat(9000),
    original = String.prototype.charCodeAt
  let reads = 0
  try {
    const old = context.prepare('# Valid offer')
    context.flush()
    const events = sourceEvents()
    context.host.prepareCooperative(
      { ...old.input, sequence: 2, revision: 1, source: text },
      {
        ...old.ticket,
        sequence: 2,
        identity: { ...old.ticket.identity, revision: 1, sourceHash: sourceHash(text) },
      },
      events.events,
    )
    String.prototype.charCodeAt = function (index) {
      if (this === text && ++reads === 4097) throw new Error('source read failure')
      return original.call(this, index)
    }
    context.queue.shift()?.()
    expect(reads).toBe(4096)
    context.flush()
    expect(reads).toBe(4097)
    expect(events.states).toEqual(['queued', 'failed'])
    expect(context.host.stats.phase).toBe('offered')
    String.prototype.charCodeAt = original
    context.accept(old)
    expect(context.errors).toEqual([])
  } finally {
    String.prototype.charCodeAt = original
    context.close()
  }
})

it('supersedes only the pending scan and sends the newest immutable source', () => {
  const context = fixture()
  try {
    const first = context.begin('a'.repeat(9000)),
      old = sourceEvents()
    context.host.prepareCooperative(first.input, structuredClone(first.ticket), old.events)
    const next = context.begin('# Current\n\n[link][r]\n\n[r]: https://example.invalid/', 1),
      latest = sourceEvents()
    context.host.prepareCooperative(next.input, structuredClone(next.ticket), latest.events)
    const expected = { ...next, input: structuredClone(next.input) }
    next.input.source = 'changed'
    next.input.options.rawHtml = true
    expect(context.queue).toHaveLength(1)
    expect(old.states).toEqual(['queued', 'cancelled'])
    context.accept(expected)
    expect(context.messages.filter((row) => row.kind === 'offer')).toHaveLength(1)
    expect(latest.states).toEqual(['queued', 'activated'])
  } finally {
    context.close()
  }
})

it('does not cancel a queued candidate when new metadata is invalid', () => {
  const context = fixture()
  try {
    const pending = context.begin('# Keep queued'),
      events = sourceEvents()
    context.host.prepareCooperative(pending.input, structuredClone(pending.ticket), events.events)
    expect(() =>
      context.host.prepareCooperative(
        { ...pending.input, sequence: 2 },
        pending.ticket,
        sourceEvents().events,
      ),
    ).toThrow('sequence mismatch')
    context.accept(pending)
    expect(events.states).toEqual(['queued', 'activated'])
  } finally {
    context.close()
  }
})

it('can cancel the current offer while preserving its pending source candidate', () => {
  const context = fixture()
  try {
    context.prepare('# Previous')
    const next = context.begin('# New source', 1),
      events = sourceEvents()
    context.host.prepareCooperative(next.input, structuredClone(next.ticket), events.events)
    context.host.cancelOffer()
    context.accept(next)
    expect(events.states).toEqual(['queued', 'activated'])
    expect(context.errors).toEqual([])
  } finally {
    context.close()
  }
})

it('does not revoke an existing offer when provisional Worker admission fails', () => {
  const context = fixture()
  try {
    const old = context.prepare('# Valid offer')
    context.flush()
    const key = {},
      bytes = semanticLimits.workerCacheBytes - context.host.stats.retainedBytes - 4096,
      held = context.host.retain({
        resources: () => [{ key, bytes }],
      })
    try {
      expect(() =>
        context.host.prepareCooperative(
          { ...old.input, sequence: 2, revision: 1, source: 'x'.repeat(9000) },
          {
            ...old.ticket,
            sequence: 2,
            identity: {
              ...old.ticket.identity,
              revision: 1,
              sourceHash: sourceHash('x'.repeat(9000)),
            },
          },
          sourceEvents().events,
        ),
      ).toThrow('retained limit')
      expect(context.host.stats.phase).toBe('offered')
    } finally {
      held.release()
    }
    context.accept(old)
  } finally {
    context.close()
  }
})

it('closes provisional source ownership when the Worker scheduler rejects it', () => {
  const context = fixture(),
    pending = context.begin('x'.repeat(9000)),
    events = sourceEvents()
  try {
    context.breakScheduler()
    context.host.prepareCooperative(pending.input, structuredClone(pending.ticket), events.events)
    expect(events.states).toEqual(['queued', 'failed'])
    expect(String(events.failures[0])).toContain('Scheduler unavailable')
    expect(context.host.stats.retainedBytes).toBe(context.emptyRetained)
    expect(context.queue).toHaveLength(0)
  } finally {
    context.close()
  }
})

it('transfers complete output and commits only exact ACKs across warmed real deltas', () => {
  const context = fixture()
  try {
    const text = '# Heading\n\n> Nested [link][r]. مرحبا 中文\n\n[r]: https://example.invalid/\n'
    const first = context.accept(context.prepare(text))
    expect(first.output.message.kind).toBe('full')
    expect(first.output.report).toBeUndefined()
    context.host.cache()
    context.flush()
    expect(context.messages.at(-1)).toEqual({ kind: 'cached', ready: true })
    expect(context.host.stats.dependencyCache).toBe(true)
    for (let revision = 1; revision <= 2; revision++) {
      const pending = context.prepare(text.replace('Heading', `Heading ${revision}`), revision)
      expect(context.host.stats.current?.revision).toBe(revision - 1)
      context.flush()
      expect(() => context.host.acknowledge(first.acknowledgement)).toThrow()
      expect(context.host.stats.phase).toBe('offered')
      expect(context.accept(pending).output.message.kind).toBe('delta')
      expect(context.host.stats).toMatchObject({
        dependencyCache: true,
        outgoingReservedBytes: 0,
        readerStagingBytes: 0,
        requested: null,
        prepared: null,
      })
    }
    expect(context.errors).toEqual([])
  } finally {
    context.close()
  }
})

it.each(['queued', 'running'] as const)(
  'supersedes %s work with one bounded deferred callback',
  (phase) => {
    const context = fixture()
    try {
      context.prepare(`# Obsolete\n\n${'p\n\n'.repeat(200)}`)
      if (phase === 'running') context.queue.shift()?.()
      for (let revision = 1; revision <= 30; revision++) {
        context.prepare(`# Superseded ${revision}`, revision)
        expect(context.queue.length).toBe(1)
      }
      const latest = context.prepare('# Current 中文', 31)
      context.accept(latest)
      expect(context.messages.length).toBe(1)
      expect(context.errors).toEqual([])
    } finally {
      context.close()
    }
  },
)

it.each(['queued', 'running'] as const)(
  'cancels %s work without a stale publication or error',
  (phase) => {
    const context = fixture()
    try {
      context.prepare(`# Cancelled\n\n${'p\n\n'.repeat(200)}`)
      if (phase === 'running') context.queue.shift()?.()
      context.host.cancel()
      context.flush()
      expect(context.messages).toEqual([])
      expect(context.errors).toEqual([])
      expect(context.host.stats.retainedBytes).toBe(context.emptyRetained)
      context.accept(context.prepare('# Restarted', 1))
    } finally {
      context.close()
    }
  },
)

it('validates malformed requests and ACKs before disturbing queued warmup', () => {
  const context = fixture()
  try {
    const first = context.accept(context.prepare(`# Heading\n\n${'p\n\n'.repeat(200)}`))
    context.host.cache()
    context.queue.shift()?.()
    const before = context.host.stats
    expect(() => context.host.prepare({}, {})).toThrow()
    expect(() => context.host.acknowledge(first.acknowledgement)).toThrow()
    expect(() => context.host.cache()).toThrow()
    expect(context.host.stats).toEqual(before)
    expect(context.queue.length).toBe(1)
    context.flush()
    expect(context.messages.at(-1)).toEqual({ kind: 'cached', ready: true })
  } finally {
    context.close()
  }
})

it('supersedes partial optional warmup while preserving the accepted base', () => {
  const context = fixture()
  try {
    const text = `# Heading\n\n${'p\n\n'.repeat(200)}`
    context.accept(context.prepare(text))
    context.host.cache()
    for (let index = 0; index < 12; index++) context.queue.shift()?.()
    context.accept(context.prepare(text.replace('Heading', 'New heading'), 1))
    expect(context.messages.map((message) => message.kind)).toEqual(['offer', 'offer'])
    expect(context.host.stats.dependencyCache).toBe(true)
    expect(context.errors).toEqual([])
  } finally {
    context.close()
  }
})

it.each(['queued', 'running', 'warmup', 'offered'] as const)(
  'disposes %s work before queued callbacks resume',
  (phase) => {
    const context = fixture()
    try {
      const request = context.prepare(`# Heading\n\n${'p\n\n'.repeat(200)}`)
      if (phase === 'running') context.queue.shift()?.()
      else if (phase === 'offered') context.flush()
      else if (phase === 'warmup') {
        context.accept(request)
        context.host.cache()
        context.queue.shift()?.()
      }
      const published = context.messages.length
      context.host.dispose()
      context.flush()
      expect(context.messages.length).toBe(published)
      expect(context.errors).toEqual([])
      expect(context.host.stats).toMatchObject({ phase: 'disposed', retainedBytes: 0 })
      expect(() => context.host.prepare(request.input, request.ticket)).toThrow(/disposed/)
      expect(() => context.host.cache()).toThrow(/disposed/)
      expect(() => context.host.acknowledge({})).toThrow(/disposed/)
    } finally {
      context.close()
    }
  },
)

it.each(['throws', 'does not transfer', 'throws after transfer'] as const)(
  'releases pending publication when channel %s',
  (failure) => {
    const context = fixture(false, failure !== 'does not transfer')
    try {
      if (failure === 'throws') context.breakChannel()
      if (failure === 'throws after transfer') context.breakChannel('after')
      context.prepare('# Channel failure')
      context.flush()
      expect(context.errors).toHaveLength(1)
      expect(context.host.stats).toMatchObject({
        phase: 'idle',
        retainedBytes: context.emptyRetained,
        outgoingReservedBytes: 0,
        prepared: null,
        requested: null,
      })
    } finally {
      context.close()
    }
  },
)

it('reports optional measurements and a valid declined cache result', () => {
  const context = fixture(true)
  try {
    const first = context.accept(context.prepare('\ufeff# Heading\n'))
    expect(first.output.report?.steps).toBeGreaterThan(0)
    expect(first.output.report?.peakRetainedBytes).toBeLessThanOrEqual(16 * MiB)
    context.host.cache()
    context.flush()
    expect(context.messages.at(-1)).toMatchObject({ kind: 'cached', ready: false, report: {} })
    expect(context.host.stats).toMatchObject({ phase: 'idle', dependencyCache: false })
    expect(context.errors).toEqual([])
  } finally {
    context.close()
  }
})

it.each([false, true])(
  'excludes queued idle and source-candidate work from full and delta serialization with profile=%s',
  (profile) => {
    const timer = vi.spyOn(performance, 'now').mockReturnValue(0)
    const measure = (idleMs: number, candidate: boolean) => {
      const context = fixture(profile, true, idleMs)
      try {
        const first = context.prepare('# Clock\n\nBody with **emphasis**.\n')
        if (candidate) {
          context.queue.shift()?.()
          const events = sourceEvents()
          context.host.prepareCooperative(
            { ...first.input, sequence: 2, revision: 1, source: 'x'.repeat(90000) },
            {
              ...first.ticket,
              sequence: 2,
              identity: { ...first.ticket.identity, revision: 1, sourceHash: 'claimed:wrong' },
            },
            events.events,
          )
          const accepted = context.accept(first)
          expect(events.states).toEqual(['queued', 'failed'])
          expect(events.failures).toHaveLength(1)
          expect(context.errors).toEqual([])
          return { full: accepted.output.message.metadata.serializeMs }
        }
        const full = context.accept(first).output
        context.host.cache()
        context.flush()
        const delta = context.accept(
          context.prepare('# Clock revised\n\nBody with **emphasis**.\n', 1),
        ).output
        expect(delta.message.kind).toBe('delta')
        expect(context.errors).toEqual([])
        return {
          full: full.message.metadata.serializeMs,
          delta: delta.message.metadata.serializeMs,
          wallMs: full.report?.wallMs,
          largestStepMs: full.report?.largestStepMs,
          steps: full.report?.steps,
        }
      } finally {
        context.close()
      }
    }
    try {
      const direct = measure(0, false),
        queued = measure(10000, false)
      expect(direct.full).toBeGreaterThan(0)
      expect(direct.delta).toBeGreaterThan(0)
      expect(queued.full).toBe(direct.full)
      expect(queued.delta).toBe(direct.delta)
      expect(measure(10000, true).full).toBe(direct.full)
      if (profile) {
        expect(queued.wallMs).toBeGreaterThan(direct.wallMs ?? 0)
        expect(queued.largestStepMs).toBe(direct.largestStepMs)
        expect(queued.steps).toBe(direct.steps)
      }
    } finally {
      timer.mockRestore()
    }
  },
)

it.each(['prepare', 'warmup'] as const)('releases %s work if scheduling fails', (phase) => {
  const context = fixture()
  try {
    if (phase === 'warmup') context.accept(context.prepare('# Accepted\n\nBody'))
    const before = context.host.stats
    context.breakScheduler()
    if (phase === 'warmup') context.host.cache()
    else context.prepare('# Unscheduled')
    expect(context.errors).toHaveLength(1)
    expect(context.queue).toEqual([])
    expect(context.host.stats).toEqual(before)
  } finally {
    context.close()
  }
})

it('resynchronizes a delivered result whose ACK was lost to cancellation', () => {
  const context = fixture()
  try {
    const text = '# Heading\n\nBody with **emphasis**.\n'
    context.accept(context.prepare(text))
    const pending = context.prepare(text.replace('Heading', 'Delivered heading'), 1)
    context.flush()
    const offer = context.messages.at(-1)
    if (offer?.kind !== 'offer') throw new Error('No delivered offer')
    const accepted = finishPackedSteps(context.receiver.receiveSteps(pending.ticket, offer.message))
    if (accepted?.kind !== 'accepted') throw new Error('No delivered result')
    try {
      context.host.cancel()
      expect(() => context.host.acknowledge(accepted.acknowledgement)).toThrow()
      expect(context.host.stats.current?.revision).toBe(0)
      const final = context.accept(context.prepare(text.replace('Heading', 'Final heading'), 2))
      expect(final.output.message.kind).toBe('full')
      expect(accepted.capture.identity.revision).toBe(1)
      expect(context.errors).toEqual([])
    } finally {
      accepted.capture.release()
    }
  } finally {
    context.close()
  }
})
