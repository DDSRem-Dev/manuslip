import * as html from 'hast-util-to-html'
import type { Nodes } from 'mdast'
import { describe, expect, it, vi } from 'vitest'
import { type SemanticDocument, sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { PackedItemSteps, PackedReadScope } from '../../../core/src/packing-capture'
import { PackedReceiver } from '../../../core/src/packing-receiver'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { newPackedToken } from '../../../core/src/packing-token'
import { packedWireVersion } from '../../../core/src/packing-wire'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { type RenderOptions, type RenderProjection, rendererVersion } from '../../src/index'
import { PackedHtmlCursor } from '../../src/packed-html-cursor'
import { PackedProjectionBaseline } from '../../src/packed-projection-baseline'
import { validatePackedProjectionOutput } from '../../src/packing-validate-output'
import { validatePackedProjection } from '../../src/packing-validate-projection'
import { validatePackedSnapshot } from '../../src/packing-validate-snapshot'
import { type ProjectionLayout, renderProjectionLayout } from '../../src/projection-layout'

vi.mock('hast-util-to-html', { spy: true })

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = {
  retained: 64 * MiB,
  staging: 8 * MiB,
  bytes: 8 * MiB,
  captures: 8,
  readers: 160,
}
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
const paths = { root: ['document', 'root'], projection: ['projection'], layout: ['layout'] }
interface Snapshot {
  document: SemanticDocument
  projection: RenderProjection
  layout: ProjectionLayout
}
function snapshot(text: string, render = options): Snapshot {
  const document = parseMarkdown(text)
  const projected = renderProjectionLayout(document.root, render, limits.staging)
  return { document, projection: projected.projection, layout: projected.layout }
}
function checked(text: string, value: Snapshot, render = options, revision = 0) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'exact-output',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: value.document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
}
function fixture(text: string, value = snapshot(text), render = options) {
  const source = checked(text, value, render)
  const owner = new PackedSession(sessionLimits)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue(value, sessionLimits.bytes),
    ),
  )
  return { source, owner, capture: owner.capture() }
}
function find(node: Nodes, type: string): Nodes | undefined {
  if (node.type === type) return node
  if ('children' in node)
    for (const child of node.children) {
      const result = find(child, type)
      if (result) return result
    }
  return undefined
}

