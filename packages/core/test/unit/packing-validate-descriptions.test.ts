import type { Nodes as MarkdownNode } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { type SemanticDocument, sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedItemSteps, PackedReadScope } from '../../src/packing-capture'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import {
  packedDescriptionSteps,
  validatePackedDescriptions,
} from '../../src/packing-validate-descriptions'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: MiB, staging: MiB, nodes: 800000, depth: 128 }
function fixture(text: string, document = parseMarkdown(text)) {
  const checked = new PackedSource(
    {
      generation: 1,
      documentId: 'descriptions',
      revision: 1,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
  const owner = new PackedSession(limits)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(checked),
      checked.identity,
      packValue({ document }, limits.bytes),
    ),
  )
  const capture = owner.capture()
  return {
    owner,
    capture,
    checked,
    work: (changed = {}) =>
      validatePackedDescriptions(capture, checked, ['document'], { ...validation, ...changed }),
  }
}
function validate(text: string, document = parseMarkdown(text)) {
  const context = fixture(text, document)
  try {
    finishPackedSteps(context.work())
  } finally {
    context.owner.dispose()
  }
  expect(context.owner.stats.retainedBytes).toBe(0)
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}

describe('packed parser root and descriptions', () => {
  it.each([false, true])(
    'composes synchronous root observations with complete description validation, corrupt=%s',
    (corrupt) => {
      const text = '# Heading\r\n\r\nText 世界 [link][ref].\r\n\r\n[ref]: /target\r\n'
      const document = parseMarkdown(text)
      const expected: unknown[] = []
      const visit = (node: MarkdownNode): void => {
        expected.push({ type: node.type, position: node.position })
        if ('children' in node) for (const child of node.children) visit(child)
      }
      visit(document.root)
      if (corrupt) required(document.blocks[0]).hash = 'invalid hash'
      const context = fixture(text, document)
      const before = context.owner.stats
      const observed: unknown[] = []
      const work = context.capture.work(
        packedDescriptionSteps(
          context.capture,
          context.checked,
          ['document'],
          validation,
          undefined,
          undefined,
          (_node, type, position) => {
            observed.push({ type, position })
          },
        ),
      )
      try {
        if (corrupt) expect(() => finishPackedSteps(work)).toThrow('Invalid packed semantic')
        else {
          finishPackedSteps(work)
          expect(observed).toEqual(expected)
        }
        expect(observed.length).toBeGreaterThan(0)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each([
    { name: 'cancel with Error', primary: false, original: undefined, cleanup: new Error('close') },
    { name: 'cancel with undefined', primary: false, original: undefined, cleanup: undefined },
    { name: 'observer Error', primary: true, original: new Error('observe'), cleanup: undefined },
    { name: 'observer undefined', primary: true, original: undefined, cleanup: new Error('close') },
  ])(
    'finishes description cleanup after a cleanup failure: $name',
    ({ primary, original, cleanup }) => {
      const context = fixture('# Heading\n\nparagraph\n')
      const before = context.owner.stats
      const iterators: PackedItemSteps[] = []
      const elementSteps = PackedReadScope.prototype.elementSteps
      const opened = vi
        .spyOn(PackedReadScope.prototype, 'elementSteps')
        .mockImplementation(function (this: PackedReadScope, path = []) {
          const iterator = elementSteps.call(this, path)
          if (path.at(-1) === 'blocks' || path.at(-1) === 'outline') iterators.push(iterator)
          return iterator
        })
      let observed = false
      const work = context.capture.work(
        packedDescriptionSteps(
          context.capture,
          context.checked,
          ['document'],
          validation,
          undefined,
          undefined,
          function* () {
            observed = true
            yield
            if (primary) throw original
          },
        ),
      )
      let closing: ReturnType<typeof vi.spyOn> | undefined
      try {
        while (!observed) expect(work.next().done).toBe(false)
        expect(iterators).toHaveLength(2)
        const close = PackedItemSteps.prototype.return
        const closed = new Set<PackedItemSteps>()
        closing = vi.spyOn(PackedItemSteps.prototype, 'return').mockImplementation(function (
          this: PackedItemSteps,
        ) {
          const result = close.call(this)
          if (iterators.includes(this)) {
            expect(closed.has(this)).toBe(false)
            closed.add(this)
            if (this === iterators[0]) throw cleanup
            throw new Error('later close')
          }
          return result
        })
        let threw = false
        let failure: unknown
        try {
          if (primary) work.next()
          else work.return()
        } catch (error) {
          threw = true
          failure = error
        }
        expect(threw).toBe(true)
        expect(failure).toBe(primary ? original : cleanup)
        expect(closed.size).toBe(2)
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(work.return()).toEqual({ done: true, value: undefined })
        for (const iterator of iterators)
          expect(iterator.next()).toEqual({ done: true, value: undefined })
      } finally {
        closing?.mockRestore()
        opened.mockRestore()
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each(['commonmark', 'manuslip'] as const)(
    'matches every pinned CommonMark description in %s',
    (syntax) => {
      for (const example of examples)
        validate(example.markdown, parseMarkdown(example.markdown, syntax))
    },
  )
  it.each([
    '',
    '\ufeff',
    '\ufeff# 😀\r\n\r\nparagraph\r\n',
    '# **one** `code` $x$ ![image](url) [link](url) <i>HTML</i> &amp; ~~end~~\n',
    '## user@e.co and www.example.com?\n',
    '# A\n\n- [x] task\n- [ ] task\n\n| A | B |\n| :- | -: |\n| one | two |\n',
    '---\ntitle: Heading\n---\n\n# Two\n\n$$\nx^2\n$$\n\n[^a]: note\n\nText[^a]\n',
    `# ${'\ud800\ud800\udfff\udfff😀\r\n'.repeat(500)}`,
  ])('matches extension, Unicode and heading plaintext metadata %j', (text) => validate(text))

  it.each([4095, 4096, 4097, 8192, 8193])(
    'validates nonzero Unicode source ranges spanning %i UTF-16 units',
    (units) => {
      const body = '😀x'.repeat(Math.ceil(units / 3)).slice(0, units)
      const text = `# Start\r\n\r\n${body}\r\n\r\nEnd\r\n`
      const document = parseMarkdown(text)
      const block = required(document.blocks.find((block) => block.kind === 'paragraph'))
      expect(block.from).toBeGreaterThan(0)
      expect(block.to - block.from).toBe(units)
      expect(block.hash).toBe(sourceHash(text.slice(block.from, block.to)))
      validate(text, document)
      block.hash = sourceHash(body.slice(0, -1))
      expect(() => validate(text, document)).toThrow('Invalid packed semantic')
    },
  )

  it('cancels descriptor hashing before reading the remaining source range', () => {
    const text = `# Start\r\n\r\n${'😀x'.repeat(6000)}\r\n\r\nEnd\r\n`
    const context = fixture(text)
    const before = context.owner.stats
    let hashing = false
    const work = context.capture.work(
      packedDescriptionSteps(
        context.capture,
        context.checked,
        ['document'],
        validation,
        undefined,
        undefined,
        function* (_node, type) {
          if (!hashing && type === 'paragraph') {
            hashing = true
            yield
          }
        },
      ),
    )
    const original = String.prototype.charCodeAt
    let reads = 0
    let character: ReturnType<typeof vi.spyOn> | undefined
    try {
      let advances = 0
      while (!hashing)
        if (work.next().done || ++advances > 10000) throw new Error('No descriptor hash reached')
      character = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
        this: string,
        at,
      ) {
        if (this.valueOf() === text) reads++
        return original.call(this, at)
      })
      expect(work.next().done).toBe(false)
      expect(reads).toBe(4096)
      work.return()
      expect(context.owner.stats).toEqual(before)
      expect(work.next().done).toBe(true)
      expect(reads).toBe(4096)
    } finally {
      character?.mockRestore()
      work.return()
      context.owner.dispose()
    }
    expect(context.owner.stats.retainedBytes).toBe(0)
  })

  const mutations: { name: string; change: (document: SemanticDocument) => void }[] = [
    {
      name: 'unknown document field',
      change: (doc) => {
        Reflect.set(doc, 'extra', true)
      },
    },
    {
      name: 'missing metadata',
      change: (doc) => {
        Reflect.deleteProperty(doc, 'counts')
      },
    },
    {
      name: 'source identity',
      change: (doc) => {
        doc.sourceHash = 'bad'
      },
    },
    {
      name: 'parser version',
      change: (doc) => {
        doc.parserVersion = 'bad'
      },
    },
    {
      name: 'character count',
      change: (doc) => {
        doc.counts.characters++
      },
    },
    {
      name: 'negative word count',
      change: (doc) => {
        doc.counts.words = -1
      },
    },
    {
      name: 'fractional word count',
      change: (doc) => {
        doc.counts.words = 1.5
      },
    },
    {
      name: 'oversize word count',
      change: (doc) => {
        doc.counts.words = 999999
      },
    },
    {
      name: 'word count type',
      change: (doc) => {
        Reflect.set(doc.counts, 'words', '1')
      },
    },
    {
      name: 'unknown count field',
      change: (doc) => {
        Reflect.set(doc.counts, 'extra', true)
      },
    },
    {
      name: 'negative timing',
      change: (doc) => {
        doc.timings.parse = -1
      },
    },
    {
      name: 'timing type',
      change: (doc) => {
        Reflect.set(doc.timings, 'describe', '1')
      },
    },
    {
      name: 'extra timing',
      change: (doc) => {
        Reflect.set(doc.timings, 'extra', 1)
      },
    },
    {
      name: 'missing block',
      change: (doc) => {
        doc.blocks.pop()
      },
    },
    {
      name: 'extra block',
      change: (doc) => {
        doc.blocks.push(required(doc.blocks[0]))
      },
    },
    {
      name: 'reordered blocks',
      change: (doc) => {
        doc.blocks.reverse()
      },
    },
    {
      name: 'block kind',
      change: (doc) => {
        required(doc.blocks[0]).kind = 'paragraph'
      },
    },
    {
      name: 'block from',
      change: (doc) => {
        required(doc.blocks[0]).from++
      },
    },
    {
      name: 'block to',
      change: (doc) => {
        required(doc.blocks[0]).to++
      },
    },
    {
      name: 'block lines',
      change: (doc) => {
        required(doc.blocks[0]).lines++
      },
    },
    {
      name: 'block hash',
      change: (doc) => {
        required(doc.blocks[0]).hash = 'bad'
      },
    },
    {
      name: 'unknown block field',
      change: (doc) => {
        Reflect.set(required(doc.blocks[0]), 'extra', true)
      },
    },
    {
      name: 'missing heading',
      change: (doc) => {
        doc.outline.pop()
      },
    },
    {
      name: 'extra heading',
      change: (doc) => {
        doc.outline.push(required(doc.outline[0]))
      },
    },
    {
      name: 'heading depth',
      change: (doc) => {
        required(doc.outline[0]).depth++
      },
    },
    {
      name: 'heading from',
      change: (doc) => {
        required(doc.outline[0]).from++
      },
    },
    {
      name: 'heading to',
      change: (doc) => {
        required(doc.outline[0]).to++
      },
    },
    {
      name: 'heading text',
      change: (doc) => {
        required(doc.outline[0]).text += 'bad'
      },
    },
    {
      name: 'heading text type',
      change: (doc) => {
        Reflect.set(required(doc.outline[0]), 'text', 42)
      },
    },
    {
      name: 'unknown heading field',
      change: (doc) => {
        Reflect.set(required(doc.outline[0]), 'extra', true)
      },
    },
    {
      name: 'late AST position',
      change: (doc) => {
        required(required(doc.root.children.at(-1)).position).end.column++
      },
    },
  ]
  it.each(mutations)('rejects $name', ({ change }) => {
    const text = '# Heading\n\nfirst paragraph\n\n## Two\n\nlast paragraph\n'
    const document = parseMarkdown(text)
    change(document)
    expect(() => validate(text, document)).toThrow()
  })

  it('streams a long heading without materializing its text and charges all concurrent scratch', () => {
    const text = `# ${'word '.repeat(20000)}\n`
    const context = fixture(text)
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    let peak = 0
    try {
      const work = context.work()
      let steps = 0
      while (!work.next().done) {
        peak = Math.max(peak, context.owner.stats.readerStagingBytes)
        expect(context.owner.stats.readerStagingBytes).toBeLessThanOrEqual(validation.staging)
        steps++
      }
      expect(steps).toBeGreaterThan(100)
      expect(peak).toBeGreaterThan(512 * 1024)
      for (const result of scalar.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(4096)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      scalar.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['return', 'release', 'dispose'] as const)(
    'closes metadata, root, heading and text scopes on %s',
    (action) => {
      const context = fixture(`# ${'word '.repeat(20000)}\n`)
      const before = context.owner.stats.retainedBytes
      const work = context.work()
      let steps = 0
      while (context.owner.stats.readerStagingBytes < 512 * 1024)
        if (work.next().done || ++steps > 1000) throw new Error('No open comparison')
      if (action === 'return') work.return()
      else if (action === 'release') context.capture.release()
      else context.owner.dispose()
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      if (action === 'return') expect(context.owner.stats.retainedBytes).toBe(before)
      else expect(work.next().done).toBe(true)
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it('rejects a locally insufficient simultaneous stream budget and releases earlier scopes', () => {
    const context = fixture('# Heading\n')
    const before = context.owner.stats
    try {
      expect(() => finishPackedSteps(context.work({ retained: 400000 }))).toThrow('workspace')
      expect(context.owner.stats).toEqual(before)
      expect(() => finishPackedSteps(context.work({ staging: 400000 }))).toThrow('workspace')
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['unstarted', 'source-index'] as const)(
    'capture release closes an escaped %s validator without advancing it',
    (phase) => {
      const context = fixture(`# ${'x'.repeat(100000)}\n`)
      const work = context.work()
      expect(context.owner.stats.readers).toBe(1)
      if (phase === 'source-index') expect(work.next().done).toBe(false)
      context.capture.release()
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(work.next().done).toBe(true)
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
})
