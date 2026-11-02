import type { Nodes as MarkdownNode } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { parserVersion, sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedItemSteps, PackedReadScope } from '../../src/packing-capture'
import { PackedReceiver } from '../../src/packing-receiver'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { PackedSourcePoints } from '../../src/packing-source-points'
import { newPackedToken } from '../../src/packing-token'
import { type PackedRootObserver, validatePackedRoot } from '../../src/packing-validate-root'
import { packedWireVersion } from '../../src/packing-wire'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: MiB, staging: MiB, nodes: 800000, depth: 128 }
// Deliberately permissive fields for corruption fixtures; production uses packed scopes.
interface MutableNode {
  [key: string]: unknown
  children: MutableNode[]
  position: {
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
  }
  data: {
    hName: string
    hProperties: { className: string[] }
    hChildren: { [key: string]: unknown; value: string }[]
  }
}
function child(node: MutableNode, index = 0): MutableNode {
  const selected = node.children[index]
  if (!selected) throw new Error('Missing fixture child')
  return selected
}
const mutableRoot = (text: string) =>
  structuredClone(parseMarkdown(text).root) as unknown as MutableNode
const source = (text: string, syntax = 'manuslip') =>
  new PackedSource(
    {
      generation: 1,
      documentId: 'root-schema',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: `${parserVersion}/${syntax}`,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
function fixture(text: string, root: unknown = parseMarkdown(text).root, checked = source(text)) {
  const owner = new PackedSession(limits)
  const ticket = owner.beginPrepared(checked)
  owner.commit(
    owner.prepareFull(ticket, checked.identity, packValue({ document: { root } }, limits.bytes)),
  )
  return { owner, capture: owner.capture(), checked }
}
function validate(text: string, root: unknown = parseMarkdown(text).root, checked = source(text)) {
  const context = fixture(text, root, checked)
  try {
    finishPackedSteps(
      validatePackedRoot(context.capture, checked, ['document', 'root'], validation),
    )
  } finally {
    context.owner.dispose()
  }
  expect(context.owner.stats.retainedBytes).toBe(0)
}

describe('exact source point checkpoints and newline masks', () => {
  it('matches an independent line-ending oracle at every offset, including CRLF checkpoint boundaries', () => {
    const text = `${'x'.repeat(255)}\r\n\t😀\ud800\udfff\r${'y'.repeat(3833)}\r\n\n${'界\t\r\n'.repeat(400)}`
    const checked = source(text)
    const points = finishPackedSteps(PackedSourcePoints.build(checked))
    const ends = [...text.matchAll(/\r\n|\r|\n/g)].map((match) => match.index + match[0].length)
    for (let offset = 0; offset <= text.length; offset++) {
      const lines = ends.filter((end) => end <= offset)
      expect(points.point(offset)).toEqual({
        line: lines.length + 1,
        column: offset - (lines.at(-1) ?? 0) + 1,
      })
    }
    expect(PackedSourcePoints.bytes(checked)).toBeLessThan(1024 + (text.length * 3) / 16)
    for (const offset of [-1, 0.5, NaN, Infinity, text.length + 1])
      expect(() => points.point(offset)).toThrow('offset')
  })
  it('bounds index memory even when every source unit is a line ending and yields during construction', () => {
    const checked = source('\n'.repeat(MiB))
    const work = PackedSourcePoints.build(checked)
    let steps = 0
    while (!work.next().done) steps++
    expect(steps).toBe(512)
    expect(PackedSourcePoints.bytes(checked)).toBe(197168)
  })
  it('counts dense newline masks through sign bits and checkpoint boundaries', () => {
    const text = `${'\n'.repeat(768)}${'\r\n'.repeat(384)}`
    const points = finishPackedSteps(PackedSourcePoints.build(source(text)))
    for (let offset = 0; offset <= text.length; offset++) {
      const line = 1 + Math.min(offset, 768) + Math.floor(Math.max(0, offset - 768) / 2)
      const start = offset <= 768 ? offset : 768 + Math.floor((offset - 768) / 2) * 2
      expect(points.point(offset)).toEqual({ line, column: offset - start + 1 })
    }
  })
  it('retains exact coordinates when lookups revisit words and jump between checkpoints', () => {
    const text = `\ufeff${'a\r\n\n\r界😀\t'.repeat(200)}\r\n`
    const points = finishPackedSteps(PackedSourcePoints.build(source(text)))
    const normalized = text.slice(1)
    const ends = [...normalized.matchAll(/\r\n|\r|\n/g)].map(
      (match) => match.index + match[0].length,
    )
    const offsets = [0, 31, 32, 63, 64, 255, 256, 257, normalized.length]
    let random = 13
    for (let index = 0; index < 1000; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      offsets.push(random % (normalized.length + 1))
    }
    for (const offset of [...offsets, ...offsets.toReversed(), 224, 240, 225, 239, 224]) {
      const lines = ends.filter((end) => end <= offset)
      expect(points.point(offset)).toEqual({
        line: lines.length + 1,
        column: offset - (lines.at(-1) ?? 0) + 1,
      })
    }
    for (const offset of [-1, NaN, normalized.length + 1])
      expect(() => points.point(offset)).toThrow('offset')
    expect(points.point(239)).toEqual({
      line: ends.filter((end) => end <= 239).length + 1,
      column: 239 - (ends.filter((end) => end <= 239).at(-1) ?? 0) + 1,
    })
  })
  it('indexes parser coordinates after one leading BOM without making a source copy', () => {
    const text = `\ufeff${'x'.repeat(255)}\r\n\ufeff😀\r\n`
    const points = finishPackedSteps(PackedSourcePoints.build(source(text)))
    const normalized = text.slice(1)
    const ends = [...normalized.matchAll(/\r\n|\r|\n/g)].map(
      (match) => match.index + match[0].length,
    )
    expect(points.length).toBe(normalized.length)
    for (let offset = 0; offset <= normalized.length; offset++) {
      const lines = ends.filter((end) => end <= offset)
      expect(points.point(offset)).toEqual({
        line: lines.length + 1,
        column: offset - (lines.at(-1) ?? 0) + 1,
      })
    }
    expect(() => points.point(text.length)).toThrow('offset')
  })
})

describe('source-bound packed mdast schema validation', () => {
  it.each([false, true])(
    'preserves observer, node and parent-completion checkpoints with suspended=%s',
    (suspended) => {
      const context = fixture('> **Hello**\n')
      const before = context.owner.stats
      const phases: string[] = []
      const complete: PackedRootObserver = (_node, type) => {
        phases.push(`done:${type}`)
      }
      const work = validatePackedRoot(
        context.capture,
        context.checked,
        ['document', 'root'],
        validation,
        suspended
          ? function* (...args: Parameters<PackedRootObserver>) {
              phases.push(`enter:${args[1]}`)
              yield
              complete(...args)
            }
          : complete,
      )
      try {
        const checkpoints: string[][] = []
        while (!work.next().done) checkpoints.push([...phases])
        const expected: string[][] = []
        const seen: string[] = []
        for (const type of ['root', 'blockquote', 'paragraph', 'strong', 'text']) {
          if (suspended) {
            seen.push(`enter:${type}`)
            expected.push([...seen])
          }
          seen.push(`done:${type}`)
          expected.push([...seen])
        }
        // Each parent yields its segment completion, then closes its iterator separately.
        for (let parent = 0; parent < 4; parent++) {
          expected.push([...seen])
          expected.push([...seen])
        }
        expect(checkpoints).toEqual(expected)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each([
    { nodes: 7, depth: 5, accepted: true },
    { nodes: 6, depth: 5, accepted: false },
    { nodes: 7, depth: 4, accepted: false },
  ])(
    'retains complete reused-subtree logical costs and the next sibling at nodes=$nodes/depth=$depth',
    ({ nodes, depth, accepted }) => {
      const context = fixture('> **Hello**\n\nTail\n')
      const before = context.owner.stats
      const observed: string[] = []
      const work = validatePackedRoot(
        context.capture,
        context.checked,
        ['document', 'root'],
        { ...validation, nodes, depth },
        (_node, type) => {
          observed.push(type)
        },
        function* (_node, position) {
          yield
          // Trusted reuse of the fixture's complete, known four-node quote subtree.
          if (position.start.offset === 0) return { nodes: 4, depth: 4 }
          return undefined
        },
      )
      try {
        if (accepted) {
          finishPackedSteps(work)
          expect(observed).toEqual(['root', 'paragraph', 'text'])
        } else expect(() => finishPackedSteps(work)).toThrow(/node limit|depth limit/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each([
    { mode: 'records', synchronous: false },
    { mode: 'generic', synchronous: false },
    { mode: 'records', synchronous: true },
    { mode: 'generic', synchronous: true },
  ])(
    'preserves the complete native observer sequence with $mode reads and synchronous=$synchronous',
    ({ mode, synchronous }) => {
      const text =
        '\ufeff---\r\ntitle: World\r\n---\r\n\r\n> A **bold**, *emphasis*, ~~deleted~~ and `code`.\r\n>\r\n> www.example.com\r\n\r\n| A | B |\r\n| - | - |\r\n| one | two |\r\n'
      const document = parseMarkdown(text)
      const context = fixture(text, document.root)
      const record =
        mode === 'generic'
          ? vi.spyOn(PackedReadScope.prototype, 'encodedRecord').mockReturnValue(undefined)
          : undefined
      const expected: unknown[] = []
      function native(node: MarkdownNode) {
        expected.push({ type: node.type, position: node.position })
        if ('children' in node) for (const value of node.children) native(value)
      }
      native(document.root)
      const observed: unknown[] = []
      const observe: PackedRootObserver = (_scope, type, position) => {
        observed.push({ type, position })
        if (position) {
          expect(Object.isFrozen(position)).toBe(true)
          expect(Object.isFrozen(position.start)).toBe(true)
          expect(Object.isFrozen(position.end)).toBe(true)
        }
      }
      const before = context.owner.stats
      try {
        finishPackedSteps(
          validatePackedRoot(
            context.capture,
            context.checked,
            ['document', 'root'],
            validation,
            synchronous
              ? observe
              : function* (...args: Parameters<PackedRootObserver>) {
                  observe(...args)
                  yield
                },
          ),
        )
        expect(observed).toEqual(expected)
        expect(context.owner.stats).toEqual(before)
      } finally {
        record?.mockRestore()
        context.owner.dispose()
      }
    },
  )

  it.each([new Error('synchronous observer failed'), undefined])(
    'preserves a synchronous observer failure and releases its active scopes: %j',
    (original) => {
      const context = fixture('> > paragraph\n')
      const before = context.owner.stats
      let selected: PackedReadScope | undefined
      const work = validatePackedRoot(
        context.capture,
        context.checked,
        ['document', 'root'],
        validation,
        (node, type) => {
          if (type === 'text') {
            selected = node
            throw original
          }
        },
      )
      try {
        let failed = false
        try {
          finishPackedSteps(work)
        } catch (error) {
          failed = true
          expect(error).toBe(original)
        }
        expect(failed).toBe(true)
        expect(selected).toBeDefined()
        expect(() => selected?.kind()).toThrow('expired')
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )

  it('preserves arbitrary valid own-key order through the generic schema path', () => {
    const text = '> **Writing** and `code`.\n'
    const original = mutableRoot(text)
    const reorder = (node: MutableNode): MutableNode => {
      if (Array.isArray(node.children)) node.children = node.children.map(reorder)
      return Object.fromEntries(Object.entries(node).reverse()) as MutableNode
    }
    validate(text, reorder(original))
  })

  it.each(
    (['start', 'end'] as const).flatMap((point) =>
      (['line', 'column', 'offset'] as const).map((coordinate) => ({ point, coordinate })),
    ),
  )('rejects corruption of a common leaf $point.$coordinate', ({ point, coordinate }) => {
    const text = 'first paragraph\n\nsecond paragraph\n'
    const root = mutableRoot(text)
    child(child(root)).position[point][coordinate]++
    expect(() => validate(text, root)).toThrow()
  })

  it.each(['null', 'array', 'object', 'oversize'] as const)(
    'rejects a common leaf with a %s string payload',
    (change) => {
      const text = 'paragraph\n'
      const root = mutableRoot(text)
      child(child(root)).value =
        change === 'null'
          ? null
          : change === 'array'
            ? []
            : change === 'object'
              ? {}
              : 'x'.repeat(text.length + 1)
      expect(() => validate(text, root)).toThrow()
    },
  )

  it.each([null, 'children', {}])('rejects a common parent with non-array children %j', (value) => {
    const text = 'paragraph\n'
    const root = mutableRoot(text)
    ;(child(root) as Record<string, unknown>).children = value
    expect(() => validate(text, root)).toThrow()
  })

  it.each(['commonmark', 'manuslip'] as const)(
    'accepts every pinned CommonMark example under %s',
    (syntax) => {
      for (const example of examples)
        validate(
          example.markdown,
          parseMarkdown(example.markdown, syntax).root,
          source(example.markdown, syntax),
        )
    },
  )
  it.each([
    '',
    '\ufeff',
    '\ufeff# 😀\r\n\r\n\tcode\r\n',
    '# 😀\r\n\r\nquote \ud800\udfff\r\n',
    '---\ntitle: World\n---\n\n# One\n',
    '+++\ntitle = "World"\n+++\n\nText\n',
    'Term *界* :smile:\r\n: First **description**.\r\n\r\n    | A | B |\r\n    | - | - |\r\n    | : one | ^2^ |\r\n\r\nNext\r\n: Last [link][r].\r\n\r\n[r]: /target\r\n',
    'H~2~O x^**2**^ ~a^b^:smile:~ :+1:\r\n\r\n| A | B |\r\n| - | - |\r\n| ^界^ | :heart: |\r\n',
    '| A | B |\n| :- | -: |\n| **one** | ~~two~~ |\n| short |\n| too | many | cells |\n',
    '- [x] task\n- [ ] two\n\nFoot[^foo].\n\n[^foo]: def\n\n[ref]: https://example.invalid/ "Title"\n\n![text][ref]\n',
    '$x$\n\n$$ info\nx^2\n$$\n\n```js meta\ncode\n```\n',
    'a@b.co',
    'www.a.co',
    '<foo+@bar.example.com>\n',
    '[foo]: /url\nbar\n===\n\n[foo]\n',
    `${'\t\n'.repeat(300)}<https://example.invalid/> &amp; \\*raw\\*\n`,
  ])('accepts exact extension, whitespace and UTF-16 output: %j', (text) => validate(text))

  it('checks large math data through bounded streams without whole-string scalar reads', () => {
    const text = `$${'x'.repeat(100000)}$\n`
    const context = fixture(text)
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    const work = validatePackedRoot(
      context.capture,
      context.checked,
      ['document', 'root'],
      validation,
    )
    try {
      let steps = 0
      while (!work.next().done) {
        expect(context.owner.stats.retainedBytes).toBeLessThanOrEqual(limits.retained)
        steps++
      }
      expect(steps).toBeGreaterThan(100)
      for (const result of scalar.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(4096)
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
    } finally {
      scalar.mockRestore()
      context.owner.dispose()
    }
  })

  const mutations: { name: string; change: (root: MutableNode) => void }[] = [
    {
      name: 'unknown node',
      change: (root) => {
        child(root).type = 'unknown'
      },
    },
    {
      name: 'unknown property',
      change: (root) => {
        child(root).extra = true
      },
    },
    {
      name: 'bad root',
      change: (root) => {
        root.type = 'paragraph'
      },
    },
    {
      name: 'wrong parent category',
      change: (root) => {
        child(child(root)).type = 'thematicBreak'
        delete child(child(root)).value
      },
    },
    {
      name: 'missing children',
      change: (root) => {
        Reflect.deleteProperty(child(root), 'children')
      },
    },
    {
      name: 'missing position',
      change: (root) => {
        Reflect.deleteProperty(child(root), 'position')
      },
    },
    {
      name: 'missing value',
      change: (root) => {
        delete child(child(root)).value
      },
    },
    {
      name: 'wrong value',
      change: (root) => {
        child(child(root)).value = 7
      },
    },
    {
      name: 'wrong line',
      change: (root) => {
        child(root).position.start.line++
      },
    },
    {
      name: 'wrong column',
      change: (root) => {
        child(root).position.end.column++
      },
    },
    {
      name: 'out of source',
      change: (root) => {
        child(root).position.end.offset = 99999
      },
    },
    {
      name: 'reversed position',
      change: (root) => {
        ;[child(root).position.start, child(root).position.end] = [
          child(root).position.end,
          child(root).position.start,
        ]
      },
    },
    {
      name: 'wrong root range',
      change: (root) => {
        root.position.end = child(root).position.end
      },
    },
    {
      name: 'outside parent',
      change: (root) => {
        child(child(root)).position.end = root.position.end
      },
    },
    {
      name: 'out of order',
      change: (root) => {
        root.children.reverse()
      },
    },
    {
      name: 'unsafe extension data',
      change: (root) => {
        Reflect.set(child(root), 'data', { hName: 'script' })
      },
    },
  ]
  it.each(mutations)('rejects malformed $name', ({ change }) => {
    const text = 'first paragraph\n\nsecond paragraph\n'
    const root = mutableRoot(text)
    change(root)
    expect(() => validate(text, root)).toThrow()
  })

  it.each([
    ['# Heading\n', 'depth', 7],
    ['1. one\n', 'ordered', 'yes'],
    ['1. one\n', 'start', null],
    ['- one\n', 'start', 1],
    ['- one\n', 'spread', 'false'],
    ['```js\ncode\n```\n', 'lang', 42],
    ['[label][ref]\n\n[ref]: url\n', 'referenceType', 'unsafe'],
  ] as const)('rejects malformed known node field %s %s', (text, field, value) => {
    const root = mutableRoot(text)
    const node = field === 'referenceType' ? child(root)?.children[0] : child(root)
    if (!node) throw new Error('Fixture')
    node[field] = value
    expect(() => validate(text, root)).toThrow()
  })

  it.each(['name', 'class', 'text', 'children', 'property'] as const)(
    'rejects altered math extension %s',
    (field) => {
      const text = '$x$\n'
      const root = mutableRoot(text)
      const math = child(child(root))
      const content = math.data.hChildren[0]
      if (!content) throw new Error('Missing fixture math content')
      if (field === 'name') math.data.hName = 'script'
      else if (field === 'class') math.data.hProperties.className[0] = 'unsafe'
      else if (field === 'text') content.value = 'y'
      else if (field === 'children') math.data.hChildren.push(content)
      else content.extra = true
      expect(() => validate(text, root)).toThrow()
    },
  )

  it.each(['return', 'release', 'dispose'] as const)(
    'releases validator workspace/readers during %s',
    (action) => {
      const context = fixture(`$${'x'.repeat(100000)}$\n`)
      const before = context.owner.stats.retainedBytes
      const work = validatePackedRoot(
        context.capture,
        context.checked,
        ['document', 'root'],
        validation,
      )
      let steps = 0
      while (context.owner.stats.readerStagingBytes < 512 * 1024) {
        if (work.next().done || ++steps > 1000) throw new Error('No open streams')
      }
      if (action === 'return') work.return()
      else if (action === 'release') context.capture.release()
      else context.owner.dispose()
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      if (action === 'return') expect(context.owner.stats.retainedBytes).toBe(before)
      if (action !== 'return') expect(work.next().done).toBe(true)
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )

  it.each([
    {
      label: 'cancellation with an error',
      resume: false,
      cleanupFailure: new Error('first iterator cleanup failed'),
      validationFailure: undefined,
    },
    {
      label: 'cancellation with undefined',
      resume: false,
      cleanupFailure: undefined,
      validationFailure: undefined,
    },
    {
      label: 'observer failure before undefined cleanup',
      resume: true,
      cleanupFailure: undefined,
      validationFailure: new Error('root observer failed'),
    },
    {
      label: 'undefined observer failure before cleanup error',
      resume: true,
      cleanupFailure: new Error('first iterator cleanup failed'),
      validationFailure: undefined,
    },
  ])(
    'closes every root frame and workspace during $label',
    ({ resume, cleanupFailure, validationFailure }) => {
      const context = fixture('> > paragraph\n')
      const before = context.owner.stats
      let selected: PackedReadScope | undefined
      const work = validatePackedRoot(
        context.capture,
        context.checked,
        ['document', 'root'],
        validation,
        function* (scope, _type, _position, _budget, depth) {
          if (depth === 4) {
            selected = scope
            yield
            if (resume) throw validationFailure
          }
        },
      )
      const original = PackedItemSteps.prototype.return
      const closed = new Set<PackedItemSteps>()
      let cleanup: { mockRestore(): void } | undefined
      try {
        while (!selected) expect(work.next().done).toBe(false)
        cleanup = vi.spyOn(PackedItemSteps.prototype, 'return').mockImplementation(function (
          this: PackedItemSteps,
        ) {
          expect(closed.has(this)).toBe(false)
          closed.add(this)
          const result = original.call(this)
          if (closed.size === 1) throw cleanupFailure
          if (closed.size === 2) throw new Error('later iterator cleanup failed')
          return result
        })
        let threw = false
        let caught: unknown
        try {
          if (resume) work.next()
          else work.return()
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(resume ? validationFailure : cleanupFailure)
        expect(context.owner.stats).toEqual(before)
        expect(closed.size).toBe(3)
        expect(() => selected?.kind()).toThrow('expired')
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(work.return()).toEqual({ done: true, value: undefined })
        expect(closed.size).toBe(3)
      } finally {
        cleanup?.mockRestore()
        work.return()
        context.owner.dispose()
      }
    },
  )

  it('preflights workspace and rejects wrong source identity, node/depth and scratch limits', () => {
    const text = '> > > nested\n'
    const context = fixture(text)
    const before = context.owner.stats
    try {
      for (const changed of [
        { retained: 0 },
        { staging: 0 },
        { nodes: 1 },
        { depth: 2 },
        { depth: 129 },
        { nodes: 800001 },
        { retained: NaN },
      ])
        expect(() =>
          finishPackedSteps(
            validatePackedRoot(context.capture, context.checked, ['document', 'root'], {
              ...validation,
              ...changed,
            }),
          ),
        ).toThrow()
      expect(() =>
        finishPackedSteps(
          validatePackedRoot(context.capture, source(text), ['document', 'root'], validation),
        ),
      ).toThrow('semantic')
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('copies paths and limits before suspending and admits simultaneous math stream costs', () => {
    const context = fixture(`$${'x'.repeat(100000)}$\n`)
    const path = ['document', 'root']
    const mutable = { ...validation }
    try {
      const work = validatePackedRoot(context.capture, context.checked, path, mutable)
      expect(work.next().done).toBe(false)
      path[0] = 'missing'
      mutable.nodes = 0
      mutable.retained = 0
      finishPackedSteps(work)
      const before = context.owner.stats
      for (const changed of [{ retained: 400000 }, { staging: 400000 }]) {
        expect(() =>
          finishPackedSteps(
            validatePackedRoot(context.capture, context.checked, ['document', 'root'], {
              ...validation,
              ...changed,
            }),
          ),
        ).toThrow('workspace')
        expect(context.owner.stats).toEqual(before)
      }
    } finally {
      context.owner.dispose()
    }
  })
  it('defers reentrant capture revocation until the current validator advance unwinds', () => {
    const context = fixture('paragraph\n')
    let called = false
    const work = validatePackedRoot(
      context.capture,
      context.checked,
      ['document', 'root'],
      validation,
      function* () {
        called = true
        context.capture.release()
        yield
      },
    )
    try {
      expect(work.next().done).toBe(true)
      expect(called).toBe(true)
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(work.next().done).toBe(true)
    } finally {
      context.owner.dispose()
    }
  })

  it('keeps a receiver result unpublished until the root validator finishes and rejects late corruption', () => {
    for (const malformed of [false, true]) {
      const text = 'one\n\ntwo\n\nthree\n'
      const checked = source(text)
      const root = mutableRoot(text)
      if (malformed) child(root, root.children.length - 1).position.end.column++
      const receiver = new PackedReceiver(limits, function* (capture, source) {
        yield* validatePackedRoot(capture, source, ['document', 'root'], validation)
      })
      try {
        const ticket = receiver.begin(1, checked)
        const work = receiver.receiveSteps(ticket, {
          protocol: packedWireVersion,
          kind: 'full',
          sequence: 1,
          result: checked.identity,
          requestToken: ticket.requestToken,
          resultToken: newPackedToken(),
          sentAt: 0,
          payload: packValue({ document: { root } }, limits.bytes),
          metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
        })
        let accepted = false
        let steps = 0
        const run = () => {
          while (true) {
            const step = work.next()
            if (step.done) {
              if (step.value?.kind !== 'accepted') throw new Error('Missing acceptance')
              accepted = true
              step.value.capture.release()
              return
            }
            expect(receiver.stats.current).toBeNull()
            if (++steps > 1000) throw new Error('Incomplete validation')
          }
        }
        if (malformed) expect(run).toThrow('semantic')
        else run()
        expect(accepted).toBe(!malformed)
        expect(steps).toBeGreaterThan(5)
        expect(receiver.stats.readers).toBe(0)
      } finally {
        receiver.dispose()
      }
      expect(receiver.stats.retainedBytes).toBe(0)
    }
  })
})
