import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packStreamedValueSteps, packValue, unpackValue } from '../../../core/src/packing'
import { PackedCapture } from '../../../core/src/packing-capture'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { PackedWorkspace } from '../../../core/src/packing-workspace'
import { parseMarkdown } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import * as definitions from '../../src/packed-projection-definitions'
import { PackedProjectionJournal } from '../../src/packed-projection-journal'
import type { PackedProjectionPlan } from '../../src/packed-projection-plan'
import { prepareValidatedPackedProjectionPlan } from '../../src/packed-projection-plan-validated'
import { renderProjectionLayout } from '../../src/projection-layout'
import { ProjectionSequence } from '../../src/projection-sequence'

vi.mock('../../src/packed-projection-definitions', { spy: true })

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, readers: 64, captures: 8 }
const budget = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const complete = `---
title: Test
---

# 界😀 Heading

> [nested]: /nested
>
> Nested [link][nested] and note[^a].

| a | b |
| - | - |
| ![image](/image) | $x^2$ |

~~~js
const text = '<&>😀'
~~~

$$x+y$$

<div onclick="bad()">raw HTML</div>

[ref]: /first
[ref]: /second

Last [link][ref] and repeated[^a].

[^a]: First *note* and nested[^b].
[^b]: Second note.
`

function fixture(
  text = complete,
  syntax: 'commonmark' | 'manuslip' = 'manuslip',
  rawHtml = false,
  mutate?: (document: ReturnType<typeof parseMarkdown>) => void,
) {
  const document = parseMarkdown(text, syntax)
  mutate?.(document)
  const render = { ...options, rawHtml }
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'projection-plan',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession(limits)
  const ticket = owner.beginPrepared(source)
  const capture = finishPackedSteps(owner.stageFullSteps(ticket, packValue(document, limits.bytes)))
  if (!capture) throw new Error('Missing document capture')
  const prepare = () =>
    prepareValidatedPackedProjectionPlan(capture, source, ['root'], render, budget)
  return { document, render, source, owner, capture, prepare }
}

function encode(plan: PackedProjectionPlan, construction = encoding) {
  return packStreamedValueSteps(
    { projection: plan.projection, layout: plan.layout },
    limits.bytes,
    construction,
    plan.arrays,
    undefined,
    plan.captures,
  )
}

it.each(
  (['commonmark', 'manuslip'] as const).flatMap((syntax) =>
    [false, true].flatMap((rawHtml) =>
      ['', '\ufeff# 界😀\r\n\r\nText \ud800 and \udfff.\r\n', complete, complete.repeat(20)].map(
        (text) => ({ syntax, rawHtml, text }),
      ),
    ),
  ),
)(
  'matches every native byte without an intermediate event packet: %#',
  ({ syntax, rawHtml, text }) => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const context = fixture(text, syntax, rawHtml)
    const baseline = context.owner.stats
    const stage = vi.spyOn(context.owner, 'stageFullSteps')
    const plan = finishPackedSteps(context.prepare())
    if (!plan) throw new Error('Missing projection plan')
    try {
      const actual = finishPackedSteps(encode(plan))
      if (!actual) throw new Error('Missing encoded projection')
      const { projection, layout } = renderProjectionLayout(
        context.document.root,
        context.render,
        64 * MiB,
      )
      const expected = { projection, layout }
      expect(unpackValue(actual, { ...limits, retained: 64 * MiB }).value).toEqual(expected)
      expect(new Uint8Array(actual)).toEqual(
        new Uint8Array(packValue(expected, limits.bytes, encoding)),
      )
      expect(stage).not.toHaveBeenCalled()
    } finally {
      plan.close()
      expect(context.owner.stats).toEqual(baseline)
      stage.mockRestore()
      context.owner.dispose()
      clock.mockRestore()
    }
  },
)

