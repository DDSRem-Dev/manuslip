import type { Nodes } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedItemSteps, PackedReadScope } from '../../src/packing-capture'
import { PackedDescriptionReuse } from '../../src/packing-description-reuse'
import { PackedDocumentBaseline } from '../../src/packing-document-baseline'
import type { PackedOperation } from '../../src/packing-revision'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { validatePackedDescriptions } from '../../src/packing-validate-descriptions'
import { packedDocumentSteps, validatePackedDocument } from '../../src/packing-validate-document'
import { PackedWordBaseline } from '../../src/packing-word-baseline'
import { PackedWordBuffer } from '../../src/packing-word-buffer'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const session = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
function fixture(
  text: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
  document = parseMarkdown(text, syntax),
) {
  const source = new PackedSource(
    {
      generation: 1,
      revision: 0,
      documentId: 'document-reuse',
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
  const owner = new PackedSession(session)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ document }, limits.staging),
    ),
  )
  const capture = owner.capture()
  const baseline = finishPackedSteps(
    PackedDocumentBaseline.create(capture, source, ['document'], limits),
  )
  if (!baseline) throw new Error('Missing baseline')
  function delta(
    after: string,
    value: unknown,
    operations: (field: (key: string) => number) => PackedOperation[],
  ) {
    const next = new PackedSource(
      { ...source.identity, revision: 1, sourceHash: sourceHash(after) },
      after,
    )
    const payload = packValue(value, limits.staging)
    const arena = PackedArena.open(payload.slice(0), session)
    const field = (key: string) => {
      const id = arena.field(arena.root, key)
      if (id === undefined) throw new Error('Missing payload record')
      return id
    }
    const prepared = owner.prepareDelta(owner.beginPrepared(next), {
      base: source.identity,
      baseSource: text,
      result: next.identity,
      payload,
      operations: operations(field),
    })
    return { source: next, prepared, capture: owner.capturePrepared(prepared) }
  }
  function heading(title: string, sharedMetadata = false) {
    const line = text.indexOf('\n')
    const after = `${text.charCodeAt(0) === 0xfeff ? '\ufeff' : ''}${title}${text[line - 1] === '\r' ? '\r\n' : '\n'}${text.slice(line + 1)}`
    const fresh = parseMarkdown(after, syntax)
    const next = delta(
      after,
      {
        first: fresh.root.children[0],
        position: fresh.root.position,
        blocks: sharedMetadata ? fresh.blocks.slice(0, 1) : fresh.blocks,
        outline: sharedMetadata ? fresh.outline.slice(0, 1) : fresh.outline,
        counts: fresh.counts,
        hash: fresh.sourceHash,
      },
      (field) => [
        { kind: 'replace', path: ['document', 'root', 'children', 0], record: field('first') },
        {
          kind: 'offset',
          path: ['document', 'root', 'children'],
          start: 1,
          offset: after.length - text.length,
        },
        { kind: 'replace', path: ['document', 'root', 'position'], record: field('position') },
        ...['blocks', 'outline'].flatMap((key): PackedOperation[] =>
          sharedMetadata
            ? [
                {
                  kind: 'splice',
                  path: ['document', key],
                  start: 0,
                  remove: 1,
                  record: field(key),
                },
                {
                  kind: 'range',
                  path: ['document', key],
                  start: 1,
                  offset: after.length - text.length,
                },
              ]
            : [{ kind: 'replace', path: ['document', key], record: field(key) }],
        ),
        ...['counts'].map((key) => ({
          kind: 'replace' as const,
          path: ['document', key],
          record: field(key),
        })),
        { kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') },
      ],
    )
    return { ...next, fresh }
  }
  return { owner, source, capture, baseline, document, delta, heading }
}

function pairedWords(context: ReturnType<typeof fixture>): PackedWordBaseline {
  const words = finishPackedSteps(
    PackedWordBaseline.create(
      context.capture,
      context.source,
      ['document'],
      limits,
      context.baseline,
    ),
  )
  if (!words) throw new Error('Missing word baseline')
  return words
}

function nativeSummary(root: Nodes) {
  const values: string[] = []
  let nodes = 0
  let depth = 0
  const visit = (node: Nodes, level: number) => {
    nodes++
    depth = Math.max(depth, level)
    if (node.type === 'text') values.push(node.value)
    if ('children' in node) for (const child of node.children) visit(child, level + 1)
  }
  visit(root, 1)
  return { prose: values.join(' '), nodes, depth }
}

