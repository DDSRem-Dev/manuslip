import { parserVersion, sourceHash } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import { expect, it } from 'vitest'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { PackedSemanticReceiver } from '../../../../../src/renderer/src/semantics/packed-receiver'
import { PackedWorkerEndpoint } from '../../../../../src/renderer/src/semantics/packed-worker-endpoint'
import type { ParseRequest } from '../../../../../src/renderer/src/semantics/protocol'

const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const MiB = 1024 * 1024

it('rejects oversized request JSON during queued scanning while preserving an earlier ACKable offer', () => {
  const context = fixture()
  try {
    const prior = context.begin('# Earlier valid offer')
    context.endpoint.receive(prior.command)
    context.flush()
    const offered = context.messages[0],
      baseline = context.endpoint.stats.retainedBytes
    const candidate = context.begin('\0'.repeat(2 * MiB), 1)
    context.endpoint.receiveCooperative(candidate.command)
    expect(context.messages).toHaveLength(1)
    expect(context.endpoint.stats.retainedBytes).toBeGreaterThan(baseline)
    context.flush()
    expect(context.messages).toHaveLength(2)
    expect(context.messages[1]).toMatchObject({
      kind: 'semantic-error',
      code: 'semantic-limit',
      sequence: candidate.input.sequence,
      requestToken: candidate.ticket.requestToken,
    })
    expect(context.endpoint.stats.retainedBytes).toBe(baseline)
    context.accept(prior, offered)
    expect(context.endpoint.stats.current?.revision).toBe(0)
  } finally {
    context.close()
  }
})
function fixture() {
  const queue: (() => void)[] = [],
    messages: unknown[] = [],
    receivers: PackedSemanticReceiver[] = []
  let clock = 0,
    sequence = 0,
    rejectSchedule = false
  const endpoint = new PackedWorkerEndpoint(
    {
      post: (value, transfer) => {
        messages.push(structuredClone(value, { transfer }))
      },
    },
    {
      now: () => (clock += 3),
      defer: (run) => {
        if (rejectSchedule) throw new Error('Scheduler unavailable')
        queue.push(run)
      },
    },
  )
  const baseline = endpoint.stats.retainedBytes
  const begin = (text: string, revision = 0) => {
    const receiver = new PackedSemanticReceiver(
      { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 },
      { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 },
    )
    receivers.push(receiver)
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'endpoint',
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
      documentId: 'endpoint',
      revision,
      source: text,
      options: { ...options },
      sentAt: 0,
    }
    const ticket = receiver.begin(sequence, source, options)
    return {
      input,
      ticket,
      receiver,
      command: { kind: 'prepare', input, exchange: structuredClone(ticket) },
    }
  }
  const flush = () => {
    let steps = 0
    while (queue.length) {
      if (++steps > 100000) throw new Error('Endpoint did not settle')
      queue.shift()?.()
    }
  }
  const accept = (pending: ReturnType<typeof begin>, message: unknown) => {
    const result = finishPackedSteps(pending.receiver.receiveSteps(pending.ticket, message))
    if (result?.kind !== 'accepted') throw new Error('Missing accepted result')
    expect(result.capture.sourceResource.text).toBe(pending.input.source)
    result.capture.release()
    endpoint.receiveCooperative({ kind: 'ack', acknowledgement: result.acknowledgement })
  }
  return {
    endpoint,
    baseline,
    queue,
    messages,
    begin,
    flush,
    accept,
    rejectSchedule: () => {
      rejectSchedule = true
    },
    close() {
      endpoint.dispose()
      for (const receiver of receivers) receiver.dispose()
      flush()
      expect(endpoint.stats.retainedBytes).toBe(0)
      for (const receiver of receivers) expect(receiver.stats.retainedBytes).toBe(0)
    },
  }
}
const cancel = (ticket: { sequence: number; requestToken: string }) => ({
  kind: 'cancel',
  sequence: ticket.sequence,
  requestToken: ticket.requestToken,
})

it('queues the actual cooperative Worker entry before preparing a complete offer', () => {
  const context = fixture()
  try {
    const pending = context.begin(
      '# Heading\n\n> [link][r] 世界\n\n[r]: https://example.invalid/\n',
    )
    context.endpoint.receiveCooperative(pending.command)
    expect(context.endpoint.stats.phase).toBe('idle')
    expect(context.messages).toHaveLength(0)
    expect(context.queue).toHaveLength(1)
    context.flush()
    expect(context.messages).toHaveLength(1)
    context.accept(pending, context.messages[0])
    expect(context.endpoint.stats.current?.revision).toBe(0)
  } finally {
    context.close()
  }
})

