import { parseMarkdown, type Root, utf8Bytes } from '@manuslip/core'
import { renderMarkdown } from '@manuslip/renderer'
import { describe, expect, it } from 'vitest'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import {
  extractTranslation,
  parseTranslationPayload,
  prepareTranslation,
  reconstructTranslation,
  translationLimits,
  validateTranslation,
} from '../../src/index'
import { fixtureCapabilities, fixtureSettings, fixtureTranslate } from '../fixtures/provider'

const options = { rawHtml: false, footnotesLabel: 'Footnotes', footnoteBackLabel: 'Back' }
const plan = (source: string) => extractTranslation(parseMarkdown(source).root, source)

it('translates whole prose units while withholding code, math, URLs, frontmatter, HTML and diagram values', async () => {
  const source =
    '---\ntitle: SECRET_FRONTMATTER\n---\n\n# Hello **world**\n\n- [x] Hello `SECRET_CODE` and $SECRET_MATH$ at [world](https://secret.example/path "SECRET_TITLE").\n  - ~~Hello~~ ![SECRET_ALT](secret.png) and <i>world</i>.\n\n> Hello [world][private-ref] and note[^private-note].\n\n| Hello | world |\n| - | - |\n| Hello | **world** |\n\n```mermaid\nflowchart LR\nSECRET_DIAGRAM-->Secret\n```\n\n$$\nSECRET_DISPLAY_MATH\n$$\n\n[private-ref]: https://private.example "SECRET_REFERENCE_TITLE"\n\n[^private-note]: Hello world\n'
  const extracted = plan(source)
  const before = structuredClone(extracted.root)
  expect(extracted.units.map((unit) => unit.kind)).toEqual([
    'heading',
    'paragraph',
    'paragraph',
    'paragraph',
    'tableCell',
    'tableCell',
    'tableCell',
    'tableCell',
    'paragraph',
  ])
  const prepared = await prepareTranslation(extracted, fixtureSettings(), fixtureCapabilities)
  const providerJson = JSON.stringify(prepared.jobs)
  for (const hidden of [
    'SECRET_',
    'https://',
    'secret.png',
    'private-ref',
    'private-note',
    'flowchart',
    'title:',
  ])
    expect(providerJson).not.toContain(hidden)
  expect(providerJson).toContain('Hello')
  const results = fixtureTranslate(prepared.jobs, [
    ['Hello', '你好'],
    ['world', '世界'],
  ])
  const outputs = new Map([...prepared.occurrences].map(([id, key]) => [id, results.get(key)]))
  const result = reconstructTranslation(extracted, outputs)
  expect(result.statuses.every((unit) => unit.status === 'translated')).toBe(true)
  const html = renderMarkdown(result.root, options).html
  expect(html).toContain('<h1>你好 <strong>世界</strong></h1>')
  expect(html).toContain('https://secret.example/path')
  expect(html).toContain('SECRET_CODE')
  expect(html).toContain('SECRET_MATH')
  expect(html).toContain('SECRET_DIAGRAM')
  expect(html).toContain('<del>你好</del>')
  expect(html).toContain('SECRET_ALT')
  expect(html).toContain('SECRET_REFERENCE_TITLE')
  expect(result.root.children.find((node) => node.type === 'list')).toMatchObject({
    children: [{ checked: true }],
  })
  expect(extracted.root).toEqual(before)
  expect(source).toContain('# Hello **world**')
})

it('deduplicates canonical jobs but restores each occurrence’s own protected inline values', async () => {
  const source =
    'Use `alpha()` and $x^2$ at [docs](https://first.example).\n\nUse `beta()` and $y^3$ at [docs](https://second.example).'
  const extracted = plan(source)
  expect(extracted.units).toHaveLength(2)
  expect(extracted.units[0]?.occurrenceId).not.toBe(extracted.units[1]?.occurrenceId)
  const prepared = await prepareTranslation(extracted, fixtureSettings(), fixtureCapabilities)
  expect(prepared.jobs).toHaveLength(1)
  const result = fixtureTranslate(prepared.jobs, [
    ['Use', '使用'],
    ['and', '和'],
    ['at', '参见'],
    ['docs', '文档'],
  ])
  const translated = reconstructTranslation(
    extracted,
    new Map([...prepared.occurrences].map(([id, key]) => [id, result.get(key)])),
  )
  const html = renderMarkdown(translated.root, options).html
  expect(html).toContain('使用 <code>alpha()</code> 和')
  expect(html).toContain('使用 <code>beta()</code> 和')
  expect(html).toContain('href="https://first.example/"')
  expect(html).toContain('href="https://second.example/"')
  expect(html).toContain('x^2')
  expect(html).toContain('y^3')
})

