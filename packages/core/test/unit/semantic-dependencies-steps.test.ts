import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import { SemanticDependencies } from '../../src/semantic-dependencies'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: MiB, nodes: 800000, depth: 128 }
function fixture(
  text = '# Heading\n\nA [reference][r] [^n].\n\n> Nested prose.\n\n[r]: https://example.invalid/\n\n[^n]: A footnote.\n',
) {
  const document = parseMarkdown(text)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'cooperative-dependencies',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
  const owner = new PackedSession({
    ...limits,
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ document }, 8 * MiB),
    ),
  )
  return { owner, source, capture: owner.capture() }
}

describe('cooperative complete semantic dependency construction', () => {
  it('completes native reference/footnote order with caller admission before metadata and scratch growth', () => {
    const context = fixture()
    const before = context.owner.stats
    const workspace = context.capture.reserveWorkspace(0, 0)
    let retained = 0,
      staging = 0,
      calls = 0,
      steps = 0
    const work = SemanticDependencies.buildSteps(
      context.capture,
      context.source.text,
      ['document', 'root'],
      limits,
      (bytes, scratch) => {
        workspace.resize(bytes - context.source.retainedBytes + scratch, scratch)
        retained = Math.max(retained, bytes)
        staging = Math.max(staging, scratch)
        calls++
      },
    )
    try {
      while (true) {
        const step = work.next()
        if (!step.done) {
          steps++
          continue
        }
        const index = step.value
        if (!index) throw new Error('Missing dependencies')
        expect(steps).toBeGreaterThan(20)
        expect(calls).toBeGreaterThan(steps)
        expect(retained).toBe(index.retainedBytes)
        expect(staging).toBe(index.stagingBytes)
        expect(index.references.length).toBe(2)
        expect(index.definitions.length).toBe(2)
        expect(index.calls).toEqual([{ reference: 1, number: 1, occurrence: 1 }])
        expect(index.resolve('link', 'R')).toMatchObject({ kind: 'link', selected: true })
        break
      }
    } finally {
      work.return()
      workspace.release()
    }
    expect(context.owner.stats).toEqual(before)
    context.owner.dispose()
  })
  it.each(['queued', 'nested', 'long source'] as const)(
    'releases partial %s construction without advancing closed work',
    (phase) => {
      const context = fixture(
        phase === 'long source'
          ? 'word '.repeat(100000)
          : '> > > > > Nested prose.\n\n'.repeat(300),
      )
      const before = context.owner.stats
      const work = SemanticDependencies.buildSteps(
        context.capture,
        context.source.text,
        ['document', 'root'],
        limits,
      )
      if (phase !== 'queued') for (let i = 0; i < 20; i++) expect(work.next().done).toBe(false)
      work.return()
      expect(work.next().done).toBe(true)
      expect(context.owner.stats).toEqual(before)
      context.owner.dispose()
    },
  )
  it.each(['capture', 'owner'] as const)('revokes suspended traversal on %s release', (action) => {
    const context = fixture('> > > Nested prose.\n\n'.repeat(300))
    const work = SemanticDependencies.buildSteps(
      context.capture,
      context.source.text,
      ['document', 'root'],
      limits,
    )
    for (let i = 0; i < 20; i++) expect(work.next().done).toBe(false)
    if (action === 'capture') context.capture.release()
    else context.owner.dispose()
    expect(work.next().done).toBe(true)
    expect(context.owner.stats.readers).toBe(0)
    expect(context.owner.stats.readerStagingBytes).toBe(0)
    context.owner.dispose()
    expect(context.owner.stats.retainedBytes).toBe(0)
  })
  it('rejects failed admission without leaking partial readers or publishing a partial index', () => {
    const context = fixture('p\n\n'.repeat(100))
    const before = context.owner.stats
    const work = SemanticDependencies.buildSteps(
      context.capture,
      context.source.text,
      ['document', 'root'],
      limits,
      (bytes) => {
        if (bytes - context.source.retainedBytes > 4096) throw new Error('Admission rejected')
      },
    )
    expect(() => finishPackedSteps(work)).toThrow('Admission rejected')
    expect(work.next().done).toBe(true)
    expect(context.owner.stats).toEqual(before)
    context.owner.dispose()
  })
  it('copies queued paths and budgets and observes reentrant capture revocation during admission', () => {
    const context = fixture()
    const root = ['document', 'root'],
      budget = { ...limits }
    const work = SemanticDependencies.buildSteps(context.capture, context.source.text, root, budget)
    root[0] = 'missing'
    budget.nodes = 0
    expect(finishPackedSteps(work)?.references.length).toBe(2)
    const revoked = SemanticDependencies.buildSteps(
      context.capture,
      context.source.text,
      ['document', 'root'],
      limits,
      () => context.capture.release(),
    )
    expect(() => revoked.next()).toThrow(/released/)
    expect(revoked.next().done).toBe(true)
    expect(context.owner.stats.readers).toBe(0)
    context.owner.dispose()
  })
})
