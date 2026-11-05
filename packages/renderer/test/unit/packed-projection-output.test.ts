import * as html from 'hast-util-to-html'
import { defaultHandlers } from 'mdast-util-to-hast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, rendererVersion } from '../../src/index'
import { inspectPackedProjectionOutput } from '../../src/packed-projection-output'
import { renderProjectionLayout } from '../../src/projection-layout'
import { ProjectionSequence } from '../../src/projection-sequence'
import { planProjectionSerialization } from '../../src/projection-serialization-plan'
import { ProjectionWorkspace } from '../../src/projection-workspace'

vi.mock('hast-util-to-html', { spy: true })
vi.mock('../../src/projection-serialization-plan', { spy: true })

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
  staging = limits.staging,
) {
  const document = parseMarkdown(text, syntax)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'packed-output',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
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
      packValue({ root: document.root }, limits.staging),
    ),
  )
  return { owner, source, document, capture: owner.capture() }
}
function verify(text: string, syntax: 'commonmark' | 'manuslip', render = options) {
  const context = fixture(text, syntax, render)
  const baseline = context.owner.stats
  // This independent native root/full render is a test oracle outside the packed ledger.
  // Actual input blocks, HAST and outputs under inspection come only from the packed path.
  const expected = renderProjectionLayout(context.document.root, render, limits.staging)
  let at = 0
  let visible = false
  let inspected = 0
  const widgetKeys = new Set<string>()
  try {
    finishPackedSteps(
      inspectPackedProjectionOutput(
        context.capture,
        context.source,
        ['root'],
        render,
        limits,
        function* (output, cost) {
          expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
          expect(cost.stagingBytes).toBeLessThanOrEqual(limits.staging)
          expect(Object.isFrozen(cost)).toBe(true)
          expect(output.projection.html.length).toBeLessThanOrEqual(cost.serialization.htmlUnits)
          expect(
            output.projection.blocks.reduce((sum, block) => sum + block.html.length, 0),
          ).toBeLessThanOrEqual(cost.serialization.widgetUnits)
          if (!output.footer) {
            expect(output.index).toBe(inspected++)
            const from = at + Number(visible && output.visible)
            if (visible && output.visible) {
              expect(expected.projection.html[at]).toBe('\n')
              at++
            }
            expect(output.projection.html).toBe(
              expected.projection.html.slice(at, at + output.projection.html.length),
            )
            at += output.projection.html.length
            expect({ from, to: at, visible: output.visible }).toEqual(
              expected.layout.blocks[output.index],
            )
            visible ||= output.visible
          } else {
            expect(output.index).toBe(context.document.root.children.length)
            expect(at).toBe(expected.layout.bodyEnd)
            expect(output.projection.html).toBe(expected.projection.html.slice(at))
            at += output.projection.html.length
          }
          for (const block of output.projection.blocks) {
            expect(block).toEqual(
              expected.projection.blocks.find(
                (value) => value.from === block.from && value.to === block.to,
              ),
            )
            widgetKeys.add(`${block.from}:${block.to}`)
          }
          yield
          expect(context.owner.stats.readerStagingBytes).toBe(cost.stagingBytes)
        },
      ),
    )
    expect(inspected).toBe(context.document.root.children.length)
    expect(at).toBe(expected.layout.htmlLength)
    expect(widgetKeys.size).toBe(expected.projection.blocks.length)
    expect(context.owner.stats).toEqual(baseline)
  } finally {
    context.owner.dispose()
  }
  expect(context.owner.stats.retainedBytes).toBe(0)
}