it('translates definition terms and description paragraphs with each occurrence’s private values', async () => {
  const source =
    'Hello :smile:\n: Hello *world* `PRIVATE_ONE`.\n\nHello :heart:\n: Hello *world* `PRIVATE_TWO`.\n'
  const extracted = plan(source),
    unchanged = structuredClone(extracted.root)
  expect(extracted.units.map((unit) => unit.kind)).toEqual([
    'defListTerm',
    'paragraph',
    'defListTerm',
    'paragraph',
  ])
  const prepared = await prepareTranslation(extracted, fixtureSettings(), fixtureCapabilities)
  expect(prepared.jobs).toHaveLength(2)
  for (const secret of ['PRIVATE_', ':smile:', ':heart:', '😄', '❤️'])
    expect(JSON.stringify(prepared.jobs)).not.toContain(secret)
  const results = fixtureTranslate(prepared.jobs, [
    ['Hello', '你好'],
    ['world', '世界'],
  ])
  const translated = reconstructTranslation(
    extracted,
    new Map([...prepared.occurrences].map(([id, key]) => [id, results.get(key)])),
  )
  expect(translated.statuses.every((unit) => unit.status === 'translated')).toBe(true)
  const html = renderMarkdown(translated.root, options).html
  expect(html).toContain('<dl>')
  expect(html).toContain('<dt>你好 ')
  expect(html).toContain('title=":smile:">😄</span>')
  expect(html).toContain('title=":heart:">❤️</span>')
  expect(html).toContain('你好 <em>世界</em> <code>PRIVATE_ONE</code>')
  expect(html).toContain('你好 <em>世界</em> <code>PRIVATE_TWO</code>')
  expect(extracted.root).toEqual(unchanged)
})

it('translates script prose and deduplicates emoji jobs while restoring each private occurrence', async () => {
  const source = 'Hello ~world~ ^**world**^ :smile:.\n\nHello ~world~ ^**world**^ :heart:.'
  const extracted = plan(source)
  const unchanged = structuredClone(extracted.root)
  expect(extracted.units).toHaveLength(2)
  const prepared = await prepareTranslation(extracted, fixtureSettings(), fixtureCapabilities)
  expect(prepared.jobs).toHaveLength(1)
  const providerJson = JSON.stringify(prepared.jobs)
  for (const secret of [':smile:', ':heart:', '😄', '❤️']) expect(providerJson).not.toContain(secret)
  expect(providerJson).toContain('subscript')
  expect(providerJson).toContain('superscript')
  expect(providerJson).toContain('emoji')
  const results = fixtureTranslate(prepared.jobs, [
    ['Hello', '你好'],
    ['world', '世界'],
  ])
  const translated = reconstructTranslation(
    extracted,
    new Map([...prepared.occurrences].map(([id, key]) => [id, results.get(key)])),
  )
  expect(translated.statuses.every((unit) => unit.status === 'translated')).toBe(true)
  const html = renderMarkdown(translated.root, options).html
  expect(html).toContain('你好 <sub>世界</sub> <sup><strong>世界</strong></sup>')
  expect(html).toContain('title=":smile:">😄</span>')
  expect(html).toContain('title=":heart:">❤️</span>')
  expect(extracted.root).toEqual(unchanged)
})

it('treats provider markup as literal text and preserves partial failures as source', () => {
  const extracted = plan('First paragraph.\n\nSecond **paragraph**.\n\nThird paragraph.')
  const first = extracted.units[0]
  const second = extracted.units[1]
  if (!first || !second) throw new Error('Missing units')
  const malicious = '<script>window.bad=true</script> **new markdown** [link](file:///secret)'
  const result = reconstructTranslation(
    extracted,
    new Map([
      [first.occurrenceId, malicious],
      [second.occurrenceId, 'Missing all tokens'],
    ]),
  )
  expect(result.statuses.map((unit) => unit.status)).toEqual(['translated', 'invalid', 'missing'])
  const html = renderMarkdown(result.root, { ...options, rawHtml: true }).html
  expect(html).toContain('&#x3C;script>window.bad=true&#x3C;/script>')
  expect(html).not.toContain('<script>')
  expect(html).toContain('**new markdown**')
  expect(html).toContain('<p>Second <strong>paragraph</strong>.</p>')
  expect(html).toContain('<p>Third paragraph.</p>')
})

