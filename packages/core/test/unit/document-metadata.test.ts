import { describe, expect, it, vi } from 'vitest'
import type { SemanticDocument } from '../../src/contracts'
import { sourceHash } from '../../src/contracts'
import { describeDocumentFragment, documentFragmentOperations } from '../../src/document-metadata'
import { reparseMarkdownFragment } from '../../src/markdown-fragment'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedReadScope } from '../../src/packing-capture'
import { PackedDocumentBaseline } from '../../src/packing-document-baseline'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { PackedWordBaseline } from '../../src/packing-word-baseline'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import { SemanticDependencies } from '../../src/semantic-dependencies'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
const sessionLimits = { ...limits, retained: 16 * MiB, bytes: 8 * MiB, captures: 4, readers: 128 }
function fixture(
  source = 'Before.\n\nOrdinary writing.\n\n# After\n',
  mutate?: (document: SemanticDocument) => void,
) {
  const document = parseMarkdown(source)
  mutate?.(document)
  const identity = {
    generation: 1,
    documentId: 'metadata',
    revision: 0,
    sourceHash: sourceHash(source),
    parserVersion: document.parserVersion,
    rendererVersion: 'test',
    options: 'test',
  }
  const owner = new PackedSession(sessionLimits)
  owner.commit(
    owner.prepareFull(owner.begin(identity, source), identity, packValue({ document }, 8 * MiB)),
  )
  const capture = owner.capture()
  const dependencies = SemanticDependencies.build(capture, source, ['document', 'root'], limits)
  const from = source.indexOf('writing')
  const after = `${source.slice(0, from)}longer prose${source.slice(from + 7)}`
  const checked = new PackedSource(
    { ...identity, revision: 1, sourceHash: sourceHash(after) },
    after,
  )
  const fragment = reparseMarkdownFragment(
    {
      capture,
      dependencies,
      baseSource: source,
      source: checked,
      change: { from, to: from + 7, insert: 'longer prose' },
      root: ['document', 'root'],
      syntax: 'manuslip',
    },
    { ...limits, nodes: 8192, bytes: 64 * 1024 },
  )
  if (fragment.kind !== 'fragment') throw new Error(`Unexpected fallback: ${fragment.reason}`)
  const request = { capture, dependencies, fragment, document: ['document'], parseMs: 12 }
  const metadata = (changed = {}) => describeDocumentFragment(request, { ...limits, ...changed })
  return { owner, capture, dependencies, fragment, request, metadata, document, after }
}
const payload = (
  context: ReturnType<typeof fixture>,
  metadata: ReturnType<ReturnType<typeof fixture>['metadata']>,
) =>
  PackedArena.open(
    packValue(
      {
        children: context.fragment.children,
        position: context.fragment.position,
        blocks: metadata.blocks.values,
        outline: metadata.outline.values,
        counts: metadata.counts,
        sourceHash: metadata.source.identity.sourceHash,
        parserVersion: metadata.source.identity.parserVersion,
        timings: metadata.timings,
      },
      8 * MiB,
    ),
    sessionLimits,
  )

function wordBaseline(context: ReturnType<typeof fixture>) {
  const baseline = finishPackedSteps(
    PackedWordBaseline.create(
      context.capture,
      context.capture.sourceResource,
      ['document'],
      limits,
    ),
  )
  if (!baseline) throw new Error('Missing word baseline')
  return baseline
}

