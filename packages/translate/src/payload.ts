import { utf8Bytes } from '@manuslip/core/text'
import {
  extractionVersion,
  TranslationError,
  type TranslationPayload,
  type TranslationToken,
  translationLimits,
} from './contracts'
import { validateTranslation } from './reconstruct'

const roles = new Set([
  'code',
  'math',
  'image',
  'html',
  'reference',
  'break',
  'literal',
  'protected',
  'emphasis',
  'strong',
  'delete',
  'link',
  'subscript',
  'superscript',
  'emoji',
])
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TranslationError('translation-invalid')
  return value as Record<string, unknown>
}
/** Strict provider/cache boundary: no AST, protected values, or caller-added metadata. */
export function parseTranslationPayload(input: unknown): TranslationPayload {
  const value = record(input, ['schema', 'kind', 'text', 'tokens'])
  if (
    value.schema !== extractionVersion ||
    typeof value.kind !== 'string' ||
    !['paragraph', 'heading', 'tableCell', 'defListTerm'].includes(value.kind) ||
    typeof value.text !== 'string' ||
    !Array.isArray(value.tokens) ||
    value.tokens.length > translationLimits.tokens
  )
    throw new TranslationError('translation-invalid')
  if (value.text.length > translationLimits.payload) throw new TranslationError('translation-limit')
  const tokens = value.tokens.map((input, index): TranslationToken => {
    const token = record(input, ['id', 'type', 'role', 'parent', 'pair'])
    if (
      token.id !== `M${index}` ||
      typeof token.type !== 'string' ||
      !['atom', 'open', 'close'].includes(token.type) ||
      typeof token.role !== 'string' ||
      !roles.has(token.role) ||
      !(
        token.parent === null ||
        (typeof token.parent === 'string' && /^M\d+$/.test(token.parent))
      ) ||
      !(token.pair === null || (typeof token.pair === 'string' && /^M\d+$/.test(token.pair))) ||
      (token.type === 'close' ? token.pair !== token.parent : token.pair !== null)
    )
      throw new TranslationError('translation-invalid')
    return {
      id: token.id as string,
      type: token.type as TranslationToken['type'],
      role: token.role as TranslationToken['role'],
      parent: token.parent as string | null,
      pair: token.pair as string | null,
    }
  })
  for (const token of tokens) {
    if (
      token.type !== 'atom' &&
      !['emphasis', 'strong', 'delete', 'link', 'subscript', 'superscript'].includes(token.role)
    )
      throw new TranslationError('translation-invalid')
    if (token.type === 'close') {
      const open = tokens.find((candidate) => candidate.id === token.pair)
      if (open?.type !== 'open' || open.role !== token.role)
        throw new TranslationError('translation-invalid')
    }
  }
  const payload: TranslationPayload = {
    schema: extractionVersion,
    kind: value.kind as TranslationPayload['kind'],
    text: value.text,
    tokens,
  }
  if (utf8Bytes(JSON.stringify(payload)) > translationLimits.payload)
    throw new TranslationError('translation-limit')
  validateTranslation(payload, payload.text)
  return payload
}
