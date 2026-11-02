import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import type { PackedValue } from '../../../core/src/packing-value'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { type RenderOptions, rendererVersion } from '../../src/index'
import {
  type PreparedPackedPreviewInput,
  preparePackedPreviewInput,
} from '../../src/packed-preview'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import * as validation from '../../src/packing-validate-snapshot'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const capacity = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back',
}
const text =
  '# Heading\r\n\r\nProse 😀 [link][a] ![image](local.png) and [^n].\r\n\r\n~~~mermaid\r\ngraph LR; A-->B\r\n~~~\r\n\r\n$$\r\nx^2\r\n$$\r\n\r\n<div>raw</div>\r\n\r\n[a]: https://example.com\r\n[^n]: Footer.\r\n'

function fixture(render = options) {
  const document = parseMarkdown(text, 'manuslip')
  const { projection, layout } = renderProjectionLayout(document.root, render, limits.staging)
  const snapshot = { document, projection, layout }
  const forged = structuredClone(snapshot)
  const block = forged.document.blocks[0]
  if (!block) throw new Error('Missing descriptor')
  block.hash = 'forged'
  const root = { snapshot, forged }
  const source = new PackedSource(
    {
      generation: 1,
      revision: 0,
      documentId: 'exact-preview-validation',
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
      packValue(root, limits.staging),
    ),
  )
  const capture = owner.capture()
  const baseline = finishPackedSteps(
    PackedProjectionBaseline.create(capture, source, ['snapshot'], render, limits),
  )
  if (!baseline) throw new Error('Missing baseline')
  return { owner, capture, baseline, source, root }
}

afterEach(() => vi.restoreAllMocks())

