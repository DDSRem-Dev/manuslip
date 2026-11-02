import { expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import { inspectPackedReading } from '../../src/packed-reading'
import type { PackedReadingOutput } from '../../src/packed-reading-output'
import { readingBlocks } from '../../src/reading'
import { ReadingSequence } from '../../src/reading-sequence'
import { ReadingWorkspace } from '../../src/reading-workspace'

const MiB = 1024 * 1024
const limits = { retained: 24 * MiB, staging: 8 * MiB, nodes: 800000, depth: 16 }
const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
function fixture(text: string) {
  const document = parseMarkdown(text)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'owned-reading',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession({
    retained: 32 * MiB,
    staging: 8 * MiB,
    bytes: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ root: document.root }, 8 * MiB),
    ),
  )
  const capture = owner.capture()
  const reading = {
    layout: 'replace' as const,
    blocks: readingBlocks(document.root, text),
    units: [],
    translated: new Set<string>(),
    sourceLanguage: 'en',
    targetLanguage: 'ar',
    labels: { original: 'Original', translation: 'Translation' },
  }
  return {
    owner,
    capture,
    source,
    reading,
    work: (
      budget = limits,
      inspect: Parameters<typeof inspectPackedReading>[7] = function* () {
        yield
      },
    ) =>
      inspectPackedReading(capture, source, ['root'], options, reading, budget, undefined, inspect),
    close() {
      capture.release()
      owner.dispose()
    },
  }
}

it('rejects URL handler construction before policy/serialization and restores a reusable capture', () => {
  const f = fixture(`[link](https://example.invalid/${'a'.repeat(2000)})\n`)
  const project = vi.spyOn(ReadingWorkspace.prototype, 'project')
  const before = f.owner.stats
  try {
    expect(() => finishPackedSteps(f.work({ ...limits, staging: MiB }))).toThrow('workspace limit')
    expect(project).not.toHaveBeenCalled()
    expect(f.owner.stats).toEqual(before)
    finishPackedSteps(f.work())
    expect(project).toHaveBeenCalled()
    expect(f.owner.stats).toEqual(before)
  } finally {
    project.mockRestore()
    f.close()
  }
})

it('rejects escaped serialization scratch before native policy/row serialization', () => {
  const f = fixture(`Text ${'&'.repeat(20000)}\n`)
  const project = vi.spyOn(ReadingWorkspace.prototype, 'project')
  const serialize = vi.spyOn(ReadingWorkspace.prototype, 'serialize')
  const before = f.owner.stats
  try {
    expect(() => finishPackedSteps(f.work({ ...limits, staging: 2 * MiB }))).toThrow(
      'workspace limit',
    )
    expect(project).toHaveBeenCalled()
    expect(serialize).not.toHaveBeenCalled()
    expect(f.owner.stats).toEqual(before)
    finishPackedSteps(f.work())
    expect(f.owner.stats).toEqual(before)
  } finally {
    project.mockRestore()
    serialize.mockRestore()
    f.close()
  }
})

it('admits final joins alongside persistent rows and releases rejected complete output', () => {
  const f = fixture(`Repeated ${'x'.repeat(1000)}.\n\n`.repeat(200))
  const serialize = vi.spyOn(ReadingWorkspace.prototype, 'serialize')
  const before = f.owner.stats
  try {
    expect(() => finishPackedSteps(f.work({ ...limits, retained: 768 * 1024 }))).toThrow(
      'workspace limit',
    )
    expect(serialize.mock.calls.length).toBe(201)
    expect(f.owner.stats).toEqual(before)
    finishPackedSteps(f.work())
    expect(f.owner.stats).toEqual(before)
  } finally {
    serialize.mockRestore()
    f.close()
  }
})

it.each(['body', 'output', 'dispose', 'throw'] as const)(
  'cleans every reading reservation after %s',
  (phase) => {
    const f = fixture('First **paragraph**[^n].\n\nSecond paragraph.\n\n[^n]: Footnote $x$.\n')
    const before = f.owner.stats
    let entered = false
    const failure = new Error('Reading inspector failed')
    const append = vi.spyOn(ReadingSequence.prototype, 'append')
    const work = f.work(limits, function* () {
      entered = true
      yield
      if (phase === 'throw') throw failure
    })
    try {
      for (let steps = 0; phase === 'body' ? !append.mock.calls.length : !entered; steps++) {
        expect(steps).toBeLessThan(100000)
        expect(work.next().done).toBe(false)
      }
      expect(f.owner.stats.retainedBytes).toBeGreaterThan(before.retainedBytes)
      if (phase === 'dispose') f.owner.dispose()
      else if (phase === 'throw') expect(() => work.next()).toThrow(failure)
      else work.return()
      expect(work.next().done).toBe(true)
      if (phase === 'dispose') expect(f.owner.stats.retainedBytes).toBe(0)
      else expect(f.owner.stats).toEqual(before)
    } finally {
      append.mockRestore()
      work.return()
      f.close()
    }
  },
)

it.each(['release', 'capture', 'session'] as const)(
  'keeps completed output owned until %s and revokes escaped retention callbacks',
  (end) => {
    const f = fixture('Owned **output** with note[^n].\n\n[^n]: Note $x$.\n')
    const before = f.owner.stats
    let output: PackedReadingOutput | undefined
    let escaped: (() => PackedReadingOutput) | undefined
    try {
      finishPackedSteps(
        f.work(limits, function* (projection, _cost, retain) {
          output = retain()
          escaped = retain
          expect(output.value).toBe(projection)
          expect(() => retain()).toThrow('already retained')
          yield
        }),
      )
      if (!output || !escaped) throw new Error('Missing owned output')
      expect(output.value.html).toContain('Owned')
      expect(f.owner.stats.retainedBytes).toBeGreaterThan(before.retainedBytes)
      // One completed-output workspace and one revocable lifetime work handle.
      expect(f.owner.stats.readers).toBe(before.readers + 2)
      expect(() => escaped?.()).toThrow('borrow closed')
      if (end === 'release') output.release()
      else if (end === 'capture') f.capture.release()
      else f.owner.dispose()
      expect(() => output?.value).toThrow('released')
      output.release()
      if (end === 'release') expect(f.owner.stats).toEqual(before)
      if (end === 'session') expect(f.owner.stats.retainedBytes).toBe(0)
    } finally {
      f.close()
    }
  },
)

it.each(['cancel', 'throw'] as const)('revokes taken output when its inspector %s fails', (end) => {
  const f = fixture('Owned output.\n')
  const before = f.owner.stats
  let output: PackedReadingOutput | undefined
  const work = f.work(limits, function* (_projection, _cost, retain) {
    output = retain()
    yield
    throw new Error('Inspector failed')
  })
  try {
    while (!output) expect(work.next().done).toBe(false)
    if (end === 'cancel') work.return()
    else expect(() => work.next()).toThrow('Inspector failed')
    expect(() => output?.value).toThrow('released')
    expect(f.owner.stats).toEqual(before)
    finishPackedSteps(f.work())
    expect(f.owner.stats).toEqual(before)
  } finally {
    work.return()
    f.close()
  }
})
