import * as hast from 'mdast-util-to-hast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedCapture } from '../../../core/src/packing-capture'
import { inspectPackedNative } from '../../../core/src/packing-native-steps'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { PackedWordBuffer } from '../../../core/src/packing-word-buffer'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderedBlock, type RenderOptions, rendererVersion } from '../../src/index'
import {
  inspectPackedProjectionState,
  type PackedProjectionStateCost,
} from '../../src/packed-projection-state'
import { renderProjectionLayout } from '../../src/projection-layout'
import type { ProjectionSequence } from '../../src/projection-sequence'

vi.mock('mdast-util-to-hast', { spy: true })

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
function fixture(
  text: string,
  syntax: 'commonmark' | 'manuslip' = 'manuslip',
  render = options,
  root = parseMarkdown(text, syntax).root,
  staging = limits.staging,
) {
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'packed-state',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: parseMarkdown('', syntax).parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession({ ...sessionLimits, staging })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ root }, limits.staging),
    ),
  )
  return { owner, source, root, capture: owner.capture() }
}
function verify(text: string, syntax: 'commonmark' | 'manuslip', render: RenderOptions) {
  const context = fixture(text, syntax, render)
  const baseline = context.owner.stats
  const expected = renderProjectionLayout(context.root, render, limits.staging)
  let escaped: ProjectionSequence | undefined
  try {
    finishPackedSteps(
      inspectPackedProjectionState(
        context.capture,
        context.source,
        ['root'],
        render,
        limits,
        function* (sequence, cost) {
          escaped = sequence
          expect(Object.isFrozen(cost)).toBe(true)
          expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          expect(cost.retainedBytes).toBe(cost.context.retainedBytes + cost.stateBytes)
          let html = ''
          let visible = false
          const widgets = new Map<string, RenderedBlock>()
          // Full native root and generated HAST/output are functional oracles outside
          // the state ledger. Native block/output admission is a separate composition.
          for (const node of context.root.children) {
            const result = sequence.render(node)
            if (result.visible) {
              html += `${visible ? '\n' : ''}${result.projection.html}`
              visible = true
            }
            for (const widget of result.projection.blocks)
              widgets.set(`${widget.from}:${widget.to}`, widget)
            yield
            expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          }
          const footer = sequence.finish()
          html += footer.html
          for (const widget of footer.blocks) widgets.set(`${widget.from}:${widget.to}`, widget)
          expect(html).toBe(expected.projection.html)
          expect([...widgets.values()].sort((a, b) => a.from - b.from || b.to - a.to)).toEqual(
            expected.projection.blocks,
          )
          yield
          // Reservation also remains until the inspector closes after finish().
          expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
        },
      ),
    )
    expect(escaped).toBeDefined()
    expect(() => escaped?.finish()).toThrow(/closed/)
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    context.owner.dispose()
  }
}

