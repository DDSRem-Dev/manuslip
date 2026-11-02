import type { Nodes, Root } from 'mdast'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../../renderer/src/index'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedSession } from '../../src/packing-session'
import type { PackedIdentity } from '../../src/packing-source'
import type { PackedPath } from '../../src/packing-view'
import { parseMarkdown } from '../../src/parse'
import { type DependencyLimits, SemanticDependencies } from '../../src/semantic-dependencies'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits: DependencyLimits = { retained: 8 * MiB, staging: MiB, nodes: 800000, depth: 128 }
const identity = (source: string): PackedIdentity => ({
  generation: 1,
  documentId: 'dependencies',
  revision: 0,
  sourceHash: sourceHash(source),
  parserVersion: 'test-parser',
  rendererVersion: 'test-renderer',
  options: 'test-options',
})
function session(source: string, value: unknown, readers = 256) {
  const owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 16 * MiB,
    staging: 8 * MiB,
    captures: 4,
    readers,
  })
  const result = identity(source)
  const request = owner.begin(result, source)
  owner.commit(owner.prepareFull(request, result, packValue(value, 8 * MiB)))
  return owner
}
function build(
  source: string,
  changed: Partial<DependencyLimits> = {},
  syntax: 'manuslip' | 'commonmark' = 'manuslip',
) {
  const document = parseMarkdown(source, syntax)
  const owner = session(source, { document })
  const capture = owner.capture()
  try {
    const index = SemanticDependencies.build(capture, source, ['document', 'root'], {
      ...limits,
      ...changed,
    })
    expect(owner.stats.readers).toBe(0)
    return { index, document }
  } finally {
    capture.release()
    owner.dispose()
  }
}
function nativeDependencies(root: Root) {
  const definitions: Extract<Nodes, { type: 'definition' | 'footnoteDefinition' }>[] = []
  const references: Extract<
    Nodes,
    { type: 'linkReference' | 'imageReference' | 'footnoteReference' }
  >[] = []
  const walk = (node: Nodes) => {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') definitions.push(node)
    if (
      node.type === 'linkReference' ||
      node.type === 'imageReference' ||
      node.type === 'footnoteReference'
    )
      references.push(node)
    if ('children' in node) for (const child of node.children) walk(child)
  }
  walk(root)
  return { definitions, references }
}
function compareDependencies(index: SemanticDependencies, root: Root) {
  const native = nativeDependencies(root)
  expect(index.definitions).toEqual(
    native.definitions.map((node, position) => ({
      from: node.position?.start.offset,
      to: node.position?.end.offset,
      kind: node.type === 'definition' ? 'link' : 'footnote',
      key: node.identifier.toUpperCase(),
      block: root.children.findIndex(
        (block) =>
          (block.position?.start.offset ?? Infinity) <= (node.position?.start.offset ?? 0) &&
          (block.position?.end.offset ?? -1) >= (node.position?.end.offset ?? 0),
      ),
      selected:
        native.definitions.findIndex(
          (definition) =>
            definition.type === node.type &&
            definition.identifier.toUpperCase() === node.identifier.toUpperCase(),
        ) === position,
    })),
  )
  expect(index.references.map(({ from, to, key }) => ({ from, to, key }))).toEqual(
    native.references.map((node) => ({
      from: node.position?.start.offset,
      to: node.position?.end.offset,
      key: node.identifier.toUpperCase(),
    })),
  )
  for (const reference of index.references) {
    const definition = index.definitions.at(reference.definition)
    expect(definition?.selected).toBe(true)
    expect(definition?.key).toBe(reference.key)
    expect(definition?.kind).toBe(reference.kind === 'footnote' ? 'footnote' : 'link')
  }
}
const cases = [
  '',
  '  \r\n\t\r\n',
  '[one][r] ![image][R] [r][] [r]\n\n[r]: /first "Title"\n[r]: /ignored\n',
  '[a b] [a  b][] [display][A\tB]\n\n[a b]: /space\n',
  '[straße] [ﬃ] [世界] [A&amp;B]\n\n[STRASSE]: /s\n[ffi]: /f\n[世界]: /c\n[A&B]: /amp\n',
  '> [quote][r]\n>\n> [r]: /nested\n\n- [list][r]\n\n[r]: /later\n',
  '[unresolved] ![unresolved image] and `[^code] [code]`\n\n```md\n[r]: /code\n```\n',
  'Call[^b], again[^b], other[^a].\n\n[^a]: Alpha\n[^b]: Bravo\n',
  'Call[^a].\n\n[^a]: Uses [^b] and [^a].\n[^b]: Uses [^c].\n[^c]: Uses [^b].\n',
  '[^unused]: Never rendered [^u2].\n[^u2]: Also unused.\n\nBody[^used].\n\n[^used]: First.\n[^used]: Ignored [^u2].\n',
  'Body[^x].\n\n[^x]: Has [link][r], ![image][r] and [^y].\n\n[^y]: Other.\n\n[r]: /url\n',
  '---\ntitle: "[r] [^x]"\n---\n\n| A | B |\n| - | - |\n| [r] | [^x] |\n\n[r]: /r\n[^x]: Note\n',
  '# Heading 😀 [r]\r\n\r\n> 中文 [^x]\r\n\r\n[r]: /unicode\r\n[^x]: 注释\r\n',
]

