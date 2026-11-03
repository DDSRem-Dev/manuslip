import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedReadScope } from '../../../core/src/packing-capture'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import {
  type CollectedProjectionContext,
  collectProjectionContext,
} from '../../src/collected-projection-context'
import { rendererVersion } from '../../src/index'
import * as definitions from '../../src/packed-projection-definitions'
import { validatePackedSnapshot } from '../../src/packing-validate-snapshot'
import * as engine from '../../src/projection-engine'
import { renderProjectionLayout } from '../../src/projection-layout'

vi.mock('../../src/packed-projection-definitions', { spy: true })
vi.mock('../../src/projection-engine', { spy: true })

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const text = `# Heading

Body [r][ref] with note[^a], another[^b], and repeated[^a].

> [nested]: /nested
>
> Nested [link][nested].

[ref]: /first
[ref]: /second

[^a]: First [link][ref] and nested call[^b].

    [inner]: /inside

[^b]: Second *note* 界😀.

Last [reference][inner].
`
function fixture(body = text, syntax: 'commonmark' | 'manuslip' = 'manuslip') {
  const document = parseMarkdown(body, syntax)
  const { projection, layout } = renderProjectionLayout(document.root, options, limits.staging)
  const value = { document, projection, layout }
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'collected-context',
      revision: 0,
      sourceHash: sourceHash(body),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    body,
  )
  return { value, source }
}
function opened(data = fixture()) {
  const owner = new PackedSession({
    ...limits,
    retained: 64 * MiB,
    bytes: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(data.source),
      data.source.identity,
      packValue(data.value, 8 * MiB),
    ),
  )
  const capture = owner.capture()
  return { ...data, owner, capture }
}
function validate(context: ReturnType<typeof opened>, budget = limits) {
  return validatePackedSnapshot(context.capture, context.source, [], options, budget)
}