it('preserves automatic links, URI-looking literal text, references and literal token delimiters locally', async () => {
  const extracted = plan(
    'Read https://secret.example www.secret.example ftp://private/path and <person@private.example>. Keep ⟪M99⟫ and ⟪ unmatched.\n\nRead [label][secret-ref].\n\n[secret-ref]: https://hidden.example',
  )
  const prepared = await prepareTranslation(extracted, fixtureSettings(), fixtureCapabilities)
  const payload = JSON.stringify(prepared.jobs)
  expect(payload).not.toMatch(
    /secret\.example|private\.example|ftp:|private\/path|secret-ref|hidden\.example|M99/,
  )
  const result = reconstructTranslation(
    extracted,
    new Map(
      extracted.units.map((unit) => [
        unit.occurrenceId,
        unit.payload?.text.replaceAll('Read', '阅读').replaceAll('Keep', '保留'),
      ]),
    ),
  )
  const html = renderMarkdown(result.root, options).html
  expect(html).toContain('https://secret.example/')
  expect(html).toContain('⟪M99⟫')
  expect(html).toContain('person@private.example')
  expect(html).toContain('https://hidden.example/')
})

it('keeps inline HTML bodies, nested tags and unclosed fragments out of provider payloads', async () => {
  const extracted = plan(
    'Read <span title="SECRET_TITLE">SECRET_BODY <b>SECRET_NESTED</b></span> then continue.\n\nRead <custom>SECRET_UNCLOSED end.',
  )
  const prepared = await prepareTranslation(extracted, fixtureSettings(), fixtureCapabilities)
  expect(JSON.stringify(prepared.jobs)).not.toContain('SECRET_')
  const output = reconstructTranslation(
    extracted,
    new Map(
      extracted.units.map((unit) => [
        unit.occurrenceId,
        unit.payload?.text.replace('Read', '阅读'),
      ]),
    ),
  )
  const html = renderMarkdown(output.root, { ...options, rawHtml: true }).html
  expect(html).toContain('<span title="SECRET_TITLE">SECRET_BODY <b>SECRET_NESTED</b></span>')
  expect(html).toContain('<custom>SECRET_UNCLOSED end.')
})

it('rejects missing, duplicate, unknown, unbalanced and reparented placeholders while allowing sibling reordering', () => {
  const extracted = plan('Read **bold `code`** and [link](https://example.com).')
  const payload = extracted.units[0]?.payload
  if (!payload) throw new Error('Missing payload')
  expect(payload.text).toBe('Read ⟪M0⟫bold ⟪M1⟫⟪M2⟫ and ⟪M3⟫link⟪M4⟫.')
  for (const output of [
    payload.text.replace('⟪M1⟫', ''),
    `${payload.text}⟪M1⟫`,
    `${payload.text}⟪M99⟫`,
    payload.text.replace('⟪M2⟫', ''),
    payload.text.replace('⟪M1⟫', '').replace('link', 'link⟪M1⟫'),
    payload.text.replace('⟪M0⟫', '⟪ M0 ⟫'),
    `${payload.text}⟪`,
    '',
    null,
    { text: payload.text },
    '⟪M0⟫⟪M1⟫⟪M2⟫⟪M3⟫⟪M4⟫',
  ])
    expect(() => validateTranslation(payload, output)).toThrow()
  expect(validateTranslation(payload, '⟪M3⟫链接⟪M4⟫，阅读 ⟪M0⟫加粗 ⟪M1⟫⟪M2⟫。')).toContain('链接')
})

it('keeps whitespace significant, emits UTF-16 ranges, and uses caller-owned occurrence identities', () => {
  const source = '😀 **Hello**\nworld\n\nHello  world'
  const ranges: { from: number; to: number }[] = []
  const extracted = extractTranslation(parseMarkdown(source).root, source, (range) => {
    ranges.push(range)
    return crypto.randomUUID()
  })
  expect(ranges.map(({ from, to }) => source.slice(from, to))).toEqual([
    '😀 **Hello**\nworld',
    'Hello  world',
  ])
  expect(extracted.units[0]?.payload?.text).toContain('\nworld')
  expect(extracted.units[1]?.payload?.text).toBe('Hello  world')
  expect(() => extractTranslation(parseMarkdown(source).root, source, () => 'duplicate')).toThrow(
    'translation-invalid',
  )
})

