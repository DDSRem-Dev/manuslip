import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import type { PackedOperation } from '../../src/packing-revision'
import { PackedSession } from '../../src/packing-session'
import { validatePackedDescriptions } from '../../src/packing-validate-descriptions'
import type { PackedPath } from '../../src/packing-view'
import { parseMarkdown } from '../../src/parse'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: MiB, staging: MiB, nodes: 800000, depth: 128 }
type Edit = Omit<Extract<PackedOperation, { kind: 'splice' }>, 'record'> & { insert?: boolean }
function fixture(value: unknown, text = 'source', parserVersion = 'test') {
  const owner = new PackedSession(limits)
  const identity = {
    generation: 1,
    documentId: 'item-steps',
    revision: 0,
    sourceHash: sourceHash(text),
    parserVersion,
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(owner.begin(identity, text), identity, packValue(value, limits.bytes)),
  )
  const old = owner.capture()
  const apply = (operations: readonly Edit[], inserted: unknown[] = []) => {
    const result = { ...identity, revision: 1 }
    const payload = packValue({ empty: [], inserted }, limits.bytes)
    const data = PackedArena.open(payload.slice(0), limits)
    const empty = data.field(data.root, 'empty')
    const added = data.field(data.root, 'inserted')
    if (empty === undefined || added === undefined) throw new Error('Missing fixture payload')
    owner.commit(
      owner.prepareDelta(owner.begin(result, text), {
        base: identity,
        baseSource: text,
        result,
        operations: operations.map(({ insert, ...operation }) => ({
          ...operation,
          record: insert ? added : empty,
        })),
        payload,
      }),
    )
    return owner.capture()
  }
  return { owner, old, apply }
}
function referenceProbe() {
  let reads = 0
  const original = PackedArena.prototype.elements
  const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
    this: PackedArena,
    id: number,
  ) {
    for (const value of original.call(this, id)) {
      reads++
      yield value
    }
  })
  return { count: () => reads, close: () => spy.mockRestore() }
}

