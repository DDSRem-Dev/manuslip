/** Built-in Markdown plugins. Basic Markdown extensions remain available independently. */
export interface MarkdownPlugins {
  opt: boolean
  latex: boolean
  mermaid: boolean
  github: boolean
  /** YAML front matter and [TOC] tables of contents. */
  typora: boolean
}

declare module 'unist' {
  interface Data {
    manuslipProjection?: boolean
    manuslipDisplay?: boolean
    manuslipAlert?: string
    hName?: string
  }
}

export const defaultMarkdownPlugins: Readonly<MarkdownPlugins> = Object.freeze({
  opt: true,
  latex: true,
  mermaid: true,
  github: false,
  typora: false,
})

export const markdownPluginNames = ['opt', 'latex', 'mermaid', 'github', 'typora'] as const

export function parseMarkdownPlugins(value: unknown): MarkdownPlugins {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !markdownPluginNames.includes(key as keyof MarkdownPlugins)) ||
    markdownPluginNames.some(
      (key) =>
        !Object.hasOwn(value, key) || typeof (value as Record<string, unknown>)[key] !== 'boolean',
    )
  )
    throw new Error('Invalid Markdown plugins')
  return Object.fromEntries(
    markdownPluginNames.map((name) => [name, (value as MarkdownPlugins)[name]]),
  ) as unknown as MarkdownPlugins
}
