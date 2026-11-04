const blockElements = new Set([
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'TABLE',
  'UL',
])

/** Preserve prose newlines in owned widget DOM without changing reading/export HTML. */
export function preserveProseLineBreaks(container: HTMLElement): void {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/[\r\n]/.test(node.textContent ?? '')) continue
    const parent = node.parentElement
    if (!parent || parent.closest('pre, code, svg, math, [role="math"]')) continue
    if (!parent.closest('p, h1, h2, h3, h4, h5, h6, li, dt, dd, a')) continue
    // Serializers also put newlines between block elements; those are not prose.
    if (!(node.textContent ?? '').trim()) {
      const structural = (sibling: ChildNode | null): boolean =>
        sibling instanceof Element && blockElements.has(sibling.tagName)
      if (structural(node.previousSibling) || structural(node.nextSibling)) continue
    }
    texts.push(node as Text)
  }
  for (const text of texts) {
    // An explicit hard break already accounts for the following serialized newline.
    const value =
      text.previousSibling?.nodeName === 'BR' ? text.data.replace(/^(?:\r\n|\r|\n)/, '') : text.data
    const fragment = container.ownerDocument.createDocumentFragment()
    for (const [index, line] of value.split(/\r\n|\r|\n/).entries()) {
      if (index) {
        const br = container.ownerDocument.createElement('br')
        br.dataset.sourceBreak = ''
        fragment.append(br)
      }
      fragment.append(container.ownerDocument.createTextNode(line))
    }
    text.replaceWith(fragment)
  }
}
