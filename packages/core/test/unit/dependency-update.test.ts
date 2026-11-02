import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { describeDocumentFragment, documentFragmentOperations } from '../../src/document-metadata'
import {
  type FragmentChange,
  type MarkdownFragment,
  reparseMarkdownFragment,
} from '../../src/markdown-fragment'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import type { PackedCapture, PackedReadScope } from '../../src/packing-capture'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { parseMarkdown } from '../../src/parse'
import { SemanticDependencies } from '../../src/semantic-dependencies'

const MiB = 1024 * 1024
const sessionLimits = {
  bytes: 8 * MiB,
  retained: 16 * MiB,
  staging: 8 * MiB,
  captures: 8,
  readers: 128,
}
const indexLimits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
const fragmentLimits = { ...indexLimits, bytes: 64 * 1024, nodes: 8192 }
function fixture(source: string) {
  const document = parseMarkdown(source)
  const identity = {
    generation: 1,
    documentId: 'index-sequence',
    revision: 0,
    sourceHash: sourceHash(source),
    parserVersion: document.parserVersion,
    rendererVersion: 'test',
    options: 'test',
  }
  const owner = new PackedSession(sessionLimits)
  owner.commit(
    owner.prepareFull(owner.begin(identity, source), identity, packValue(document, 8 * MiB)),
  )
  const capture = owner.capture()
  const index = SemanticDependencies.build(capture, source, ['root'], indexLimits)
  return { owner, capture, index, document }
}
function fragment(capture: PackedCapture, index: SemanticDependencies, change: FragmentChange) {
  const before = index.sourceResource.text
  const after = before.slice(0, change.from) + change.insert + before.slice(change.to)
  const source = new PackedSource(
    { ...index.identity, revision: index.identity.revision + 1, sourceHash: sourceHash(after) },
    after,
  )
  const result = reparseMarkdownFragment(
    {
      capture,
      dependencies: index,
      baseSource: before,
      source,
      change,
      root: ['root'],
      syntax: 'manuslip',
    },
    fragmentLimits,
  )
  if (result.kind !== 'fragment') throw new Error(`Unexpected full parse: ${result.reason}`)
  return result
}
function prepare(owner: PackedSession, patch: MarkdownFragment, index: SemanticDependencies) {
  const capture = owner.capture()
  const metadata = describeDocumentFragment(
    { capture, dependencies: index, fragment: patch, document: [], parseMs: 1 },
    indexLimits,
  )
  capture.release()
  const hold = owner.retain(metadata)
  const payload = packValue(
    {
      children: patch.children,
      position: patch.position,
      blocks: metadata.blocks.values,
      outline: metadata.outline.values,
      counts: metadata.counts,
      sourceHash: patch.source.identity.sourceHash,
      parserVersion: patch.source.identity.parserVersion,
      timings: metadata.timings,
    },
    8 * MiB,
  )
  const arena = PackedArena.open(payload.slice(0), sessionLimits)
  try {
    return owner.prepareDelta(
      owner.beginPrepared(patch.source),
      {
        base: patch.base,
        baseSource: patch.baseSource,
        result: patch.source.identity,
        payload,
        operations: documentFragmentOperations(patch, metadata, arena, []),
      },
      payload.byteLength + 2048,
    )
  } finally {
    hold.release()
  }
}
function read(scope: PackedReadScope, path: readonly (string | number)[] = []): unknown {
  switch (scope.kind(path)) {
    case 'scalar':
      return scope.scalar(path, sessionLimits)
    case 'position':
      return scope.position(path, sessionLimits)
    case 'array': {
      const result: unknown[] = []
      for (const item of scope.elements(path)) result.push(read(item))
      return result
    }
    case 'object':
      return Object.fromEntries(
        scope.keys(path, sessionLimits).map((key) => [key, read(scope, [...path, key])]),
      )
  }
}
function compareDocument(capture: PackedCapture, source: string) {
  const actual = read(capture.reader) as ReturnType<typeof parseMarkdown>
  const expected = parseMarkdown(source)
  expect({ ...actual, timings: null }).toEqual({ ...expected, timings: null })
  expect(actual.timings.parse).toBe(1)
  expect(actual.timings.describe).toBeGreaterThanOrEqual(0)
}
function compare(actual: SemanticDependencies, expected: SemanticDependencies) {
  expect(actual.identity).toEqual(expected.identity)
  expect([...actual.blocks]).toEqual([...expected.blocks])
  expect([...actual.definitions]).toEqual([...expected.definitions])
  expect([...actual.references]).toEqual([...expected.references])
  expect(actual.calls).toEqual(expected.calls)
  expect(actual.footnoteOrder).toEqual(expected.footnoteOrder)
  expect(actual.nodes).toBe(expected.nodes)
  for (const definition of expected.definitions)
    expect(actual.resolve(definition.kind, definition.key)).toEqual(
      expected.resolve(definition.kind, definition.key),
    )
  actual.assertBase(expected.identity, expected.sourceResource.text)
}
/** Build through an independently fresh complete parse, not the incrementally prepared root. */
function freshIndex(source: PackedSource) {
  const document = parseMarkdown(source.text)
  const owner = new PackedSession(sessionLimits)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue(document.root, 8 * MiB),
    ),
  )
  const capture = owner.capture()
  const result = SemanticDependencies.build(capture, source.text, [], indexLimits)
  capture.release()
  owner.dispose()
  return result
}
const replace = (source: string, text: string, insert: string) => ({
  from: source.indexOf(text),
  to: source.indexOf(text) + text.length,
  insert,
})

