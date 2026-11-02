import type { ElementContent, Nodes, Root } from 'hast'
import { toHtml } from 'hast-util-to-html'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { bufferProjectionChunks } from '../../src/projection-chunk-buffer'
import { projectWithHandlers } from '../../src/projection-engine'
import { projectionHtmlChunks } from '../../src/projection-html-chunks'

const limits = { nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
function serialized(root: Nodes, rawHtml = false) {
  const chunks = []
  for (const value of projectionHtmlChunks(root, { rawHtml }, limits)) {
    if (value === undefined) continue
    expect(value.length).toBeGreaterThan(0)
    expect(value.length).toBeLessThanOrEqual(4096)
    chunks.push(value)
  }
  const expected = chunks.join('')
  const buffered = []
  for (const value of bufferProjectionChunks(projectionHtmlChunks(root, { rawHtml }, limits))) {
    if (value === undefined) continue
    expect(value.length).toBeGreaterThan(0)
    expect(value.length).toBeLessThanOrEqual(4097)
    buffered.push(value)
  }
  expect(buffered.join('')).toBe(expected)
  return expected
}
describe('bounded projection HTML spelling', () => {
  it.each(['commonmark', 'manuslip'] as const)(
    'matches every native CommonMark tree in %s and both HTML policies',
    (syntax) => {
      for (const example of examples) {
        const document = parseMarkdown(example.markdown, syntax)
        for (const rawHtml of [false, true]) {
          let hast: Root | undefined
          const expected = projectWithHandlers(
            document.root,
            { ...options, rawHtml },
            undefined,
            (tree) => {
              hast = tree
            },
          )
          if (!hast) throw new Error('Missing native HAST')
          expect(serialized(hast, rawHtml)).toBe(expected.html)
        }
      }
    },
  )
  it.each([false, true])(
    'matches native shells, attributes, templates, SVG, void contents and raw text with rawHtml=%s',
    (rawHtml) => {
      const leaves: ElementContent[] = [
        { type: 'text', value: '' },
        { type: 'raw', value: '' },
        { type: 'text', value: '<&0a;"`\u0000\ud800😀\uffff' },
        { type: 'raw', value: '<i>Raw & text</i>' },
      ]
      for (const tagName of [
        'div',
        'script',
        'style',
        'img',
        'input',
        'br',
        'template',
        'svg',
        'foreignObject',
        '\uffff',
      ]) {
        for (const children of [[], leaves.slice(0, 2), leaves]) {
          const root: Root = {
            type: 'root',
            children: [
              {
                type: 'element',
                tagName,
                properties: {
                  className: ['a', 'b'],
                  title: '"&\u0000`\uffff',
                  hidden: true,
                  dataValue: false,
                },
                children,
                content: { type: 'root', children },
              },
            ],
          }
          expect(serialized(root, rawHtml)).toBe(toHtml(root, { allowDangerousHtml: rawHtml }))
        }
      }
    },
  )
  it('keeps SVG schema across nested shells and template content', () => {
    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'svg',
          properties: { viewBox: '0 0 1 1' },
          children: [
            {
              type: 'element',
              tagName: 'foreignObject',
              properties: { xmlLang: 'en' },
              children: [
                {
                  type: 'element',
                  tagName: 'input',
                  properties: { checked: true },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(serialized(root)).toBe(toHtml(root))
  })
  it.each([false, true])(
    'retains native empty-descendant and nested void lookahead with rawHtml=%s',
    (rawHtml) => {
      for (const leaf of [
        { type: 'text' as const, value: '' },
        { type: 'raw' as const, value: '' },
        { type: 'raw' as const, value: '<&😀' },
        { type: 'element' as const, tagName: 'input', properties: {}, children: [] },
      ]) {
        let child: ElementContent = leaf
        for (const tagName of ['span', 'br', 'template', 'div', 'img', 'svg']) {
          const children: ElementContent[] = [{ type: 'text', value: '' }, child]
          child = {
            type: 'element',
            tagName,
            properties: {},
            children,
            content: { type: 'root', children },
          }
        }
        const root: Root = { type: 'root', children: [child] }
        expect(serialized(root, rawHtml)).toBe(toHtml(root, { allowDangerousHtml: rawHtml }))
      }
    },
  )
  it('cancels pending ancestor shells before serialization and enforces their depth limit', () => {
    let calls = 0
    let child: ElementContent = { type: 'text', value: 'body' }
    for (let depth = 0; depth < 100; depth++)
      child = {
        type: 'element',
        tagName: 'div',
        children: [child],
        get properties() {
          calls++
          return {}
        },
      }
    const root: Root = { type: 'root', children: [child] }
    const work = projectionHtmlChunks(root, options, limits)
    expect(work.next()).toEqual({ done: false, value: undefined })
    work.return(undefined)
    expect(work.next().done).toBe(true)
    expect(calls).toBe(0)
    expect(() => [...projectionHtmlChunks(root, options, { nodes: 1000, depth: 99 })]).toThrow(
      'traversal limit',
    )
    expect(calls).toBe(0)
    expect(serialized(root)).toBe(toHtml(root))
  })
  it('rejects missing children instead of truncating output before later siblings', () => {
    const children = new Array<ElementContent>(2)
    children[1] = { type: 'text', value: 'must not disappear' }
    const root: Root = { type: 'root', children }
    expect(() => serialized(root)).toThrow('Unsupported projection HTML chunk node')
  })
  it.each([false, true])('keeps mixed sibling contexts independent with rawHtml=%s', (rawHtml) => {
    const root: Root = { type: 'root', children: [] }
    for (let index = 0; index < 20; index++)
      root.children.push(
        {
          type: 'element',
          tagName: 'svg',
          properties: { viewBox: '0 0 1 1' },
          children: [
            { type: 'element', tagName: 'path', properties: { strokeWidth: '2' }, children: [] },
          ],
        },
        { type: 'text', value: '<&😀' },
        { type: 'element', tagName: 'p', properties: {}, children: [] },
        {
          type: 'element',
          tagName: 'template',
          properties: {},
          children: [{ type: 'text', value: 'ignored template children' }],
          content: {
            type: 'root',
            children: [
              { type: 'element', tagName: 'br', properties: {}, children: [] },
              { type: 'text', value: '<&' },
            ],
          },
        },
        { type: 'raw', value: '<i>raw & text</i>' },
        { type: 'text', value: '' },
        {
          type: 'element',
          tagName: 'script',
          properties: {},
          children: [{ type: 'text', value: '<&' }],
        },
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'text', value: '<&' }],
        },
      )
    expect(serialized(root, rawHtml)).toBe(toHtml(root, { allowDangerousHtml: rawHtml }))
  })
  it.each([false, true])(
    'preserves boundary escapes, astral/lone surrogates and large values with rawHtml=%s',
    (rawHtml) => {
      for (const type of ['text', 'raw'] as const) {
        for (const tail of ['<&0123abcdef;', '\ud800😀\udc00', '\uffff&<', '"`\u0000']) {
          const root: Root = {
            type: 'root',
            children: [{ type, value: `${'a'.repeat(4095)}${tail}`.repeat(260) }],
          }
          expect(serialized(root, rawHtml)).toBe(toHtml(root, { allowDangerousHtml: rawHtml }))
        }
      }
    },
  )
  it('forwards progress for empty trees and enforces traversal limits', () => {
    const root: Root = {
      type: 'root',
      children: Array.from({ length: 100 }, () => ({ type: 'text', value: '' })),
    }
    expect(
      [...projectionHtmlChunks(root, options, limits)].filter((value) => value === undefined)
        .length,
    ).toBeGreaterThan(0)
    expect(() => [...projectionHtmlChunks(root, options, { nodes: 10, depth: 128 })]).toThrow(
      'traversal limit',
    )
    expect(() => [...projectionHtmlChunks(root, options, { nodes: 1000, depth: 0 })]).toThrow(
      'traversal limit',
    )
    const work = projectionHtmlChunks(root, options, limits)
    expect(work.next().done).toBe(false)
    work.return(undefined)
    expect(work.next().done).toBe(true)
  })
  it.each(['return', 'throw'] as const)(
    'preserves %s while escaping a large text node without visiting later siblings',
    (action) => {
      let laterReads = 0
      const root: Root = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'p',
            properties: {},
            children: [{ type: 'text', value: '&'.repeat(9000) }],
          },
          {
            type: 'element',
            tagName: 'p',
            get properties() {
              laterReads++
              return {}
            },
            children: [],
          },
        ],
      }
      const work = projectionHtmlChunks(root, options, limits)
      let value: string | undefined
      do {
        const next = work.next()
        expect(next.done).toBe(false)
        value = next.value
      } while (!value?.startsWith('&'))
      if (action === 'return')
        expect(work.return('stopped')).toEqual({ value: 'stopped', done: true })
      else {
        const error = new Error('stop this output')
        expect(() => work.throw(error)).toThrow(error)
      }
      expect(work.next().done).toBe(true)
      expect(laterReads).toBe(0)
    },
  )
})
