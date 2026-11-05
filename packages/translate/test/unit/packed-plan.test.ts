import { deepStrictEqual } from 'node:assert'
import { parseMarkdown, sourceHash } from '@manuslip/core'
import { expect, it } from 'vitest'
import { packValue } from '../../../core/src/packing'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import type { TranslationUnit, UnitKind } from '../../src/contracts'
import { extractTranslation } from '../../src/extract'
import { prepareCanonicalTranslation, prepareTranslation } from '../../src/identity'
import { buildPackedTranslationPlan, type PackedTranslationPlan } from '../../src/packed-plan'
import { reconstructUnit } from '../../src/reconstruct'
import { fixtureCapabilities, fixtureSettings } from '../fixtures/provider'

const MiB = 1024 * 1024
const limits = {
  retained: 24 * MiB,
  metadata: 8 * MiB,
  staging: 8 * MiB,
  nodes: 800000,
  depth: 128,
}
const occurrence = ({ from, to, kind }: { from: number; to: number; kind: UnitKind }) =>
  `${kind}:${from}:${to}`
const path = ['document', 'root'] as const
function fixture(text: string, syntax: 'commonmark' | 'manuslip' = 'manuslip', prepared = false) {
  const document = parseMarkdown(text, syntax)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'packed-plan',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
  const owner = new PackedSession({
    retained: 32 * MiB,
    bytes: 8 * MiB,
    staging: 8 * MiB,
    readers: 160,
    captures: 8,
  })
  const ticket = owner.prepareFull(
    owner.beginPrepared(source),
    source.identity,
    packValue({ document: { root: document.root } }, 8 * MiB),
  )
  if (!prepared) owner.commit(ticket)
  const capture = prepared ? owner.capturePrepared(ticket) : owner.capture()
  if (!prepared) owner.evict()
  return {
    owner,
    capture,
    source,
    document,
    ticket,
    build: (budget = limits) => {
      const plan = finishPackedSteps(
        buildPackedTranslationPlan(capture, source, path, budget, occurrence),
      )
      if (!plan) throw new Error('Missing packed translation plan')
      return plan
    },
    close() {
      capture.release()
      owner.dispose()
    },
  }
}

it.each(examples)(
  'preserves CommonMark $example: $section occurrence metadata and exact private bindings',
  (example) => {
    const f = fixture(example.markdown, 'commonmark')
    let plan: PackedTranslationPlan | undefined
    try {
      const before = f.owner.stats
      const native = extractTranslation(f.document.root, f.source.text, occurrence)
      plan = f.build()
      expect(plan.units).toEqual(native.units.map(({ bindings: _, ...unit }) => unit))
      expect(plan.units.every((unit) => !Object.hasOwn(unit, 'bindings'))).toBe(true)
      expect(plan.cost.retainedBytes).toBeLessThanOrEqual(limits.metadata)
      expect(plan.cost.peakBytes).toBeLessThanOrEqual(limits.retained)
      let index = 0
      const during = f.owner.stats
      finishPackedSteps(
        plan.inspectUnits(function* (unit, descriptor) {
          expect(unit).toEqual(native.units[index++])
          expect(descriptor.occurrenceId).toBe(unit.occurrenceId)
          yield
        }),
      )
      expect(index).toBe(native.units.length)
      expect(f.owner.stats).toEqual(during)
      plan.release()
      expect(f.owner.stats).toEqual(before)
    } finally {
      plan?.release()
      f.close()
    }
  },
)

