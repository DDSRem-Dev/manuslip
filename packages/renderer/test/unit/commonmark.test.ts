import { parseMarkdown } from '@manuslip/core'
import type { Nodes } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { toHast } from 'mdast-util-to-hast'
import { describe, expect, it } from 'vitest'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { renderMarkdown } from '../../src/index'

// Ignore serializer choices (void-element slash, entities, and inter-block newlines).
// Text inside pre/script/style and meaningful inline whitespace stays exact.
function normalize(node: Nodes, literal = false, application = false): unknown {
  if (node.type === 'text') return !literal && /^\s*\n\s*$/.test(node.value) ? null : node.value
  if ('children' in node) {
    const pre =
      literal || (node.type === 'element' && ['pre', 'script', 'style'].includes(node.tagName))
    return {
      ...(node.type === 'element'
        ? {
            tag: node.tagName,
            // Navigation and image loading follow application policy, tested separately.
            properties: Object.fromEntries(
              Object.entries(node.properties).filter(
                ([key]) =>
                  !application ||
                  ![
                    'href',
                    'src',
                    'loading',
                    'referrerPolicy',
                    'dataRemoteImage',
                    'dataLocalImage',
                  ].includes(key),
              ),
            ),
          }
        : {}),
      children: node.children
        .map((child) => normalize(child, pre, application))
        .filter((child) => child !== null),
    }
  }
  return node.type === 'comment' ? { comment: node.value } : node.type
}
const htmlTree = (html: string, application = false): unknown =>
  normalize(fromHtml(`${html.trimEnd()}\n`, { fragment: true }), false, application)

describe('CommonMark 0.31.2 official examples (before application security policy)', () => {
  it.each(examples)('$example: $section', (example) => {
    const document = parseMarkdown(example.markdown, 'commonmark')
    const actual = toHtml(toHast(document.root, { allowDangerousHtml: true }), {
      allowDangerousHtml: true,
    })
    expect(htmlTree(actual)).toEqual(htmlTree(example.html))
  })
})

describe('application renderer preserves CommonMark 0.31.2 structure and literal content', () => {
  it.each(examples)('$example: $section', (example) => {
    const document = parseMarkdown(example.markdown, 'commonmark')
    const actual = renderMarkdown(document.root, {
      rawHtml: true,
      footnotesLabel: 'Footnotes',
      footnoteBackLabel: 'Back',
    })
    expect(htmlTree(actual.html, true)).toEqual(htmlTree(example.html, true))
  })
})