describe('immutable dependency maintenance across real packed edits', () => {
  it.each([
    'Before.\n\nOrdinary writing with [r] and ![image][r].\n\nAfter[^a].\n\n[^a]: Note [^b].\n[^b]: Other.\n[r]: /r\n[r]: /ignored\n',
    '> > Nested writing [r] and [^a].\n>\n> [r]: /inside\n>\n> [^a]: Uses [^b].\n\nAfter[^b].\n\n[^b]: Last [^a].\n',
    '# First\r\n\r\n- Task writing 😀 [r]\r\n- Other\r\n\r\nTail.\r\n\r\n[r]: /r\r\n',
    'Body writing [unresolved] and `[^literal]`.\n\nLater [r].\n\n[r]: /r\n',
    'Before.\n\n## Heading writing\n\nCall[^a].\n\n[^a]: Used [^b].\n[^b]: Cyclic [^a].\n[^unused]: Never [^a].\n',
  ])('keeps every range/key/resolution/call equal to independent fresh indexes: %j', (source) => {
    const context = fixture(source)
    const oldValues = {
      blocks: [...context.index.blocks],
      definitions: [...context.index.definitions],
      references: [...context.index.references],
    }
    let capture = context.capture
    let index = context.index
    let hold = context.owner.retain(index)
    const oldHold = context.owner.retain(index)
    let word = 'writing'
    try {
      for (const insert of ['longer prose', '短语', 'e\u0301 writing', 'word', 'writing']) {
        const patch = fragment(capture, index, replace(index.sourceResource.text, word, insert))
        const patchHold = context.owner.retain(patch)
        const prepared = prepare(context.owner, patch, index)
        const updated = index.advance(patch, indexLimits)
        const updatedHold = context.owner.retain(updated)
        compare(updated, freshIndex(patch.source))
        context.owner.commit(prepared)
        if (capture !== context.capture) capture.release()
        capture = context.owner.capture()
        compareDocument(capture, patch.source.text)
        hold.release()
        patchHold.release()
        hold = updatedHold
        index = updated
        word = insert
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.retainedBytes).toBeLessThanOrEqual(sessionLimits.retained)
      }
      expect([...context.index.blocks]).toEqual(oldValues.blocks)
      expect([...context.index.definitions]).toEqual(oldValues.definitions)
      expect([...context.index.references]).toEqual(oldValues.references)
      expect(read(context.capture.reader)).toEqual(context.document)
      expect(index.calls).toBe(context.index.calls)
      expect(index.footnoteOrder).toBe(context.index.footnoteOrder)
    } finally {
      capture.release()
      context.capture.release()
      hold.release()
      oldHold.release()
      context.owner.dispose()
    }
    expect(context.owner.stats).toMatchObject({
      retainedBytes: 0,
      resources: 0,
      holds: 0,
      captures: 0,
      readers: 0,
    })
  })

  it.each(['', '  ', '\n\n', '[r]: /r\n\n', 'Call[^a].\n\n[^a]: Note\n\n'])(
    'handles new EOF blocks then subsequent edits: %j',
    (source) => {
      const context = fixture(source)
      const patch = fragment(context.capture, context.index, {
        from: source.length,
        to: source.length,
        insert: 'writing',
      })
      let index = context.index.advance(patch, indexLimits)
      compare(index, freshIndex(patch.source))
      context.owner.commit(prepare(context.owner, patch, context.index))
      context.capture.release()
      const capture = context.owner.capture()
      const next = fragment(capture, index, replace(patch.source.text, 'writing', 'longer words'))
      index = index.advance(next, indexLimits)
      compare(index, freshIndex(next.source))
      context.owner.dispose()
      expect(index.sourceResource.text).toBe(next.source.text)
    },
  )

  it('rejects clones, another equal-base index, replay against an updated index and unsupported syntax', () => {
    const source = 'Ordinary writing.\n\n[r]: /r\n'
    const context = fixture(source)
    const other = fixture(source)
    try {
      const patch = fragment(context.capture, context.index, replace(source, 'writing', 'edits'))
      const before = context.owner.stats
      expect(() => context.index.advance({ ...patch }, indexLimits)).toThrow('provenance')
      expect(() => other.index.advance(patch, indexLimits)).toThrow('provenance')
      const updated = context.index.advance(patch, indexLimits)
      expect(() => updated.advance(patch, indexLimits)).toThrow('provenance')
      const text = 'Ordinary [writing.'
      const unsupported = reparseMarkdownFragment(
        {
          capture: context.capture,
          dependencies: context.index,
          baseSource: source,
          source: new PackedSource(
            { ...context.index.identity, revision: 1, sourceHash: sourceHash(text) },
            text,
          ),
          change: replace(source, source, text),
          root: ['root'],
          syntax: 'manuslip',
        },
        fragmentLimits,
      )
      expect(unsupported.kind).toBe('full')
      expect(() => context.index.advance(unsupported as MarkdownFragment, indexLimits)).toThrow(
        'provenance',
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
      other.owner.dispose()
    }
  })

  it('admits exact retained/staging/node/depth limits and preserves the base on rejection', () => {
    const source = '> > Nested writing [r].\n\nLater.\n\n[r]: /r\n'
    const context = fixture(source)
    try {
      const patch = fragment(
        context.capture,
        context.index,
        replace(source, 'writing', 'longer prose'),
      )
      const updated = context.index.advance(patch, indexLimits)
      const exact = {
        retained: updated.retainedBytes,
        staging: updated.stagingBytes,
        nodes: updated.nodes,
        depth: updated.depth,
      }
      compare(context.index.advance(patch, exact), freshIndex(patch.source))
      const before = context.owner.stats
      for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
        expect(() => context.index.advance(patch, { ...exact, [key]: exact[key] - 1 })).toThrow(
          /limit/,
        )
      for (const key of ['retained', 'staging', 'nodes', 'depth'] as const)
        for (const value of [-1, NaN, Infinity, 0.5])
          expect(() => context.index.advance(patch, { ...indexLimits, [key]: value })).toThrow(
            'limits',
          )
      expect(context.owner.stats).toEqual(before)
      expect(context.index.sourceResource.text).toBe(source)
    } finally {
      context.owner.dispose()
    }
  })

  it('shares actual metadata resources while keeping old/new indexes independently charged', () => {
    const source = 'Ordinary writing [r].\n\n[r]: /r\n'
    const context = fixture(source)
    const patch = fragment(context.capture, context.index, replace(source, 'writing', 'edits'))
    const updated = context.index.advance(patch, indexLimits)
    const oldResources = [...context.index.resources()]
    const nextResources = [...updated.resources()]
    expect(nextResources[0]?.key).toBe(patch.source)
    expect(nextResources[1]?.key).toBe(oldResources[1]?.key)
    expect(
      nextResources.some(
        ({ key }) => key === context.index || key === context.index.sourceResource,
      ),
    ).toBe(false)
    for (const { key } of nextResources) expect(Object.isFrozen(key)).toBe(true)
    const oldHold = context.owner.retain(context.index)
    const patchHold = context.owner.retain(patch)
    const before = context.owner.stats.retainedBytes
    const nextHold = context.owner.retain(updated)
    expect(context.owner.stats.retainedBytes - before).toBe(
      updated.retainedBytes -
        patch.source.retainedBytes -
        (context.index.retainedBytes - context.index.sourceResource.retainedBytes) +
        192 +
        256 +
        nextResources.length * 64,
    )
    context.owner.invalidate()
    context.owner.evict()
    context.capture.release()
    expect(context.owner.stats.holds).toBe(3)
    oldHold.release()
    patchHold.release()
    compare(updated, freshIndex(patch.source))
    nextHold.release()
    expect(context.owner.stats.retainedBytes).toBe(256)
    context.owner.dispose()
  })

  it('bounds historical metadata, requires resync, and resumes after a complete rebuild', () => {
    const context = fixture('Ordinary writing.')
    let index = context.index
    let capture = context.capture
    let hold = context.owner.retain(index)
    for (let iteration = 0; iteration < 127; iteration++) {
      const text = index.sourceResource.text
      const patch = fragment(capture, index, {
        from: text.length - 1,
        to: text.length - 1,
        insert: 'x',
      })
      const updated = index.advance(patch, indexLimits)
      const updatedHold = context.owner.retain(updated)
      context.owner.commit(prepare(context.owner, patch, index))
      capture.release()
      capture = context.owner.capture()
      hold.release()
      hold = updatedHold
      index = updated
    }
    const text = index.sourceResource.text
    const next = fragment(capture, index, {
      from: text.length - 1,
      to: text.length - 1,
      insert: 'x',
    })
    const before = context.owner.stats
    expect(() => index.advance(next, indexLimits)).toThrow('history limit')
    expect(context.owner.stats).toEqual(before)
    compare(index, freshIndex(index.sourceResource))
    capture.release()
    hold.release()
    context.owner.evict()
    const document = parseMarkdown(text)
    context.owner.commit(
      context.owner.prepareFull(
        context.owner.beginPrepared(index.sourceResource),
        index.identity,
        packValue(document, 8 * MiB),
      ),
    )
    capture = context.owner.capture()
    index = SemanticDependencies.build(capture, text, ['root'], indexLimits)
    const resumed = fragment(capture, index, {
      from: text.length - 1,
      to: text.length - 1,
      insert: 'x',
    })
    compare(index.advance(resumed, indexLimits), freshIndex(resumed.source))
    context.owner.dispose()
  })
})
