import { parserVersion, semanticLimits, sourceHash } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import { describe, expect, it, vi } from 'vitest'
import { unpackValue } from '../../../../../../../packages/core/src/packing'
import type { PackedCapture } from '../../../../../../../packages/core/src/packing-capture'
import { PackedReceiver } from '../../../../../../../packages/core/src/packing-receiver'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import { newPackedToken } from '../../../../../../../packages/core/src/packing-token'
import type { PackedWireMessage } from '../../../../../../../packages/core/src/packing-wire'
import { finishPackedSteps, PackedWork } from '../../../../../../../packages/core/src/packing-work'
import { parseMarkdown } from '../../../../../../../packages/core/src/parse'
import commonmark from '../../../../../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json'
import { validatePackedSnapshot } from '../../../../../../../packages/renderer/src/packing-validate-snapshot'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import { PackedSemanticProducer } from '../../../../../src/renderer/src/semantics/packed-producer'
import {
  type PreparedProducerSource,
  producerSourceSteps,
} from '../../../../../src/renderer/src/semantics/packed-producer-source'
import { absoluteNow, type ParseRequest } from '../../../../../src/renderer/src/semantics/protocol'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
const validation = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const transfer = <T extends { payload: ArrayBuffer }>(message: T): T =>
  structuredClone(message, { transfer: [message.payload] })