it('shares provider payloads while reconstructing each occurrence with its own private nodes', async () => {
  const f = fixture(
    'Hello **world** `SECRET_A` [label](https://private.invalid/a).\n\nHello **world** `SECRET_B` [label](https://private.invalid/b).\n',
  )
  let plan: PackedTranslationPlan | undefined
  try {
    const native = extractTranslation(f.document.root, f.source.text, occurrence)
    plan = f.build()
    const first = plan.units[0]?.payload
    expect(first).toBeTruthy()
    expect(first).toBe(plan.units[1]?.payload)
    expect(Object.isFrozen(plan.units)).toBe(true)
    expect(plan.units.every((unit) => Object.isFrozen(unit) && Object.isFrozen(unit.path))).toBe(
      true,
    )
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.tokens)).toBe(true)
    expect(first?.tokens.every(Object.isFrozen)).toBe(true)
    const prepared = await prepareCanonicalTranslation(plan, fixtureSettings(), fixtureCapabilities)
    const expected = await prepareTranslation(native, fixtureSettings(), fixtureCapabilities)
    expect(prepared.jobs).toEqual(expected.jobs)
    expect(prepared.jobs).toHaveLength(1)
    expect(JSON.stringify(prepared.jobs)).not.toMatch(/SECRET|private\.invalid/)
    const output = `Translated ${first?.text}`
    let index = 0
    finishPackedSteps(
      plan.inspectUnits(function* (unit) {
        const expectedUnit = native.units[index++]
        if (!expectedUnit) throw new Error('Missing native occurrence')
        expect(reconstructUnit(unit as TranslationUnit, output)).toEqual(
          reconstructUnit(expectedUnit, output),
        )
        yield
      }),
    )
    expect(index).toBe(2)
  } finally {
    plan?.release()
    f.close()
  }
})

it.each(['commonmark', 'manuslip'] as const)(
  'preserves %s extension units, skipped protected-only leaves and oversized-unit errors',
  (syntax) => {
    const text = `---\ntitle: SECRET\n---\n\n> - Prose **strong**, $x^2$ and [label][r].\n\n| Hello | World |\n| - | - |\n| a | b |\n\nProse <span>SECRET **private**</span> after.\n\nOnly \\⟪marker⟫ and https://private.invalid/.\n\n\`protected only\`\n\n${'word '.repeat(15000)}\n\n[r]: https://private.invalid/\n\nNote[^n].\n\n[^n]: Footnote prose.\n`
    const f = fixture(text, syntax)
    let plan: PackedTranslationPlan | undefined
    try {
      const native = extractTranslation(f.document.root, text, occurrence)
      plan = f.build()
      expect(plan.units).toEqual(native.units.map(({ bindings: _, ...unit }) => unit))
      let index = 0
      finishPackedSteps(
        plan.inspectUnits(function* (unit) {
          expect(unit).toEqual(native.units[index++])
          yield
        }),
      )
      expect(index).toBe(native.units.length)
      expect(plan.units.some((unit) => unit.error === 'translation-unit-large')).toBe(true)
    } finally {
      plan?.release()
      f.close()
    }
  },
)

it('restores the live plan after inspector failure or cancellation and allows a fresh complete scan', () => {
  const f = fixture('First **private**.\n\nSecond paragraph.\n')
  const plan = f.build()
  try {
    const before = f.owner.stats
    for (const fail of [false, true]) {
      let entered = false
      const failure = new Error('Plan inspector failed')
      const work = plan.inspectUnits(function* () {
        entered = true
        yield
        throw failure
      })
      while (!entered) expect(work.next().done).toBe(false)
      if (fail) expect(() => work.next()).toThrow(failure)
      else work.return()
      expect(f.owner.stats).toEqual(before)
      expect(plan.units).toHaveLength(2)
    }
    let inspected = 0
    finishPackedSteps(
      plan.inspectUnits(function* () {
        inspected++
        yield
      }),
    )
    expect(inspected).toBe(2)
    expect(f.owner.stats).toEqual(before)
  } finally {
    plan.release()
    f.close()
  }
})

