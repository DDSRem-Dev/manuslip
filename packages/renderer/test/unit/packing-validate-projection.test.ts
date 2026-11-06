import { describe, expect, it, vi } from 'vitest'
import { type SemanticDocument, sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedArena } from '../../../core/src/packing-arena'
import { PackedReceiver } from '../../../core/src/packing-receiver'
import { PackedSession } from '../../../core/src/packing-session'
import { type PackedIdentity, PackedSource } from '../../../core/src/packing-source'
import { newPackedToken } from '../../../core/src/packing-token'
import { packedWireVersion } from '../../../core/src/packing-wire'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type RenderOptions, type RenderProjection, rendererVersion } from '../../src/index'
import { validatePackedProjection } from '../../src/packing-validate-projection'
import { validatePackedSnapshot } from '../../src/packing-validate-snapshot'
import { type ProjectionLayout, renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
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
function snapshot(
  text: string,
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
  render = options,
): Snapshot {
  const document = parseMarkdown(text, syntax)
  const result = renderProjectionLayout(document.root, render, 8 * MiB)
  return { document, projection: result.projection, layout: result.layout }
}
function source(text: string, value: Snapshot, render = options, revision = 0) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'projection-validation',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: value.document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
}
function fixture(
  text: string,
  value = snapshot(text),
  render = options,
  identity: Partial<PackedIdentity> = {},
) {
  const checked = new PackedSource({ ...source(text, value, render).identity, ...identity }, text)
  const owner = new PackedSession(limits)
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(checked),
      checked.identity,
      packValue(value, limits.bytes),
    ),
  )
  return { owner, checked, capture: owner.capture() }
}
function validate(text: string, value = snapshot(text), render = options) {
  const context = fixture(text, value, render)
  try {
    finishPackedSteps(
      validatePackedSnapshot(context.capture, context.checked, [], render, validation),
    )
    expect(context.owner.stats.readers).toBe(0)
    expect(context.owner.stats.readerStagingBytes).toBe(0)
  } finally {
    context.owner.dispose()
  }
  expect(context.owner.stats.retainedBytes).toBe(0)
}