it('owns the completed plan after the original capture is released', () => {
  const context = fixture()
  const plan = finishPackedSteps(context.prepare())
  if (!plan) throw new Error('Missing projection plan')
  try {
    context.capture.release()
    const actual = finishPackedSteps(encode(plan))
    if (!actual) throw new Error('Missing independent output')
    const { projection, layout } = renderProjectionLayout(
      context.document.root,
      context.render,
      64 * MiB,
    )
    expect(unpackValue(actual, { ...limits, retained: 64 * MiB }).value).toEqual({
      layout,
      projection: { ...projection, renderMs: expect.any(Number) },
    })
  } finally {
    plan.close()
    context.owner.dispose()
    expect(context.owner.stats.retainedBytes).toBe(0)
  }
})

it.each([
  (document: ReturnType<typeof parseMarkdown>) => {
    document.counts.words++
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    document.counts.characters++
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    const block = document.blocks[0]
    if (block) block.hash = 'wrong'
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    const node = document.root.children[0]
    if (node) Object.assign(node, { unexpected: true })
  },
])('rejects complete-document corruption before rendering: %#', (mutate) => {
  const context = fixture(complete, 'manuslip', false, mutate)
  const baseline = context.owner.stats
  const converted = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
  try {
    expect(() => finishPackedSteps(context.prepare())).toThrow()
    expect(converted).not.toHaveBeenCalled()
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    converted.mockRestore()
    context.owner.dispose()
  }
})

it('keeps the independent complete validation/context fallback', () => {
  const context = fixture('# Heading\n\nBody.')
  const walk = vi.mocked(definitions.packedProjectionDefinitions)
  walk.mockClear()
  const work = prepareValidatedPackedProjectionPlan(
    context.capture,
    context.source,
    ['root'],
    context.render,
    { ...budget, retained: 8 * MiB, staging: MiB, depth: 8 },
  )
  let plan: PackedProjectionPlan | undefined
  try {
    plan = finishPackedSteps(work)
    if (!plan) throw new Error('Missing fallback plan')
    expect(walk).toHaveBeenCalled()
    const actual = finishPackedSteps(encode(plan))
    if (!actual) throw new Error('Missing fallback output')
    const { projection, layout } = renderProjectionLayout(
      context.document.root,
      context.render,
      64 * MiB,
    )
    expect(unpackValue(actual, { ...limits, retained: 64 * MiB }).value).toEqual({
      projection: { ...projection, renderMs: expect.any(Number) },
      layout,
    })
  } finally {
    work.return()
    plan?.close()
    context.owner.dispose()
  }
})

it.each(['queued', 'render'] as const)(
  'closes all native storage when cancelled during %s',
  (phase) => {
    const context = fixture()
    const baseline = context.owner.stats
    const converted = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    const work = context.prepare()
    try {
      if (phase === 'render') {
        let advances = 0
        while (!converted.mock.calls.length) {
          expect(work.next().done).toBe(false)
          if (++advances > 100000) throw new Error('Missing render phase')
        }
      }
      work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      work.return()
      converted.mockRestore()
      context.owner.dispose()
    }
  },
)

it.each(['plan', 'owner'] as const)('rejects a revoked %s during final encoding', (action) => {
  const context = fixture()
  const plan = finishPackedSteps(context.prepare())
  if (!plan) throw new Error('Missing projection plan')
  const work = encode(plan)
  try {
    expect(work.next().done).toBe(false)
    if (action === 'plan') plan.close()
    else context.owner.dispose()
    expect(() => finishPackedSteps(work)).toThrow(/closed|cancelled|released/)
    expect(work.next()).toEqual({ done: true, value: undefined })
  } finally {
    work.return()
    plan.close()
    context.owner.dispose()
    expect(context.owner.stats.retainedBytes).toBe(0)
  }
})

it('releases every reservation when retaining the next chunk is refused', () => {
  const context = fixture()
  const baseline = context.owner.stats
  const original = PackedCapture.prototype.reserveWorkspace
  let refused = false
  const reservation = vi
    .spyOn(PackedCapture.prototype, 'reserveWorkspace')
    .mockImplementation(function (this: PackedCapture, retained, staging) {
      const workspace = original.call(this, retained, staging)
      if (retained !== 4096 || staging !== 0) return workspace
      return new PackedWorkspace(
        (bytes, scratch) => {
          refused = true
          throw new Error(`chunk admission refused ${bytes}/${scratch}`)
        },
        () => workspace.release(),
      )
    })
  try {
    expect(() => finishPackedSteps(context.prepare())).toThrow('chunk admission refused')
    expect(refused).toBe(true)
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    reservation.mockRestore()
    context.owner.dispose()
  }
})

