import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedDocumentBaseline } from '../../../core/src/packing-document-baseline'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { PackedWordBaseline } from '../../../core/src/packing-word-baseline'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 16 * MiB, staging: 2 * MiB, nodes: 800000, depth: 128 }
const session = { ...limits, retained: 32 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
function fixture(blocks = 4000) {
  const text = 'p\n\n'.repeat(blocks)
  const document = parseMarkdown(text)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'dense-cache',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession(session)
  const { projection, layout } = renderProjectionLayout(document.root, options, 8 * MiB)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ document, projection, layout }, 8 * MiB),
    ),
  )
  const capture = owner.capture()
  function create(kind: string, budget = limits) {
    if (kind === 'document')
      return PackedDocumentBaseline.create(capture, source, ['document'], budget)
    if (kind === 'words') return PackedWordBaseline.create(capture, source, ['document'], budget)
    return PackedProjectionBaseline.create(capture, source, [], options, budget)
  }
  return { owner, capture, source, create }
}

describe('persistent baseline admission with bounded construction scratch', () => {
  // These dense fixtures must retain more than 2 MiB of metadata; their complete
  // construction/cancellation paths need a local deadline, not smaller documents.
  it.each(['document', 'projection', 'words'])(
    'keeps every %s cache byte retained when metadata exceeds staging',
    (kind) => {
      const context = fixture(kind === 'words' ? 8000 : 4000)
      const before = context.owner.stats
      const work = context.create(kind)
      let maximumStaging = 0
      let maximumRetained = 0
      try {
        while (true) {
          const step = work.next()
          const stats = context.owner.stats
          maximumStaging = Math.max(maximumStaging, stats.readerStagingBytes)
          maximumRetained = Math.max(maximumRetained, stats.retainedBytes)
          if (!step.done) continue
          const baseline = step.value
          if (!baseline) throw new Error('Missing dense baseline')
          expect(maximumRetained).toBeLessThanOrEqual(session.retained)
          expect(context.owner.stats.retainedBytes - before.retainedBytes).toBeGreaterThan(
            limits.staging,
          )
          expect(maximumStaging).toBeGreaterThan(0)
          expect(maximumStaging).toBeLessThanOrEqual(limits.staging)
          expect(context.owner.stats.readerStagingBytes).toBe(0)
          if (baseline instanceof PackedDocumentBaseline) {
            expect(baseline.metadataRange(context.capture, ['document'], 0, 4000)?.blocks).toEqual({
              start: 0,
              remove: 4000,
              total: 4000,
            })
          } else if (baseline instanceof PackedWordBaseline) {
            expect(
              [
                ...(baseline.find(context.capture.reader.at(['document', 'root', 'children', 7999]))
                  ?.chunks ?? []),
              ].join(''),
            ).toBe('p')
          } else
            expect(
              baseline.validatesSnapshot(context.capture, context.source, [], options, limits),
            ).toBe(true)
          baseline.close()
          expect(context.owner.stats).toEqual(before)
          break
        }
      } finally {
        work.return()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
    30000,
  )
  it.each(['document', 'projection', 'words'])(
    'releases admitted %s maps when construction is cancelled',
    (kind) => {
      const context = fixture(kind === 'words' ? 8000 : 4000)
      const before = context.owner.stats
      const work = context.create(kind)
      try {
        let steps = 0
        let completed = false
        while (
          context.owner.stats.retainedBytes - before.retainedBytes <= limits.staging &&
          steps < 300000
        ) {
          steps++
          completed = work.next().done === true
          if (completed) break
        }
        expect(completed).toBe(false)
        expect(context.owner.stats.retainedBytes - before.retainedBytes).toBeGreaterThan(
          limits.staging,
        )
        work.return()
        expect(work.next().done).toBe(true)
        expect(context.owner.stats).toEqual(before)
        expect(() =>
          finishPackedSteps<unknown>(context.create(kind, { ...limits, retained: MiB })),
        ).toThrow(/limit/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
    30000,
  )
})
