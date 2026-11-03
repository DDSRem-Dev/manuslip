import createDOMPurify, { type Config, type WindowLike } from 'dompurify'
import { imageSizingStyle } from './image-layout'
import { localImagePath, safeImage, safeLink } from './urls'

const tags = [
  'p',
  'div',
  'span',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  'ins',
  'del',
  's',
  'abbr',
  'cite',
  'q',
  'dfn',
  'samp',
  'var',
  'ruby',
  'rt',
  'rp',
  'bdi',
  'bdo',
  'wbr',
  'time',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'input',
  'sup',
  'sub',
  'section',
  'article',
  'aside',
  'address',
  'figure',
  'figcaption',
  'nav',
  'dl',
  'dt',
  'dd',
  'kbd',
  'mark',
]
const attributes = [
  'class',
  'id',
  'href',
  'src',
  'alt',
  'title',
  'width',
  'height',
  'style',
  'colspan',
  'rowspan',
  'span',
  'scope',
  'headers',
  'align',
  'start',
  'reversed',
  'value',
  'cite',
  'datetime',
  'type',
  'checked',
  'disabled',
  'loading',
  'referrerpolicy',
  'role',
  'aria-label',
  'aria-describedby',
  'lang',
  'dir',
  'data-remote-image',
  'data-local-image',
  'data-footnote-ref',
  'data-footnote-backref',
]
// These are SVG geometry/presentation values, not navigation URLs. A fragment-only URI
// policy would otherwise discard paths, coordinates and transforms as well as URLs.
const svgValues = [
  'viewBox',
  'width',
  'height',
  'd',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'rx',
  'ry',
  'r',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'color',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'clip-path',
  'preserveAspectRatio',
  'textLength',
  'lengthAdjust',
  'dy',
  'dx',
]
let diagramSequence = 0

/** Scope each complete reading column after sanitizing, including IDs from optional raw HTML. */
export function scopeReadingReferences(container: ParentNode): void {
  for (const side of ['original', 'translation']) {
    const selector = '.reading-original, .reading-translation'
    const cells = [...container.querySelectorAll<HTMLElement>(`.reading-${side}`)].filter(
      (cell) => !cell.parentElement?.closest(selector),
    )
    const prefix = `reading-${crypto.randomUUID()}-`
    const ids = new Map<string, string>()
    for (const cell of cells)
      for (const element of cell.querySelectorAll<HTMLElement>('[id]')) {
        const id = element.id
        const scoped = prefix + id
        if (!ids.has(id)) ids.set(id, scoped)
        element.id = scoped
      }
    for (const cell of cells)
      for (const element of cell.querySelectorAll(
        '[href], [aria-describedby], [aria-labelledby], [headers]',
      )) {
        const href = element.getAttribute('href')
        if (href?.startsWith('#')) {
          try {
            const target = ids.get(href.slice(1)) ?? ids.get(decodeURIComponent(href.slice(1)))
            if (target) element.setAttribute('href', `#${target}`)
          } catch {}
        }
        for (const attribute of ['aria-describedby', 'aria-labelledby', 'headers']) {
          const value = element.getAttribute(attribute)
          if (value)
            element.setAttribute(
              attribute,
              value
                .split(/\s+/)
                .map((id) => ids.get(id) ?? id)
                .join(' '),
            )
        }
      }
  }
}