describe('complete fragment parser metadata', () => {
  it('counts a complete unchanged 1 MiB paragraph through bounded text pieces under existing staging', () => {
    const long = `${'word '.repeat(Math.ceil(MiB / 5))}中文 العربية עברית 😀 e\u0301 \ud800 \udc00`
    const context = fixture(`Ordinary writing.\n\n${long}`)
    const scalar = PackedReadScope.prototype.scalar
    const inspect = vi.spyOn(PackedReadScope.prototype, 'scalar').mockImplementation(function (
      this: PackedReadScope,
      path,
      limits,
    ) {
      if (path.at(-1) === 'value' && this.textLength(path) > 4096)
        throw new Error('Unexpected whole-text scalar')
      return scalar.call(this, path, limits)
    })
    const baseline = context.owner.stats
    try {
      const metadata = context.metadata()
      expect(metadata.counts).toEqual(parseMarkdown(context.after).counts)
      expect(metadata.stagingBytes).toBeLessThan(8 * MiB)
      expect(() => context.metadata({ staging: metadata.stagingBytes - 1 })).toThrow(
        'staging limit',
      )
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      inspect.mockRestore()
      context.capture.release()
      context.owner.dispose()
    }
    // Full 1 MiB parsing, oracle counts and both staging-boundary passes are correctness work.
  }, 30_000)

  it.each([
    'Ordinary writing.\n\n# Last\n',
    '# First\n\n> - Ordinary writing $x$.\n> - More\n\n# Last\n',
    '# First\n\n- Ordinary writing.\n- More\n\n[^n]: note\n',
    '[r]: /target\n\n# First\n\nOrdinary writing.\n',
    '---\ntitle: test\n---\n\n| A | B |\n| - | - |\n| x | y |\n\n## Ordinary writing\n',
    '# First\r\n\r\nOrdinary writing 😀.\r\n\r\n# Last\r\n',
  ])('locates complete descriptor replacements from the certified base: %j', (source) => {
    const context = fixture(source)
    try {
      const expected = context.metadata()
      const baseline = finishPackedSteps(
        PackedDocumentBaseline.create(
          context.capture,
          context.capture.sourceResource,
          ['document'],
          { ...limits, depth: 128 },
        ),
      )
      if (!baseline) throw new Error('Missing document baseline')
      const elements = vi.spyOn(PackedReadScope.prototype, 'elements')
      try {
        const current = describeDocumentFragment({ ...context.request, baseline }, limits)
        for (const field of [
          'blocks',
          'outline',
          'counts',
          'retainedBytes',
          'stagingBytes',
        ] as const)
          expect(current[field]).toEqual(expected[field])
        expect(
          elements.mock.calls.filter(
            ([path]) => path?.[0] === 'document' && (path[1] === 'blocks' || path[1] === 'outline'),
          ),
        ).toHaveLength(0)
        const data = payload(context, current)
        expect(
          documentFragmentOperations(context.fragment, current, data, ['document']),
        ).toHaveLength(11)
        for (const changed of [
          { nodes: 2 },
          { depth: 1 },
          { retained: current.retainedBytes - 1 },
          { staging: current.stagingBytes - 1 },
        ])
          expect(() =>
            describeDocumentFragment({ ...context.request, baseline }, { ...limits, ...changed }),
          ).toThrow(/limit/)
        baseline.close()
        elements.mockClear()
        expect(describeDocumentFragment({ ...context.request, baseline }, limits).blocks).toEqual(
          expected.blocks,
        )
        expect(elements.mock.calls.filter(([path]) => path?.[1] === 'blocks')).toHaveLength(1)
      } finally {
        elements.mockRestore()
      }
    } finally {
      context.owner.dispose()
    }
  })
  it.each([
    '中文繁體ภาษาไทยខ្មែរမြန်မာ',
    'a\u200db\u2060c\u0301 עברית׳ אב״ג',
    '𐐀𐐁 😀 👨‍👩‍👧‍👦 🇸🇬 \ud800 lone \udfff',
    '*left* middle **right** ![image alt](/image) `code text` $math$ &amp; &#x1f600;',
    'Call[^a] [r].\n\n[^a]: Footer **text**.\n[r]: /r\n',
    '| A | B |\n| - | - |\n| table words | other |\n',
    '```js\nnot counted as prose\n```\n\n<div>not prose</div>\n',
    '> > Deep [link][r]\n\n[r]: /r\n',
    `${'ภาษาไทย 中文 word '.repeat(2000)}\n\nshort cached prose`,
    '---\ntitle: frontmatter words\n---\n',
  ])('preserves exact whole-parser Intl word input and code-point counts: %j', (extra) => {
    const context = fixture(`${extra}\n\nOrdinary writing.\n\n# Last 😀\n`)
    try {
      const metadata = context.metadata()
      expect(metadata.counts).toEqual(parseMarkdown(context.after).counts)
      const words = wordBaseline(context)
      expect(describeDocumentFragment({ ...context.request, words }, limits).counts).toEqual(
        metadata.counts,
      )
      words.close()
      expect(metadata.timings.parse).toBe(12)
      expect(metadata.timings.describe).toBeGreaterThanOrEqual(0)
      for (const value of [
        metadata,
        metadata.blocks,
        metadata.outline,
        metadata.blocks.values,
        metadata.counts,
        metadata.timings,
      ])
        expect(Object.isFrozen(value)).toBe(true)
      for (const block of metadata.blocks.values) expect(Object.isFrozen(block)).toBe(true)
      const hold = context.owner.retain(metadata)
      context.owner.invalidate()
      context.owner.evict()
      context.capture.release()
      expect(context.owner.stats.holds).toBe(1)
      hold.release()
      expect(context.owner.stats.retainedBytes).toBe(256)
    } finally {
      context.owner.dispose()
    }
  })
  it('charges every cached logical node/depth and keeps full prose workspace admitted', () => {
    const context = fixture(
      `Ordinary writing.\n\n> > > > ${'ภาษาไทย 中文 word '.repeat(1000)}\n\n# Last\n`,
    )
    try {
      const words = wordBaseline(context)
      const request = { ...context.request, words }
      const metadata = describeDocumentFragment(request, limits)
      const before = context.owner.stats
      for (const changed of [{ nodes: 2 }, { depth: 2 }, { staging: metadata.stagingBytes - 1 }]) {
        expect(() => describeDocumentFragment(request, { ...limits, ...changed })).toThrow(/limit/)
        expect(context.owner.stats).toEqual(before)
      }
      expect(describeDocumentFragment(request, limits).counts).toEqual(
        parseMarkdown(context.after).counts,
      )
    } finally {
      context.owner.dispose()
    }
  })

  it('falls back for foreign/closed caches and rejects reentrant revocation before publication', () => {
    const context = fixture(),
      foreign = fixture()
    try {
      const baselineStats = context.owner.stats
      const words = wordBaseline(context),
        other = wordBaseline(foreign)
      expect(words.matchesBase(context.capture)).toBe(true)
      expect(other.matchesBase(context.capture)).toBe(false)
      const foreignFind = vi.spyOn(other, 'find')
      expect(describeDocumentFragment({ ...context.request, words: other }, limits).counts).toEqual(
        parseMarkdown(context.after).counts,
      )
      expect(foreignFind).not.toHaveBeenCalled()
      const original = Intl.Segmenter.prototype.segment
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (
        this: Intl.Segmenter,
        input: string,
      ) {
        words.close()
        return original.call(this, input)
      })
      try {
        expect(() => describeDocumentFragment({ ...context.request, words }, limits)).toThrow(
          'closed during fragment counts',
        )
      } finally {
        segment.mockRestore()
      }
      expect(context.owner.stats).toEqual(baselineStats)
      const closedFind = vi.spyOn(words, 'find')
      expect(describeDocumentFragment({ ...context.request, words }, limits).counts).toEqual(
        parseMarkdown(context.after).counts,
      )
      expect(closedFind).not.toHaveBeenCalled()
    } finally {
      context.owner.dispose()
      foreign.owner.dispose()
    }
  })
  it('rejects release of the producer capture even while the cache capture remains live', () => {
    const context = fixture()
    try {
      const words = wordBaseline(context)
      const before = context.owner.stats
      const capture = context.owner.capture()
      expect(words.matchesBase(capture)).toBe(true)
      const original = Intl.Segmenter.prototype.segment
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (
        this: Intl.Segmenter,
        input: string,
      ) {
        capture.release()
        return original.call(this, input)
      })
      try {
        expect(() =>
          describeDocumentFragment({ ...context.request, capture, words }, limits),
        ).toThrow(/released|closed/)
      } finally {
        segment.mockRestore()
      }
      words.assertOpen()
      expect(context.owner.stats).toEqual(before)
      expect(describeDocumentFragment({ ...context.request, words }, limits).counts).toEqual(
        parseMarkdown(context.after).counts,
      )
    } finally {
      context.owner.dispose()
    }
  })

  it('admits exact retained/staging boundaries and cleans readers on failure in unchanged suffixes', () => {
    const context = fixture('Ordinary writing.\n\n> > > > Unchanged deep prose.\n\n# Last\n')
    try {
      const metadata = context.metadata()
      expect(
        context.metadata({ retained: metadata.retainedBytes, staging: metadata.stagingBytes })
          .counts,
      ).toEqual(metadata.counts)
      const before = context.owner.stats
      for (const changed of [
        { retained: metadata.retainedBytes - 1 },
        { staging: metadata.stagingBytes - 1 },
        { nodes: 2 },
        { depth: 2 },
      ]) {
        expect(() => context.metadata(changed)).toThrow(/limit/)
        expect(context.owner.stats).toEqual(before)
      }
      expect(context.metadata().counts).toEqual(metadata.counts)
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects cloned/cross-fragment metadata and a different publication path', () => {
    const context = fixture()
    try {
      const metadata = context.metadata()
      const data = payload(context, metadata)
      expect(
        documentFragmentOperations(context.fragment, metadata, data, ['document']),
      ).toHaveLength(11)
      expect(() =>
        documentFragmentOperations({ ...context.fragment }, metadata, data, ['document']),
      ).toThrow('mismatch')
      expect(() =>
        documentFragmentOperations(context.fragment, { ...metadata }, data, ['document']),
      ).toThrow('mismatch')
      expect(() => documentFragmentOperations(context.fragment, metadata, data, [])).toThrow(
        'mismatch',
      )
      const missing = PackedArena.open(
        packValue({ children: context.fragment.children }, 8 * MiB),
        sessionLimits,
      )
      expect(() =>
        documentFragmentOperations(context.fragment, metadata, missing, ['document']),
      ).toThrow('Missing')
      expect(() =>
        describeDocumentFragment({ ...context.request, fragment: { ...context.fragment } }, limits),
      ).toThrow('provenance')
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects stale hashes/parser versions and malformed descriptor ranges before publication', () => {
    for (const mutate of [
      (document: SemanticDocument) => {
        document.sourceHash = 'stale'
      },
      (document: SemanticDocument) => {
        if (document.blocks[0]) document.blocks[0].to = -1
      },
      (document: SemanticDocument) => {
        if (document.outline[0]) document.outline[0].from = -1
      },
    ]) {
      const context = fixture(undefined, mutate)
      try {
        const before = context.owner.stats
        expect(() => context.metadata()).toThrow(/metadata/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    }
    const context = fixture()
    try {
      const original = context.document.parserVersion
      const changed = { ...context.document, parserVersion: 'stale' }
      const owner = new PackedSession(sessionLimits)
      const source = context.capture.sourceResource
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ document: changed }, 8 * MiB),
        ),
      )
      const capture = owner.capture()
      expect(() => describeDocumentFragment({ ...context.request, capture }, limits)).toThrow(
        'Stale',
      )
      expect(context.document.parserVersion).toBe(original)
      owner.dispose()
    } finally {
      context.owner.dispose()
    }
  })
  it('validates every limit, timing and document path, including released captures', () => {
    const context = fixture()
    try {
      const before = context.owner.stats
      for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
        for (const value of [-1, NaN, Infinity, 0.5])
          expect(() => context.metadata({ [key]: value })).toThrow('limits')
      for (const changed of [
        { retained: 17 * MiB },
        { staging: 9 * MiB },
        { nodes: 800001 },
        { depth: 65 },
      ])
        expect(() => context.metadata(changed)).toThrow('limits')
      for (const parseMs of [-1, NaN, Infinity])
        expect(() => describeDocumentFragment({ ...context.request, parseMs }, limits)).toThrow(
          'request',
        )
      for (const document of [[-1], ['x'.repeat(257)], Array(65).fill('x')])
        expect(() => describeDocumentFragment({ ...context.request, document }, limits)).toThrow(
          'request',
        )
      expect(context.owner.stats).toEqual(before)
      context.capture.release()
      expect(() => context.metadata()).toThrow('released')
    } finally {
      context.owner.dispose()
    }
  })
})
