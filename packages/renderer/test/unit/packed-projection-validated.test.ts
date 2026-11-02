import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue, unpackValue } from '../../../core/src/packing'
import { PackedCapture, PackedReadScope } from '../../../core/src/packing-capture'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import * as definitions from '../../src/packed-projection-definitions'
import { encodeValidatedPackedProjectionSteps } from '../../src/packed-projection-validated'
import { encodePackedSnapshotSteps } from '../../src/packed-snapshot-encode'
import { renderProjectionLayout } from '../../src/projection-layout'
import { ProjectionSequence } from '../../src/projection-sequence'

vi.mock('../../src/packed-projection-definitions', { spy: true })

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, readers: 64, captures: 8 }
const budget = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const notes = `# Heading

Body [r][ref] with note[^a], another[^b], and repeated[^a].

> [nested]: /nested
>
> Nested [link][nested].

[ref]: /first
[ref]: /second

[^a]: First [link][ref] and nested call[^b].

    [inner]: /inside

[^b]: Second *note* 界😀.

Last [reference][inner].
`
function fixture(
  text = notes,
  syntax: 'commonmark' | 'manuslip' = 'manuslip',
  rawHtml = false,
  mutate?: (document: ReturnType<typeof parseMarkdown>) => void,
) {
  const document = parseMarkdown(text, syntax),
    render = { ...options, rawHtml }
  mutate?.(document)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'validated-projection',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession(limits),
    ticket = owner.beginPrepared(source)
  const capture = finishPackedSteps(owner.stageFullSteps(ticket, packValue(document, limits.bytes)))
  if (!capture) throw new Error('Missing capture')
  return { owner, ticket, capture, source, document, render }
}
function encode(context: ReturnType<typeof fixture>, local = budget) {
  return encodeValidatedPackedProjectionSteps(
    context.capture,
    context.source,
    ['root'],
    context.render,
    local,
    encoding,
    limits.bytes,
  )
}
function verify(context: ReturnType<typeof fixture>, local = budget) {
  const baseline = context.owner.stats
  const result = finishPackedSteps(encode(context, local))
  if (!result) throw new Error('Missing encoded projection')
  const payload = result.value.payload
  result.release()
  expect(context.owner.stats).toEqual(baseline)
  const spool = finishPackedSteps(context.owner.stageFullSteps(context.ticket, payload))
  if (!spool) throw new Error('Missing spool')
  try {
    const output = finishPackedSteps(
      encodePackedSnapshotSteps(context.capture, spool, limits.bytes, encoding, budget),
    )
    if (!output) throw new Error('Missing snapshot')
    try {
      const actual = unpackValue(output.value.payload, { ...limits, retained: 64 * MiB }).value
      const expected = renderProjectionLayout(context.document.root, context.render, 64 * MiB)
      expect(actual).toEqual({
        document: context.document,
        projection: { ...expected.projection, renderMs: expect.any(Number) },
        layout: expected.layout,
      })
    } finally {
      output.release()
    }
  } finally {
    spool.release()
  }
}

it.each(
  (['commonmark', 'manuslip'] as const).flatMap((syntax) =>
    [false, true].flatMap((rawHtml) =>
      [
        '',
        '\ufeff# 界😀\r\n\r\nBody [link](https://example.test) *emphasis*.\r\n',
        notes,
        'Term *界* :smile:\r\n: First **description**.\r\n\r\n    | A | B |\r\n    | - | - |\r\n    | : one | ^2^ |\r\n\r\nNext\r\n: Last [link][r].\r\n\r\n[r]: /target\r\n',
        '```seq\r\nparticipant 用户 as U\r\nU->Service: 你好\r\n```\r\n\r\n```FLOW\r\na=>start: 开始\r\nb=>end: 完成\r\na->b\r\n```\r\n',
        'H~2~O x^**2**^ ~a^b^:smile:~ :+1:\r\n\r\n| A | B |\r\n| - | - |\r\n| ^界^ | :heart: |\r\n',
        '| a | b |\n| - | - |\n| 1 | 2 |\n\n$$x^2$$\n\n```js\nconst a = 1\n```\n\n<div onclick="bad()">raw</div>',
      ].map((text) => ({ syntax, rawHtml, text })),
    ),
  ),
)(
  'matches the complete native packet without another context walk: %#',
  ({ syntax, rawHtml, text }) => {
    const context = fixture(text, syntax, rawHtml),
      walk = vi.mocked(definitions.packedProjectionDefinitions)
    walk.mockClear()
    try {
      verify(context)
      expect(walk).not.toHaveBeenCalled()
    } finally {
      context.owner.dispose()
    }
  },
)

