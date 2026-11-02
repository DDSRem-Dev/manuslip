import type { ElementContent, Root as HastRoot, Nodes } from 'hast'
import * as html from 'hast-util-to-html'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import { type RenderOptions, rendererVersion } from '../../src/index'
import { inspectPackedProjectionOutput } from '../../src/packed-projection-output'
import * as engine from '../../src/projection-engine'
import * as planner from '../../src/projection-serialization-plan'
import { ProjectionTraversalBudget } from '../../src/projection-traversal-budget'

vi.mock('hast-util-to-html', { spy: true })
vi.mock('../../src/projection-engine', { spy: true })
vi.mock('../../src/projection-serialization-plan', { spy: true })

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options: RenderOptions = {
  rawHtml: false,
  footnotesLabel: 'Notes',
  footnoteBackLabel: 'Back',
}

function fixture(text: string) {
  const document = parseMarkdown(text)
  const source = new PackedSource(
    {
      generation: 1,
      revision: 0,
      documentId: 'traversal',
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession({
    ...limits,
    retained: 64 * MiB,
    bytes: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(source),
      source.identity,
      packValue({ root: document.root }, limits.staging),
    ),
  )
  return { owner, source, capture: owner.capture() }
}

function observedPlan(root: HastRoot, cancel = false, rawHtml = false, policy = false) {
  let active = false,
    scans = 0,
    totalScans = 0,
    units = 0,
    totalUnits = 0,
    advances = 0
  const visited = new Set<Nodes>()
  const wrap = (node: Nodes) => {
    const type = node.type
    Object.defineProperty(node, 'type', {
      enumerable: true,
      get() {
        if (active) visited.add(node)
        return type
      },
    })
    if ('children' in node) for (const child of node.children) wrap(child)
  }
  wrap(root)
  const original = String.prototype.charCodeAt
  const scan = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    at,
  ) {
    if (active) scans++
    return original.call(this, at)
  })
  const consume = ProjectionTraversalBudget.prototype.text
  const text = vi.spyOn(ProjectionTraversalBudget.prototype, 'text').mockImplementation(function (
    this: ProjectionTraversalBudget,
    count,
  ) {
    if (active) units += count
    return consume.call(this, count)
  })
  const work = planner.planProjectionSerialization(
    root,
    new Map(),
    { ...options, rawHtml },
    limits,
    policy ? engine.applyProjectionPolicy : undefined,
  )
  try {
    while (true) {
      scans = 0
      units = 0
      visited.clear()
      let next: ReturnType<typeof work.next>
      active = true
      try {
        next = work.next()
      } finally {
        active = false
      }
      expect(scans).toBeLessThanOrEqual(4096)
      expect(units).toBeLessThanOrEqual(4096)
      expect(visited.size).toBeLessThanOrEqual(16)
      totalScans += scans
      totalUnits += units
      advances++
      if (next.done) return { cost: next.value, totalScans, totalUnits, advances }
      if (cancel && totalUnits > 0) {
        work.return(undefined as never)
        expect(work.next().done).toBe(true)
        return { totalScans, totalUnits, advances }
      }
    }
  } finally {
    active = false
    work.return(undefined as never)
    scan.mockRestore()
    text.mockRestore()
  }
}

