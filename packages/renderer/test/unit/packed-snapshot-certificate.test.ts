import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import type { PackedCapture } from '../../../core/src/packing-capture'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import { preparePackedPreviewInput } from '../../src/packed-preview'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import { PackedSnapshotCertificate } from '../../src/packed-snapshot-certificate'
import * as validation from '../../src/packing-validate-snapshot'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 4 * MiB, nodes: 100000, depth: 64 }
const session = { retained: 64 * MiB, staging: 8 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const text = '# Heading\n\nBody 中文 [r][ref] and note[^n].\n\n[ref]: /target\n\n[^n]: Footer.\n'
function fixture(prepared = false, mutate?: (value: ReturnType<typeof snapshot>) => void) {
  const value = snapshot()
  mutate?.(value)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'certificate',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: value.document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession(session)
  const ticket = owner.prepareFull(
    owner.beginPrepared(source),
    source.identity,
    packValue({ snapshot: value }, session.bytes),
  )
  if (!prepared) owner.commit(ticket)
  const capture = prepared ? owner.capturePrepared(ticket) : owner.capture()
  return { value, owner, source, capture, ticket }
}
function snapshot() {
  const document = parseMarkdown(text)
  const { projection, layout } = renderProjectionLayout(document.root, options, session.bytes)
  return { document, projection, layout }
}
function certify(context: ReturnType<typeof fixture>) {
  const result = finishPackedSteps(
    PackedSnapshotCertificate.create(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
    ),
  )
  if (!result) throw new Error('Missing complete certificate')
  return result
}
afterEach(() => vi.restoreAllMocks())

describe('exact complete packed snapshot certificate', () => {
  it('builds projection metadata from the validated committed revision without rendering again', () => {
    const context = fixture(true),
      certificate = certify(context)
    const validate = vi.spyOn(validation, 'validatePackedSnapshot')
    let capture: PackedCapture | undefined
    let baseline: PackedProjectionBaseline | undefined
    try {
      context.owner.commit(context.ticket)
      capture = context.owner.capture()
      const before = context.owner.stats
      const work = PackedProjectionBaseline.create(
        capture,
        context.source,
        ['snapshot'],
        options,
        limits,
        undefined,
        certificate,
      )
      expect(work.next().done).toBe(false)
      baseline = finishPackedSteps(work)
      expect(
        baseline?.validatesSnapshot(capture, context.source, ['snapshot'], options, limits),
      ).toBe(true)
      expect(validate).not.toHaveBeenCalled()
      baseline?.close()
      expect(context.owner.stats).toEqual(before)
    } finally {
      baseline?.close()
      certificate.close()
      capture?.release()
      context.owner.dispose()
    }
  })

  it.each(['retained', 'staging', 'nodes', 'depth', 'closed', 'owner', 'policy', 'path'] as const)(
    'runs full projection validation when the supplied certificate differs in %s',
    (difference) => {
      const context = fixture(),
        other = fixture(),
        certificate = certify(context)
      const validate = vi.spyOn(validation, 'validatePackedSnapshot')
      const target = difference === 'owner' ? other : context
      const budget = { ...limits }
      if (difference in budget) budget[difference as keyof typeof budget]--
      const work = PackedProjectionBaseline.create(
        target.capture,
        target.source,
        difference === 'path' ? [] : ['snapshot'],
        difference === 'policy' ? { ...options, rawHtml: true } : options,
        budget,
        undefined,
        certificate,
      )
      if (difference === 'closed') certificate.close()
      let baseline: PackedProjectionBaseline | undefined
      try {
        if (difference === 'path' || difference === 'policy')
          expect(() => finishPackedSteps(work)).toThrow(/semantic|packed path/)
        else baseline = finishPackedSteps(work)
        expect(validate).toHaveBeenCalledOnce()
      } finally {
        work.return()
        baseline?.close()
        certificate.close()
        context.owner.dispose()
        other.owner.dispose()
      }
    },
  )

  it('revalidates and rejects a replacement graph with the same source and revision identity', () => {
    const context = fixture(),
      certificate = certify(context)
    const value = snapshot()
    value.projection.html = '<p>forged</p>'
    context.owner.commit(
      context.owner.prepareFull(
        context.owner.beginPrepared(context.source),
        context.source.identity,
        packValue({ snapshot: value }, session.bytes),
      ),
    )
    const replacement = context.owner.capture()
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          PackedProjectionBaseline.create(
            replacement,
            context.source,
            ['snapshot'],
            options,
            limits,
            undefined,
            certificate,
          ),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      replacement.release()
      certificate.close()
      context.owner.dispose()
    }
  })

  it('rejects forged authorization methods and keeps both consumers on full validation', () => {
    const context = fixture(false, (value) => {
      value.projection.html = '<p>forged</p>'
    })
    const forged = Object.create(PackedSnapshotCertificate.prototype, {
      validatesSnapshot: { value: () => true },
    }) as PackedSnapshotCertificate
    try {
      expect(
        PackedSnapshotCertificate.validates(
          forged,
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
        ),
      ).toBe(false)
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            limits,
            {
              snapshot: forged,
            },
          ),
        ),
      ).toThrow(/semantic/)
      expect(() =>
        finishPackedSteps(
          PackedProjectionBaseline.create(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            limits,
            undefined,
            forged,
          ),
        ),
      ).toThrow(/semantic/)
      expect(
        Reflect.set(PackedSnapshotCertificate.prototype, 'validatesSnapshot', () => true),
      ).toBe(false)
      expect(Reflect.set(PackedSnapshotCertificate, 'validates', () => true)).toBe(false)
    } finally {
      context.owner.dispose()
    }
  })

  it('survives prepared commit and avoids duplicate validation with independent ownership', () => {
    const context = fixture(true),
      certificate = certify(context),
      retained = certificate.retain()
    const validate = vi.spyOn(validation, 'validatePackedSnapshot')
    let committed: PackedCapture | undefined
    try {
      context.owner.commit(context.ticket)
      expect(() => context.capture.identity).toThrow('released')
      committed = context.owner.capture()
      certificate.close()
      expect(
        retained.validatesSnapshot(committed, context.source, ['snapshot'], options, limits),
      ).toBe(true)
      const output = finishPackedSteps(
        preparePackedPreviewInput(committed, context.source, ['snapshot'], options, limits, {
          snapshot: retained,
        }),
      )
      try {
        expect(output?.value.input.document.blocks).toEqual(context.value.document.blocks)
        expect(output?.value.input.projection.blocks).toEqual(context.value.projection.blocks)
        expect(validate).not.toHaveBeenCalled()
      } finally {
        output?.release()
      }
      retained.close()
      const checked = finishPackedSteps(
        preparePackedPreviewInput(committed, context.source, ['snapshot'], options, limits, {
          snapshot: retained,
        }),
      )
      checked?.release()
      expect(validate).toHaveBeenCalledOnce()
    } finally {
      certificate.close()
      retained.close()
      committed?.release()
      context.owner.dispose()
    }
  })

  it('does not authorize a replaced graph with the same owner, exact source and identity', () => {
    const context = fixture(),
      certificate = certify(context)
    try {
      const forged = snapshot()
      forged.document.counts.words++
      context.owner.commit(
        context.owner.prepareFull(
          context.owner.beginPrepared(context.source),
          context.source.identity,
          packValue({ snapshot: forged }, session.bytes),
        ),
      )
      const replacement = context.owner.capture()
      try {
        expect(replacement.sourceResource).toBe(context.source)
        expect(replacement.identity).toBe(context.capture.identity)
        expect(certificate.matches(replacement)).toBe(false)
        expect(
          certificate.validatesSnapshot(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            limits,
          ),
        ).toBe(true)
        expect(() =>
          finishPackedSteps(
            preparePackedPreviewInput(replacement, context.source, ['snapshot'], options, limits, {
              snapshot: certificate,
            }),
          ),
        ).toThrow(/semantic/)
      } finally {
        replacement.release()
      }
    } finally {
      certificate.close()
      context.owner.dispose()
    }
  })

  it('rejects a different owner and identical source values reconstructed separately', () => {
    const left = fixture(),
      right = fixture(),
      certificate = certify(left)
    try {
      expect(
        certificate.validatesSnapshot(right.capture, right.source, ['snapshot'], options, limits),
      ).toBe(false)
      const copiedSource = new PackedSource(left.source.identity, left.source.text)
      expect(
        certificate.validatesSnapshot(left.capture, copiedSource, ['snapshot'], options, limits),
      ).toBe(false)
    } finally {
      certificate.close()
      left.owner.dispose()
      right.owner.dispose()
    }
  })

  it.each(['retained', 'staging', 'nodes', 'depth'] as const)(
    'requires validation again for stricter %s limits',
    (key) => {
      const context = fixture(),
        certificate = certify(context)
      const validate = vi.spyOn(validation, 'validatePackedSnapshot')
      try {
        const stricter = { ...limits, [key]: limits[key] - 1 }
        expect(
          certificate.validatesSnapshot(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            stricter,
          ),
        ).toBe(false)
        const output = finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            stricter,
            { snapshot: certificate },
          ),
        )
        output?.release()
        expect(validate).toHaveBeenCalledOnce()
        const larger = { ...limits, [key]: limits[key] + 1 }
        expect(
          certificate.validatesSnapshot(
            context.capture,
            context.source,
            ['snapshot'],
            options,
            larger,
          ),
        ).toBe(true)
        expect(
          certificate.validatesSnapshot(context.capture, context.source, ['snapshot'], options, {
            ...limits,
            [key]: NaN,
          }),
        ).toBe(false)
      } finally {
        certificate.close()
        context.owner.dispose()
      }
    },
  )

  it('binds copied paths and the exact serialized policy, including property order', () => {
    const context = fixture(),
      path = ['snapshot'],
      render = { ...options },
      budget = { ...limits }
    const work = PackedSnapshotCertificate.create(
      context.capture,
      context.source,
      path,
      render,
      budget,
    )
    path[0] = 'other'
    render.footnotesLabel = 'Other'
    budget.nodes = 0
    const certificate = finishPackedSteps(work)
    if (!certificate) throw new Error('Missing complete certificate')
    try {
      expect(
        certificate.validatesSnapshot(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
        ),
      ).toBe(true)
      expect(
        certificate.validatesSnapshot(
          context.capture,
          context.source,
          ['snapshot'],
          {
            footnoteBackLabel: options.footnoteBackLabel,
            footnotesLabel: options.footnotesLabel,
            rawHtml: options.rawHtml,
          },
          limits,
        ),
      ).toBe(false)
      expect(
        certificate.validatesSnapshot(context.capture, context.source, [], options, limits),
      ).toBe(false)
      for (const changed of [render, { ...options, rawHtml: true }, { ...options, extra: true }])
        expect(
          certificate.validatesSnapshot(
            context.capture,
            context.source,
            ['snapshot'],
            changed,
            limits,
          ),
        ).toBe(false)
    } finally {
      certificate.close()
      context.owner.dispose()
    }
  })

  it.each(['queued', 'active'] as const)('releases %s creation on cancellation', (phase) => {
    const context = fixture(),
      before = context.owner.stats
    const work = PackedSnapshotCertificate.create(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
    )
    try {
      if (phase === 'active')
        for (let index = 0; index < 12; index++) expect(work.next().done).toBe(false)
      work.return()
      expect(work.next().done).toBe(true)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      context.owner.dispose()
    }
  })

  it.each(['capture', 'owner'] as const)('revokes active creation through %s release', (action) => {
    const context = fixture()
    const work = PackedSnapshotCertificate.create(
      context.capture,
      context.source,
      ['snapshot'],
      options,
      limits,
    )
    for (let index = 0; index < 12; index++) expect(work.next().done).toBe(false)
    if (action === 'capture') context.capture.release()
    else context.owner.dispose()
    expect(work.next().done).toBe(true)
    expect(context.owner.stats).toMatchObject({ readers: 0, holds: 0, readerStagingBytes: 0 })
    context.owner.dispose()
  })

  it.each(['return', 'capture', 'owner'] as const)(
    'releases prepared validation at early and late suspension points through %s',
    (action) => {
      const complete = fixture(true)
      let advances = 0
      try {
        const work = PackedSnapshotCertificate.create(
          complete.capture,
          complete.source,
          ['snapshot'],
          options,
          limits,
        )
        while (true) {
          const next = work.next()
          if (next.done) {
            expect(next.value).toBeDefined()
            next.value?.close()
            break
          }
          advances++
        }
      } finally {
        complete.owner.dispose()
      }
      expect(advances).toBeGreaterThan(16)
      const stops = new Set([
        0,
        1,
        2,
        ...Array.from({ length: 8 }, (_, index) => Math.floor((advances * (index + 1)) / 9)),
        advances - 1,
      ])
      for (const stop of stops) {
        const context = fixture(true)
        const before = context.owner.stats
        const work = PackedSnapshotCertificate.create(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
        )
        try {
          for (let at = 0; at < stop; at++) expect(work.next().done).toBe(false)
          if (action === 'return') work.return()
          else if (action === 'capture') context.capture.release()
          else context.owner.dispose()
          // Cleanup must finish while the closed creation handle stays held and unadvanced.
          if (action === 'return') expect(context.owner.stats).toEqual(before)
          else {
            expect(context.owner.stats).toMatchObject({
              readers: 0,
              holds: 0,
              readerStagingBytes: 0,
            })
            if (action === 'owner') expect(context.owner.stats.retainedBytes).toBe(0)
          }
          expect(work.next()).toEqual({ done: true, value: undefined })
          work.return()
        } finally {
          work.return()
          context.owner.dispose()
        }
      }
    },
  )

  it('releases all temporary ownership when full semantic validation fails', () => {
    const context = fixture(false, (value) => {
      value.projection.html = '<p>forged</p>'
    })
    const before = context.owner.stats
    try {
      expect(() => certify(context)).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it('admits certificate metadata before starting semantic validation', () => {
    const context = fixture()
    const validate = vi.spyOn(validation, 'validatePackedSnapshot')
    const fill = context.capture.workspace(
      session.retained - context.owner.stats.retainedBytes - 2048,
      0,
    )
    const before = context.owner.stats
    try {
      expect(() =>
        PackedSnapshotCertificate.create(
          context.capture,
          context.source,
          ['snapshot'],
          options,
          limits,
        ),
      ).toThrow(/limit/)
      expect(validate).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      fill.release()
      context.owner.dispose()
    }
  })

  it('preserves the full validator serialized-policy ownership rule on fallback', () => {
    const context = fixture(),
      certificate = certify(context)
    const before = context.owner.stats
    const reversed = {
      footnoteBackLabel: options.footnoteBackLabel,
      footnotesLabel: options.footnotesLabel,
      rawHtml: options.rawHtml,
    }
    try {
      expect(() =>
        finishPackedSteps(
          preparePackedPreviewInput(
            context.capture,
            context.source,
            ['snapshot'],
            reversed,
            limits,
            { snapshot: certificate },
          ),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      certificate.close()
      context.owner.dispose()
    }
  })

  it('cannot be forged and is revoked by session disposal', () => {
    const context = fixture(),
      certificate = certify(context)
    try {
      expect(() => Reflect.construct(PackedSnapshotCertificate, [Symbol('fake'), {}])).toThrow(
        'provenance',
      )
      context.owner.dispose()
      expect(() => certificate.retain()).toThrow('released')
      certificate.close()
      expect(certificate.matches(context.capture)).toBe(false)
    } finally {
      certificate.close()
      context.owner.dispose()
    }
  })
})