describe('whole-document semantic dependency index', () => {
  it('traverses native GFM synthetic text and links without inventing independent source ranges', () => {
    const source = '# Heading\n\n<foo\\+@bar.example.com>\n\n[r]: /target\n'
    const { document, index } = build(source)
    let nodes = 0
    let synthetic = 0
    const visit = (node: Nodes) => {
      nodes++
      if (!node.position) {
        expect(['text', 'link']).toContain(node.type)
        synthetic++
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(document.root)
    expect(synthetic).toBeGreaterThan(0)
    expect(index.nodes).toBe(nodes)
    expect(index.blocks.length).toBe(document.root.children.length)
    expect(index.disjointBlocks).toBe(true)
    compareDependencies(index, document.root)
  })

  it.each(cases)(
    'matches complete parser ranges and actual renderer footnote calls: %j',
    (source) => {
      const { index, document } = build(source)
      expect(index.blocks.map(({ from, to, type }) => ({ from, to, type }))).toEqual(
        document.root.children.map((node) => ({
          from: node.position?.start.offset,
          to: node.position?.end.offset,
          type: node.type,
        })),
      )
      compareDependencies(index, document.root)
      const html = renderMarkdown(document.root, {
        rawHtml: false,
        footnotesLabel: 'Notes',
        footnoteBackLabel: 'Back',
      }).html
      const renderedCalls = [...html.matchAll(/<a\b[^>]*data-footnote-ref[^>]*>(\d+)<\/a>/g)]
      expect(index.calls.map((call) => call.number)).toEqual(
        renderedCalls.map((match) => Number(match[1])),
      )
      expect(index.calls.map((call) => call.occurrence)).toEqual(
        renderedCalls.map((match) => Number(/id="[^"]*-(\d+)"/.exec(match[0])?.[1] ?? 1)),
      )
      expect(index.retainedBytes).toBeLessThanOrEqual(limits.retained)
      expect(index.stagingBytes).toBeLessThanOrEqual(limits.staging)
      index.assertBase(identity(source), source)
    },
  )

  it('selects the first duplicate and keeps main-body calls ahead of definition-body calls', () => {
    const source =
      'First[^a], then[^b].\n\n[^a]: Mentions [^c].\n[^b]: B\n[^c]: C\n\n[r]: /one\n[r]: /two\n'
    const { index } = build(source)
    expect(index.resolve('link', 'R')).toMatchObject({ selected: true })
    const selected = index.resolve('link', 'R')
    expect(source.slice(selected?.from, selected?.to)).toBe('[r]: /one')
    expect(
      index.definitions.filter((definition) => definition.kind === 'link').map((d) => d.selected),
    ).toEqual([true, false])
    expect(index.footnoteOrder.map((definition) => index.definitions.at(definition)?.key)).toEqual([
      'A',
      'B',
      'C',
    ])
    expect(index.calls.map((call) => call.number)).toEqual([1, 2, 3])
    expect(index.resolve('link', 'r')).toBeUndefined() // API accepts renderer keys, not raw labels.
  })

  for (const example of examples.filter((example) =>
    [
      'Links',
      'Images',
      'Link reference definitions',
      'Entity and numeric character references',
    ].includes(example.section),
  ))
    it(`preserves CommonMark context ${example.example}: ${example.section}`, () => {
      const { index, document } = build(example.markdown, {}, 'commonmark')
      compareDependencies(index, document.root)
    })

  it('rebuilds reference resolution and footnote numbering after independent complete edits', () => {
    const original = 'One [r], note[^a], note[^b].\n\n[r]: /first\n[r]: /second\n[^a]: A\n[^b]: B\n'
    const before = build(original).index
    const edited = original
      .replace('[r]: /first\n', '')
      .replace('note[^a], note[^b]', 'note[^b], note[^a]')
    const after = build(edited).index
    expect(original.slice(before.resolve('link', 'R')?.from, before.resolve('link', 'R')?.to)).toBe(
      '[r]: /first',
    )
    expect(edited.slice(after.resolve('link', 'R')?.from, after.resolve('link', 'R')?.to)).toBe(
      '[r]: /second',
    )
    expect(before.footnoteOrder.map((d) => before.definitions.at(d)?.key)).toEqual(['A', 'B'])
    expect(after.footnoteOrder.map((d) => after.definitions.at(d)?.key)).toEqual(['B', 'A'])
    expect(() => before.assertBase(identity(original), edited)).toThrow('base mismatch')
    before.assertBase(identity(original), original)
  })

  it('binds every identity field and exact source, independently of its hash', () => {
    const source = 'Literal [undefined] text.'
    const { index } = build(source)
    for (const key of Object.keys(index.identity) as (keyof PackedIdentity)[]) {
      const value = index.identity[key]
      expect(() =>
        index.assertBase(
          { ...index.identity, [key]: typeof value === 'number' ? value + 1 : `${value}!` },
          source,
        ),
      ).toThrow('base mismatch')
    }
    expect(() =>
      index.assertBase(index.identity, 'Different source with the unchanged identity'),
    ).toThrow('base mismatch')
    expect(index.references).toEqual([])
    expect(index.blocks.at(0)?.brackets).toBe(true) // Unresolved syntax is not treated as context-free prose.
  })

  it('preserves upstream overlapping definition/setext ranges and marks ambiguous boundaries', () => {
    const source = '[foo]: /url\nbar\n===\n[foo]\n'
    const { index, document } = build(source, {}, 'commonmark')
    compareDependencies(index, document.root)
    expect(index.blocks.at(0)?.from).toBe(0)
    expect(index.blocks.at(1)?.from).toBe(0)
    expect(index.disjointBlocks).toBe(false)
    expect(build('Separate.\n\nParagraph.').index.disjointBlocks).toBe(true)
  })

  it('retains independent immutable metadata after its capture and owner are disposed', () => {
    const source = '[r]\n\n[r]: /r\n'
    const { index } = build(source)
    for (const value of [
      index,
      index.identity,
      index.blocks,
      index.blocks.at(0),
      index.definitions,
      index.definitions.at(0),
      index.references,
      index.references.at(0),
      index.calls,
      index.footnoteOrder,
    ])
      expect(Object.isFrozen(value)).toBe(true)
    expect(() => Reflect.set(index.references.at(0) as object, 'from', 99)).not.toThrow()
    expect(index.references.at(0)?.from).toBe(0)
    index.assertBase(identity(source), source)
  })

  it('uses the selected grammar and supports a direct root path', () => {
    const source = 'Call[^a].\n\n[^a]: Footnote\n'
    expect(build(source).index.calls).toHaveLength(1)
    expect(build(source, {}, 'commonmark').index.calls).toHaveLength(0)
    const owner = session(source, parseMarkdown(source).root)
    const capture = owner.capture()
    expect(SemanticDependencies.build(capture, source, [], limits).calls).toHaveLength(1)
    capture.release()
    owner.dispose()
  })

  it.each(['', 'Plain body.', '[r]\n\n[r]: /r\n', 'Call[^a] [r].\n\n[^a]: [^a]\n[r]: /r\n'])(
    'admits exact retained and staging boundaries without truncating: %j',
    (source) => {
      const { index } = build(source)
      expect(build(source, { retained: index.retainedBytes }).index.references).toEqual(
        index.references,
      )
      expect(() => build(source, { retained: index.retainedBytes - 1 })).toThrow('retained limit')
      expect(build(source, { staging: index.stagingBytes }).index.calls).toEqual(index.calls)
      expect(() => build(source, { staging: index.stagingBytes - 1 })).toThrow('staging limit')
      expect(build(source, { nodes: index.nodes }).index.nodes).toBe(index.nodes)
      expect(() => build(source, { nodes: index.nodes - 1 })).toThrow('node limit')
    },
  )

  it('closes every borrowed iterator on node, depth, staging and retained rejection', () => {
    const source = '> > > Deep [r].\n\n[r]: /r\n'
    const owner = session(source, parseMarkdown(source).root)
    const capture = owner.capture()
    const before = owner.stats.retainedBytes
    for (const changed of [{ nodes: 3 }, { depth: 2 }, { staging: 3000 }, { retained: 2400 }]) {
      expect(() =>
        SemanticDependencies.build(capture, source, [], { ...limits, ...changed }),
      ).toThrow()
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.retainedBytes).toBe(before)
    }
    expect(SemanticDependencies.build(capture, source, [], limits).references).toHaveLength(1)
    capture.release()
    expect(() => SemanticDependencies.build(capture, source, [], limits)).toThrow('released')
    owner.dispose()
  })

  it('releases traversal scopes when the session reader cap rejects a deeper child', () => {
    const source = '> > Nested [r].\n\n[r]: /r\n'
    const owner = session(source, parseMarkdown(source).root, 1)
    const capture = owner.capture()
    const before = owner.stats.retainedBytes
    expect(() => SemanticDependencies.build(capture, source, [], limits)).toThrow(
      'reader scope limit',
    )
    expect(owner.stats.readers).toBe(0)
    expect(owner.stats.retainedBytes).toBe(before)
    capture.release()
    owner.dispose()
  })

  it('rejects incomplete/malformed roots, escaping ranges and unresolved semantic records', () => {
    const source = 'Body [r].\n\n[r]: /r\n'
    const original = parseMarkdown(source).root
    const changed = (mutate: (root: Root) => void) => {
      const root = structuredClone(original)
      mutate(root)
      return root
    }
    const roots = [
      changed((root) => {
        if (root.position) root.position.end.offset = source.length - 1
      }),
      changed((root) => {
        if (root.children[0]?.position) root.children[0].position.end.offset = source.length + 1
      }),
      changed((root) => {
        if (root.position) root.position.start.offset = 1
      }),
      changed((root) => {
        root.children = root.children.filter((node) => node.type !== 'definition')
      }),
      changed((root) => {
        delete root.children[0]?.position
      }),
      changed((root) => {
        const paragraph = root.children[0]
        if (paragraph?.type === 'paragraph')
          delete paragraph.children.find((node) => node.type === 'linkReference')?.position
      }),
      changed((root) => {
        delete root.children.find((node) => node.type === 'definition')?.position
      }),
    ]
    for (const root of roots) {
      const owner = session(source, root)
      const capture = owner.capture()
      expect(() => SemanticDependencies.build(capture, source, [], limits)).toThrow()
      expect(owner.stats.readers).toBe(0)
      capture.release()
      owner.dispose()
    }
  })

  it('rejects source mismatch and invalid limits before opening borrowed iterators', () => {
    const source = 'body'
    const owner = session(source, parseMarkdown(source).root)
    const capture = owner.capture()
    expect(() => SemanticDependencies.build(capture, 'different', [], limits)).toThrow('identity')
    for (const key of Object.keys(limits) as (keyof DependencyLimits)[])
      for (const value of [undefined, -1, NaN, Infinity, 0.5])
        expect(() =>
          SemanticDependencies.build(capture, source, [], {
            ...limits,
            [key]: value,
          } as DependencyLimits),
        ).toThrow('limits')
    for (const changed of [
      { retained: 17 * MiB },
      { staging: 9 * MiB },
      { nodes: 800001 },
      { depth: 257 },
    ])
      expect(() =>
        SemanticDependencies.build(capture, source, [], { ...limits, ...changed }),
      ).toThrow('limits')
    for (const path of [[-1], [NaN], ['x'.repeat(257)], Array(65).fill('a')] as PackedPath[])
      expect(() => SemanticDependencies.build(capture, source, path, limits)).toThrow('root path')
    expect(owner.stats.readers).toBe(0)
    capture.release()
    owner.dispose()
  })
})
