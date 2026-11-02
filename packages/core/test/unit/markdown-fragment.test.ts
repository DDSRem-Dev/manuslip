import type { Nodes, Root } from 'mdast'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../../renderer/src/index'
import { sourceHash } from '../../src/contracts'
import { describeDocumentFragment, documentFragmentOperations } from '../../src/document-metadata'
import {
  type FragmentChange,
  type FragmentLimits,
  type MarkdownFragment,
  reparseMarkdownFragment,
} from '../../src/markdown-fragment'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedSession } from '../../src/packing-session'
import type { PackedIdentity } from '../../src/packing-source'
import { PackedSource } from '../../src/packing-source'
import { parseMarkdown } from '../../src/parse'
import { SemanticDependencies } from '../../src/semantic-dependencies'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits: FragmentLimits = {
  bytes: 64 * 1024,
  retained: 8 * MiB,
  staging: 8 * MiB,
  nodes: 8192,
  depth: 64,
}
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
function fixture(source: string, syntax: 'manuslip' | 'commonmark' = 'manuslip', readers = 128) {
  const document = parseMarkdown(source, syntax)
  const projection = renderMarkdown(document.root, options)
  const identity = {
    generation: 1,
    documentId: 'fragments',
    revision: 0,
    sourceHash: sourceHash(source),
    parserVersion: document.parserVersion,
    rendererVersion: projection.rendererVersion,
    options: JSON.stringify(options),
  }
  const owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 4,
    readers,
  })
  const request = owner.begin(identity, source)
  owner.commit(owner.prepareFull(request, identity, packValue({ document, projection }, 8 * MiB)))
  const capture = owner.capture()
  const dependencies = SemanticDependencies.build(capture, source, ['document', 'root'], {
    retained: 8 * MiB,
    staging: 8 * MiB,
    nodes: 800000,
    depth: 64,
  })
  const run = (change: FragmentChange, changed: Partial<FragmentLimits> = {}, exact?: string) => {
    const after = exact ?? source.slice(0, change.from) + change.insert + source.slice(change.to)
    return reparseMarkdownFragment(
      {
        capture,
        dependencies,
        baseSource: source,
        source: new PackedSource(
          { ...identity, revision: 1, sourceHash: sourceHash(after) },
          after,
        ),
        change,
        root: ['document', 'root'],
        syntax,
      },
      { ...limits, ...changed },
    )
  }
  return {
    owner,
    capture,
    dependencies,
    document,
    identity,
    run,
    close: () => {
      capture.release()
      owner.dispose()
    },
  }
}
/** Test oracle adapter only: production never reconstructs this complete native root. */
function apply(root: Root, patch: MarkdownFragment): Root {
  const result = structuredClone(root)
  const suffix = result.children.slice(patch.start + patch.remove)
  const pending: Nodes[] = [...suffix]
  while (pending.length) {
    const node = pending.pop()
    if (!node) break
    if (node.position)
      for (const point of [node.position.start, node.position.end])
        if (point.offset !== undefined) point.offset += patch.suffixOffset
    if ('children' in node) pending.push(...node.children)
  }
  result.children = [...result.children.slice(0, patch.start), ...patch.children, ...suffix]
  result.position = patch.position
  return result
}
function capturedValue(
  reader: import('../../src/packing-capture').PackedReadScope,
  path: readonly (string | number)[] = [],
): unknown {
  switch (reader.kind(path)) {
    case 'scalar':
      return reader.scalar(path, limits)
    case 'position':
      return reader.position(path, limits)
    case 'array': {
      const result: unknown[] = []
      for (const child of reader.elements(path)) result.push(capturedValue(child))
      return result
    }
    case 'object':
      return Object.fromEntries(
        reader.keys(path, limits).map((key) => [key, capturedValue(reader, [...path, key])]),
      )
  }
}
function verify(
  source: string,
  change: FragmentChange,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
) {
  const context = fixture(source, syntax)
  try {
    const result = context.run(change)
    expect(result.kind).toBe('fragment')
    if (result.kind !== 'fragment') throw new Error(`Unexpected full parse: ${result.reason}`)
    const after = source.slice(0, change.from) + change.insert + source.slice(change.to)
    const expectedDocument = parseMarkdown(after, syntax)
    const expected = expectedDocument.root
    const actual = apply(context.document.root, result)
    expect(actual).toEqual(expected)
    const { renderMs: _actualMs, ...actualProjection } = renderMarkdown(actual, options)
    const { renderMs: _expectedMs, ...expectedProjection } = renderMarkdown(expected, options)
    expect(actualProjection).toEqual(expectedProjection)
    const indexLimits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 64 }
    const metadata = describeDocumentFragment(
      {
        capture: context.capture,
        dependencies: context.dependencies,
        fragment: result,
        document: ['document'],
        parseMs: 1,
      },
      indexLimits,
    )
    const payload = packValue(
      {
        children: result.children,
        position: result.position,
        blocks: metadata.blocks.values,
        outline: metadata.outline.values,
        counts: metadata.counts,
        sourceHash: result.source.identity.sourceHash,
        parserVersion: result.source.identity.parserVersion,
        timings: metadata.timings,
      },
      8 * MiB,
    )
    const arena = PackedArena.open(payload.slice(0), {
      bytes: 8 * MiB,
      retained: 16 * MiB,
      staging: 8 * MiB,
    })
    const rootPath = ['document', 'root']
    const operations = documentFragmentOperations(result, metadata, arena, ['document'])
    const indexHold = context.owner.retain(context.dependencies)
    const patchHold = context.owner.retain(result)
    const metadataHold = context.owner.retain(metadata)
    const footprint = [...result.resources()]
    expect(footprint[0]?.key).toBe(context.capture.sourceResource)
    expect(footprint[1]?.key).toBe(result.source)
    expect(footprint.some(({ key }) => key === context.dependencies)).toBe(false)
    const ticket = context.owner.beginPrepared(result.source)
    const prepared = context.owner.prepareDelta(ticket, {
      base: result.base,
      baseSource: source,
      result: result.source.identity,
      payload,
      operations,
    })
    const inspection = context.owner.capturePrepared(prepared)
    expect(capturedValue(inspection.reader, rootPath)).toEqual(expected)
    expect(capturedValue(inspection.reader, ['document'])).toEqual({
      ...expectedDocument,
      timings: metadata.timings,
    })
    const updated = context.dependencies.advance(result, indexLimits)
    const updatedHold = context.owner.retain(updated)
    const rebuilt = SemanticDependencies.build(inspection, after, rootPath, indexLimits)
    expect([...updated.blocks]).toEqual([...rebuilt.blocks])
    expect([...updated.definitions]).toEqual([...rebuilt.definitions])
    expect([...updated.references]).toEqual([...rebuilt.references])
    expect(updated.calls).toEqual(rebuilt.calls)
    expect(updated.footnoteOrder).toEqual(rebuilt.footnoteOrder)
    expect(updated.nodes).toBe(rebuilt.nodes)
    updated.assertBase(result.source.identity, after)
    inspection.release()
    context.owner.commit(prepared)
    const current = context.owner.capture()
    expect(capturedValue(current.reader, rootPath)).toEqual(expected)
    expect(capturedValue(current.reader, ['document'])).toEqual({
      ...expectedDocument,
      timings: metadata.timings,
    })
    expect(capturedValue(context.capture.reader, rootPath)).toEqual(context.document.root)
    current.release()
    indexHold.release()
    patchHold.release()
    metadataHold.release()
    updatedHold.release()
    expect(context.owner.stats.readers).toBe(0)
    expect(result.retainedBytes).toBeLessThanOrEqual(limits.retained)
    expect(result.stagingBytes).toBeLessThanOrEqual(limits.staging)
    expect(result.inputBytesUpperBound).toBeLessThanOrEqual(limits.bytes)
    return result
  } finally {
    context.close()
  }
}
const replace = (source: string, text: string, insert: string): FragmentChange => ({
  from: source.indexOf(text),
  to: source.indexOf(text) + text.length,
  insert,
})