it('independently pins the old revision across parent closure and later session publications', () => {
  const f = fixture('Original **private** paragraph.\n')
  let plan: PackedTranslationPlan | undefined
  try {
    plan = f.build()
    const expected = JSON.stringify(plan.units)
    f.capture.release()
    const replacement = new PackedSource(
      { ...f.source.identity, revision: 1, sourceHash: sourceHash('Changed.\n') },
      'Changed.\n',
    )
    f.owner.commit(
      f.owner.prepareFull(
        f.owner.beginPrepared(replacement),
        replacement.identity,
        packValue({ document: { root: parseMarkdown(replacement.text).root } }, 8 * MiB),
      ),
    )
    expect(JSON.stringify(plan.units)).toBe(expected)
    let inspected = 0
    finishPackedSteps(
      plan.inspectUnits(function* (unit) {
        expect(unit.payload?.text).toBe('Original ⟪M0⟫private⟪M1⟫ paragraph.')
        inspected++
        yield
      }),
    )
    expect(inspected).toBe(1)
    f.owner.evict()
    plan.release()
    expect(f.owner.stats.retainedBytes).toBe(256)
  } finally {
    plan?.release()
    f.close()
  }
})

it.each(['before', 'validation', 'metadata'] as const)(
  'releases unfinished metadata and its capture when cancelled during %s',
  (phase) => {
    const f = fixture('Hello **world**.\n\nSecond paragraph.\n')
    try {
      const before = f.owner.stats
      let assigned = false
      const work = buildPackedTranslationPlan(f.capture, f.source, path, limits, (range) => {
        assigned = true
        return occurrence(range)
      })
      if (phase === 'validation') work.next()
      if (phase === 'metadata') {
        let steps = 0
        while (!assigned) {
          expect(work.next().done).toBe(false)
          expect(++steps).toBeLessThan(100000)
        }
        expect(f.owner.stats.readerStagingBytes).toBeGreaterThan(2 * MiB)
      }
      work.return()
      expect(work.next().done).toBe(true)
      expect(f.owner.stats).toEqual(before)
    } finally {
      f.close()
    }
  },
)

it('restores exact ownership after metadata admission and duplicate-ID failures', () => {
  const f = fixture('First paragraph.\n\nSecond paragraph.\n')
  try {
    const before = f.owner.stats
    expect(() => f.build({ ...limits, metadata: 4096 })).toThrow()
    expect(f.owner.stats).toEqual(before)
    expect(() =>
      finishPackedSteps(
        buildPackedTranslationPlan(f.capture, f.source, path, limits, () => 'duplicate'),
      ),
    ).toThrow('translation-invalid')
    expect(f.owner.stats).toEqual(before)
    const foreign = new PackedSource(f.source.identity, f.source.text)
    expect(() =>
      finishPackedSteps(buildPackedTranslationPlan(f.capture, foreign, path, limits)),
    ).toThrow()
    expect(f.owner.stats).toEqual(before)
  } finally {
    f.close()
  }
})

it.each(['release', 'dispose', 'discard'] as const)(
  'revokes suspended private inspection and closes the plan on %s',
  (action) => {
    const f = fixture('Hello **world** and `SECRET`.\n', 'manuslip', action === 'discard')
    const plan = f.build()
    try {
      let entered = false
      const work = plan.inspectUnits(function* () {
        entered = true
        yield
        throw new Error('Revoked inspector resumed')
      })
      while (!entered) expect(work.next().done).toBe(false)
      if (action === 'release') plan.release()
      else if (action === 'dispose') f.owner.dispose()
      else f.owner.discard(f.ticket)
      expect(work.next().done).toBe(true)
      expect(() => plan.units).toThrow(/released/)
      expect(() =>
        plan.inspectUnits(function* () {
          yield
        }),
      ).toThrow(/released/)
      expect(f.owner.stats.readerStagingBytes).toBe(0)
      expect(f.owner.stats.readers).toBe(0)
    } finally {
      plan.release()
      f.close()
    }
  },
)

it('finishes revoking every inspection when an inspector throws during cancellation', () => {
  const f = fixture('Hello **world**.\n')
  const before = f.owner.stats
  const plan = f.build()
  const failure = new Error('Inspector cleanup failure')
  const rejectCleanup = () => {
    throw failure
  }
  const work = plan.inspectUnits(function* () {
    try {
      yield
    } finally {
      rejectCleanup()
    }
  })
  const queued = plan.inspectUnits(function* () {
    yield
    throw new Error('Revoked queued inspection started')
  })
  try {
    let steps = 0
    while (f.owner.stats.readerStagingBytes < 2 * MiB) {
      expect(work.next().done).toBe(false)
      expect(++steps).toBeLessThan(100000)
    }
    // The projector and inspector start in this same advance; its cleanup must throw.
    expect(() => plan.release()).toThrow(failure)
    expect(work.next().done).toBe(true)
    expect(queued.next().done).toBe(true)
    expect(f.owner.stats).toEqual(before)
  } finally {
    plan.release()
    f.close()
  }
})

