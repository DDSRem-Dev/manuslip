import type { Element, Nodes, Parents } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { RenderOptions } from './index'
import { ProjectionTraversalBudget } from './projection-traversal-budget'

const chunkUnits = 4096
const marker = '\uffff'

/** Each traversal owns separate input/output iterators so escaping can delegate output
 * while its input piece is suspended. Reusing the iterators avoids a generator allocation
 * for every shell/text piece. Completion, cancellation and exceptions release strings.
 */
class HtmlPieces implements IterableIterator<string> {
  #value = ''
  #from = 0
  start(value: string): this {
    this.#value = value
    this.#from = 0
    return this
  }
  [Symbol.iterator](): this {
    return this
  }
  next(): IteratorResult<string, undefined> {
    const value = this.#value
    const from = this.#from
    if (from >= value.length) {
      this.clear()
      return { value: undefined, done: true }
    }
    let end = Math.min(from + chunkUnits, value.length)
    const left = value.charCodeAt(end - 1)
    const right = value.charCodeAt(end)
    if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) end--
    this.#from = end
    return { value: value.slice(from, end), done: false }
  }
  clear(): void {
    this.#value = ''
    this.#from = 0
  }
  return(value?: unknown): IteratorResult<string> {
    this.clear()
    return { value, done: true }
  }
  throw(error?: unknown): IteratorResult<string> {
    this.clear()
    throw error
  }
}

interface Frame {
  node: Nodes
  parent: Parents | undefined
  space: 'html' | 'svg'
  depth: number
  entered: boolean
  container?: Parents
  childSpace: 'html' | 'svg'
  index: number
  opened: boolean
  suffix: string
}

/** Pinned default serializer spelling in bounded text pieces. Public toHtml still owns
 * escaping, attribute/property spelling and general HTML/SVG shells. A fixed set of
 * propertyless non-void HTML shells uses its default spelling directly. Mandatory entity
 * semicolons make text-piece boundaries independent. Its script/style text context
 * and schema transition are reproduced here; optional-tag/minification options are absent.
 * Caller admits the stable HAST, all shell scratch and bounded text work before advancing.
 * Shallow shell serialization remains atomic and may exceed one output chunk in memory.
 */
export function* projectionHtmlChunks(
  root: Nodes,
  options: Pick<RenderOptions, 'rawHtml'>,
  limits: { nodes: number; depth: number },
): Generator<string | undefined> {
  const progress = new ProjectionTraversalBudget()
  let visits = 0
  const input = new HtmlPieces()
  const output = new HtmlPieces()
  function shell(node: Element, content: boolean, space: 'html' | 'svg') {
    const tag = node.tagName
    if (
      space === 'html' &&
      (tag === 'blockquote' ||
        tag === 'p' ||
        tag === 'strong' ||
        tag === 'em' ||
        tag === 'del' ||
        tag === 'code')
    ) {
      // Upstream enumerates inherited properties too. A nonempty property bag always
      // keeps its complete serializer; these fixed non-void HTML names need no escaping.
      let property: string | undefined
      for (property in node.properties) break
      if (property === undefined) {
        // biome-ignore lint/style/useTemplate: Preserve the measured hot-path code generation.
        const prefix = '<' + tag + '>',
          // biome-ignore lint/style/useTemplate: Preserve the measured hot-path code generation.
          suffix = '</' + tag + '>'
        return content ? { prefix, suffix } : { prefix: prefix + suffix, suffix: '' }
      }
    }
    const children = content ? [{ type: 'text' as const, value: marker }] : []
    const shallow: Element = { ...node, children }
    if (space === 'html' && node.tagName === 'template')
      shallow.content = { type: 'root', children }
    const spelling = toHtml(shallow, { space, allowDangerousHtml: options.rawHtml })
    if (!content) return { prefix: spelling, suffix: '' }
    const suffix = `</${node.tagName}>`
    const boundary = spelling.length - suffix.length - marker.length
    if (boundary < 0 || spelling.slice(boundary) !== marker + suffix)
      throw new Error('Unsupported projection serializer shell')
    return { prefix: spelling.slice(0, boundary), suffix }
  }
  // Active frames share the stream planner's existing per-depth workspace reservation.
  // Reuse sibling frames within this traversal; no frame survives the generator.
  const stack: Frame[] = []
  let active = 0
  let openedThrough = 0
  function push(node: Nodes, parent: Parents | undefined, space: 'html' | 'svg', depth: number) {
    const frame = stack[active]
    if (frame) {
      frame.node = node
      frame.parent = parent
      frame.space = space
      frame.depth = depth
      frame.entered = false
      frame.container = undefined
      frame.childSpace = space
      frame.index = 0
      frame.opened = false
      frame.suffix = ''
    } else
      stack.push({
        node,
        parent,
        space,
        depth,
        entered: false,
        container: undefined,
        childSpace: space,
        index: 0,
        opened: false,
        suffix: '',
      })
    active++
  }
  function pop() {
    active--
    openedThrough = Math.min(openedThrough, active)
  }
  // Pending ancestors open only when a child actually emits nonempty HTML. This retains
  // upstream's unusual void-content behavior without a generator/lookahead per ancestor.
  function* openParents(): Generator<string | undefined> {
    while (openedThrough < active) {
      const frame = stack[openedThrough++]
      if (frame?.node.type !== 'element') continue
      yield
      const tags = shell(frame.node, true, frame.space)
      frame.opened = true
      frame.suffix = tags.suffix
      yield* output.start(tags.prefix)
    }
  }
  push(root, undefined, 'html', 0)
  try {
    while (active) {
      const frame = stack[active - 1]
      if (!frame) throw new Error('Missing projection HTML frame')
      const { node, parent, space, depth } = frame
      if (!frame.entered) {
        frame.entered = true
        if (++visits > limits.nodes || depth > limits.depth)
          throw new Error('Projection HTML chunk traversal limit')
        if (progress.step()) yield
        if (node.type === 'text' || node.type === 'raw') {
          const raw =
            (node.type === 'raw' && options.rawHtml) ||
            (parent?.type === 'element' &&
              (parent.tagName === 'script' || parent.tagName === 'style'))
          // The current text/raw frame never needs a shell. With every ancestor open,
          // the helper would only skip that frame and return without yielding.
          if (node.value.length && openedThrough < active - 1) yield* openParents()
          if (raw) yield* output.start(node.value)
          else {
            // Escape only a bounded input; the planner admits expanded output/scratch.
            for (const part of input.start(node.value))
              yield* output.start(toHtml({ type: 'text', value: part }))
          }
          pop()
          continue
        }
        if (node.type === 'root') frame.container = node
        else if (node.type === 'element') {
          frame.childSpace = space === 'html' && node.tagName === 'svg' ? 'svg' : space
          frame.container = space === 'html' && node.tagName === 'template' ? node.content : node
        } else throw new Error('Unsupported projection HTML chunk node')
      }
      if (frame.container && frame.index < frame.container.children.length) {
        const child = frame.container.children[frame.index++]
        if (!child) throw new Error('Unsupported projection HTML chunk node')
        push(child, frame.container, frame.childSpace, depth + 1)
        continue
      }
      pop()
      if (node.type !== 'element') continue
      if (frame.opened) yield* output.start(frame.suffix)
      else {
        // Empty elements still emit a shell. That shell makes every pending ancestor
        // nonempty, even when all of this element's text/raw children were empty.
        yield
        const tags = shell(node, false, space)
        if (openedThrough < active) yield* openParents()
        yield* output.start(tags.prefix)
      }
    }
  } finally {
    stack.length = 0
    input.clear()
    output.clear()
  }
}