describe('bounded complete projection traversals', () => {
  it.each([false, true])(
    'fuses policy in source order and preserves complete mutation and admission with rawHtml=%s',
    (rawHtml) => {
      const root: HastRoot = {
        type: 'root',
        children: Array.from({ length: 40 }, (_, index) => ({
          type: 'element',
          tagName: 'div',
          properties: { title: '界😀<&'.repeat(100) },
          children: [
            {
              type: 'element',
              tagName: 'a',
              properties: {
                href: index % 2 ? 'javascript:alert(1)' : 'https://例え.test/界?a=1&b=2',
              },
              children: [{ type: 'text', value: '<&界😀' }],
            },
            {
              type: 'element',
              tagName: 'img',
              properties: { src: index % 2 ? '../../local.png' : 'https://example.invalid/界.png' },
              children: [],
            },
            { type: 'raw', value: '<i>&</i>' },
          ],
        })),
      }
      const expected = structuredClone(root)
      const elements: Nodes[] = []
      const visit = (node: Nodes): void => {
        if (node.type === 'element') {
          engine.applyProjectionPolicy(node)
          elements.push(node)
        }
        if ('children' in node) for (const child of node.children) visit(child)
      }
      visit(expected)
      const expectedCost = finishPackedSteps(
        planner.planProjectionSerialization(expected, new Map(), { ...options, rawHtml }, limits),
      )
      const seen: Nodes[] = []
      let calls = 0,
        urls = 0,
        advances = 0
      const work = planner.planProjectionSerialization(
        root,
        new Map(),
        { ...options, rawHtml },
        limits,
        (node) => {
          calls++
          if (node.tagName === 'a' || node.tagName === 'img') urls++
          seen.push(node)
          engine.applyProjectionPolicy(node)
        },
      )
      try {
        while (true) {
          calls = 0
          urls = 0
          const next = work.next()
          expect(calls).toBeLessThanOrEqual(16)
          expect(urls).toBeLessThanOrEqual(1)
          if (urls) expect(calls).toBe(1)
          advances++
          if (next.done) {
            expect(next.value).toEqual(expectedCost)
            break
          }
        }
        expect(advances).toBeGreaterThan(160)
        expect(seen).toEqual(elements)
        expect(root).toEqual(expected)
        expect(html.toHtml(root, { allowDangerousHtml: rawHtml })).toBe(
          html.toHtml(expected, { allowDangerousHtml: rawHtml }),
        )
      } finally {
        work.return(undefined as never)
      }
    },
  )
  it.each([false, true])(
    'keeps actual lexical and node quotas while policy shares the planner with cancel=%s',
    (cancel) => {
      const value = '<&界😀'.repeat(300)
      const root: HastRoot = {
        type: 'root',
        children: Array.from({ length: 80 }, () => ({
          type: 'element',
          tagName: 'div',
          properties: { title: value },
          children: [{ type: 'text', value }],
        })),
      }
      const result = observedPlan(root, cancel, false, true)
      expect(result.totalScans).toBeGreaterThan(0)
      if (cancel) {
        expect(result.cost).toBeUndefined()
        expect(result.totalScans).toBeLessThan(160 * value.length)
      } else {
        expect(result.totalScans).toBe(160 * value.length)
        expect(result.cost?.nodes).toBe(161)
        expect(result.cost?.htmlUnits).toBeGreaterThanOrEqual(html.toHtml(root).length)
      }
    },
  )
  it.each([false, true])(
    'preserves native admission weights and reserves chunk collection with rawHtml=%s',
    (rawHtml) => {
      const position = {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 10, offset: 9 },
      }
      const root: HastRoot = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['a&b', '界😀'], title: 'a"\0`\'<&', dataFlag: false },
            children: [
              { type: 'text', value: '<&😀' },
              { type: 'raw', value: '<i>&</i>' },
              {
                type: 'element',
                tagName: 'pre',
                properties: {},
                position,
                children: [
                  {
                    type: 'element',
                    tagName: 'code',
                    properties: {},
                    position,
                    children: [{ type: 'text', value: 'code\n' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      const work = planner.planProjectionSerialization(
        root,
        new Map([['0:9', { kind: 'code', value: 'code\n' }]]),
        { ...options, rawHtml },
        limits,
      )
      while (true) {
        const next = work.next()
        if (!next.done) continue
        // Recorded using the pre-batch planner: nested widgets, escaped attributes/text,
        // raw HTML policy, position weights, joins and transient entity replacement.
        // The stream additionally owns a 64 KiB bounded chunk collector.
        expect(next.value).toEqual({
          nodes: 7,
          depth: 4,
          hastBytes: 21576,
          widgetUnits: 47,
          widgets: 2,
          htmlUnits: rawHtml ? 318 : 339,
          scratchBytes: rawHtml ? 12608 : 12650,
          bytes: rawHtml ? 58466 : 58550,
          streamBytes: 404696,
        })
        expect(Object.isFrozen(next.value)).toBe(true)
        break
      }
    },
  )
  it('bounds actual node visits and scans across adjacent text and attribute strings', () => {
    const value = 'a<&界😀'.repeat(200)
    const root: HastRoot = {
      type: 'root',
      children: Array.from({ length: 40 }, () => ({
        type: 'element',
        tagName: 'span',
        properties: { className: [value, value, value] },
        children: Array.from({ length: 3 }, () => ({ type: 'text', value })),
      })),
    }
    const result = observedPlan(root)
    expect(result.totalScans).toBe(40 * 6 * value.length)
    expect(result.cost?.nodes).toBe(161)
    expect(result.advances).toBeGreaterThan(40)
    expect(result.cost?.htmlUnits).toBeGreaterThanOrEqual(html.toHtml(root).length)
  })
  it.each([false, true])(
    'bounds deep sibling traversal and cancellation at the depth ceiling with rawHtml=%s',
    (rawHtml) => {
      const value = '<&界😀'.repeat(2000)
      const fixture = (): HastRoot => {
        let branch: ElementContent = { type: 'text', value }
        for (let depth = 0; depth < limits.depth - 1; depth++)
          branch = {
            type: 'element',
            tagName: 'div',
            properties: {},
            children: [{ type: 'text', value: '<' }, branch, { type: 'raw', value: '&' }],
          }
        return { type: 'root', children: [branch] }
      }
      const root = fixture()
      const result = observedPlan(root, false, rawHtml)
      expect(result.cost?.depth).toBe(limits.depth)
      expect(result.cost?.nodes).toBe(2 + (limits.depth - 1) * 3)
      expect(result.totalUnits).toBe(value.length + (limits.depth - 1) * 2)
      expect(result.totalScans).toBe(value.length + (limits.depth - 1) * (rawHtml ? 1 : 2))
      expect(result.cost?.htmlUnits).toBeGreaterThanOrEqual(html.toHtml(root).length)
      const cancelled = observedPlan(fixture(), true, rawHtml)
      expect(cancelled.cost).toBeUndefined()
      expect(cancelled.totalScans).toBeLessThan(result.totalScans)
    },
  )
  it.each([false, true])('retains lexical progress for raw text with rawHtml=%s', (rawHtml) => {
    const value = '<&界😀'.repeat(10000),
      suffix = 'tail'.repeat(300)
    const result = observedPlan(
      {
        type: 'root',
        children: [
          { type: 'raw', value },
          { type: 'text', value: suffix },
        ],
      },
      false,
      rawHtml,
    )
    expect(result.totalUnits).toBe(value.length + suffix.length)
    expect(result.totalScans).toBe((rawHtml ? 0 : value.length) + suffix.length)
    expect(result.advances).toBeGreaterThan(10)
    const cancelled = observedPlan(
      { type: 'root', children: [{ type: 'raw', value }] },
      true,
      rawHtml,
    )
    expect(cancelled.totalUnits).toBeGreaterThan(0)
    expect(cancelled.totalUnits).toBeLessThan(value.length)
    expect(cancelled.cost).toBeUndefined()
  })
  it('cancels during a long escape scan before reading the rest of the field', () => {
    const value = '<&界😀'.repeat(20000)
    const result = observedPlan({ type: 'root', children: [{ type: 'text', value }] }, true)
    expect(result.totalScans).toBeGreaterThan(0)
    expect(result.totalScans).toBeLessThan(value.length)
    expect(result.cost).toBeUndefined()
  })
  it('bounds actual property-value reads even when a single node has a wide value array', () => {
    let reads = 0,
      total = 0,
      steps = 0
    const values = Array.from({ length: 1000 }, (_, index) => index)
    for (let index = 0; index < values.length; index++)
      Object.defineProperty(values, index, {
        get() {
          reads++
          return index
        },
      })
    const work = planner.planProjectionSerialization(
      {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { dataValues: values },
            children: [],
          },
        ],
      },
      new Map(),
      options,
      limits,
    )
    while (true) {
      reads = 0
      const next = work.next()
      expect(reads).toBeLessThanOrEqual(16)
      total += reads
      steps++
      if (next.done) {
        expect(next.value.nodes).toBe(2)
        break
      }
    }
    expect(total).toBe(1000)
    expect(steps).toBeGreaterThan(60)
  })
  it.each(['nodes', 'depth'] as const)(
    'still rejects logical %s limits inside a batch',
    (field) => {
      const work = planner.planProjectionSerialization(
        {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: {},
              children: [{ type: 'text', value: 'text' }],
            },
          ],
        },
        new Map(),
        options,
        { ...limits, [field]: 1 },
      )
      expect(() => {
        while (!work.next().done) {}
      }).toThrow('traversal limit')
    },
  )
  it.each(
    (['describe', 'policy', 'widgets', 'serialized'] as const).flatMap((phase) =>
      (['return', 'release', 'dispose'] as const).map((action) => ({ phase, action })),
    ),
  )('releases real packed output during $phase on $action', async ({ phase, action }) => {
    const actual = await vi.importActual<typeof planner>('../../src/projection-serialization-plan')
    let planned = false,
      widgetSteps = 0
    const plan = vi.mocked(planner.planProjectionSerialization).mockImplementation(function* (
      ...args
    ) {
      const cost = yield* actual.planProjectionSerialization(...args)
      planned = true
      return cost
    })
    const step = ProjectionTraversalBudget.prototype.step
    const steps = vi
      .spyOn(ProjectionTraversalBudget.prototype, 'step')
      .mockImplementation(function (this: ProjectionTraversalBudget) {
        if (planned) widgetSteps++
        return step.call(this)
      })
    const describe = vi.mocked(engine.describeProjectionNode)
    const policy = vi.mocked(engine.applyProjectionPolicy)
    const serialize = vi.mocked(html.toHtml)
    describe.mockClear()
    policy.mockClear()
    serialize.mockClear()
    const text = `> ${Array.from({ length: 96 }, (_, index) => `*${index}* $c${index}$`).join(' ')}\n`
    const { owner, source, capture } = fixture(text)
    const before = owner.stats
    let inspected = false
    const work = inspectPackedProjectionOutput(
      capture,
      source,
      ['root'],
      options,
      limits,
      function* () {
        inspected = true
        yield
      },
    )
    try {
      for (let count = 0; ; count++) {
        expect(count).toBeLessThan(10000)
        expect(work.next().done).toBe(false)
        if (phase === 'describe' && describe.mock.calls.length > 0) break
        if (phase === 'policy' && policy.mock.calls.length > 0) break
        if (phase === 'widgets' && widgetSteps > 0) break
        if (phase === 'serialized' && serialize.mock.calls.length > 0) break
      }
      expect(inspected).toBe(false)
      if (phase !== 'serialized') expect(serialize).not.toHaveBeenCalled()
      if (action === 'return') work.return()
      else if (action === 'release') capture.release()
      else owner.dispose()
      expect(work.next().done).toBe(true)
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.readerStagingBytes).toBe(0)
      if (action === 'return') expect(owner.stats).toEqual(before)
    } finally {
      work.return()
      owner.dispose()
      steps.mockRestore()
      plan.mockReset()
      describe.mockClear()
      policy.mockClear()
      serialize.mockClear()
      plan.mockImplementation(actual.planProjectionSerialization)
    }
  })
  it('isolates URL policy, language normalization and every widget/full serialization', () => {
    const text = `~~~${'LANG'.repeat(2000)}\ncode\n~~~\n\n> ${Array.from(
      { length: 12 },
      (_, index) =>
        `[link${index}](https://example.invalid/${index}) ![alt](../../local.png) $x${index}$`,
    ).join(' ')}\n`
    const { owner, source, capture } = fixture(text)
    const before = owner.stats
    const describe = vi.mocked(engine.describeProjectionNode)
    const policy = vi.mocked(engine.applyProjectionPolicy)
    const serialize = vi.mocked(html.toHtml)
    describe.mockClear()
    policy.mockClear()
    serialize.mockClear()
    const work = inspectPackedProjectionOutput(
      capture,
      source,
      ['root'],
      options,
      limits,
      function* () {
        yield
      },
    )
    let urls = 0,
      languages = 0,
      serializations = 0
    try {
      while (true) {
        const oldDescribe = describe.mock.calls.length,
          oldPolicy = policy.mock.calls.length,
          oldSerialize = serialize.mock.calls.length
        const next = work.next()
        const language = describe.mock.calls
          .slice(oldDescribe)
          .filter(([node]) => node.type === 'code' && !!node.lang).length
        const url = policy.mock.calls
          .slice(oldPolicy)
          .filter(([node]) => node.tagName === 'a' || node.tagName === 'img').length
        const serialized = serialize.mock.calls.length - oldSerialize
        expect(language + url + serialized).toBeLessThanOrEqual(1)
        urls += url
        languages += language
        serializations += serialized
        if (next.done) break
      }
      expect(urls).toBe(24)
      expect(languages).toBe(1)
      expect(serializations).toBeGreaterThan(12)
      expect(owner.stats).toEqual(before)
    } finally {
      work.return()
      owner.dispose()
      describe.mockClear()
      policy.mockClear()
      serialize.mockClear()
    }
  })
})
