import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import {
  describeDocumentFragment,
  documentFragmentOperations,
} from '../../../core/src/document-metadata'
import { type FragmentChange, reparseMarkdownFragment } from '../../../core/src/markdown-fragment'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { PackedItemSteps, PackedReadScope } from '../../../core/src/packing-capture'
import { PackedDocumentBaseline } from '../../../core/src/packing-document-baseline'
import { PackedReceiver } from '../../../core/src/packing-receiver'
import type { PackedOperation } from '../../../core/src/packing-revision'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { newPackedToken } from '../../../core/src/packing-token'
import { packedWireVersion } from '../../../core/src/packing-wire'
import { PackedWordBaseline } from '../../../core/src/packing-word-baseline'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { SemanticDependencies } from '../../../core/src/semantic-dependencies'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, rendererVersion } from '../../src/index'
import { PackedHtmlCursor } from '../../src/packed-html-cursor'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import {
  inspectPackedProjectionContext,
  type PackedProjectionContextCost,
} from '../../src/packed-projection-context'
import { PackedSnapshotCertificate } from '../../src/packed-snapshot-certificate'
import { validatePackedSnapshot } from '../../src/packing-validate-snapshot'
import {
  projectionFragmentOperations,
  projectMarkdownFragment,
} from '../../src/projection-fragment'
import { renderProjectionLayout } from '../../src/projection-layout'
import { ProjectionSequence } from '../../src/projection-sequence'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
function fixture(text: string, syntax: 'manuslip' | 'commonmark' = 'manuslip', render = options) {
  const document = parseMarkdown(text, syntax)
  const { projection, layout } = renderProjectionLayout(document.root, render, limits.staging)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'reuse',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
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
  const baseline = finishPackedSteps(
    PackedProjectionBaseline.create(capture, source, [], render, limits),
  )
  if (!baseline) throw new Error('Missing projection baseline')
  function delta(value: unknown, operations: readonly PackedOperation[], after = text) {
    const base = owner.capture()
    try {
      const source = new PackedSource(
        { ...base.identity, revision: base.identity.revision + 1, sourceHash: sourceHash(after) },
        after,
      )
      const prepared = owner.prepareDelta(owner.beginPrepared(source), {
        base: base.identity,
        baseSource: base.sourceResource.text,
        result: source.identity,
        payload: packValue(value, limits.staging),
        operations,
      })
      return { source, prepared, inspection: owner.capturePrepared(prepared) }
    } finally {
      base.release()
    }
  }
  function edit(change: FragmentChange) {
    const current = owner.capture()
    const index = SemanticDependencies.build(
      current,
      current.sourceResource.text,
      ['document', 'root'],
      limits,
    )
    const holds = [owner.retain(index)]
    try {
      const before = current.sourceResource.text
      const after = before.slice(0, change.from) + change.insert + before.slice(change.to)
      const source = new PackedSource(
        {
          ...current.identity,
          revision: current.identity.revision + 1,
          sourceHash: sourceHash(after),
        },
        after,
      )
      const fragment = reparseMarkdownFragment(
        {
          capture: current,
          dependencies: index,
          baseSource: before,
          source,
          change,
          root: ['document', 'root'],
          syntax,
        },
        { ...limits, depth: 64, bytes: 64 * 1024, nodes: 8192 },
      )
      if (fragment.kind !== 'fragment')
        throw new Error(`Unexpected local fallback: ${fragment.reason}`)
      holds.push(owner.retain(fragment))
      const metadata = describeDocumentFragment(
        { capture: current, dependencies: index, fragment, document: ['document'], parseMs: 1 },
        { ...limits, depth: 64 },
      )
      holds.push(owner.retain(metadata))
      const projected = projectMarkdownFragment(
        {
          capture: current,
          dependencies: index,
          fragment,
          root: ['document', 'root'],
          projection: ['projection'],
          layout: ['layout'],
          options: render,
        },
        { ...limits, depth: 64 },
      )
      holds.push(owner.retain(projected))
      const payload = packValue(
        {
          children: fragment.children,
          position: fragment.position,
          blocks: metadata.blocks.values,
          outline: metadata.outline.values,
          counts: metadata.counts,
          sourceHash: source.identity.sourceHash,
          parserVersion: source.identity.parserVersion,
          timings: metadata.timings,
          ...projected.fields,
        },
        limits.staging,
      )
      const arena = PackedArena.open(payload.slice(0), sessionLimits)
      const operations = [
        ...documentFragmentOperations(fragment, metadata, arena, ['document']),
        ...projectionFragmentOperations(fragment, projected, arena),
      ]
      const prepared = owner.prepareDelta(owner.beginPrepared(source), {
        base: current.identity,
        baseSource: before,
        result: source.identity,
        payload,
        operations,
      })
      return { source, prepared, inspection: owner.capturePrepared(prepared) }
    } finally {
      for (const hold of holds) hold.release()
      current.release()
    }
  }
  return { source, owner, capture, baseline, document, projection, layout, delta, edit }
}
describe('verified packed projection reuse', () => {
  for (const primary of [false, true])
    it.each([false, true])(
      `closes every baseline frame and workspace with primary=${primary} and undefined=%s`,
      (undefinedFailure) => {
        const context = fixture('> > > > nested **words**\n\nplain\n')
        context.baseline.close()
        const certificate = finishPackedSteps(
          PackedSnapshotCertificate.create(context.capture, context.source, [], options, limits),
        )
        const before = context.owner.stats
        const frames: PackedItemSteps[] = []
        let spans: PackedItemSteps | undefined
        let rootWalks = 0
        const elements = PackedReadScope.prototype.elementSteps
        const track = vi
          .spyOn(PackedReadScope.prototype, 'elementSteps')
          .mockImplementation(function (this: PackedReadScope, path = []) {
            const items = elements.call(this, path)
            if (path.length === 1 && path[0] === 'blocks' && this.hasField('bodyEnd')) spans = items
            if (path.length === 1 && path[0] === 'children') {
              if (this.scalar(['type'], limits) === 'root') rootWalks++
              else if (rootWalks === 3) frames.push(items)
            }
            return items
          })
        const work = PackedProjectionBaseline.create(
          context.capture,
          context.source,
          [],
          options,
          limits,
          undefined,
          certificate,
        )
        const original = undefinedFailure ? undefined : new Error('Baseline classification failed')
        const failure = primary || !undefinedFailure ? new Error('Frame close failed') : undefined
        const itemReturn = PackedItemSteps.prototype.return
        const closed = new Set<PackedItemSteps>()
        let spanCloses = 0
        const rejectReturn = vi.spyOn(PackedItemSteps.prototype, 'return')
        const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
        try {
          while (frames.length < 3) expect(work.next().done).toBe(false)
          expect(rootWalks).toBe(3)
          expect(spans).toBeDefined()
          rejectReturn.mockImplementation(function (this: PackedItemSteps) {
            const result = itemReturn.call(this)
            if (frames.includes(this)) {
              expect(closed.has(this)).toBe(false)
              closed.add(this)
              if (closed.size === 1) throw failure
              throw new Error('Later frame close failed')
            }
            if (this === spans) {
              spanCloses++
              throw new Error('Span close failed')
            }
            return result
          })
          if (primary)
            scalar.mockImplementation(() => {
              throw original
            })
          let threw = false
          let caught: unknown
          try {
            if (primary) work.next()
            else work.return()
          } catch (error) {
            threw = true
            caught = error
          }
          expect(threw).toBe(true)
          expect(caught).toBe(primary ? original : failure)
          expect(closed.size).toBe(3)
          expect(spanCloses).toBe(1)
          expect(context.owner.stats).toEqual(before)
          for (const items of [...frames, spans])
            expect(items?.next()).toEqual({ done: true, value: undefined })
          expect(work.next()).toEqual({ done: true, value: undefined })
        } finally {
          track.mockRestore()
          rejectReturn.mockRestore()
          scalar.mockRestore()
          work.return()
          certificate?.close()
          context.owner.dispose()
        }
      },
    )

  it.each([false, true])(
    'releases baseline lifetime ownership after its close throws undefined=%s',
    (undefinedFailure) => {
      const context = fixture('plain **words**\n')
      context.baseline.close()
      const before = context.owner.stats
      const baseline = finishPackedSteps(
        PackedProjectionBaseline.create(context.capture, context.source, [], options, limits),
      )
      if (!baseline) throw new Error('Missing fault-test baseline')
      const failure = undefinedFailure ? undefined : new Error('Baseline close failed')
      const close = PackedProjectionBaseline.prototype.close
      const rejectClose = vi
        .spyOn(PackedProjectionBaseline.prototype, 'close')
        .mockImplementation(function (this: PackedProjectionBaseline) {
          close.call(this)
          throw failure
        })
      try {
        let threw = false
        let caught: unknown
        try {
          baseline.close()
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(failure)
        expect(context.owner.stats).toEqual(before)
        expect(() => baseline.assertOpen()).toThrow('closed')
      } finally {
        rejectClose.mockRestore()
        baseline.close()
        context.owner.dispose()
      }
    },
  )

  it.each([false, true])(
    'closes completed layout spans before transferring baseline ownership with undefined=%s',
    (undefinedFailure) => {
      const context = fixture('plain\n')
      context.baseline.close()
      const certificate = finishPackedSteps(
        PackedSnapshotCertificate.create(context.capture, context.source, [], options, limits),
      )
      const before = context.owner.stats
      let spans: PackedItemSteps | undefined
      const elements = PackedReadScope.prototype.elementSteps
      const track = vi
        .spyOn(PackedReadScope.prototype, 'elementSteps')
        .mockImplementation(function (this: PackedReadScope, path = []) {
          const items = elements.call(this, path)
          if (path.length === 1 && path[0] === 'blocks' && this.hasField('bodyEnd')) spans = items
          return items
        })
      const failure = undefinedFailure ? undefined : new Error('Completed span close failed')
      const itemReturn = PackedItemSteps.prototype.return
      let closes = 0
      const rejectReturn = vi
        .spyOn(PackedItemSteps.prototype, 'return')
        .mockImplementation(function (this: PackedItemSteps) {
          const result = itemReturn.call(this)
          if (this === spans) {
            closes++
            throw failure
          }
          return result
        })
      const work = PackedProjectionBaseline.create(
        context.capture,
        context.source,
        [],
        options,
        limits,
        undefined,
        certificate,
      )
      try {
        let threw = false
        let caught: unknown
        try {
          finishPackedSteps(work)
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(failure)
        expect(closes).toBe(1)
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        track.mockRestore()
        rejectReturn.mockRestore()
        work.return()
        certificate?.close()
        context.owner.dispose()
      }
    },
  )

  it('prunes only proved context-free subtrees while preserving complete context and logical costs', () => {
    const context = fixture(
      `${'> '.repeat(30)}deep [link][r]\n\nplain\n\n[r]: /first\n\n[r]: /ignored\n\ncall[^a] and [^a]\n\n[^a]: note [r][r] and [^b]\n\n[^b]: second\n`,
    )
    const next = context.delta([], [])
    const expected = context.document.root.children.filter(
      (node) => node.type === 'definition' || node.type === 'footnoteDefinition',
    )
    const costs: PackedProjectionContextCost[] = []
    const scalar = vi.spyOn(PackedReadScope.prototype, 'scalar')
    const prune = vi.spyOn(context.baseline, 'contextFree')
    const inspect = (reuse: boolean) =>
      finishPackedSteps(
        inspectPackedProjectionContext(
          next.inspection,
          next.source,
          ['document', 'root'],
          limits,
          function* (definitions, cost) {
            expect(definitions).toEqual(expected)
            costs.push(cost)
            yield
          },
          reuse ? (node) => context.baseline.contextFree(node) : undefined,
        ),
      )
    try {
      inspect(false)
      const originalReads = scalar.mock.calls.filter(([path]) => path[0] === 'type').length
      scalar.mockClear()
      inspect(true)
      expect(prune.mock.results.some((result) => result.value?.nodes > 30)).toBe(true)
      expect(scalar.mock.calls.filter(([path]) => path[0] === 'type').length).toBeLessThan(
        originalReads,
      )
      expect(costs[1]).toEqual(costs[0])
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      finishPackedSteps(
        validatePackedSnapshot(next.inspection, next.source, [], options, limits, context.baseline),
      )
    } finally {
      scalar.mockRestore()
      prune.mockRestore()
      context.owner.dispose()
    }
  })
  it('charges pruned descendants against the current context node and depth limits', () => {
    const context = fixture(`${'> '.repeat(12)}nested prose\n`)
    const next = context.delta([], [])
    const child = next.inspection.reader.at(['document', 'root', 'children', 0])
    const subtree = context.baseline.contextFree(child)
    if (!subtree) throw new Error('Missing context proof')
    const before = context.owner.stats
    try {
      for (const reuse of [false, true])
        for (const [nodes, depth, valid] of [
          [subtree.nodes + 1, subtree.depth + 1, true],
          [subtree.nodes, subtree.depth + 1, false],
          [subtree.nodes + 1, subtree.depth, false],
        ] as const) {
          const validate = () =>
            finishPackedSteps(
              inspectPackedProjectionContext(
                next.inspection,
                next.source,
                ['document', 'root'],
                { ...limits, nodes, depth },
                function* (_, cost) {
                  expect(cost.nodes).toBe(subtree.nodes + 1)
                  yield
                },
                reuse ? (node) => context.baseline.contextFree(node) : undefined,
              ),
            )
          if (valid) validate()
          else expect(validate).toThrow(/traversal limit/)
          expect(context.owner.stats).toEqual(before)
        }
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'release', 'dispose', 'close baseline'] as const)(
    'cleans a context pass suspended after pruning descendants on %s',
    (action) => {
      const context = fixture(`${'> '.repeat(12)}nested prose\n\nsecond\n`)
      const next = context.delta([], [])
      const before = context.owner.stats
      let pruned = false
      const work = inspectPackedProjectionContext(
        next.inspection,
        next.source,
        ['document', 'root'],
        limits,
        function* () {
          yield
        },
        (node) => {
          const proof = context.baseline.contextFree(node)
          if (proof && proof.nodes > 1) pruned = true
          return proof
        },
      )
      try {
        while (!pruned) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        if (action === 'release') next.inspection.release()
        if (action === 'dispose') context.owner.dispose()
        if (action === 'close baseline') {
          context.baseline.close()
          expect(() => finishPackedSteps(work)).toThrow(/closed/)
        }
        expect(work.next().done).toBe(true)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  it('scans changed container overlays that introduce a nested definition', () => {
    const context = fixture('> old pad\n\n[r]\n')
    const after = '> [r]: /x\n\n[r]\n'
    const fresh = parseMarkdown(after)
    const quote = fresh.root.children[0]
    if (quote?.type !== 'blockquote') throw new Error('Missing fixture blockquote')
    const expected = renderProjectionLayout(fresh.root, options, limits.staging)
    const value = {
      children: quote.children,
      trailing: fresh.root.children[1],
      blocks: fresh.blocks,
      counts: fresh.counts,
      hash: fresh.sourceHash,
      projection: expected.projection,
      layout: expected.layout,
    }
    const arena = PackedArena.open(packValue(value, limits.staging), sessionLimits)
    const field = (name: string) => {
      const record = arena.field(arena.root, name)
      if (record === undefined) throw new Error('Missing fixture record')
      return record
    }
    const next = context.delta(
      value,
      [
        {
          kind: 'replace',
          path: ['document', 'root', 'children', 0, 'children'],
          record: field('children'),
        },
        { kind: 'replace', path: ['document', 'root', 'children', 1], record: field('trailing') },
        { kind: 'replace', path: ['document', 'blocks'], record: field('blocks') },
        { kind: 'replace', path: ['document', 'counts'], record: field('counts') },
        { kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') },
        { kind: 'replace', path: ['projection'], record: field('projection') },
        { kind: 'replace', path: ['layout'], record: field('layout') },
      ],
      after,
    )
    try {
      const old = context.capture.reader.at(['document', 'root', 'children', 0])
      const changed = next.inspection.reader.at(['document', 'root', 'children', 0])
      expect(context.baseline.contextFree(old)).toBeDefined()
      expect(changed.recordKey()).toBeUndefined()
      expect(context.baseline.contextFree(changed)).toBeUndefined()
      finishPackedSteps(
        inspectPackedProjectionContext(
          next.inspection,
          next.source,
          ['document', 'root'],
          limits,
          function* (definitions, cost) {
            expect(definitions).toEqual(quote.children)
            expect(cost.definitions).toBe(1)
            yield
          },
          (node) => context.baseline.contextFree(node),
        ),
      )
      finishPackedSteps(
        validatePackedSnapshot(next.inspection, next.source, [], options, limits, context.baseline),
      )
      finishPackedSteps(validatePackedSnapshot(next.inspection, next.source, [], options, limits))
    } finally {
      context.owner.dispose()
    }
  })
  it('re-renders references when definition records change, even with an unchanged body record', () => {
    const context = fixture('plain\n\n[link][r]\n\n[r]: /old\n')
    const after = context.source.text.replace('/old', '/new')
    const fresh = parseMarkdown(after)
    const expected = renderProjectionLayout(fresh.root, options, limits.staging)
    const payloadValue = {
      definition: fresh.root.children[2],
      blocks: fresh.blocks,
      hash: sourceHash(after),
      html: expected.projection.html,
    }
    const arena = PackedArena.open(packValue(payloadValue, limits.staging), sessionLimits)
    const field = (key: string) => {
      const record = arena.field(arena.root, key)
      if (record === undefined) throw new Error('Missing record')
      return record
    }
    const next = context.delta(
      payloadValue,
      [
        { kind: 'replace', path: ['document', 'root', 'children', 2], record: field('definition') },
        { kind: 'replace', path: ['document', 'blocks'], record: field('blocks') },
        { kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') },
        { kind: 'replace', path: ['projection', 'html'], record: field('html') },
      ],
      after,
    )
    const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    try {
      finishPackedSteps(
        validatePackedSnapshot(next.inspection, next.source, [], options, limits, context.baseline),
      )
      expect(
        convert.mock.calls.some(
          ([node]) =>
            node.type === 'paragraph' &&
            node.children.some((child) => child.type === 'linkReference'),
        ),
      ).toBe(true)
      expect(
        convert.mock.calls.some(
          ([node]) =>
            node.type === 'paragraph' &&
            node.children.some((child) => child.type === 'text' && child.value === 'plain'),
        ),
      ).toBe(false)
    } finally {
      convert.mockRestore()
      context.owner.dispose()
    }
  })
  it('keeps repeated/cyclic footnote calls on the stateful renderer path', () => {
    const context = fixture(
      'plain\n\nfirst[^b] and [^a] and [^b]\n\n[^a]: A [^b] $x$\n\n[^b]: B [^a]\n',
    )
    const next = context.delta([], [])
    const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    try {
      finishPackedSteps(
        validatePackedSnapshot(next.inspection, next.source, [], options, limits, context.baseline),
      )
      expect(convert.mock.calls.filter(([node]) => node.type === 'paragraph')).toHaveLength(1)
      finishPackedSteps(validatePackedSnapshot(next.inspection, next.source, [], options, limits))
    } finally {
      convert.mockRestore()
      context.owner.dispose()
    }
  })
  it('falls back to full output checks for a closed or different-owner baseline', () => {
    const first = fixture('plain\n\nsecond\n')
    const second = fixture(first.source.text)
    const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    try {
      const next = second.delta([], [])
      finishPackedSteps(
        validatePackedSnapshot(next.inspection, next.source, [], options, limits, first.baseline),
      )
      expect(convert).toHaveBeenCalledTimes(2)
      first.baseline.close()
      convert.mockClear()
      finishPackedSteps(
        validatePackedSnapshot(next.inspection, next.source, [], options, limits, first.baseline),
      )
      expect(convert).toHaveBeenCalledTimes(2)
    } finally {
      convert.mockRestore()
      first.owner.dispose()
      second.owner.dispose()
    }
  })
  it('requires shared records after a full replacement in the same owner', () => {
    const context = fixture('plain\n\nsecond\n')
    const source = new PackedSource(
      { ...context.source.identity, revision: 1 },
      context.source.text,
    )
    const prepared = context.owner.prepareFull(
      context.owner.beginPrepared(source),
      source.identity,
      packValue(
        { document: context.document, projection: context.projection, layout: context.layout },
        limits.staging,
      ),
    )
    const inspection = context.owner.capturePrepared(prepared)
    const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    try {
      finishPackedSteps(
        validatePackedSnapshot(inspection, source, [], options, limits, context.baseline),
      )
      expect(convert).toHaveBeenCalledTimes(2)
    } finally {
      convert.mockRestore()
      context.owner.dispose()
    }
  })
  // Keep all 4,000 blocks and the admitted baseline live while testing the smaller cache budget.
  it('rejects insufficient persistent cache admission without leaving a partial baseline', () => {
    const context = fixture('p\n\n'.repeat(4000))
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          PackedProjectionBaseline.create(context.capture, context.source, [], options, {
            ...limits,
            retained: 3 * MiB,
            staging: 3 * MiB,
          }),
        ),
      ).toThrow(/cache limit/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  }, 15_000)
  it.each(['HTML', 'descriptions', 'word count'])(
    'withholds receiver ACK for forged reused %s and accepts a retry',
    (forgedField) => {
      const text = 'alpha\n\n~~~text\nwidget\n~~~\n'
      const document = parseMarkdown(text)
      const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
      const source = new PackedSource(
        {
          generation: 1,
          documentId: 'reuse-receiver',
          revision: 0,
          sourceHash: sourceHash(text),
          parserVersion: document.parserVersion,
          rendererVersion,
          options: JSON.stringify(options),
        },
        text,
      )
      let baseline: PackedProjectionBaseline | undefined
      let documentBaseline: PackedDocumentBaseline | undefined
      let wordBaseline: PackedWordBaseline | undefined
      const receiver = new PackedReceiver(sessionLimits, (capture, checked) =>
        validatePackedSnapshot(
          capture,
          checked,
          [],
          options,
          limits,
          baseline,
          documentBaseline,
          wordBaseline,
        ),
      )
      const initial = receiver.begin(1, source)
      const basePacket = {
        protocol: packedWireVersion,
        sequence: 1,
        result: source.identity,
        requestToken: initial.requestToken,
        resultToken: newPackedToken(),
        sentAt: 0,
        metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
      }
      const accepted = finishPackedSteps(
        receiver.receiveSteps(initial, {
          ...basePacket,
          kind: 'full',
          payload: packValue({ document, projection, layout }, limits.staging),
        }),
      )
      if (accepted?.kind !== 'accepted') throw new Error('Missing accepted fixture')
      baseline = finishPackedSteps(
        PackedProjectionBaseline.create(accepted.capture, source, [], options, limits),
      )
      documentBaseline = finishPackedSteps(
        PackedDocumentBaseline.create(accepted.capture, source, ['document'], limits),
      )
      wordBaseline = finishPackedSteps(
        PackedWordBaseline.create(accepted.capture, source, ['document'], limits),
      )
      const before = receiver.stats
      try {
        const checked = new PackedSource({ ...source.identity, revision: 1 }, text)
        const forged = receiver.begin(2, checked)
        const blocks = structuredClone(document.blocks)
        if (!blocks[0]) throw new Error('Missing descriptor')
        blocks[0].hash = 'forged'
        const value =
          forgedField === 'HTML'
            ? projection.html.replace('alpha', 'omega')
            : forgedField === 'word count'
              ? document.counts.words + 1
              : blocks
        const payload = packValue(value, limits.staging)
        const record = PackedArena.open(payload.slice(0), sessionLimits).root
        const packet = (
          ticket: ReturnType<PackedReceiver['begin']>,
          payload: ArrayBuffer,
          operations: readonly PackedOperation[],
        ) => ({
          ...basePacket,
          kind: 'delta',
          sequence: ticket.sequence,
          result: ticket.identity,
          requestToken: ticket.requestToken,
          resultToken: newPackedToken(),
          base: source.identity,
          baseToken: ticket.base?.token,
          payload,
          operations,
        })
        const work = receiver.receiveSteps(
          forged,
          packet(forged, payload, [
            {
              kind: 'replace',
              path:
                forgedField === 'HTML'
                  ? ['projection', 'html']
                  : forgedField === 'word count'
                    ? ['document', 'counts', 'words']
                    : ['document', 'blocks'],
              record,
            },
          ]),
        )
        expect(() => {
          while (true) {
            const next = work.next()
            expect(next.done).toBe(false)
            expect(next.value).toBeUndefined()
          }
        }).toThrow(/semantic/)
        expect(receiver.stats.current).toEqual(source.identity)
        expect(receiver.stats.prepared).toBeNull()
        expect(receiver.stats.readers).toBe(before.readers)
        expect(receiver.stats.readerStagingBytes).toBe(0)
        baseline?.assertOpen()
        documentBaseline?.assertOpen()
        wordBaseline?.assertOpen()
        const retry = receiver.begin(3, checked)
        const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
        try {
          const result = finishPackedSteps(
            receiver.receiveSteps(retry, packet(retry, packValue([], limits.staging), [])),
          )
          expect(result?.kind).toBe('accepted')
          expect(convert).not.toHaveBeenCalled()
          if (result?.kind === 'accepted') result.capture.release()
        } finally {
          convert.mockRestore()
        }
      } finally {
        receiver.dispose()
      }
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  )
  describe.each(['commonmark', 'manuslip'] as const)(
    'validates shared-record revisions for every CommonMark example in %s',
    (syntax) => {
      it.each(examples)('CommonMark $example: $section', (example) => {
        const context = fixture(example.markdown, syntax)
        try {
          const next = context.delta([], [])
          finishPackedSteps(
            validatePackedSnapshot(
              next.inspection,
              next.source,
              [],
              options,
              limits,
              context.baseline,
            ),
          )
          next.inspection.release()
          context.owner.discard(next.prepared)
          context.baseline.close()
          expect(context.owner.stats.readers).toBe(0)
          expect(context.owner.stats.readerStagingBytes).toBe(0)
        } finally {
          context.owner.dispose()
        }
      })
    },
  )
  it.each([false, true])(
    'reuses shifted widgets and plain blocks after actual edits with rawHtml=%s',
    (rawHtml) => {
      const render = { ...options, rawHtml }
      const text =
        'First ordinary paragraph.\n\nSecond **plain** text.\n\n~~~js\nx()\n~~~\n\n![a](local.png) and $x$\n\n| a | b |\n| - | - |\n| $x$ | ![a](local.png) |\n\n<script>raw</script>\n\n![ref][r] and [link][r]\n\n[r]: local.png\n\nlast[^a]\n\n[^a]: note\n'
      const context = fixture(text, 'manuslip', render)
      const documentBaseline = finishPackedSteps(
        PackedDocumentBaseline.create(context.capture, context.source, ['document'], limits),
      )
      const wordBaseline = finishPackedSteps(
        PackedWordBaseline.create(context.capture, context.source, ['document'], limits),
      )
      const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
      try {
        let after = text
        for (const word of ['First', 'Second']) {
          const from = after.indexOf(word)
          const next = context.edit({ from, to: from + word.length, insert: `${word} extended` })
          convert.mockClear()
          finishPackedSteps(
            validatePackedSnapshot(
              next.inspection,
              next.source,
              [],
              render,
              limits,
              context.baseline,
              documentBaseline,
              wordBaseline,
            ),
          )
          expect(convert.mock.calls.length).toBeLessThan(context.document.root.children.length)
          expect(convert.mock.calls.some(([node]) => node.type === 'footnoteDefinition')).toBe(true)
          expect(convert.mock.calls.some(([node]) => node.type === 'code')).toBe(false)
          const fresh = parseMarkdown(next.source.text)
          const expected = renderProjectionLayout(fresh.root, render, limits.staging)
          // Both the optimized and independent exact renderer validators consume the same delta.
          finishPackedSteps(
            validatePackedSnapshot(next.inspection, next.source, [], render, limits),
          )
          expect(next.inspection.reader.textLength(['projection', 'html'])).toBe(
            expected.projection.html.length,
          )
          context.owner.commit(next.prepared)
          after = next.source.text
        }
      } finally {
        convert.mockRestore()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it.each([
    'body HTML',
    'widget HTML',
    'missing widget',
    'span',
    'unknown span field',
    'hidden span',
    'body end',
    'separator',
  ] as const)('rejects forged %s in a shared-root delta', (kind) => {
    const context = fixture('alpha\nbeta\n\n~~~text\nvalue\n~~~\n')
    const altered = structuredClone({ projection: context.projection, layout: context.layout })
    let path: string[]
    let value: unknown
    if (kind === 'body HTML') {
      path = ['projection', 'html']
      value = altered.projection.html.replace('alpha', 'omega')
    } else if (kind === 'widget HTML') {
      path = ['projection', 'blocks']
      const first = altered.projection.blocks[0]
      if (!first) throw new Error('Missing widget')
      first.html = '<pre>forged</pre>'
      value = altered.projection.blocks
    } else if (kind === 'missing widget') {
      path = ['projection', 'blocks']
      value = []
    } else if (kind === 'body end') {
      path = ['layout', 'bodyEnd']
      value = altered.layout.bodyEnd - 1
    } else if (kind === 'separator') {
      path = ['projection', 'html']
      const at = altered.layout.blocks[1]?.from
      if (at === undefined) throw new Error('Missing second span')
      value = `${altered.projection.html.slice(0, at - 1)} ${altered.projection.html.slice(at)}`
    } else if (kind === 'unknown span field' || kind === 'hidden span') {
      path = ['layout', 'blocks']
      const first = altered.layout.blocks[0]
      if (!first) throw new Error('Missing first span')
      if (kind === 'unknown span field') Reflect.set(first, 'extra', true)
      else Reflect.set(first, 'visible', false)
      value = altered.layout.blocks
    } else {
      path = ['layout', 'blocks']
      const first = altered.layout.blocks[0]
      const second = altered.layout.blocks[1]
      if (!first || !second) throw new Error('Missing spans')
      const boundary = altered.projection.html.indexOf('\n')
      value = [
        { ...first, to: boundary },
        { ...second, from: boundary + 1 },
      ]
    }
    const payload = packValue(value, limits.staging)
    const record = PackedArena.open(payload.slice(0), sessionLimits).root
    try {
      const next = context.delta(value, [{ kind: 'replace', path, record }])
      expect(() =>
        finishPackedSteps(
          validatePackedSnapshot(
            next.inspection,
            next.source,
            [],
            options,
            limits,
            context.baseline,
          ),
        ),
      ).toThrow(/semantic/)
      expect(context.capture.reader.textLength(['projection', 'html'])).toBe(
        context.projection.html.length,
      )
      context.owner.discard(next.prepared)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'release', 'dispose', 'close baseline'] as const)(
    'cleans a suspended packed-to-packed comparison on %s',
    (action) => {
      const context = fixture(`~~~text\n${'a界😀'.repeat(10000)}\n~~~\n`)
      const next = context.delta([], [])
      const before = context.owner.stats
      let compared = false
      const original = PackedHtmlCursor.prototype.equalCursor
      const spy = vi.spyOn(PackedHtmlCursor.prototype, 'equalCursor').mockImplementation(function* (
        this: PackedHtmlCursor,
        other: PackedHtmlCursor,
        length: number,
      ) {
        for (const step of original.call(this, other, length)) {
          compared = true
          yield step
        }
      })
      const work = validatePackedSnapshot(
        next.inspection,
        next.source,
        [],
        options,
        limits,
        context.baseline,
      )
      try {
        while (!compared) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        if (action === 'release') next.inspection.release()
        if (action === 'dispose') context.owner.dispose()
        if (action === 'close baseline') {
          context.baseline.close()
          expect(() => finishPackedSteps(work)).toThrow(/closed/)
        }
        expect(work.next().done).toBe(true)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        work.return()
        spy.mockRestore()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it('revokes cached metadata with its borrowed capture and rejects forged provenance', () => {
    const context = fixture('text\n')
    const key = context.capture.reader.recordKey(['document', 'root', 'children', 0])
    expect(key).toBeDefined()
    context.capture.release()
    expect(() => context.baseline.find(context.capture.reader)).toThrow(/closed/)
    expect(() => context.capture.reader.recordKey()).toThrow(/released/)
    expect(() => new (PackedProjectionBaseline as any)(Symbol('forged'), {})).toThrow(/provenance/)
    context.owner.dispose()
    expect(context.owner.stats.retainedBytes).toBe(0)
  })
})
