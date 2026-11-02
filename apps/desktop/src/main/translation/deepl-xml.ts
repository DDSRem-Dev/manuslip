import {
  parseTranslationPayload,
  type TranslationPayload,
  translationLimits,
  validateTranslation,
} from '@manuslip/translate'
import { TranslationFailure } from './errors'

const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const validScalar = (value: number): boolean =>
  value <= 0x10ffff &&
  (value >= 32 || [9, 10, 13].includes(value)) &&
  !(value >= 0xd800 && value <= 0xdfff) &&
  value !== 0xfffe &&
  value !== 0xffff
function validXmlText(text: string): boolean {
  for (const character of text) if (!validScalar(character.codePointAt(0) ?? 0)) return false
  return true
}
/** Synthetic tags contain only canonical token IDs, never source bindings or source HTML. */
export function encodeDeepL(payload: TranslationPayload): string {
  parseTranslationPayload(payload)
  if (!validXmlText(payload.text)) throw new TranslationFailure('translation-invalid')
  const tokens = new Map(payload.tokens.map((token) => [token.id, token]))
  return `<r>${escapeXml(payload.text).replace(/⟪(M\d+)⟫/g, (_, id: string) => {
    const token = tokens.get(id)
    if (!token) throw new TranslationFailure('translation-invalid')
    return token.type === 'open'
      ? `<m id="${id}">`
      : token.type === 'close'
        ? '</m>'
        : `<x id="${id}"/>`
  })}</r>`
}
function decode(text: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d{1,7};|#x[a-f0-9]{1,6};)/i.test(text))
    throw new TranslationFailure('translation-response')
  return text.replace(/&([^;]+);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (entity in named) return named[entity] ?? ''
    const value = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number(entity.slice(1))
    if (!Number.isInteger(value) || !validScalar(value))
      throw new TranslationFailure('translation-response')
    return String.fromCodePoint(value)
  })
}
/** Deliberately tiny XML grammar: no DTD/entities, namespaces, arbitrary markup or DOM parsing. */
export function decodeDeepL(payload: TranslationPayload, xml: unknown): string {
  if (
    typeof xml !== 'string' ||
    Buffer.byteLength(xml) > translationLimits.output + 16 * 1024 ||
    !xml.startsWith('<r>') ||
    !xml.endsWith('</r>') ||
    xml.includes(']]>') ||
    !validXmlText(xml)
  )
    throw new TranslationFailure('translation-response')
  const tokens = new Map(payload.tokens.map((token) => [token.id, token]))
  const closes = new Map(
    payload.tokens.filter((token) => token.type === 'close').map((token) => [token.pair, token.id]),
  )
  const stack: string[] = []
  const seen = new Set<string>()
  const parts: string[] = []
  let offset = 3
  const body = xml.slice(0, -4)
  while (offset < body.length) {
    const at = body.indexOf('<', offset)
    if (at < 0) {
      parts.push(decode(body.slice(offset)))
      break
    }
    parts.push(decode(body.slice(offset, at)))
    const match = /^(?:<(m|x)\s+id=(?:"(M\d+)"|'(M\d+)')\s*(\/?>)|<\/m\s*>)/.exec(body.slice(at))
    if (!match) throw new TranslationFailure('translation-response')
    const id = match[2] ?? match[3]
    let consumed = match[0].length
    if (id) {
      const token = tokens.get(id)
      if (
        !token ||
        seen.has(id) ||
        token.type !== (match[1] === 'm' ? 'open' : 'atom') ||
        (match[1] === 'm' && match[4] !== '>')
      )
        throw new TranslationFailure('translation-response')
      seen.add(id)
      if (match[1] === 'm') stack.push(id)
      else if (match[4] === '>') {
        const close = /^<\/x\s*>/.exec(body.slice(at + consumed))
        if (!close) throw new TranslationFailure('translation-response')
        consumed += close[0].length
      }
      parts.push(`⟪${id}⟫`)
    } else {
      const id = closes.get(stack.pop() ?? '')
      if (!id) throw new TranslationFailure('translation-response')
      parts.push(`⟪${id}⟫`)
    }
    offset = at + consumed
  }
  if (stack.length) throw new TranslationFailure('translation-response')
  try {
    return validateTranslation(payload, parts.join(''))
  } catch {
    throw new TranslationFailure('translation-response')
  }
}