describe('context collected by complete cold snapshot validation', () => {
  it('uses complete validation for widget-free bodies and the selected footer context', () => {
    const context = opened(
      fixture(
        'Body with **strong** and *emphasized* text.\n\n> [nested]: /nested\n\n[ref]: /first\n[ref]: /second\n\nLast 界😀.',
      ),
    )
    const describeNode = vi.mocked(engine.describeProjectionNode)
    describeNode.mockClear()
    try {
      finishPackedSteps(validate(context))
      expect(describeNode).not.toHaveBeenCalled()
    } finally {
      context.owner.dispose()
    }
  })

  it.each([
    ['list', '3. first\n1. second\n9. third'],
    ['list', '0) zero\n0) one'],
    ['list', '- Outer\n\n  7. nested\n  1. next'],
    ['blockquote', '> 3. first\n> 1. second'],
    ['table', '| A | B |\n| --- | --- |\n| one | two |'],
    ['code', '```js\nconst value = 1\n```'],
    ['code', '```MeRmAiD\ngraph LR; A-->B\n```'],
    ['math', '$$\nx^2\n$$'],
    ['inlineMath', 'Body $x^2$ text.'],
    ['image', '![Picture](/picture.png)'],
    ['imageReference', '![Picture][ref]\n\n[ref]: /picture.png'],
    ['link', 'Body [**Guide**](https://example.invalid/guide).'],
    ['linkReference', 'Body [Guide][ref].\n\n[ref]: https://example.invalid/guide'],
    ['footnoteReference', 'Call[^a].\n\n[^a]: Note with $x$.'],
    ['footnoteDefinition', 'Call[^a].\n\n[^a]: **Rich** note.'],
    ['paragraph', `${'word '.repeat(7000)}**strong**`],
    ['html', '<div>Raw HTML</div>'],
    ['code', 'Unused note.\n\n[^unused]:\n    ```js\n    const unused = 1\n    ```'],
    ['imageReference', 'Call[^a].\n\n[^a]: ![Picture][ref]\n\n    [ref]: /picture.png'],
  ])('preserves complete %s descriptions, including unused or nested notes: %s', (type, body) => {
    const context = opened(fixture(`Plain first.\n\n${body}\n\nPlain last.`))
    const before = context.owner.stats
    const describeNode = vi.mocked(engine.describeProjectionNode)
    describeNode.mockClear()
    try {
      finishPackedSteps(validate(context))
      expect(describeNode.mock.calls.some(([node]) => node.type === type)).toBe(true)
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['missing', 'offset', 'range'] as const)(
    'retains full descriptions for a %s body record identity',
    (change) => {
      const context = opened(fixture('Plain first.\n\nPlain last.'))
      const original = PackedReadScope.prototype.recordKey
      const key = vi.spyOn(PackedReadScope.prototype, 'recordKey').mockImplementation(function (
        this: PackedReadScope,
        path,
      ) {
        const value = original.call(this, path)
        if (!value || change === 'missing') return undefined
        return { ...value, [change]: 1 }
      })
      const describeNode = vi.mocked(engine.describeProjectionNode)
      describeNode.mockClear()
      const before = context.owner.stats
      try {
        finishPackedSteps(validate(context))
        expect(describeNode).toHaveBeenCalled()
        expect(context.owner.stats).toEqual(before)
      } finally {
        key.mockRestore()
        context.owner.dispose()
      }
    },
  )

  it('binds summaries to the active borrow, exact source/capture/root and body record', () => {
    const context = opened(fixture('Plain first.\n\nPlain last.'))
    const second = context.owner.capture()
    const root = ['document', 'root']
    let escaped: CollectedProjectionContext | undefined
    const before = context.owner.stats
    try {
      finishPackedSteps(
        context.capture.work(
          collectProjectionContext(
            context.capture,
            context.source,
            root,
            limits,
            function* (collected) {
              escaped = collected
              const first = context.capture.reader.at([...root, 'children', 0])
              const last = context.capture.reader.at([...root, 'children', 1])
              const summary = () =>
                collected.descriptionAbsence(context.capture, context.source, root, 0, first)
              expect(summary).toThrow(/not borrowed/)
              yield* collected.borrow(context.capture, context.source, root, limits, function* () {
                expect(summary()?.nodes).toBeGreaterThan(0)
                expect(() =>
                  collected.descriptionAbsence(second, context.source, root, 0, first),
                ).toThrow(/mismatch/)
                const otherSource = new PackedSource(context.source.identity, context.source.text)
                expect(() =>
                  collected.descriptionAbsence(context.capture, otherSource, root, 0, first),
                ).toThrow(/mismatch/)
                expect(() =>
                  collected.descriptionAbsence(context.capture, context.source, ['root'], 0, first),
                ).toThrow(/mismatch/)
                expect(() =>
                  collected.descriptionAbsence(context.capture, context.source, root, NaN, first),
                ).toThrow(/index mismatch/)
                expect(
                  collected.descriptionAbsence(context.capture, context.source, root, 0, last),
                ).toBeUndefined()
                expect(
                  collected.descriptionAbsence(context.capture, context.source, root, 0),
                ).toBeUndefined()
                expect(() =>
                  finishPackedSteps(
                    context.capture.work(
                      collected.borrow(
                        context.capture,
                        context.source,
                        root,
                        limits,
                        function* () {},
                      ),
                    ),
                  ),
                ).toThrow(/already borrowed/)
                yield
                expect(summary()?.nodes).toBeGreaterThan(0)
              })
              expect(summary).toThrow(/not borrowed/)
            },
          ),
        ),
      )
      expect(() => escaped?.descriptionAbsence(context.capture, context.source, root, 2)).toThrow(
        /closed/,
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['commonmark', 'manuslip'] as const)(
    'preserves complete %s output with nested and duplicate definitions',
    (syntax) => {
      const context = opened(fixture(text, syntax))
      const before = context.owner.stats
      const walk = vi.mocked(definitions.packedProjectionDefinitions)
      walk.mockClear()
      try {
        finishPackedSteps(validate(context))
        expect(walk).not.toHaveBeenCalled()
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )

  it.each(['words', 'footnote-schema', 'html'] as const)(
    'rejects a late %s corruption after context selection',
    (change) => {
      const data = fixture()
      if (change === 'words') data.value.document.counts.words++
      else if (change === 'html')
        data.value.projection.html = data.value.projection.html.replace('Last', 'Fake')
      else {
        const footnote = data.value.document.root.children.find(
          (node) => node.type === 'footnoteDefinition',
        )
        if (footnote?.type !== 'footnoteDefinition') throw new Error('Missing footnote')
        const paragraph = footnote.children[0]
        if (paragraph?.type !== 'paragraph' || !paragraph.children[0])
          throw new Error('Missing note text')
        ;(paragraph.children[0] as { type: string }).type = 'paragraph'
      }
      const context = opened(data),
        before = context.owner.stats
      try {
        expect(() => finishPackedSteps(validate(context))).toThrow()
        expect(context.owner.stats).toEqual(before)
      } finally {
        context.owner.dispose()
      }
    },
  )

  it('discards an oversized optional context and completes the original full validation', () => {
    const context = opened(fixture(`Call[^a].\n\n[^a]: ${'word '.repeat(40000)}`))
    const before = context.owner.stats
    const walk = vi.mocked(definitions.packedProjectionDefinitions)
    walk.mockClear()
    try {
      finishPackedSteps(validate(context))
      expect(walk).toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })

  it.each(['cancel', 'capture', 'dispose'] as const)(
    'releases a partially copied definition after %s',
    (action) => {
      const context = opened(fixture(`Call[^a].\n\n[^a]: ${'word '.repeat(2000)}`))
      const before = context.owner.stats
      const key = vi.spyOn(PackedReadScope.prototype, 'recordKey')
      const work = validate(context)
      try {
        let advances = 0
        while (!key.mock.calls.length) {
          expect(work.next().done).toBe(false)
          if (++advances > 100000) throw new Error('Definition was not selected')
        }
        if (action === 'cancel') {
          work.return()
          expect(context.owner.stats).toEqual(before)
          finishPackedSteps(validate(context))
        } else if (action === 'capture') context.capture.release()
        else context.owner.dispose()
        expect(context.owner.stats.readerStagingBytes).toBe(0)
      } finally {
        work.return()
        key.mockRestore()
        context.owner.dispose()
        expect(context.owner.stats.retainedBytes).toBe(0)
      }
    },
  )
})