it.each([
  (document: ReturnType<typeof parseMarkdown>) => {
    document.counts.words++
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    document.counts.characters++
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    const block = document.blocks[0]
    if (!block) throw new Error('Missing block')
    block.hash = 'wrong'
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    const node = document.root.children[0]
    if (!node?.position) throw new Error('Missing position')
    node.position.end.offset = 0
  },
  (document: ReturnType<typeof parseMarkdown>) => {
    const node = document.root.children[0]
    if (!node) throw new Error('Missing node')
    Object.assign(node, { unexpected: true })
  },
])('rejects complete-document corruption before rendering: %#', (mutate) => {
  const context = fixture(notes, 'manuslip', false, mutate),
    baseline = context.owner.stats
  const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
  try {
    expect(() => finishPackedSteps(encode(context))).toThrow()
    expect(convert).not.toHaveBeenCalled()
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    convert.mockRestore()
    context.owner.dispose()
  }
})

it.each(['local', 'collection'] as const)(
  'releases optional collection before the original %s fallback',
  (mode) => {
    const context = fixture(
      mode === 'local' ? '# Heading\n\nBody.' : `Call[^a].\n\n[^a]: ${'word '.repeat(40000)}`,
    )
    const walk = vi.mocked(definitions.packedProjectionDefinitions)
    walk.mockClear()
    try {
      verify(
        context,
        mode === 'local' ? { ...budget, retained: 8 * MiB, staging: MiB, depth: 8 } : budget,
      )
      expect(walk).toHaveBeenCalled()
    } finally {
      context.owner.dispose()
    }
  },
)

it.each(
  (['queued', 'collection', 'render'] as const).flatMap((phase) =>
    (['cancel', 'capture', 'dispose'] as const).map((action) => ({ phase, action })),
  ),
)('revokes all borrowed work after $action during $phase', ({ phase, action }) => {
  const context = fixture(),
    baseline = context.owner.stats
  const selected = vi.spyOn(PackedReadScope.prototype, 'recordKey')
  const converted = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
  const reservation = vi.spyOn(PackedCapture.prototype, 'reserveWorkspace')
  const work = encode(context)
  try {
    expect(reservation).not.toHaveBeenCalled()
    if (phase !== 'queued') {
      const calls = phase === 'collection' ? selected.mock.calls : converted.mock.calls
      let advances = 0
      while (!calls.length) {
        expect(work.next().done).toBe(false)
        if (++advances > 100000) throw new Error('Missing observed phase')
      }
    }
    if (action === 'cancel') {
      work.return()
      expect(context.owner.stats).toEqual(baseline)
    } else if (action === 'capture') context.capture.release()
    else context.owner.dispose()
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(context.owner.stats.readerStagingBytes).toBe(0)
  } finally {
    work.return()
    reservation.mockRestore()
    selected.mockRestore()
    converted.mockRestore()
    context.owner.dispose()
    expect(context.owner.stats.retainedBytes).toBe(0)
  }
})

it('copies all caller policy and limits before suspension', () => {
  const context = fixture(),
    path = ['root'],
    render = { ...context.render },
    local = { ...budget },
    construction = { ...encoding }
  const work = encodeValidatedPackedProjectionSteps(
    context.capture,
    context.source,
    path,
    render,
    local,
    construction,
    limits.bytes,
  )
  path[0] = 'missing'
  render.footnotesLabel = 'changed'
  local.nodes = 0
  local.staging = 0
  construction.nodes = 0
  try {
    const result = finishPackedSteps(work)
    expect(result).toBeDefined()
    result?.release()
  } finally {
    work.return()
    context.owner.dispose()
  }
})

it('propagates renderer failures without retrying the context walk', () => {
  const context = fixture(),
    baseline = context.owner.stats,
    walk = vi.mocked(definitions.packedProjectionDefinitions)
  const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps').mockImplementation(() => {
    throw new Error('renderer sentinel')
  })
  walk.mockClear()
  try {
    expect(() => finishPackedSteps(encode(context))).toThrow('renderer sentinel')
    expect(walk).not.toHaveBeenCalled()
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    convert.mockRestore()
    context.owner.dispose()
  }
})

it('retains independent output after the validating capture is released', () => {
  const context = fixture(),
    result = finishPackedSteps(encode(context))
  if (!result) throw new Error('Missing output')
  try {
    context.capture.release()
    expect(result.value.payload.byteLength).toBeGreaterThan(0)
    expect(context.owner.stats.readerStagingBytes).toBe(0)
  } finally {
    result.release()
    context.owner.dispose()
    expect(context.owner.stats.retainedBytes).toBe(0)
  }
})

it.each(['nodes', 'working', 'wire'] as const)(
  'preserves encoder %s exhaustion and cleanup',
  (dimension) => {
    const context = fixture(),
      baseline = context.owner.stats
    const construction = { ...encoding, ...(dimension === 'wire' ? {} : { [dimension]: 1 }) }
    const work = encodeValidatedPackedProjectionSteps(
      context.capture,
      context.source,
      ['root'],
      context.render,
      budget,
      construction,
      dimension === 'wire' ? 4 : limits.bytes,
    )
    try {
      expect(() => finishPackedSteps(work)).toThrow()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      work.return()
      context.owner.dispose()
    }
  },
)