describe('context-verified Markdown block reparsing', () => {
  it.each([
    ['# Before\n\nOrdinary writing here.\n\n# After\n', 'writing', 'longer edited prose'],
    ['First.\n\nOrdinary **writing** here.\n\nLater.\n', 'writing', 'edits'],
    [
      'First.\n\n> > > Nested writing with [link][r].\n\nAfter.\n\n[r]: /r\n',
      'writing',
      '中文𐐀 prose',
    ],
    ['# Before\n\n- First writing\n- Second\n\nAfter.\n', 'writing', 'shorter'],
    ['# Before\n\n- [x] Task writing\n- Other\n\nAfter.\n', 'writing', 'new words'],
    ['# Before\n\n## Heading writing\n\nAfter.\n', 'writing', 'more prose'],
    ['First.\r\n\r\nOrdinary writing\r\ncontinues.\r\n\r\nAfter.\r\n', 'writing', '中文 edits'],
    ['First.\r\rOrdinary writing\rcontinues.\r\rAfter.\r', 'writing', 'short'],
    ['First.\n\nWriting 𐐀 now.\n\nAfter.\n', '𐐀', '字'],
    ['First.\n\nEntity &#97; writing.\n\nAfter.\n', '97', '98'],
    [
      'One[^a].\n\nOrdinary writing [r].\n\nTwo[^b].\n\n[^a]: A\n[^b]: B\n[r]: /r\n',
      'writing',
      'edited words',
    ],
    ['First.\n\n> Nested writing\n>\n> [r]: /inside\n\nLater [r].\n', 'writing', 'longer words'],
  ])('matches every fresh-parse field and projection after changing %j', (source, text, insert) => {
    verify(source, replace(source, text, insert))
  })

  it.each([
    '',
    '   ',
    '\n\n',
    'Ordinary writing',
    'Ordinary writing\n',
    '# Heading\n',
    '> Quoted writing\n\n',
    '- List writing\n\n',
    '[r]: /r\n',
    'Body [r].\n\n[r]: /r\n',
    'Note[^n].\n\n[^n]: Body\n\n',
  ])('preserves EOF typing and root end positions: %j', (source) => {
    verify(source, { from: source.length, to: source.length, insert: 'abc中文𐐀' })
  })

  it('keeps inserted/deleted UTF-16 offsets exact throughout a multiline suffix', () => {
    const source =
      '# Before\n\nWords here.\n\n> Later **bold** and [r].\n\n| A | B |\n| - | - |\n| a | b |\n\n[r]: /r\n'
    for (const insert of ['longer 中文𐐀 prose', 'X', ''])
      verify(source, replace(source, 'Words', insert))
  })

  it('forces the whole-source GFM grammar even when the selected slice has no markers', () => {
    const source = '- First writing\n- Second\n\nOther [r].\n\n[r]: /r\n'
    verify(source, replace(source, 'writing', 'edits'))
    verify(source, replace(source, 'writing', 'edits'), 'commonmark')
  })

  it.each([
    ['Ordinary writing.', 'writing', '[new]', 'grammar'],
    ['Ordinary writing.', 'writing', 'two\nlines', 'syntax'],
    ['[reference]\n\n[reference]: /r\n', 'reference', 'other', 'dependency'],
    ['Word.\n\n```md\nwriting\n```\n', 'writing', 'edits', 'boundary'],
    ['Word.\n\n$$\nwriting\n$$\n', 'writing', 'edits', 'boundary'],
    ['Word.\n\n<div>writing</div>\n', 'writing', 'edits', 'boundary'],
    ['---\ntitle: writing\n---\n\nBody.\n', 'writing', 'edits', 'boundary'],
    ['Word.\n\n| A | B |\n| - | - |\n| writing | a |\n', 'writing', 'edits', 'boundary'],
    ['Note[^n].\n\n[^n]: writing\n', 'writing', 'edits', 'boundary'],
    ['# Heading\nwriting\n', 'writing', 'edits', 'boundary'],
    ['[foo]: /url\nbar\n===\n[foo]\n', 'bar', 'word', 'boundary'],
    ['Writing `literal` here.', 'literal', 'edits', 'syntax'],
    ['Writing $literal$ here.', 'literal', 'edits', 'syntax'],
    ['A [label](/destination).', 'destination', 'other', 'syntax'],
    ['Word [un*foo*].\n\n[un*bar*]: /r\n', 'foo', 'bar', 'dependency'],
  ])('requires an explicit full parse for unsupported %j', (source, text, insert, reason) => {
    const context = fixture(source)
    try {
      expect(context.run(replace(source, text, insert))).toEqual({ kind: 'full', reason })
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.close()
    }
  })

  it('falls back when an edit changes document-wide grammar selection', () => {
    const before = fixture('See .invalid')
    const after = fixture('See www.invalid')
    try {
      expect(before.run({ from: 4, to: 4, insert: 'www' })).toEqual({
        kind: 'full',
        reason: 'grammar',
      })
      expect(after.run({ from: 4, to: 7, insert: '' })).toEqual({ kind: 'full', reason: 'grammar' })
    } finally {
      before.close()
      after.close()
    }
  })

  it('rejects surrogate splits and preserves the old capture across successful preparation', () => {
    const source = 'Ordinary 😀 writing.\n\nAfter.\n'
    const context = fixture(source)
    try {
      const split = source.indexOf('😀') + 1
      expect(context.run({ from: split, to: split, insert: 'a' })).toEqual({
        kind: 'full',
        reason: 'boundary',
      })
      const before = context.capture.reader.scalar(['document', 'sourceHash'], {
        retained: 1024,
        staging: 1024,
      })
      const result = context.run(replace(source, 'writing', 'longer words'))
      expect(result.kind).toBe('fragment')
      expect(
        context.capture.reader.scalar(['document', 'sourceHash'], {
          retained: 1024,
          staging: 1024,
        }),
      ).toBe(before)
      expect(context.owner.stats.current).toEqual(context.identity)
    } finally {
      context.close()
    }
  })

  it('bounds all caller-owned result data and proof work without publishing partial values', () => {
    const source = 'First.\n\nOrdinary writing here.\n\nAfter.\n'
    const context = fixture(source)
    try {
      const change = replace(source, 'writing', 'longer edits')
      const result = context.run(change)
      expect(result.kind).toBe('fragment')
      if (result.kind !== 'fragment') throw new Error('Missing fragment')
      expect(context.run(change, { retained: result.retainedBytes }).kind).toBe('fragment')
      expect(context.run(change, { retained: result.retainedBytes - 1 })).toEqual({
        kind: 'full',
        reason: 'limit',
      })
      expect(context.run(change, { staging: result.stagingBytes }).kind).toBe('fragment')
      for (const changed of [
        { bytes: 0 },
        { retained: 0 },
        { staging: result.stagingBytes - 1 },
        { nodes: 1 },
        { depth: 1 },
      ])
        expect(context.run(change, changed)).toEqual({ kind: 'full', reason: 'limit' })
      const pending: unknown[] = [result]
      while (pending.length) {
        const value = pending.pop()
        if (value && typeof value === 'object') {
          expect(Object.isFrozen(value)).toBe(true)
          pending.push(...Object.values(value))
        }
      }
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.close()
    }
  })

  it('cleans up readers when a captured subtree exceeds the session reader cap', () => {
    const source = '> > Nested writing.\n\nAfter.\n'
    const context = fixture(source)
    const held = Array.from({ length: 127 }, () =>
      context.capture.reader.elements(['document', 'root', 'children']),
    )
    const before = context.owner.stats
    try {
      expect(context.run(replace(source, 'writing', 'edits'))).toEqual({
        kind: 'full',
        reason: 'limit',
      })
      expect(context.owner.stats).toEqual(before)
    } finally {
      for (const iterator of held) iterator.return()
      context.close()
    }
  })

  it('falls back when deleting a prose prefix exposes excessively nested container syntax', () => {
    const source = `> x ${'> '.repeat(500)}word\n\nAfter.\n`
    const context = fixture(source)
    const before = context.owner.stats
    try {
      expect(context.run(replace(source, 'x ', ''))).toEqual({ kind: 'full', reason: 'limit' })
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.close()
    }
  })

  it('rejects stale identities, inconsistent source edits, released captures and invalid limits', () => {
    const source = 'Ordinary writing.'
    const context = fixture(source)
    const change = replace(source, 'writing', 'edits')
    try {
      expect(() => context.run(change, {}, 'Different text')).toThrow('source/change mismatch')
      for (const changed of [{ from: -1 }, { to: source.length + 1 }, { from: NaN }, { to: 0 }])
        expect(() => context.run({ ...change, ...changed })).toThrow()
      for (const key of Object.keys(limits) as (keyof FragmentLimits)[])
        for (const value of [undefined, -1, NaN, Infinity, 0.5])
          expect(() => context.run(change, { [key]: value })).toThrow('limits')
      for (const changed of [
        { bytes: 65537 },
        { retained: 17 * MiB },
        { staging: 9 * MiB },
        { nodes: 800001 },
        { depth: 65 },
      ])
        expect(() => context.run(change, changed)).toThrow('limits')
      context.capture.release()
      expect(() => context.run(change)).toThrow('released')
    } finally {
      context.close()
    }
  })

  it('binds local parsing to the exact generation, document, versions, options and newer revision', () => {
    const source = 'Ordinary writing.'
    const context = fixture(source)
    const change = replace(source, 'writing', 'edits')
    const after = 'Ordinary edits.'
    const result = { ...context.identity, revision: 1, sourceHash: sourceHash(after) }
    try {
      for (const key of Object.keys(result) as (keyof PackedIdentity)[]) {
        if (key === 'sourceHash') continue // PackedSource itself validates the exact hash.
        const value = result[key]
        const changed = { ...result, [key]: typeof value === 'number' ? 0 : `${value}!` }
        expect(() =>
          reparseMarkdownFragment(
            {
              capture: context.capture,
              dependencies: context.dependencies,
              baseSource: source,
              source: new PackedSource(changed, after),
              change,
              root: ['document', 'root'],
              syntax: 'manuslip',
            },
            limits,
          ),
        ).toThrow('identity mismatch')
      }
      expect(() =>
        reparseMarkdownFragment(
          {
            capture: context.capture,
            dependencies: context.dependencies,
            baseSource: 'Different base',
            source: new PackedSource(result, after),
            change,
            root: ['document', 'root'],
            syntax: 'manuslip',
          },
          limits,
        ),
      ).toThrow('base mismatch')
    } finally {
      context.close()
    }
  })

  for (const example of examples.filter((example) => example.markdown.includes('foo')))
    it(`agrees with a fresh whole parse or explicitly falls back: CommonMark ${example.example}`, () => {
      const source = example.markdown
      const context = fixture(source, 'commonmark')
      const change = replace(source, 'foo', 'longerprose')
      try {
        const result = context.run(change)
        if (result.kind === 'fragment') {
          const after = source.slice(0, change.from) + change.insert + source.slice(change.to)
          expect(apply(context.document.root, result)).toEqual(
            parseMarkdown(after, 'commonmark').root,
          )
          const oracle = fixture(after, 'commonmark')
          try {
            const updated = context.dependencies.advance(result, {
              retained: 8 * MiB,
              staging: 8 * MiB,
              nodes: 800000,
              depth: 64,
            })
            expect([...updated.blocks]).toEqual([...oracle.dependencies.blocks])
            expect([...updated.definitions]).toEqual([...oracle.dependencies.definitions])
            expect([...updated.references]).toEqual([...oracle.dependencies.references])
            expect(updated.calls).toEqual(oracle.dependencies.calls)
            expect(updated.nodes).toBe(oracle.dependencies.nodes)
            const metadata = describeDocumentFragment(
              {
                capture: context.capture,
                dependencies: context.dependencies,
                fragment: result,
                document: ['document'],
                parseMs: 1,
              },
              {
                retained: 8 * MiB,
                staging: 8 * MiB,
                nodes: 800000,
                depth: 64,
              },
            )
            const metadataOracle = <T extends { from: number; to: number }>(
              before: T[],
              replacement: { start: number; remove: number; values: readonly T[] },
            ) => [
              ...before.slice(0, replacement.start),
              ...replacement.values,
              ...before.slice(replacement.start + replacement.remove).map((value) => ({
                ...value,
                from: value.from + result.suffixOffset,
                to: value.to + result.suffixOffset,
              })),
            ]
            expect(metadataOracle(context.document.blocks, metadata.blocks)).toEqual(
              oracle.document.blocks,
            )
            expect(metadataOracle(context.document.outline, metadata.outline)).toEqual(
              oracle.document.outline,
            )
            expect(metadata.counts).toEqual(oracle.document.counts)
          } finally {
            oracle.close()
          }
        } else expect(result.reason).toBeTruthy()
        expect(context.owner.stats.readers).toBe(0)
      } finally {
        context.close()
      }
    })
})
