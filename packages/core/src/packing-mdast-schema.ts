import type { PackedReadScope } from './packing-capture'
import { validateMathData } from './packing-math-schema'
import type { ScalarLimits } from './packing-text'
import {
  invalidPackedSemantic,
  packedInteger,
  packedKeys,
  packedSmall,
  packedString,
} from './packing-validation-read'

type Rule =
  | 'string'
  | 'url'
  | 'nullableString'
  | 'boolean'
  | 'nullableBoolean'
  | 'start'
  | 'depth'
  | 'reference'
  | 'align'
  | 'math'
  | 'inlineMath'
interface Schema {
  readonly fields: Readonly<Record<string, Rule>>
  readonly optional?: Readonly<Record<string, Rule>>
  readonly children?: ReadonlySet<string>
}
const phrasing = new Set([
  'text',
  'emphasis',
  'strong',
  'delete',
  'subscript',
  'superscript',
  'emoji',
  'inlineCode',
  'inlineMath',
  'break',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'footnoteReference',
  'html',
])
const flow = new Set([
  'defList',
  'paragraph',
  'heading',
  'blockquote',
  'list',
  'code',
  'math',
  'table',
  'thematicBreak',
  'html',
  'yaml',
  'toml',
  'definition',
  'footnoteDefinition',
])
const leaf = (fields: Record<string, Rule>): Schema => ({ fields })
const parent = (children: ReadonlySet<string>, fields: Record<string, Rule> = {}): Schema => ({
  fields,
  children,
})
const schemas: Readonly<Record<string, Schema>> = Object.freeze({
  root: parent(flow),
  paragraph: parent(phrasing),
  heading: parent(phrasing, { depth: 'depth' }),
  blockquote: parent(flow),
  list: parent(new Set(['listItem']), { ordered: 'boolean', start: 'start', spread: 'boolean' }),
  listItem: { ...parent(flow, { spread: 'boolean' }), optional: { checked: 'nullableBoolean' } },
  emphasis: parent(phrasing),
  strong: parent(phrasing),
  delete: parent(phrasing),
  link: parent(phrasing, { url: 'url', title: 'nullableString' }),
  linkReference: parent(phrasing, {
    identifier: 'string',
    label: 'string',
    referenceType: 'reference',
  }),
  table: parent(new Set(['tableRow']), { align: 'align' }),
  tableRow: parent(new Set(['tableCell'])),
  tableCell: parent(phrasing),
  defList: parent(new Set(['defListTerm', 'defListDescription'])),
  defListTerm: parent(phrasing),
  defListDescription: parent(flow, { spread: 'boolean' }),
  footnoteDefinition: parent(flow, { identifier: 'string', label: 'string' }),
  footnoteReference: leaf({ identifier: 'string', label: 'string' }),
  image: leaf({ url: 'url', title: 'nullableString', alt: 'string' }),
  imageReference: leaf({
    identifier: 'string',
    label: 'string',
    referenceType: 'reference',
    alt: 'string',
  }),
  definition: leaf({
    identifier: 'string',
    label: 'string',
    url: 'url',
    title: 'nullableString',
  }),
  text: leaf({ value: 'string' }),
  subscript: parent(phrasing),
  superscript: parent(phrasing),
  emoji: leaf({ name: 'string', value: 'string' }),
  inlineCode: leaf({ value: 'string' }),
  code: leaf({ value: 'string', lang: 'nullableString', meta: 'nullableString' }),
  html: leaf({ value: 'string' }),
  yaml: leaf({ value: 'string' }),
  toml: leaf({ value: 'string' }),
  math: leaf({ value: 'string', meta: 'nullableString', data: 'math' }),
  inlineMath: leaf({ value: 'string', data: 'inlineMath' }),
  break: leaf({}),
  thematicBreak: leaf({}),
})

// The pinned schemas are module constants. Prepare their key/rule tables once instead
// of rebuilding arrays for every node in every complete validation pass.
const prepared = Object.fromEntries(
  Object.entries(schemas).map(([type, schema]) => [
    type,
    {
      children: schema.children,
      required: [
        'type',
        ...(type === 'text' || type === 'link' ? [] : ['position']),
        ...Object.keys(schema.fields),
        ...(schema.children ? ['children'] : []),
      ],
      optional: [
        ...Object.keys(schema.optional ?? {}),
        ...(type === 'text' || type === 'link' ? ['position'] : []),
      ],
      rules: [
        ...Object.entries(schema.fields).map(([key, rule]) => [key, rule, false] as const),
        ...Object.entries(schema.optional ?? {}).map(([key, rule]) => [key, rule, true] as const),
      ],
    },
  ]),
)

// Only schemas whose complete payload is one children array or one bounded string.
// Unpositioned autolinks, other key orders, extensions and lazy transforms stay generic.
const simple = new Map(
  Object.entries(prepared).flatMap(([type, schema]) => {
    const parent = schema.children && schema.rules.length === 0
    const value =
      schema.rules.length === 1 &&
      schema.rules[0]?.[0] === 'value' &&
      schema.rules[0]?.[1] === 'string' &&
      schema.rules[0]?.[2] === false
    return parent || value
      ? [[type, { children: schema.children, payload: parent ? 'children' : 'value' }]]
      : []
  }),
)