describe('capture-owned packed projection output', () => {
  describe.each(['commonmark', 'manuslip'] as const)(
    'renders complete HTML, widgets and layout for all CommonMark fixtures in %s',
    (syntax) => {
      it.each(examples)('CommonMark $example: $section', (example) => {
        verify(example.markdown, syntax)
      })
    },
  )
  const cases = [
    '',
    '\ufeff',
    '\ufeff# title\r\n\r\nparagraph\r\n',
    '---\nheading: hidden\n---\n\n[r]: /first\n\n[a][r]\n\n[r]: /second\n\n![b][r]\n',
    '> [r]: /nested\n>\n> definition\n\n[a][r]\n\n[r]: /later\n',
    'First[^a].\n\nSecond[^b] and again[^a].\n\n[^a]: A with [^c]\n\n[^b]: B with [^c] and [^a]\n\n[^c]: C with [^a]\n',
    '[^x]: first\n\n[^x]: duplicate\n\nOne[^x].\n\nTwo[^x].\n',
    '[^unused]: ```mermaid\n    graph TD; A-->B\n    ```\n\nText only\n',
    'a[^x]\n\n[^x]: note\n\n    > [r]: /inside-note\n    >\n    > $x$ and ![a][r]\n\n[a][r]\n',
    '| ![a](https://example.com/a.png) |\n| - |\n| $x$ |\n\n$$\ny^2\n$$\n',
    '- [x] task\n- [ ] task\n\n> > ```ts\n> > const x = 1\n> > ```\n',
    '<script>alert(1)</script>\n\n[a](javascript:alert(1)) ![](../../local.png) <i>x</i>\n',
    '[x](https://例え.test/界 "a & b ` c") ![a](data:image/png;base64,YQ==)\n',
    '[Straße]: /url\n\n[a][STRASSE]\n\n[^界😀\ud800]: note\n\nx[^界😀\ud800]\n',
    `~~~${'x'.repeat(20000)}\ncode\n~~~\n`,
    '| a | b | c |\n| - | - | - |\n| short |\n',
  ]
  describe.each([false, true])(
    'preserves all extensions and global context with rawHtml=%s',
    (rawHtml) => {
      it.each(cases.map((text, index) => ({ text, example: index + 1 })))(
        'extension case $example',
        ({ text }) => {
          verify(text, 'manuslip', { ...options, rawHtml })
        },
      )
    },
  )
  it('keeps a 400,000-unit Unicode widget within simultaneous local admission', () => {
    verify(`~~~text\n${'界😀\ud800'.repeat(100000)}\n~~~\n`, 'manuslip')
  })
  it('accounts for nested widget HTML and entity replacement before any serialization', () => {
    const text = ['| `', '<&'.repeat(5000), '` |\n| - |\n'].join('')
    const context = fixture(text)
    const serialize = vi.mocked(html.toHtml)
    serialize.mockClear()
    const plans = vi.mocked(planProjectionSerialization)
    plans.mockClear()
    const baseline = context.owner.stats
    const work = inspectPackedProjectionOutput(
      context.capture,
      context.source,
      ['root'],
      options,
      { ...limits, staging: 2 * MiB },
      () => {
        throw new Error('Unexpected output')
      },
    )
    try {
      expect(() => finishPackedSteps(work)).toThrow(/workspace/)
      expect(serialize).not.toHaveBeenCalled()
      expect(plans).toHaveBeenCalledTimes(1)
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      serialize.mockClear()
      context.owner.dispose()
    }
  })
  it('rejects construction admission before a large public handler allocates output', () => {
    const context = fixture(`text ${'a\n'.repeat(10000)}\n`)
    const baseline = context.owner.stats
    const serialize = vi.mocked(html.toHtml)
    serialize.mockClear()
    const convert = vi.spyOn(ProjectionSequence.prototype, 'convertSteps')
    const admission = vi.spyOn(ProjectionWorkspace.prototype, 'add')
    const handler = vi.spyOn(defaultHandlers, 'text')
    try {
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionOutput(
            context.capture,
            context.source,
            ['root'],
            options,
            { ...limits, staging: 2.5 * MiB },
            function* () {
              yield
            },
          ),
        ),
      ).toThrow(/workspace/)
      expect(serialize).not.toHaveBeenCalled()
      expect(convert).toHaveBeenCalledTimes(1)
      expect(convert.mock.results[0]?.type).toBe('return')
      expect(admission.mock.results.some((result) => result.type === 'throw')).toBe(true)
      expect(handler).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      serialize.mockClear()
      convert.mockRestore()
      admission.mockRestore()
      handler.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(
    (['conversion', 'construct', 'plan', 'body', 'footer'] as const).flatMap((phase) =>
      (['return', 'release', 'dispose'] as const).map((action) => ({ phase, action })),
    ),
  )('releases $phase output work on $action', ({ phase, action }) => {
    const context = fixture(
      (phase === 'conversion' ? '**body** '.repeat(32) : 'body') +
        '[^a]\n\n[^a]: note $x$ and ![a](local.png)\n',
    )
    const baseline = context.owner.stats
    let converted = false
    let converting = false
    let inspectedBody = false
    let inspectedFooter = false
    const convert = ProjectionSequence.prototype.convertSteps
    const conversion = vi
      .spyOn(ProjectionSequence.prototype, 'convertSteps')
      .mockImplementation(function* (this: ProjectionSequence, node, limits) {
        converting = true
        const result = yield* convert.call(this, node, limits)
        converted = true
        return result
      })
    const serialize = vi.mocked(html.toHtml)
    serialize.mockClear()
    const plans = vi.mocked(planProjectionSerialization)
    plans.mockClear()
    const work = inspectPackedProjectionOutput(
      context.capture,
      context.source,
      ['root'],
      options,
      limits,
      function* (output) {
        if (output.footer) inspectedFooter = true
        else inspectedBody = true
        yield
      },
    )
    try {
      for (let steps = 0; ; steps++) {
        expect(steps).toBeLessThan(10000)
        expect(work.next().done).toBe(false)
        if (phase === 'conversion' && converting && !converted) break
        if (phase === 'construct' && converted) break
        if (phase === 'plan' && plans.mock.calls.length && !serialize.mock.calls.length) break
        if (phase === 'body' && inspectedBody) break
        if (phase === 'footer' && inspectedFooter) break
      }
      if (action === 'return') work.return()
      if (action === 'release') context.capture.release()
      if (action === 'dispose') context.owner.dispose()
      expect(work.next().done).toBe(true)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(context.owner.stats.readers).toBe(0)
      if (action === 'return') expect(context.owner.stats).toEqual(baseline)
    } finally {
      work.return()
      conversion.mockRestore()
      serialize.mockClear()
      context.owner.dispose()
    }
  })
  it.each(['throw', 'release', 'dispose'] as const)(
    'cleans up reentrant inspector %s',
    (action) => {
      const context = fixture('body[^a]\n\n[^a]: note\n')
      const baseline = context.owner.stats
      const work = inspectPackedProjectionOutput(
        context.capture,
        context.source,
        ['root'],
        options,
        limits,
        function* () {
          if (action === 'throw') throw new Error('Output inspector failed')
          if (action === 'release') context.capture.release()
          if (action === 'dispose') context.owner.dispose()
          yield
          throw new Error('Resumed revoked inspector')
        },
      )
      try {
        expect(() => finishPackedSteps(work)).toThrow(/inspector failed|released/)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(context.owner.stats.readers).toBe(0)
        if (action === 'throw') expect(context.owner.stats).toEqual(baseline)
      } finally {
        work.return()
        context.owner.dispose()
      }
    },
  )
  it('copies request inputs and binds options to this exact source', () => {
    const context = fixture('body[^a]\n\n[^a]: note\n')
    const baseline = context.owner.stats
    const path = ['root']
    const render = { ...options }
    const budget = { ...limits }
    let inspected = false
    const work = inspectPackedProjectionOutput(
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
    render.rawHtml = true
    budget.staging = 0
    try {
      finishPackedSteps(work)
      expect(inspected).toBe(true)
      expect(context.owner.stats).toEqual(baseline)
      const other = new PackedSource(context.source.identity, context.source.text)
      expect(() =>
        finishPackedSteps(
          inspectPackedProjectionOutput(
            context.capture,
            other,
            ['root'],
            options,
            limits,
            function* () {
              yield
            },
          ),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      context.owner.dispose()
    }
  })
  it('preserves live output after competing admission fails and admits a later retry', () => {
    const context = fixture(
      `~~~text\n${'abcdef'.repeat(1000)}\n~~~\n`,
      'manuslip',
      options,
      2.5 * MiB,
    )
    const baseline = context.owner.stats
    let inspected = false
    const first = inspectPackedProjectionOutput(
      context.capture,
      context.source,
      ['root'],
      options,
      limits,
      function* (output) {
        expect(output.projection.html).toContain('abcdef')
        inspected = true
        yield
      },
    )
    const create = () =>
      inspectPackedProjectionOutput(
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
      expect(() => finishPackedSteps(create())).toThrow(/workspace|staging/)
      expect(context.owner.stats).toEqual(occupied)
      first.return()
      expect(context.owner.stats).toEqual(baseline)
      finishPackedSteps(create())
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      first.return()
      context.owner.dispose()
    }
  })
  it('uses one reader slot across large scratch growth and shrinkage', () => {
    const context = fixture('text')
    const baseline = context.owner.stats
    const workspace = new ProjectionWorkspace(context.capture, limits)
    try {
      workspace.set(6 * MiB)
      expect(workspace.bytes).toBe(6 * MiB)
      expect(context.owner.stats.readers).toBe(baseline.readers + 1)
      expect(context.owner.stats.readerStagingBytes).toBe(baseline.readerStagingBytes + 6 * MiB)
      workspace.set(1)
      expect(workspace.bytes).toBe(65536)
      expect(context.owner.stats.readers).toBe(baseline.readers + 1)
      workspace.close()
      expect(context.owner.stats).toEqual(baseline)
      expect(() => workspace.set(1)).toThrow(/workspace/)
    } finally {
      workspace.close()
      context.capture.release()
      context.owner.dispose()
    }
  })

  it('preserves an admitted reservation when aggregate scratch growth is denied', () => {
    const context = fixture('text')
    const workspace = new ProjectionWorkspace(context.capture, limits)
    const bytes = workspace.bytes
    const occupied = context.capture.workspace(6 * MiB, 6 * MiB)
    const before = context.owner.stats
    try {
      expect(() => workspace.set(4 * MiB)).toThrow(/staging|scope/)
      expect(workspace.bytes).toBe(bytes)
      expect(context.owner.stats).toEqual(before)
    } finally {
      occupied.release()
      workspace.close()
      context.capture.release()
      context.owner.dispose()
    }
  })

  it('rolls back a workspace reservation after aggregate rejection', () => {
    const context = fixture('text')
    const baseline = context.owner.stats
    const occupiedBytes = limits.staging - 98304
    const occupied = context.capture.workspace(occupiedBytes, occupiedBytes)
    const before = context.owner.stats
    try {
      expect(() => new ProjectionWorkspace(context.capture, { ...limits, depth: 512 })).toThrow(
        /staging|workspace/,
      )
      expect(context.owner.stats).toEqual(before)
      occupied.release()
      expect(context.owner.stats).toEqual(baseline)
    } finally {
      occupied.release()
      context.owner.dispose()
    }
  })
  it.each(['complete', 'cancel'] as const)(
    'forwards real discarded-prefix progress in the output cursor during %s',
    (action) => {
      const text = `${'paragraph\n\n'.repeat(3000)}[r]: /url\n`
      const context = fixture(text)
      const result = { ...context.source.identity, revision: 1 }
      const payload = packValue([], limits.staging)
      const record = PackedArena.open(payload.slice(0), sessionLimits).root
      context.owner.commit(
        context.owner.prepareDelta(context.owner.begin(result, text), {
          base: context.source.identity,
          baseSource: text,
          result,
          payload,
          operations: [
            { kind: 'splice', path: ['root', 'children'], start: 2500, remove: 0, record },
          ],
        }),
      )
      const capture = context.owner.capture()
      const elements = PackedArena.prototype.elements
      let reads = 0
      let outputs = 0
      let prefix = 0
      const references = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
        this: PackedArena,
        id: number,
      ) {
        for (const item of elements.call(this, id)) {
          reads++
          yield item
        }
      })
      const work = inspectPackedProjectionOutput(
        capture,
        capture.sourceResource,
        ['root'],
        options,
        limits,
        function* (output) {
          outputs++
          expect(output.projection.html).toBe(
            output.footer || output.index === 3000 ? '' : '<p>paragraph</p>',
          )
          yield
        },
      )
      try {
        while (true) {
          const before = reads
          const next = work.next()
          expect(reads - before).toBeLessThanOrEqual(256)
          if (next.done) break
          if (outputs >= 2500 && reads - before === 256) {
            prefix++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(prefix).toBeGreaterThan(0)
        expect(outputs).toBe(action === 'complete' ? 3002 : 2500)
        expect(work.next().done).toBe(true)
        expect(context.capture.reader.length(['root', 'children'])).toBe(3001)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(context.owner.stats.readers).toBe(0)
      } finally {
        work.return()
        references.mockRestore()
        context.owner.dispose()
      }
    },
  )
})
