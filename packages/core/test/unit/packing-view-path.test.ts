import { describe, expect, it, vi } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import {
  child,
  offsetNode,
  type PackedNode,
  type PackedPath,
  PackedView,
  rangeNode,
  spliceText,
} from '../../src/packing-view'

const MiB = 1024 * 1024
const limits = { bytes: MiB, retained: 4 * MiB, staging: MiB }
const open = (value: unknown) => PackedArena.open(packValue(value, MiB), limits)

describe('atomic packed view path queries', () => {
  it('matches edge-by-edge traversal for every prefix split of complete arena paths', () => {
    const arena = open({
      nested: [{ values: [null, false, true, 0, '界😀\ud800'] }],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 2, offset: 1 },
      },
      hostile: JSON.parse('{"__proto__":{"constructor":"own"},"toString":false}'),
    })
    const raw: PackedNode = { arena, id: arena.root }
    const view = new PackedView(raw)
    const paths: PackedPath[] = [
      [],
      ['nested'],
      ['nested', 0],
      ['nested', 0, 'values'],
      ...Array.from({ length: 5 }, (_, index) => ['nested', 0, 'values', index]),
      ['position'],
      ['hostile', '__proto__', 'constructor'],
      ['hostile', 'toString'],
    ]
    for (const path of paths) {
      let selected: PackedNode = raw
      for (const part of path) selected = child(selected, part)
      const expected = new PackedView(selected)
      for (let split = 0; split <= path.length; split++) {
        const suffix = path.slice(split)
        for (const prefix of [path.slice(0, split), view.scopePath(path.slice(0, split), [])]) {
          expect(view.kind(suffix, prefix)).toBe(expected.kind())
          expect(view.recordKey(suffix, prefix)).toEqual(expected.recordKey())
          const actual = view.at(suffix, prefix)
          switch (expected.kind()) {
            case 'scalar':
              expect(view.scalar(suffix, prefix)).toBe(expected.scalar())
              expect(view.scalarType(suffix, prefix)).toBe(expected.scalarType())
              expect(view.readScalar(limits, suffix, prefix)).toBe(expected.readScalar(limits))
              expect(view.scalarCost(suffix, prefix)).toEqual(expected.scalarCost())
              expect(actual.readScalar(limits)).toBe(expected.readScalar(limits))
              if (expected.scalarType() === 'string') {
                expect(view.textLength(suffix, prefix)).toBe(expected.textLength())
                expect(view.cachedText(suffix, prefix)).toBe(expected.cachedText())
              }
              break
            case 'array':
              expect(actual.length()).toBe(expected.length())
              expect(view.length(suffix, prefix)).toBe(expected.length())
              break
            case 'object':
              expect(actual.keys()).toEqual(expected.keys())
              expect(view.keys(suffix, prefix)).toEqual(expected.keys())
              expect(view.keyCount(suffix, prefix)).toBe(expected.keyCount())
              expect(view.matchesKeys(expected.keys(), [], limits, suffix, prefix)).toBe(true)
              for (const key of expected.keys())
                expect(view.hasField(key, view.scopePath(path, []))).toBe(true)
              break
            case 'position':
              expect(view.position(suffix, prefix)).toEqual(expected.position())
              expect(view.readPosition(limits, suffix, prefix)).toEqual(
                expected.readPosition(limits),
              )
              expect(actual.readPosition(limits)).toEqual(expected.readPosition(limits))
              break
          }
        }
      }
    }
  })

  it('preserves traversal failures and their order across arena path prefix boundaries', () => {
    const arena = open({ items: [0], scalar: false })
    const raw: PackedNode = { arena, id: arena.root }
    const view = new PackedView(raw)
    const paths: PackedPath[] = [
      ['absent'],
      ['items', 'length'],
      ['items', 1],
      ['items', -1],
      ['items', NaN],
      ['items', Infinity],
      ['items', 0.5],
      ['items', Number.MAX_SAFE_INTEGER + 1],
      ['items', 0, 'field'],
      ['scalar', 0],
      ['scalar', 'field'],
      [0],
      [-1],
      ['constructor'],
    ]
    const failure = (run: () => unknown) => {
      try {
        run()
        throw new Error('Expected a traversal failure')
      } catch (error) {
        if (!(error instanceof Error)) throw error
        return error.message
      }
    }
    for (const path of paths) {
      const expected = failure(() => {
        let selected: PackedNode = raw
        for (const part of path) selected = child(selected, part)
        return selected
      })
      expect(expected).not.toBe('Expected a traversal failure')
      for (let split = 0; split <= path.length; split++) {
        const prefix = path.slice(0, split),
          suffix = path.slice(split)
        expect(failure(() => view.kind(suffix, prefix))).toBe(expected)
        for (const query of [
          (prefix: ReturnType<PackedView['scopePath']>) => view.kind(suffix, prefix),
          (prefix: ReturnType<PackedView['scopePath']>) => view.at(suffix, prefix),
          (prefix: ReturnType<PackedView['scopePath']>) => view.recordKey(suffix, prefix),
          (prefix: ReturnType<PackedView['scopePath']>) => view.scalarType(suffix, prefix),
          (prefix: ReturnType<PackedView['scopePath']>) => view.keys(suffix, prefix),
          (prefix: ReturnType<PackedView['scopePath']>) => view.readScalar(limits, suffix, prefix),
        ])
          expect(failure(() => query(view.scopePath(prefix, [])))).toBe(expected)
        expect(failure(() => view.at(suffix, prefix))).toBe(expected)
        expect(failure(() => view.scalarType(suffix, prefix))).toBe(expected)
        expect(failure(() => view.textLength(suffix, prefix))).toBe(expected)
        expect(failure(() => view.cachedText(suffix, prefix))).toBe(expected)
        expect(failure(() => view.readScalar({ retained: 0, staging: 0 }, suffix, prefix))).toBe(
          expected,
        )
        expect(failure(() => view.readPosition({ retained: 0, staging: 0 }, suffix, prefix))).toBe(
          expected,
        )
      }
    }
  })

  it.each(['arena', 'overlay', 'transformed arena', 'transformed overlay'] as const)(
    'matches complete own fields and exact admission for %s without expanding values',
    (representation) => {
      const native = JSON.parse('{"__proto__":0,"constructor":false,"世界😀":"private"}')
      const names = Object.keys(native)
      const arena = open(native)
      const raw = representation.endsWith('overlay')
        ? { fields: names.map((key) => [key, { number: 0 }] as const) }
        : { arena, id: arena.root }
      const node = representation.startsWith('transformed') ? offsetNode(rangeNode(raw, 9), 7) : raw
      const view = new PackedView({ fields: [['nested', node]] })
      const cost = 48 + names.reduce((sum, key) => sum + 40 + key.length * 2, 0)
      const fields = vi.spyOn(PackedArena.prototype, 'fields')
      const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
      try {
        for (const [required, optional] of [
          [[...names].reverse(), []],
          [names.slice(0, 1), names.slice(1)],
          [names, ['absent']],
          [[], names],
          [names.slice(0, 2), []],
          [['missing'], names],
          [['toString'], names],
          [names.slice(0, 1), ['unknown', 'unused']],
        ]) {
          if (!required || !optional) throw new Error('Missing field schema')
          const accepted =
            required.every((key) => Object.hasOwn(native, key)) &&
            names.every((key) => required.includes(key) || optional.includes(key))
          expect(
            view.matchesKeys(required, optional, { retained: cost, staging: 0 }, ['nested']),
          ).toBe(accepted)
          expect(
            view.matchesKeys(required, optional, { retained: cost, staging: 0 }, [], ['nested']),
          ).toBe(accepted)
        }
        expect(() =>
          view.matchesKeys(names, [], { retained: cost - 1, staging: 0 }, ['nested']),
        ).toThrow('retained')
        for (const retained of [-1, NaN, Infinity])
          expect(() => view.matchesKeys(names, [], { retained, staging: 0 }, ['nested'])).toThrow(
            'limits',
          )
        expect(fields).not.toHaveBeenCalled()
        expect(scalar).not.toHaveBeenCalled()
      } finally {
        fields.mockRestore()
        scalar.mockRestore()
      }
    },
  )

  it('selects the object before admission getters redirect caller paths', () => {
    const arena = open({ original: { yes: 1 }, other: { no: 2 }, scalar: 0, array: [] })
    const view = new PackedView({ arena, id: arena.root })
    const path = ['original']
    const budget = {
      get retained() {
        path[0] = 'other'
        return MiB
      },
      staging: 0,
    }
    expect(view.matchesKeys(['yes'], [], budget, path)).toBe(true)
    expect(view.matchesKeys(['yes'], [], limits, path)).toBe(false)
    for (const path of [['scalar'], ['array']])
      expect(view.matchesKeys([], [], limits, path)).toBe(false)
    expect(() => view.matchesKeys([], [], limits, ['missing'])).toThrow('path')
  })

  it('reads complete values through field overlays, segments, text edits and lazy shifts', () => {
    const sourcePosition = {
      start: { line: 1, column: 2, offset: 1 },
      end: { line: 2, column: 3, offset: 9 },
    }
    const arena = open({ from: 1, to: 9, text: 'short 😀', position: sourcePosition })
    const raw = { arena, id: arena.root }
    const nested = offsetNode(rangeNode(raw, 3), 7)
    const array = open([null, false, true])
    const original = open('A😀Z')
    const inserted = open('!')
    const text = spliceText(
      { arena: original, id: original.root },
      2,
      0,
      inserted,
      inserted.root,
      () => {},
    )
    const view = new PackedView({
      fields: [
        ['nested', nested],
        ['items', { segments: [{ arena: array, id: array.root, from: 1, length: 2 }], length: 2 }],
        ['edited', text],
      ],
    })
    expect(view.kind(['nested'])).toBe('object')
    expect(view.keys(['nested'])).toEqual(['from', 'to', 'text', 'position'])
    expect(view.keyCount(['nested'])).toBe(4)
    expect(view.readScalar(limits, ['nested', 'from'])).toBe(4)
    expect(view.scalar(['nested', 'to'])).toBe(12)
    expect(view.scalarType(['nested', 'from'])).toBe('number')
    expect(view.scalarCost(['nested', 'from'])).toEqual({ retained: 16, workspace: 0 })
    expect(view.readPosition(limits, ['nested', 'position'])).toEqual({
      start: { ...sourcePosition.start, offset: 8 },
      end: { ...sourcePosition.end, offset: 16 },
    })
    expect(view.position(['nested', 'position'])).toEqual(
      view.at(['nested', 'position']).position(),
    )
    expect(view.cachedText(['nested', 'text'])).toBe('short 😀')
    expect(view.textLength(['nested', 'text'])).toBe(8)
    expect(view.textStepCost(['nested', 'text'])).toEqual(
      view.at(['nested', 'text']).textStepCost(),
    )
    expect(view.recordKey(['nested'])).toEqual({
      token: arena.recordToken(arena.root),
      record: arena.root,
      offset: 7,
      range: 3,
    })
    expect(view.recordKey(['items'])).toBeUndefined()
    expect(view.length(['items'])).toBe(2)
    expect(view.scalar(['items', 0])).toBe(false)
    expect(view.scalar(['items', 1])).toBe(true)
    expect(view.scalar(['edited'])).toBe('A\ud83d!\ude00Z')
    expect(view.textLength(['edited'])).toBe(5)
    expect(view.cachedText(['edited'])).toBeUndefined()
    expect(view.readScalar(limits, ['edited'])).toBe('A\ud83d!\ude00Z')
    expect(() => view.scalar(['items', 2])).toThrow('path')
    expect(() => view.readScalar({ retained: 0, staging: MiB }, ['edited'])).toThrow()
    expect(() => view.readPosition({ retained: 271, staging: 0 }, ['nested', 'position'])).toThrow()
    expect(view.scalar(['nested', 'from'])).toBe(4)
  })

  it('resolves a path once before output admission even when the caller mutates it', () => {
    const first = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 2, offset: 1 },
    }
    const second = {
      start: { line: 2, column: 1, offset: 2 },
      end: { line: 2, column: 2, offset: 3 },
    }
    const arena = open({ first, second, a: 'original', b: 'other' })
    const view = new PackedView({ arena, id: arena.root })
    for (const kind of ['scalar', 'position'] as const) {
      const path = [kind === 'scalar' ? 'a' : 'first']
      const budget = {
        get retained() {
          path[0] = kind === 'scalar' ? 'b' : 'second'
          return MiB
        },
        staging: MiB,
      }
      expect(
        kind === 'scalar' ? view.readScalar(budget, path) : view.readPosition(budget, path),
      ).toEqual(kind === 'scalar' ? 'original' : first)
    }
    expect(() => view.readPosition({ retained: 0, staging: 0 }, ['missing'])).toThrow('path')
    expect(() => view.readScalar({ retained: 0, staging: 0 }, ['missing'])).toThrow('path')
  })

  it.each([false, true])(
    'resolves field shape before admission mutates its %s prefix path',
    (prefix) => {
      const arena = open({ first: { original: 1 }, second: { changed: 2 } })
      const view = new PackedView({ arena, id: arena.root })
      const path = ['first']
      const budget = {
        get retained() {
          path[0] = 'second'
          return MiB
        },
        staging: MiB,
      }
      expect(
        view.matchesKeys(['original'], [], budget, prefix ? [] : path, prefix ? path : []),
      ).toBe(true)
      expect(path).toEqual(['second'])
      expect(view.matchesKeys(['original'], [], limits, path)).toBe(false)
      expect(() =>
        view.matchesKeys(['original'], [], { retained: 0, staging: 0 }, ['first']),
      ).toThrow()
    },
  )

  it('retains kind and path failures in direct arena queries', () => {
    const arena = open({
      list: [1],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 2, offset: 1 },
      },
    })
    const view = new PackedView({ arena, id: arena.root })
    expect(view.matchesKeys([], [], limits, ['list'])).toBe(false)
    expect(() => view.keys(['list'])).toThrow()
    expect(() => view.keyCount(['list'])).toThrow()
    expect(() => view.hasField('value', ['list'])).toThrow()
    expect(() => view.length(['position'])).toThrow()
    for (const path of [['missing'], ['list', -1], ['list', 1]]) {
      expect(() => view.recordKey(path)).toThrow('path')
      expect(() => view.scalarCost(path)).toThrow('path')
      expect(() => view.position(path)).toThrow('path')
      expect(() => view.keys(path)).toThrow('path')
      expect(() => view.keyCount(path)).toThrow('path')
      expect(() => view.length(path)).toThrow('path')
      expect(() => view.matchesKeys([], [], limits, path)).toThrow('path')
    }
  })
})
