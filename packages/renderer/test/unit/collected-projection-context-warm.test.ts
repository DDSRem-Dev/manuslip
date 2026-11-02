import type { Nodes } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { PackedDocumentBaseline } from '../../../core/src/packing-document-baseline'
import type { PackedOperation } from '../../../core/src/packing-revision'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { PackedWordBaseline } from '../../../core/src/packing-word-baseline'
import { PackedWordBuffer } from '../../../core/src/packing-word-buffer'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { collectProjectionContext } from '../../src/collected-projection-context'
import { rendererVersion } from '../../src/index'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import { inspectPackedProjectionContext } from '../../src/packed-projection-context'
import * as definitions from '../../src/packed-projection-definitions'
import { validatePackedSnapshot } from '../../src/packing-validate-snapshot'
import { renderProjectionLayout } from '../../src/projection-layout'

vi.mock('../../src/packed-projection-definitions', { spy: true })

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const body = `Plain first.

Body [r][ref] with note[^a], repeated[^a], and call[^b].

> [nested]: /nested
>
> Nested [link][nested].

[ref]: /first
[ref]: /other

[^a]: First *note* and nested call[^b].

    [inner]: /inside

[^b]: Second note 界😀.

[^unused]: ![Picture][inner] and $x^2$.

~~~js
const value = 1
~~~

Last [reference][inner].
`

function summary(root: Nodes) {
  const texts: string[] = []
  let nodes = 0,
    depth = 0
  const visit = (node: Nodes, level: number) => {
    nodes++
    depth = Math.max(depth, level)
    if (node.type === 'text') texts.push(node.value)
    if ('children' in node) for (const child of node.children) visit(child, level + 1)
  }
  visit(root, 1)
  return { nodes, depth, prose: texts.join(' ') }
}

function paired(text = body, syntax: 'commonmark' | 'manuslip' = 'manuslip') {
  const document = parseMarkdown(text, syntax)
  const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'warm-collected-context',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession(sessionLimits)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ document, projection, layout }, limits.staging),
    ),
  )
  const capture = owner.capture()
  const documentBaseline = finishPackedSteps(
    PackedDocumentBaseline.create(capture, source, ['document'], limits),
  )
  const words = finishPackedSteps(
    PackedWordBaseline.create(capture, source, ['document'], limits, documentBaseline),
  )
  const projectionBaseline = finishPackedSteps(
    PackedProjectionBaseline.create(capture, source, [], options, limits, documentBaseline),
  )
  if (!documentBaseline || !words || !projectionBaseline) throw new Error('Missing warm baseline')
  function delta(
    value: unknown = {},
    operations: (record: (field: string) => number) => PackedOperation[] = () => [],
    after = text,
  ) {
    const next = new PackedSource(
      { ...source.identity, revision: 1, sourceHash: sourceHash(after) },
      after,
    )
    const payload = packValue(value, limits.staging)
    const arena = PackedArena.open(payload.slice(0), sessionLimits)
    const record = (name: string) => {
      const found = arena.field(arena.root, name)
      if (found === undefined) throw new Error('Missing delta record')
      return found
    }
    const prepared = owner.prepareDelta(owner.beginPrepared(next), {
      base: source.identity,
      baseSource: text,
      result: next.identity,
      payload,
      operations: operations(record),
    })
    return { source: next, capture: owner.capturePrepared(prepared), prepared }
  }
  function validate(next: ReturnType<typeof delta>, budget = limits) {
    return validatePackedSnapshot(
      next.capture,
      next.source,
      [],
      options,
      budget,
      projectionBaseline,
      documentBaseline,
      words,
    )
  }
  return { owner, capture, source, document, documentBaseline, words, delta, validate }
}

