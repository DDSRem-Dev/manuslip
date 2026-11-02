import { parseMarkdown } from '@manuslip/core'
import { extractTranslation, reconstructTranslation } from '@manuslip/translate'
import { toHtml } from 'hast-util-to-html'
import { toHast } from 'mdast-util-to-hast'
import { describe, expect, it } from 'vitest'
import examples from '../../../../../../packages/core/test/fixtures/commonmark-0.31.2/spec.json'
import { decodeDeepL, encodeDeepL } from '../../../../src/main/translation/deepl-xml'
import { TranslationFailure } from '../../../../src/main/translation/errors'

const source =
  'Hello **strong *nested***, `PRIVATE_CODE`, $PRIVATE_MATH$, [label](https://private.invalid "PRIVATE_TITLE") and ![PRIVATE_ALT](private.png).'
const plan = extractTranslation(parseMarkdown(source).root, source)
const payload = plan.units[0]?.payload
if (!payload) throw new Error('No fixture')

describe('DeepL XML placeholder boundary', () => {
  it('restores translated prose into original protected nodes and escapes provider markup as text', () => {
    const xml = encodeDeepL(payload)
    expect(xml).not.toMatch(/PRIVATE_|private.invalid|private.png/)
    const output = decodeDeepL(
      payload,
      xml.replace('Hello', '你好 &lt;script&gt;alert(1)&lt;/script&gt;').replace('strong', '强调'),
    )
    const rebuilt = reconstructTranslation(
      plan,
      new Map([[plan.units[0]?.occurrenceId ?? '', output]]),
    )
    expect(rebuilt.statuses[0]?.status).toBe('translated')
    expect(JSON.stringify(rebuilt.root)).toContain('你好 <script>alert(1)</script>')
    expect(JSON.stringify(rebuilt.root)).toContain('PRIVATE_CODE')
    expect(JSON.stringify(rebuilt.root)).toContain('https://private.invalid')
    expect(JSON.stringify(rebuilt.root)).not.toContain('⟪M')
  })
  it('preserves the complete rendering of every eligible CommonMark payload', () => {
    let units = 0
    for (const example of examples) {
      const plan = extractTranslation(
        parseMarkdown(example.markdown, 'commonmark').root,
        example.markdown,
      )
      const outputs = new Map<string, string>()
      for (const unit of plan.units)
        if (unit.payload) {
          outputs.set(unit.occurrenceId, decodeDeepL(unit.payload, encodeDeepL(unit.payload)))
          units++
        }
      expect(
        toHtml(toHast(reconstructTranslation(plan, outputs).root, { allowDangerousHtml: true }), {
          allowDangerousHtml: true,
        }),
        `CommonMark ${example.example}`,
      ).toEqual(
        toHtml(toHast(plan.root, { allowDangerousHtml: true }), { allowDangerousHtml: true }),
      )
    }
    expect(units).toBeGreaterThan(500)
  })
  it('accepts equivalent XML serialization, empty atom tags, Unicode and predefined/numeric entities exactly once', () => {
    const xml = encodeDeepL(payload)
      .replaceAll('"', "'")
      .replace(/<x id='(M\d+)'\/>/g, "<x id='$1'></x>")
    expect(
      decodeDeepL(payload, xml.replace('Hello', '你好 &#x1F642; &#38; &amp;lt; &quot; &apos;')),
    ).toBe(payload.text.replace('Hello', '你好 🙂 & &lt; " \''))
  })
  it.each([
    '<!DOCTYPE r SYSTEM "file:///private"><r>Hello</r>',
    '<r>&external;</r>',
    '<r>&amp</r>',
    '<r>&#0;</r>',
    '<r>&#xD800;</r>',
    '<r>&#x110000;</r>',
    '<r><script>Hello</script></r>',
    '<r><![CDATA[Hello]]></r>',
    '<r>Hello]]></r>',
    '<r>Hello\u0000</r>',
    '<r>Hello\ud800</r>',
    '<r><x id="M999"/></r>',
    '<r><m id="M0" extra="private">Hello</m></r>',
  ])('rejects malformed or untrusted XML: %s', (xml) => {
    expect(() => decodeDeepL({ ...payload, text: 'Hello', tokens: [] }, xml)).toThrow(
      new TranslationFailure('translation-response'),
    )
  })
  it('rejects missing, duplicated, reparented and unclosed tokens', () => {
    const xml = encodeDeepL(payload)
    for (const changed of [
      xml.replace(/<x id="M\d+"\/>/, ''),
      xml.replace(/(<x id="M\d+"\/>)/, '$1$1'),
      xml.replace('</m>', ''),
      xml.replace(/(<m id="M\d+">)(<m id="M\d+">)/, '$2$1'),
    ]) {
      if (changed !== xml)
        expect(() => decodeDeepL(payload, changed)).toThrow(
          new TranslationFailure('translation-response'),
        )
    }
  })
  it('rejects oversized output and invalid XML source before transport', () => {
    expect(() => decodeDeepL(payload, `<r>${'a'.repeat(300000)}</r>`)).toThrow(
      new TranslationFailure('translation-response'),
    )
    expect(() => encodeDeepL({ ...payload, text: 'invalid\u0001', tokens: [] })).toThrow(
      new TranslationFailure('translation-invalid'),
    )
    const plain = { ...payload, text: 'literal ]]> & < >', tokens: [] }
    expect(decodeDeepL(plain, encodeDeepL(plain))).toBe(plain.text)
  })
})
