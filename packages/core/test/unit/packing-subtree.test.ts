import { describe, expect, it } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { readPackedSubtree } from '../../src/packing-subtree'
import { parseMarkdown } from '../../src/parse'

const MiB = 1024 * 1024
const limits = { retained: MiB, staging: MiB }
const open = (value: unknown) =>
  PackedArena.open(packValue(value, 8 * MiB), {
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
  })

describe('bounded packed subtree materialization', () => {
  it('reads the selected paragraph without expanding unrelated nodes or losing global positions', () => {
    const document = parseMarkdown(
      '---\ntitle: test\n---\n\n# 😀\n\nParagraph **two** with [link][r].\n\n[r]: https://example.invalid/\n',
    )
    const arena = open({ document, unrelated: 'x'.repeat(2 * MiB) })
    const doc = arena.field(arena.root, 'document')
    if (doc === undefined) throw new Error('Missing document')
    const root = arena.field(doc, 'root')
    if (root === undefined) throw new Error('Missing root')
    const children = arena.field(root, 'children')
    if (children === undefined) throw new Error('Missing children')
    const paragraph = [...arena.elements(children)][2]
    if (paragraph === undefined) throw new Error('Missing paragraph')
    const selected = readPackedSubtree(arena, paragraph, {
      retained: 16 * 1024,
      staging: 16 * 1024,
    })
    expect(selected.value).toEqual(document.root.children[2])
    expect(selected.records).toBeLessThan(32)
    expect(selected.retainedBytes).toBeLessThan(4096)
    expect(selected.stagingBytes).toBeLessThan(4096)
    expect(structuredClone(selected.value)).toEqual(document.root.children[2])
    expect(() => readPackedSubtree(arena, arena.root, limits)).toThrow('retained')
    // A failed broader request cannot change the owned arena or an earlier private result.
    expect(readPackedSubtree(arena, paragraph, limits).value).toEqual(selected.value)
  })

  it('preserves sharing without exponential expansion, and handles deep graphs iteratively', () => {
    let deep: unknown = 'leaf'
    for (let index = 0; index < 20000; index++) deep = { child: deep }
    const arena = open(deep)
    const selected = readPackedSubtree(arena, arena.root, { retained: 4 * MiB, staging: 4 * MiB })
    let value = selected.value
    for (let index = 0; index < 20000; index++) value = (value as { child: unknown }).child
    expect(value).toBe('leaf')
    let shared: unknown = -0
    for (let index = 0; index < 100; index++) shared = [shared, shared]
    const compact = open(shared)
    value = readPackedSubtree(compact, compact.root, limits).value
    for (let index = 0; index < 100; index++) {
      const array = value as unknown[]
      expect(array[0]).toBe(array[1])
      value = array[0]
    }
    expect(Object.is(value, -0)).toBe(true)
  })

  it('returns immutable standalone positions and safe special keys', () => {
    const value = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"safe","p":{"start":{"line":1,"column":1,"offset":0},"end":{"line":2,"column":1,"offset":2}}}',
    )
    const arena = open(value)
    const selected = readPackedSubtree(arena, arena.root, limits)
    expect(selected.value).toEqual(value)
    expect(Object.isFrozen(selected.value)).toBe(true)
    expect(Reflect.get({}, 'polluted')).toBeUndefined()
    const position = arena.field(arena.root, 'p')
    if (position === undefined) throw new Error('Missing position')
    expect(readPackedSubtree(arena, position, limits).value).toEqual(value.p)
  })

  it('checks exact admission and leaves no partial result on low budgets or invalid IDs', () => {
    const arena = open(parseMarkdown('# Heading\n\nProse.\n'))
    const selected = readPackedSubtree(arena, arena.root, limits)
    expect(
      readPackedSubtree(arena, arena.root, {
        retained: selected.retainedBytes,
        staging: selected.stagingBytes,
      }).value,
    ).toEqual(selected.value)
    expect(() =>
      readPackedSubtree(arena, arena.root, { ...limits, retained: selected.retainedBytes - 1 }),
    ).toThrow('retained')
    expect(() =>
      readPackedSubtree(arena, arena.root, { ...limits, staging: selected.stagingBytes - 1 }),
    ).toThrow('staging')
    for (const id of [-1, NaN, Infinity, 0.5, arena.records])
      expect(() => readPackedSubtree(arena, id, limits)).toThrow('record ID')
    for (const limit of [-1, NaN, Infinity, 0.5])
      for (const key of ['retained', 'staging'])
        expect(() => readPackedSubtree(arena, arena.root, { ...limits, [key]: limit })).toThrow(
          'limits',
        )
  })

  it('admits uncached scalar output and JSON decoding workspace before allocating it', () => {
    const value = 'x'.repeat(20000)
    const arena = open(value)
    expect(() => readPackedSubtree(arena, arena.root, { retained: 1024, staging: MiB })).toThrow(
      'retained',
    )
    expect(() => readPackedSubtree(arena, arena.root, { retained: MiB, staging: 1024 })).toThrow(
      'staging',
    )
    const selected = readPackedSubtree(arena, arena.root, limits)
    expect(selected.value).toBe(value)
    expect(selected.stagingBytes).toBeGreaterThan(arena.scalarCost(arena.root).workspace)
  })
})
