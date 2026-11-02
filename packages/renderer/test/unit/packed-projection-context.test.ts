import type { Nodes, Root } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { PackedReadScope } from '../../../core/src/packing-capture'
import { inspectPackedNative } from '../../../core/src/packing-native-steps'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { PackedWordBuffer } from '../../../core/src/packing-word-buffer'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderedBlock, type RenderOptions, rendererVersion } from '../../src/index'
import { inspectPackedProjectionContext } from '../../src/packed-projection-context'
import { renderProjectionLayout } from '../../src/projection-layout'
import { type ProjectionDefinition, ProjectionSequence } from '../../src/projection-sequence'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, bytes: 8 * MiB, retained: 64 * MiB, captures: 8, readers: 160 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
function fixture(
  text: string,
  syntax: 'commonmark' | 'manuslip' = 'manuslip',
  root = parseMarkdown(text, syntax).root,
  staging = sessionLimits.staging,
) {
  const checked = new PackedSource(
    {
      generation: 1,
      documentId: 'packed-context',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: parseMarkdown('', syntax).parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession({ ...sessionLimits, staging })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(checked),
      checked.identity,
      packValue({ root }, sessionLimits.bytes),
    ),
  )
  return { owner, checked, root, capture: owner.capture() }
}
function expectedContext(root: Root): ProjectionDefinition[] {
  const result: ProjectionDefinition[] = []
  const pending: Nodes[] = [...root.children].reverse()
  while (pending.length) {
    const node = pending.pop()
    if (!node) break
    if (node.type === 'definition' || node.type === 'footnoteDefinition') result.push(node)
    else if ('children' in node) pending.push(...[...node.children].reverse())
  }
  return result
}
function frozen(value: unknown): void {
  if (!value || typeof value !== 'object') return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) frozen(child)
}
function validate(text: string, syntax: 'commonmark' | 'manuslip' = 'manuslip', render = options) {
  const context = fixture(text, syntax)
  const before = context.owner.stats
  const expected = renderProjectionLayout(context.root, render, 8 * MiB)
  try {
    finishPackedSteps(
      inspectPackedProjectionContext(
        context.capture,
        context.checked,
        ['root'],
        limits,
        function* (definitions, cost) {
          expect(definitions).toEqual(expectedContext(context.root))
          frozen(definitions)
          expect(cost.definitions).toBe(definitions.length)
          expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          const sequence = new ProjectionSequence(definitions, render)
          let html = ''
          let visible = false
          const blocks = new Map<string, RenderedBlock>()
          try {
            // The independent native full root is an oracle, outside the context's budget.
            for (const node of context.root.children) {
              const result = sequence.render(node)
              if (result.visible) {
                html += `${visible ? '\n' : ''}${result.projection.html}`
                visible = true
              }
              for (const block of result.projection.blocks)
                blocks.set(`${block.from}:${block.to}`, block)
              yield
              expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
            }
            const footer = sequence.finish()
            html += footer.html
            for (const block of footer.blocks) blocks.set(`${block.from}:${block.to}`, block)
            expect(html).toBe(expected.projection.html)
            expect([...blocks.values()].sort((a, b) => a.from - b.from || b.to - a.to)).toEqual(
              expected.projection.blocks,
            )
          } finally {
            sequence.close()
          }
        },
      ),
    )
    expect(context.owner.stats).toEqual(before)
  } finally {
    context.owner.dispose()
  }
  expect(context.owner.stats.retainedBytes).toBe(0)
}