describe('complete validation reuse for an exact immutable preview snapshot', () => {
  it.each([false, true])('preserves full and selected native input with rawHtml=%s', (rawHtml) => {
    const render = { ...options, rawHtml }
    const context = fixture(render)
    const independent = context.capture.retain()
    const spy = vi.spyOn(validation, 'validatePackedSnapshot')
    try {
      for (const descriptors of ['all', 'widgets'] as const) {
        const uncached = finishPackedSteps(
          preparePackedPreviewInput(
            independent,
            context.source,
            ['snapshot'],
            render,
            { ...limits, retained: 32 * MiB },
            {},
            descriptors,
          ),
        )
        spy.mockClear()
        const before = context.owner.stats
        const cached = finishPackedSteps(
          preparePackedPreviewInput(
            independent,
            context.source,
            ['snapshot'],
            render,
            { ...limits, retained: 32 * MiB },
            { projection: context.baseline },
            descriptors,
          ),
        )
        try {
          expect(cached).toBeDefined()
          expect(cached?.value).toEqual(uncached?.value)
          expect(spy).not.toHaveBeenCalled()
        } finally {
          cached?.release()
          expect(context.owner.stats).toEqual(before)
          uncached?.release()
        }
      }
    } finally {
      context.owner.dispose()
    }
  })

  it('validates a different snapshot path even within the same captured revision', () => {
    const context = fixture()
    const spy = vi.spyOn(validation, 'validatePackedSnapshot')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['forged'],
            options,
            limits,
            { projection: context.baseline },
            'widgets',
          ),
        ),
      ).toThrow()
      expect(spy).toHaveBeenCalledOnce()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['same identity, different revision object', 'foreign owner', 'later revision'])(
    'validates a forged snapshot with %s',
    (kind) => {
      const context = fixture()
      const owner = kind === 'foreign owner' ? new PackedSession(capacity) : context.owner
      const source =
        kind === 'later revision'
          ? new PackedSource({ ...context.source.identity, revision: 1 }, text)
          : context.source
      owner.commit(
        owner.prepareFull(
          owner.beginPrepared(source),
          source.identity,
          packValue({ snapshot: context.root.forged }, limits.staging),
        ),
      )
      const capture = owner.capture()
      const spy = vi.spyOn(validation, 'validatePackedSnapshot')
      const before = owner.stats
      try {
        expect(() =>
          finishPackedSteps(
            preparePackedPreviewInput(capture, source, ['snapshot'], options, limits, {
              projection: context.baseline,
            }),
          ),
        ).toThrow()
        expect(spy).toHaveBeenCalledOnce()
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
    { depth: 129 },
    { retained: 65 * MiB },
    { staging: 9 * MiB },
    { retained: Number.POSITIVE_INFINITY },
    { staging: 1.5 },
    { nodes: 800001 },
  ])('keeps full validation for stricter or invalid limits %j', (change) => {
    const context = fixture()
    const spy = vi.spyOn(validation, 'validatePackedSnapshot')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            { ...limits, ...change },
            { projection: context.baseline },
          ),
        ),
      ).toThrow()
      expect(spy).toHaveBeenCalledOnce()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each([
    { rawHtml: true },
    { footnotesLabel: 'Changed' },
    { extra: undefined },
    { footnotesLabel: { toJSON: () => options.footnotesLabel } },
  ])('rejects changed or malformed rendering options %j', (change) => {
    const context = fixture()
    const spy = vi.spyOn(validation, 'validatePackedSnapshot')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['snapshot'],
            { ...options, ...change } as RenderOptions,
            limits,
            { projection: context.baseline },
          ),
        ),
      ).toThrow()
      expect(spy).toHaveBeenCalledOnce()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it('copies queued request fields and refuses an equivalent foreign source object', () => {
    const context = fixture()
    const spy = vi.spyOn(validation, 'validatePackedSnapshot')
    const path = ['snapshot'],
      render = { ...options },
      budget = { ...limits }
    const work = preparePackedPreviewInput(context.capture, context.source, path, render, budget, {
      projection: context.baseline,
    })
    path[0] = 'forged'
    render.rawHtml = true
    budget.nodes = 0
    let output: PackedValue<PreparedPackedPreviewInput> | undefined
    try {
      output = finishPackedSteps(work)
      expect(output?.value.input.document.blocks).toEqual(context.root.snapshot.document.blocks)
      expect(spy).not.toHaveBeenCalled()
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            new PackedSource(context.source.identity, text),
            ['snapshot'],
            options,
            limits,
            { projection: context.baseline },
          ),
        ),
      ).toThrow(/source mismatch/)
    } finally {
      output?.release()
      context.owner.dispose()
    }
  })

  it('still admits native preview allocation independently of the validation proof', () => {
    const context = fixture()
    const spy = vi.spyOn(validation, 'validatePackedSnapshot')
    const bytes = capacity.retained - context.owner.stats.retainedBytes - 1024
    const hold = context.owner.retain({
      resources: () => [{ key: {}, bytes }],
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
            { projection: context.baseline },
          ),
        ),
      ).toThrow(/scope limit/)
      expect(spy).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      hold.release()
      context.owner.dispose()
    }
  })

  it.each(['before first advance', 'after proof matching'])(
    'keeps an independent capture valid when the baseline closes %s',
    (phase) => {
      const context = fixture()
      const independent = context.capture.retain()
      const spy = vi.spyOn(validation, 'validatePackedSnapshot')
      const work = preparePackedPreviewInput(
        independent,
        context.source,
        ['snapshot'],
        options,
        limits,
        { projection: context.baseline },
      )
      let output: PackedValue<PreparedPackedPreviewInput> | undefined
      try {
        if (phase === 'after proof matching') expect(work.next().done).toBe(false)
        context.capture.release()
        expect(() => context.baseline.assertOpen()).toThrow(/closed/)
        output = finishPackedSteps(work)
        expect(output?.value.input.document.blocks).toEqual(context.root.snapshot.document.blocks)
        expect(output?.value.input.projection.blocks).toEqual(
          context.root.snapshot.projection.blocks,
        )
        expect(spy).toHaveBeenCalledTimes(phase === 'before first advance' ? 1 : 0)
        independent.release()
        expect(output?.value.input.document.counts).toEqual(context.root.snapshot.document.counts)
      } finally {
        output?.release()
        context.owner.dispose()
      }
    },
  )

  it.each(['return', 'capture', 'owner'] as const)(
    'revokes a reused-proof copy on %s without transferring partial native output',
    (action) => {
      const probe = fixture()
      let suspensions = 0
      try {
        const work = preparePackedPreviewInput(
          probe.capture,
          probe.source,
          ['snapshot'],
          options,
          limits,
          { projection: probe.baseline },
        )
        while (true) {
          const next = work.next()
          if (next.done) {
            next.value?.release()
            break
          }
          suspensions++
        }
      } finally {
        probe.owner.dispose()
      }
      expect(suspensions).toBeGreaterThan(3)
      const spy = vi.spyOn(validation, 'validatePackedSnapshot')
      for (const stop of [1, Math.floor(suspensions / 2), suspensions]) {
        const context = fixture()
        spy.mockClear()
        const before = context.owner.stats
        const work = preparePackedPreviewInput(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
          { projection: context.baseline },
        )
        try {
          for (let step = 0; step < stop; step++) expect(work.next().done).toBe(false)
          expect(spy).not.toHaveBeenCalled()
          if (action === 'return') work.return()
          else if (action === 'capture') context.capture.release()
          else context.owner.dispose()
          expect(work.next()).toEqual({ done: true, value: undefined })
          expect(context.owner.stats.readerStagingBytes).toBe(0)
          expect(context.owner.stats.readers).toBe(action === 'return' ? before.readers : 0)
          if (action === 'return') expect(context.owner.stats).toEqual(before)
        } finally {
          work.return()
          context.owner.dispose()
        }
      }
    },
  )
})