describe('capture-owned packed projection state', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'matches every CommonMark fixture with %s',
    (syntax) => {
      for (const example of examples) verify(example.markdown, syntax, options)
    },
  )
  it.each([false, true])('preserves global references and widgets with rawHtml=%s', (rawHtml) => {
    for (const text of [
      '',
      '\ufeff# title\r\n\r\n[r]: /url\r\n',
      '[r]: /first\n\n[r]: /second\n\n[r][r]\n',
      'first[^a]\n\nagain[^a] and [^b]\n\n[^a]: with [^c]\n\n[^b]: with [^c]\n\n[^c]: with [^a]\n',
      'text[^a] [r][r]\n\n[^a]: note\n\n    > [r]: /inside\n    >\n    > ![picture][r]\n\n[r]: /outside\n',
      '[^unused]: unused $math$ ![a](local.png)\n\ntext only\n',
      'x[^a]\n\n[^a]: <b>note</b> $math$\n\n    ~~~MeRmAiD\n    graph TD; A-->B\n    ~~~\n',
      '[Straße]: /url\n\n[a][STRASSE]\n\n[^界😀\ud800]: note\n\nx[^界😀\ud800]\n',
    ])
      verify(text, 'manuslip', { ...options, rawHtml })
  })
  it('counts nested definitions and note calls without charging prose as persistent state', () => {
    const source = (body: string) =>
      `x[^ß] [r][r]\n\ny[^ß]\n\n[r]: /url\n\n[^ß]: ${body} [^b]\n\n    > [s]: /nested\n\n[^b]: end\n`
    const costs: PackedProjectionStateCost[] = []
    for (const body of ['short', 'prose '.repeat(10000)]) {
      const context = fixture(source(body))
      try {
        finishPackedSteps(
          inspectPackedProjectionState(
            context.capture,
            context.source,
            ['root'],
            options,
            limits,
            function* (_sequence, cost) {
              costs.push(cost)
              yield
            },
          ),
        )
      } finally {
        context.owner.dispose()
      }
    }
    expect(costs[0]?.definitions).toBe(4)
    expect(costs[0]?.references).toBe(3)
    expect(costs[0]?.identifierUnits).toBe(10)
    expect(costs[1]?.stateBytes).toBe(costs[0]?.stateBytes)
    expect(costs[1]?.context.nativeBytes).toBeGreaterThan(costs[0]?.context.nativeBytes ?? 0)
  })
  it('admits all persistent state before constructing public renderer maps', () => {
    const text = `${Array.from({ length: 700 }, (_, index) => `x[^a${index}]`).join(' ')}\n\n${Array.from({ length: 700 }, (_, index) => `[^a${index}]: note\n`).join('\n')}`
    const context = fixture(text)
    const baseline = context.owner.stats
    const native = vi.mocked(hast.toHast)
    let admitted: PackedProjectionStateCost | undefined
    try {
      finishPackedSteps(
        inspectPackedProjectionState(
          context.capture,
          context.source,
          ['root'],
          options,
          limits,
          function* (_sequence, cost) {
            admitted = cost
            yield
          },
        ),
      )
      if (!admitted) throw new Error('Missing state admission')
      const admittedStaging = admitted.stagingBytes
      native.mockClear()
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionState(
            context.capture,
            context.source,
            ['root'],
            options,
            { ...limits, staging: admittedStaging - 1 },
            () => {
              throw new Error('Unexpected inspector')
            },
          ),
        ),
      ).toThrow(/state exceeds workspace/)
      expect(native).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(baseline)
      finishPackedSteps(
        inspectPackedProjectionState(
          context.capture,
          context.source,
          ['root'],
          options,
          limits,
          function* (_sequence, cost) {
            expect(cost.definitions).toBe(700)
            expect(cost.references).toBe(700)
            yield
          },
        ),
      )
      expect(native).toHaveBeenCalledTimes(1)
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      native.mockClear()
      context.owner.dispose()
    }
  })
  it('preserves a suspended state when competing admission fails, then admits a retry', () => {
    const text = `${Array.from({ length: 700 }, (_, index) => `x[^a${index}]`).join(' ')}\n\n${Array.from({ length: 700 }, (_, index) => `[^a${index}]: note\n`).join('\n')}`
    const probe = fixture(text)
    let measured: PackedProjectionStateCost | undefined
    try {
      finishPackedSteps(
        inspectPackedProjectionState(
          probe.capture,
          probe.source,
          ['root'],
          options,
          limits,
          function* (_sequence, cost) {
            measured = cost
            yield
          },
        ),
      )
    } finally {
      probe.owner.dispose()
    }
    if (!measured) throw new Error('Missing measurement')
    const staging = measured.stagingBytes + measured.context.stagingBytes + measured.stateBytes / 2
    const context = fixture(text, 'manuslip', options, undefined, staging)
    const baseline = context.owner.stats
    const native = vi.mocked(hast.toHast)
    native.mockClear()
    let inspected = false
    let firstSequence: ProjectionSequence | undefined
    const first = inspectPackedProjectionState(
      context.capture,
      context.source,
      ['root'],
      options,
      limits,
      function* (sequence) {
        firstSequence = sequence
        inspected = true
        yield
      },
    )
    const create = () =>
      inspectPackedProjectionState(
        context.capture,
        context.source,
        ['root'],
        options,
        limits,
        function* () {
          yield
        },
      )
    try {
      while (!inspected) expect(first.next().done).toBe(false)
      const occupied = context.owner.stats
      expect(() => finishPackedSteps(create())).toThrow(/staging|workspace/i)
      expect(native).toHaveBeenCalledTimes(1)
      expect(context.owner.stats).toEqual(occupied)
      first.return()
      expect(() => firstSequence?.finish()).toThrow(/closed/)
      expect(context.owner.stats).toEqual(baseline)
      finishPackedSteps(create())
      expect(native).toHaveBeenCalledTimes(2)
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      first.return()
      native.mockClear()
      context.owner.dispose()
    }
  })
  it('keeps state charged during a separately admitted native block copy', () => {
    const context = fixture('x[^a]\n\n[^a]: note\n')
    const baseline = context.owner.stats
    try {
      finishPackedSteps(
        inspectPackedProjectionState(
          context.capture,
          context.source,
          ['root'],
          options,
          limits,
          function* (_sequence, cost) {
            const items = context.capture.reader.elementSteps(['root', 'children'])
            try {
              const first = items.next().value
              if (!first) throw new Error('Missing block')
              yield* inspectPackedNative(
                context.capture,
                first,
                {
                  ...limits,
                  retained: limits.retained - cost.retainedBytes,
                  staging: limits.staging - cost.stagingBytes,
                },
                function* (value) {
                  expect(value).toEqual(context.root.children[0])
                  expect(context.owner.stats.readerStagingBytes).toBeGreaterThan(cost.stagingBytes)
                  yield
                },
              )
            } finally {
              items.return()
            }
            expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          },
        ),
      )
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      context.owner.dispose()
    }
  })
  it('copies caller inputs before suspension and rejects mismatched renderer options', () => {
    const context = fixture('x[^a]\n\n[^a]: note\n')
    const path = ['root']
    const budget = { ...limits }
    const render = { ...options }
    let inspected = false
    const work = inspectPackedProjectionState(
      context.capture,
      context.source,
      path,
      render,
      budget,
      function* () {
        inspected = true
        yield
      },
    )
    path[0] = 'missing'
    budget.staging = 0
    render.rawHtml = true
    const baseline = context.owner.stats
    try {
      finishPackedSteps(work)
      expect(inspected).toBe(true)
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionState(
            context.capture,
            context.source,
            ['root'],
            { ...options, rawHtml: true },
            limits,
            () => {
              throw new Error('Unexpected inspector')
            },
          ),
        ),
      ).toThrow(/semantic/i)
      expect(context.owner.stats.retainedBytes).toBeLessThan(baseline.retainedBytes)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['queued', 'scan', 'decode', 'plan', 'constructed', 'inspect'] as const)(
    'cleans up cancellation during %s',
    (phase) => {
      const context = fixture(`x[^a]\n\n[^a]: ${'a界😀'.repeat(5000)}\n`)
      const baseline = context.owner.stats
      let decoded = 0
      const append = PackedWordBuffer.prototype.append
      const chunks = vi.spyOn(PackedWordBuffer.prototype, 'append').mockImplementation(function (
        this: PackedWordBuffer,
        text,
      ) {
        decoded += text.length
        append.call(this, text)
      })
      const maps = vi.mocked(hast.toHast)
      maps.mockClear()
      const holds = vi.spyOn(PackedCapture.prototype, 'workspace')
      let escaped: ProjectionSequence | undefined
      const work = inspectPackedProjectionState(
        context.capture,
        context.source,
        ['root'],
        options,
        limits,
        function* (sequence) {
          escaped = sequence
          yield
        },
      )
      try {
        if (phase !== 'queued')
          for (let steps = 0; ; steps++) {
            expect(steps).toBeLessThan(10000)
            expect(work.next().done).toBe(false)
            if (phase === 'scan') break
            if (phase === 'decode' && decoded > 1000) break
            // The context uses its own resizable reservation. The state's first
            // workspace marks planning before its complete map allocation.
            if (phase === 'plan' && holds.mock.calls.length >= 1) break
            if (phase === 'constructed' && maps.mock.calls.length) break
            if (phase === 'inspect' && escaped) break
          }
        work.return()
        expect(work.next().done).toBe(true)
        if (escaped) expect(() => escaped?.finish()).toThrow(/closed/)
        expect(context.owner.stats).toEqual(baseline)
      } finally {
        work.return()
        chunks.mockRestore()
        maps.mockClear()
        holds.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it.each(['throw', 'release', 'dispose'] as const)(
    'closes an escaped sequence on inspector %s',
    (action) => {
      const context = fixture('x[^a]\n\n[^a]: note\n')
      const baseline = context.owner.stats
      let escaped: ProjectionSequence | undefined
      const work = inspectPackedProjectionState(
        context.capture,
        context.source,
        ['root'],
        options,
        limits,
        function* (sequence) {
          escaped = sequence
          if (action === 'throw') throw new Error('Inspector failure')
          if (action === 'release') context.capture.release()
          if (action === 'dispose') context.owner.dispose()
          yield
          throw new Error('Resumed closed inspector')
        },
      )
      try {
        expect(() => finishPackedSteps(work)).toThrow(/Inspector failure|released/)
        expect(escaped).toBeDefined()
        expect(() => escaped?.finish()).toThrow(/closed/)
        expect(work.next().done).toBe(true)
        if (action === 'throw') expect(context.owner.stats).toEqual(baseline)
        else {
          expect(context.owner.stats.readerStagingBytes).toBe(0)
          expect(context.owner.stats.readers).toBe(0)
        }
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('rejects unsupported options before opening work', () => {
    const context = fixture('text')
    const baseline = context.owner.stats
    try {
      for (const render of [
        { ...options, footnotesLabel: 'x'.repeat(201) },
        { ...options, footnoteBackLabel: 1 },
        { ...options, rawHtml: 'true' },
        { ...options, extra: true },
      ])
        expect(() =>
          inspectPackedProjectionState(
            context.capture,
            context.source,
            ['root'],
            render as RenderOptions,
            limits,
            function* () {
              yield
            },
          ),
        ).toThrow(/options/)
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects a different source object even with identical source identity', () => {
    const context = fixture('text')
    const source = new PackedSource(context.source.identity, 'text')
    const baseline = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionState(
            context.capture,
            source,
            ['root'],
            options,
            limits,
            function* () {
              yield
            },
          ),
        ),
      ).toThrow(/semantic/i)
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      context.owner.dispose()
    }
  })
})
