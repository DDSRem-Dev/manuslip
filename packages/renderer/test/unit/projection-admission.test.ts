import type { Nodes, Parents, RootContent } from 'mdast'
import type { State } from 'mdast-util-to-hast'
import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { parseMarkdown } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import { ProjectionSequence } from '../../src/projection-sequence'
import { ProjectionWorkspace } from '../../src/projection-workspace'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }

function fixture() {
  const text = 'owned scope'
  const document = parseMarkdown(text)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'admission',
      revision: 0,
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
  const capture = owner.capture()
  return { owner, capture }
}

describe('cooperative projection construction admission', () => {
  it('preserves the workspace binding and every allocation callback within a reserved quantum', () => {
    const context = fixture(),
      calls: { workspace: ProjectionWorkspace; bytes: number }[] = [],
      workspace = new ProjectionWorkspace(
        context.capture,
        limits,
        function (this: ProjectionWorkspace, bytes) {
          calls.push({ workspace: this, bytes })
        },
      )
    try {
      workspace.set(1)
      const before = context.owner.stats
      const initial = calls.length
      for (let index = 0; index < 100; index++) workspace.add(1)
      expect(calls).toHaveLength(initial + 100)
      expect(calls.every((call) => call.workspace === workspace)).toBe(true)
      expect(calls.slice(initial).every((call) => call.bytes === 65536)).toBe(true)
      expect(context.owner.stats).toEqual(before)
    } finally {
      workspace.close()
      context.capture.release()
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    }
  })

  it('keeps its captured local budget when the caller later changes its limits object', () => {
    const context = fixture(),
      supplied = { ...limits, retained: 2 * MiB, staging: 2 * MiB },
      workspace = new ProjectionWorkspace(context.capture, supplied)
    try {
      const before = context.owner.stats
      supplied.retained = 64 * MiB
      supplied.staging = 8 * MiB
      expect(() => workspace.set(3 * MiB)).toThrow(/workspace/)
      expect(context.owner.stats).toEqual(before)
    } finally {
      workspace.close()
      context.capture.release()
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    }
  })

  it('preserves the logical plan after rejected growth and retries within a fully occupied budget', () => {
    const context = fixture(),
      workspace = new ProjectionWorkspace(context.capture, limits)
    let occupied: ReturnType<typeof context.capture.workspace> | undefined
    try {
      workspace.set(65535)
      occupied = context.capture.workspace(
        limits.staging - workspace.bytes,
        limits.staging - workspace.bytes,
      )
      const before = context.owner.stats
      expect(before.readerStagingBytes).toBe(limits.staging)
      expect(() => workspace.add(2)).toThrow(/staging|scope/)
      expect(context.owner.stats).toEqual(before)
      expect(workspace.bytes).toBe(65536)
      // The refused addition never advances the plan. This last covered byte needs
      // no growth, even while a second owner holds every remaining staging byte.
      workspace.add(1)
      expect(context.owner.stats).toEqual(before)
      occupied.release()
      workspace.add(1)
      expect(workspace.bytes).toBe(131072)
      workspace.set(1)
      expect(workspace.bytes).toBe(65536)
    } finally {
      occupied?.release()
      workspace.close()
      context.capture.release()
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    }
  })

  it('preserves admission refusal and its original error inside an already reserved quantum', () => {
    const context = fixture(),
      original = new Error('Native allocation refused')
    let refuse = false
    const workspace = new ProjectionWorkspace(context.capture, limits, () => {
      if (refuse) throw original
    })
    try {
      workspace.set(1)
      const before = context.owner.stats
      refuse = true
      expect(() => workspace.add(17)).toThrow(original)
      expect(context.owner.stats).toEqual(before)
      refuse = false
      workspace.add(65535)
      expect(workspace.bytes).toBe(65536)
      expect(context.owner.stats).toEqual(before)
    } finally {
      workspace.close()
      context.capture.release()
      context.owner.dispose()
      expect(context.owner.stats.retainedBytes).toBe(0)
    }
  })

  it.each(['workspace', 'capture', 'owner'] as const)(
    'rejects covered allocations after %s revocation without an admission hook',
    (action) => {
      const context = fixture(),
        workspace = new ProjectionWorkspace(context.capture, limits)
      try {
        workspace.set(1)
        if (action === 'workspace') workspace.close()
        if (action === 'capture') context.capture.release()
        if (action === 'owner') context.owner.dispose()
        const stopped = context.owner.stats
        expect(() => workspace.set(2)).toThrow(/closed|released|disposed|workspace/)
        expect(context.owner.stats).toEqual(stopped)
      } finally {
        workspace.close()
        context.capture.release()
        context.owner.dispose()
        expect(context.owner.stats.retainedBytes).toBe(0)
      }
    },
  )

  it.each(['workspace', 'capture', 'owner'] as const)(
    'rejects covered allocations when admission reentrantly closes the %s',
    (action) => {
      const context = fixture()
      let close = false
      const workspace = new ProjectionWorkspace(context.capture, limits, () => {
        if (!close) return
        if (action === 'workspace') workspace.close()
        if (action === 'capture') context.capture.release()
        if (action === 'owner') context.owner.dispose()
      })
      try {
        workspace.set(1)
        close = true
        expect(() => workspace.set(2)).toThrow(/closed|released|disposed|workspace/)
        expect(() => workspace.add(1)).toThrow(/closed|released|disposed|workspace/)
      } finally {
        workspace.close()
        context.capture.release()
        context.owner.dispose()
        expect(context.owner.stats.retainedBytes).toBe(0)
      }
    },
  )

  const nodes: RootContent[] = [
    ...parseMarkdown('x'.repeat(524288)).root.children,
    {
      type: 'paragraph',
      children: Array.from({ length: 20 }, () => ({ type: 'text', value: 'x'.repeat(1023) })),
    },
    ...parseMarkdown(`${`**${'x'.repeat(1023)}** `.repeat(20)}end`).root.children,
    { type: 'code', value: 'line\r\n'.repeat(1000), lang: `js${' \t\n\u00a0\u2028'.repeat(1000)}` },
    { type: 'html', value: '<p>raw</p>'.repeat(1000) },
  ]
  it.each(nodes.map((node, index) => ({ node, index })))(
    'bounds lexical accounting without changing native results or reservations: $index',
    ({ node, index }) => {
      const context = fixture()
      const baseline = context.owner.stats
      const expectedSequence = new ProjectionSequence([], options)
      const expected = expectedSequence.convert(node).hast
      expectedSequence.close()
      const traces: number[][] = []
      const visits: string[][] = []
      let counting = false,
        units = 0
      const charCodeAt = String.prototype.charCodeAt,
        test = RegExp.prototype.test
      const chars = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
        this: string,
        index,
      ) {
        if (counting) units++
        return charCodeAt.call(this, index)
      })
      const spaces = vi.spyOn(RegExp.prototype, 'test').mockImplementation(function (
        this: RegExp,
        value,
      ) {
        if (counting && this.source === '\\s') units += value.length
        return test.call(this, value)
      })
      try {
        for (const cooperative of [false, true]) {
          const trace: number[] = [],
            visited: string[] = []
          const workspace = new ProjectionWorkspace(context.capture, limits, (bytes) =>
            trace.push(bytes),
          )
          const sequence = new ProjectionSequence([], options)
          function enter(state: State, node: Nodes, parent: Parents | undefined) {
            visited.push(node.type)
            counting = true
            let scan: Generator<void> | void
            try {
              scan = cooperative
                ? workspace.nodeSteps(state, node, parent)
                : workspace.node(state, node, parent)
            } finally {
              counting = false
            }
            if (!scan) return
            const work = scan
            return (function* () {
              try {
                for (;;) {
                  counting = true
                  let next: IteratorResult<void>
                  try {
                    next = work.next()
                  } finally {
                    counting = false
                  }
                  if (next.done) return
                  yield
                }
              } finally {
                work.return(undefined)
              }
            })()
          }
          sequence.admit({
            node: enter,
            nodeSteps: enter,
            footer() {},
            conversion(bytes) {
              workspace.add(bytes)
            },
          })
          let peak = 0
          try {
            const work = sequence.convertSteps(node, limits)
            for (;;) {
              units = 0
              const next = work.next()
              peak = Math.max(peak, units)
              if (next.done) {
                expect(next.value.hast).toEqual(expected)
                break
              }
            }
            if (cooperative) expect(peak).toBeLessThanOrEqual(4096)
            else if (index < 2) expect(peak).toBeGreaterThan(4096)
            traces.push(trace)
            visits.push(visited)
          } finally {
            sequence.close()
            workspace.close()
          }
          expect(context.owner.stats).toEqual(baseline)
        }
        expect(traces[1]).toEqual(traces[0])
        expect(visits[1]).toEqual(visits[0])
      } finally {
        chars.mockRestore()
        spaces.mockRestore()
        context.capture.release()
        context.owner.dispose()
      }
    },
  )

  it.each(['return', 'sequence', 'workspace', 'capture', 'owner'] as const)(
    'stops suspended admission before native construction when closed through %s',
    (action) => {
      const context = fixture()
      const workspace = new ProjectionWorkspace(context.capture, limits)
      const sequence = new ProjectionSequence([], options)
      const conversion = vi.fn((bytes: number) => workspace.add(bytes))
      sequence.admit({
        node: workspace.node.bind(workspace),
        nodeSteps: workspace.nodeSteps.bind(workspace),
        footer() {},
        conversion,
      })
      const work = sequence.convertSteps({ type: 'code', value: 'x'.repeat(12000) }, limits)
      try {
        expect(work.next().done).toBe(false)
        expect(conversion).not.toHaveBeenCalled()
        if (action === 'return')
          expect(work.return(undefined as never)).toEqual({ done: true, value: undefined })
        else {
          if (action === 'sequence') sequence.close()
          if (action === 'workspace') workspace.close()
          if (action === 'capture') context.capture.release()
          if (action === 'owner') context.owner.dispose()
          expect(() => work.next()).toThrow(/closed|released|disposed|unavailable/)
        }
        expect(conversion).not.toHaveBeenCalled()
        expect(() => sequence.finish()).toThrow('closed')
      } finally {
        work.return(undefined as never)
        sequence.close()
        workspace.close()
        context.capture.release()
        context.owner.dispose()
      }
    },
  )
})
