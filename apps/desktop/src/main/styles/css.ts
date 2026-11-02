import { parse } from 'postcss'
import { hasStyleControls, styleLimits } from '../../shared/style-contracts'
import { FileOperationError } from '../files/errors'

const tags = new Set(
  'h1 h2 h3 h4 h5 h6 p blockquote ul ol li table thead tbody tr th td code pre a strong em del hr img dl dt dd sup sub'.split(
    ' ',
  ),
)
const aliases: Record<string, string> = {
  blockquote: 'cm-live-quote',
  strong: 'cm-live-strong',
  em: 'cm-live-emphasis',
  del: 'cm-live-strike',
  code: 'cm-live-code',
  a: 'cm-live-link',
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [`h${level}`, `cm-live-heading-${level}`]),
  ),
}
const colors = new Set([
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
])
const lengths = new Set([
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'margin-block',
  'margin-inline',
  'margin-block-start',
  'margin-block-end',
  'margin-inline-start',
  'margin-inline-end',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'padding-block',
  'padding-inline',
  'padding-block-start',
  'padding-block-end',
  'padding-inline-start',
  'padding-inline-end',
  'text-indent',
  'border-spacing',
])
const choices: Record<string, string[]> = {
  'font-style': ['normal', 'italic', 'oblique'],
  'text-align': ['start', 'end', 'left', 'right', 'center', 'justify'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'text-decoration': ['none', 'underline', 'line-through', 'overline'],
  'border-style': ['none', 'solid', 'dashed', 'dotted', 'double'],
  'border-collapse': ['collapse', 'separate'],
  'vertical-align': ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom'],
  'list-style-type': [
    'none',
    'disc',
    'circle',
    'square',
    'decimal',
    'lower-alpha',
    'upper-alpha',
    'lower-roman',
    'upper-roman',
  ],
}
const colorFunctions = new Set(
  'rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark'.split(' '),
)
function invalid(): never {
  throw new FileOperationError('style-invalid')
}
function length(value: string, maximum = 64): boolean {
  if (value === '0') return true
  const match = /^(\d+(?:\.\d+)?)(px|em|rem)$/.exec(value)
  return Boolean(
    match && Number(match[1]) <= (match[2] === 'px' ? maximum : Math.min(4, maximum / 16)),
  )
}
function declaration(property: string, raw: string): string {
  const value = raw.trim().replace(/\s+/g, ' ')
  if (
    !value ||
    value.length > 1024 ||
    /[{};<>@\\!]/.test(value) ||
    hasStyleControls(value) ||
    value.includes('/*')
  )
    invalid()
  if (colors.has(property)) {
    if (!/^[#a-z0-9\s.,%()+/-]+$/i.test(value)) invalid()
    for (const match of value.matchAll(/([a-z-]+)\s*\(/gi))
      if (!colorFunctions.has((match[1] ?? '').toLowerCase())) invalid()
    return value
  }
  if (property === 'font-family') {
    if (!/^[\p{L}\p{N}\s,'"_-]+$/u.test(value)) invalid()
    return value
  }
  if (property === 'font-size') {
    if (!length(value)) invalid()
    return `clamp(10px, ${value === '0' ? '0px' : value}, 64px)`
  }
  if (property === 'line-height') {
    if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 1 || Number(value) > 3) invalid()
    return value
  }
  if (property === 'font-weight') {
    if (!['normal', 'bold'].includes(value) && !/^[1-9]00$/.test(value)) invalid()
    return value
  }
  if (property === 'letter-spacing') {
    if (
      value !== 'normal' &&
      (!/^-?\d+(?:\.\d+)?px$/.test(value) ||
        Number.parseFloat(value) < -2 ||
        Number.parseFloat(value) > 8)
    )
      invalid()
    return value
  }
  if (property === 'border-width' || /^border-(?:top|right|bottom|left)-width$/.test(property)) {
    if (!value.split(' ').every((item) => length(item, 4)) || value.split(' ').length > 4) invalid()
    return value
  }
  if (lengths.has(property) || property === 'text-underline-offset') {
    const parts = value.split(' ')
    if (
      parts.length > 4 ||
      !parts.every((item) => length(item, property === 'text-underline-offset' ? 8 : 64))
    )
      invalid()
    return value
  }
  if (!choices[property]?.includes(value)) invalid()
  return value
}
function selector(raw: string, root: string): string {
  let value = raw.trim().toLowerCase()
  if (!value || value.length > 512) invalid()
  const alias = /^(body|:root|\.markdown-body)(?=\s|>|$)/.exec(value)
  if (alias) value = value.slice(alias[0].length).trim()
  if (!value) return root
  const direct = Boolean(alias && value.startsWith('>'))
  if (value.startsWith('>')) value = value.slice(1).trim()
  if (!/^[a-z][a-z0-9]*(?:\s*(?:>\s*|\s+)[a-z][a-z0-9]*)*$/.test(value)) invalid()
  const parts = value.split(/(\s*>\s*|\s+)/).filter(Boolean)
  if (parts.length > 15) invalid()
  return (
    root +
    (direct ? ' > ' : ' ') +
    parts
      .map((part) => {
        if (/^\s*>\s*$/.test(part)) return ' > '
        if (/^\s+$/.test(part)) return ' '
        if (!tags.has(part)) invalid()
        return aliases[part] ? `:is(${part},.${aliases[part]})` : part
      })
      .join('')
  )
}

/** Compile an explicit content-only CSS subset; arbitrary selectors never reach the app. */
export function compileStylesheet(source: string, root: string): string {
  if (Buffer.byteLength(source) > styleLimits.input || source.includes('\0'))
    throw new FileOperationError('style-limit')
  try {
    const ast = parse(source, { from: undefined }),
      output: string[] = []
    let rules = 0,
      selectors = 0,
      declarations = 0,
      bytes = 0
    for (const node of ast.nodes) {
      if (node.type === 'comment') continue
      if (node.type !== 'rule' || ++rules > styleLimits.rules) invalid()
      const names = node.selectors
      selectors += names.length
      if (selectors > styleLimits.selectors) invalid()
      const scoped = names.map((name) => selector(name, root))
      const values: string[] = []
      for (const child of node.nodes) {
        if (child.type === 'comment') continue
        if (child.type !== 'decl' || child.important || ++declarations > styleLimits.declarations)
          invalid()
        const property = child.prop.toLowerCase()
        const value = declaration(property, child.raws.value?.raw ?? child.value)
        values.push(`${property}:${value}`)
        // Heading tokens otherwise keep Source highlighting instead of inheriting Live content color.
        if (property === 'color') values.push(`--manuslip-heading-color:${value}`)
        if (property === 'font-weight') values.push(`--manuslip-heading-weight:${value}`)
      }
      if (!values.length) invalid()
      const rule = `${scoped.join(',')}{${values.join(';')}}`
      bytes += Buffer.byteLength(rule) + (output.length ? 1 : 0)
      if (bytes > styleLimits.output) throw new FileOperationError('style-limit')
      output.push(rule)
    }
    if (!rules) invalid()
    return output.join('\n')
  } catch (error) {
    if (error instanceof FileOperationError) throw error
    return invalid()
  }
}