/** Synchronous validation of a complete common record. Source-free metadata is read
 * through the original revocable scope; the root workspace's fixed scratch covers it.
 * This never replaces source geometry, parent/child, traversal or document checks.
 */
export function readSimpleMdastRecord(scope: PackedReadScope, sourceLength: number) {
  const record = scope.encodedRecord()
  const keys = record?.keys
  if (
    !record ||
    !keys ||
    keys.length !== 3 ||
    keys[0] !== 'type' ||
    keys[2] !== 'position' ||
    (keys[1] !== 'children' && keys[1] !== 'value')
  )
    return undefined
  const typeRef = scope.encodedReference(record.record, record.next)
  const type = scope.encodedRecord(typeRef.reference)?.text
  if (type === undefined) return undefined
  const schema = simple.get(type)
  if (!schema || keys[1] !== schema.payload) return undefined
  const payloadRef = scope.encodedReference(record.record, typeRef.next)
  const payload = scope.encodedRecord(payloadRef.reference)
  if (
    !payload ||
    (schema.children ? payload.tag !== 6 : payload.tag !== 5 || payload.length > sourceLength)
  )
    invalidPackedSemantic()
  const positionRef = scope.encodedReference(record.record, payloadRef.next)
  const coordinates = scope.encodedRecord(positionRef.reference)?.position
  if (!coordinates) invalidPackedSemantic()
  const [line, column, offset, endLine, endColumn, endOffset] = coordinates
  const position = Object.freeze({
    start: Object.freeze({ line, column, offset }),
    end: Object.freeze({ line: endLine, column: endColumn, offset: endOffset }),
  })
  scope.assertOpen()
  return { type, position, children: schema.children }
}

/** Source-dependent bounds of an already fully validated immutable mdast node. Other
 * field/data invariants remain invariant under a position-only shift of that record.
 */
export function mdastSourceMinimum(scope: PackedReadScope, type: string): number {
  if (!Object.hasOwn(prepared, type)) invalidPackedSemantic()
  const schema = prepared[type]
  if (!schema) invalidPackedSemantic()
  let minimum = 0
  for (const [key, rule, optional] of schema.rules) {
    if (optional && !scope.hasField(key)) continue
    if (rule === 'string' || rule === 'url' || rule === 'nullableString') {
      if (rule === 'nullableString' && scope.scalarType([key]) === 'null') continue
      minimum = Math.max(minimum, scope.textLength([key]) - (rule === 'url' ? 7 : 0))
    } else if (rule === 'align') minimum = Math.max(minimum, scope.length([key]))
  }
  return minimum
}

/** Strict schemas for the concrete output of the pinned parser. Unknown extensions/data
 * fail closed and require full resync/fallback, rather than reaching a root consumer.
 */
export function* validateMdastFields(
  scope: PackedReadScope,
  type: string,
  sourceLength: number,
  budget: ScalarLimits,
): Generator<void, ReadonlySet<string> | undefined, undefined> {
  if (!Object.hasOwn(prepared, type)) invalidPackedSemantic()
  const schema = prepared[type]
  if (!schema) invalidPackedSemantic()
  packedKeys(scope, [], schema.required, schema.optional)
  for (const [key, rule, optional] of schema.rules) {
    if (optional && !scope.hasField(key)) continue
    const path = [key]
    if (rule === 'string') packedString(scope, path, sourceLength)
    // Literal autolinks add http:// or mailto: to the source spelling.
    else if (rule === 'url') packedString(scope, path, sourceLength + 7)
    else if (rule === 'nullableString') {
      if (scope.scalarType(path) !== 'null') packedString(scope, path, sourceLength)
    } else if (rule === 'boolean' || rule === 'nullableBoolean') {
      const type = scope.scalarType(path)
      if (type !== 'boolean' && !(rule === 'nullableBoolean' && type === 'null'))
        invalidPackedSemantic()
    } else if (rule === 'start') {
      if (packedSmall(scope, ['ordered']) === true) packedInteger(scope, path, 999999999)
      else if (scope.scalarType(path) !== 'null') invalidPackedSemantic()
    } else if (rule === 'depth') {
      if (packedInteger(scope, path, 6) < 1) invalidPackedSemantic()
    } else if (rule === 'reference') {
      if (!['full', 'collapsed', 'shortcut'].includes(String(packedSmall(scope, path))))
        invalidPackedSemantic()
    } else if (rule === 'align') {
      if (scope.kind(path) !== 'array' || scope.length(path) > sourceLength) invalidPackedSemantic()
      for (const item of scope.elementSteps(path)) {
        if (item === undefined) {
          yield
          continue
        }
        const align = packedSmall(item, [])
        if (align !== null && align !== 'left' && align !== 'right' && align !== 'center')
          invalidPackedSemantic()
        yield
      }
    } else yield* validateMathData(scope, path, rule === 'math', budget)
  }
  if (schema.children && scope.kind(['children']) !== 'array') invalidPackedSemantic()
  return schema.children
}
