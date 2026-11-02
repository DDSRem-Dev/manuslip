import { parseMarkdown, semanticLimits } from '@manuslip/core'
import { createSourceState } from '@manuslip/editor'
import { expect, it } from 'vitest'
import { PackedSession } from '../../../../../../../packages/core/src/packing-session'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import { prepareOwnedPreview } from '../../../../../src/renderer/src/preview/owned-preparation'

const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
function fixture() {
  const text = `# Heading\n\n${'Same paragraph.\n\n'.repeat(160)}\n\n~~~js\nlet x = 1\n~~~`
  const source = createSourceState(text).doc
  const document = parseMarkdown(text)
  const { projection, layout } = renderProjectionLayout(
    document.root,
    options,
    semanticLimits.rendererBytes,
  )
  const snapshot = {
    document,
    projection,
    layout,
    bytes: 100,
    cached: false,
    serializeMs: 0,
    transportInMs: 0,
  }
  const owner = new PackedSession({
    bytes: semanticLimits.messageBytes,
    retained: semanticLimits.rendererBytes,
    staging: semanticLimits.messageBytes,
    captures: 8,
    readers: 160,
  })
  return { owner, snapshot, source }
}

it.each([
  { phase: 'encoder construction', nodes: 80000, error: 'encoding exceeds working' },
  { phase: 'native output', nodes: 16000, error: 'native copy exceeds workspace' },
])(
  'rejects $phase exhaustion and preserves the current preview',
  ({ nodes, error }) => {
    const { owner, snapshot, source } = fixture()
    const previous = finishPackedSteps(
      prepareOwnedPreview(owner, snapshot, source, 'test', 0, options),
    )
    if (!previous) throw new Error('Missing predecessor')
    expect(previous.commit()).toBe(true)
    const before = owner.stats
    // The native-output case matches the packaged fallback document. The larger direct
    // fixture exceeds ordinary JSON message admission; it exercises real encoder working
    // exhaustion and predecessor rollback, rather than claiming a reachable transport path.
    const text = `# Inline pressure\n\n${'**x** '.repeat(nodes)}\n\nComplete tail 世界.\n`
    const document = parseMarkdown(text)
    const { projection, layout } = renderProjectionLayout(
      document.root,
      options,
      semanticLimits.rendererBytes,
    )
    const candidate = { ...snapshot, document, projection, layout }
    const work = prepareOwnedPreview(
      owner,
      candidate,
      createSourceState(text).doc,
      'test',
      1,
      options,
      previous,
    )
    try {
      expect(() => finishPackedSteps(work)).toThrow(error)
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats).toEqual(before)
      expect(previous.status.outline[0]?.text).toBe('Heading')
      expect(previous.model.blocks[0]?.value).toBe('let x = 1')
    } finally {
      work.return()
      previous.release()
      owner.dispose()
    }
  },
  30000,
)

it.each(['encoding', 'indexing', 'validation', 'native-output'] as const)(
  'cancels during %s, releases all candidate reservations and keeps its predecessor usable',
  (phase) => {
    const { owner, snapshot, source } = fixture()
    const previous = finishPackedSteps(
      prepareOwnedPreview(owner, snapshot, source, 'test', 0, options),
    )
    if (!previous) throw new Error('Missing predecessor')
    expect(previous.commit()).toBe(true)
    const baseline = owner.stats
    const work = prepareOwnedPreview(owner, snapshot, source, 'test', 1, options, previous)
    try {
      let reached = false
      for (let advances = 0; advances < 100000; advances++) {
        const step = work.next()
        if (step.done) throw new Error(`Finished before reaching ${phase}`)
        const stats = owner.stats
        reached =
          phase === 'encoding'
            ? advances > 20 && stats.requested === null
            : phase === 'indexing'
              ? stats.preparingPhase !== null
              : phase === 'validation'
                ? stats.captures > 0
                : stats.holds > baseline.holds
        if (reached) break
      }
      expect(reached).toBe(true)
      work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats).toEqual(baseline)
      expect(previous.status.outline[0]?.text).toBe('Heading')
      expect(previous.model.blocks[0]?.value).toBe('let x = 1')
      const replacement = finishPackedSteps(
        prepareOwnedPreview(owner, snapshot, source, 'test', 1, options, previous),
      )
      if (!replacement) throw new Error('Missing replacement')
      expect(replacement.commit()).toBe(true)
      previous.release()
      expect(replacement.status.outline[0]?.text).toBe('Heading')
      replacement.release()
      expect(owner.stats.retainedBytes).toBe(256)
    } finally {
      work.return()
      previous.release()
      owner.dispose()
    }
  },
)