it.each(['nodes', 'working'] as const)(
  'preserves final encoder %s exhaustion and cleanup',
  (dimension) => {
    const context = fixture()
    const baseline = context.owner.stats
    const plan = finishPackedSteps(context.prepare())
    if (!plan) throw new Error('Missing projection plan')
    let work: ReturnType<typeof encode> | undefined
    try {
      expect(() => {
        work = encode(plan, { ...encoding, [dimension]: 1 })
        return finishPackedSteps(work)
      }).toThrow(/limit/)
    } finally {
      work?.return()
      plan.close()
      expect(context.owner.stats).toEqual(baseline)
      context.owner.dispose()
    }
  },
)

it('closes a suspended large widget and can retry without retaining its partial text', () => {
  const context = fixture(`~~~js\n${'界😀<&'.repeat(4000)}\n~~~\n\nLast paragraph.\n`)
  const baseline = context.owner.stats
  const original = PackedProjectionJournal.prototype.widget
  let writing = false,
    closed = false
  const widget = vi
    .spyOn(PackedProjectionJournal.prototype, 'widget')
    .mockImplementation(function* (this: PackedProjectionJournal, block) {
      writing = true
      try {
        return yield* original.call(this, block)
      } finally {
        closed = true
      }
    })
  const work = context.prepare()
  let plan: PackedProjectionPlan | undefined
  try {
    let advances = 0
    while (!writing) {
      expect(work.next().done).toBe(false)
      if (++advances > 100000) throw new Error('Missing widget preparation')
    }
    expect(closed).toBe(false)
    work.return()
    expect(closed).toBe(true)
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(context.owner.stats).toEqual(baseline)
    widget.mockRestore()
    plan = finishPackedSteps(context.prepare())
    if (!plan) throw new Error('Missing retried projection plan')
    const output = finishPackedSteps(encode(plan))
    if (!output) throw new Error('Missing retried projection output')
    const actual = unpackValue(output, {
      bytes: limits.bytes,
      retained: 64 * MiB,
      staging: 8 * MiB,
    }).value as { projection: { html: string; blocks: unknown[] }; layout: unknown }
    const expected = renderProjectionLayout(context.document.root, context.render, 64 * MiB)
    expect(actual.projection.html).toBe(expected.projection.html)
    expect(actual.projection.blocks).toEqual(expected.projection.blocks)
    expect(actual.layout).toEqual(expected.layout)
  } finally {
    work.return()
    widget.mockRestore()
    plan?.close()
    expect(context.owner.stats).toEqual(baseline)
    context.owner.dispose()
  }
})

it('preserves a widget admission error and releases its suspended producer', () => {
  const context = fixture(`~~~js\n${'界😀<&'.repeat(4000)}\n~~~\n`)
  const baseline = context.owner.stats
  const original = PackedProjectionJournal.prototype.widget
  const failure = new Error('Widget admission refused')
  let writing = false,
    closed = false
  const widget = vi
    .spyOn(PackedProjectionJournal.prototype, 'widget')
    .mockImplementation(function* (this: PackedProjectionJournal, block) {
      writing = true
      try {
        return yield* original.call(this, block)
      } finally {
        writing = false
        closed = true
      }
    })
  const resize = PackedWorkspace.prototype.resize
  const reservation = vi.spyOn(PackedWorkspace.prototype, 'resize').mockImplementation(function (
    this: PackedWorkspace,
    retained,
    staging,
  ) {
    if (writing) throw failure
    return resize.call(this, retained, staging)
  })
  const work = context.prepare()
  try {
    expect(() => finishPackedSteps(work)).toThrow(failure)
    expect(closed).toBe(true)
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    work.return()
    reservation.mockRestore()
    widget.mockRestore()
    context.owner.dispose()
  }
})