it('retains individually oversized prose/token units and rejects a whole-plan overflow without truncation', () => {
  const large = plan('界'.repeat(Math.ceil(translationLimits.payload / 3)))
  expect(large.units[0]).toMatchObject({ payload: null, error: 'translation-unit-large' })
  expect(reconstructTranslation(large, new Map()).statuses[0]?.status).toBe('limit')
  const tokens = plan(
    `Intro ${Array.from({ length: translationLimits.tokens + 1 }, (_, i) => `\`${i}\``).join(' ')}`,
  )
  expect(tokens.units[0]?.error).toBe('translation-unit-large')
  const many = 'Text\n\n'.repeat(translationLimits.units + 1)
  expect(() => plan(many)).toThrow('translation-limit')
  const small = plan('Small paragraph')
  const id = small.units[0]?.occurrenceId || ''
  expect(
    reconstructTranslation(small, new Map([[id, 'x'.repeat(translationLimits.output + 1)]]))
      .statuses[0]?.status,
  ).toBe('limit')
  expect(utf8Bytes(JSON.stringify(small.units[0]?.payload))).toBeLessThan(translationLimits.payload)
})

it('bounds aggregate reconstructed output and extraction depth without dropping source', () => {
  const output = '界'.repeat(Math.floor(translationLimits.output / 3))
  const count = Math.floor(translationLimits.reconstructed / utf8Bytes(output)) + 2
  const extracted = plan(Array.from({ length: count }, (_, i) => `Paragraph ${i}.`).join('\n\n'))
  const result = reconstructTranslation(
    extracted,
    new Map(extracted.units.map((unit) => [unit.occurrenceId, output])),
  )
  expect(result.statuses.filter((unit) => unit.status === 'translated').length).toBe(
    Math.floor(translationLimits.reconstructed / utf8Bytes(output)),
  )
  expect(result.statuses.at(-1)?.status).toBe('limit')
  expect(renderMarkdown(result.root, options).html).toContain(`Paragraph ${count - 1}.`)
  expect(() => plan(`${'> '.repeat(translationLimits.depth + 1)}Deep`)).toThrow('translation-limit')
})

it('rejects aggregate canonical payload growth within the source byte cap', () => {
  const source = `Prose ${'`x` '.repeat(200)}\n\n`.repeat(1400)
  expect(utf8Bytes(source)).toBeLessThan(2 * 1024 * 1024)
  expect(() => plan(source)).toThrow('translation-limit')
})

it('strictly limits the payload boundary to canonical text/token data', () => {
  const payload = plan('Read **text** with `code`.').units[0]?.payload
  if (!payload) throw new Error('Missing payload')
  expect(parseTranslationPayload(payload)).toEqual(payload)
  for (const patch of [
    { bindings: [] },
    { source: 'private' },
    { schema: 'wrong' },
    { kind: new String('paragraph') },
    { tokens: [...payload.tokens, payload.tokens[0]] },
    { text: `${payload.text}⟪M900⟫` },
    {
      tokens: payload.tokens.map((token) =>
        token.type === 'close' ? { ...token, role: 'link' } : token,
      ),
    },
  ])
    expect(() => parseTranslationPayload({ ...payload, ...patch })).toThrow()
})

describe('identity reconstruction agrees with all CommonMark 0.31.2 examples', () => {
  it.each(examples)('$example: $section', (example) => {
    const document = parseMarkdown(example.markdown, 'commonmark')
    const extracted = extractTranslation(document.root, example.markdown)
    const result = reconstructTranslation(
      extracted,
      new Map(extracted.units.map((unit) => [unit.occurrenceId, unit.payload?.text])),
    )
    expect(result.statuses.every((unit) => unit.status === 'translated')).toBe(true)
    expect(renderMarkdown(result.root as Root, { ...options, rawHtml: true }).html).toBe(
      renderMarkdown(document.root, { ...options, rawHtml: true }).html,
    )
  })
})
