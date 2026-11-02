import { afterEach, describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdownNative } from '../../../core/src/parse'
import { rendererVersion } from '../../src/index'
import { PackedSnapshotCertificate } from '../../src/packed-snapshot-certificate'
import * as validation from '../../src/packing-validate-snapshot'
import { renderProjectionLayout } from '../../src/projection-layout'

const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 4 * MiB, nodes: 100000, depth: 64 }
const session = { retained: 64 * MiB, staging: 8 * MiB, bytes: 8 * MiB, captures: 8, readers: 160 }
const options = { rawHtml: false, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const text =
  '\ufeff# Heading 🌍\r\n\r\nBody 中文 [r][ref], note[^n], $x^2$ and <b>HTML</b>.\r\n\r\n' +
  '| A | B |\r\n| - | - |\r\n| ![local](../../local.png) | `code` |\r\n\r\n' +
  '```mermaid\r\ngraph TD; A-->B\r\n```\r\n\r\n[ref]: /target\r\n\r\n[^n]: Footer.\r\n'

function snapshot(rawHtml = false) {
  const render = { ...options, rawHtml }
  const document = parseMarkdownNative(text)
  const { projection, layout } = renderProjectionLayout(document.root, render, session.bytes)
  return { document, projection, layout }
}
function fixture(
  prepared = true,
  rawHtml = false,
  mutate?: (value: ReturnType<typeof snapshot>) => void,
) {
  const value = snapshot(rawHtml)
  mutate?.(value)
  const render = { ...options, rawHtml }
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'parent-certificate',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: value.document.parserVersion,
      rendererVersion,
      options: JSON.stringify(render),
    },
    text,
  )
  const owner = new PackedSession(session)
  const ticket = owner.prepareFull(
    owner.beginPrepared(source),
    source.identity,
    packValue({ snapshot: value }, session.bytes),
  )
  if (!prepared) owner.commit(ticket)
  const capture = prepared ? owner.capturePrepared(ticket) : owner.capture()
  return { value, owner, source, capture, ticket, render }
}
function create(context: ReturnType<typeof fixture>) {
  return context.capture.work(
    (function* () {
      return yield* PackedSnapshotCertificate.createSteps(
        context.capture,
        context.source,
        ['snapshot'],
        context.render,
        limits,
      )
    })(),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('snapshot certification inside a running capture-owned parent', () => {
  it.each(
    [false, true].flatMap((prepared) => [false, true].map((rawHtml) => ({ prepared, rawHtml }))),
  )('validates complete native output with $prepared prepared and rawHtml=$rawHtml', (input) => {
    const context = fixture(input.prepared, input.rawHtml)
    const before = context.owner.stats
    const work = create(context)
    let certificate: PackedSnapshotCertificate | undefined
    try {
      certificate = finishPackedSteps(work)
      expect(certificate).toBeDefined()
      if (input.prepared) {
        context.owner.commit(context.ticket)
        context.capture = context.owner.capture()
      }
      expect(
        PackedSnapshotCertificate.validates(
          certificate,
          context.capture,
          context.source,
          ['snapshot'],
          context.render,
          limits,
        ),
      ).toBe(true)
      certificate?.close()
      expect(context.owner.stats.readers).toBe(before.readers)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(context.owner.stats.holds).toBe(before.holds)
    } finally {
      certificate?.close()
      work.return()
      context.owner.dispose()
    }
  })

  const malformed: [string, (value: ReturnType<typeof snapshot>) => void][] = [
    ['word count', (value) => value.document.counts.words++],
    ['character count', (value) => value.document.counts.characters++],
    [
      'source coordinates',
      (value) => {
        const point = value.document.root.position?.start
        if (!point) throw new Error('Missing fixture position')
        point.line++
      },
    ],
    ['root schema', (value) => Object.assign(value.document.root, { extra: true })],
    ['complete HTML', (value) => (value.projection.html += '<p>forged</p>')],
    [
      'widget HTML',
      (value) => {
        const widget = value.projection.blocks[0]
        if (!widget) throw new Error('Missing fixture widget')
        widget.html += '<p>forged</p>'
      },
    ],
    ['layout', (value) => (value.layout = { ...value.layout, bodyEnd: value.layout.bodyEnd + 1 })],
    ['document identity', (value) => (value.document.sourceHash = 'forged')],
  ]
  it.each(malformed)('rejects forged %s and releases partial certification', (_, mutate) => {
    const context = fixture(true, false, mutate)
    const before = context.owner.stats
    const work = create(context)
    try {
      expect(() => finishPackedSteps(work)).toThrow(/semantic/)
      expect(context.owner.stats).toEqual(before)
      expect(work.next()).toEqual({ done: true, value: undefined })
    } finally {
      work.return()
      context.owner.dispose()
    }
  })

  it.each(['return', 'capture', 'owner'] as const)(
    'revokes the complete delegation chain at early and late suspension points on %s',
    (action) => {
      const complete = fixture()
      let advances = 0
      try {
        const work = create(complete)
        while (true) {
          const next = work.next()
          if (next.done) {
            expect(next.value).toBeDefined()
            next.value?.close()
            break
          }
          advances++
        }
      } finally {
        complete.owner.dispose()
      }
      expect(advances).toBeGreaterThan(20)
      for (const stop of [
        0,
        1,
        2,
        Math.floor(advances / 4),
        Math.floor(advances / 2),
        advances - 1,
      ]) {
        const context = fixture()
        const before = context.owner.stats
        const work = create(context)
        try {
          for (let index = 0; index < stop; index++) expect(work.next().done).toBe(false)
          if (action === 'return') work.return()
          else if (action === 'capture') context.capture.release()
          else context.owner.dispose()
          if (action === 'return') expect(context.owner.stats).toEqual(before)
          else
            expect(context.owner.stats).toMatchObject({
              readers: 0,
              holds: 0,
              readerStagingBytes: 0,
            })
          if (action === 'owner') expect(context.owner.stats.retainedBytes).toBe(0)
          expect(work.next()).toEqual({ done: true, value: undefined })
        } finally {
          work.return()
          context.owner.dispose()
        }
      }
    },
  )

  it('admits certificate metadata before starting full validation in the parent', () => {
    const context = fixture()
    const validate = vi.spyOn(validation, 'packedSnapshotSteps')
    const fill = context.capture.workspace(
      session.retained - context.owner.stats.retainedBytes - 2048,
      0,
    )
    const before = context.owner.stats
    const work = create(context)
    try {
      expect(() => work.next()).toThrow(/limit/)
      expect(validate).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      fill.release()
      context.owner.dispose()
    }
  })

  it('copies private paths, policy and limits before the first suspension', () => {
    const context = fixture()
    const path = ['snapshot'],
      render = { ...context.render },
      budget = { ...limits }
    const work = context.capture.work(
      (function* () {
        return yield* PackedSnapshotCertificate.createSteps(
          context.capture,
          context.source,
          path,
          render,
          budget,
        )
      })(),
    )
    let certificate: PackedSnapshotCertificate | undefined
    try {
      expect(work.next().done).toBe(false)
      path[0] = 'other'
      render.footnotesLabel = 'Other'
      budget.nodes = 0
      certificate = finishPackedSteps(work)
      expect(
        certificate?.validatesSnapshot(
          context.capture,
          context.source,
          ['snapshot'],
          context.render,
          limits,
        ),
      ).toBe(true)
    } finally {
      certificate?.close()
      work.return()
      context.owner.dispose()
    }
  })
})