describe('context collected during complete warm snapshot validation', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'preserves every CommonMark example and its complete Intl input in %s',
    (syntax) => {
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      try {
        for (const example of examples) {
          const context = paired(example.markdown, syntax)
          try {
            const next = context.delta()
            const before = context.owner.stats
            segment.mockClear()
            finishPackedSteps(context.validate(next))
            expect(segment).toHaveBeenCalledExactlyOnceWith(summary(context.document.root).prose)
            expect(context.owner.stats).toEqual(before)
          } finally {
            context.owner.dispose()
          }
        }
      } finally {
        segment.mockRestore()
      }
    },
  )

  it('collects the complete ordered context and logical costs without a second definition walk', () => {
    const context = paired()
    const next = context.delta()
    const before = context.owner.stats
    const walk = vi.mocked(definitions.packedProjectionDefinitions)
    type View = {
      values: unknown
      nodes: number
      definitions: number
      calls: number
      units: number
    }
    let actual: View | undefined, expected: View | undefined
    try {
      walk.mockClear()
      finishPackedSteps(context.validate(next))
      expect(walk).not.toHaveBeenCalled()
      finishPackedSteps(
        next.capture.work(
          collectProjectionContext(
            next.capture,
            next.source,
            ['document', 'root'],
            limits,
            function* (collected) {
              yield* collected.borrow(
                next.capture,
                next.source,
                ['document', 'root'],
                limits,
                function* (values, cost) {
                  actual = {
                    values: structuredClone(values),
                    nodes: cost.nodes,
                    definitions: cost.definitions,
                    calls: cost.bodyReferences,
                    units: cost.bodyReferenceUnits,
                  }
                  // Reused document metadata does not certify widget absence.
                  expect(
                    collected.descriptionAbsence(
                      next.capture,
                      next.source,
                      ['document', 'root'],
                      0,
                      next.capture.reader.at(['document', 'root', 'children', 0]),
                    ),
                  ).toBeUndefined()
                  yield
                },
              )
            },
            { document: context.documentBaseline, words: context.words },
          ),
        ),
      )
      finishPackedSteps(
        inspectPackedProjectionContext(
          next.capture,
          next.source,
          ['document', 'root'],
          limits,
          function* (values, cost) {
            expected = {
              values: structuredClone(values),
              nodes: cost.nodes,
              definitions: cost.definitions,
              calls: cost.bodyReferences,
              units: cost.bodyReferenceUnits,
            }
            yield
          },
        ),
      )
      expect(actual).toEqual(expected)
      expect(actual?.definitions).toBeGreaterThan(4)
      expect(actual?.calls).toBe(3)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['definition', 'footnoteDefinition'] as const)(
    'rechecks a changed %s and its global rendering context',
    (type) => {
      const context = paired()
      const after = body.replace(
        type === 'definition' ? '/first' : 'First *note*',
        type === 'definition' ? '/fresh' : 'Fresh *note*',
      )
      const document = parseMarkdown(after)
      const output = renderProjectionLayout(document.root, options, limits.staging)
      const index = context.document.root.children.findIndex((node) => node.type === type)
      const next = context.delta(
        {
          nodes: [document.root.children[index]],
          sourceHash: document.sourceHash,
          blocks: document.blocks,
          counts: document.counts,
          ...output,
        },
        (record) => [
          {
            kind: 'splice',
            path: ['document', 'root', 'children'],
            start: index,
            remove: 1,
            record: record('nodes'),
          },
          ...(['sourceHash', 'blocks', 'counts'] as const).map((field) => ({
            kind: 'replace' as const,
            path: ['document', field],
            record: record(field),
          })),
          ...(['projection', 'layout'] as const).map((field) => ({
            kind: 'replace' as const,
            path: [field],
            record: record(field),
          })),
        ],
        after,
      )
      const before = context.owner.stats
      const walk = vi.mocked(definitions.packedProjectionDefinitions)
      try {
        walk.mockClear()
        finishPackedSteps(context.validate(next))
        expect(walk).not.toHaveBeenCalled()
        finishPackedSteps(validatePackedSnapshot(next.capture, next.source, [], options, limits))
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )

  it('visits every descendant when a reused subtree has no matching text cache', () => {
    const context = paired()
    const next = context.delta()
    const before = context.owner.stats
    const find = vi.spyOn(context.words, 'find').mockReturnValue(undefined)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      finishPackedSteps(context.validate(next))
      expect(segment).toHaveBeenCalledExactlyOnceWith(summary(context.document.root).prose)
      expect(context.owner.stats).toEqual(before)
    } finally {
      find.mockRestore()
      segment.mockRestore()
      context.owner.dispose()
    }
  })

  it('admits a complete 1 MiB dense warm document without restarting validation', () => {
    const paragraph = 'A small paragraph. One more short sentence for the next block.\n\n'
    const context = paired(paragraph.repeat(Math.ceil(MiB / paragraph.length)))
    const next = context.delta()
    const before = context.owner.stats
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    let inspected = false
    try {
      finishPackedSteps(
        next.capture.work(
          collectProjectionContext(
            next.capture,
            next.source,
            ['document', 'root'],
            limits,
            function* (collected) {
              yield* collected.borrow(
                next.capture,
                next.source,
                ['document', 'root'],
                limits,
                function* (values, cost) {
                  expect(values).toEqual([])
                  expect(cost.bodyReferences).toBe(0)
                  inspected = true
                  yield
                },
              )
            },
            { document: context.documentBaseline, words: context.words },
          ),
        ),
      )
      expect(inspected).toBe(true)
      expect(segment).toHaveBeenCalledExactlyOnceWith(summary(context.document.root).prose)
      expect(context.owner.stats).toEqual(before)
    } finally {
      segment.mockRestore()
      context.owner.dispose()
    }
  })

  it('admits the complete join and Intl phase before allocating it or publishing context', () => {
    const context = paired('word '.repeat(90000))
    const next = context.delta()
    const before = context.owner.stats
    const grow = vi.spyOn(PackedWordBuffer.prototype, 'grow')
    const finish = vi.spyOn(PackedWordBuffer.prototype, 'finish')
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    const inspect = vi.fn(function* () {
      yield
    })
    try {
      expect(() =>
        finishPackedSteps(
          next.capture.work(
            collectProjectionContext(
              next.capture,
              next.source,
              ['document', 'root'],
              { ...limits, staging: 4 * MiB },
              inspect,
              { document: context.documentBaseline, words: context.words },
            ),
          ),
        ),
      ).toThrow('Packed words exceed workspace limit')
      expect(grow).toHaveBeenLastCalledWith(summary(context.document.root).prose.length)
      expect(finish).not.toHaveBeenCalled()
      expect(segment).not.toHaveBeenCalled()
      expect(inspect).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      grow.mockRestore()
      finish.mockRestore()
      segment.mockRestore()
      context.owner.dispose()
    }
  })

  it.each(['nodes', 'depth'] as const)('charges the full cached logical %s limit', (key) => {
    const context = paired('Plain first.\n\n> > **Hello 世界**\n\nTail\n')
    const next = context.delta()
    const before = context.owner.stats
    try {
      const cost = summary(context.document.root)
      expect(() =>
        finishPackedSteps(context.validate(next, { ...limits, [key]: cost[key] - 1 })),
      ).toThrow(/node limit|depth limit|traversal limit/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it('releases an oversized context copy and retries ordinary validation', () => {
    const context = paired(`Call[^a].\n\n[^a]: ${'word '.repeat(40000)}`)
    const next = context.delta()
    const before = context.owner.stats
    const walk = vi.mocked(definitions.packedProjectionDefinitions)
    try {
      walk.mockClear()
      finishPackedSteps(context.validate(next))
      expect(walk).toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['cancel', 'words', 'document', 'capture', 'dispose'] as const)(
    'revokes partial cached prose and collected context after %s',
    (action) => {
      const context = paired(`Plain first.\n\n${'word '.repeat(5000)}\n\nCall[^a].\n\n[^a]: note\n`)
      const next = context.delta()
      const before = context.owner.stats
      let borrowed = false
      const original = PackedWordBaseline.prototype.chunk
      const chunk = vi.spyOn(PackedWordBaseline.prototype, 'chunk').mockImplementation(function (
        this: PackedWordBaseline,
        index,
      ) {
        const value = original.call(this, index)
        if (value.length > 1000) borrowed = true
        return value
      })
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      const work = context.validate(next)
      try {
        let advances = 0
        while (!borrowed)
          if (work.next().done || ++advances > 100000) throw new Error('No cached prose borrowed')
        if (action === 'cancel') {
          work.return()
          expect(context.owner.stats).toEqual(before)
        } else if (action === 'words') context.words.close()
        else if (action === 'document') context.documentBaseline.close()
        else if (action === 'capture') next.capture.release()
        else context.owner.dispose()
        if (action === 'words' || action === 'document')
          expect(() => finishPackedSteps(work)).toThrow(/baseline closed/)
        else expect(work.next().done).toBe(true)
        expect(segment).not.toHaveBeenCalled()
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        work.return()
        chunk.mockRestore()
        segment.mockRestore()
        context.owner.dispose()
        expect(context.owner.stats.retainedBytes).toBe(0)
      }
    },
  )
})
