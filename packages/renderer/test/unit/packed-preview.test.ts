import { createSourceState, OccurrenceTracker } from '@manuslip/editor'
import { describe, expect, it } from 'vitest'
import { preparePreview } from '../../../../apps/desktop/src/renderer/src/preview/preparation'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedDocumentBaseline } from '../../../core/src/packing-document-baseline'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import type { PackedValue } from '../../../core/src/packing-value'
import { PackedWordBaseline } from '../../../core/src/packing-word-baseline'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, rendererVersion } from '../../src/index'
import {
  inspectPackedPreview,
  type PreparedPackedPreviewInput,
  preparePackedPreviewInput,
} from '../../src/packed-preview'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import { validatePackedSnapshot } from '../../src/packing-validate-snapshot'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const session = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back',
}
function fixture(
  text: string,
  syntax: 'commonmark' | 'manuslip' = 'manuslip',
  render = options,
  mutate?: (value: ReturnType<typeof snapshot>) => void,
) {
  const value = snapshot(text, syntax, render)
  mutate?.(value)
  const source = new PackedSource(
    {
      generation: 1,
      revision: 0,
      documentId: 'packed-preview',
      sourceHash: sourceHash(text),
      parserVersion: value.document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession(session)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ snapshot: value }, session.bytes),
    ),
  )
  return { owner, source, capture: owner.capture(), value, text }
}
function snapshot(text: string, syntax: 'commonmark' | 'manuslip', render: RenderOptions) {
  const document = parseMarkdown(text, syntax)
  const { projection, layout } = renderProjectionLayout(document.root, render, session.bytes)
  return { document, projection, layout }
}
const widgetText =
  '# Heading\n\n~~~mermaid\ngraph LR; A-->B\n~~~\n\n~~~js\nx()\n~~~\n\n$$\nx^2\n$$\n\ninline $x$ ![image](local.png) and [^a].\n\n| a | b |\n| - | - |\n| a | b |\n\n<div>raw</div>\n\n[^a]: Footer ![note](note.png).\n'

