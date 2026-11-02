import type { Nodes, Root } from '@manuslip/core'
import { utf8Bytes } from '@manuslip/core/text'
import { translationBindings } from './compact-bindings'
import {
  type ReconstructedDocument,
  type TokenBinding,
  TranslationError,
  type TranslationPayload,
  type TranslationPlan,
  type TranslationUnit,
  translationLimits,
} from './contracts'

type Parent = Extract<Nodes, { children: unknown }>
type InlineParent = Extract<Nodes, { type: 'paragraph' | 'heading' | 'tableCell' | 'defListTerm' }>
const markers = /⟪([^⟪⟫]*)⟫|[⟪⟫]/g
interface Piece {
  text: string
}
interface Placeholder {
  id: string
}
function validatedPieces(payload: TranslationPayload, output: unknown): (Piece | Placeholder)[] {
  if (typeof output !== 'string') throw new TranslationError('translation-invalid')
  if (utf8Bytes(output) > translationLimits.output)
    throw new TranslationError('translation-output-large')
  const expected = new Map(payload.tokens.map((token) => [token.id, token]))
  const seen = new Set<string>()
  const stack: string[] = []
  const pieces: (Piece | Placeholder)[] = []
  let start = 0
  let prose = ''
  for (const match of output.matchAll(markers)) {
    const id = match[1] || ''
    const token = expected.get(id)
    if (!token || seen.has(id) || match[0] !== `⟪${id}⟫`)
      throw new TranslationError('translation-placeholders')
    const parent = stack.at(-1) || null
    if (token.parent !== parent) throw new TranslationError('translation-placeholders')
    if (token.type === 'open') stack.push(id)
    else if (token.type === 'close' && stack.pop() !== token.pair)
      throw new TranslationError('translation-placeholders')
    const text = output.slice(start, match.index)
    prose += text
    pieces.push({ text }, { id })
    seen.add(id)
    start = match.index + match[0].length
  }
  const tail = output.slice(start)
  prose += tail
  pieces.push({ text: tail })
  if (seen.size !== expected.size || stack.length || !prose.trim())
    throw new TranslationError('translation-placeholders')
  return pieces
}

/** Validation is repeated at every AST admission, including cached output. */
export function validateTranslation(payload: TranslationPayload, output: unknown): string {
  validatedPieces(payload, output)
  return output as string
}
export function reconstructUnit(
  unit: TranslationUnit,
  output: unknown,
  shared?: {
    charge(bytes: number): void
    branch(node: Nodes, children: Nodes[]): Parent
    text?(value: string): Nodes
  },
): InlineParent['children'] {
  if (!unit.payload) throw new TranslationError('translation-limit')
  const pieces = validatedPieces(unit.payload, output)
  const bindings = new Map<string, TokenBinding>()
  for (const binding of translationBindings(unit)) bindings.set(binding.token.id, binding)
  shared?.charge(64)
  const root: Parent = { type: 'paragraph', children: [] }
  const stack: Parent[] = [root]
  for (const piece of pieces) {
    const parent = stack.at(-1)
    if (!parent) throw new TranslationError('translation-invalid')
    if ('text' in piece) {
      if (piece.text) {
        if (shared?.text) shared.charge(8)
        else shared?.charge(168 + piece.text.length * 2)
        const text: Nodes = shared?.text?.(piece.text) ?? { type: 'text', value: piece.text }
        ;(parent.children as Nodes[]).push(shared ? Object.freeze(text) : text)
      }
      continue
    }
    const binding = bindings.get(piece.id)
    if (!binding) throw new TranslationError('translation-invalid')
    if (binding.token.type === 'close') {
      const closed = stack.pop()
      if (shared && closed) {
        Object.freeze(closed.children)
        Object.freeze(closed)
      }
      continue
    }
    if (!binding.node) throw new TranslationError('translation-invalid')
    let node = shared ? binding.node : structuredClone(binding.node)
    if (Array.isArray(node)) {
      if (binding.token.type !== 'atom') {
        throw new TranslationError('translation-invalid')
      }
      shared?.charge(node.length * 8)
      for (const child of node) (parent.children as Nodes[]).push(child)
      continue
    }
    if (binding.token.type === 'open') {
      if (!('children' in node)) throw new TranslationError('translation-invalid')
      if (shared) node = shared.branch(node, [])
      else node.children = []
    }
    shared?.charge(8)
    ;(parent.children as Nodes[]).push(node)
    if (binding.token.type === 'open' && 'children' in node) stack.push(node)
  }
  if (shared) Object.freeze(root.children)
  return root.children as InlineParent['children']
}

export function reconstructTranslation(
  plan: TranslationPlan,
  outputs: ReadonlyMap<string, unknown>,
): ReconstructedDocument {
  const root: Root = structuredClone(plan.root)
  const statuses: ReconstructedDocument['statuses'] = []
  let outputBytes = 0
  for (const unit of plan.units) {
    const value = outputs.get(unit.occurrenceId)
    let status: ReconstructedDocument['statuses'][number]['status'] = unit.error
      ? 'limit'
      : 'missing'
    if (!unit.error && value !== undefined) {
      try {
        const children = reconstructUnit(unit, value)
        const size = utf8Bytes(value as string)
        if (outputBytes + size > translationLimits.reconstructed)
          throw new TranslationError('translation-output-large')
        let node: Nodes = root
        for (const index of unit.path) {
          if (!('children' in node) || !node.children[index])
            throw new TranslationError('translation-invalid')
          node = node.children[index]
        }
        if (node.type !== unit.kind || !('children' in node))
          throw new TranslationError('translation-invalid')
        node.children = children
        outputBytes += size
        status = 'translated'
      } catch (error) {
        status =
          error instanceof TranslationError && error.code === 'translation-output-large'
            ? 'limit'
            : 'invalid'
      }
    }
    statuses.push({ occurrenceId: unit.occurrenceId, status })
  }
  return { root, statuses }
}
