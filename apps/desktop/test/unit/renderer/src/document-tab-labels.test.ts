import { describe, expect, it } from 'vitest'
import { documentTabLabels } from '../../../../src/renderer/src/document-tab-labels'

function labels(paths: readonly string[]) {
  return [
    ...documentTabLabels(
      paths.map((path, index) => ({
        id: String(index),
        title: path.split(/[\\/]/).at(-1) ?? '',
        path,
      })),
    ).values(),
  ]
}

describe('document tab labels', () => {
  it('keeps distinct filenames and numbered drafts concise', () => {
    const documents = [
      { id: 'a', title: 'notes.md', path: '/book/notes.md' },
      { id: 'b', title: 'chapter.md', path: '/book/chapter.md' },
      { id: 'c', title: 'Untitled 1', path: null },
      { id: 'd', title: 'Untitled 2', path: null },
    ]
    expect([...documentTabLabels(documents).values()]).toEqual(
      documents.map((document) => ({
        title: document.title,
        context: null,
        label: document.title,
      })),
    )
  })

  it.each([
    { paths: ['/book/drafts/notes.md', '/book/archive/notes.md'], context: ['drafts', 'archive'] },
    {
      paths: ['/book/first/drafts/notes.md', '/book/second/drafts/notes.md'],
      context: ['first/drafts', 'second/drafts'],
    },
    {
      paths: ['/book/drafts/notes.md', '/book/next/drafts/notes.md'],
      context: ['drafts', 'next/drafts'],
    },
    { paths: ['/notes.md', '/book/notes.md'], context: ['/', 'book'] },
    {
      paths: ['C:\\book\\drafts\\notes.md', 'C:\\book\\archive\\notes.md'],
      context: ['drafts', 'archive'],
    },
    { paths: ['C:\\notes.md', 'D:\\notes.md'], context: ['C:', 'D:'] },
    {
      paths: ['\\\\first\\share\\notes.md', '\\\\second\\share\\notes.md'],
      context: ['first/share', 'second/share'],
    },
    { paths: ['/كتاب/مسودة/笔记.md', '/كتاب/归档/笔记.md'], context: ['مسودة', '归档'] },
  ])('distinguishes owned paths with $context', ({ paths, context }) => {
    const actual = labels(paths)
    expect(actual.map((label) => label.context)).toEqual(context)
    expect(new Set(actual.map((label) => label.label)).size).toBe(paths.length)
    expect(labels([...paths].reverse()).map((label) => label.label)).toEqual(
      actual.map((label) => label.label).reverse(),
    )
  })

  it('qualifies a saved filename that collides with an unsaved draft label', () => {
    expect(
      [
        ...documentTabLabels([
          { id: 'draft', title: 'Untitled 1', path: null },
          { id: 'file', title: 'Untitled 1', path: '/book/Untitled 1' },
        ]).values(),
      ].map((label) => label.label),
    ).toEqual(['Untitled 1', 'Untitled 1 — book'])
  })

  it('removes obsolete context when the colliding document is closed or renamed', () => {
    const paths = ['/book/drafts/notes.md', '/book/archive/notes.md']
    expect(labels(paths).map((label) => label.context)).toEqual(['drafts', 'archive'])
    expect(labels(paths.slice(0, 1)).map((label) => label.label)).toEqual(['notes.md'])
    expect(
      labels([paths[0] ?? '', '/book/archive/chapter.md']).map((label) => label.label),
    ).toEqual(['notes.md', 'chapter.md'])
  })
})
