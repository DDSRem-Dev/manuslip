import type { Nodes, Root } from 'mdast'
import { expect, it } from 'vitest'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { extractTranslation } from '../../../translate/src/extract'
import { projectTranslation } from '../../../translate/src/projection-translation'
import { reconstructTranslation } from '../../../translate/src/reconstruct'
import type { RenderOptions } from '../../src/index'
import type { ProjectionDefinition } from '../../src/projection-sequence'
import { readingBlocks, renderReading } from '../../src/reading'
import { ReadingSequence } from '../../src/reading-sequence'

const MiB = 1024 * 1024
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes 世界',
  footnoteBackLabel: 'Back 返回',
}
const limits = { retained: 32 * MiB, staging: 8 * MiB }
const normalize = (value: unknown) =>
  JSON.stringify(value).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'UUID')

function context(root: Root): ProjectionDefinition[] {
  const result: ProjectionDefinition[] = []
  function visit(node: Nodes): void {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') result.push(node)
    else if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(root)
  return result
}

function check(
  source: string,
  syntax: 'commonmark' | 'manuslip',
  render = options,
  specialIds = false,
) {
  const root = parseMarkdown(source, syntax).root
  const unchanged = JSON.stringify(root)
  const plan = extractTranslation(root, source)
  const values = new Map(
    plan.units.map((unit, index) => [
      unit.occurrenceId,
      index % 4 === 1
        ? undefined
        : index % 4 === 2
          ? '⟪broken⟫'
          : unit.payload
            ? `Changed ${unit.payload.text}`
            : undefined,
    ]),
  )
  const rebuilt = reconstructTranslation(plan, values)
  const projected = projectTranslation(plan, (unit) => values.get(unit.occurrenceId), limits)
  if (!projected) throw new Error('Unexpected aliased input')
  const reading = {
    blocks: readingBlocks(root, source),
    units: plan.units,
    translated: new Set(
      plan.units
        .filter((_, index) => rebuilt.statuses[index]?.status === 'translated')
        .map((unit) => `${unit.from}:${unit.to}`),
    ),
    sourceLanguage: 'auto',
    targetLanguage: 'ar',
    labels: { original: '原文', translation: 'Translation ترجمة' },
  }
  if (specialIds)
    for (const [index, block] of reading.blocks.entries())
      block.id = `anchor ${index} &"'\u0000\u0060<>世界😀`
  for (const layout of ['replace', 'side-by-side', 'interlinear'] as const) {
    for (const indexAboveBytes of [undefined, 0, 8 * MiB]) {
      const settings = { ...reading, layout, indexAboveBytes }
      const expected = renderReading(root, rebuilt.root, render, settings)
      let maximum = 0
      const sequence = new ReadingSequence(
        context(root),
        render,
        { ...settings, children: projected.children },
        (bytes) => {
          if (bytes > limits.retained) throw new Error('Output reservation exceeded')
          maximum = Math.max(maximum, bytes)
        },
      )
      try {
        for (const node of root.children) sequence.append(node)
        expect(normalize(sequence.finish())).toBe(normalize(expected))
        expect(maximum).toBeGreaterThanOrEqual(4096)
        expect(() => sequence.finish()).toThrow('closed')
        expect(() => sequence.append({ type: 'paragraph', children: [] })).toThrow('closed')
      } finally {
        sequence.close()
      }
    }
  }
  expect(JSON.stringify(root)).toBe(unchanged)
}

it('preserves native attribute escaping when replacement fragments use unusual anchors', () => {
  check('# Heading\n\nFirst **paragraph**.\n\nSecond paragraph.\n', 'manuslip', options, true)
})

it.each(['commonmark', 'manuslip'] as const)(
  'matches independent whole-root reconstruction for every CommonMark case in %s',
  (syntax) => {
    for (const example of examples) check(example.markdown, syntax)
  },
  30000,
)

const fixtures = [
  '',
  '\ufeff# Heading\r\n\r\nUnicode 界😀 and **bold**.\r\n',
  '> [r]: /nested\n>\n> [reference][r]\n\n[r]: /later\n\n[link][r]\n',
  'First[^a] again[^a].\n\nOther[^b].\n\n[^a]: Note **bold** [^c].\n\n[^b]: $x$ [^a].\n\n[^c]: ![image][r].\n\n[r]: private.png\n',
  '[^unused]: <div>\n    PRIVATE\n    </div>\n\nProse.\n',
  '| Head | Ref |\n| :-- | --: |\n| $x$ | [link][r] |\n\n- [x] task\n- second\n\n- loose\n\n  paragraph\n\n[r]: /private "SECRET"\n',
  'Hello `PRIVATE_A` and [label](/private-a).\n\nHello `PRIVATE_B` and [label](/private-b).\n\n~~~mermaid\ngraph TD; A-->B\n~~~\n\n$$\nx^2\n$$\n',
  '<div>\n\nProse <i title="SECRET">hidden **body**</i>.\n\n</div>\n\n<script>alert(1)</script>\n',
  '[^a]: first note\n\n[^a]: second note\n\nOne[^a].\n\nTwo[^a].\n',
]
it.each([false, true])(
  'preserves extensions, raw fragments and footnote state with rawHtml=%s',
  (rawHtml) => {
    for (const source of fixtures) check(source, 'manuslip', { ...options, rawHtml })
  },
)

it('shares complete repeated bilingual rows and preserves each occurrence anchor', () => {
  check('Repeated **paragraph**.\n\n'.repeat(1000), 'manuslip')
}, 30000)

it('closes on output rejection and rejects reuse of partial footnote/slot state', () => {
  const root = parseMarkdown('Text $x$[^n].\n\n[^n]: A note.\n').root
  const error = new Error('Output rejected')
  let reject = false
  const sequence = new ReadingSequence(
    context(root),
    options,
    {
      layout: 'side-by-side',
      blocks: readingBlocks(root, ''),
      units: [],
      translated: new Set(),
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      labels: { original: 'Original', translation: 'Translation' },
    },
    () => {
      if (reject) throw error
    },
  )
  reject = true
  const first = root.children[0]
  if (!first) throw new Error('Missing fixture paragraph')
  expect(() => sequence.append(first)).toThrow(error)
  expect(() => sequence.finish()).toThrow('closed')
  sequence.close()
})