it('correlates a failed digest to its candidate and keeps an earlier offer ACKable', () => {
  const context = fixture()
  try {
    const old = context.begin('# Earlier offer')
    context.endpoint.receiveCooperative(old.command)
    context.flush()
    const offered = context.messages[0],
      next = context.begin('x'.repeat(9000), 1)
    next.command.exchange.identity.sourceHash = 'claimed:wrong'
    context.endpoint.receiveCooperative(next.command)
    context.queue.shift()?.()
    expect(context.messages).toHaveLength(1)
    context.flush()
    expect(context.messages).toHaveLength(2)
    expect(context.messages[1]).toMatchObject({
      kind: 'semantic-error',
      sequence: next.ticket.sequence,
      requestToken: next.ticket.requestToken,
      code: 'semantic-parse',
    })
    expect(context.endpoint.stats.phase).toBe('offered')
    context.accept(old, offered)
    context.endpoint.receiveCooperative(cancel(next.ticket))
    expect(context.endpoint.stats.current?.revision).toBe(0)
  } finally {
    context.close()
  }
})

it('cancels only the queued candidate and releases its provisional ownership', () => {
  const context = fixture()
  try {
    const old = context.begin('# Earlier offer')
    context.endpoint.receiveCooperative(old.command)
    context.flush()
    const retained = context.endpoint.stats.retainedBytes,
      next = context.begin('x'.repeat(9000), 1)
    context.endpoint.receiveCooperative(next.command)
    context.queue.shift()?.()
    expect(context.endpoint.stats.retainedBytes).toBeGreaterThan(retained)
    context.endpoint.receiveCooperative(cancel(next.ticket))
    expect(context.endpoint.stats.retainedBytes).toBe(retained)
    context.flush()
    expect(context.messages).toHaveLength(1)
    context.accept(old, context.messages[0])
  } finally {
    context.close()
  }
})

it('keeps a candidate while an older offer is cancelled and ignores later old controls', () => {
  const context = fixture()
  try {
    const old = context.begin('# Earlier offer')
    context.endpoint.receiveCooperative(old.command)
    context.flush()
    const next = context.begin(`# Current\n\n${'x'.repeat(9000)}`, 1)
    context.endpoint.receiveCooperative(next.command)
    context.endpoint.receiveCooperative(cancel(old.ticket))
    context.flush()
    expect(context.messages).toHaveLength(2)
    context.endpoint.receiveCooperative(cancel(old.ticket))
    context.accept(next, context.messages[1])
    expect(context.endpoint.stats.current?.revision).toBe(1)
  } finally {
    context.close()
  }
})

it('accepts an older ACK while source validation continues and then promotes the candidate', () => {
  const context = fixture()
  try {
    const old = context.begin('# Earlier offer')
    context.endpoint.receiveCooperative(old.command)
    context.flush()
    const next = context.begin('x'.repeat(9000), 1)
    context.endpoint.receiveCooperative(next.command)
    context.queue.shift()?.()
    context.accept(old, context.messages[0])
    expect(context.queue).toHaveLength(1)
    context.flush()
    context.accept(next, context.messages[1])
    expect(context.endpoint.stats.current?.revision).toBe(1)
  } finally {
    context.close()
  }
})

it.each(['legacy', 'cooperative'] as const)(
  'preserves an existing offer after invalid %s metadata',
  (mode) => {
    const context = fixture()
    try {
      const old = context.begin('# Earlier offer')
      context.endpoint.receive(old.command)
      context.flush()
      const next = context.begin('# Invalid request', 1)
      next.input.sequence = 99
      if (mode === 'legacy')
        expect(() => context.endpoint.receive(next.command)).toThrow('sequence mismatch')
      else {
        context.endpoint.receiveCooperative(next.command)
        expect(context.messages[1]).toMatchObject({
          kind: 'semantic-error',
          sequence: next.ticket.sequence,
        })
      }
      context.accept(old, context.messages[0])
    } finally {
      context.close()
    }
  },
)

it('reports one correlated scheduler error and releases the candidate before source reads', () => {
  const context = fixture()
  try {
    const next = context.begin('x'.repeat(9000))
    context.rejectSchedule()
    context.endpoint.receiveCooperative(next.command)
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]).toMatchObject({
      kind: 'semantic-error',
      sequence: next.ticket.sequence,
    })
    expect(context.endpoint.stats.retainedBytes).toBe(context.baseline)
    expect(context.queue).toHaveLength(0)
  } finally {
    context.close()
  }
})
