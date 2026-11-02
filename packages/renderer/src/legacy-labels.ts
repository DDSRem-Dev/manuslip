import { utf8Bytes } from '@manuslip/core/text'
import { diagramLimits } from './diagram'

export function unsupportedLegacy(): never {
  throw new Error('diagram-unsupported')
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject source control characters before generating Mermaid statements.
const controls = /[\u0000-\u001f\u007f\u2028\u2029]/u

/** Only text reaches a Mermaid label. Identifiers and structural syntax are generated. */
export function legacyLabel(value: string): string {
  if (controls.test(value)) unsupportedLegacy()
  return value
    .split('\\n')
    .map((part) => part.replace(/[&#"<>;\\%`]/gu, (character) => `#${character.codePointAt(0)};`))
    .join('<br/>')
}

/** Mermaid 12's SVG flow labels retain numeric entities as text. Decode only our
 * generated escapes, once, on sanitized text nodes; never parse labels as markup.
 */
export function restoreLegacyLabelText(value: string): string {
  return value.replace(/&#(34|35|37|38|59|60|62|92|96);/g, (_, code: string) =>
    String.fromCharCode(Number(code)),
  )
}

export function legacyActor(value: string): string {
  let name = value.trim()
  const quoted = name.startsWith('"') && name.endsWith('"')
  if (quoted) name = name.slice(1, -1)
  if (!name || name.includes('"') || controls.test(name) || (!quoted && /[>:,-]/u.test(name)))
    unsupportedLegacy()
  return name
}

export function legacyActors(value: string): string[] {
  const names: string[] = []
  let quoted = false,
    from = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted
    else if (value[index] === ',' && !quoted) {
      names.push(value.slice(from, index))
      from = index + 1
    }
  }
  if (quoted) unsupportedLegacy()
  names.push(value.slice(from))
  return names
}

export class MermaidLines {
  readonly #lines: string[] = []
  #bytes = 0
  constructor(header: string) {
    this.add(header)
  }
  add(line: string): void {
    const bytes = utf8Bytes(line) + (this.#lines.length ? 1 : 0)
    if (this.#bytes + bytes > diagramLimits.source) throw new Error('diagram-limit')
    this.#bytes += bytes
    this.#lines.push(line)
  }
  text(): string {
    return this.#lines.join('\n')
  }
}

export function legacySourceLines(source: string): string[] {
  return source
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}
