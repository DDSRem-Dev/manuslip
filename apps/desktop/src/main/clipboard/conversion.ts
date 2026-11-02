import { localImagePath, safeImage, safeLink } from '@manuslip/renderer/urls'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { assetLimits } from '../../shared/asset-contracts'

export function convertHtml(html: string): string {
  if (Buffer.byteLength(html) > assetLimits.html) throw new Error('paste-large')
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  service.use(gfm)
  // GFM's legacy highlighted-block rule uses a fixed fence. Preserve embedded fences.
  service.addRule('highlighted-code-fence', {
    filter: (node) =>
      node.nodeName === 'DIV' &&
      /highlight-(?:text|source)-/.test(node.className) &&
      node.firstChild?.nodeName === 'PRE',
    replacement(_content, node) {
      const code = node.firstChild?.textContent || ''
      const language =
        /highlight-(?:text|source)-([a-z0-9_+-]{1,64})(?:\s|$)/i.exec(node.className)?.[1] || ''
      let length = 3
      for (const match of code.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
      const fence = '`'.repeat(length)
      return `\n\n${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}\n\n`
    },
  })
  service.addRule('table-cell-pipes', {
    filter: ['th', 'td'],
    replacement(content, node) {
      const first = node.parentNode?.firstChild === node
      return `${first ? '| ' : ' '}${content.replace(/\|/g, '\\|').replace(/\n+/g, ' ')} |`
    },
  })
  service.remove((node) =>
    ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT'].includes(
      node.nodeName.toUpperCase(),
    ),
  )
  service.addRule('safe-links', {
    filter: 'a',
    replacement(content, node) {
      const href = node.getAttribute('href') || ''
      const safe = safeLink(href)
      return safe ? `[${content}](<${safe.replace(/>/g, '%3E')}>)` : content
    },
  })
  service.addRule('safe-images', {
    filter: 'img',
    replacement(_content, node) {
      const src = node.getAttribute('src') || ''
      const safe =
        (src.startsWith('data:') ? safeImage(src) : null) ||
        safeLink(src) ||
        (localImagePath(src) ? src : null)
      const alt = service.escape(node.getAttribute('alt') || '')
      return safe && !safe.startsWith('#') ? `![${alt}](<${safe.replace(/>/g, '%3E')}>)` : alt
    },
  })
  const markdown = service.turndown(html)
  if (Buffer.byteLength(markdown) > assetLimits.markdown) throw new Error('paste-large')
  return markdown
}
