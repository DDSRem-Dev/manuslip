import { expect, it, vi } from 'vitest'
import { parserVersion, sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedCapture } from '../../../core/src/packing-capture'
import { packMarkdownDocumentSteps } from '../../../core/src/packing-markdown'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { validatePackedDocument } from '../../../core/src/packing-validate-document'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { PackedWorkspace } from '../../../core/src/packing-workspace'
import { rendererVersion } from '../../src/index'
import { encodePackedProjectionSteps } from '../../src/packed-projection-encode'
import { encodePackedSnapshotSteps } from '../../src/packed-snapshot-encode'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const encoding = { working: 32 * MiB, nodes: 800000, depth: 512 }
const budget = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
function fixture(events?: unknown[]) {
  const text = `# Heading\n\n~~~js\n${'a'.repeat(20000)}\n~~~\n\ncall[^a]\n\n[^a]: note\n`
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'snapshot',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: `${parserVersion}/manuslip`,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession(limits)
  const ticket = owner.beginPrepared(source)
  const packet = finishPackedSteps(packMarkdownDocumentSteps(text, limits.bytes, encoding))
  if (!packet) throw new Error('Missing packet')
  const document = finishPackedSteps(owner.stageFullSteps(ticket, packet))
  if (!document) throw new Error('Missing document')
  finishPackedSteps(validatePackedDocument(document, source, [], budget))
  const output = finishPackedSteps(
    encodePackedProjectionSteps(
      document,
      source,
      ['root'],
      options,
      budget,
      encoding,
      limits.bytes,
    ),
  )
  if (!output) throw new Error('Missing render spool')
  const input = events
    ? packValue(
        {
          events,
          layout: { blocks: [], bodyEnd: 0, htmlLength: 0 },
          timings: { renderMs: 0 },
          rendererVersion,
        },
        limits.bytes,
      )
    : output.value.payload
  output.release()
  const spool = finishPackedSteps(owner.stageFullSteps(ticket, input))
  if (!spool) throw new Error('Missing staged spool')
  return { owner, document, spool }
}
it.each(['queued', 'index', 'encode', 'admitted', 'document', 'spool', 'dispose', 'wire'] as const)(
  'releases the complete snapshot assembly after %s',
  (phase) => {
    const { owner, document, spool } = fixture()
    const before = owner.stats
    let admitted = false
    const resize = PackedWorkspace.prototype.resize
    const observed = vi.spyOn(PackedWorkspace.prototype, 'resize').mockImplementation(function (
      this: PackedWorkspace,
      retained: number,
      staging: number,
    ) {
      const result = resize.call(this, retained, staging)
      if (staging === 0 && retained > 256) admitted = true
      return result
    })
    const work = encodePackedSnapshotSteps(
      document,
      spool,
      phase === 'wire' ? 64 : limits.bytes,
      encoding,
      budget,
    )
    try {
      if (phase === 'index') expect(work.next().done).toBe(false)
      else if (phase === 'admitted') while (!admitted) expect(work.next().done).toBe(false)
      else if (!['queued', 'wire'].includes(phase)) {
        while (owner.stats.captures < 4) expect(work.next().done).toBe(false)
        for (let i = 0; i < 3; i++) expect(work.next().done).toBe(false)
      }
      if (phase === 'document') document.release()
      else if (phase === 'spool') {
        spool.release()
        expect(() => work.next()).toThrow(/Missing|closed|released/)
      } else if (phase === 'dispose') owner.dispose()
      else if (phase === 'wire') expect(() => finishPackedSteps(work)).toThrow(/limit/)
      else work.return()
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.holds).toBe(0)
      if (['queued', 'index', 'encode', 'admitted', 'wire'].includes(phase))
        expect(owner.stats).toEqual(before)
    } finally {
      observed.mockRestore()
      work.return()
      document.release()
      spool.release()
      owner.dispose()
    }
  },
)

it.each(['second lease', 'work'] as const)(
  'releases earlier reservations when the %s factory fails',
  (phase) => {
    const { owner, document, spool } = fixture()
    const before = owner.stats
    const failure = new Error('factory failure')
    const method = phase === 'work' ? 'work' : 'reserveWorkspace'
    const original = PackedCapture.prototype[method]
    let calls = 0
    const spy = vi.spyOn(PackedCapture.prototype, method).mockImplementation(function (
      this: PackedCapture,
      ...args: unknown[]
    ) {
      if (++calls === (phase === 'work' ? 1 : 2)) throw failure
      return Reflect.apply(original, this, args)
    })
    try {
      expect(() =>
        encodePackedSnapshotSteps(document, spool, limits.bytes, encoding, budget),
      ).toThrow(failure)
      expect(owner.stats).toEqual(before)
    } finally {
      spy.mockRestore()
      document.release()
      spool.release()
      owner.dispose()
    }
  },
)

it.each(
  [
    [{ widgetEnd: true }],
    [{ widgetHtml: 'missing' }],
    [{ widget: { kind: 'code', value: 'x', from: 0, to: 1 } }],
    [{ widget: { kind: 'code', value: 'x', from: 2, to: 1 } }, { widgetEnd: true }],
    [{ widget: { kind: 'code', value: 'x', from: 0, to: 1 } }, { widgetEnd: false }],
    [{ unexpected: 'field' }],
  ].map((events) => ({ events })),
)('rejects incomplete or invalid spool events before offering output: %j', ({ events }) => {
  const { owner, document, spool } = fixture(events)
  const before = owner.stats
  try {
    expect(() =>
      finishPackedSteps(encodePackedSnapshotSteps(document, spool, limits.bytes, encoding, budget)),
    ).toThrow(/Invalid|Incomplete/)
    expect(owner.stats).toEqual(before)
  } finally {
    document.release()
    spool.release()
    owner.dispose()
  }
})
