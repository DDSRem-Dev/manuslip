import { createSourceState, OccurrenceTracker } from '@manuslip/editor'
import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../../../../../../packages/core/src/contracts'
import { packValue } from '../../../../../../../packages/core/src/packing'
import { PackedSession } from '../../../../../../../packages/core/src/packing-session'
import { PackedSource } from '../../../../../../../packages/core/src/packing-source'
import { finishPackedSteps } from '../../../../../../../packages/core/src/packing-work'
import { parseMarkdown } from '../../../../../../../packages/core/src/parse'
import { rendererVersion } from '../../../../../../../packages/renderer/src/index'
import { renderProjectionLayout } from '../../../../../../../packages/renderer/src/projection-layout'
import { OwnedPackedPreview } from '../../../../../src/renderer/src/preview/packed-preparation'
import { preparePreview } from '../../../../../src/renderer/src/preview/preparation'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const session = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
const text =
  '# Heading 世界\n\n~~~js\nlet x = 1\n~~~\n\n' +
  'Same paragraph.\n\n'.repeat(160) +
  '~~~js\nlet x = 2\n~~~\n'
function fixture() {
  const owner = new PackedSession(session)
  const install = (sourceText = text, revision = 0, documentId = 'owned-preview') => {
    const document = parseMarkdown(sourceText)
    const { projection, layout } = renderProjectionLayout(document.root, options, session.bytes)
    const source = new PackedSource(
      {
        generation: 1,
        revision,
        documentId,
        sourceHash: sourceHash(sourceText),
        parserVersion: document.parserVersion,
        rendererVersion,
        options: JSON.stringify(options),
      },
      sourceText,
    )
    owner.commit(
      owner.prepareFull(
        owner.beginPrepared(source),
        source.identity,
        packValue({ snapshot: { document, projection, layout } }, session.bytes),
      ),
    )
    const capture = owner.capture(),
      state = createSourceState(sourceText)
    return { source, capture, state, snapshot: { document, projection, layout } }
  }
  const first = install()
  const prepare = (context = first, previous?: OwnedPackedPreview) =>
    OwnedPackedPreview.prepare(
      context.capture,
      context.source,
      context.state.doc,
      ['snapshot'],
      options,
      limits,
      previous,
    )
  return { owner, install, first, prepare }
}
function complete(work: ReturnType<typeof OwnedPackedPreview.prepare>) {
  const result = finishPackedSteps(work)
  if (!result) throw new Error('Missing owned preview')
  return result
}
describe('independently owned packed application preview', () => {
  it('admits the complete candidate weight and ends only its old-range reservation at commit', () => {
    const f = fixture()
    try {
      const previous = complete(f.prepare())
      expect(previous.commit()).toBe(true)
      const next = f.install(text.replace('Heading', 'Updated heading'), 1)
      const candidate = complete(f.prepare(next, previous))
      const oldBytes = f.first.state.doc.length * 2 + previous.model.blocks.length * 1024
      const persistent = 65536 + next.state.doc.length * 2 + candidate.model.blocks.length * 1024
      expect(candidate.cost).toBeGreaterThanOrEqual(persistent + oldBytes)
      const before = f.owner.stats,
        cost = candidate.cost
      expect(candidate.commit()).toBe(true)
      expect(candidate.cost).toBe(cost - oldBytes)
      // Same admission constants; the separate native resource and hold metadata end too.
      expect(before.retainedBytes - f.owner.stats.retainedBytes).toBe(oldBytes + 512)
      expect(candidate.commit()).toBe(false)
      expect(f.owner.stats.holds).toBe(before.holds - 1)
      expect(previous.model.blocks).toHaveLength(2)
      candidate.release()
      previous.release()
    } finally {
      f.owner.dispose()
    }
  })

  it('keeps abandoned candidate storage through every read-only lease', () => {
    const f = fixture()
    try {
      const previous = complete(f.prepare())
      expect(previous.commit()).toBe(true)
      const next = f.install(text.replace('Heading', 'Updated heading'), 1)
      const candidate = complete(f.prepare(next, previous)),
        first = candidate.retain(),
        pending = first.retain()
      previous.map(f.first.state.update({}).changes)
      const before = f.owner.stats,
        cost = candidate.cost
      expect(candidate.commit()).toBe(false)
      expect(candidate.cost).toBe(cost)
      expect(f.owner.stats).toEqual(before)
      previous.release()
      candidate.release()
      candidate.release()
      f.first.capture.release()
      next.capture.release()
      f.owner.evict()
      expect(f.owner.stats.holds).toBe(5)
      first.release()
      first.release()
      expect(f.owner.stats.holds).toBe(3)
      expect(pending.model.blocks).toHaveLength(2)
      expect(pending.status.outline[0]?.text).toBe('Updated heading 世界')
      const additional = pending.retain()
      pending.release()
      expect(f.owner.stats.holds).toBe(3)
      additional.release()
      expect(f.owner.stats).toMatchObject({ retainedBytes: 256, holds: 0, readers: 0 })
    } finally {
      f.owner.dispose()
    }
  })

  it('commits candidate leases together while keeping an older installed consumer independent', () => {
    const f = fixture()
    try {
      const previous = complete(f.prepare()),
        oldConsumer = previous.retain()
      expect(previous.commit()).toBe(true)
      const next = f.install(text.replace('Heading', 'Updated heading'), 1)
      const candidate = complete(f.prepare(next, previous)),
        dom = candidate.retain(),
        pending = dom.retain()
      const before = f.owner.stats
      const oldBytes = f.first.state.doc.length * 2 + previous.model.blocks.length * 1024
      expect(candidate.commit()).toBe(true)
      expect(before.retainedBytes - f.owner.stats.retainedBytes).toBe(oldBytes + 512)
      previous.release()
      candidate.release()
      f.first.capture.release()
      next.capture.release()
      f.owner.evict()
      expect(oldConsumer.status.outline[0]?.text).toBe('Heading 世界')
      expect(dom.status.outline[0]?.text).toBe('Updated heading 世界')
      dom.release()
      pending.release()
      expect(f.owner.stats.holds).toBe(2)
      oldConsumer.release()
      expect(f.owner.stats).toMatchObject({ retainedBytes: 256, holds: 0, readers: 0 })
    } finally {
      f.owner.dispose()
    }
  })

  it('rolls back a failed candidate lease acquisition without dropping its reservation', () => {
    const f = fixture()
    try {
      const previous = complete(f.prepare())
      expect(previous.commit()).toBe(true)
      const next = f.install(text, 1),
        candidate = complete(f.prepare(next, previous))
      while (f.owner.stats.holds < 255) f.owner.own({}, 0)
      const before = f.owner.stats
      expect(() => candidate.retain()).toThrow(/hold limit/)
      expect(f.owner.stats).toEqual(before)
      expect(candidate.model.blocks).toHaveLength(2)
      candidate.release()
      previous.release()
    } finally {
      f.owner.dispose()
    }
  })

  it('releases the full admitted fork when preparation closes before handoff', () => {
    const f = fixture()
    try {
      const previous = complete(f.prepare())
      expect(previous.commit()).toBe(true)
      const next = f.install(text, 1),
        before = f.owner.stats,
        work = f.prepare(next, previous)
      while (f.owner.stats.holds < before.holds + 3) expect(work.next().done).toBe(false)
      expect(f.owner.stats.holds).toBe(before.holds + 3)
      work.return()
      expect(f.owner.stats).toEqual(before)
      expect(previous.model.blocks).toHaveLength(2)
      previous.release()
    } finally {
      f.owner.dispose()
    }
  })

  it('pins the complete root for reading independently of the preview and widget leases', () => {
    const f = fixture()
    try {
      const preview = complete(
        OwnedPackedPreview.prepare(
          f.first.capture,
          f.first.source,
          f.first.state.doc,
          ['snapshot'],
          options,
          limits,
          undefined,
          {},
          true,
        ),
      )
      const dom = preview.retain()
      f.first.capture.release()
      f.owner.evict()
      const reading = preview.captureRoot()
      expect(reading).toBeDefined()
      preview.release()
      expect(() => preview.captureRoot()).toThrow(/released/)
      expect(f.owner.stats.captures).toBe(1)
      expect(reading?.capture.reader.at(reading.path).length(['children'])).toBe(
        f.first.snapshot.document.root.children.length,
      )
      reading?.capture.release()
      expect(f.owner.stats.captures).toBe(0)
      expect(dom.model.blocks).toHaveLength(2)
      dom.release()
      expect(f.owner.stats).toMatchObject({ retainedBytes: 256, holds: 0, captures: 0, readers: 0 })
    } finally {
      f.owner.dispose()
    }
  })
  it('releases a pending root pin when owned preparation cancels before handoff', () => {
    const f = fixture()
    try {
      const baseline = f.owner.stats
      const work = OwnedPackedPreview.prepare(
        f.first.capture,
        f.first.source,
        f.first.state.doc,
        ['snapshot'],
        options,
        limits,
        undefined,
        {},
        true,
      )
      while (f.owner.stats.captures === baseline.captures) {
        if (work.next().done) throw new Error('Missing final root cancellation checkpoint')
      }
      work.return()
      expect(f.owner.stats).toEqual(baseline)
    } finally {
      f.owner.dispose()
    }
  })
  it('keeps read-only DOM and pending-work leases independently of the controller handle', () => {
    const context = fixture()
    try {
      const preview = complete(context.prepare())
      expect(preview.commit()).toBe(true)
      const model = preview.model,
        status = preview.status,
        before = context.owner.stats
      const dom = preview.retain(),
        pending = dom.retain()
      expect(context.owner.stats.retainedBytes - before.retainedBytes).toBe(1280)
      expect('map' in dom || 'commit' in dom).toBe(false)
      preview.release()
      context.first.capture.release()
      context.owner.evict()
      expect(() => preview.model).toThrow(/released/)
      expect(() => preview.retain()).toThrow(/released/)
      expect(dom.model).toBe(model)
      expect(pending.status).toBe(status)
      dom.release()
      dom.release()
      expect(() => dom.retain()).toThrow(/released/)
      expect(pending.model).toBe(model)
      expect(context.owner.stats.holds).toBe(2)
      context.owner.dispose()
      expect(() => pending.model).toThrow(/released/)
      expect(() => pending.status).toThrow(/released/)
      pending.release()
      expect(context.owner.stats.retainedBytes).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
  it('rolls back a partial consumer lease when the second native hold reaches the limit', () => {
    const context = fixture()
    try {
      const preview = complete(context.prepare())
      expect(preview.commit()).toBe(true)
      while (context.owner.stats.holds < 255) context.owner.own({}, 0)
      const before = context.owner.stats
      expect(() => preview.retain()).toThrow(/hold limit/)
      expect(context.owner.stats).toEqual(before)
      expect(preview.model.blocks).toHaveLength(2)
    } finally {
      context.owner.dispose()
    }
  })
  it('keeps the actual model, status and occurrence index after capture closure/base eviction', () => {
    const context = fixture(),
      tracker = new OccurrenceTracker()
    try {
      const native = finishPackedSteps(
        preparePreview(context.first.snapshot, context.first.state.doc, tracker),
      )
      const work = context.prepare(),
        preview = complete(work)
      expect(preview.model.blocks.map(({ id, ...block }) => block)).toEqual(
        native.model.blocks.map(({ id, ...block }) => block),
      )
      expect(preview.status).toEqual(native.status)
      expect(preview.commit()).toBe(true)
      expect(preview.commit()).toBe(false)
      const model = preview.model
      context.first.capture.release()
      context.owner.evict()
      expect(context.owner.stats.holds).toBe(2)
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.retainedBytes).toBeGreaterThan(preview.cost)
      expect(preview.model).toBe(model)
      expect(preview.status.outline).toEqual(context.first.snapshot.document.outline)
      expect(work.next().done).toBe(true)
      preview.release()
      preview.release()
      expect(() => preview.model).toThrow(/released/)
      expect(context.owner.stats.retainedBytes).toBe(256)
    } finally {
      tracker.reset()
      context.owner.dispose()
    }
  })
  it('prepares successive edits without changing the old model and preserves exact mapped widget IDs', () => {
    const context = fixture()
    try {
      const first = complete(context.prepare())
      expect(first.commit()).toBe(true)
      const oldModel = first.model,
        oldStatus = first.status
      const transaction = context.first.state.update({ changes: { from: 0, insert: 'Intro.\n\n' } })
      first.map(transaction.changes)
      const next = context.install(transaction.state.doc.toString(), 1)
      const second = complete(context.prepare(next, first))
      expect(first.model).toBe(oldModel)
      expect(first.status).toBe(oldStatus)
      expect(second.model.blocks.map((block) => block.id)).toEqual(
        first.model.blocks.map((block) => block.id),
      )
      expect(second.model.blocks.map((block) => block.from)).toEqual(
        first.model.blocks.map((block) => block.from + 8),
      )
      expect(second.commit()).toBe(true)
      first.release()
      context.first.capture.release()
      next.capture.release()
      context.owner.evict()
      expect(second.status.characterCount).toBe([...next.source.text].length)
      expect(second.model.blocks).toHaveLength(2)
      second.release()
      expect(context.owner.stats.retainedBytes).toBe(256)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['preparing', 'awaiting commit'] as const)(
    'rejects a replacement superseded while %s',
    (phase) => {
      const context = fixture()
      try {
        const first = complete(context.prepare())
        expect(first.commit()).toBe(true)
        const before = context.owner.stats,
          work = context.prepare(context.first, first)
        let second: OwnedPackedPreview | undefined
        if (phase === 'preparing') expect(work.next().done).toBe(false)
        else second = complete(work)
        first.map(context.first.state.update({}).changes)
        if (second) {
          expect(second.commit()).toBe(false)
          expect(second.commit()).toBe(false)
          second.release()
        } else expect(() => complete(work)).toThrow(/Superseded/)
        expect(context.owner.stats).toEqual(before)
        expect(first.model.blocks).toHaveLength(2)
        first.release()
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('accepts only one of two replacements prepared against the same predecessor', () => {
    const context = fixture()
    try {
      const previous = complete(context.prepare())
      expect(previous.commit()).toBe(true)
      const first = complete(context.prepare(context.first, previous))
      const second = complete(context.prepare(context.first, previous))
      expect(first.commit()).toBe(true)
      expect(second.commit()).toBe(false)
      expect(second.commit()).toBe(false)
      expect(previous.model.blocks).toHaveLength(2)
      expect(first.model.blocks).toHaveLength(2)
      second.release()
      first.release()
      previous.release()
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'capture', 'owner'] as const)(
    'cleans partial occurrence/model ownership on %s',
    (action) => {
      const context = fixture(),
        before = context.owner.stats,
        work = context.prepare()
      try {
        while (context.owner.stats.holds < 2) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        if (action === 'capture') context.first.capture.release()
        if (action === 'owner') context.owner.dispose()
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.holds).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
        if (action === 'owner') expect(context.owner.stats.retainedBytes).toBe(0)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  it('revokes completed model handles on disposal without advancing the completed work', () => {
    const context = fixture(),
      work = context.prepare(),
      preview = complete(work)
    context.owner.dispose()
    expect(() => preview.model).toThrow(/released/)
    expect(() => preview.status).toThrow(/released/)
    expect(() => preview.commit()).toThrow(/released/)
    expect(context.owner.stats.retainedBytes).toBe(0)
    preview.release()
    expect(work.next().done).toBe(true)
  })
  it('rejects different editor source, even at the same length, without native output', () => {
    const context = fixture(),
      before = context.owner.stats
    try {
      const work = OwnedPackedPreview.prepare(
        context.first.capture,
        context.first.source,
        createSourceState(text.replace('Heading', 'Changed')).doc,
        ['snapshot'],
        options,
        limits,
      )
      expect(() => complete(work)).toThrow(/editor source mismatch/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects a previous model from another owner or document without altering it', () => {
    const context = fixture(),
      foreign = fixture()
    try {
      const previous = complete(context.prepare())
      expect(previous.commit()).toBe(true)
      const before = foreign.owner.stats
      expect(() => complete(foreign.prepare(foreign.first, previous))).toThrow(/owner mismatch/)
      expect(foreign.owner.stats).toEqual(before)
      const other = context.install(text, 1, 'other-document'),
        ownBefore = context.owner.stats
      expect(() => complete(context.prepare(other, previous))).toThrow(/document mismatch/)
      expect(context.owner.stats).toEqual(ownBefore)
      expect(previous.status.wordCount).toBeGreaterThan(0)
      previous.release()
    } finally {
      context.owner.dispose()
      foreign.owner.dispose()
    }
  })
  // The complete 4,000-block old model must remain live throughout capacity admission.
  it('rejects aggregate model capacity after complete input admission and keeps the old model usable', () => {
    const context = fixture()
    try {
      const older = context.install('~~~text\np\n~~~\n\n'.repeat(4000))
      const previous = complete(context.prepare(older))
      expect(previous.commit()).toBe(true)
      const current = context.install(text, 1)
      // Leave room for complete validation/copying but less than the independently
      // charged replacement index/model. The held old model remains in the ledger.
      const hold = context.owner.retain({
        resources: () => [
          { key: {}, bytes: session.retained - context.owner.stats.retainedBytes - 3 * MiB },
        ],
      })
      const before = context.owner.stats,
        work = context.prepare(current, previous)
      let admittedInput = false
      try {
        while (true) {
          const next = work.next()
          if (context.owner.stats.holds === before.holds + 1) admittedInput = true
          if (next.done) throw new Error('Unexpected model capacity')
        }
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/retained limit/)
      }
      expect(admittedInput).toBe(true)
      expect(context.owner.stats).toEqual(before)
      expect(previous.model.blocks).toHaveLength(4000)
      expect(previous.status.wordCount).toBe(0)
      hold.release()
      previous.release()
    } finally {
      context.owner.dispose()
    }
  }, 15_000)
})