function decodeCapture(capture: PackedCapture) {
  const encoded = finishPackedSteps(
    capture.serialize([], {
      bytes: limits.bytes,
      workspace: limits.staging - 65536,
      nodes: 800000,
      depth: 128,
    }),
  )
  if (!encoded) throw new Error('Missing complete encoding')
  try {
    return unpackValue(encoded.value.payload, { ...limits, retained: 64 * MiB }).value
  } finally {
    encoded.release()
  }
}
function oracle(text: string) {
  const document = parseMarkdown(text)
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
function fixture(retained = limits.retained, render = options) {
  const producer = new PackedSemanticProducer({ ...limits, retained })
  const receiver = new PackedReceiver(limits, (capture, source) =>
    validatePackedSnapshot(capture, source, [], render, validation),
  )
  const begin = (text: string, revision = 0, sequence = 1) => {
    const input: ParseRequest = {
      kind: 'parse',
      sequence,
      generation: 1,
      documentId: 'producer',
      revision,
      source: text,
      options: { ...render },
      sentAt: absoluteNow(),
    }
    const source = new PackedSource(
      {
        generation: input.generation,
        documentId: input.documentId,
        revision,
        sourceHash: sourceHash(text),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(render),
      },
      text,
    )
    const ticket = receiver.begin(sequence, source)
    return { input, source, ticket, work: producer.prepare(input, structuredClone(ticket)) }
  }
  const publish = (text: string, revision = 0, decode = true) => {
    const started = begin(text, revision)
    const message = finishPackedSteps(started.work)
    if (!message) throw new Error('Missing offer')
    expect(producer.stats.current?.revision).not.toBe(revision)
    let decoded = decode
      ? unpackValue(message.payload, {
          bytes: limits.bytes,
          retained: 64 * MiB,
          staging: limits.staging,
        }).value
      : undefined
    const received = finishPackedSteps(receiver.receiveSteps(started.ticket, transfer(message)))
    if (received?.kind !== 'accepted') throw new Error('Missing accepted result')
    if (decode && message.kind === 'delta') decoded = decodeCapture(received.capture)
    producer.acknowledge(structuredClone(received.acknowledgement))
    expect(producer.stats.current).toEqual(started.source.identity)
    received.capture.release()
    return { decoded, message }
  }
  return {
    producer,
    receiver,
    begin,
    publish,
    close() {
      producer.dispose()
      receiver.dispose()
      expect(producer.stats.retainedBytes).toBe(0)
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  }
}

// Full construction now admits renderer/validator scratch to the same owner. Apply
// pressure after publishing the base instead of constructing native output outside
// an unrealistically small session. The production 16 MiB cap remains fixed.
function pressure(producer: PackedSemanticProducer, available: number) {
  const key = Object.freeze({})
  return producer.retain({ resources: () => [{ key, bytes: limits.retained - available }] })
}
function finishUnderPressure<T>(
  work: PackedWork<T>,
  producer: PackedSemanticProducer,
  held: ReturnType<PackedSemanticProducer['retain']>,
) {
  const evictions = producer.stats.cacheEvictions
  let peakRetainedBytes = 0
  try {
    while (true) {
      const next = work.next()
      const stats = producer.stats
      peakRetainedBytes = Math.max(peakRetainedBytes, stats.retainedBytes)
      // The temporary consumer ends after the crowded cache has actually been evicted,
      // before the replacement allocates its admitted full construction workspace.
      if (stats.cacheEvictions > evictions && stats.phase === 'parse') held.release()
      if (next.done) {
        expect(peakRetainedBytes).toBeLessThanOrEqual(limits.retained)
        return next.value
      }
    }
  } finally {
    held.release()
  }
}

describe('application packed semantic producer', () => {
  for (const phase of ['render', 'encode', 'prepare'] as const)
    for (const action of ['return', 'cancel', 'dispose'] as const)
      it.each([false, true])(
        `finishes ${action} after ${phase} child close throws (undefined: %s)`,
        (undefinedFailure) => {
          const context = fixture()
          const initial = '# Original\n\nA paragraph.\n\nTail.'
          context.publish(initial)
          expect(finishPackedSteps(context.producer.cacheSteps())).toBe(true)
          const original = context.producer.capture()
          const before = context.producer.stats
          const next = context.begin(
            '---\ntitle: replacement\n---\n\n# New root\n\nChanged entirely.\n',
            1,
          )
          for (let index = 0; index < 100000 && context.producer.stats.phase !== phase; index++)
            expect(next.work.next().done).toBe(false)
          expect(context.producer.stats.phase).toBe(phase)
          const failure = undefinedFailure ? undefined : new Error('producer child cleanup failed')
          const realReturn = PackedWork.prototype.return
          let faulted = false
          const close = vi.spyOn(PackedWork.prototype, 'return').mockImplementation(function (
            this: PackedWork<unknown>,
          ) {
            const result = realReturn.call(this)
            if (this !== next.work && !faulted) {
              faulted = true
              throw failure
            }
            return result
          })
          try {
            let threw = false
            try {
              if (action === 'return') next.work.return()
              else context.producer[action]()
            } catch (error) {
              threw = true
              expect(error).toBe(failure)
            }
            expect(threw).toBe(true)
            expect(faulted).toBe(true)
            close.mockRestore()
            expect(next.work.next()).toEqual({ done: true, value: undefined })
            if (action === 'dispose') {
              expect(context.producer.stats.retainedBytes).toBe(0)
              expect(context.producer.stats.phase).toBe('disposed')
              expect(() => original.reader.kind()).toThrow('released')
              expect(() => context.producer.dispose()).not.toThrow()
            } else {
              expect(context.producer.stats).toEqual(before)
              expect(original.reader.kind()).toBe('object')
              const updated = initial.replace('Original', 'Original extended')
              const retried = context.publish(updated, 2)
              expect(retried.message.kind).toBe('delta')
              expect(retried.decoded).toEqual(oracle(updated))
            }
          } finally {
            close.mockRestore()
            original.release()
            context.close()
          }
        },
      )

  it('builds optional dependencies only on acknowledged idle data and reuses them across real edits', () => {
    const context = fixture()
    try {
      expect(() => context.producer.cacheSteps()).toThrow()
      const text = '# Heading\n\n> Nested [link][r].\n\n[r]: https://example.invalid/\n'
      context.publish(text)
      expect(finishPackedSteps(context.producer.cacheSteps())).toBe(true)
      const before = context.producer.stats
      expect(finishPackedSteps(context.producer.cacheSteps())).toBe(true)
      expect(context.producer.stats).toEqual(before)
      for (const [index, title] of ['Heading extended', 'Heading extended again'].entries()) {
        const after = text.replace('Heading', title)
        const result = context.publish(after, index + 1)
        expect(result.message.kind).toBe('delta')
        expect(result.decoded).toEqual(oracle(after))
        expect(finishPackedSteps(context.producer.cacheSteps())).toBe(true)
      }
    } finally {
      context.close()
    }
  })
  it.each(['queued', 'building', 'dispose'] as const)(
    'revokes %s producer warmup while preserving independent consumers',
    (phase) => {
      const context = fixture()
      try {
        const text = `# Heading\n\n${'p\n\n'.repeat(300)}`
        context.publish(text)
        const before = context.producer.stats
        const capture = context.producer.capture()
        const work = context.producer.cacheSteps()
        if (phase !== 'queued') for (let i = 0; i < 20; i++) expect(work.next().done).toBe(false)
        if (phase === 'dispose') {
          context.producer.dispose()
          expect(() => capture.reader.kind()).toThrow(/released/)
        } else {
          context.producer.cancel()
          expect(capture.reader.kind()).toBe('object')
          capture.release()
          expect(context.producer.stats).toEqual(before)
          context.publish(text.replace('Heading', 'Heading extended'), 1)
        }
        expect(work.next().done).toBe(true)
      } finally {
        context.close()
      }
    },
  )
  it('supersedes valid idle work only after validating a new request', () => {
    const context = fixture()
    try {
      const text = `# Heading\n\n${'p\n\n'.repeat(100)}`
      context.publish(text)
      const work = context.producer.cacheSteps()
      expect(work.next().done).toBe(false)
      expect(() => context.producer.prepare({}, {})).toThrow()
      expect(work.next().done).toBe(false)
      const request = context.begin(text.replace('Heading', 'Heading extended'), 1)
      expect(work.next().done).toBe(true)
      expect(() => context.producer.cacheSteps()).toThrow(/idle/)
      request.work.return()
      context.producer.cancel()
      context.receiver.cancel(request.ticket)
      expect(finishPackedSteps(context.producer.cacheSteps())).toBe(true)
    } finally {
      context.close()
    }
  })
  it('declines optional warmup at capacity or unsupported native geometry and keeps accepted data', () => {
    for (const [text, retained] of [
      ['p\n\n'.repeat(200), 80 * 1024],
      ['\ufeff# Heading\n', limits.retained],
    ] as const) {
      const context = fixture()
      try {
        context.publish(text)
        const held = retained === limits.retained ? undefined : pressure(context.producer, retained)
        const before = context.producer.stats
        expect(finishPackedSteps(context.producer.cacheSteps())).toBe(false)
        expect(context.producer.stats).toEqual(before)
        held?.release()
      } finally {
        context.close()
      }
    }
  })
  it.each(commonmark)(
    'preserves complete semantics through an edit before CommonMark $example',
    ({ markdown, example }) => {
      const context = fixture()
      try {
        const initial = `# Heading\n\n${markdown}`
        context.publish(initial)
        const text = initial.replace('Heading', 'Heading extended')
        const result = context.publish(text, 1)
        // This upstream setext/definition case has overlapping top-level source
        // geometry; the existing fragment proof deliberately requires a full result.
        expect(result.message.kind).toBe(example === 215 ? 'full' : 'delta')
        expect(result.decoded).toEqual(oracle(text))
      } finally {
        context.close()
      }
    },
  )

  it('recomputes a complete BOM document whose root cannot attest independent fragment geometry', () => {
    const context = fixture()
    try {
      const initial = '\ufeff# Heading\n\nA paragraph.'
      context.publish(initial)
      const text = initial.replace('Heading', 'Heading extended')
      const result = context.publish(text, 1)
      expect(result.message.kind).toBe('full')
      expect(result.decoded).toEqual(oracle(text))
    } finally {
      context.close()
    }
  })

  it.each([
    '# Heading\n\nA paragraph.\n\nTail.',
    '# Heading\r\n\r\n> > Quote **bold**.\r\n\r\n- First\r\n- Second\r\n',
    '# Heading\n\nCall[^n], [link][r], ![image][r].\n\n[^n]: Footnote **text**.\n\n[r]: /target "Title"\n',
    '# Heading\n\n| A | B |\n| - | - |\n| x | y |\n\n- [x] Task\n\n```mermaid\ngraph LR\nA-->B\n```\n\n$$\nx^2\n$$\n',
    '# Heading\n\n中文 日本語 العربية עברית 😀 e\u0301.\n',
  ])('publishes exact deltas and advances their acknowledged dependency base: %s', (initial) => {
    const context = fixture()
    try {
      context.publish(initial)
      const original = context.producer.capture()
      let text = initial
      for (let revision = 1; revision <= 4; revision++) {
        text = text.replace('Heading', `Heading extended`)
        const { message, decoded } = context.publish(text, revision)
        expect(message.kind).toBe('delta')
        expect(decoded).toEqual(oracle(text))
        expect(decodeCapture(original)).toEqual(oracle(initial))
        expect(context.producer.stats.outgoingReservedBytes).toBe(0)
        expect(context.producer.stats.readers).toBe(0)
      }
      original.release()
    } finally {
      context.close()
    }
  })

  it.each([
    ['A paragraph.', 'A revised paragraph.'],
    ['> > A quote.', '> > A revised quote.'],
    ['- A list item.\n- Second item.', '- A revised list item.\n- Second item.'],
  ])('updates local %s with exact metadata, root positions and suffix shifts', (before, after) => {
    const context = fixture()
    try {
      const prefix = '# Heading\n\n'
      const suffix = '\n\n## Tail\n\nAnother paragraph.'
      context.publish(prefix + before + suffix)
      const text = prefix + after + suffix
      const { message, decoded } = context.publish(text, 1)
      expect(message.kind).toBe('delta')
      expect(decoded).toEqual(oracle(text))
    } finally {
      context.close()
    }
  })

  it.each([
    '# **Heading**\n\nTail.', // Changed syntax.
    '# Heading\n\nNew block.\n\nTail.', // More than one block changes.
    '# Heading\n\nTail. 😀', // Insertion outside admitted fragment grammar.
  ])('recomputes complete results for unsupported edits: %s', (text) => {
    const context = fixture()
    try {
      context.publish('# Heading\n\nTail.')
      const { message, decoded } = context.publish(text, 1)
      expect(message.kind).toBe('full')
      expect(decoded).toEqual(oracle(text))
    } finally {
      context.close()
    }
  })

  it.each([
    'queued',
    'dependencies',
    'fragment',
    'metadata',
    'projection',
    'encode',
    'prepare',
    'offered',
  ] as const)(
    'cancels delta %s without advancing its acknowledged index or retaining pending output',
    (phase) => {
      const context = fixture()
      try {
        const initial = '# Heading\n\nA paragraph.\n\nTail.'
        context.publish(initial)
        const base = initial.replace('Heading', 'Heading extended')
        expect(context.publish(base, 1).message.kind).toBe('delta')
        const retained = context.producer.stats.retainedBytes
        const next = context.begin(base.replace('paragraph', 'revised paragraph'), 2)
        let message: Exclude<PackedWireMessage, { kind: 'resync' }> | undefined
        if (phase !== 'queued') {
          for (let index = 0; index < 100000; index++) {
            const step = next.work.next()
            if (step.done) {
              message = step.value
              break
            }
            if (context.producer.stats.phase === phase) break
          }
          expect(context.producer.stats.phase).toBe(phase)
        }
        context.producer.cancel()
        if (message) expect(message.payload.byteLength).toBe(0)
        expect(next.work.next()).toEqual({ done: true, value: undefined })
        expect(context.producer.stats.retainedBytes).toBe(retained)
        expect(context.producer.stats.current?.revision).toBe(1)
        expect(context.producer.stats.requested).toBeNull()
        expect(context.producer.stats.prepared).toBeNull()
        const text = base.replace('Tail', 'Longer Tail')
        const retry = context.publish(text, 3)
        expect(retry.message.kind).toBe('delta')
        expect(retry.decoded).toEqual(oracle(text))
      } finally {
        context.close()
      }
    },
  )

  it('requires exact detached delta receipts and recovers after a lost delta ACK', () => {
    const context = fixture()
    try {
      const initial = '# Heading\n\nParagraph.'
      context.publish(initial)
      const started = context.begin(initial.replace('Heading', 'Heading extended'), 1)
      const message = finishPackedSteps(started.work)
      if (message?.kind !== 'delta') throw new Error('Missing delta')
      const ack = {
        protocol: message.protocol,
        kind: 'accepted',
        sequence: message.sequence,
        result: message.result,
        requestToken: message.requestToken,
        resultToken: message.resultToken,
      }
      expect(() => context.producer.acknowledge(ack)).toThrow('transfer')
      expect(context.producer.stats.current?.revision).toBe(0)
      const received = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing delta receipt')
      expect(() => context.producer.acknowledge({ ...ack, resultToken: newPackedToken() })).toThrow(
        'mismatch',
      )
      const text = '# Heading extended again\n\nParagraph.'
      const recovery = context.publish(text, 2)
      expect(recovery.message.kind).toBe('full')
      expect(recovery.decoded).toEqual(oracle(text))
      expect(() => context.producer.acknowledge(received.acknowledgement)).toThrow(
        'No packed offer',
      )
      received.capture.release()
    } finally {
      context.close()
    }
  })

  it('reserializes a committed delta for cached full resync and keeps the next exact delta base', () => {
    const context = fixture()
    try {
      const initial = '# Heading\n\nParagraph.\n\nTail.'
      context.publish(initial)
      const text = initial.replace('Heading', 'Heading extended')
      expect(context.publish(text, 1).message.kind).toBe('delta')
      context.receiver.evict()
      const started = context.begin(text, 1)
      const message = finishPackedSteps(started.work)
      if (!message) throw new Error('Missing serialized cached offer')
      expect(message.kind).toBe('full')
      expect(message.metadata.cached).toBe(true)
      expect(unpackValue(message.payload, { ...limits, retained: 64 * MiB }).value).toEqual(
        oracle(text),
      )
      const received = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing cached receipt')
      context.producer.acknowledge(received.acknowledgement)
      received.capture.release()
      const next = text.replace('Tail', 'Longer Tail')
      const result = context.publish(next, 2)
      expect(result.message.kind).toBe('delta')
      expect(result.decoded).toEqual(oracle(next))
    } finally {
      context.close()
    }
  })

  it('uses a full result for a foreign base token and snapshots a queued delta source', () => {
    const context = fixture()
    try {
      const initial = '# Heading\n\nParagraph.'
      context.publish(initial)
      const text = initial.replace('Heading', 'Heading extended')
      const started = context.begin(text, 1)
      const work = context.producer.prepare(started.input, {
        ...started.ticket,
        base: { ...started.ticket.base, token: newPackedToken() },
      })
      expect(started.work.next().done).toBe(true)
      const message = finishPackedSteps(work)
      if (!message) throw new Error('Missing full recovery')
      expect(message.kind).toBe('full')
      const received = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing recovery receipt')
      context.producer.acknowledge(received.acknowledgement)
      received.capture.release()
      const nextText = text.replace('Paragraph', 'Longer Paragraph')
      const next = context.begin(nextText, 2)
      next.input.source = 'mutated'
      next.input.options.footnotesLabel = 'mutated'
      const delta = finishPackedSteps(next.work)
      if (delta?.kind !== 'delta') throw new Error('Missing immutable delta')
      const accepted = finishPackedSteps(
        context.receiver.receiveSteps(next.ticket, transfer(delta)),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing immutable delta receipt')
      expect(decodeCapture(accepted.capture)).toEqual(oracle(nextText))
      context.producer.acknowledge(accepted.acknowledgement)
      accepted.capture.release()
    } finally {
      context.close()
    }
  })

  it('releases an over-capacity delta candidate before complete recomputation under the same cap', () => {
    const retained = 128 * 1024
    const context = fixture()
    try {
      const initial = `# Heading\n\n${'A paragraph.\n\n'.repeat(100)}`
      context.publish(initial)
      const previous = context.producer.capture()
      const held = pressure(context.producer, retained)
      const text = initial.replace('Heading', 'Heading extended')
      const started = context.begin(text, 1)
      const phases: string[] = []
      let message: Exclude<PackedWireMessage, { kind: 'resync' }> | undefined
      while (true) {
        const next = started.work.next()
        phases.push(context.producer.stats.phase)
        expect(context.producer.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
        if (context.producer.stats.cacheEvictions > 0 && context.producer.stats.phase === 'parse')
          held.release()
        if (next.done) {
          message = next.value
          break
        }
      }
      if (!message) throw new Error('Missing complete capacity recovery')
      expect(phases.indexOf('projection')).toBeGreaterThan(phases.indexOf('fragment'))
      expect(phases.lastIndexOf('render')).toBeGreaterThan(phases.indexOf('prepare'))
      expect(message.kind).toBe('full')
      expect(unpackValue(message.payload, { ...limits, retained: 64 * MiB }).value).toEqual(
        oracle(text),
      )
      expect(previous.sourceResource.text).toBe(initial)
      const received = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing capacity receipt')
      context.producer.acknowledge(received.acknowledgement)
      expect(context.producer.stats.current?.revision).toBe(1)
      expect(previous.reader.scalar(['document', 'sourceHash'], validation)).toBe(
        sourceHash(initial),
      )
      previous.release()
      received.capture.release()
      expect(context.producer.stats.captures).toBe(0)
      expect(context.producer.stats.readers).toBe(0)
      expect(context.producer.stats.holds).toBe(2)
    } finally {
      context.close()
    }
  })

  it('evicts only dependency acceleration when a cached resync needs its remaining capacity', () => {
    const context = fixture()
    try {
      const initial = `# Heading\n\n${'A paragraph.\n\n'.repeat(1000)}`
      context.publish(initial, 0, false)
      const text = initial.replace('Heading', 'Heading extended')
      expect(context.publish(text, 1, false).message.kind).toBe('delta')
      expect(context.producer.stats.holds).toBe(3)
      const previous = context.producer.capture()
      const held = pressure(context.producer, 896 * 1024)
      context.receiver.evict()
      const started = context.begin(text, 1)
      const message = finishUnderPressure(started.work, context.producer, held)
      if (!message) throw new Error('Missing capacity-limited cached result')
      expect(message.kind).toBe('full')
      expect(message.metadata.cached).toBe(true)
      expect(unpackValue(message.payload, { ...limits, retained: 64 * MiB }).value).toEqual(
        oracle(text),
      )
      const accepted = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing cached capacity receipt')
      context.producer.acknowledge(accepted.acknowledgement)
      expect(context.producer.stats.holds).toBe(2)
      const current = context.producer.capture()
      expect(current.sameRevision(previous)).toBe(true)
      expect(previous.reader.scalar(['document', 'sourceHash'], validation)).toBe(sourceHash(text))
      previous.release()
      current.release()
      accepted.capture.release()
      expect(context.producer.stats.readers).toBe(0)
      expect(context.producer.stats.readerStagingBytes).toBe(0)
    } finally {
      context.close()
    }
  }, 15_000)

  it('recomputes a full resync after an overlay cannot coexist with its outgoing encoding', () => {
    const context = fixture()
    try {
      const initial = `# Heading\n\n${'A paragraph.\n\n'.repeat(1000)}`
      context.publish(initial, 0, false)
      const text = initial.replace('Heading', 'Heading extended')
      expect(context.publish(text, 1, false).message.kind).toBe('delta')
      const held = pressure(context.producer, 768 * 1024)
      context.receiver.evict()
      const started = context.begin(text, 1)
      const message = finishUnderPressure(started.work, context.producer, held)
      if (!message) throw new Error('Missing recomputed full resync')
      expect(message.kind).toBe('full')
      expect(message.metadata.cached).toBe(false)
      expect(context.producer.stats.cacheEvictions).toBe(1)
      expect(context.producer.stats.current).toBeNull()
      expect(unpackValue(message.payload, { ...limits, retained: 64 * MiB }).value).toEqual(
        oracle(text),
      )
      const accepted = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing recomputed full receipt')
      context.producer.acknowledge(accepted.acknowledgement)
      accepted.capture.release()
      expect(context.producer.stats.current?.revision).toBe(1)
      expect(context.producer.stats.holds).toBe(2)
      expect(context.producer.stats.readers).toBe(0)
    } finally {
      context.close()
    }
  }, 15_000)

  it('evicts optional current cache when an unsupported complete replacement needs the same capacity', () => {
    const context = fixture()
    try {
      const initial = `# Heading\n\n${'A paragraph.\n\n'.repeat(100)}`
      context.publish(initial)
      const held = pressure(context.producer, 80 * 1024)
      const text = initial.replace('Heading', '**Heading**')
      const started = context.begin(text, 1)
      const message = finishUnderPressure(started.work, context.producer, held)
      if (!message) throw new Error('Missing complete replacement')
      expect(message.kind).toBe('full')
      expect(message.metadata.cached).toBe(false)
      expect(context.producer.stats.cacheEvictions).toBe(1)
      expect(context.producer.stats.current).toBeNull()
      expect(context.producer.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
      expect(unpackValue(message.payload, { ...limits, retained: 64 * MiB }).value).toEqual(
        oracle(text),
      )
      const accepted = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing complete replacement receipt')
      context.producer.acknowledge(accepted.acknowledgement)
      accepted.capture.release()
      expect(context.producer.stats.current?.revision).toBe(1)
      expect(context.producer.stats.holds).toBe(2)
    } finally {
      context.close()
    }
  })

  it('keeps explicit old captures valid and charged across cache eviction and full resync', () => {
    const context = fixture()
    try {
      const initial = `# Heading\n\n${'A paragraph.\n\n'.repeat(1000)}`
      context.publish(initial, 0, false)
      const text = initial.replace('Heading', 'Heading extended')
      expect(context.publish(text, 1, false).message.kind).toBe('delta')
      const old = context.producer.capture()
      const held = pressure(context.producer, 768 * 1024)
      context.receiver.evict()
      const started = context.begin(text, 1)
      const message = finishUnderPressure(started.work, context.producer, held)
      if (!message) throw new Error('Missing captured full resync')
      expect(message.kind).toBe('full')
      expect(message.metadata.cached).toBe(false)
      expect(context.producer.stats.cacheEvictions).toBe(1)
      expect(context.producer.stats.current).toBeNull()
      expect(context.producer.stats.prepared?.revision).toBe(1)
      expect(context.producer.stats.captures).toBe(1)
      expect(old.reader.scalar(['document', 'sourceHash'], validation)).toBe(sourceHash(text))
      const accepted = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing captured resync receipt')
      context.producer.acknowledge(accepted.acknowledgement)
      accepted.capture.release()
      const current = context.producer.capture()
      expect(current.sameRevision(old)).toBe(false)
      expect(old.reader.scalar(['document', 'sourceHash'], validation)).toBe(sourceHash(text))
      const retained = context.producer.stats.retainedBytes
      old.release()
      expect(context.producer.stats.retainedBytes).toBeLessThan(retained)
      current.release()
      expect(context.producer.stats.captures).toBe(0)
    } finally {
      context.close()
    }
  }, 15_000)
  it.each(commonmark)(
    'preserves complete roots, metadata, projections and layout for CommonMark $example',
    ({ markdown }) => {
      const context = fixture()
      try {
        const document = parseMarkdown(markdown)
        const rendered = renderProjectionLayout(
          document.root,
          options,
          semanticLimits.rendererBytes,
        )
        const { decoded } = context.publish(markdown)
        expect(decoded).toEqual({
          document: { ...document, timings: expect.any(Object) },
          projection: { ...rendered.projection, renderMs: expect.any(Number) },
          layout: rendered.layout,
        })
      } finally {
        context.close()
      }
    },
  )

  it.each([
    '---\ntitle: 世界\n---\n\n# Heading 😀\r\n\r\n> > *Nested* [reference][r].\r\n\r\n[r]: /target "Title"\r\n',
    '- [x] Task\n- [ ] Other\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n~~gone~~ https://example.invalid mail@example.invalid\n',
    'Text[^n], $x+1$ and <span>HTML</span>.\n\n[^n]: Note **bold**.\n\n$$\nx^2\n$$\n\n```mermaid\ngraph LR\nA-->B\n```\n',
    '# RTL العربية עברית\n\nLone \ud800 and \udc00, BOM \ufeff, 😀 and 中文.\n',
  ])('preserves application extensions and Unicode through validated receipt: %s', (text) => {
    const context = fixture()
    try {
      const document = parseMarkdown(text)
      const rendered = renderProjectionLayout(document.root, options, semanticLimits.rendererBytes)
      const { decoded } = context.publish(text)
      expect(decoded).toEqual({
        document: { ...document, timings: expect.any(Object) },
        projection: { ...rendered.projection, renderMs: expect.any(Number) },
        layout: rendered.layout,
      })
    } finally {
      context.close()
    }
  })

  it('keeps old captures valid across full replacements and exact cached resync after eviction', () => {
    const context = fixture()
    try {
      context.publish('# First\n\nOld text.')
      const old = context.producer.capture()
      const original = old.reader.scalar(
        ['document', 'root', 'children', 0, 'children', 0, 'value'],
        validation,
      )
      context.publish('# Second\n\nNew text.', 1)
      expect(
        old.reader.scalar(['document', 'root', 'children', 0, 'children', 0, 'value'], validation),
      ).toBe(original)
      context.receiver.evict()
      const started = context.begin('# Second\n\nNew text.', 1)
      const message = finishPackedSteps(started.work)
      if (!message) throw new Error('Missing cached offer')
      expect(message.kind).toBe('full')
      expect(message.metadata.cached).toBe(true)
      const result = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (result?.kind !== 'accepted') throw new Error('Missing cached receipt')
      context.producer.acknowledge(result.acknowledgement)
      result.capture.release()
      old.release()
    } finally {
      context.close()
    }
  })

  it('preserves raw HTML and escaped localized labels under their exact options identity', () => {
    const render = {
      rawHtml: true,
      footnotesLabel: 'Notes\u0000"世界',
      footnoteBackLabel: 'Back\n"😀',
    }
    const context = fixture(limits.retained, render)
    try {
      const text =
        '<div class="custom">Raw &amp; <strong>HTML</strong></div>\n\nCall[^n].\n\n[^n]: Note.\n'
      const document = parseMarkdown(text)
      const projected = renderProjectionLayout(document.root, render, semanticLimits.rendererBytes)
      expect(context.publish(text).decoded).toEqual({
        document: { ...document, timings: expect.any(Object) },
        projection: { ...projected.projection, renderMs: expect.any(Number) },
        layout: projected.layout,
      })
    } finally {
      context.close()
    }
  })

  it('recovers with a full result when the receiver committed but its acknowledgement was lost', () => {
    const context = fixture()
    try {
      const first = context.begin('first')
      const offer = finishPackedSteps(first.work)
      if (!offer) throw new Error('Missing first offer')
      const accepted = finishPackedSteps(
        context.receiver.receiveSteps(first.ticket, transfer(offer)),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing first receipt')
      expect(context.producer.stats.current).toBeNull()
      const second = context.begin('second', 1)
      expect(second.ticket.base).not.toBeNull()
      const replacement = finishPackedSteps(second.work)
      if (!replacement) throw new Error('Missing replacement')
      expect(replacement.kind).toBe('full')
      expect(() => context.producer.acknowledge(accepted.acknowledgement)).toThrow('mismatch')
      const next = finishPackedSteps(
        context.receiver.receiveSteps(second.ticket, transfer(replacement)),
      )
      if (next?.kind !== 'accepted') throw new Error('Missing replacement receipt')
      context.producer.acknowledge(next.acknowledgement)
      expect(context.producer.stats.current?.revision).toBe(1)
      accepted.capture.release()
      next.capture.release()
    } finally {
      context.close()
    }
  })

  it('requires a detached buffer and exact acknowledgement before committing', () => {
    const context = fixture()
    try {
      const started = context.begin('hello')
      const message = finishPackedSteps(started.work)
      if (!message) throw new Error('Missing offer')
      const acknowledgement = {
        protocol: message.protocol,
        kind: 'accepted',
        sequence: message.sequence,
        result: message.result,
        requestToken: message.requestToken,
        resultToken: message.resultToken,
      }
      expect(() => context.producer.acknowledge(acknowledgement)).toThrow('transfer')
      expect(context.producer.stats.current).toBeNull()
      const moved = transfer(message)
      expect(() => context.producer.acknowledge({ ...acknowledgement, sequence: 99 })).toThrow(
        'mismatch',
      )
      const received = finishPackedSteps(context.receiver.receiveSteps(started.ticket, moved))
      if (received?.kind !== 'accepted') throw new Error('Missing receipt')
      context.producer.acknowledge(received.acknowledgement)
      expect(() => context.producer.acknowledge(received.acknowledgement)).toThrow(
        'No packed offer',
      )
      received.capture.release()
    } finally {
      context.close()
    }
  })

  it.each(['queued', 'render', 'encode', 'prepare', 'offered'] as const)(
    'revokes %s work and can retry without publishing a partial result',
    (phase) => {
      const context = fixture()
      try {
        const baseline = context.producer.stats.retainedBytes
        const started = context.begin('# Heading\n\nA *paragraph*.\n\n'.repeat(30))
        expect(context.producer.stats.retainedBytes).toBeGreaterThan(baseline)
        let message: Exclude<PackedWireMessage, { kind: 'resync' }> | undefined
        if (phase !== 'queued') {
          for (let step = 0; step < 100000; step++) {
            const next = started.work.next()
            if (next.done) {
              message = next.value
              break
            }
            if (context.producer.stats.phase === phase) break
          }
          expect(context.producer.stats.phase).toBe(phase)
        }
        context.producer.cancel()
        if (message) expect(message.payload.byteLength).toBe(0)
        expect(started.work.next()).toEqual({ done: true, value: undefined })
        expect(context.producer.stats.current).toBeNull()
        expect(context.producer.stats.prepared).toBeNull()
        expect(context.producer.stats.requested).toBeNull()
        expect(context.producer.stats.retainedBytes).toBe(baseline)
        context.publish('retry', 1)
      } finally {
        context.close()
      }
    },
  )

  it('snapshots mutable request/options and supersedes queued work even with equal IDs', () => {
    const context = fixture()
    try {
      const old = context.begin('old')
      const next = context.begin('# Current\n\n<span>safe</span>')
      next.input.source = 'mutated'
      next.input.options.rawHtml = true
      expect(old.work.next()).toEqual({ done: true, value: undefined })
      const message = finishPackedSteps(next.work)
      if (!message) throw new Error('Missing offer')
      const received = finishPackedSteps(
        context.receiver.receiveSteps(next.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing immutable receipt')
      context.producer.acknowledge(received.acknowledgement)
      expect(received.capture.sourceResource.text).toBe('# Current\n\n<span>safe</span>')
      received.capture.release()
    } finally {
      context.close()
    }
  })

  it('rejects mismatched exchanges without cancelling a valid pending offer', () => {
    const context = fixture()
    try {
      const started = context.begin('hello')
      const message = finishPackedSteps(started.work)
      if (!message) throw new Error('Missing offer')
      expect(() =>
        context.producer.prepare(started.input, { ...started.ticket, sequence: 99 }),
      ).toThrow('sequence mismatch')
      expect(() =>
        context.producer.prepare({ ...started.input, source: 'foreign' }, started.ticket),
      ).toThrow('source mismatch')
      expect(context.producer.stats.phase).toBe('offered')
      const received = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing receipt')
      context.producer.acknowledge(received.acknowledgement)
      received.capture.release()
    } finally {
      context.close()
    }
  })

  it('rejects forged prepared requests without cancelling a valid pending offer', () => {
    const context = fixture()
    try {
      const started = context.begin('hello')
      const message = finishPackedSteps(started.work)
      const prepared = finishPackedSteps(
        producerSourceSteps(started.input, structuredClone(started.ticket)),
      )
      if (!message || !prepared) throw new Error('Missing prepared offer')
      for (const forged of [{ ...prepared }, new Proxy(prepared, {}), structuredClone(prepared)])
        expect(() => context.producer.preparePrepared(forged as PreparedProducerSource)).toThrow(
          'Invalid prepared producer source',
        )
      expect(context.producer.stats.phase).toBe('offered')
      const received = finishPackedSteps(
        context.receiver.receiveSteps(started.ticket, transfer(message)),
      )
      if (received?.kind !== 'accepted') throw new Error('Missing receipt')
      context.producer.acknowledge(received.acknowledgement)
      received.capture.release()
    } finally {
      context.close()
    }
  })

  it('cleans a capacity rejection and retains worker/session/source caps', () => {
    expect(() => new PackedSemanticProducer({ ...limits, retained: 32 * MiB })).toThrow(
      'worker cache limit',
    )
    const context = fixture()
    try {
      const held = pressure(context.producer, 64 * 1024)
      const started = context.begin('word **bold**\n\n'.repeat(300))
      expect(() => finishPackedSteps(started.work)).toThrow(/limit/)
      expect(context.producer.stats.requested).toBeNull()
      expect(context.producer.stats.prepared).toBeNull()
      held.release()
      context.publish('small', 1)
      const input = { ...started.input, source: 'x'.repeat(semanticLimits.previewBytes + 1) }
      expect(() => context.producer.prepare(input, started.ticket)).toThrow('identity')
    } finally {
      context.close()
    }
  })

  it('disposal revokes suspended tasks, pending output and captured revisions', () => {
    const context = fixture()
    try {
      context.publish('first')
      const capture = context.producer.capture()
      const started = context.begin('second', 1)
      started.work.next()
      context.producer.dispose()
      expect(started.work.next()).toEqual({ done: true, value: undefined })
      expect(() => capture.sourceResource).toThrow()
      expect(() => context.producer.prepare(started.input, started.ticket)).toThrow('disposed')
      expect(context.producer.stats.retainedBytes).toBe(0)
      context.producer.dispose()
    } finally {
      context.close()
    }
  })
})
