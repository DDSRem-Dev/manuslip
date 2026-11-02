import type { Heading, Nodes, Paragraph, Text } from 'mdast'
import { expect, it, vi } from 'vitest'
import { semanticLimits } from '../../src/contracts'
import {
  type MarkdownDescriptionState,
  markdownDescriptionSteps,
} from '../../src/markdown-description-steps'
import { parseMarkdown } from '../../src/parse'
import { describeBlock, describeHeading } from '../../src/semantic-description'

function state(): MarkdownDescriptionState {
  return { blocks: [], outline: [], text: [], nodes: 1 }
}

function finish(work: ReturnType<typeof markdownDescriptionSteps>) {
  while (true) {
    const next = work.next()
    if (next.done) {
      expect(next.value).toBe(true)
      return
    }
  }
}

function paragraph(from: number, to: number): Paragraph {
  return {
    type: 'paragraph',
    children: [],
    position: {
      start: { line: 2, column: 1, offset: from },
      end: { line: 4, column: 1, offset: to },
    },
  }
}

for (const syntax of ['commonmark', 'manuslip'] as const)
  it.each([
    'one\r\n\r\ntwo 😀 中文 العربية.\r\n',
    '# **Strong** `code` ![alt](/image) [link][r] $math$\n\n[r]: /target\n',
    `# ${'*word* **bold** `code` ![alt](/image) '.repeat(600)}\n`,
    '> - [x] first\n>   - nested *text*\n>\n>   continuation\n\n> later\n',
    '---\nname: title\n---\n\n# Heading\n\n$$\nx^2\n$$\n\n```ts\nlet x = 1\n```\n',
    '| a | b |\n| :- | -: |\n| ~~x~~ | www.example.com |\n\ncall[^note]\n\n[^note]: note\n',
    '<div>\nhtml\n</div>\n\n![reference][r]\n\n[r]: /target "title"\n',
  ])(`preserves complete metadata in ${syntax} for %s`, (source) => {
    const document = parseMarkdown(source, syntax)
    const target = state()
    for (const child of document.root.children)
      finish(markdownDescriptionSteps(child, source, false, target))
    expect(target.blocks).toEqual(document.blocks)
    expect(target.outline).toEqual(document.outline)
    const ordinaryText: string[] = []
    let nodes = 1
    function visit(node: Nodes) {
      nodes++
      if (node.type === 'text') ordinaryText.push(node.value)
      if ('children' in node) for (const child of node.children) visit(child)
    }
    for (const child of document.root.children) visit(child)
    expect(target.nodes).toBe(nodes)
    expect(target.text).toEqual(ordinaryText)
  })

it.each([
  [0, 12],
  [-7, -1],
  [-100, 100],
  [8, 2],
  [3.9, 9.2],
  [-8.9, -1.2],
  [Number.NaN, 9],
  [2, Number.NaN],
  [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [-0, 0],
])('matches ordinary slice/hash semantics for range %s..%s', (from, to) => {
  const source = 'a😀\ud800x\udfff界\r\nend'
  const node = paragraph(from, to)
  const target = state()
  finish(markdownDescriptionSteps(node, source, false, target))
  expect(target.blocks).toEqual([describeBlock(node, source)])
})

it.each([4095, 4096, 4097, 8192, 8193])(
  'bounds range hashing and keeps UTF-16 hashes for %i units',
  (length) => {
    const source = `${'x'.repeat(length - 5)}😀\ud800x\udfff`
    const node = paragraph(0, source.length)
    const expected = describeBlock(node, source)
    const target = state()
    const work = markdownDescriptionSteps(node, source, false, target)
    const original = String.prototype.charCodeAt
    const indices: number[] = []
    const reads = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
      this: string,
      index: number,
    ) {
      if (this === source) indices.push(index)
      return original.call(this, index)
    })
    let pauses = 0
    try {
      while (true) {
        const before = indices.length
        const next = work.next()
        expect(indices.length - before).toBeLessThanOrEqual(4096)
        if (next.done) {
          expect(next.value).toBe(true)
          break
        }
        expect(indices.length - before).toBe(4096)
        pauses++
      }
      expect(indices).toEqual(Array.from({ length }, (_, index) => index))
      expect(pauses).toBe(Math.floor(length / 4096))
      expect(target.blocks).toEqual([expected])
    } finally {
      work.return()
      reads.mockRestore()
    }
  },
)

it('shares the hash budget across smaller nested ranges without slicing the source', () => {
  const source = 'x'.repeat(5000)
  const children = Array.from({ length: 8 }, () => paragraph(0, 4000))
  const root: Nodes = { type: 'blockquote', children }
  const expected = children.map((node) => describeBlock(node, source))
  const target = state()
  const work = markdownDescriptionSteps(root, source, false, target)
  const originalRead = String.prototype.charCodeAt
  const originalSlice = String.prototype.slice
  let reads = 0
  let slices = 0
  const read = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === source) reads++
    return originalRead.call(this, index)
  })
  const slice = vi.spyOn(String.prototype, 'slice').mockImplementation(function (
    this: string,
    from?: number,
    to?: number,
  ) {
    if (this === source) slices++
    return originalSlice.call(this, from, to)
  })
  try {
    while (true) {
      const before = reads
      const next = work.next()
      expect(reads - before).toBeLessThanOrEqual(4096)
      if (next.done) break
    }
    expect(reads).toBe(32000)
    expect(slices).toBe(0)
    expect(target.blocks).toEqual(expected)
  } finally {
    work.return()
    read.mockRestore()
    slice.mockRestore()
  }
})