describe('capture-owned cooperative packed array cursors', () => {
  it.each([
    'inline-class',
    'display-class',
    'inline-child',
    'display-child',
    'display-text',
  ] as const)('forwards progress inside a sliced %s math-data array', (target) => {
    const display = target.startsWith('display')
    const text = display ? '$$\nx\n$$\n' : '$x$\n'
    const document = parseMarkdown(text)
    const path: PackedPath = [
      'document',
      'root',
      'children',
      0,
      ...(display ? [] : ['children', 0]),
      'data',
      ...(target.endsWith('class')
        ? display
          ? ['hChildren', 0, 'properties', 'className']
          : ['hProperties', 'className']
        : target === 'display-text'
          ? ['hChildren', 0, 'children']
          : ['hChildren']),
    ]
    let array: unknown = { document }
    for (const part of path) {
      if (!array || typeof array !== 'object') throw new Error('Fixture path')
      array = Reflect.get(array, part)
    }
    if (!Array.isArray(array)) throw new Error('Fixture array')
    const context = fixture({ document }, text, document.parserVersion)
    const capture = context.apply(
      [
        { kind: 'splice', path, start: 0, remove: array.length, insert: true },
        { kind: 'splice', path, start: 0, remove: 20000 },
      ],
      [...Array(20000).fill(null), ...array],
    )
    const probe = referenceProbe()
    const work = validatePackedDescriptions(
      capture,
      capture.sourceResource,
      ['document'],
      validation,
    )
    let progress = 0
    try {
      while (true) {
        const before = probe.count()
        const step = work.next()
        const reads = probe.count() - before
        expect(reads).toBeLessThanOrEqual(800)
        if (step.done) break
        if (reads >= 256) progress++
      }
      expect(progress).toBeGreaterThan(70)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      work.return()
      probe.close()
      context.owner.dispose()
    }
  })
  it('yields through late prefixes and segment transitions without changing ordered values', () => {
    const context = fixture({
      values: Array.from({ length: 20000 }, (_, index) => ({ index, children: [index] })),
    })
    const capture = context.apply(
      [
        { kind: 'splice', path: ['values'], start: 0, remove: 10000 },
        { kind: 'splice', path: ['values'], start: 1, remove: 1, insert: true },
        { kind: 'splice', path: ['values'], start: 3, remove: 9996 },
      ],
      [{ index: 777, children: [777] }],
    )
    const probe = referenceProbe()
    try {
      const values = []
      let progress = 0
      const cursor = capture.reader.elementSteps(['values'])
      while (true) {
        const before = probe.count()
        const step = cursor.next()
        expect(probe.count() - before).toBeLessThanOrEqual(256)
        if (step.done) break
        if (step.value === undefined) progress++
        else values.push(step.value.scalar(['index'], { retained: 16, staging: 0 }))
      }
      expect(values).toEqual([10000, 777, 10002, 19999])
      expect(progress).toBeGreaterThan(150)
      const synchronous = []
      for (const scope of capture.reader.elements(['values']))
        synchronous.push(scope.scalar(['index'], { retained: 16, staging: 0 }))
      expect(synchronous).toEqual(values)
      expect(context.old.reader.length(['values'])).toBe(20000)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      probe.close()
      context.owner.dispose()
    }
  })
  it('expires the previous item on progress while independent nested readers remain usable', () => {
    const context = fixture({
      values: [
        { value: 1, children: [2] },
        { value: 3, children: [4] },
      ],
    })
    const capture = context.apply([{ kind: 'splice', path: ['values'], start: 1, remove: 0 }])
    try {
      const cursor = capture.reader.elementSteps(['values'])
      const first = cursor.next()
      if (first.done || first.value === undefined) throw new Error('Fixture')
      const child = first.value.at(['value'])
      const nested = first.value.elementSteps(['children'])
      expect(cursor.next()).toEqual({ done: false, value: undefined })
      expect(() => child.scalarType()).toThrow('expired')
      const nestedValue = nested.next()
      if (nestedValue.done || nestedValue.value === undefined) throw new Error('Fixture')
      expect(nestedValue.value.scalar([], { retained: 16, staging: 0 })).toBe(2)
      cursor.return()
      nested.return()
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'release', 'dispose'] as const)(
    'revokes escaped cursor state during prefix progress on %s',
    (action) => {
      const context = fixture({ values: Array.from({ length: 20000 }, (_, i) => i) })
      const capture = context.apply([{ kind: 'splice', path: ['values'], start: 0, remove: 19999 }])
      const before = context.owner.stats.retainedBytes
      const cursor = capture.reader.elementSteps(['values'])
      expect(context.owner.stats.readers).toBe(1)
      const probe = referenceProbe()
      try {
        while (probe.count() < 256) expect(cursor.next()).toEqual({ done: false, value: undefined })
      } finally {
        probe.close()
      }
      if (action === 'return') cursor.return()
      else if (action === 'release') capture.release()
      else context.owner.dispose()
      expect(cursor.next()).toEqual({ done: true, value: undefined })
      expect(context.owner.stats.readers).toBe(0)
      if (action === 'return') expect(context.owner.stats.retainedBytes).toBe(before)
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it('admits reader ownership before opening and rejects a non-array without reserving a cursor', () => {
    const context = fixture({ values: [1], notArray: 'text' })
    try {
      const before = context.owner.stats
      expect(() => context.old.reader.elementSteps(['notArray'])).toThrow()
      expect(context.owner.stats).toEqual(before)
      const cursors = Array.from({ length: limits.readers }, () =>
        context.old.reader.elementSteps(['values']),
      )
      expect(() => context.old.reader.elementSteps(['values'])).toThrow('scope')
      for (const cursor of cursors) cursor.return()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['complete', 'cancel'] as const)(
    'forwards root, block, outline and heading progress during %s validation',
    (action) => {
      const text = '# Heading\n\n'.repeat(3000)
      const document = parseMarkdown(text)
      const context = fixture({ document }, text, document.parserVersion)
      // These no-op edits split the real full parser output into lazy prefixes/suffixes.
      // Source, AST and metadata remain exactly the independent fresh parse.
      const capture = context.apply([
        { kind: 'splice', path: ['document', 'root', 'children'], start: 2500, remove: 0 },
        { kind: 'splice', path: ['document', 'blocks'], start: 2500, remove: 0 },
        { kind: 'splice', path: ['document', 'outline'], start: 2500, remove: 0 },
      ])
      const probe = referenceProbe()
      const work = validatePackedDescriptions(
        capture,
        capture.sourceResource,
        ['document'],
        validation,
      )
      let prefixSteps = 0
      try {
        while (true) {
          const before = probe.count()
          const step = work.next()
          const reads = probe.count() - before
          // A validator advance can consume one item from each of the three independent
          // array cursors plus a tiny heading subtree; no cursor hides its whole prefix.
          expect(reads).toBeLessThanOrEqual(800)
          if (step.done) break
          if (reads >= 256) {
            prefixSteps++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(prefixSteps).toBeGreaterThan(0)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(context.old.reader.length(['document', 'root', 'children'])).toBe(3000)
      } finally {
        work.return()
        probe.close()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
})
