import { expect, it } from 'vitest'
import { diagramSourceLocator } from '../../src/diagram-source'

it('maps duplicate flowchart labels by their authored node declarations', () => {
  const source = 'flowchart LR\nA[Shared] --> B[Shared]\nC((Shared))\nA --> C'
  const locate = diagramSourceLocator(source)
  for (const [id, from] of [
    ['A', source.indexOf('Shared')],
    ['B', source.indexOf('Shared', source.indexOf('Shared') + 1)],
    ['C', source.lastIndexOf('Shared')],
  ] as const) {
    expect(locate('Shared', id)).toEqual({ from, to: from + 6 })
  }
  expect(locate('Shared')).toBeUndefined()
})

it('keeps literal UTF-16 offsets through quoted, Unicode and markdown labels', () => {
  const source = 'flowchart TD\nA["你好😀"]\nB["`**Edit** now`"]'
  const locate = diagramSourceLocator(source)
  for (const label of ['你好😀', 'Edit']) {
    const from = source.indexOf(label)
    expect(locate(label)).toEqual({ from, to: from + label.length })
  }
})

it('ignores comments while retaining percent signs inside quoted labels', () => {
  const source = 'flowchart LR\n%% Done is a comment\nA[Done] --> B["50%% complete"]'
  const locate = diagramSourceLocator(source)
  expect(locate('Done')).toEqual({
    from: source.indexOf('[Done') + 1,
    to: source.indexOf('[Done') + 5,
  })
  expect(locate('50%% complete')?.from).toBe(source.indexOf('50%% complete'))
})

it('maps an unlabelled node to its first reference, excluding other labels and partial IDs', () => {
  const source = 'flowchart LR\nNamed["A"] --> Another\nOther[Hello A]\nAA --> A\nA --> B'
  expect(diagramSourceLocator(source)('A', 'A')?.from).toBe(source.indexOf('AA --> A') + 7)
  const directive = 'flowchart LR; LR --> flowchart'
  const locate = diagramSourceLocator(directive)
  expect(locate('LR', 'LR')?.from).toBe(directive.lastIndexOf('LR'))
  expect(locate('flowchart', 'flowchart')?.from).toBe(directive.lastIndexOf('flowchart'))
})

it('maps unique messages across diagram families without guessing at duplicate messages', () => {
  const source = 'sequenceDiagram\nAlice->>Bob: Hello\nBob->>Alice: Goodbye\nBob->>Alice: Hello'
  const locate = diagramSourceLocator(source)
  expect(locate('Goodbye')?.from).toBe(source.indexOf('Goodbye'))
  expect(locate('Hello')).toBeUndefined()
  expect(locate('Alice')).toBeUndefined()
})

it('rejects absent, empty or oversized labels and bounds repeated searching', () => {
  const source = 'A'.repeat(64 * 1024)
  const locate = diagramSourceLocator(source)
  expect(locate('')).toBeUndefined()
  expect(locate(' '.repeat(10))).toBeUndefined()
  expect(locate('A'.repeat(4097))).toBeUndefined()
  expect(locate('B')).toBeUndefined()
  expect(locate('A')).toBeUndefined()
})

it('indexes all 2000 numbered node labels without repeated source scans', () => {
  const source = `flowchart TD\n${Array.from({ length: 2000 }, (_, at) => `N${at}[Node ${at}]`).join('\n')}`
  const locate = diagramSourceLocator(source)
  for (let at = 0; at < 2000; at++) {
    const label = `Node ${at}`
    const from = source.indexOf(`[${label}]`) + 1
    expect(locate(label, `N${at}`)).toEqual({ from, to: from + label.length })
  }
})
