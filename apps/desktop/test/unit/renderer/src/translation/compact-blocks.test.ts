import { parseMarkdown, semanticLimits, sourceHash } from '@manuslip/core'
import { readingBlocks } from '@manuslip/renderer/reading'
import { expect, it } from 'vitest'
import examples from '../../../../../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json'
import { CompactReadingBlocks } from '../../../../../src/renderer/src/translation/compact-blocks'

const store = (blocks: ReturnType<typeof readingBlocks>) =>
  new CompactReadingBlocks(blocks, CompactReadingBlocks.reservation(blocks.length))

it('preserves every field of every pinned CommonMark block with no input-record aliases', () => {
  for (const example of examples) {
    const blocks = readingBlocks(
      parseMarkdown(example.markdown, 'commonmark').root,
      example.markdown,
    )
    const compact = store(blocks)
    const restored = compact.snapshot()
    expect(restored, `CommonMark ${example.example}`).toEqual(blocks)
    expect(compact.count).toBe(blocks.length)
    for (let index = 0; index < restored.length; index++)
      expect(restored[index]).not.toBe(blocks[index])
  }
})

it('preserves extension blocks, footnotes, UTF-16/CRLF ranges, leading UUID zeroes and hash words', () => {
  const source =
    '---\r\ntitle: Test\r\n---\r\n\r\n# 世界😀\r\n\r\n| a | b |\r\n| - | - |\r\n| c | d |\r\n\r\n$x$ and note[^n].\r\n\r\n[^n]: Hello.\r\n\r\n```mermaid\r\ngraph LR; A-->B\r\n```'
  const blocks = readingBlocks(parseMarkdown(source).root, source)
  blocks.push({
    id: '00000001-0000-0000-0000-00000000000f',
    kind: 'paragraph',
    from: 0,
    to: 0xfffffffe,
    hash: '0:0:ffffffff',
  })
  expect(store(blocks).snapshot()).toEqual(blocks)
  expect(blocks.some((block) => block.hash === 'footnotes')).toBe(true)
})

it('keeps an immutable independent snapshot after public records and prior snapshots change', () => {
  const source = '# Hello\n\nWorld 😀.',
    blocks = readingBlocks(parseMarkdown(source).root, source),
    original = structuredClone(blocks),
    compact = store(blocks)
  if (blocks[0]) blocks[0].id = 'changed'
  blocks.length = 0
  const first = compact.snapshot()
  if (first[0]) first[0].hash = 'changed'
  first.reverse()
  expect(compact.snapshot()).toEqual(original)
  expect(Object.isFrozen(compact)).toBe(true)
})

it('admits the complete typed store before allocation and enforces block and kind-table bounds', () => {
  const blocks = readingBlocks(parseMarkdown('Hello').root, 'Hello'),
    required = CompactReadingBlocks.reservation(blocks.length)
  expect(() => new CompactReadingBlocks(blocks, required - 1)).toThrow('translation-view-limit')
  expect(new CompactReadingBlocks(blocks, required).bytes).toBe(required)
  expect(() => CompactReadingBlocks.reservation(semanticLimits.blocks + 2)).toThrow(
    'translation-view-limit',
  )
  const kinds = Array.from({ length: 128 }, (_, index) => ({
    id: crypto.randomUUID(),
    kind: `${index}${'x'.repeat(250)}`,
    from: 0,
    to: 1,
    hash: sourceHash('x'),
  }))
  expect(() => store(kinds)).toThrow('translation-view-limit')
})

it.each([
  { id: 'not-a-uuid' },
  { id: 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF' },
  { from: -1 },
  { to: 0x100000000 },
  { from: 2, to: 1 },
  { kind: '' },
  { hash: '00:0:0' },
  { hash: '1:00:0' },
  { hash: '4294967295:0:0' },
  { hash: '1:100000000:0' },
])('rejects lossy input instead of truncating or normalizing it: %j', (change) => {
  const blocks = [
    {
      id: crypto.randomUUID(),
      kind: 'paragraph',
      from: 0,
      to: 1,
      hash: sourceHash('x'),
      ...change,
    },
  ]
  expect(() => store(blocks)).toThrow('translation-view-worker')
})
