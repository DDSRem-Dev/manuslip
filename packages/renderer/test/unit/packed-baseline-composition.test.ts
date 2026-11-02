import type { Nodes } from 'mdast'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedReadScope } from '../../../core/src/packing-capture'
import { PackedDocumentBaseline } from '../../../core/src/packing-document-baseline'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import * as descriptions from '../../../core/src/packing-validate-descriptions'
import { validatePackedDocument } from '../../../core/src/packing-validate-document'
import type { PackedWordPhase } from '../../../core/src/packing-validate-words'
import * as words from '../../../core/src/packing-validate-words'
import { PackedWordBaseline } from '../../../core/src/packing-word-baseline'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, rendererVersion } from '../../src/index'
import { preparePackedPreviewInput } from '../../src/packed-preview'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import {
  inspectPackedProjectionContext,
  type PackedProjectionContextCost,
} from '../../src/packed-projection-context'
import { packedDocumentContextPrune } from '../../src/packed-projection-definitions'
import * as projectionValidation from '../../src/packing-validate-output'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const capacity = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back',
}
const extension =
  '# Heading 😀\r\n\r\nProse [link][r] ![image](local.png) and [^n].\r\n\r\n~~~mermaid\r\ngraph LR; A-->B\r\n~~~\r\n\r\n$$\r\nx^2\r\n$$\r\n\r\n<div>raw</div>\r\n\r\n[r]: https://example.com\r\n[^n]: Footer.\r\n'