describe('exact packed renderer equivalence', () => {
  const faults = [
    { name: 'cancel with Error', primary: false, original: undefined, cleanup: new Error('close') },
    { name: 'cancel with undefined', primary: false, original: undefined, cleanup: undefined },
    { name: 'comparison Error', primary: true, original: new Error('compare'), cleanup: undefined },
    {
      name: 'comparison undefined',
      primary: true,
      original: undefined,
      cleanup: new Error('close'),
    },
  ]
  it.each(
    ['cold', 'reused'].flatMap((mode) =>
      ['widget value', 'widget HTML'].flatMap((phase) =>
        faults.map((fault) => ({ mode, phase, ...fault })),
      ),
    ),
  )(
    'finishes output cleanup after $mode $phase $name',
    ({ mode, phase, primary, original, cleanup }) => {
      const text = 'unchanged first paragraph\n\n~~~text\nwidget value\n~~~\n'
      const context = fixture(text)
      const baseline =
        mode === 'reused'
          ? finishPackedSteps(
              PackedProjectionBaseline.create(context.capture, context.source, [], options, limits),
            )
          : undefined
      if (mode === 'reused' && !baseline) throw new Error('Missing projection baseline')
      let capture = context.capture
      let source = context.source
      if (baseline) {
        // An admitted empty overlay advances revision while preserving the exact
        // shared records. Reuse the paragraph, then compare the widget directly.
        source = new PackedSource({ ...source.identity, revision: 1 }, text)
        context.owner.commit(
          context.owner.prepareDelta(context.owner.beginPrepared(source), {
            base: context.source.identity,
            baseSource: text,
            result: source.identity,
            payload: packValue(null, sessionLimits.bytes),
            operations: [],
          }),
        )
        capture = context.owner.capture()
        expect(baseline.compatible(capture, source, options)).toBe(true)
      }
      const find = baseline?.find.bind(baseline)
      const finding =
        baseline &&
        vi
          .spyOn(baseline, 'find')
          .mockImplementation((node, same) =>
            node.scalar(['type'], limits) === 'code' ? undefined : find?.(node, same),
          )
      const before = context.owner.stats
      let paused = false
      let widgetStarts = 0
      let span: PackedItemSteps | undefined
      const elements = PackedReadScope.prototype.elementSteps
      const opening = vi
        .spyOn(PackedReadScope.prototype, 'elementSteps')
        .mockImplementation(function (this: PackedReadScope, path = []) {
          const value = elements.call(this, path)
          if (path.length === 1 && path[0] === 'blocks' && this.hasField('bodyEnd')) span = value
          return value
        })
      const equal = PackedHtmlCursor.prototype.equal
      const comparing = vi.spyOn(PackedHtmlCursor.prototype, 'equal').mockImplementation(function* (
        this: PackedHtmlCursor,
        value: string,
      ) {
        const target =
          phase === 'widget value'
            ? value === 'widget value'
            : value.startsWith('<pre') && ++widgetStarts === 2
        if (target) {
          paused = true
          yield
          if (primary) throw original
        }
        yield* equal.call(this, value)
      })
      const work = validatePackedProjectionOutput(capture, source, paths, options, limits, baseline)
      let closing: ReturnType<typeof vi.spyOn> | undefined
      let returning: ReturnType<typeof vi.spyOn> | undefined
      try {
        while (!paused) expect(work.next().done).toBe(false)
        expect(span).toBeDefined()
        const close = PackedHtmlCursor.prototype.close
        const closed = new Set<PackedHtmlCursor>()
        closing = vi.spyOn(PackedHtmlCursor.prototype, 'close').mockImplementation(function (
          this: PackedHtmlCursor,
        ) {
          expect(closed.has(this)).toBe(false)
          closed.add(this)
          close.call(this)
          if (closed.size === 1) throw cleanup
          throw new Error('later close')
        })
        const finish = PackedItemSteps.prototype.return
        let spansClosed = 0
        returning = vi.spyOn(PackedItemSteps.prototype, 'return').mockImplementation(function (
          this: PackedItemSteps,
        ) {
          const result = finish.call(this)
          if (this === span) {
            spansClosed++
            throw new Error('span close')
          }
          return result
        })
        let threw = false
        let failure: unknown
        try {
          if (primary) work.next()
          else work.return()
        } catch (error) {
          threw = true
          failure = error
        }
        expect(threw).toBe(true)
        expect(failure).toBe(primary ? original : cleanup)
        expect(closed.size).toBe(mode === 'reused' ? 3 : 2)
        expect(spansClosed).toBe(1)
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(work.return()).toEqual({ done: true, value: undefined })
        expect(span?.next()).toEqual({ done: true, value: undefined })
      } finally {
        closing?.mockRestore()
        returning?.mockRestore()
        comparing.mockRestore()
        opening.mockRestore()
        finding?.mockRestore()
        work.return()
        baseline?.close()
        capture.release()
        context.owner.dispose()
      }
    },
  )
  it.each([new Error('widget close'), undefined])(
    'closes a failing completed widget cursor once: %s',
    (failure) => {
      const context = fixture('~~~text\nwidget value\n~~~\n')
      const before = context.owner.stats
      let widget: PackedHtmlCursor | undefined
      let widgetStarts = 0
      const equal = PackedHtmlCursor.prototype.equal
      const comparing = vi.spyOn(PackedHtmlCursor.prototype, 'equal').mockImplementation(function* (
        this: PackedHtmlCursor,
        value: string,
      ) {
        if (value.startsWith('<pre') && ++widgetStarts === 2) widget = this
        yield* equal.call(this, value)
      })
      const close = PackedHtmlCursor.prototype.close
      let widgetCloses = 0
      const closing = vi.spyOn(PackedHtmlCursor.prototype, 'close').mockImplementation(function (
        this: PackedHtmlCursor,
      ) {
        close.call(this)
        if (this === widget) {
          widgetCloses++
          throw failure
        }
      })
      const work = validatePackedProjectionOutput(
        context.capture,
        context.source,
        paths,
        options,
        limits,
      )
      try {
        let threw = false
        let caught: unknown
        try {
          finishPackedSteps(work)
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(failure)
        expect(widgetCloses).toBe(1)
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        closing.mockRestore()
        comparing.mockRestore()
        work.return()
        context.owner.dispose()
      }
    },
  )

  const text = 'alpha\nbeta\n\n~~~text\nconst x = 1\n~~~\n\nlast[^a]\n\n[^a]: note $x$\n'
  const changes: { name: string; mutate: (value: Snapshot) => void }[] = [
    {
      name: 'same-length body HTML',
      mutate: (v) => {
        v.projection.html = v.projection.html.replace('alpha', 'omega')
      },
    },
    {
      name: 'same-length footer HTML',
      mutate: (v) => {
        v.projection.html = v.projection.html.replace('note', 'fake')
      },
    },
    {
      name: 'same-length widget HTML',
      mutate: (v) => {
        const block = v.projection.blocks[0]
        if (!block) throw new Error('Missing widget')
        block.html = block.html.replace('code', 'coda')
      },
    },
    {
      name: 'appended widget HTML',
      mutate: (v) => {
        const block = v.projection.blocks[0]
        if (!block) throw new Error('Missing widget')
        block.html += '<b>forged 界😀</b>'
      },
    },
    {
      name: 'all widgets omitted',
      mutate: (v) => {
        v.projection.blocks = []
      },
    },
    {
      name: 'one nested/footer widget omitted',
      mutate: (v) => {
        v.projection.blocks.pop()
      },
    },
    {
      name: 'geometrically valid wrong span boundary',
      mutate: (v) => {
        const first = v.layout.blocks[0]
        const second = v.layout.blocks[1]
        if (!first || !second) throw new Error('Missing spans')
        const boundary = v.projection.html.indexOf('\n')
        v.layout = {
          ...v.layout,
          blocks: v.layout.blocks.map((block, index) =>
            index === 0
              ? { ...block, to: boundary }
              : index === 1
                ? { ...block, from: boundary + 1 }
                : block,
          ),
        }
      },
    },
  ]
  it.each(changes)('rejects $name that passes field/geometry checks', ({ mutate }) => {
    const value = snapshot(text)
    mutate(value)
    const context = fixture(text, value)
    const before = context.owner.stats
    try {
      finishPackedSteps(
        validatePackedProjection(context.capture, context.source, paths, options, limits),
      )
      expect(() =>
        finishPackedSteps(
          validatePackedSnapshot(context.capture, context.source, [], options, limits),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects a source-valid widget attached to an unused footnote', () => {
    const text = `[^unused]: $x$\n\n${'body '.repeat(30)}\n`
    const value = snapshot(text)
    const node = find(value.document.root, 'inlineMath')
    if (!node?.position || node.type !== 'inlineMath') throw new Error('Missing unused math')
    value.projection.blocks.push({
      kind: 'inlineMath',
      from: node.position.start.offset ?? 0,
      to: node.position.end.offset ?? 0,
      value: node.value,
      html: '<code>x</code>',
    })
    const context = fixture(text, value)
    try {
      finishPackedSteps(
        validatePackedProjection(context.capture, context.source, paths, options, limits),
      )
      expect(() =>
        finishPackedSteps(
          validatePackedSnapshot(context.capture, context.source, [], options, limits),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
  it.each([false, true])(
    'matches global definitions and out-of-order footnote widgets with rawHtml=%s',
    (rawHtml) => {
      const render = { ...options, rawHtml }
      for (const text of [
        '\ufeff# 😀\r\n\r\n<script>raw</script>\r\n',
        '[^b]: ```js\n    b()\n    ```\n\n[^a]: ![picture](local.png) and $x$ with [^b]\n\n~~~MeRmAiD\ngraph TD; A-->B\n~~~\n\ncall[^a] and [^b] and [^a]\n',
        '[r]: /first\n\n[r]: /second\n\n![a][r]\n\n[^x]: [^y] $x$\n\n[^y]: [^x] ![b](local.png)\n\nx[^y]\n',
        '| ![a](https://example.com/a.png) |\n| - |\n| $x$ |\n\n$$\ny^2\n$$\n',
      ]) {
        const context = fixture(text, snapshot(text, render), render)
        const before = context.owner.stats
        try {
          finishPackedSteps(
            validatePackedSnapshot(context.capture, context.source, [], render, limits),
          )
          expect(context.owner.stats).toEqual(before)
        } finally {
          context.owner.dispose()
        }
      }
    },
  )
  it.each([100, 600])('validates %s complete paragraphs with a two MiB retained budget', (size) => {
    const context = fixture('one\n\n'.repeat(size))
    const before = context.owner.stats
    try {
      finishPackedSteps(
        validatePackedSnapshot(context.capture, context.source, [], options, {
          ...limits,
          retained: 2 * MiB,
        }),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
    expect(context.owner.stats.retainedBytes).toBe(0)
  })
  it('compares a 400,000-unit widget with two live decoders inside the local budget', () => {
    const text = `~~~plain\n${'a界😀'.repeat(100000)}\n~~~\n`
    const context = fixture(text)
    const before = context.owner.stats
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    let peak = 0
    const work = validatePackedSnapshot(context.capture, context.source, [], options, limits)
    try {
      while (!work.next().done) {
        peak = Math.max(peak, context.owner.stats.readerStagingBytes)
        expect(context.owner.stats.readerStagingBytes).toBeLessThanOrEqual(limits.staging)
      }
      // Streaming comparison removes complete HTML and widget output buffers. Native
      // input/construction still accounts for more than four MiB in this fixture.
      expect(peak).toBeGreaterThan(4 * MiB)
      expect(peak).toBeLessThan(5 * MiB)
      expect(context.owner.stats).toEqual(before)
      for (const result of scalar.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(4096)
    } finally {
      scalar.mockRestore()
      context.owner.dispose()
    }
  })
  it('compares the complete 1 MiB paragraph under the existing staging cap without full HTML serialization', () => {
    const source =
      '# single-paragraph\n\n' +
      'A long paragraph still needs responsive editing, accurate counts and current semantics. '.repeat(
        12336,
      )
    const context = fixture(source)
    const before = context.owner.stats
    const serialize = vi.mocked(html.toHtml)
    serialize.mockClear()
    const work = validatePackedSnapshot(context.capture, context.source, [], options, {
      ...limits,
      retained: 32 * MiB,
    })
    try {
      while (!work.next().done)
        expect(context.owner.stats.readerStagingBytes).toBeLessThanOrEqual(limits.staging)
      expect(context.owner.stats).toEqual(before)
      expect(serialize.mock.calls.length).toBeGreaterThan(250)
      for (const [tree] of serialize.mock.calls) {
        if (Array.isArray(tree)) throw new Error('Unexpected complete children serialization')
        if (tree.type === 'text' || tree.type === 'raw')
          expect(tree.value.length).toBeLessThanOrEqual(4096)
        else {
          expect(tree.type).toBe('element')
          if ('children' in tree) expect(tree.children.length).toBeLessThanOrEqual(1)
        }
      }
    } finally {
      work.return()
      serialize.mockClear()
      context.owner.dispose()
    }
  })
  it.each([4095, 4096, 8191, 1000000])(
    'rejects a same-length forgery at large HTML offset %s',
    (offset) => {
      const source = 'A plain paragraph. '.repeat(56000)
      const value = snapshot(source)
      value.projection.html = `${value.projection.html.slice(0, offset)}!${value.projection.html.slice(offset + 1)}`
      const context = fixture(source, value)
      const before = context.owner.stats
      try {
        expect(() =>
          finishPackedSteps(
            validatePackedSnapshot(context.capture, context.source, [], options, limits),
          ),
        ).toThrow(/semantic/)
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it('copies paths/options/limits and rejects mismatched source policy', () => {
    const context = fixture(text)
    const altered = {
      root: [...paths.root],
      projection: [...paths.projection],
      layout: [...paths.layout],
    }
    const render = { ...options }
    const budget = { ...limits }
    const work = validatePackedProjectionOutput(
      context.capture,
      context.source,
      altered,
      render,
      budget,
    )
    altered.root[0] = 'missing'
    render.rawHtml = true
    budget.staging = 0
    try {
      finishPackedSteps(work)
      expect(() =>
        finishPackedSteps(
          validatePackedProjectionOutput(context.capture, context.source, paths, render, limits),
        ),
      ).toThrow(/semantic/)
      expect(context.owner.stats.readers).toBe(0)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['return', 'release', 'dispose'] as const)(
    'closes exact UTF-16 comparison on %s',
    (action) => {
      const text = `~~~text\n${'a界😀'.repeat(10000)}\n~~~\n`
      const context = fixture(text)
      const before = context.owner.stats
      let compared = false
      const equal = PackedHtmlCursor.prototype.equal
      const spy = vi.spyOn(PackedHtmlCursor.prototype, 'equal').mockImplementation(function* (
        this: PackedHtmlCursor,
        value: string,
      ) {
        for (const next of equal.call(this, value)) {
          compared = true
          yield next
        }
      })
      const work = validatePackedSnapshot(context.capture, context.source, [], options, limits)
      try {
        while (!compared) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        if (action === 'release') context.capture.release()
        if (action === 'dispose') context.owner.dispose()
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        spy.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('withholds acceptance/ACK on forged HTML or omitted widgets, preserves old captures and accepts a retry', () => {
    const receiver = new PackedReceiver(sessionLimits, (capture, source) =>
      validatePackedSnapshot(capture, source, [], options, limits),
    )
    const value = snapshot(text)
    const source = checked(text, value)
    const packet = (ticket: ReturnType<PackedReceiver['begin']>, snapshot: Snapshot) => ({
      protocol: packedWireVersion,
      kind: 'full',
      sequence: ticket.sequence,
      result: ticket.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: packValue(snapshot, sessionLimits.bytes),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    })
    try {
      const initial = receiver.begin(1, source)
      const accepted = finishPackedSteps(receiver.receiveSteps(initial, packet(initial, value)))
      if (accepted?.kind !== 'accepted') throw new Error('Missing accepted fixture')
      let sequence = 1
      for (const { mutate } of changes) {
        if (!mutate) throw new Error('Missing forgery')
        const forged = structuredClone(value)
        mutate(forged)
        const updated = checked(text, value, options, 1)
        const ticket = receiver.begin(++sequence, updated)
        const work = receiver.receiveSteps(ticket, packet(ticket, forged))
        expect(() => {
          while (true) {
            const next = work.next()
            expect(next.done).toBe(false)
            expect(next.value).toBeUndefined()
            expect(receiver.stats.current).toEqual(source.identity)
          }
        }).toThrow(/semantic/)
        expect(receiver.stats.current).toEqual(source.identity)
        expect(receiver.stats.prepared).toBeNull()
        expect(receiver.stats.readers).toBe(0)
        expect(receiver.stats.readerStagingBytes).toBe(0)
        expect(accepted.capture.reader.textLength(['projection', 'html'])).toBe(
          value.projection.html.length,
        )
      }
      const retry = receiver.begin(++sequence, checked(text, value, options, 1))
      expect(finishPackedSteps(receiver.receiveSteps(retry, packet(retry, value)))?.kind).toBe(
        'accepted',
      )
      accepted.capture.release()
    } finally {
      receiver.dispose()
    }
    expect(receiver.stats.retainedBytes).toBe(0)
  })
  it.each(['widget HTML', 'widget value', 'footer'] as const)(
    'cancels a prepared receipt during %s comparison and accepts a retry',
    (phase) => {
      const text = `~~~text\n${'a界😀'.repeat(10000)}\n~~~\n\nbody[^a]\n\n[^a]: note $x$\n`
      const value = snapshot(text)
      const source = checked(text, value)
      const receiver = new PackedReceiver(sessionLimits, (capture, source) =>
        validatePackedSnapshot(capture, source, [], options, limits),
      )
      const packet = (ticket: ReturnType<PackedReceiver['begin']>) => ({
        protocol: packedWireVersion,
        kind: 'full',
        sequence: ticket.sequence,
        result: ticket.identity,
        requestToken: ticket.requestToken,
        resultToken: newPackedToken(),
        sentAt: 0,
        payload: packValue(value, sessionLimits.bytes),
        metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
      })
      const first = receiver.begin(1, source)
      const accepted = finishPackedSteps(receiver.receiveSteps(first, packet(first)))
      if (accepted?.kind !== 'accepted') throw new Error('Missing initial acceptance')
      const revised = checked(text, value, options, 1)
      const ticket = receiver.begin(2, revised)
      const work = receiver.receiveSteps(ticket, packet(ticket))
      const expected =
        phase === 'footer'
          ? value.projection.html.slice(value.layout.bodyEnd)
          : phase === 'widget HTML'
            ? value.projection.blocks[0]?.html
            : value.projection.blocks[0]?.value
      if (!expected) throw new Error('Missing comparison fixture')
      let reached = false
      let widgetStarts = 0
      const equal = PackedHtmlCursor.prototype.equal
      const spy = vi.spyOn(PackedHtmlCursor.prototype, 'equal').mockImplementation(function* (
        this: PackedHtmlCursor,
        value: string,
      ) {
        const target =
          phase === 'widget value'
            ? value === expected
            : phase === 'footer'
              ? (value.startsWith('\n<section') && expected.startsWith(value)) ||
                (value.startsWith('<section') && expected.startsWith(`\n${value}`))
              : value.startsWith('<pre') && expected.startsWith(value) && ++widgetStarts === 2
        if (target) {
          // Pause at the exact comparison entry even when a short shell is already
          // decoded. The prepared receipt and active widget/footer scope remain live.
          reached = true
          yield
        }
        yield* equal.call(this, value)
      })
      try {
        while (!reached) {
          const next = work.next()
          expect(next.done).toBe(false)
          expect(next.value).toBeUndefined()
        }
        expect(receiver.stats.prepared).toEqual(revised.identity)
        expect(receiver.stats.current).toEqual(source.identity)
        expect(receiver.cancel(ticket)).toBe(true)
        expect(work.next().done).toBe(true)
        expect(receiver.stats.prepared).toBeNull()
        expect(receiver.stats.current).toEqual(source.identity)
        expect(receiver.stats.readers).toBe(0)
        expect(receiver.stats.readerStagingBytes).toBe(0)
        expect(accepted.capture.reader.textLength(['projection', 'html'])).toBe(
          value.projection.html.length,
        )
        const retry = receiver.begin(3, revised)
        const result = finishPackedSteps(receiver.receiveSteps(retry, packet(retry)))
        expect(result?.kind).toBe('accepted')
        if (result?.kind === 'accepted') result.capture.release()
      } finally {
        work.return()
        spy.mockRestore()
        accepted.capture.release()
        receiver.dispose()
      }
      expect(receiver.stats.retainedBytes).toBe(0)
    },
  )
})