describe('capture-owned packed projection context', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'collects exact context for every CommonMark fixture in %s',
    (syntax) => {
      for (const example of examples) validate(example.markdown, syntax)
    },
  )
  const cases = [
    '',
    '\ufeff',
    '\ufeff# title\r\n\r\n[r]: /url\r\n',
    '[r]: /first\n\n[r]: /second\n\n[r][r]\n',
    '> [r]: /nested\n>\n> body\n\n[r][r]\n\n[r]: /later\n',
    'first[^a]\n\nagain[^a] and [^b]\n\n[^a]: text with [^c]\n\n[^b]: second with [^c]\n\n[^c]: third with [^a]\n',
    '[^a]: first\n\n[^a]: second\n\ntext[^a]\n',
    '[^unused]: unused $math$ and ![a](local.png)\n\ntext only\n',
    'text[^a] [image][r]\n\n[^a]: note\n\n    > [r]: /inside\n    >\n    > ![picture][r]\n\n[r]: /outside\n',
    'paragraph[^a]\n\n[^a]: <b>note</b>\n\n    ~~~MeRmAiD\n    graph TD; A-->B\n    ~~~\n',
    '[Straße]: /url\n\n[a][STRASSE]\n\n[^界😀]: note\n\nx[^界😀]\n',
    `text[^a]\n\n[^a]: ${'a界😀\ud800'.repeat(3000)}\n`,
  ]
  it.each([false, true])(
    'preserves duplicate/nested definitions and complete footnotes with rawHtml=%s',
    (rawHtml) => {
      for (const text of cases) validate(text, 'manuslip', { ...options, rawHtml })
    },
  )
  it('does not decode unrelated prose while collecting context', () => {
    const context = fixture(`${'prose '.repeat(20000)}\n\n[r]: /url\n`)
    const spy = vi.spyOn(PackedArena.prototype, 'scalar')
    const text = vi.spyOn(PackedReadScope.prototype, 'textSteps')
    try {
      finishPackedSteps(
        inspectPackedProjectionContext(
          context.capture,
          context.checked,
          ['root'],
          limits,
          function* (definitions) {
            expect(definitions.length).toBe(1)
            expect(definitions[0]).toMatchObject({ type: 'definition', url: '/url' })
            yield
          },
        ),
      )
      for (const result of spy.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(100)
      expect(text).not.toHaveBeenCalled()
      for (const result of spy.mock.results)
        expect(result.type === 'return' ? result.value : null).not.toBe('prose '.repeat(20000))
    } finally {
      spy.mockRestore()
      text.mockRestore()
      context.owner.dispose()
    }
  })
  it('preserves body-reference costs and traversal limits when no definitions can be copied', () => {
    const identifier = 'ghost',
      root: Root = {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'footnoteReference', identifier }] }],
      }
    const context = fixture('ghost reference\n', 'manuslip', root),
      before = context.owner.stats
    try {
      for (const budget of [
        { ...limits, nodes: 2 },
        { ...limits, depth: 2 },
      ]) {
        let inspected = false
        expect(() =>
          finishPackedSteps(
            inspectPackedProjectionContext(
              context.capture,
              context.checked,
              ['root'],
              budget,
              function* () {
                inspected = true
                yield
              },
            ),
          ),
        ).toThrow(/limit/)
        expect(inspected).toBe(false)
        expect(context.owner.stats).toEqual(before)
      }
      finishPackedSteps(
        inspectPackedProjectionContext(
          context.capture,
          context.checked,
          ['root'],
          { ...limits, nodes: 3, depth: 3 },
          function* (definitions, cost) {
            expect(definitions).toEqual([])
            expect(cost).toMatchObject({
              definitions: 0,
              nativeBytes: 0,
              nodes: 3,
              bodyReferences: 1,
              bodyReferenceUnits: identifier.length,
              recordKeys: [],
            })
            expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
            yield
          },
        ),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['retained', 'staging', 'nodes', 'depth'] as const)(
    'rejects insufficient %s and restores accounting',
    (key) => {
      const context = fixture('[r]: /url\n\nx[^a]\n\n[^a]: note\n')
      const before = context.owner.stats
      try {
        expect(() =>
          finishPackedSteps(
            inspectPackedProjectionContext(
              context.capture,
              context.checked,
              ['root'],
              { ...limits, [key]: 1 },
              function* () {
                yield
              },
            ),
          ),
        ).toThrow()
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('preflights a complete definition before decoding its strings or allocating collectors', () => {
    const context = fixture(`x[^a]\n\n[^a]: ${'x'.repeat(300000)}\n`)
    const before = context.owner.stats
    const create = vi.spyOn(PackedWordBuffer, 'create')
    try {
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionContext(
            context.capture,
            context.checked,
            ['root'],
            { ...limits, staging: MiB },
            function* () {
              yield
            },
          ),
        ),
      ).toThrow('workspace')
      expect(create).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      create.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['retained', 'staging'] as const)(
    'rolls back an earlier private copy when a later definition exceeds %s',
    (field) => {
      const context = fixture(`[r]: /accepted\n\n[^large]: ${'x'.repeat(300000)}\n`)
      const before = context.owner.stats
      const positions = vi.spyOn(PackedReadScope.prototype, 'position')
      const collectors = vi.spyOn(PackedWordBuffer, 'create')
      let inspected = false
      try {
        expect(() =>
          finishPackedSteps(
            inspectPackedProjectionContext(
              context.capture,
              context.checked,
              ['root'],
              { ...limits, [field]: 2 * MiB },
              function* () {
                inspected = true
                yield
              },
            ),
          ),
        ).toThrow('workspace')
        expect(positions).toHaveBeenCalled()
        expect(collectors).not.toHaveBeenCalled()
        expect(inspected).toBe(false)
        expect(context.owner.stats).toEqual(before)
        finishPackedSteps(
          inspectPackedProjectionContext(
            context.capture,
            context.checked,
            ['root'],
            limits,
            function* (definitions) {
              expect(definitions).toEqual(expectedContext(context.root))
              yield
            },
          ),
        )
        expect(context.owner.stats).toEqual(before)
      } finally {
        positions.mockRestore()
        collectors.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it.each([{ nodes: 12 }, { depth: 2 }])(
    'rolls back a copied definition when a later container exceeds traversal bounds %j',
    (budget) => {
      const context = fixture('[r]: /accepted\n\n> > > late\n')
      const before = context.owner.stats
      const positions = vi.spyOn(PackedReadScope.prototype, 'position')
      let inspected = false
      try {
        expect(() =>
          finishPackedSteps(
            inspectPackedProjectionContext(
              context.capture,
              context.checked,
              ['root'],
              { ...limits, ...budget },
              function* () {
                inspected = true
                yield
              },
            ),
          ),
        ).toThrow(/limit/)
        expect(positions).toHaveBeenCalled()
        expect(inspected).toBe(false)
        expect(context.owner.stats).toEqual(before)
        finishPackedSteps(
          inspectPackedProjectionContext(
            context.capture,
            context.checked,
            ['root'],
            limits,
            function* (definitions) {
              expect(definitions).toEqual(expectedContext(context.root))
              yield
            },
          ),
        )
        expect(context.owner.stats).toEqual(before)
      } finally {
        positions.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('keeps context charged while a separate block is inspected under the remaining budget', () => {
    const context = fixture('paragraph [r][r]\n\n[r]: /url\n\nx[^a]\n\n[^a]: note\n')
    const before = context.owner.stats
    try {
      finishPackedSteps(
        inspectPackedProjectionContext(
          context.capture,
          context.checked,
          ['root'],
          limits,
          function* (definitions, cost) {
            const remaining = {
              ...limits,
              retained: limits.retained - cost.retainedBytes,
              staging: limits.staging - cost.stagingBytes,
            }
            const items = context.capture.reader.elementSteps(['root', 'children'])
            try {
              const node = items.next().value
              if (!node) throw new Error('Missing node')
              yield* inspectPackedNative(context.capture, node, remaining, function* (copy) {
                expect(copy).toEqual(context.root.children[0])
                expect(definitions.length).toBe(2)
                expect(context.owner.stats.readerStagingBytes).toBeGreaterThan(cost.stagingBytes)
                yield
              })
            } finally {
              items.return()
            }
            expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          },
        ),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('copies paths/limits and requires the exact source object', () => {
    const context = fixture('[r]: /url\n')
    const path = ['root']
    const changed = { ...limits }
    const before = context.owner.stats
    const work = inspectPackedProjectionContext(
      context.capture,
      context.checked,
      path,
      changed,
      function* (definitions) {
        expect(definitions.length).toBe(1)
        yield
      },
    )
    path[0] = 'missing'
    changed.nodes = 0
    try {
      finishPackedSteps(work)
      const other = new PackedSource(context.checked.identity, context.checked.text)
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionContext(context.capture, other, ['root'], limits, function* () {
            yield
          }),
        ),
      ).toThrow('Invalid packed semantic document')
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('restores competing context admission and retries after its first owner closes', () => {
    const text = `text[^a]\n\n[^a]: ${'x'.repeat(800000)}\n`
    const context = fixture(text, 'manuslip', undefined, 6 * MiB)
    const before = context.owner.stats
    let inspected = false
    const first = inspectPackedProjectionContext(
      context.capture,
      context.checked,
      ['root'],
      limits,
      function* () {
        inspected = true
        yield
      },
    )
    try {
      while (!inspected) expect(first.next().done).toBe(false)
      const occupied = context.owner.stats
      expect(occupied.readerStagingBytes).toBeGreaterThan(3 * MiB)
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionContext(
            context.capture,
            context.checked,
            ['root'],
            limits,
            function* () {
              yield
            },
          ),
        ),
      ).toThrow(/staging|workspace/)
      expect(context.owner.stats).toEqual(occupied)
      first.return()
      expect(context.owner.stats).toEqual(before)
      finishPackedSteps(
        inspectPackedProjectionContext(
          context.capture,
          context.checked,
          ['root'],
          limits,
          function* (definitions) {
            expect(definitions.length).toBe(1)
            yield
          },
        ),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      first.return()
      context.owner.dispose()
    }
  })
})

describe('packed context lifetime and cancellation', () => {
  const phases = ['unstarted', 'scan', 'decode', 'inspect'] as const
  it.each(
    phases.flatMap((phase) =>
      (['return', 'release', 'dispose'] as const).map((action) => ({ phase, action })),
    ),
  )('closes $phase context on $action without advancing the escaped work', ({ phase, action }) => {
    const context = fixture(`text[^a]\n\n[^a]: ${'x'.repeat(30000)}\n`)
    const before = context.owner.stats
    let decoded = 0
    let inspected = false
    const append = PackedWordBuffer.prototype.append
    const spy = vi.spyOn(PackedWordBuffer.prototype, 'append').mockImplementation(function (
      this: PackedWordBuffer,
      value,
    ) {
      append.call(this, value)
      decoded += value.length
    })
    const work = inspectPackedProjectionContext(
      context.capture,
      context.checked,
      ['root'],
      limits,
      function* (definitions) {
        expect(definitions.length).toBe(1)
        inspected = true
        yield
      },
    )
    try {
      if (phase === 'scan') expect(work.next().done).toBe(false)
      else if (phase !== 'unstarted') {
        let steps = 0
        while (phase === 'decode' ? decoded < 1000 : !inspected) {
          expect(work.next().done).toBe(false)
          if (++steps > 10000) throw new Error('Missing checkpoint')
        }
      }
      if (action === 'return') work.return()
      else if (action === 'release') context.capture.release()
      else context.owner.dispose()
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      if (action === 'return') expect(context.owner.stats).toEqual(before)
      expect(work.next().done).toBe(true)
    } finally {
      work.return()
      spy.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['throw', 'release'] as const)('unwinds an inspector that causes %s', (action) => {
    const context = fixture('[r]: /url\n')
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionContext(
            context.capture,
            context.checked,
            ['root'],
            limits,
            function* () {
              if (action === 'throw') throw new Error('Inspector failure')
              context.capture.release()
              yield
            },
          ),
        ),
      ).toThrow(action === 'throw' ? 'Inspector failure' : 'released')
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      if (action === 'throw') expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['complete', 'cancel'] as const)(
    'forwards discarded context prefixes during %s',
    (action) => {
      const text = `${'paragraph\n\n'.repeat(3000)}[r]: /url\n`
      const context = fixture(text)
      const result = { ...context.checked.identity, revision: 1 }
      const payload = packValue([], sessionLimits.bytes)
      const record = PackedArena.open(payload.slice(0), sessionLimits).root
      context.owner.commit(
        context.owner.prepareDelta(context.owner.begin(result, text), {
          base: context.checked.identity,
          baseSource: text,
          result,
          payload,
          operations: [
            { kind: 'splice', path: ['root', 'children'], start: 2500, remove: 0, record },
          ],
        }),
      )
      const capture = context.owner.capture()
      let reads = 0
      let progress = 0
      const elements = PackedArena.prototype.elements
      const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
        this: PackedArena,
        id: number,
      ) {
        for (const value of elements.call(this, id)) {
          reads++
          yield value
        }
      })
      const work = inspectPackedProjectionContext(
        capture,
        capture.sourceResource,
        ['root'],
        limits,
        function* (definitions) {
          expect(definitions.length).toBe(1)
          yield
        },
      )
      try {
        while (true) {
          const before = reads
          const step = work.next()
          expect(reads - before).toBeLessThanOrEqual(256)
          if (step.done) break
          if (reads - before === 256) {
            progress++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(progress).toBeGreaterThan(0)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(context.capture.reader.length(['root', 'children'])).toBe(3001)
      } finally {
        work.return()
        spy.mockRestore()
        context.owner.dispose()
      }
    },
  )
})