function fixture(
  text = extension,
  syntax: 'commonmark' | 'manuslip' = 'manuslip',
  render = options,
) {
  const document = parseMarkdown(text, syntax)
  const { projection, layout } = renderProjectionLayout(document.root, render, limits.staging)
  const snapshot = { document, projection, layout }
  const forged = structuredClone(snapshot)
  forged.document.counts.words++
  const source = new PackedSource(
    {
      generation: 1,
      revision: 0,
      documentId: 'baseline-composition',
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession(capacity)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ snapshot, forged }, limits.staging),
    ),
  )
  const capture = owner.capture()
  const baseline = finishPackedSteps(
    PackedDocumentBaseline.create(capture, source, ['snapshot', 'document'], limits),
  )
  if (!baseline) throw new Error('Missing document baseline')
  return { owner, source, capture, baseline, snapshot, text }
}
function prose(node: Nodes): string {
  const values: string[] = []
  function visit(node: Nodes) {
    if (node.type === 'text') values.push(node.value)
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(node)
  return values.join(' ')
}
function contextSummary(node: Nodes) {
  let nodes = 0,
    depth = 0,
    free = true,
    references = false
  const visit = (node: Nodes, level: number) => {
    nodes++
    depth = Math.max(depth, level)
    if (
      node.type === 'definition' ||
      node.type === 'footnoteDefinition' ||
      node.type === 'footnoteReference'
    )
      free = false
    if (node.type === 'linkReference' || node.type === 'imageReference') references = true
    if ('children' in node) for (const child of node.children) visit(child, level + 1)
  }
  visit(node, 1)
  return { nodes, depth, free, references }
}
afterEach(() => vi.restoreAllMocks())

describe('independently admitted caches from one complete immutable document validation', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'preserves complete CommonMark output and cached native prose in %s',
    (syntax) => {
      const descriptionSpy = vi.spyOn(descriptions, 'packedDescriptionSteps')
      const wordSpy = vi.spyOn(words, 'validatePackedWords')
      const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
      const projectionSpy = vi.spyOn(projectionValidation, 'packedProjectionOutputSteps')
      for (const example of examples) {
        const context = fixture(example.markdown, syntax)
        descriptionSpy.mockClear()
        wordSpy.mockClear()
        composedWordSpy.mockClear()
        projectionSpy.mockClear()
        try {
          const wordCache = finishPackedSteps(
            PackedWordBaseline.create(
              context.capture,
              context.source,
              ['snapshot', 'document'],
              limits,
              context.baseline,
            ),
          )
          const projection = finishPackedSteps(
            PackedProjectionBaseline.create(
              context.capture,
              context.source,
              ['snapshot'],
              options,
              limits,
              context.baseline,
            ),
          )
          expect(wordCache).toBeDefined()
          expect(projection).toBeDefined()
          expect(descriptionSpy).not.toHaveBeenCalled()
          expect(wordSpy).not.toHaveBeenCalled()
          expect(composedWordSpy).not.toHaveBeenCalled()
          expect(projectionSpy).toHaveBeenCalledOnce()
          for (let index = 0; index < context.snapshot.document.root.children.length; index++) {
            const node = context.capture.reader.at([
              'snapshot',
              'document',
              'root',
              'children',
              index,
            ])
            const cached = wordCache?.find(node)
            expect(cached).toBeDefined()
            const native = context.snapshot.document.root.children[index]
            if (!native) throw new Error('Missing native child')
            expect([...(cached?.chunks ?? [])].join('')).toBe(prose(native))
            const summary = contextSummary(native)
            const proof = context.baseline.contextFree(node)
            const projected = projection?.find(node, true)
            if (summary.free) {
              expect(proof).toMatchObject({
                nodes: summary.nodes,
                depth: summary.depth,
                references: summary.references,
              })
              // Overlapping top-level source ranges (for example setext definitions)
              // deliberately disable the entire projection subtree cache.
              if (projected) {
                expect(projected.block).toMatchObject({
                  traversal: { nodes: summary.nodes, depth: summary.depth },
                  contextual: summary.references,
                })
                expect(projection?.find(node) !== undefined).toBe(!summary.references)
              }
            } else {
              expect(proof).toBeUndefined()
              expect(projected).toBeUndefined()
            }
          }
          const input = finishPackedSteps(
            preparePackedPreviewInput(
              context.capture,
              context.source,
              ['snapshot'],
              options,
              limits,
              { projection, document: context.baseline, words: wordCache },
            ),
          )
          try {
            expect(input?.value.input.document.blocks).toEqual(context.snapshot.document.blocks)
            expect(input?.value.input.document.outline).toEqual(context.snapshot.document.outline)
            expect(input?.value.input.document.counts).toEqual(context.snapshot.document.counts)
            expect(input?.value.input.projection).toEqual({
              blocks: context.snapshot.projection.blocks,
              renderMs: context.snapshot.projection.renderMs,
            })
          } finally {
            input?.release()
          }
        } finally {
          context.owner.dispose()
        }
      }
    },
  )

  it.each(['reuse', 'close during construction'] as const)(
    'matches independently classified nested reference metadata with %s',
    (mode) => {
      const context = fixture(
        `${'> '.repeat(24)}deep [link][r] and ![image][i]\n\nplain\n\n[missing][none]\n\n[r]: /first\n\n[r]: /ignored\n\n[i]: /image\n\ncall[^a]\n\n[^a]: note [link][r]\n`,
      )
      const build = (borrow: boolean) =>
        PackedProjectionBaseline.create(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
          borrow ? context.baseline : undefined,
        )
      const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
      let control: PackedProjectionBaseline | undefined,
        composed: PackedProjectionBaseline | undefined
      const before = context.owner.stats
      try {
        control = finishPackedSteps(build(false))
        if (!control) throw new Error('Missing control projection baseline')
        const reads = scalar.mock.calls.filter(([path]) => path[0] === 'type').length
        scalar.mockClear()
        const proof = vi.spyOn(context.baseline, 'contextFree')
        const work = build(true)
        let closed = false
        while (true) {
          const step = work.next()
          if (
            mode === 'close during construction' &&
            !closed &&
            proof.mock.results.some((r) => r.value)
          ) {
            context.baseline.close()
            closed = true
          }
          if (step.done) {
            composed = step.value
            break
          }
        }
        if (!composed) throw new Error('Missing composed projection baseline')
        if (mode === 'close during construction') expect(closed).toBe(true)
        else {
          expect(scalar.mock.calls.filter(([path]) => path[0] === 'type').length).toBeLessThan(
            reads,
          )
          expect(proof.mock.results.some((r) => r.value?.references === true)).toBe(true)
        }
        for (const node of context.capture.reader.elements([
          'snapshot',
          'document',
          'root',
          'children',
        ])) {
          expect(composed.find(node, true)).toEqual(control.find(node, true))
          expect(composed.find(node)).toEqual(control.find(node))
        }
        control.close()
        composed.close()
        if (mode === 'reuse') expect(context.owner.stats).toEqual(before)
        else expect(context.owner.stats.readers).toBe(0)
      } finally {
        composed?.close()
        control?.close()
        context.owner.dispose()
      }
    },
  )

  it('preserves context order, duplicates, footnote calls and logical costs when pruning the exact document', () => {
    const context = fixture(
      `${'> '.repeat(30)}deep [link][r]\n\nplain\n\n[r]: /first\n\n[r]: /ignored\n\ncall[^a] and [^a]\n\n[^a]: note [r][r] and [^b]\n\n[^b]: second\n`,
    )
    const root = ['snapshot', 'document', 'root']
    const prune = packedDocumentContextPrune(
      context.capture,
      context.source,
      root,
      limits,
      context.baseline,
    )
    if (!prune) throw new Error('Missing exact document context proof')
    const expected = context.snapshot.document.root.children.filter(
      (node) => node.type === 'definition' || node.type === 'footnoteDefinition',
    )
    const before = context.owner.stats
    const costs: PackedProjectionContextCost[] = []
    const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
    const proof = vi.spyOn(context.baseline, 'contextFree')
    const inspect = (reuse: boolean) =>
      finishPackedSteps(
        inspectPackedProjectionContext(
          context.capture,
          context.source,
          root,
          limits,
          function* (definitions, cost) {
            expect(definitions).toEqual(expected)
            costs.push(cost)
            yield
          },
          reuse ? prune : undefined,
        ),
      )
    try {
      inspect(false)
      const reads = scalar.mock.calls.filter(([path]) => path[0] === 'type').length
      scalar.mockClear()
      inspect(true)
      expect(proof.mock.results.some((result) => result.value?.nodes > 30)).toBe(true)
      expect(scalar.mock.calls.filter(([path]) => path[0] === 'type').length).toBeLessThan(reads)
      expect(costs[1]).toEqual(costs[0])
      expect(context.owner.stats).toEqual(before)
      const work = inspectPackedProjectionContext(
        context.capture,
        context.source,
        root,
        limits,
        function* (definitions, cost) {
          expect(definitions).toEqual(expected)
          expect(cost).toEqual(costs[0])
          yield
        },
        (node) => {
          const result = prune(node)
          if (result) context.baseline.close()
          return result
        },
      )
      finishPackedSteps(work)
      expect(() => context.baseline.assertOpen()).toThrow('closed')
      expect(prune(context.capture.reader)).toBeUndefined()
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['path', 'root suffix', 'source copy', 'owner', 'revision', 'budget', 'closed'] as const)(
    'requires exact document provenance before context pruning: %s',
    (kind) => {
      const context = fixture()
      let capture = context.capture,
        source = context.source
      let other: PackedSession | undefined
      const root = ['snapshot', 'document', 'root']
      const budget = { ...limits }
      try {
        if (kind === 'path') root[0] = 'forged'
        if (kind === 'root suffix') root.pop()
        if (kind === 'source copy') source = new PackedSource(source.identity, source.text)
        if (kind === 'budget') budget.depth--
        if (kind === 'closed') context.baseline.close()
        if (kind === 'owner') {
          other = new PackedSession(capacity)
          other.commit(
            other.prepareFull(
              other.beginPrepared(source),
              source.identity,
              packValue({ snapshot: context.snapshot }, limits.staging),
            ),
          )
          capture = other.capture()
        }
        if (kind === 'revision') {
          source = new PackedSource({ ...source.identity, revision: 1 }, source.text)
          const prepared = context.owner.prepareDelta(context.owner.beginPrepared(source), {
            base: context.source.identity,
            baseSource: context.text,
            result: source.identity,
            payload: packValue(null, limits.staging),
            operations: [],
          })
          capture = context.owner.capturePrepared(prepared)
        }
        expect(
          packedDocumentContextPrune(capture, source, root, budget, context.baseline),
        ).toBeUndefined()
      } finally {
        other?.dispose()
        context.owner.dispose()
      }
    },
  )

  it('charges certified descendants against the current context traversal limits', () => {
    const context = fixture(`${'> '.repeat(12)}nested prose\n`)
    const root = ['snapshot', 'document', 'root']
    const prune = packedDocumentContextPrune(
      context.capture,
      context.source,
      root,
      limits,
      context.baseline,
    )
    const summary = contextSummary(context.snapshot.document.root)
    const before = context.owner.stats
    try {
      for (const reuse of [false, true])
        for (const change of [
          { nodes: summary.nodes, depth: summary.depth, valid: true },
          { nodes: summary.nodes - 1, depth: summary.depth, valid: false },
          { nodes: summary.nodes, depth: summary.depth - 1, valid: false },
        ]) {
          const run = () =>
            finishPackedSteps(
              inspectPackedProjectionContext(
                context.capture,
                context.source,
                root,
                { ...limits, nodes: change.nodes, depth: change.depth },
                function* (_, cost) {
                  expect(cost.nodes).toBe(summary.nodes)
                  yield
                },
                reuse ? prune : undefined,
              ),
            )
          if (change.valid) run()
          else expect(run).toThrow('traversal limit')
          expect(context.owner.stats).toEqual(before)
        }
    } finally {
      context.owner.dispose()
    }
  })

  it.each([false, true])('keeps independent extension output with rawHtml=%s', (rawHtml) => {
    const render = { ...options, rawHtml },
      context = fixture(extension, 'manuslip', render)
    try {
      const wordCache = finishPackedSteps(
        PackedWordBaseline.create(
          context.capture,
          context.source,
          ['snapshot', 'document'],
          limits,
          context.baseline,
        ),
      )
      const projection = finishPackedSteps(
        PackedProjectionBaseline.create(
          context.capture,
          context.source,
          ['snapshot'],
          render,
          limits,
          context.baseline,
        ),
      )
      context.baseline.close()
      expect(() => wordCache?.assertOpen()).not.toThrow()
      expect(() => projection?.assertOpen()).not.toThrow()
      const input = finishPackedSteps(
        preparePackedPreviewInput(context.capture, context.source, ['snapshot'], render, limits, {
          projection,
        }),
      )
      try {
        expect(input?.value.input.projection).toEqual({
          blocks: context.snapshot.projection.blocks,
          renderMs: context.snapshot.projection.renderMs,
        })
        expect(input?.value.input.document.counts).toEqual(context.snapshot.document.counts)
      } finally {
        input?.release()
      }
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['html', 'layout', 'widgets'] as const)(
    'still rejects forged %s when the document alone has a complete certificate',
    (kind) => {
      const context = fixture()
      const value = structuredClone(context.snapshot)
      if (kind === 'html') value.projection.html += '<p>forged</p>'
      else if (kind === 'widgets') value.projection.blocks.pop()
      else value.layout = { ...value.layout, htmlLength: value.layout.htmlLength + 1 }
      context.owner.dispose()
      const owner = new PackedSession(capacity)
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(context.source),
          context.source.identity,
          packValue({ snapshot: value }, limits.staging),
        ),
      )
      const capture = owner.capture()
      const baseline = finishPackedSteps(
        PackedDocumentBaseline.create(capture, context.source, ['snapshot', 'document'], limits),
      )
      const before = owner.stats
      const descriptionSpy = vi.spyOn(descriptions, 'packedDescriptionSteps')
      const wordSpy = vi.spyOn(words, 'validatePackedWords')
      const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
      try {
        expect(() =>
          finishPackedSteps(
            PackedProjectionBaseline.create(
              capture,
              context.source,
              ['snapshot'],
              options,
              limits,
              baseline,
            ),
          ),
        ).toThrow()
        expect(descriptionSpy).not.toHaveBeenCalled()
        expect(wordSpy).not.toHaveBeenCalled()
        expect(composedWordSpy).not.toHaveBeenCalled()
        expect(owner.stats).toEqual(before)
      } finally {
        owner.dispose()
      }
    },
  )

  it('does not reuse whole-document validation for a forged alternative path', () => {
    const context = fixture()
    const wordSpy = vi.spyOn(words, 'validatePackedWords')
    const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          PackedWordBaseline.create(
            context.capture,
            context.source,
            ['forged', 'document'],
            limits,
            context.baseline,
          ),
        ),
      ).toThrow()
      expect(wordSpy).toHaveBeenCalledOnce()
      expect(composedWordSpy).not.toHaveBeenCalled()
      expect(() =>
        finishPackedSteps(
          validatePackedDocument(
            context.capture,
            context.source,
            ['forged', 'document'],
            limits,
            undefined,
            context.baseline,
          ),
        ),
      ).toThrow()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['same identity, different revision', 'foreign owner', 'later revision'])(
    'rejects forged words with %s',
    (kind) => {
      const context = fixture()
      const owner = kind === 'foreign owner' ? new PackedSession(capacity) : context.owner
      const source =
        kind === 'later revision'
          ? new PackedSource({ ...context.source.identity, revision: 1 }, context.text)
          : context.source
      const document = structuredClone(context.snapshot.document)
      document.counts.words++
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ snapshot: { document } }, limits.staging),
        ),
      )
      const capture = owner.capture(),
        before = owner.stats
      const wordSpy = vi.spyOn(words, 'validatePackedWords')
      const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
      try {
        expect(() =>
          finishPackedSteps(
            PackedWordBaseline.create(
              capture,
              source,
              ['snapshot', 'document'],
              limits,
              context.baseline,
            ),
          ),
        ).toThrow()
        expect(wordSpy).toHaveBeenCalledOnce()
        expect(composedWordSpy).not.toHaveBeenCalled()
        expect(owner.stats).toEqual(before)
      } finally {
        owner.dispose()
        context.owner.dispose()
      }
    },
  )

  it.each([
    { nodes: 1 },
    { depth: 1 },
    { retained: 1 },
    { staging: 1 },
    { nodes: Number.NaN },
    { retained: 65 * MiB },
    { staging: 9 * MiB },
    { depth: 129 },
    { nodes: 800001 },
  ])('preserves independent validation of stricter or invalid limits %j', (change) => {
    const context = fixture(),
      wordSpy = vi.spyOn(words, 'validatePackedWords')
    const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
    const descriptionSpy = vi.spyOn(descriptions, 'packedDescriptionSteps')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          PackedWordBaseline.create(
            context.capture,
            context.source,
            ['snapshot', 'document'],
            { ...limits, ...change },
            context.baseline,
          ),
        ),
      ).toThrow()
      expect(wordSpy).toHaveBeenCalledOnce()
      expect(composedWordSpy).not.toHaveBeenCalled()
      expect(() =>
        finishPackedSteps(
          validatePackedDocument(
            context.capture,
            context.source,
            ['snapshot', 'document'],
            { ...limits, ...change },
            undefined,
            context.baseline,
          ),
        ),
      ).toThrow()
      expect(descriptionSpy).toHaveBeenCalledOnce()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it('fully validates a stricter budget that still admits the document', () => {
    const context = fixture(),
      wordSpy = vi.spyOn(words, 'validatePackedWords')
    const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
    const descriptionSpy = vi.spyOn(descriptions, 'packedDescriptionSteps')
    try {
      const cache = finishPackedSteps(
        PackedWordBaseline.create(
          context.capture,
          context.source,
          ['snapshot', 'document'],
          { ...limits, nodes: limits.nodes - 1 },
          context.baseline,
        ),
      )
      expect(cache).toBeDefined()
      finishPackedSteps(
        validatePackedDocument(
          context.capture,
          context.source,
          ['snapshot', 'document'],
          { ...limits, nodes: limits.nodes - 1 },
          undefined,
          context.baseline,
        ),
      )
      expect(descriptionSpy).toHaveBeenCalledOnce()
      expect(wordSpy).toHaveBeenCalledOnce()
      expect(composedWordSpy).toHaveBeenCalledOnce()
    } finally {
      context.owner.dispose()
    }
  })

  it('preserves actual word phase observation and invalid observer rejection', () => {
    const context = fixture(),
      phases: PackedWordPhase[] = []
    const before = context.owner.stats
    try {
      finishPackedSteps(
        validatePackedDocument(
          context.capture,
          context.source,
          ['snapshot', 'document'],
          limits,
          (phase) => phases.push(phase),
          context.baseline,
        ),
      )
      expect(phases).toEqual(['scan', 'read', 'join', 'segment', 'count'])
      expect(() =>
        finishPackedSteps(
          validatePackedDocument(
            context.capture,
            context.source,
            ['snapshot', 'document'],
            limits,
            3 as unknown as (phase: PackedWordPhase) => void,
            context.baseline,
          ),
        ),
      ).toThrow(/observer/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it('rejects foreign source objects and copies queued document paths and budgets', () => {
    const context = fixture(),
      path = ['snapshot', 'document'],
      budget = { ...limits }
    const work = PackedWordBaseline.create(
      context.capture,
      context.source,
      path,
      budget,
      context.baseline,
    )
    path[0] = 'forged'
    budget.nodes = 0
    const wordSpy = vi.spyOn(words, 'validatePackedWords')
    const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
    try {
      expect(finishPackedSteps(work)).toBeDefined()
      expect(wordSpy).not.toHaveBeenCalled()
      expect(composedWordSpy).not.toHaveBeenCalled()
      expect(() =>
        finishPackedSteps(
          PackedWordBaseline.create(
            context.capture,
            new PackedSource(context.source.identity, context.text),
            ['snapshot', 'document'],
            limits,
            context.baseline,
          ),
        ),
      ).toThrow()
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['word', 'projection'] as const)(
    'independently admits %s metadata after proof matching',
    (kind) => {
      const context = fixture()
      const bytes = capacity.retained - context.owner.stats.retainedBytes - 1024
      const hold = context.owner.retain({ resources: () => [{ key: {}, bytes }] })
      const before = context.owner.stats
      const wordSpy = vi.spyOn(words, 'validatePackedWords')
      const composedWordSpy = vi.spyOn(words, 'packedWordSteps')
      const descriptionSpy = vi.spyOn(descriptions, 'packedDescriptionSteps')
      try {
        expect(() =>
          finishPackedSteps<PackedWordBaseline | PackedProjectionBaseline | undefined>(
            kind === 'word'
              ? PackedWordBaseline.create(
                  context.capture,
                  context.source,
                  ['snapshot', 'document'],
                  limits,
                  context.baseline,
                )
              : PackedProjectionBaseline.create(
                  context.capture,
                  context.source,
                  ['snapshot'],
                  options,
                  limits,
                  context.baseline,
                ),
          ),
        ).toThrow(/scope limit/)
        expect(wordSpy).not.toHaveBeenCalled()
        expect(composedWordSpy).not.toHaveBeenCalled()
        expect(descriptionSpy).not.toHaveBeenCalled()
        expect(context.owner.stats).toEqual(before)
      } finally {
        hold.release()
        context.owner.dispose()
      }
    },
  )

  it.each(['word', 'projection'] as const)(
    'keeps %s construction independent of a closed borrowed baseline',
    (kind) => {
      const context = fixture(),
        capture = context.capture.retain()
      const work =
        kind === 'word'
          ? PackedWordBaseline.create(
              capture,
              context.source,
              ['snapshot', 'document'],
              limits,
              context.baseline,
            )
          : PackedProjectionBaseline.create(
              capture,
              context.source,
              ['snapshot'],
              options,
              limits,
              context.baseline,
            )
      try {
        expect(work.next().done).toBe(false)
        context.capture.release()
        expect(() => context.baseline.assertOpen()).toThrow(/closed/)
        const cache = finishPackedSteps<PackedWordBaseline | PackedProjectionBaseline | undefined>(
          work,
        )
        expect(cache).toBeDefined()
        expect(() => cache?.assertOpen()).not.toThrow()
        capture.release()
        expect(() => cache?.assertOpen()).toThrow(/closed/)
        expect(context.owner.stats.readers).toBe(0)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each(['return', 'capture', 'owner'] as const)(
    'cleans copied cache construction on %s',
    (action) => {
      const context = fixture(),
        before = context.owner.stats
      const work = PackedWordBaseline.create(
        context.capture,
        context.source,
        ['snapshot', 'document'],
        limits,
        context.baseline,
      )
      try {
        for (let step = 0; step < 10; step++) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        else if (action === 'capture') context.capture.release()
        else context.owner.dispose()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
        else expect(context.owner.stats.readers).toBe(0)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
})