export function createSanitizer(window: WindowLike): {
  markdown(html: string, exportSlots?: boolean): DocumentFragment
  svg(html: string): DocumentFragment
  diagram(html: string): DocumentFragment
} {
  const purifier = createDOMPurify(window)
  const sanitize = (html: string, config: Config): DocumentFragment => {
    try {
      return purifier.sanitize(html, { ...config, RETURN_DOM_FRAGMENT: true })
    } finally {
      // Removal diagnostics contain live nodes/attributes. Once a fragment is mounted,
      // they can retain its whole editor DOM after teardown; no consumer uses them.
      purifier.removed.length = 0
    }
  }
  let svg = false
  purifier.addHook('uponSanitizeAttribute', (node, event) => {
    if (!svg && event.attrName === 'style') {
      event.attrValue = node.nodeName === 'IMG' ? imageSizingStyle(event.attrValue) : ''
      if (!event.attrValue) event.keepAttr = false
    }
    if (!svg && event.attrName === 'value') {
      if (node.tagName !== 'LI' || !/^-?[0-9]{1,6}$/.test(event.attrValue)) event.keepAttr = false
    }
    if (!svg && ['width', 'height'].includes(event.attrName)) {
      if (
        node.nodeName !== 'IMG' ||
        !/^\d{1,5}$/.test(event.attrValue) ||
        Number(event.attrValue) > 32768 ||
        Number(event.attrValue) === 0
      )
        event.keepAttr = false
    }
    if (
      svg &&
      ['fill', 'stroke'].includes(event.attrName) &&
      /url\s*\(/i.test(event.attrValue) &&
      !/^url\(#[a-z0-9_-]+\)$/i.test(event.attrValue)
    )
      event.keepAttr = false
    if (event.attrName === 'src') {
      const image = safeImage(event.attrValue)
      if (!image) {
        const remote = safeLink(event.attrValue)
        if (!svg && remote?.startsWith('https:')) node.setAttribute('data-remote-image', remote)
        else if (!svg && localImagePath(event.attrValue))
          node.setAttribute('data-local-image', event.attrValue)
        event.keepAttr = false
      }
    }
    if (event.attrName === 'href' || event.attrName === 'xlink:href') {
      if (svg ? !/^#[a-z0-9_-]+$/i.test(event.attrValue) : !safeLink(event.attrValue))
        event.keepAttr = false
    }
    if (!svg && event.attrName === 'cite' && !safeLink(event.attrValue)) event.keepAttr = false
    if (event.attrName === 'data-remote-image' && !safeLink(event.attrValue)?.startsWith('https:'))
      event.keepAttr = false
    if (event.attrName === 'data-local-image' && !localImagePath(event.attrValue))
      event.keepAttr = false
  })
  const markdownConfig: Config = {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: attributes,
    ALLOW_DATA_ATTR: false,
    // The hook validates the dormant image reference. Alignment, list starts and
    // language/type metadata must survive the restrictive navigation URI policy.
    ADD_URI_SAFE_ATTR: [
      'data-local-image',
      'type',
      'lang',
      'dir',
      'start',
      'value',
      'align',
      'width',
      'height',
      'style',
      'headers',
      'datetime',
      'colspan',
      'rowspan',
      'span',
      'scope',
      'reversed',
    ],
    RETURN_DOM_FRAGMENT: true,
    SANITIZE_NAMED_PROPS: true,
    ALLOWED_URI_REGEXP: /^(?:https:|manuslip-asset:|data:image\/|#)/i,
  }
  return {
    diagram(html) {
      svg = true
      const fragment = sanitize(html, {
        ALLOWED_TAGS: [
          'svg',
          'g',
          'path',
          'defs',
          'use',
          'text',
          'tspan',
          'rect',
          'line',
          'polyline',
          'polygon',
          'circle',
          'ellipse',
          'title',
          'desc',
          'marker',
          'clipPath',
        ],
        ALLOWED_ATTR: [
          'xmlns',
          'viewBox',
          'width',
          'height',
          'd',
          'transform',
          'x',
          'y',
          'x1',
          'y1',
          'x2',
          'y2',
          'cx',
          'cy',
          'rx',
          'ry',
          'r',
          'points',
          'id',
          'href',
          'xlink:href',
          'fill',
          'stroke',
          'stroke-width',
          'stroke-dasharray',
          'stroke-linecap',
          'stroke-linejoin',
          'fill-opacity',
          'stroke-opacity',
          'opacity',
          'font-size',
          'font-family',
          'font-weight',
          'font-style',
          'text-anchor',
          'dominant-baseline',
          'paint-order',
          'color',
          'marker-start',
          'marker-mid',
          'marker-end',
          'markerWidth',
          'markerHeight',
          'markerUnits',
          'refX',
          'refY',
          'orient',
          'clip-path',
          'preserveAspectRatio',
          'textLength',
          'lengthAdjust',
          'dy',
          'dx',
          'aria-hidden',
          'role',
          'aria-label',
        ],
        ALLOW_DATA_ATTR: false,
        ADD_URI_SAFE_ATTR: svgValues,
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_URI_REGEXP: /^#[a-z0-9_-]+$/i,
      })
      for (const element of fragment.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
          if (
            ['href', 'xlink:href'].includes(attribute.name) &&
            !/^#[a-z0-9_-]+$/i.test(attribute.value)
          )
            element.removeAttribute(attribute.name)
          if (
            /(?:url\s*\(|@import|expression|javascript:|data:|https?:|file:|\\|[<>])/i.test(
              attribute.value,
            ) &&
            !/^url\(#[a-z0-9_-]+\)$/i.test(attribute.value)
          )
            element.removeAttribute(attribute.name)
        }
      }
      // Cached output can appear more than once. Keep every reference inside its
      // own SVG and give each mounted copy distinct identifiers.
      const prefix = `manuslip-diagram-${++diagramSequence}-`
      const ids = new Map<string, string>()
      for (const element of fragment.querySelectorAll('[id]')) {
        const old = element.getAttribute('id') || ''
        const id = `${prefix}${ids.size}`
        if (ids.has(old)) element.removeAttribute('id')
        else {
          ids.set(old, id)
          element.setAttribute('id', id)
        }
      }
      for (const element of fragment.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
          const reference = /^(?:#([a-z0-9_-]+)|url\(#([a-z0-9_-]+)\))$/i.exec(attribute.value)
          if (!reference || attribute.name === 'id') continue
          const id = ids.get(reference[1] || reference[2] || '')
          if (id) element.setAttribute(attribute.name, reference[1] ? `#${id}` : `url(#${id})`)
          else if (
            [
              'href',
              'xlink:href',
              'clip-path',
              'marker-start',
              'marker-mid',
              'marker-end',
              'fill',
              'stroke',
            ].includes(attribute.name) &&
            attribute.value.startsWith('url(')
          )
            element.removeAttribute(attribute.name)
          else if (['href', 'xlink:href'].includes(attribute.name))
            element.removeAttribute(attribute.name)
        }
      }
      return fragment
    },
    markdown(html, exportSlots = false) {
      svg = false
      const fragment = sanitize(html, {
        ...markdownConfig,
        ...(exportSlots
          ? {
              ADD_ATTR: ['data-export-slot', 'data-reading-block'],
              ADD_URI_SAFE_ATTR: [
                ...(markdownConfig.ADD_URI_SAFE_ATTR ?? []),
                'data-export-slot',
                'data-reading-block',
              ],
            }
          : {}),
        RETURN_DOM_FRAGMENT: true,
      })
      for (const input of fragment.querySelectorAll('input')) {
        if (input.getAttribute('type') !== 'checkbox') input.remove()
        else input.disabled = true
      }
      // Mirror DOMPurify's idempotent named-property prefix, including mdast footnotes.
      const named = (id: string) => (id.startsWith('user-content-') ? id : `user-content-${id}`)
      for (const anchor of fragment.querySelectorAll('a[href^="#"]')) {
        const href = anchor.getAttribute('href') ?? ''
        // Generated footnote IDs contain literal percent escapes. Keep their spelling;
        // ordinary raw HTML fragments continue to resolve URL-encoded identifiers.
        try {
          const id =
            anchor.hasAttribute('data-footnote-ref') || anchor.hasAttribute('data-footnote-backref')
              ? href.slice(1)
              : decodeURIComponent(href.slice(1))
          anchor.setAttribute('href', `#${named(id)}`)
        } catch {}
      }
      for (const element of fragment.querySelectorAll(
        '[aria-describedby], [aria-labelledby], [headers]',
      ))
        for (const attribute of ['aria-describedby', 'aria-labelledby', 'headers']) {
          const value = element.getAttribute(attribute)
          if (value) element.setAttribute(attribute, value.split(/\s+/).map(named).join(' '))
        }
      return fragment
    },
    svg(html) {
      svg = true
      return sanitize(html, {
        ALLOWED_TAGS: [
          'svg',
          'g',
          'path',
          'defs',
          'use',
          'text',
          'rect',
          'line',
          'polyline',
          'polygon',
          'circle',
          'ellipse',
          'title',
          'desc',
        ],
        ALLOWED_ATTR: [
          'xmlns',
          'viewBox',
          'width',
          'height',
          'd',
          'fill',
          'stroke',
          'stroke-width',
          'transform',
          'x',
          'y',
          'x1',
          'x2',
          'y1',
          'y2',
          'cx',
          'cy',
          'r',
          'rx',
          'ry',
          'points',
          'id',
          'href',
          'xlink:href',
          'aria-hidden',
          'role',
          'focusable',
        ],
        ALLOW_DATA_ATTR: false,
        ADD_URI_SAFE_ATTR: svgValues,
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_URI_REGEXP: /^#[a-z0-9_-]+$/i,
      })
    },
  }
}
