import type { Blockquote, Heading, List, ListItem, Nodes, Paragraph, Root } from 'mdast'
import type { MarkdownPlugins } from './conventions'
import { plainText } from './semantic-description'

const alerts = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'])

function headingAttributes(node: Heading, source: string): string | undefined {
  const last = node.children.at(-1)
  if (last?.type !== 'text') return undefined
  const match = /[ \t]+\{([^{}]+)\}[ \t]*$/.exec(last.value)
  if (!match) return undefined
  const raw = source.slice(last.position?.start.offset ?? 0, last.position?.end.offset ?? 0)
  const rawMatch = /[ \t]+\{([^{}]+)\}[ \t]*$/.exec(raw)
  if (!rawMatch || rawMatch[1] !== match[1]) return undefined
  const tokens = match[1]?.trim().split(/\s+/) ?? []
  let id: string | undefined
  const classes: string[] = []
  for (const token of tokens) {
    if (!/^[#.][\p{L}\p{N}_][\p{L}\p{N}_.:-]*$/u.test(token)) return undefined
    if (token.startsWith('#')) {
      if (id) return undefined
      id = token.slice(1)
    } else classes.push(token.slice(1))
  }
  last.value = last.value.slice(0, match.index)
  node.data = {
    ...node.data,
    hProperties: { ...(id ? { id } : {}), ...(classes.length ? { className: classes } : {}) },
    manuslipProjection: true,
  }
  return id
}

function alert(node: Blockquote, source: string): void {
  const paragraph = node.children[0]
  if (paragraph?.type !== 'paragraph') return
  const first = paragraph.children[0]
  if (first?.type !== 'text') return
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\n|[ \t]*$)/.exec(first.value)
  const kind = match?.[1]
  if (!match || !kind || !alerts.has(kind)) return
  if (!source.slice(first.position?.start.offset ?? 0).startsWith(`[!${kind}]`)) return
  first.value = first.value.slice(match[0].length)
  if (!paragraph.children.some((child) => child.type !== 'text' || child.value))
    node.children.shift()
  node.data = {
    ...node.data,
    hProperties: { className: ['markdown-alert', `markdown-alert-${kind.toLowerCase()}`] },
    manuslipProjection: true,
    manuslipAlert: kind,
  }
}

function tableOfContents(headings: Heading[]): List {
  const list = (): List => ({ type: 'list', ordered: false, spread: false, children: [] })
  const root = list()
  const stack: { depth: number; item: ListItem }[] = []
  for (const heading of headings) {
    while (stack.length && heading.depth <= (stack.at(-1)?.depth ?? 0)) stack.pop()
    const parent = stack.at(-1)?.item
    let target = root
    if (parent) {
      const nested = parent.children.at(-1)
      target = nested?.type === 'list' ? nested : list()
      if (nested !== target) parent.children.push(target)
    }
    const id = heading.data?.hProperties?.id
    const item: ListItem = {
      type: 'listItem',
      spread: false,
      checked: null,
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: `#${String(id)}`,
              children: [{ type: 'text', value: plainText(heading) }],
            },
          ],
        },
      ],
    }
    target.children.push(item)
    stack.push({ depth: heading.depth, item })
  }
  return root
}

/** Operates on semantic nodes, keeping code, math, HTML and source bytes untouched. */
export function applyDocumentConventions(
  root: Root,
  source: string,
  plugins: MarkdownPlugins,
): void {
  const headings: Heading[] = []
  const toc: Paragraph[] = []
  const used = new Set<string>()
  const assigned = new Set<string>()
  const suffixes = new Map<string, number>()
  const pending: Nodes[] = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) continue
    if (node.type === 'heading') {
      const id = headingAttributes(node, source)
      if (id) used.add(id)
      headings.push(node)
    }
    if (plugins.github && node.type === 'blockquote') alert(node, source)
    if (node.type === 'paragraph') {
      const from = node.position?.start.offset,
        to = node.position?.end.offset
      if (
        plugins.typora &&
        from !== undefined &&
        to !== undefined &&
        /^\[toc\]$/i.test(source.slice(from, to))
      )
        toc.push(node)
      const math = node.children[0]
      if (
        plugins.latex &&
        node.children.length === 1 &&
        math?.type === 'inlineMath' &&
        (math.data?.manuslipDisplay ||
          source
            .slice(math.position?.start.offset ?? 0, math.position?.end.offset ?? 0)
            .startsWith('$$'))
      ) {
        Object.assign(node, {
          type: 'math',
          value: math.value,
          data: {
            hName: 'pre',
            hChildren: [
              {
                type: 'element',
                tagName: 'code',
                properties: { className: ['language-math', 'math-display'] },
                children: [{ type: 'text', value: math.value }],
              },
            ],
          },
        })
        delete (node as Partial<Paragraph>).children
      }
    }
    if (plugins.latex && node.type === 'code' && /^(?:math|latex|tex)$/i.test(node.lang ?? '')) {
      Object.assign(node, {
        type: 'math',
        data: {
          hName: 'pre',
          hChildren: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: ['language-math', 'math-display'] },
              children: [{ type: 'text', value: node.value }],
            },
          ],
        },
      })
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]
        if (child) pending.push(child)
      }
    }
  }
  // Reserve explicit IDs first, including ones on later headings. Repeated automatic
  // names and explicit anchors therefore never steal one another's destinations.
  for (const heading of headings) {
    const explicit = heading.data?.hProperties?.id
    const base =
      typeof explicit === 'string'
        ? explicit
        : plainText(heading)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
            .trim()
            .replace(/\s/g, '-') || 'section'
    let id = base
    if (assigned.has(id) || (!explicit && used.has(id))) {
      let suffix = suffixes.get(base) ?? 1
      do {
        id = `${base}-${suffix++}`
      } while (assigned.has(id) || used.has(id))
      suffixes.set(base, suffix)
    }
    assigned.add(id)
    heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id } }
  }
  for (const node of toc) {
    node.data = {
      hName: 'nav',
      hProperties: { className: ['markdown-toc'], ariaLabel: 'Table of contents' },
      hChildren: undefined,
      manuslipProjection: true,
    }
    // toHast supports semantic block children in an overridden paragraph wrapper.
    Object.assign(node, { children: [tableOfContents(headings)] })
  }
}

/** Parent widgets own transformed prose, highlights and complete callouts. Walk
 * without recursion so deeply nested source cannot exhaust the JavaScript stack.
 */
export function markDocumentProjections(root: Root): void {
  const pending: { node: Nodes; complete: boolean }[] = [{ node: root, complete: false }]
  const changed = new Set<Nodes>()
  while (pending.length) {
    const entry = pending.pop()
    if (!entry) continue
    const { node, complete } = entry
    if (!complete && 'children' in node) {
      pending.push({ node, complete: true })
      for (const child of node.children) pending.push({ node: child, complete: false })
      continue
    }
    if (
      node.data?.manuslipProjection ||
      node.data?.hName === 'mark' ||
      ('children' in node && node.children.some((child) => changed.has(child)))
    ) {
      changed.add(node)
      if (['paragraph', 'heading', 'blockquote', 'list', 'defList'].includes(node.type))
        node.data = { ...node.data, manuslipProjection: true }
    }
  }
}
