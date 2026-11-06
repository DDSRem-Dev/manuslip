import type { Nodes, Root } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { countFragmentDocument } from '../../src/fragment-counts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedReadScope } from '../../src/packing-capture'
import type { PackedOperation } from '../../src/packing-revision'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { validatePackedWords } from '../../src/packing-validate-words'
import { PackedWordBaseline } from '../../src/packing-word-baseline'
import { PackedWordBuffer } from '../../src/packing-word-buffer'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const session = { ...limits, bytes: 8 * MiB, retained: 64 * MiB, captures: 8, readers: 160 }
function words(root: Root): number {
  const values: string[] = []
  function visit(node: Nodes) {
    if (node.type === 'text') values.push(node.value)
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(root)
  return [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(values.join(' ')),
  ].filter((part) => part.isWordLike).length
}
function fixture(
  text: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
  document = parseMarkdown(text, syntax),
) {
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'word-reuse',
      revision: 0,
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
    PackedWordBaseline.create(capture, source, ['document'], limits),
  )
  if (!baseline) throw new Error('Missing baseline')
  function delta(
    value: unknown,
    operations: (field: (name: string) => number) => PackedOperation[] = () => [],
    after = text,
  ) {
    const source = new PackedSource(
      { ...capture.identity, revision: 1, sourceHash: sourceHash(after) },
      after,
    )
    const payload = packValue(value, limits.staging)
    const arena = PackedArena.open(payload.slice(0), session)
    const field = (name: string) => {
      const record = arena.field(arena.root, name)
      if (record === undefined) throw new Error('Missing record')
      return record
    }
    const prepared = owner.prepareDelta(owner.beginPrepared(source), {
      base: capture.identity,
      baseSource: text,
      result: source.identity,
      payload,
      operations: operations(field),
    })
    return { source, prepared, capture: owner.capturePrepared(prepared) }
  }
  return { source, owner, capture, baseline, delta, document }
}
describe('whole-string word validation with immutable subtree text reuse', () => {
  describe.each(['commonmark', 'manuslip'] as const)(
    'validates every CommonMark example with reuse in %s',
    (syntax) => {
      it.each(examples)('CommonMark $example: $section', (example) => {
        const context = fixture(example.markdown, syntax)
        try {
          const next = context.delta({})
          expect(context.baseline.matchesBase(next.capture)).toBe(false)
          finishPackedSteps(
            validatePackedWords(
              next.capture,
              next.source,
              ['document'],
              limits,
              undefined,
              context.baseline,
            ),
          )
          const counts = countFragmentDocument(
            context.capture,
            ['document', 'root'],
            { start: 0, remove: 0, children: [], source: context.source },
            limits,
            context.baseline,
          )
          expect({ words: counts.words, characters: counts.characters }).toEqual(
            context.document.counts,
          )
          expect(context.owner.stats.readerStagingBytes).toBe(0)
        } finally {
          context.owner.dispose()
        }
      })
    },
  )
  it('preserves empty leaves, empty subtrees and multilingual text in one complete Intl call', () => {
    const text = ' '.repeat(400)
    const document = parseMarkdown(text)
    document.root = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: '' }] },
        { type: 'thematicBreak' },
        {
          type: 'paragraph',
          children: ['ภาษา', '', 'ไทย', '中文', '没有', 'a\u0301', '👩🏽‍💻', '\ud800'].map(
            (value) => ({ type: 'text', value }),
          ),
        },
        { type: 'paragraph', children: [{ type: 'text', value: '' }] },
      ],
    }
    document.counts.words = words(document.root)
    const context = fixture(text, 'manuslip', document),
      next = context.delta({})
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    try {
      finishPackedSteps(
        validatePackedWords(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          context.baseline,
        ),
      )
      expect(segment).toHaveBeenCalledExactlyOnceWith(' ภาษา  ไทย 中文 没有 a\u0301 👩🏽‍💻 \ud800 ')
      expect(decode).not.toHaveBeenCalled()
      segment.mockClear()
      const counts = countFragmentDocument(
        context.capture,
        ['document', 'root'],
        { start: 0, remove: 0, children: [], source: context.source },
        limits,
        context.baseline,
      )
      expect(counts.words).toBe(document.counts.words)
      expect(segment).toHaveBeenCalledExactlyOnceWith(' ภาษา  ไทย 中文 没有 a\u0301 👩🏽‍💻 \ud800 ')
      expect(decode).not.toHaveBeenCalled()
    } finally {
      segment.mockRestore()
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it('does not decode or descend through an unchanged long nested subtree', () => {
    const text = `${'> '.repeat(20)}${'ภาษาไทย 中文 word '.repeat(2000)}\n`
    const context = fixture(text),
      next = context.delta({})
    const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    try {
      finishPackedSteps(
        validatePackedWords(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          context.baseline,
        ),
      )
      expect(
        scalar.mock.results.some(
          (result) =>
            result.type === 'return' && (result.value === 'paragraph' || result.value === 'text'),
        ),
      ).toBe(false)
      expect(decode).not.toHaveBeenCalled()
      expect(context.owner.stats.readerStagingBytes).toBe(0)
    } finally {
      scalar.mockRestore()
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it('streams changed text overlays and preserves the original count', () => {
    const text = 'old two\n\nunchanged\n',
      after = 'newword\n\nunchanged\n'
    const context = fixture(text)
    const fresh = parseMarkdown(after)
    const next = context.delta(
      { value: 'newword', hash: sourceHash(after), words: fresh.counts.words },
      (field) => [
        {
          kind: 'text',
          path: ['document', 'root', 'children', 0, 'children', 0, 'value'],
          start: 0,
          remove: 7,
          record: field('value'),
        },
        { kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') },
        { kind: 'replace', path: ['document', 'counts', 'words'], record: field('words') },
      ],
      after,
    )
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    try {
      finishPackedSteps(
        validatePackedWords(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          context.baseline,
        ),
      )
      expect(decode).toHaveBeenCalled()
      expect(context.capture.reader.scalar(['document', 'counts', 'words'], limits)).toBe(3)
      finishPackedSteps(validatePackedWords(next.capture, next.source, ['document'], limits))
    } finally {
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it('rejects a forged word count even when every subtree is cached', () => {
    const context = fixture('one two\n')
    const next = context.delta({ words: 1 }, (field) => [
      { kind: 'replace', path: ['document', 'counts', 'words'], record: field('words') },
    ])
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedWords(
            next.capture,
            next.source,
            ['document'],
            limits,
            undefined,
            context.baseline,
          ),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('keeps logical nodes, depth and text-length bounds during cache hits', () => {
    const text = `${'> '.repeat(12)}text\n`
    const context = fixture(text),
      next = context.delta({})
    const cache = context.baseline.find(next.capture.reader.at(['document', 'root', 'children', 0]))
    if (!cache) throw new Error('Missing cache')
    const before = context.owner.stats
    try {
      for (const baseline of [undefined, context.baseline])
        for (const [nodes, depth, valid] of [
          [cache.nodes + 1, cache.depth + 1, true],
          [cache.nodes, cache.depth + 1, false],
          [cache.nodes + 1, cache.depth, false],
        ] as const) {
          const validate = () =>
            finishPackedSteps(
              validatePackedWords(
                next.capture,
                next.source,
                ['document'],
                { ...limits, nodes, depth },
                undefined,
                baseline,
              ),
            )
          if (valid) validate()
          else expect(validate).toThrow(/limit/)
          expect(context.owner.stats).toEqual(before)
        }
      const shorter = context.delta(
        { hash: sourceHash('x') },
        (field) => [{ kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') }],
        'x',
      )
      expect(() =>
        finishPackedSteps(
          validatePackedWords(
            shorter.capture,
            shorter.source,
            ['document'],
            limits,
            undefined,
            context.baseline,
          ),
        ),
      ).toThrow(/semantic/)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'new capture', 'old capture', 'baseline', 'owner'])(
    'revokes cached collection on %s',
    (action) => {
      const context = fixture(`${'word '.repeat(2000)}\n`),
        next = context.delta({})
      const before = context.owner.stats
      let phase = ''
      const work = validatePackedWords(
        next.capture,
        next.source,
        ['document'],
        limits,
        (value) => {
          phase = value
        },
        context.baseline,
      )
      const cache = context.baseline.find(
        next.capture.reader.at(['document', 'root', 'children', 0]),
      )
      try {
        while (phase !== 'read') expect(work.next().done).toBe(false)
        for (let index = 0; index < 4; index++) expect(work.next().done).toBe(false)
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
        if (['old capture', 'baseline', 'owner'].includes(action))
          expect(() => cache?.chunks).toThrow(/closed/)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  it.each(['retained', 'staging'] as const)(
    'rejects insufficient %s admission and releases partial construction',
    (resource) => {
      const context = fixture('p\n\n'.repeat(4000))
      const before = context.owner.stats
      try {
        expect(() =>
          finishPackedSteps(
            PackedWordBaseline.create(context.capture, context.source, ['document'], {
              ...limits,
              [resource]: resource === 'retained' ? (3 * MiB) / 2 : 192 * 1024,
            }),
          ),
        ).toThrow(resource === 'retained' ? /cache limit/ : /workspace limit/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it.each([
    { name: 'one chunk', text: 'word\n' },
    { name: 'several chunks', text: `${'word '.repeat(3000)}\n` },
  ])(
    'revokes escaped flat-cache iterators before the next chunk or end check with $name',
    ({ text }) => {
      const context = fixture(text)
      try {
        const cached = context.baseline.find(
          context.capture.reader.at(['document', 'root', 'children', 0]),
        )
        if (!cached) throw new Error('Missing cache')
        const iterator = cached.chunks[Symbol.iterator]()
        expect(iterator.next().done).toBe(false)
        context.baseline.close()
        expect(() => iterator.next()).toThrow(/closed/)
        expect(() => cached.chunks).toThrow(/closed/)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('revokes an unadvanced empty cached chunk stream', () => {
    const context = fixture('* * *\n')
    try {
      const cached = context.baseline.find(
        context.capture.reader.at(['document', 'root', 'children', 0]),
      )
      if (!cached) throw new Error('Missing empty cache')
      expect(cached.texts).toBe(0)
      const iterator = cached.chunks[Symbol.iterator]()
      context.baseline.close()
      expect(() => iterator.next()).toThrow(/closed/)
    } finally {
      context.owner.dispose()
    }
  })
  it('keeps complete text caches for many small blocks under a constrained metadata budget', () => {
    const context = fixture('p\n\n'.repeat(4000)),
      before = context.owner.stats
    try {
      const baseline = finishPackedSteps(
        PackedWordBaseline.create(context.capture, context.source, ['document'], {
          ...limits,
          retained: (5 * MiB) / 2,
        }),
      )
      if (!baseline) throw new Error('Missing compact baseline')
      try {
        const next = context.delta({})
        for (const index of [0, 1, 3999]) {
          const cached = baseline.find(
            next.capture.reader.at(['document', 'root', 'children', index]),
          )
          expect([...(cached?.chunks ?? [])].join('')).toBe('p')
          expect(cached?.texts).toBe(1)
        }
        finishPackedSteps(
          validatePackedWords(next.capture, next.source, ['document'], limits, undefined, baseline),
        )
        next.capture.release()
      } finally {
        baseline.close()
      }
      expect(context.owner.stats.readerStagingBytes).toBe(before.readerStagingBytes)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['baseline', 'old capture'] as const)(
    'rejects reentrant revocation by %s during a phase callback',
    (action) => {
      const context = fixture('plain\n'),
        next = context.delta({})
      const work = validatePackedWords(
        next.capture,
        next.source,
        ['document'],
        limits,
        (phase) => {
          if (phase !== 'read') return
          if (action === 'baseline') context.baseline.close()
          else context.capture.release()
        },
        context.baseline,
      )
      try {
        expect(() => finishPackedSteps(work)).toThrow(/closed/)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  it('copies caller paths and limits before queued construction and validation', () => {
    const context = fixture('plain\n'),
      next = context.delta({})
    const path = ['document'],
      budget = { ...limits },
      before = context.owner.stats
    const create = PackedWordBaseline.create(context.capture, context.source, path, budget)
    const validate = validatePackedWords(
      next.capture,
      next.source,
      path,
      budget,
      undefined,
      context.baseline,
    )
    path[0] = 'missing'
    budget.nodes = 0
    try {
      const baseline = finishPackedSteps(create)
      if (!baseline) throw new Error('Missing baseline')
      baseline.close()
      finishPackedSteps(validate)
      expect(context.owner.stats).toEqual(before)
    } finally {
      create.return()
      validate.return()
      context.owner.dispose()
    }
  })
  it.each(['return', 'capture', 'owner'])('releases a partially copied cache on %s', (action) => {
    const context = fixture(`${'word '.repeat(2000)}\n\nlast\n`)
    const before = context.owner.stats
    const copied = vi.spyOn(PackedWordBuffer.prototype, 'finishChunks')
    const create = PackedWordBaseline.create(context.capture, context.source, ['document'], limits)
    try {
      while (!copied.mock.calls.length) expect(create.next().done).toBe(false)
      if (action === 'return') create.return()
      if (action === 'capture') context.capture.release()
      if (action === 'owner') context.owner.dispose()
      expect(create.next().done).toBe(true)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      if (action === 'return') expect(context.owner.stats).toEqual(before)
      if (action === 'owner') expect(context.owner.stats.retainedBytes).toBe(0)
    } finally {
      copied.mockRestore()
      create.return()
      context.owner.dispose()
    }
  })
  it('uses full traversal for newly packed records in a compatible owner', () => {
    const context = fixture(`${'word '.repeat(2000)}\n`)
    const next = context.delta({ document: context.document }, (field) => [
      { kind: 'replace', path: ['document'], record: field('document') },
    ])
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    const before = context.owner.stats
    try {
      expect(context.baseline.compatible(next.capture, next.source)).toBe(true)
      expect(
        context.baseline.find(next.capture.reader.at(['document', 'root', 'children', 0])),
      ).toBeUndefined()
      finishPackedSteps(
        validatePackedWords(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          context.baseline,
        ),
      )
      expect(decode).toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it('falls back for closed and different-owner baselines', () => {
    const first = fixture('plain\n'),
      second = fixture('plain\n'),
      next = second.delta({})
    try {
      expect(
        first.baseline.find(next.capture.reader.at(['document', 'root', 'children', 0])),
      ).toBeUndefined()
      finishPackedSteps(
        validatePackedWords(
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
        validatePackedWords(
          next.capture,
          next.source,
          ['document'],
          limits,
          undefined,
          first.baseline,
        ),
      )
      expect(() => new (PackedWordBaseline as any)(Symbol('forged'), {})).toThrow(/provenance/)
    } finally {
      first.owner.dispose()
      second.owner.dispose()
    }
  })
})