// Keep the complete one-MiB nested fixture, native extraction and all 6,299 private-unit reads.
it('keeps all complete nested occurrences and rehydrates every unit within the original session limits', () => {
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  const f = fixture(text)
  let plan: PackedTranslationPlan | undefined
  try {
    const before = f.owner.stats
    const native = extractTranslation(f.document.root, text, occurrence)
    plan = f.build()
    expect(plan.units).toHaveLength(6299)
    expect(plan.cost.extraction.payloadBytes).toBe(native.payloadBytes)
    expect(plan.cost.uniquePayloads).toBe(3)
    expect(plan.cost.retainedBytes).toBeLessThan(limits.metadata)
    expect(plan.cost.peakBytes).toBeLessThan(limits.retained)
    const retained = f.owner.stats
    let index = 0
    // Check every field directly instead of serializing and hashing both units for each occurrence.
    finishPackedSteps(
      plan.inspectUnits(function* (unit) {
        deepStrictEqual(unit, native.units[index++])
        yield
      }),
    )
    expect(index).toBe(native.units.length)
    expect(f.owner.stats).toEqual(retained)
    plan.release()
    expect(f.owner.stats).toEqual(before)
  } finally {
    plan?.release()
    f.close()
  }
}, 60_000)

it.each(['cancel', 'release', 'dispose', 'throw'] as const)(
  'revokes borrowed projections and restores ownership after %s',
  (action) => {
    const f = fixture('First **private** `SECRET_A`.\n\nSecond **private** `SECRET_B`.\n')
    const plan = f.build()
    const before = f.owner.stats
    let held: { status(index: number): string } | undefined
    let entered = false
    const failure = new Error('Projection inspector failed')
    const work = plan.inspectProjection(
      (unit) => unit.payload?.text,
      limits,
      function* (projection) {
        held = projection
        entered = true
        yield
        if (action === 'throw') throw failure
      },
    )
    try {
      while (!entered) expect(work.next().done).toBe(false)
      expect(held?.status(0)).toBe('translated')
      if (action === 'release') plan.release()
      else if (action === 'dispose') f.owner.dispose()
      else if (action === 'throw') expect(() => work.next()).toThrow(failure)
      else work.return()
      expect(work.next().done).toBe(true)
      expect(() => held?.status(0)).toThrow('closed')
      if (action === 'cancel' || action === 'throw') expect(f.owner.stats).toEqual(before)
    } finally {
      work.return()
      plan.release()
      f.close()
    }
    expect(f.owner.stats.retainedBytes).toBe(0)
  },
)

it('rejects projection metadata/scratch before allocation and restores a usable plan', () => {
  const f = fixture('First **private** `SECRET`.\n')
  const plan = f.build()
  const before = f.owner.stats
  try {
    for (const budget of [
      { retained: 0, staging: 0 },
      { retained: 8192, staging: 0 },
    ]) {
      expect(() =>
        finishPackedSteps(
          plan.inspectProjection(
            (unit) => unit.payload?.text,
            budget,
            function* () {
              yield
              throw new Error('Unexpected inspector')
            },
          ),
        ),
      ).toThrow('workspace limit')
      expect(f.owner.stats).toEqual(before)
    }
    finishPackedSteps(
      plan.inspectProjection(
        (unit) => unit.payload?.text,
        limits,
        function* (projection) {
          expect(projection.status(0)).toBe('translated')
          yield
        },
      ),
    )
    expect(f.owner.stats).toEqual(before)
  } finally {
    plan.release()
    f.close()
  }
})