describe('validated packed input for existing preview preparation', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'prepares every CommonMark widget from exact range-matched descriptors in %s',
    (syntax) => {
      for (const example of examples) {
        const context = fixture(example.markdown, syntax)
        let output: PackedValue<PreparedPackedPreviewInput> | undefined
        try {
          output = finishPackedSteps(
            preparePackedPreviewInput(
              context.capture,
              context.source,
              ['snapshot'],
              options,
              limits,
              {},
              'widgets',
            ),
          )
          if (!output) throw new Error('Missing selected preview input')
          const ranges = new Set(
            context.value.projection.blocks.map((block) => `${block.from}:${block.to}`),
          )
          expect(output.value.input.document.blocks).toEqual(
            context.value.document.blocks.filter((block) =>
              ranges.has(`${block.from}:${block.to}`),
            ),
          )
          expect(output.value.input.projection.blocks).toEqual(context.value.projection.blocks)
          const source = createSourceState(example.markdown).doc
          const native = finishPackedSteps(
            preparePreview(context.value, source, new OccurrenceTracker()),
          )
          const selected = finishPackedSteps(
            preparePreview(output.value.input, source, new OccurrenceTracker()),
          )
          expect(selected.model.blocks.map(({ id, ...block }) => block)).toEqual(
            native.model.blocks.map(({ id, ...block }) => block),
          )
          expect(selected.status).toEqual(native.status)
          expect(selected.commit()).toBe(true)
        } finally {
          output?.release()
          context.owner.dispose()
        }
      }
    },
  )
  it('validates unselected semantic descriptors before a widget-free model can be prepared', () => {
    const context = fixture('Only prose.\n', 'manuslip', options, (value) => {
      const block = value.document.blocks[0]
      if (!block) throw new Error('Missing prose descriptor')
      block.hash = 'forged'
    })
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            limits,
            {},
            'widgets',
          ),
        ),
      ).toThrow()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each([false, true])(
    'keeps complete extension widgets and status with selection and rawHtml=%s',
    (rawHtml) => {
      const render = { ...options, rawHtml }
      const context = fixture(widgetText, 'manuslip', render)
      const output = finishPackedSteps(
        preparePackedPreviewInput(
          context.capture,
          context.source,
          ['snapshot'],
          render,
          limits,
          {},
          'widgets',
        ),
      )
      if (!output) throw new Error('Missing selected extension input')
      try {
        const source = createSourceState(widgetText).doc
        const native = finishPackedSteps(
          preparePreview(context.value, source, new OccurrenceTracker()),
        )
        const selected = finishPackedSteps(
          preparePreview(output.value.input, source, new OccurrenceTracker()),
        )
        expect(selected.model.blocks.map(({ id, ...block }) => block)).toEqual(
          native.model.blocks.map(({ id, ...block }) => block),
        )
        expect(selected.status).toEqual(native.status)
        expect(selected.commit()).toBe(true)
        expect(output.value.input.projection.blocks).toEqual(context.value.projection.blocks)
        expect(output.value.input.document.blocks.length).toBeLessThan(
          context.value.document.blocks.length,
        )
        expect(context.capture.reader.length(['snapshot', 'document', 'blocks'])).toBe(
          context.value.document.blocks.length,
        )
      } finally {
        output.release()
        context.owner.dispose()
      }
    },
  )
  it('transfers native ownership beyond capture closure and base eviction', () => {
    const context = fixture(widgetText)
    const work = preparePackedPreviewInput(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
    )
    const output = finishPackedSteps(work)
    if (!output) throw new Error('Missing owned preview input')
    try {
      expect(context.owner.stats.holds).toBe(1)
      expect(context.owner.stats.readers).toBe(0)
      context.capture.release()
      context.owner.evict()
      expect(output.value.input.document.outline).toEqual(context.value.document.outline)
      expect(output.value.input.projection.blocks).toEqual(context.value.projection.blocks)
      expect(context.owner.stats.retainedBytes).toBeGreaterThan(output.value.cost.retainedBytes)
      expect(work.next().done).toBe(true)
      output.release()
      expect(() => output.value).toThrow(/released/)
      expect(context.owner.stats.retainedBytes).toBe(256)
    } finally {
      output.release()
      context.owner.dispose()
    }
  })
  it('revokes transferred output on session disposal without advancing its closed work', () => {
    const context = fixture(widgetText)
    const work = preparePackedPreviewInput(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
    )
    const output = finishPackedSteps(work)
    if (!output) throw new Error('Missing owned preview input')
    context.owner.dispose()
    expect(() => output.value).toThrow(/released/)
    expect(context.owner.stats.retainedBytes).toBe(0)
    expect(work.next().done).toBe(true)
    output.release()
  })
  it('does not transfer a native value when cancelled at its last suspension', () => {
    const context = fixture(widgetText)
    const before = context.owner.stats
    const work = preparePackedPreviewInput(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
    )
    try {
      while (!context.owner.stats.holds) expect(work.next().done).toBe(false)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      work.return()
      expect(work.next().done).toBe(true)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      context.owner.dispose()
    }
  })
  it.each(['commonmark', 'manuslip'] as const)(
    'copies exact descriptors and widgets for every CommonMark example in %s',
    (syntax) => {
      for (const example of examples) {
        const context = fixture(example.markdown, syntax)
        const before = context.owner.stats
        let inspected = false
        try {
          finishPackedSteps(
            inspectPackedPreview(
              context.capture,
              context.source,
              ['snapshot'],
              options,
              limits,
              function* (input, cost) {
                inspected = true
                expect(input).toEqual({
                  document: {
                    blocks: context.value.document.blocks,
                    outline: context.value.document.outline,
                    counts: context.value.document.counts,
                    timings: context.value.document.timings,
                  },
                  projection: {
                    blocks: context.value.projection.blocks,
                    renderMs: context.value.projection.renderMs,
                  },
                })
                expect(Object.keys(input.document)).toEqual([
                  'blocks',
                  'outline',
                  'counts',
                  'timings',
                ])
                expect(Object.keys(input.projection)).toEqual(['blocks', 'renderMs'])
                expect(Object.isFrozen(input.document.blocks)).toBe(true)
                expect(Object.isFrozen(input.projection.blocks)).toBe(true)
                expect(Object.isFrozen(input.document.outline)).toBe(true)
                expect(Object.isFrozen(input.document.counts)).toBe(true)
                expect(Object.isFrozen(input.document.timings)).toBe(true)
                for (const heading of input.document.outline)
                  expect(Object.isFrozen(heading)).toBe(true)
                expect(Object.isFrozen(cost)).toBe(true)
                expect(cost.retainedBytes).toBeGreaterThan(16384)
                expect(context.owner.stats.readerStagingBytes).toBe(0)
                expect(
                  context.owner.stats.retainedBytes - before.retainedBytes,
                ).toBeGreaterThanOrEqual(cost.retainedBytes)
                yield
                expect(
                  context.owner.stats.retainedBytes - before.retainedBytes,
                ).toBeGreaterThanOrEqual(cost.retainedBytes)
              },
            ),
          )
          expect(inspected).toBe(true)
          expect(context.owner.stats).toEqual(before)
        } finally {
          context.owner.dispose()
        }
      }
    },
  )
  it.each([false, true])(
    'uses the application preparation unchanged with rawHtml=%s',
    (rawHtml) => {
      const render = { ...options, rawHtml },
        context = fixture(widgetText, 'manuslip', render)
      const nativeTracker = new OccurrenceTracker(),
        packedTracker = new OccurrenceTracker()
      const source = createSourceState(widgetText).doc
      const native = finishPackedSteps(preparePreview(context.value, source, nativeTracker))
      expect(native.commit()).toBe(true)
      const before = context.owner.stats
      try {
        finishPackedSteps(
          inspectPackedPreview(
            context.capture,
            context.source,
            ['snapshot'],
            render,
            limits,
            function* (input) {
              const preparation = yield* preparePreview(input, source, packedTracker)
              expect(preparation.status).toEqual(native.status)
              expect(preparation.status).toEqual({
                wordCount: context.value.document.counts.words,
                characterCount: context.value.document.counts.characters,
                outline: context.value.document.outline,
              })
              expect(preparation.model.blocks.map(({ id, ...block }) => block)).toEqual(
                native.model.blocks.map(({ id, ...block }) => block),
              )
              expect(preparation.model.blocks.every((block) => Boolean(block.id))).toBe(true)
              expect(preparation.commit()).toBe(true)
              // Models/indexes are borrowed in this functional test; end their use before
              // the input reservation closes. Production must own them independently.
              packedTracker.reset()
              yield
            },
          ),
        )
        expect(context.owner.stats).toEqual(before)
      } finally {
        nativeTracker.reset()
        packedTracker.reset()
        context.owner.dispose()
      }
    },
  )
  it('copies long widget strings exactly, including surrogate pairs and line endings', () => {
    const text = `~~~text\r\n${'界😀 é '.repeat(4000)}\r\n~~~\r\n`
    const context = fixture(text),
      before = context.owner.stats
    try {
      finishPackedSteps(
        inspectPackedPreview(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
          function* (input, cost) {
            expect(input.projection.blocks).toEqual(context.value.projection.blocks)
            expect(cost.copyStagingBytes).toBeLessThan(limits.staging)
            expect(Object.isFrozen(input.projection.blocks[0])).toBe(true)
            yield
          },
        ),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('preserves complete ordered headings and status through actual preparation', () => {
    const title = '界😀 é '.repeat(1000)
    const text = `# Same\r\n\r\n## **Same**\r\n\r\n### ${title}\r\n\r\n# Same\r\n`
    const context = fixture(text),
      before = context.owner.stats,
      tracker = new OccurrenceTracker(),
      source = createSourceState(text).doc
    try {
      finishPackedSteps(
        inspectPackedPreview(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
          function* (input, cost) {
            expect(input.document.outline).toEqual(context.value.document.outline)
            expect(input.document.outline).toHaveLength(4)
            expect(input.document.outline[2]?.text).toBe(title.trimEnd())
            expect(cost.copyStagingBytes).toBeLessThan(limits.staging)
            const prepared = yield* preparePreview(input, source, tracker)
            expect(prepared.status).toEqual({
              wordCount: context.value.document.counts.words,
              characterCount: [...text].length,
              outline: context.value.document.outline,
            })
            expect(prepared.commit()).toBe(true)
            yield
            expect(prepared.status.outline).toEqual(context.value.document.outline)
            tracker.reset()
          },
        ),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      tracker.reset()
      context.owner.dispose()
    }
  })
  it.each([
    'HTML',
    'words',
    'characters',
    'descriptions',
    'outline',
    'parse timing',
    'render timing',
  ] as const)('validates forged %s before exposing input', (field) => {
    const context = fixture('ordinary words\n', 'manuslip', options, (value) => {
      if (field === 'HTML') value.projection.html = '<p>forged</p>'
      if (field === 'words') value.document.counts.words++
      if (field === 'characters') value.document.counts.characters++
      if (field === 'descriptions' && value.document.blocks[0])
        value.document.blocks[0].hash = 'forged'
      if (field === 'outline')
        value.document.outline.push({ from: 0, to: 1, depth: 1, text: 'forged' })
      if (field === 'parse timing') value.document.timings.parse = -1
      if (field === 'render timing') value.projection.renderMs = -1
    })
    const before = context.owner.stats
    let inspected = false
    try {
      expect(() =>
        finishPackedSteps(
          inspectPackedPreview(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            limits,
            function* () {
              inspected = true
              yield
            },
          ),
        ),
      ).toThrow(/semantic/)
      expect(inspected).toBe(false)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'capture', 'owner'] as const)(
    'releases a suspended native input on %s',
    (action) => {
      const context = fixture(widgetText),
        before = context.owner.stats
      let inspected = false,
        closed = false
      const work = inspectPackedPreview(
        context.capture,
        context.source,
        ['snapshot'],
        options,
        limits,
        function* () {
          try {
            inspected = true
            yield
          } finally {
            closed = true
          }
        },
      )
      try {
        while (!inspected) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        if (action === 'capture') context.capture.release()
        if (action === 'owner') context.owner.dispose()
        expect(closed).toBe(true)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
        if (action === 'owner') expect(context.owner.stats.retainedBytes).toBe(0)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  // Validate all 15,000 blocks before testing native-copy admission, including under coverage.
  it('rejects native output capacity before copying, even when complete validation fits', () => {
    const context = fixture('p\n\n'.repeat(15000)),
      budget = { ...limits, retained: 8 * MiB }
    const before = context.owner.stats
    let inspected = false
    try {
      finishPackedSteps(
        validatePackedSnapshot(context.capture, context.source, ['snapshot'], options, budget),
      )
      expect(() =>
        finishPackedSteps(
          inspectPackedPreview(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            budget,
            function* () {
              inspected = true
              yield
            },
          ),
        ),
      ).toThrow(/preview exceeds workspace limit/)
      expect(inspected).toBe(false)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  }, 15_000)
  it('copies queued paths, options and limits and rejects a foreign source object', () => {
    const context = fixture(widgetText),
      before = context.owner.stats
    const path = ['snapshot'],
      render = { ...options },
      budget = { ...limits }
    let inspected = false
    const work = inspectPackedPreview(
      context.capture,
      context.source,
      path,
      render,
      budget,
      function* () {
        inspected = true
        yield
      },
    )
    path[0] = 'missing'
    render.rawHtml = true
    budget.nodes = 0
    try {
      finishPackedSteps(work)
      expect(inspected).toBe(true)
      expect(context.owner.stats).toEqual(before)
      const foreign = new PackedSource(context.source.identity, context.text)
      expect(() =>
        finishPackedSteps(
          inspectPackedPreview(
            context.capture,
            foreign,
            ['snapshot'],
            options,
            limits,
            function* () {
              yield
            },
          ),
        ),
      ).toThrow(/source mismatch/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      context.owner.dispose()
    }
  })
  it('keeps native input charged while a consumer reserves independent output', () => {
    const context = fixture(widgetText),
      before = context.owner.stats
    try {
      finishPackedSteps(
        inspectPackedPreview(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
          function* (input, cost) {
            const held = context.owner.stats
            const bytes = session.retained - held.retainedBytes - 4096
            const hold = context.owner.retain({ resources: () => [{ key: {}, bytes }] })
            try {
              expect(context.owner.stats.readers).toBeLessThan(session.readers)
              expect(() => context.capture.workspace(8192, 0)).toThrow(/scope limit/)
              expect(context.owner.stats.retainedBytes).toBeGreaterThan(held.retainedBytes)
              yield
              expect(input.projection.blocks).toEqual(context.value.projection.blocks)
              expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
            } finally {
              hold.release()
            }
            expect(context.owner.stats).toEqual(held)
          },
        ),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['queued return', 'inspector failure'] as const)('cleans ownership on %s', (action) => {
    const context = fixture(widgetText),
      before = context.owner.stats
    let inspected = false
    const work = inspectPackedPreview(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
      function* () {
        inspected = true
        yield
        throw new Error('consumer failed')
      },
    )
    try {
      if (action === 'queued return') work.return()
      else expect(() => finishPackedSteps(work)).toThrow('consumer failed')
      expect(inspected).toBe(action === 'inspector failure')
      expect(work.next().done).toBe(true)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      context.owner.dispose()
    }
  })
  it('composes all three baselines and keeps admitted input alive after their capture closes', () => {
    const context = fixture(widgetText)
    const projection = finishPackedSteps(
      PackedProjectionBaseline.create(
        context.capture,
        context.source,
        ['snapshot'],
        options,
        limits,
      ),
    )
    const document = finishPackedSteps(
      PackedDocumentBaseline.create(
        context.capture,
        context.source,
        ['snapshot', 'document'],
        limits,
      ),
    )
    const words = finishPackedSteps(
      PackedWordBaseline.create(context.capture, context.source, ['snapshot', 'document'], limits),
    )
    const source = new PackedSource({ ...context.source.identity, revision: 1 }, context.text)
    const prepared = context.owner.prepareDelta(context.owner.beginPrepared(source), {
      base: context.source.identity,
      baseSource: context.text,
      result: source.identity,
      payload: packValue({}, session.bytes),
      operations: [],
    })
    const inspection = context.owner.capturePrepared(prepared)
    try {
      finishPackedSteps(
        inspectPackedPreview(
          inspection,
          source,
          ['snapshot'],
          options,
          limits,
          function* (input) {
            context.capture.release()
            expect(() => document?.assertOpen()).toThrow(/closed/)
            expect(input.document.blocks).toEqual(context.value.document.blocks)
            yield
            expect(input.projection.blocks).toEqual(context.value.projection.blocks)
          },
          { projection, document, words },
        ),
      )
      expect(inspection.identity.revision).toBe(1)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
})
