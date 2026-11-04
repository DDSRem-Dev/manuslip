import { parseMarkdown } from '@manuslip/core'
import type { TranslationSettings } from '@manuslip/translate'
import { expect, it, vi } from 'vitest'
import { ReadingProcessor } from '../../../../../src/renderer/src/translation/engine'
import { decodeReadingValue } from '../../../../../src/renderer/src/translation/prepared-wire'

const settings: TranslationSettings = {
  provider: {
    adapter: 'ollama',
    version: '1',
    baseUrl: 'http://localhost:11434/api/chat',
    model: 'fake',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
const options = { rawHtml: true, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
it('publishes definition terms through the real reading wire and keeps legacy diagrams and occurrence bindings local', async () => {
  const source =
    'Term :smile:\n: Hello **world** and `private-one`.\n\nTerm :heart:\n: Hello **world** and `private-two`.\n\n```seq\nA->B: PRIVATE DIAGRAM\n```\n\n```flow\na=>start: 开始\nb=>end: 完成\na->b\n```\n'
  const root = parseMarkdown(source).root,
    original = JSON.stringify(root),
    engine = new ReadingProcessor(),
    responses: unknown[] = []
  try {
    await engine.respond({ kind: 'prepare', root, source, settings }, 1, (response) =>
      responses.push(structuredClone(response.value)),
    )
    const prepared = decodeReadingValue(responses[0])
    if (prepared.kind !== 'prepared') throw new Error('Not prepared')
    expect(prepared.units.map((unit) => unit.kind)).toEqual([
      'defListTerm',
      'paragraph',
      'defListTerm',
      'paragraph',
    ])
    expect(JSON.stringify(responses[0])).not.toMatch(/private-one|private-two|PRIVATE DIAGRAM|😄|❤️/)
    const outputs = new Map(
      prepared.units
        .filter((unit) => unit.key && unit.payload)
        .map((unit) => [
          unit.key as string,
          (unit.payload?.text ?? '')
            .replaceAll('Term', '术语')
            .replaceAll('Hello', '你好')
            .replaceAll('world', '世界'),
        ]),
    )
    await engine.respond(
      { kind: 'render', options, outputs: [...outputs].map(([key, output]) => ({ key, output })) },
      2,
      (response) => responses.push(structuredClone(response.value)),
    )
    const rendered = decodeReadingValue(responses[1])
    if (rendered.kind !== 'rendered') throw new Error('Not rendered')
    expect(rendered.projection.html).toMatch(/<dt\b[^>]*>术语/)
    expect(rendered.projection.html).toContain('<strong>世界</strong>')
    expect(rendered.projection.html).toContain('<code>private-one</code>')
    expect(rendered.projection.html).toContain('<code>private-two</code>')
    expect(rendered.projection.html).toContain('😄')
    expect(rendered.projection.html).toContain('❤️')
    expect(
      rendered.projection.slots.map((slot) => ({ syntax: slot.syntax, source: slot.source })),
    ).toEqual([
      { syntax: 'sequence', source: 'A->B: PRIVATE DIAGRAM' },
      { syntax: 'flowchart', source: 'a=>start: 开始\nb=>end: 完成\na->b' },
    ])
    expect(JSON.stringify(root)).toBe(original)
  } finally {
    engine.clear()
  }
})
it('uses an immutable whole-root capture with unpredictable heavy-slot names, including raw HTML spoof attempts', async () => {
  const source =
    'Hello $x^2$.\n\n<div data-export-slot="slot-0">Original HTML</div>\n\n[link][ref]\n\n[ref]: https://private.invalid/'
  const root = parseMarkdown(source).root
  const original = JSON.stringify(root)
  const engine = new ReadingProcessor()
  const prepared = await engine.execute({ kind: 'prepare', root, source, settings })
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  const unit = prepared.units[0]
  if (!unit?.key || !unit.payload) throw new Error('No unit')
  const result = await engine.execute({
    kind: 'render',
    outputs: [{ key: unit.key, output: unit.payload.text.replace('Hello', '你好') }],
    options,
  })
  if (result.kind !== 'rendered') throw new Error('Not rendered')
  expect(result.projection.html).toContain('你好')
  expect(result.projection.html).toContain('Original HTML')
  expect(result.projection.html).toContain('href="https://private.invalid/"')
  expect(result.projection.slots[0]?.id).toMatch(/^translated-[a-f0-9-]{36}-0$/)
  expect(result.projection.slots[0]?.source).toBe('x^2')
  expect(JSON.stringify(root)).toBe(original)
  await expect(
    engine.execute({ kind: 'render', outputs: [{ key: unit.key, output: 'Broken' }], options }),
  ).rejects.toThrow()
  await expect(
    engine.execute({ kind: 'render', outputs: [{ key: 'unknown', output: 'Text' }], options }),
  ).rejects.toThrow('translation-view-worker')
  engine.clear()
  await expect(engine.execute({ kind: 'render', outputs: [], options })).rejects.toThrow(
    'translation-view-worker',
  )
})
it('renders successive reading copies without native root or protected-binding cloning', async () => {
  const source =
    'Hello **world** with `PRIVATE` and [link](https://private.invalid/).\n\nKeep this.'
  const root = parseMarkdown(source).root,
    original = JSON.stringify(root),
    engine = new ReadingProcessor()
  const prepared = await engine.execute({ kind: 'prepare', root, source, settings })
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  const unit = prepared.units[0]
  if (!unit?.payload || !unit.key) throw new Error('Missing prose')
  const clone = vi.spyOn(globalThis, 'structuredClone')
  try {
    const first = await engine.execute({
      kind: 'render',
      options,
      outputs: [{ key: unit.key, output: unit.payload.text.replace('Hello', '你好') }],
    })
    const second = await engine.execute({
      kind: 'render',
      options,
      outputs: [{ key: unit.key, output: unit.payload.text.replace('Hello', 'Later') }],
    })
    if (first.kind !== 'rendered' || second.kind !== 'rendered') throw new Error('Not rendered')
    expect(first.projection.html).toContain('你好')
    expect(second.projection.html).toContain('Later')
    expect(second.projection.html).toContain('https://private.invalid/')
    expect(JSON.stringify(root)).toBe(original)
    expect(clone).not.toHaveBeenCalled()
  } finally {
    clone.mockRestore()
    engine.clear()
  }
})
it('rejects complete projection overflow and can retry using the same untouched semantic plan', async () => {
  const source = Array.from({ length: 24 }, (_, i) => `Hello paragraph ${i}.`).join('\n\n')
  const root = parseMarkdown(source).root,
    original = JSON.stringify(root),
    engine = new ReadingProcessor()
  const prepared = await engine.execute({ kind: 'prepare', root, source, settings })
  if (prepared.kind !== 'prepared') throw new Error('Not prepared')
  const large = '&'.repeat(240 * 1024)
  const values = prepared.units.map((unit, index) => ({
    key: unit.key ?? '',
    output: `${large}${index}`,
  }))
  await expect(engine.execute({ kind: 'render', options, outputs: values })).rejects.toThrow(
    'translation-view-limit',
  )
  expect(JSON.stringify(root)).toBe(original)
  const retry = await engine.execute({
    kind: 'render',
    options,
    outputs: values.map((unit) => ({ ...unit, output: 'Recovered.' })),
  })
  if (retry.kind !== 'rendered') throw new Error('Not rendered')
  expect(retry.projection.html.match(/Recovered\./g)).toHaveLength(24)
  expect(JSON.stringify(root)).toBe(original)
  engine.clear()
})