it('bounds child-array access in both heading text and metadata traversal', () => {
  let accesses = 0
  const children: Text[] = []
  for (let index = 0; index < 2048; index++)
    Object.defineProperty(children, index, {
      get() {
        accesses++
        return { type: 'text', value: String(index) }
      },
    })
  const node: Heading = { ...paragraph(0, 4), type: 'heading', depth: 2, children }
  const source = 'head'
  const expected = describeHeading(node)
  accesses = 0
  const target = state()
  const work = markdownDescriptionSteps(node, source, false, target)
  let pauses = 0
  try {
    while (true) {
      const before = accesses
      const next = work.next()
      expect(accesses - before).toBeLessThanOrEqual(256)
      if (next.done) break
      pauses++
    }
    expect(pauses).toBeGreaterThan(0)
    expect(accesses).toBe(4096)
    expect(target.outline).toEqual([expected])
    expect(target.text).toEqual(Array.from({ length: 2048 }, (_, index) => String(index)))
  } finally {
    work.return()
  }
})

it('traverses deep heading formatting without recursion or lost leaf text', () => {
  let child: Heading['children'][number] = { type: 'text', value: 'deep' }
  for (let index = 0; index < 6000; index++) child = { type: 'strong', children: [child] }
  const node: Heading = { ...paragraph(0, 4), type: 'heading', depth: 1, children: [child] }
  const target = state()
  finish(markdownDescriptionSteps(node, 'deep', false, target))
  expect(target.outline).toEqual([{ from: 0, to: 4, depth: 1, text: 'deep' }])
  expect(target.text).toEqual(['deep'])
  expect(target.nodes).toBe(6003)
})

it.each(['before', 'hashing', 'heading', 'throw'] as const)(
  'revokes metadata work cancelled during %s',
  (phase) => {
    const source = 'x'.repeat(8193)
    let accesses = 0
    const children: Text[] = []
    for (let index = 0; index < 2048; index++)
      Object.defineProperty(children, index, {
        get() {
          accesses++
          return { type: 'text', value: 'x' }
        },
      })
    const node: Nodes =
      phase === 'heading'
        ? { ...paragraph(0, 1), type: 'heading', depth: 1, children }
        : paragraph(0, source.length)
    const target = state()
    const work = markdownDescriptionSteps(node, source, false, target)
    if (phase !== 'before') expect(work.next()).toEqual({ done: false, value: undefined })
    const visited = accesses
    if (phase === 'heading') expect(visited).toBeGreaterThan(0)
    if (phase === 'throw') {
      const failure = new Error('cancel metadata')
      expect(() => work.throw(failure)).toThrow(failure)
    } else work.return()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(accesses).toBe(visited)
    expect(target.outline).toEqual([])
    expect(target.blocks).toHaveLength(phase === 'heading' ? 1 : 0)
  },
)

it('closes metadata work after a range read fails between batches', () => {
  const source = 'x'.repeat(8193)
  const work = markdownDescriptionSteps(paragraph(0, source.length), source, false, state())
  const original = String.prototype.charCodeAt
  const failure = new Error('range read failed')
  let reads = 0
  const observed = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this === source && ++reads === 4097) throw failure
    return original.call(this, index)
  })
  try {
    expect(work.next()).toEqual({ done: false, value: undefined })
    expect(() => work.next()).toThrow(failure)
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(reads).toBe(4097)
  } finally {
    work.return()
    observed.mockRestore()
  }
})

it('preserves both cumulative limits and the existing list-item defaults', () => {
  const target = state()
  target.nodes = semanticLimits.blocks * 16
  const nodes = markdownDescriptionSteps(paragraph(0, 1), 'x', false, target)
  expect(() => nodes.next()).toThrow('syntax exceeds semantic limits')
  expect(nodes.next()).toEqual({ done: true, value: undefined })
  target.nodes = 1
  target.blocks = Array.from({ length: semanticLimits.blocks }, () => ({
    kind: 'paragraph',
    from: 0,
    to: 1,
    hash: '',
    lines: 1,
  }))
  const blocks = markdownDescriptionSteps(paragraph(0, 1), 'x', false, target)
  expect(() => blocks.next()).toThrow('block limit')
  expect(blocks.next()).toEqual({ done: true, value: undefined })
  const item: Nodes = { type: 'listItem', checked: true, children: [] }
  finish(markdownDescriptionSteps(item, '', true, state()))
  expect(item.checked).toBeNull()
  item.checked = true
  finish(markdownDescriptionSteps(item, '', false, state()))
  expect(item.checked).toBe(true)
})