describe('complete word collection with paired document and text baselines', () => {
  it('runs an explicit root observer for the exact certified document', () => {
    const context = fixture('> **Hello 世界**\n\nTail\n')
    const words = pairedWords(context)
    const observed: string[] = []
    const before = context.owner.stats
    try {
      finishPackedSteps(
        context.capture.work(
          packedDocumentSteps(
            context.capture,
            context.source,
            ['document'],
            limits,
            undefined,
            context.baseline,
            words,
            (_node, type) => {
              observed.push(type)
            },
          ),
        ),
      )
      expect(observed).toEqual([
        'root',
        'blockquote',
        'paragraph',
        'strong',
        'text',
        'paragraph',
        'text',
      ])
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['commonmark', 'manuslip'] as const)(
    'preserves every CommonMark document and its complete Intl input with paired %s caches',
    (syntax) => {
      for (const example of examples) {
        const context = fixture(example.markdown, syntax)
        const words = pairedWords(context)
        const next = context.delta(example.markdown, {}, () => [])
        const before = context.owner.stats
        const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
        try {
          finishPackedSteps(
            validatePackedDocument(
              next.capture,
              next.source,
              ['document'],
              limits,
              undefined,
              context.baseline,
              words,
            ),
          )
          expect(segment).toHaveBeenCalledExactlyOnceWith(
            nativeSummary(context.document.root).prose,
          )
          expect(context.owner.stats).toEqual(before)
        } finally {
          segment.mockRestore()
          context.owner.dispose()
        }
      }
    },
  )

  it.each([false, true])(
    'joins edited text and shifted cached multilingual subtrees with shared metadata=%s',
    (shared) => {
      const context = fixture(
        '# Old\r\n\r\nภาษาไทย **中文** á 👩🏽‍💻\r\n\r\n> Tail [link][r].\r\n\r\n[r]: /path\r\n',
      )
      const words = pairedWords(context)
      const next = context.heading('# New 世界', shared)
      const before = context.owner.stats
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      try {
        finishPackedSteps(
          validatePackedDocument(
            next.capture,
            next.source,
            ['document'],
            limits,
            undefined,
            context.baseline,
            words,
          ),
        )
        expect(segment).toHaveBeenCalledExactlyOnceWith(nativeSummary(next.fresh.root).prose)
        expect(context.owner.stats).toEqual(before)
      } finally {
        segment.mockRestore()
        context.owner.dispose()
      }
    },
  )

  it('keeps a short multi-chunk cache within the original copy and metadata quanta', () => {
    const text = `${'**a** x '.repeat(512)}\n`
    const context = fixture(text)
    const words = pairedWords(context)
    const next = context.delta(text, {}, () => [])
    const before = context.owner.stats
    const expected = nativeSummary(context.document.root).prose
    expect(expected.length).toBeGreaterThan(256)
    expect(expected.length).toBeLessThanOrEqual(4096)
    let units = 0
    let chunks = 0
    let total = 0
    let maximumChunks = 0
    const original = PackedWordBaseline.prototype.chunk
    const chunk = vi.spyOn(PackedWordBaseline.prototype, 'chunk').mockImplementation(function (
      this: PackedWordBaseline,
      index,
    ) {
      const value = original.call(this, index)
      units += value.length
      total += value.length
      chunks++
      return value
    })
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    const work = validatePackedDocument(
      next.capture,
      next.source,
      ['document'],
      limits,
      undefined,
      context.baseline,
      words,
    )
    try {
      while (true) {
        units = 0
        chunks = 0
        const step = work.next()
        expect(units).toBeLessThanOrEqual(4096)
        expect(chunks).toBeLessThanOrEqual(16)
        maximumChunks = Math.max(maximumChunks, chunks)
        if (step.done) break
      }
      expect(maximumChunks).toBeGreaterThan(1)
      expect(total).toBe(expected.length)
      expect(segment).toHaveBeenCalledExactlyOnceWith(expected)
      expect(context.owner.stats).toEqual(before)
    } finally {
      chunk.mockRestore()
      segment.mockRestore()
      work.return()
      context.owner.dispose()
    }
  })

  it('rejects an incorrect exact word total despite both sealed subtree caches', () => {
    const text = '> **Hello 世界**\n\nTail\n'
    const context = fixture(text)
    const words = pairedWords(context)
    const next = context.delta(
      text,
      { counts: { ...context.document.counts, words: context.document.counts.words + 1 } },
      (field) => [{ kind: 'replace', path: ['document', 'counts'], record: field('counts') }],
    )
    const before = context.owner.stats
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedDocument(
            next.capture,
            next.source,
            ['document'],
            limits,
            undefined,
            context.baseline,
            words,
          ),
        ),
      ).toThrow('Invalid packed semantic')
      expect(segment).toHaveBeenCalledExactlyOnceWith(nativeSummary(context.document.root).prose)
      expect(context.owner.stats).toEqual(before)
    } finally {
      segment.mockRestore()
      context.owner.dispose()
    }
  })

  it('collects every checked descendant when a document subtree has no matching text cache', () => {
    const text = '# Title\n\n> **Hello 世界** and *Tail*.\n'
    const context = fixture(text)
    const words = pairedWords(context)
    const next = context.delta(text, {}, () => [])
    const before = context.owner.stats
    const find = vi.spyOn(PackedWordBaseline.prototype, 'find').mockReturnValue(undefined)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      finishPackedSteps(
        validatePackedDocument(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          context.baseline,
          words,
        ),
      )
      expect(segment).toHaveBeenCalledExactlyOnceWith(nativeSummary(context.document.root).prose)
      expect(context.owner.stats).toEqual(before)
    } finally {
      find.mockRestore()
      segment.mockRestore()
      context.owner.dispose()
    }
  })

  it.each(['missing text cache', 'tight workspace'] as const)(
    'preserves explicit root observers with %s',
    (mode) => {
      const text =
        mode === 'tight workspace'
          ? `one\n\n${'word '.repeat(5000)}\n`
          : '> **Hello 世界**\n\nTail\n'
      const context = fixture(text)
      const words = pairedWords(context)
      const next = context.delta(text, {}, () => [])
      const before = context.owner.stats
      const observed: string[] = []
      const find =
        mode === 'missing text cache'
          ? vi.spyOn(PackedWordBaseline.prototype, 'find').mockReturnValue(undefined)
          : undefined
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      const work = next.capture.work(
        packedDocumentSteps(
          next.capture,
          next.source,
          ['document'],
          { ...limits, staging: mode === 'tight workspace' ? 850 * 1024 : limits.staging },
          undefined,
          context.baseline,
          words,
          (_node, type) => {
            observed.push(type)
          },
        ),
      )
      try {
        finishPackedSteps(work)
        expect(observed).toEqual(['root'])
        expect(segment).toHaveBeenCalledExactlyOnceWith(nativeSummary(context.document.root).prose)
        expect(context.owner.stats).toEqual(before)
      } finally {
        find?.mockRestore()
        segment.mockRestore()
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each(['nodes', 'depth'] as const)('retains the complete cached logical %s bound', (key) => {
    const text = '# Heading\n\n> **Hello 世界**\n\nTail\n'
    const context = fixture(text)
    const words = pairedWords(context)
    const next = context.delta(text, {}, () => [])
    const before = context.owner.stats
    try {
      const cost = nativeSummary(context.document.root)
      expect(() =>
        finishPackedSteps(
          validatePackedDocument(
            next.capture,
            next.source,
            ['document'],
            { ...limits, [key]: cost[key] - 1 },
            undefined,
            context.baseline,
            words,
          ),
        ),
      ).toThrow(/node limit|depth limit/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['words', 'document', 'capture'] as const)(
    'revokes partial cached prose when %s closes',
    (action) => {
      const text = '# Heading\n\nCached **Hello 世界**\n'
      const context = fixture(text)
      const words = pairedWords(context)
      const next = context.delta(text, {}, () => [])
      let borrowed = false
      const original = PackedWordBaseline.prototype.chunk
      const chunk = vi.spyOn(PackedWordBaseline.prototype, 'chunk').mockImplementation(function (
        this: PackedWordBaseline,
        index,
      ) {
        borrowed = true
        return original.call(this, index)
      })
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      const frames: PackedItemSteps[] = []
      const originalSteps = PackedReadScope.prototype.elementSteps
      const opening = vi
        .spyOn(PackedReadScope.prototype, 'elementSteps')
        .mockImplementation(function (this: PackedReadScope, path = []) {
          const iterator = originalSteps.call(this, path)
          frames.push(iterator)
          return iterator
        })
      const work = validatePackedDocument(
        next.capture,
        next.source,
        ['document'],
        limits,
        undefined,
        context.baseline,
        words,
      )
      try {
        let advances = 0
        while (!borrowed)
          if (work.next().done || ++advances > 10000) throw new Error('No cached prose borrowed')
        if (action === 'words') words.close()
        else if (action === 'document') context.baseline.close()
        else next.capture.release()
        if (action === 'capture') expect(work.next().done).toBe(true)
        else expect(() => finishPackedSteps(work)).toThrow(/baseline closed/)
        expect(segment).not.toHaveBeenCalled()
        expect(frames.length).toBeGreaterThan(0)
        for (const iterator of frames) expect(iterator.next().done).toBe(true)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        chunk.mockRestore()
        segment.mockRestore()
        opening.mockRestore()
        work.return()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )

  it.each(['local', 'session'] as const)(
    'discards partial paired prose and retries independent phases under %s capacity',
    (budget) => {
      const text = `one\n\n${'word '.repeat(5000)}\n`
      const context = fixture(text)
      const words = pairedWords(context)
      const next = context.delta(text, {}, () => [])
      // Keep cache construction independently admitted; this competing owner leaves
      // enough session staging for either mandatory phase, but not their overlap.
      const competing =
        budget === 'session'
          ? context.capture.workspace(session.staging - 600 * 1024, session.staging - 600 * 1024)
          : undefined
      const before = context.owner.stats
      const append = vi.spyOn(PackedWordBuffer.prototype, 'append')
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      try {
        finishPackedSteps(
          validatePackedDocument(
            next.capture,
            next.source,
            ['document'],
            { ...limits, staging: budget === 'local' ? 850 * 1024 : limits.staging },
            undefined,
            context.baseline,
            words,
          ),
        )
        expect(append.mock.calls.filter(([value]) => value === 'one')).toHaveLength(2)
        expect(segment).toHaveBeenCalledExactlyOnceWith(nativeSummary(context.document.root).prose)
        expect(context.owner.stats).toEqual(before)
      } finally {
        append.mockRestore()
        segment.mockRestore()
        competing?.release()
        context.owner.dispose()
      }
    },
  )
})

describe('document baseline cleanup failures', () => {
  it.each([new Error('first close'), undefined])(
    'finishes nested summary cleanup after a cleanup failure %j',
    (failure) => {
      const context = fixture('> > paragraph\n')
      const before = context.owner.stats
      let summarizing = false
      const recordKey = PackedReadScope.prototype.recordKey
      const identifying = vi
        .spyOn(PackedReadScope.prototype, 'recordKey')
        .mockImplementation(function (this: PackedReadScope, path = []) {
          summarizing = true
          return recordKey.call(this, path)
        })
      const frames: PackedItemSteps[] = []
      const elementSteps = PackedReadScope.prototype.elementSteps
      const opening = vi
        .spyOn(PackedReadScope.prototype, 'elementSteps')
        .mockImplementation(function (this: PackedReadScope, path = []) {
          const iterator = elementSteps.call(this, path)
          if (summarizing) frames.push(iterator)
          return iterator
        })
      const work = PackedDocumentBaseline.create(
        context.capture,
        context.source,
        ['document'],
        limits,
      )
      let closing: ReturnType<typeof vi.spyOn> | undefined
      try {
        while (frames.length < 3) expect(work.next().done).toBe(false)
        expect(frames).toHaveLength(3)
        const original = PackedItemSteps.prototype.return
        const closed = new Set<PackedItemSteps>()
        closing = vi.spyOn(PackedItemSteps.prototype, 'return').mockImplementation(function (
          this: PackedItemSteps,
        ) {
          const result = original.call(this)
          if (frames.includes(this)) {
            expect(closed.has(this)).toBe(false)
            closed.add(this)
            if (this === frames[0]) throw failure
            throw new Error('later close')
          }
          return result
        })
        let threw = false
        let caught: unknown
        try {
          work.return()
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(failure)
        expect(closed.size).toBe(3)
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(work.return()).toEqual({ done: true, value: undefined })
      } finally {
        closing?.mockRestore()
        opening.mockRestore()
        identifying.mockRestore()
        work.return()
        context.baseline.close()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )

  it.each([new Error('first close'), undefined])(
    'preserves the first cleanup failure %j',
    (failure) => {
      const context = fixture('# Heading\n\nparagraph\n')
      const closed = new Set<number>()
      const items = [0, 1].map((index) =>
        context.baseline.inspect(function* () {
          const hold = context.capture.workspace(128, 128)
          const fail = () => {
            if (index === 0) throw failure
            throw new Error('later close')
          }
          try {
            yield
          } finally {
            hold.release()
            expect(closed.has(index)).toBe(false)
            closed.add(index)
            fail()
          }
        }),
      )
      try {
        for (const item of items) expect(item.next().done).toBe(false)
        let threw = false
        let caught: unknown
        try {
          context.baseline.close()
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(failure)
        expect(closed.size).toBe(2)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(() => context.baseline.assertOpen()).toThrow()
        context.baseline.close()
        for (const item of items) expect(item.next()).toEqual({ done: true, value: undefined })
      } finally {
        context.baseline.close()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )

  it.each([new Error('first close'), undefined])(
    'closes every reused metadata reader after a cleanup failure %j',
    (failure) => {
      const context = fixture('# Heading\n\nparagraph\n')
      const roots = context.capture.reader.elementSteps(['document', 'root', 'children'])
      const blocks = context.capture.reader.elementSteps(['document', 'blocks'])
      const outline = context.capture.reader.elementSteps(['document', 'outline'])
      const reuse = new PackedDescriptionReuse(context.baseline, context.source)
      const before = context.owner.stats
      const active: PackedItemSteps[] = []
      const open = context.baseline.open.bind(context.baseline)
      const opening = vi.spyOn(context.baseline, 'open').mockImplementation((field) => {
        const item = open(field)
        active.push(item)
        return item
      })
      let closing: ReturnType<typeof vi.spyOn> | undefined
      try {
        let first = roots.next()
        while (!first.done && first.value === undefined) first = roots.next()
        if (first.done || first.value === undefined) throw new Error('Missing heading')
        const position = first.value.position(['position'], { retained: 512, staging: 0 })
        expect(
          finishPackedSteps(reuse.prune(first.value, position, limits, blocks, outline)),
        ).toBeDefined()
        expect(active).toHaveLength(2)
        const original = PackedItemSteps.prototype.return
        const closed = new Set<PackedItemSteps>()
        closing = vi.spyOn(PackedItemSteps.prototype, 'return').mockImplementation(function (
          this: PackedItemSteps,
        ) {
          const result = original.call(this)
          if (active.includes(this)) {
            expect(closed.has(this)).toBe(false)
            closed.add(this)
            if (this === active[0]) throw failure
            throw new Error('later close')
          }
          return result
        })
        let threw = false
        let caught: unknown
        try {
          reuse.close()
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(failure)
        expect(closed.size).toBe(2)
        expect(context.owner.stats).toEqual(before)
        reuse.close()
        const node = first.value
        expect(() =>
          finishPackedSteps(reuse.prune(node, position, limits, blocks, outline)),
        ).toThrow('Description reuse closed')
        for (const item of active) expect(item.next()).toEqual({ done: true, value: undefined })
      } finally {
        closing?.mockRestore()
        opening.mockRestore()
        reuse.close()
        roots.return()
        blocks.return()
        outline.return()
        context.baseline.close()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
})

function metadataPrefixes(document: ReturnType<typeof parseMarkdown>): [number, number][] {
  const blockKeys = new Set(document.blocks.map((node) => `${node.kind}:${node.from}:${node.to}`))
  const prefixes: [number, number][] = [[0, 0]]
  let blocks = 0,
    headings = 0
  for (const child of document.root.children) {
    const pending: Nodes[] = [child]
    while (pending.length) {
      const node = pending.pop()
      if (!node) break
      const from = node.position?.start.offset,
        to = node.position?.end.offset
      if (from !== undefined && to !== undefined) {
        if (blockKeys.has(`${node.type}:${from}:${to}`)) blocks++
        if (node.type === 'heading') headings++
      }
      if ('children' in node) pending.push(...node.children)
    }
    prefixes.push([blocks, headings])
  }
  return prefixes
}

describe('source-bound packed document reuse', () => {
  it('binds frozen metadata intervals to the exact validated revision and document path', () => {
    const context = fixture('# Heading\n\n> - nested $x$\n\nLast.\n'),
      foreign = fixture('# Heading\n\n> - nested $x$\n\nLast.\n')
    const fork = context.capture.retain()
    try {
      const expected = metadataPrefixes(context.document)
      const range = context.baseline.metadataRange(fork, ['document'], 1, 1)
      expect(range).toEqual({
        blocks: {
          start: expected[1]?.[0],
          remove: (expected[2]?.[0] ?? 0) - (expected[1]?.[0] ?? 0),
          total: context.document.blocks.length,
        },
        outline: {
          start: expected[1]?.[1],
          remove: (expected[2]?.[1] ?? 0) - (expected[1]?.[1] ?? 0),
          total: context.document.outline.length,
        },
      })
      expect(Object.isFrozen(range)).toBe(true)
      expect(Object.isFrozen(range?.blocks)).toBe(true)
      expect(Object.isFrozen(range?.outline)).toBe(true)
      expect(context.baseline.metadataRange(fork, ['document'], 0, 3)).toEqual({
        blocks: {
          start: 0,
          remove: context.document.blocks.length,
          total: context.document.blocks.length,
        },
        outline: {
          start: 0,
          remove: context.document.outline.length,
          total: context.document.outline.length,
        },
      })
      expect(context.baseline.metadataRange(foreign.capture, ['document'], 1, 1)).toBeUndefined()
      expect(context.baseline.metadataRange(fork, [], 1, 1)).toBeUndefined()
      const next = context.delta(context.source.text, {}, () => [])
      expect(context.baseline.metadataRange(next.capture, ['document'], 1, 1)).toBeUndefined()
      next.capture.release()
      for (const [start, remove] of [
        [-1, 0],
        [0, -1],
        [0.5, 0],
        [4, 0],
        [3, 1],
        [0, Infinity],
      ])
        expect(() =>
          context.baseline.metadataRange(fork, ['document'], start ?? 0, remove ?? 0),
        ).toThrow('metadata range')
      context.baseline.close()
      expect(context.baseline.metadataRange(fork, ['document'], 1, 1)).toBeUndefined()
      expect(range?.blocks.total).toBe(context.document.blocks.length)
    } finally {
      context.owner.dispose()
      foreign.owner.dispose()
    }
  })
  it('locates the only insertion boundary of a validated empty document', () => {
    const context = fixture('')
    try {
      expect(context.baseline.metadataRange(context.capture, ['document'], 0, 0)).toEqual({
        blocks: { start: 0, remove: 0, total: 0 },
        outline: { start: 0, remove: 0, total: 0 },
      })
    } finally {
      context.owner.dispose()
    }
  })
  it('proves shared range-shifted descriptors without re-reading their immutable hashes', () => {
    const context = fixture('# Original\n\n> > nested\n\n## unchanged\n')
    const next = context.heading('# Longer original', true)
    const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
    try {
      finishPackedSteps(
        validatePackedDescriptions(
          next.capture,
          next.source,
          ['document'],
          limits,
          context.baseline,
        ),
      )
      expect(scalar.mock.calls.filter(([path]) => path[0] === 'hash')).toHaveLength(1)
      finishPackedSteps(validatePackedDocument(next.capture, next.source, ['document'], limits))
    } finally {
      scalar.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['commonmark', 'manuslip'] as const)(
    'validates shared revisions of all CommonMark examples in %s',
    (syntax) => {
      for (const example of examples) {
        const context = fixture(example.markdown, syntax)
        try {
          const prefixes = metadataPrefixes(context.document)
          for (let start = 0; start < prefixes.length; start++) {
            const remove = Number(start < prefixes.length - 1)
            const from = prefixes[start],
              to = prefixes[start + remove]
            expect(
              context.baseline.metadataRange(context.capture, ['document'], start, remove),
            ).toEqual({
              blocks: {
                start: from?.[0],
                remove: (to?.[0] ?? 0) - (from?.[0] ?? 0),
                total: context.document.blocks.length,
              },
              outline: {
                start: from?.[1],
                remove: (to?.[1] ?? 0) - (from?.[1] ?? 0),
                total: context.document.outline.length,
              },
            })
          }
          const next = context.delta(example.markdown, {}, () => [])
          finishPackedSteps(
            validatePackedDocument(
              next.capture,
              next.source,
              ['document'],
              limits,
              undefined,
              context.baseline,
            ),
          )
        } finally {
          context.owner.dispose()
        }
      }
    },
  )
  it.each(['LF', 'CRLF', 'BOM LF', 'BOM CRLF'])(
    'reuses shifted subtrees and reserialized descriptions with %s',
    (format) => {
      let text =
        '# Original heading\n\n> > nested **words** [link][r]\n>\n> second\n\n## unchanged **heading** $x$\n\n~~~js\nx()\n~~~\n\nwww.example.com\n\n| a | b |\n| - | - |\n| one | two |\n\n[r]: /url\n\ncall[^a]\n\n[^a]: note\n'
      if (format.includes('CRLF')) text = text.replaceAll('\n', '\r\n')
      if (format.includes('BOM')) text = `\ufeff${text}`
      for (const title of ['# Longer original heading extended', '# X']) {
        const context = fixture(text)
        const next = context.heading(title)
        const before = context.owner.stats
        const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
        try {
          finishPackedSteps(
            validatePackedDescriptions(next.capture, next.source, ['document'], limits),
          )
          const reads = scalar.mock.calls.filter(([path]) => path[0] === 'type').length
          scalar.mockClear()
          finishPackedSteps(
            validatePackedDescriptions(
              next.capture,
              next.source,
              ['document'],
              limits,
              context.baseline,
            ),
          )
          expect(scalar.mock.calls.filter(([path]) => path[0] === 'type').length).toBeLessThan(
            reads,
          )
          expect(context.owner.stats).toEqual(before)
          finishPackedSteps(
            validatePackedDocument(
              next.capture,
              next.source,
              ['document'],
              limits,
              undefined,
              context.baseline,
            ),
          )
          finishPackedSteps(validatePackedDocument(next.capture, next.source, ['document'], limits))
          context.owner.commit(next.prepared)
          expect(context.capture.identity.revision).toBe(0)
        } finally {
          scalar.mockRestore()
          context.owner.dispose()
        }
      }
    },
  )
  it('does not use shared records or old descriptor hashes as a source-equality proof', () => {
    const context = fixture('alpha\n')
    const next = context.delta('omega\n', { hash: sourceHash('omega\n') }, (field) => [
      { kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') },
    ])
    try {
      for (const baseline of [undefined, context.baseline])
        expect(() =>
          finishPackedSteps(
            validatePackedDescriptions(next.capture, next.source, ['document'], limits, baseline),
          ),
        ).toThrow('Invalid packed semantic document')
    } finally {
      context.owner.dispose()
    }
  })
  it('rechecks source-length bounds after shrinking other source content', () => {
    const text = `# ${'a'.repeat(500)}\n\nword\n`
    const document = parseMarkdown(text)
    const paragraph = document.root.children[1]
    if (paragraph?.type !== 'paragraph' || paragraph.children[0]?.type !== 'text')
      throw new Error('Fixture')
    paragraph.children[0].value = 'x'.repeat(300)
    const context = fixture(text, 'manuslip', document)
    const next = context.heading('# X')
    try {
      for (const baseline of [undefined, context.baseline])
        expect(() =>
          finishPackedSteps(
            validatePackedDescriptions(next.capture, next.source, ['document'], limits, baseline),
          ),
        ).toThrow('Invalid packed semantic document')
    } finally {
      context.owner.dispose()
    }
  })
  it('preserves the seven-unit URL allowance at the new source-length boundary', () => {
    const text = `# ${'a'.repeat(100)}\n\n[x](url)\n`
    const after = '# X\n\n[x](url)\n'
    const document = parseMarkdown(text)
    const paragraph = document.root.children[1]
    if (paragraph?.type !== 'paragraph' || paragraph.children[0]?.type !== 'link')
      throw new Error('Fixture')
    paragraph.children[0].url = 'y'.repeat(after.length + 7)
    const context = fixture(text, 'manuslip', document)
    const next = context.heading('# X')
    try {
      for (const baseline of [undefined, context.baseline])
        finishPackedSteps(
          validatePackedDescriptions(next.capture, next.source, ['document'], limits, baseline),
        )
    } finally {
      context.owner.dispose()
    }
  })
  it.each([
    'kind',
    'hash',
    'from',
    'to',
    'lines',
    'heading text',
    'heading depth',
    'missing',
    'extra',
  ])('rejects forged %s while reusing an unchanged root', (kind) => {
    const text = '# Heading\n\n> nested\n'
    const context = fixture(text)
    const document = structuredClone(context.document)
    const block = document.blocks[0],
      heading = document.outline[0]
    if (!block || !heading) throw new Error('Fixture')
    if (kind === 'kind') block.kind = 'code'
    else if (kind === 'hash') block.hash = 'forged'
    else if (kind === 'from') block.from++
    else if (kind === 'to') block.to--
    else if (kind === 'lines') block.lines++
    else if (kind === 'heading text') heading.text = 'Forged!'
    else if (kind === 'heading depth') heading.depth = 2
    else if (kind === 'missing') document.blocks.pop()
    else Reflect.set(block, 'extra', true)
    const next = context.delta(
      text,
      { blocks: document.blocks, outline: document.outline },
      (field) => [
        { kind: 'replace', path: ['document', 'blocks'], record: field('blocks') },
        { kind: 'replace', path: ['document', 'outline'], record: field('outline') },
      ],
    )
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedDescriptions(
            next.capture,
            next.source,
            ['document'],
            limits,
            context.baseline,
          ),
        ),
      ).toThrow(/packed semantic|packed path/i)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('preserves full logical node and depth limits during pruning', () => {
    const text = `${'> '.repeat(12)}nested\n`
    const context = fixture(text)
    const next = context.delta(text, {}, () => [])
    const node = next.capture.reader.at(['document', 'root', 'children', 0])
    const proof = finishPackedSteps(
      context.baseline.prove(node, next.source, node.position(['position'], limits)),
    )
    if (!proof) throw new Error('Missing proof')
    const before = context.owner.stats
    try {
      for (const baseline of [undefined, context.baseline])
        for (const [nodes, depth, valid] of [
          [proof.subtree.nodes + 1, proof.subtree.depth + 1, true],
          [proof.subtree.nodes, proof.subtree.depth + 1, false],
          [proof.subtree.nodes + 1, proof.subtree.depth, false],
        ] as const) {
          const validate = () =>
            finishPackedSteps(
              validatePackedDescriptions(
                next.capture,
                next.source,
                ['document'],
                { ...limits, nodes, depth },
                baseline,
              ),
            )
          if (valid) validate()
          else expect(validate).toThrow(/limit/)
          expect(context.owner.stats).toEqual(before)
        }
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'new capture', 'old capture', 'baseline', 'owner'])(
    'revokes suspended source proof on %s without accepting partial validation',
    (action) => {
      const text = `${'word '.repeat(5000)}\n`
      const context = fixture(text)
      const next = context.delta(text, {}, () => [])
      let proving = false
      const original = context.baseline.prove
      const spy = vi.spyOn(context.baseline, 'prove').mockImplementation(function* (
        this: PackedDocumentBaseline,
        ...args
      ) {
        const proof = original.apply(this, args)
        try {
          while (true) {
            const next = proof.next()
            if (next.done) return next.value
            proving = true
            yield next.value
          }
        } finally {
          proof.return(undefined)
        }
      })
      const before = context.owner.stats
      const work = validatePackedDescriptions(
        next.capture,
        next.source,
        ['document'],
        limits,
        context.baseline,
      )
      try {
        while (!proving) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        if (action === 'new capture') next.capture.release()
        if (action === 'old capture') context.capture.release()
        if (action === 'baseline') context.baseline.close()
        if (action === 'owner') context.owner.dispose()
        if (action === 'old capture' || action === 'baseline')
          expect(() => finishPackedSteps(work)).toThrow(/closed/)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        spy.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('falls back for fresh full arenas within the same owner', () => {
    const text = '# Heading\n\n> > nested\n'
    const context = fixture(text)
    const source = new PackedSource({ ...context.source.identity, revision: 1 }, text)
    const prepared = context.owner.prepareFull(
      context.owner.beginPrepared(source),
      source.identity,
      packValue({ document: context.document }, limits.staging),
    )
    const capture = context.owner.capturePrepared(prepared)
    const child = capture.reader.at(['document', 'root', 'children', 1])
    try {
      expect(
        finishPackedSteps(
          context.baseline.prove(child, source, child.position(['position'], limits)),
        ),
      ).toBeUndefined()
      finishPackedSteps(
        validatePackedDocument(capture, source, ['document'], limits, undefined, context.baseline),
      )
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects shared records whose shifted anchors disagree with current source coordinates', () => {
    const text = '# One\n\n# Two\n'
    const context = fixture(text)
    const next = context.delta(text, {}, () => [
      { kind: 'offset', path: ['document', 'root', 'children'], start: 1, offset: -1 },
    ])
    try {
      for (const baseline of [undefined, context.baseline])
        expect(() =>
          finishPackedSteps(
            validatePackedDescriptions(next.capture, next.source, ['document'], limits, baseline),
          ),
        ).toThrow('Invalid packed semantic document')
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects insufficient persistent cache admission without leaking a partial baseline', () => {
    const context = fixture('p\n\n'.repeat(4000))
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          PackedDocumentBaseline.create(context.capture, context.source, ['document'], {
            ...limits,
            retained: 3 * MiB,
            staging: 3 * MiB,
          }),
        ),
      ).toThrow(/cache limit/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('copies caller paths and limits before queued construction', () => {
    const context = fixture('plain\n')
    const path = ['document'],
      budget = { ...limits }
    const before = context.owner.stats
    const create = PackedDocumentBaseline.create(context.capture, context.source, path, budget)
    path[0] = 'missing'
    budget.nodes = 0
    try {
      const baseline = finishPackedSteps(create)
      if (!baseline) throw new Error('Missing baseline')
      baseline.close()
      expect(context.owner.stats).toEqual(before)
    } finally {
      create.return()
      context.owner.dispose()
    }
  })
  it('falls back for closed/different-owner baselines and rejects forged provenance', () => {
    const first = fixture('plain\n'),
      second = fixture('plain\n')
    const next = second.delta('plain\n', {}, () => [])
    try {
      finishPackedSteps(
        validatePackedDocument(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          first.baseline,
        ),
      )
      first.baseline.close()
      finishPackedSteps(
        validatePackedDocument(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          first.baseline,
        ),
      )
      expect(() => new (PackedDocumentBaseline as any)(Symbol('forged'), {})).toThrow(/provenance/)
    } finally {
      first.owner.dispose()
      second.owner.dispose()
    }
  })
})
