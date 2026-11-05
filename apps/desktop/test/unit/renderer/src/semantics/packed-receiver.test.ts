import { parserVersion, semanticLimits, sourceHash } from '@manuslip/core'
import { rendererVersion } from '@manuslip/renderer'
import { describe, expect, it } from 'vitest'
import { packValue, unpackValue } from '../../../../../../../packages/core/src/packing'
import { PackedArena } from '../../../../../../../packages/core/src/packing-arena'
import type { PackedCapture } from '../../../../../../../packages/core/src/packing-capture'
import type {
  PackedReceived,
  PackedReceiveTicket,
} from '../../../../../../../packages/core/src/packing-receiver'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import { newPackedToken } from '../../../../../../../packages/core/src/packing-token'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { parseMarkdown } from '../../../../../../../packages/core/src/parse'
import commonmark from '../../../../../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import { PackedSemanticProducer } from '../../../../../src/renderer/src/semantics/packed-producer'
import { PackedSemanticReceiver } from '../../../../../src/renderer/src/semantics/packed-receiver'
import { absoluteNow, type ParseRequest } from '../../../../../src/renderer/src/semantics/protocol'

const MiB = 1024 * 1024
const session = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const cached = { document: true, projection: true, words: true }
function semantic(text: string, render = options) {
  const document = parseMarkdown(text)
  const { projection, layout } = renderProjectionLayout(
    document.root,
    render,
    semanticLimits.rendererBytes,
  )
  return { document, projection, layout }
}
function oracle(text: string, render = options) {
  const { document, projection, layout } = semantic(text, render)
  return {
    document: { ...document, timings: expect.any(Object) },
    projection: { ...projection, renderMs: expect.any(Number) },
    layout,
  }
}
function decode(capture: PackedCapture) {
  const encoded = finishPackedSteps(
    capture.serialize([], {
      bytes: session.bytes,
      workspace: session.staging - 65536,
      nodes: 800000,
      depth: 128,
    }),
  )
  if (!encoded) throw new Error('Missing complete encoding')
  try {
    return unpackValue(encoded.value.payload, session).value
  } finally {
    encoded.release()
  }
}
function fixture(retained = session.retained) {
  const producer = new PackedSemanticProducer({ ...session, retained: 16 * MiB })
  const receiver = new PackedSemanticReceiver({ ...session, retained }, validation)
  let sequence = 0
  function begin(text: string, revision = 0, render = options, documentId = 'receiver') {
    const input: ParseRequest = {
      kind: 'parse',
      sequence: ++sequence,
      generation: 1,
      documentId,
      revision,
      source: text,
      options: { ...render },
      sentAt: absoluteNow(),
    }
    const source = new PackedSource(
      {
        generation: input.generation,
        documentId,
        revision,
        sourceHash: sourceHash(text),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(render),
      },
      text,
    )
    const ticket = receiver.begin(sequence, source, render)
    const work = producer.prepare(input, structuredClone(ticket))
    return { ticket, source, work }
  }
  function publish(text: string, revision = 0, render = options, documentId = 'receiver') {
    const request = begin(text, revision, render, documentId)
    const message = finishPackedSteps(request.work)
    if (!message) throw new Error('Missing offer')
    const result = finishPackedSteps(
      receiver.receiveSteps(
        request.ticket,
        structuredClone(message, { transfer: [message.payload] }),
      ),
    )
    if (result?.kind !== 'accepted') throw new Error('Missing accepted result')
    try {
      expect(decode(result.capture)).toEqual(oracle(text, render))
      producer.acknowledge(structuredClone(result.acknowledgement))
    } finally {
      result.capture.release()
    }
    return message.kind
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

describe('application packed semantic receiver', () => {
  it.each(commonmark)(
    'retains complete semantics across cached edits before CommonMark $example',
    ({ markdown, example }) => {
      const context = fixture()
      try {
        const initial = `# Heading\n\n${markdown}`
        context.publish(initial)
        expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
        for (const [index, heading] of ['Heading extended', 'Heading extended again'].entries()) {
          const text = initial.replace('Heading', heading)
          expect(context.publish(text, index + 1)).toBe(example === 215 ? 'full' : 'delta')
          expect(context.receiver.stats.cache).toEqual(cached)
        }
      } finally {
        context.close()
      }
    },
  )

  it('keeps global references, footnotes, Unicode words and widgets exact over repeated edits', () => {
    const context = fixture()
    try {
      const initial =
        '# Heading\r\n\r\n中文 العربية **words** [link][r] [^n].\r\n\r\n> Nested `code` and prose.\r\n\r\n$$\r\nx^2\r\n$$\r\n\r\n```mermaid\r\ngraph LR; A-->B\r\n```\r\n\r\n[r]: https://example.invalid/\r\n\r\n[^n]: Footnote text.\r\n'
      context.publish(initial)
      expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      const old = context.receiver.capture()
      try {
        const edits = [
          initial.replace('Heading', 'Heading extended'),
          initial
            .replace('Heading', 'Heading extended again')
            .replace('example.invalid', 'changed.invalid'),
          initial
            .replace('Heading', 'Heading extended again')
            .replace('Footnote text', 'Different footnote 中文'),
        ]
        for (const [index, text] of edits.entries()) context.publish(text, index + 1)
        expect(decode(old)).toEqual(oracle(initial))
        context.receiver.clearCache()
        expect(context.receiver.stats.cache).toEqual({
          document: false,
          projection: false,
          words: false,
        })
        expect(decode(old)).toEqual(oracle(initial))
        expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      } finally {
        old.release()
      }
    } finally {
      context.close()
    }
  })

  it.each(['document', 'projection', 'words'] as const)(
    'revokes partial cache construction during %s',
    (phase) => {
      const context = fixture()
      try {
        context.publish('# Heading\n\nA paragraph.\n\nAnother paragraph.\n')
        const before = context.receiver.stats
        const work = context.receiver.cacheSteps()
        for (let step = 0; context.receiver.stats.cachePhase !== phase; step++) {
          expect(step).toBeLessThan(10000)
          expect(work.next().done).toBe(false)
        }
        expect(work.next().done).toBe(false)
        work.return()
        expect(work.next().done).toBe(true)
        expect(context.receiver.stats).toEqual(before)
        expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      } finally {
        context.close()
      }
    },
  )

  it('reuses an already completed cache without allocating another capture or metadata', () => {
    const context = fixture()
    try {
      context.publish('A paragraph.\n')
      expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      const before = context.receiver.stats
      expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      expect(context.receiver.stats).toEqual(before)
    } finally {
      context.close()
    }
  })

  it.each(['queued', 'preparing', 'validating'] as const)(
    'cancels %s receipt and preserves the accepted revision and cache',
    (phase) => {
      const context = fixture()
      try {
        context.publish('# Heading\n\nOld paragraph.\n')
        finishPackedSteps(context.receiver.cacheSteps())
        const before = context.receiver.stats
        const pending = context.begin('# Heading extended\n\nOld paragraph.\n', 1)
        const message = finishPackedSteps(pending.work)
        if (!message) throw new Error('Missing offer')
        const work = context.receiver.receiveSteps(pending.ticket, message)
        const steps = phase === 'queued' ? 0 : phase === 'preparing' ? 3 : 80
        for (let i = 0; i < steps; i++) expect(work.next().done).toBe(false)
        expect(context.receiver.cancel(pending.ticket)).toBe(true)
        expect(work.next().done).toBe(true)
        expect(context.receiver.stats).toEqual(before)
        expect(context.producer.stats.current?.revision).toBe(0)
        context.publish('# Heading extended again\n\nOld paragraph.\n', 2)
      } finally {
        context.close()
      }
    },
  )

  it('rejects malformed eager input, clears its request, and can rebuild caches and retry', () => {
    const context = fixture()
    try {
      context.publish('Old paragraph.\n')
      finishPackedSteps(context.receiver.cacheSteps())
      const before = context.receiver.stats
      const request = context.begin('New paragraph.\n', 1)
      expect(() => context.receiver.receiveSteps(request.ticket, {})).toThrow()
      expect(context.receiver.stats).toEqual(before)
      expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      expect(context.receiver.cancel(request.ticket)).toBe(false)
      context.publish('New paragraph.\n', 2)
    } finally {
      context.close()
    }
  })

  it.each(['HTML', 'words', 'descriptor', 'widget'] as const)(
    'withholds acknowledgement for forged %s with completed caches',
    (field) => {
      const context = fixture()
      try {
        const text = '# Heading\n\nA paragraph.\n\n$$\nx^2\n$$\n'
        context.publish(text)
        finishPackedSteps(context.receiver.cacheSteps())
        const before = context.receiver.stats
        const request = context.begin(text, 1)
        const offer = finishPackedSteps(request.work)
        if (!offer || !request.ticket.base) throw new Error('Missing base offer')
        const value = semantic(text)
        const path =
          field === 'HTML'
            ? ['projection', 'html']
            : field === 'words'
              ? ['document', 'counts']
              : field === 'descriptor'
                ? ['document', 'blocks']
                : ['projection', 'blocks']
        if (field === 'HTML')
          value.projection.html = value.projection.html.replace('Heading', 'Forging')
        if (field === 'words') value.document.counts.words++
        if (field === 'descriptor') {
          const block = value.document.blocks[0]
          if (!block) throw new Error('Missing descriptor')
          block.hash = 'forged'
        }
        if (field === 'widget') {
          const block = value.projection.blocks[0]
          if (!block) throw new Error('Missing widget')
          block.value = 'z^2'
        }
        const payload = packValue(value, session.bytes)
        const arena = PackedArena.open(payload.slice(0), session)
        let record = arena.root
        for (const key of path) {
          const next = arena.field(record, key)
          if (next === undefined) throw new Error('Missing forged field')
          record = next
        }
        const forged = {
          ...offer,
          kind: 'delta',
          base: request.ticket.base.identity,
          baseToken: request.ticket.base.token,
          resultToken: newPackedToken(),
          payload,
          operations: [{ kind: 'replace', path, record }],
        }
        expect(() =>
          finishPackedSteps(context.receiver.receiveSteps(request.ticket, forged)),
        ).toThrow(/Invalid packed/)
        expect(context.producer.stats.current?.revision).toBe(0)
        expect(context.receiver.stats).toEqual(before)
        context.publish(text.replace('Heading', 'Heading extended'), 2)
      } finally {
        context.close()
      }
    },
  )

  it('rejects invalid identity before cancelling valid work', () => {
    const context = fixture()
    try {
      const request = context.begin('A paragraph.\n')
      const render = { ...options, rawHtml: true }
      expect(() => context.receiver.begin(2, request.source, render)).toThrow(/identity mismatch/)
      const message = finishPackedSteps(request.work)
      if (!message) throw new Error('Missing offer')
      const result = finishPackedSteps(context.receiver.receiveSteps(request.ticket, message))
      expect(result?.kind).toBe('accepted')
      if (result?.kind === 'accepted') result.capture.release()
    } finally {
      context.close()
    }
  })

  it('copies caller policy and validation limits before queued work', () => {
    const render = { ...options },
      budget = { ...validation }
    const receiver = new PackedSemanticReceiver(session, budget)
    const producer = new PackedSemanticProducer({ ...session, retained: 16 * MiB })
    const text = 'A paragraph.\n'
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'copied',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(render),
      },
      text,
    )
    try {
      const ticket = receiver.begin(1, source, render)
      const message = finishPackedSteps(
        producer.prepare(
          {
            kind: 'parse',
            generation: 1,
            documentId: 'copied',
            revision: 0,
            sequence: 1,
            source: text,
            options: { ...render },
            sentAt: absoluteNow(),
          },
          ticket,
        ),
      )
      render.footnotesLabel = 'Changed policy'
      budget.nodes = 0
      if (!message) throw new Error('Missing offer')
      const received = finishPackedSteps(receiver.receiveSteps(ticket, message))
      if (received?.kind !== 'accepted') throw new Error('Missing accepted result')
      expect(decode(received.capture)).toEqual(oracle(text))
      received.capture.release()
      expect(finishPackedSteps(receiver.cacheSteps())).toEqual(cached)
    } finally {
      producer.dispose()
      receiver.dispose()
    }
    expect(receiver.stats.retainedBytes).toBe(0)
  })

  // Building 20,000 real blocks crosses the admission boundary; this is not a latency gate.
  it('returns capacity resync for an unadmitted incoming payload and retains the old consumer', () => {
    const context = fixture(2 * MiB)
    try {
      const initial = '# Heading\n\nA paragraph.\n'
      context.publish(initial)
      const caches = finishPackedSteps(context.receiver.cacheSteps())
      expect(caches?.document).toBe(true)
      const old = context.receiver.capture()
      try {
        const request = context.begin('p\n\n'.repeat(20000), 1)
        const message = finishPackedSteps(request.work)
        if (!message) throw new Error('Missing offer')
        const bytes = message.payload.byteLength
        const result = finishPackedSteps(context.receiver.receiveSteps(request.ticket, message))
        expect(result).toEqual({ kind: 'resync', reason: 'capacity' })
        expect(message.payload.byteLength).toBe(bytes)
        expect(context.producer.stats.current?.revision).toBe(0)
        expect(context.receiver.stats.current?.revision).toBe(0)
        expect(context.receiver.stats).toMatchObject({
          requested: null,
          prepared: null,
          readerStagingBytes: 0,
          cache: { document: false, projection: false, words: false },
        })
        expect(decode(old)).toEqual(oracle(initial))
        context.publish(initial.replace('Heading', 'Heading extended'), 2)
      } finally {
        old.release()
      }
    } finally {
      context.close()
    }
  }, 30000)

  it('reclaims optional prose cache under consumer pressure and accepts the same delta', () => {
    const context = fixture()
    const initial = `# Heading\n\n${`Paragraph ${'word '.repeat(500)}\n\n`.repeat(100)}`
    try {
      context.publish(initial)
      expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      const old = context.receiver.capture()
      try {
        const text = initial.replace('Heading', 'Heading extended')
        const request = context.begin(text, 1)
        const message = finishPackedSteps(request.work)
        if (message?.kind !== 'delta') throw new Error('Missing delta offer')
        const resource = {
          key: {},
          bytes: session.retained - context.receiver.stats.retainedBytes - 1500000,
        }
        const pressure = context.receiver.retain({ resources: () => [resource] })
        let result: PackedReceived | undefined
        try {
          result = finishPackedSteps(context.receiver.receiveSteps(request.ticket, message))
          expect(result?.kind).toBe('accepted')
          expect(message.payload.byteLength).toBe(0)
          expect(context.receiver.stats.cache).toEqual({ ...cached, words: false })
          expect(context.receiver.stats.readerStagingBytes).toBe(0)
        } finally {
          pressure.release()
        }
        if (result?.kind !== 'accepted') throw new Error('Missing accepted delta')
        try {
          expect(decode(result.capture)).toEqual(oracle(text))
          context.producer.acknowledge(result.acknowledgement)
          expect(context.producer.stats.current?.revision).toBe(1)
          const certificate = context.receiver.certificate(result.capture)
          expect(certificate.matches(result.capture)).toBe(true)
          certificate.close()
          expect(decode(old)).toEqual(oracle(initial))
        } finally {
          result.capture.release()
        }
      } finally {
        old.release()
      }
    } finally {
      context.close()
    }
  })

  it.each(['forged words', 'cancelled retry'] as const)(
    'withholds acknowledgement for %s after reclaiming optional prose',
    (outcome) => {
      const context = fixture()
      const initial = `# Heading\n\n${`Paragraph ${'word '.repeat(500)}\n\n`.repeat(100)}`
      try {
        context.publish(initial)
        expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
        const request = context.begin(initial, 1)
        const offer = finishPackedSteps(request.work)
        if (!offer || !request.ticket.base) throw new Error('Missing base offer')
        const value = semantic(initial)
        value.document.counts.words++
        const payload = packValue(value, session.bytes)
        const arena = PackedArena.open(payload.slice(0), session)
        const document = arena.field(arena.root, 'document')
        const counts = document === undefined ? undefined : arena.field(document, 'counts')
        if (counts === undefined) throw new Error('Missing forged counts')
        const message = {
          ...offer,
          kind: 'delta',
          base: request.ticket.base.identity,
          baseToken: request.ticket.base.token,
          resultToken: newPackedToken(),
          payload,
          operations: [{ kind: 'replace', path: ['document', 'counts'], record: counts }],
        }
        const resource = {
          key: {},
          bytes: session.retained - context.receiver.stats.retainedBytes - 1650000,
        }
        const pressure = context.receiver.retain({ resources: () => [resource] })
        try {
          const work = context.receiver.receiveSteps(request.ticket, message)
          if (outcome === 'forged words')
            expect(() => finishPackedSteps(work)).toThrow(/Invalid packed/)
          else {
            for (let step = 0; context.receiver.stats.cache.words; step++) {
              expect(step).toBeLessThan(100000)
              expect(work.next().done).toBe(false)
            }
            expect(context.receiver.cancel(request.ticket)).toBe(true)
            expect(work.next().done).toBe(true)
          }
          expect(message.payload.byteLength).toBe(0)
          expect(context.producer.stats.current?.revision).toBe(0)
          expect(context.receiver.stats).toMatchObject({
            current: { revision: 0 },
            requested: null,
            prepared: null,
            readerStagingBytes: 0,
            cache: { ...cached, words: false },
          })
        } finally {
          pressure.release()
        }
        context.publish(initial.replace('Heading', 'Heading extended'), 2)
      } finally {
        context.close()
      }
    },
  )

  it('withholds acceptance when mandatory validation exceeds its logical node limit', () => {
    const receiver = new PackedSemanticReceiver(session, { ...validation, nodes: 1 })
    const producer = new PackedSemanticProducer({ ...session, retained: 16 * MiB })
    const text = 'A paragraph.\n'
    const source = new PackedSource(
      {
        generation: 1,
        documentId: 'limited',
        revision: 0,
        sourceHash: sourceHash(text),
        parserVersion: `${parserVersion}/manuslip`,
        rendererVersion,
        options: JSON.stringify(options),
      },
      text,
    )
    const before = receiver.stats
    try {
      const ticket = receiver.begin(1, source, options)
      const message = finishPackedSteps(
        producer.prepare(
          {
            kind: 'parse',
            generation: 1,
            documentId: 'limited',
            revision: 0,
            sequence: 1,
            source: text,
            options,
            sentAt: absoluteNow(),
          },
          ticket,
        ),
      )
      if (!message) throw new Error('Missing offer')
      expect(finishPackedSteps(receiver.receiveSteps(ticket, message))).toEqual({
        kind: 'resync',
        reason: 'capacity',
      })
      expect(message.payload.byteLength).toBe(0)
      expect(receiver.stats).toEqual(before)
      expect(producer.stats.current).toBeNull()
    } finally {
      producer.dispose()
      receiver.dispose()
    }
  })

  it('drops incompatible certificates for a new policy or document and preserves old consumer captures', () => {
    const context = fixture()
    try {
      const text = '<b>Raw HTML</b>\n'
      context.publish(text)
      finishPackedSteps(context.receiver.cacheSteps())
      const old = context.receiver.capture()
      try {
        context.publish(text, 1, { ...options, rawHtml: true })
        expect(context.receiver.stats.cachePhase).toBe('idle')
        finishPackedSteps(context.receiver.cacheSteps())
        context.publish('A new document.\n', 0, options, 'other-document')
        expect(context.receiver.stats.cachePhase).toBe('idle')
        context.receiver.evict()
        expect(context.receiver.stats.current).toBeNull()
        expect(decode(old)).toEqual(oracle(text))
      } finally {
        old.release()
      }
    } finally {
      context.close()
    }
  })

  it('revokes queued cache work and all captures on disposal', () => {
    const context = fixture()
    context.publish('A paragraph.\n')
    const work = context.receiver.cacheSteps()
    const capture = context.receiver.capture()
    context.close()
    expect(work.next().done).toBe(true)
    expect(() => capture.reader.kind()).toThrow(/released/)
    expect(() => context.receiver.cacheSteps()).toThrow(/disposed/)
    expect(() => context.receiver.cancel({} as PackedReceiveTicket)).toThrow(/disposed/)
  })

  it('evicts optional certificates when admitting a new source would exceed the session limit', () => {
    const context = fixture(2 * MiB)
    try {
      context.publish('Old paragraph.\n')
      expect(finishPackedSteps(context.receiver.cacheSteps())).toEqual(cached)
      const initial = context.receiver.capture()
      try {
        const request = context.begin('word '.repeat(180000), 1)
        expect(context.receiver.stats.cachePhase).toBe('idle')
        expect(context.receiver.stats.retainedBytes).toBeLessThanOrEqual(2 * MiB)
        expect(context.receiver.cancel(request.ticket)).toBe(true)
        expect(decode(initial)).toEqual(oracle('Old paragraph.\n'))
        context.publish('A newer paragraph.\n', 2)
      } finally {
        initial.release()
      }
    } finally {
      context.close()
    }
  })

  it('keeps completed certificates when another optional cache cannot fit', () => {
    const context = fixture(2 * MiB)
    try {
      const text = 'p\n\n'.repeat(1000)
      context.publish(text)
      const result = finishPackedSteps(context.receiver.cacheSteps())
      expect(result?.document).toBe(true)
      expect(result?.projection && result.words).toBe(false)
      expect(context.receiver.stats.retainedBytes).toBeLessThanOrEqual(2 * MiB)
      expect(context.receiver.stats.readerStagingBytes).toBe(0)
      const capture = context.receiver.capture()
      try {
        // Complete diagnostic serialization owns additional output/scratch. Reclaim
        // optional caches first, retaining the accepted consumer under the same cap.
        context.receiver.clearCache()
        expect(decode(capture)).toEqual(oracle(text))
      } finally {
        capture.release()
      }
      context.publish('A smaller replacement.\n', 1)
    } finally {
      context.close()
    }
  })

  it.each(['begin', 'evict', 'dispose'] as const)(
    'revokes suspended cache construction on %s',
    (action) => {
      const context = fixture()
      try {
        context.publish('# Heading\n\nA paragraph.\n')
        const before = context.receiver.stats
        const work = context.receiver.cacheSteps()
        for (let step = 0; context.receiver.stats.cachePhase !== 'projection'; step++) {
          expect(step).toBeLessThan(10000)
          expect(work.next().done).toBe(false)
        }
        if (action === 'begin') {
          const request = context.begin('# Heading extended\n\nA paragraph.\n', 1)
          context.receiver.cancel(request.ticket)
          expect(context.receiver.stats).toEqual(before)
        } else if (action === 'evict') {
          context.receiver.evict()
          expect(context.receiver.stats).toMatchObject({
            current: null,
            captures: 0,
            readers: 0,
            readerStagingBytes: 0,
          })
        } else context.receiver.dispose()
        expect(work.next().done).toBe(true)
        expect(context.receiver.stats.cachePhase).toBe('idle')
      } finally {
        context.close()
      }
    },
  )

  it.each([
    { ...validation, depth: 129 },
    { ...validation, retained: 65 * MiB },
    { ...validation, staging: NaN },
  ])('rejects invalid validation budgets before allocating a receiver: %j', (budget) => {
    expect(() => new PackedSemanticReceiver(session, budget)).toThrow(/Invalid/)
  })
})