describe('packed projection and serializer layout field validation', () => {
  describe.each(['commonmark', 'manuslip'] as const)(
    'matches every pinned CommonMark render in %s',
    (syntax) => {
      it.each(examples)('CommonMark $example: $section', (example) => {
        validate(example.markdown, snapshot(example.markdown, syntax))
      })
    },
  )
  const extensions = [
    'Term *界* :smile:\r\n: First **description**.\r\n\r\n    | A | B |\r\n    | - | - |\r\n    | : one | ^2^ |\r\n\r\nNext\r\n: Last [link][r].\r\n\r\n[r]: /target\r\n',
    '```seq\r\nparticipant 用户 as U\r\nU->Service: 你好\r\n```\r\n\r\n```FLOW\r\na=>start: 开始\r\nb=>end: 完成\r\na->b\r\n```\r\n',
    '',
    '\ufeff',
    '\ufeff# 😀\r\n\r\nSecond\r\n',
    '---\ntitle: hidden\n---\n\n# Heading\n\n[r]: /url\n\nsecond\n',
    '+++\ntitle = "hidden"\n+++\n\n[r]: /url\n',
    'a[^x] b[^y] c[^x]\n\n[^x]: first **footnote**\n\n    ```mermaid\n    graph TD; A-->B\n    ```\n\n[^y]: ![alt](image.png)\n',
    '$a$ and $$b$$\n\n$$\nc^2\n$$\n\n```MeRmAiD\ngraph TD; A-->B\n```\n',
    '| A | B |\n| - | - |\n| *one* | ![](url) |\n\n~~~ts\nconst x = 1\n~~~\n',
    '# <i>raw</i>\n\n<script>alert(1)</script>\n\n![x][r]\n\n[r]: ./local.png\n',
    '> > nested **text** [a](javascript:alert(1))\n\n- [x] task\n- [ ] task\n',
    '[r]: /one\n\n# ![a][r]\n\n[r]: /two\n\n![missing][unknown]\n',
    `# ${'界😀\ud800\udfff'.repeat(1200)}\n\nend\n`,
    `~~~${'x'.repeat(5000)}\nbody\n~~~\n`,
  ]
  it.each([false, true])(
    'validates extensions, omissions and footers with rawHtml=%s',
    (rawHtml) => {
      const render = { ...options, rawHtml }
      for (const text of extensions) validate(text, snapshot(text, 'manuslip', render), render)
    },
  )
  const text = '# Heading\n\n```mermaid\ngraph TD; A-->B\n```\n\nsecond\n\n[r]: /url\n'
  const changes: { name: string; change: (value: Snapshot) => void }[] = [
    {
      name: 'legacy syntax on a Mermaid source widget',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'syntax', 'sequence')
      },
    },
    {
      name: 'invalid diagram syntax',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'syntax', ['mermaid'])
      },
    },
    {
      name: 'unknown snapshot field',
      change: (v) => {
        Reflect.set(v, 'extra', 1)
      },
    },
    {
      name: 'unknown projection field',
      change: (v) => {
        Reflect.set(v.projection, 'extra', 1)
      },
    },
    {
      name: 'missing projection field',
      change: (v) => {
        Reflect.deleteProperty(v.projection, 'renderMs')
      },
    },
    {
      name: 'HTML type',
      change: (v) => {
        Reflect.set(v.projection, 'html', 1)
      },
    },
    {
      name: 'renderer version',
      change: (v) => {
        v.projection.rendererVersion = 'stale'
      },
    },
    {
      name: 'negative timing',
      change: (v) => {
        v.projection.renderMs = -1
      },
    },
    {
      name: 'timing type',
      change: (v) => {
        Reflect.set(v.projection, 'renderMs', '1')
      },
    },
    {
      name: 'block array type',
      change: (v) => {
        Reflect.set(v.projection, 'blocks', {})
      },
    },
    {
      name: 'block kind',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'kind', 'heading')
      },
    },
    {
      name: 'unknown block field',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'extra', 1)
      },
    },
    {
      name: 'negative block start',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'from', -1)
      },
    },
    {
      name: 'inverted block range',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'to', 0)
      },
    },
    {
      name: 'block beyond source',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'to', text.length + 1)
      },
    },
    {
      name: 'block HTML type',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'html', false)
      },
    },
    {
      name: 'empty widget HTML',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'html', '')
      },
    },
    {
      name: 'block value type',
      change: (v) => {
        Reflect.set(v.projection.blocks[0] ?? {}, 'value', [])
      },
    },
    {
      name: 'duplicate block range',
      change: (v) => {
        v.projection.blocks.push({ ...required(v.projection.blocks[0]) })
      },
    },
    {
      name: 'unknown layout field',
      change: (v) => {
        Reflect.set(v.layout, 'extra', 1)
      },
    },
    {
      name: 'missing span',
      change: (v) => {
        Reflect.set(v.layout, 'blocks', v.layout.blocks.slice(1))
      },
    },
    {
      name: 'HTML length',
      change: (v) => {
        Reflect.set(v.layout, 'htmlLength', v.layout.htmlLength + 1)
      },
    },
    {
      name: 'body end',
      change: (v) => {
        Reflect.set(v.layout, 'bodyEnd', v.layout.bodyEnd - 1)
      },
    },
    {
      name: 'unknown span field',
      change: (v) => {
        Reflect.set(v.layout.blocks[0] ?? {}, 'extra', 1)
      },
    },
    {
      name: 'span visibility type',
      change: (v) => {
        Reflect.set(v.layout.blocks[0] ?? {}, 'visible', 1)
      },
    },
    {
      name: 'hidden visible root child',
      change: (v) => {
        Reflect.set(v.layout.blocks[0] ?? {}, 'visible', false)
      },
    },
    {
      name: 'shown definition',
      change: (v) => {
        Reflect.set(v.layout.blocks.at(-1) ?? {}, 'visible', true)
      },
    },
    {
      name: 'noncanonical hidden anchor',
      change: (v) => {
        Reflect.set(v.layout.blocks.at(-1) ?? {}, 'from', 0)
      },
    },
    {
      name: 'first span starts late',
      change: (v) => {
        Reflect.set(v.layout.blocks[0] ?? {}, 'from', 1)
      },
    },
    {
      name: 'fractional span end',
      change: (v) => {
        Reflect.set(v.layout.blocks[0] ?? {}, 'to', 1.5)
      },
    },
    {
      name: 'out-of-order span',
      change: (v) => {
        Reflect.set(v.layout.blocks[1] ?? {}, 'from', 0)
      },
    },
    {
      name: 'wrong separator spelling',
      change: (v) => {
        const at = required(v.layout.blocks[0]).to
        v.projection.html = `${v.projection.html.slice(0, at)} ${v.projection.html.slice(at + 1)}`
      },
    },
  ]
  it.each(changes)('rejects $name before publication', ({ change }) => {
    const value = structuredClone(snapshot(text))
    change(value)
    expect(() => validate(text, value)).toThrow()
  })
  it.each(['image', 'table'] as const)('rejects a nonempty %s value', (kind) => {
    const text = kind === 'image' ? '![](url)\n' : '| A |\n| - |\n| B |\n'
    const value = snapshot(text)
    required(value.projection.blocks[0]).value = 'unexpected'
    expect(() => validate(text, value)).toThrow()
  })
  it('enforces nested-block ordering by start then descending end', () => {
    const text = '| ![](url) |\n| - |\n| B |\n'
    const value = snapshot(text)
    expect(value.projection.blocks.length).toBe(2)
    value.projection.blocks.reverse()
    expect(() => validate(text, value)).toThrow()
  })
  it.each([
    {
      name: 'plausible wrong kind',
      change: (value: Snapshot) => {
        required(value.projection.blocks[0]).kind = 'code'
      },
    },
    {
      name: 'plausible wrong range',
      change: (value: Snapshot) => {
        required(value.projection.blocks[0]).from++
      },
    },
    {
      name: 'same-length wrong value',
      change: (value: Snapshot) => {
        required(value.projection.blocks[0]).value = 'x'.repeat(
          required(value.projection.blocks[0]).value.length,
        )
      },
    },
  ])('rejects a widget with $name against the packed source root', ({ change }) => {
    const value = snapshot(text)
    change(value)
    expect(() => validate(text, value)).toThrow('Invalid packed semantic document')
  })
  it('compares long widget values code unit by code unit across decoder chunks', () => {
    const text = `~~~plain\n${'a\ud800😀界'.repeat(5000)}\n~~~\n`
    const value = snapshot(text)
    validate(text, value)
    const block = required(value.projection.blocks[0])
    block.value = `${block.value.slice(0, 12000)}x${block.value.slice(12001)}`
    expect(() => validate(text, value)).toThrow('Invalid packed semantic document')
  })
  it('preflights all widget copies before reading any value or allocating its comparison map', () => {
    const text = `~~~plain\n${'x'.repeat(150000)}\n~~~\n`
    const context = fixture(text)
    const before = context.owner.stats
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedProjection(context.capture, context.checked, paths, options, {
            ...validation,
            staging: 700000,
          }),
        ),
      ).toThrow('workspace')
      expect(context.owner.stats).toEqual(before)
      finishPackedSteps(
        validatePackedProjection(context.capture, context.checked, paths, options, validation),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('rejects mismatching caller options even when source and renderer identities match', () => {
    const context = fixture(text)
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedProjection(
            context.capture,
            context.checked,
            paths,
            { ...options, rawHtml: true },
            validation,
          ),
        ),
      ).toThrow('Invalid packed semantic document')
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['retained', 'staging', 'nodes', 'depth'] as const)(
    'enforces local %s admission and restores accounting',
    (field) => {
      const context = fixture(text)
      const before = context.owner.stats
      try {
        expect(() =>
          finishPackedSteps(
            validatePackedProjection(context.capture, context.checked, paths, options, {
              ...validation,
              [field]: 1,
            }),
          ),
        ).toThrow()
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )
  it.each(['source', 'renderer', 'options'] as const)('rejects a stale %s binding', (kind) => {
    const value = snapshot(text)
    const identity: Partial<PackedIdentity> = {}
    if (kind === 'renderer') identity.rendererVersion = 'stale'
    if (kind === 'options') identity.options = '{}'
    const context = fixture(text, value, options, identity)
    const checked = kind === 'source' ? source(text, value) : context.checked
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedProjection(context.capture, checked, paths, options, validation),
        ),
      ).toThrow()
    } finally {
      context.owner.dispose()
    }
  })
  it('copies options, paths and budgets before suspension', () => {
    const context = fixture(text)
    const changedPaths = {
      root: [...paths.root],
      layout: [...paths.layout],
      projection: [...paths.projection],
    }
    const render = { ...options }
    const budget = { ...validation }
    const work = validatePackedProjection(
      context.capture,
      context.checked,
      changedPaths,
      render,
      budget,
    )
    changedPaths.layout[0] = 'missing'
    render.rawHtml = true
    budget.nodes = 0
    try {
      finishPackedSteps(work)
    } finally {
      context.owner.dispose()
    }
  })
  it('streams large HTML without scalar materialization and charges live decoder workspace', () => {
    const context = fixture(`${'paragraph '.repeat(20000)}\n\nend\n`)
    const before = context.owner.stats
    const spy = vi.spyOn(PackedArena.prototype, 'scalar')
    let peak = 0
    let steps = 0
    try {
      const work = validatePackedProjection(
        context.capture,
        context.checked,
        paths,
        options,
        validation,
      )
      while (!work.next().done) {
        peak = Math.max(peak, context.owner.stats.readerStagingBytes)
        expect(context.owner.stats.readerStagingBytes).toBeLessThanOrEqual(validation.staging)
        steps++
      }
      expect(steps).toBeGreaterThan(100)
      expect(peak).toBeGreaterThan(300000)
      expect(context.owner.stats).toEqual(before)
      for (const result of spy.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(4096)
    } finally {
      spy.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['complete', 'cancel'] as const)(
    'forwards lazy root, span and widget-array prefixes during %s',
    (action) => {
      const text = '~~~plain\nvalue\n~~~\n\n'.repeat(3000)
      const value = snapshot(text)
      const context = fixture(text, value)
      const checked = source(text, value, options, 1)
      const payload = packValue([], limits.bytes)
      const record = PackedArena.open(payload.slice(0), limits).root
      context.owner.commit(
        context.owner.prepareDelta(context.owner.beginPrepared(checked), {
          base: context.checked.identity,
          baseSource: text,
          result: checked.identity,
          payload,
          operations: [
            paths.root.concat('children'),
            paths.layout.concat('blocks'),
            paths.projection.concat('blocks'),
          ].map((path) => ({ kind: 'splice' as const, path, start: 2500, remove: 0, record })),
        }),
      )
      const capture = context.owner.capture()
      let reads = 0
      let prefixes = 0
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
      const work = validatePackedProjection(capture, checked, paths, options, validation)
      try {
        while (true) {
          const before = reads
          const step = work.next()
          expect(reads - before).toBeLessThanOrEqual(520)
          if (step.done) break
          if (reads - before >= 256) {
            prefixes++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(prefixes).toBeGreaterThan(0)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(context.capture.reader.length(['projection', 'blocks'])).toBe(3000)
      } finally {
        work.return()
        spy.mockRestore()
        context.owner.dispose()
      }
    },
  )
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}

describe('packed projection receipt and cancellation', () => {
  it.each(['unstarted', 'html', 'blocks'] as const)(
    'releases %s scopes without advancing the escaped work',
    (phase) => {
      const text = '# heading\n\n```js\nlet x = 1\n```\n'
      const context = fixture(text)
      const work = validatePackedProjection(
        context.capture,
        context.checked,
        paths,
        options,
        validation,
      )
      let steps = 0
      try {
        if (phase !== 'unstarted')
          while (true) {
            expect(work.next().done).toBe(false)
            if (++steps > 1000) throw new Error('Missing phase')
            if (phase === 'html' && context.owner.stats.readerStagingBytes > 300000) break
            if (phase === 'blocks' && context.owner.stats.readers === 3) break
          }
        context.capture.release()
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it('rejects bad layout after exact document validation, preserves the old capture and accepts a retry', () => {
    const receiver = new PackedReceiver(limits, (capture, checked) =>
      validatePackedSnapshot(capture, checked, [], options, validation),
    )
    const text = '# Heading\n\nparagraph\n'
    const value = snapshot(text)
    const checked = source(text, value)
    const packet = (ticket: ReturnType<PackedReceiver['begin']>, value: Snapshot) => ({
      protocol: packedWireVersion,
      kind: 'full',
      sequence: ticket.sequence,
      result: ticket.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: packValue(value, limits.bytes),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    })
    try {
      const ticket = receiver.begin(1, checked)
      const original = finishPackedSteps(receiver.receiveSteps(ticket, packet(ticket, value)))
      if (original?.kind !== 'accepted') throw new Error('Missing initial snapshot')
      const changed = structuredClone(value)
      Reflect.set(changed.layout, 'bodyEnd', value.layout.bodyEnd - 1)
      const updated = source(text, value, options, 1)
      const next = receiver.begin(2, updated)
      const work = receiver.receiveSteps(next, packet(next, changed))
      expect(() => {
        while (true) {
          const step = work.next()
          expect(step.done).toBe(false)
          expect(step.value).toBeUndefined()
          expect(receiver.stats.current).toEqual(checked.identity)
        }
      }).toThrow('Invalid packed semantic document')
      expect(receiver.stats.readers).toBe(0)
      expect(receiver.stats.readerStagingBytes).toBe(0)
      expect(receiver.stats.prepared).toBeNull()
      expect(receiver.stats.current).toEqual(checked.identity)
      expect(original.capture.reader.textLength(['projection', 'html'])).toBe(
        value.projection.html.length,
      )
      const retry = receiver.begin(3, updated)
      const accepted = finishPackedSteps(receiver.receiveSteps(retry, packet(retry, value)))
      expect(accepted?.kind).toBe('accepted')
      original.capture.release()
    } finally {
      receiver.dispose()
    }
    expect(receiver.stats.retainedBytes).toBe(0)
  })
})
