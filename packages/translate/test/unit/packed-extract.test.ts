import { createHash } from 'node:crypto'
import { parseMarkdown, type Root, sourceHash } from '@manuslip/core'
import { expect, it } from 'vitest'
import { packValue } from '../../../core/src/packing'
import { inspectPackedNativeStream } from '../../../core/src/packing-native-stream'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { type TranslationUnit, translationLimits, type UnitKind } from '../../src/contracts'
import { extractTranslation } from '../../src/extract'
import { inspectPackedTranslationUnits } from '../../src/packed-extract'
import { reconstructUnit } from '../../src/reconstruct'

const MiB = 1024 * 1024
const limits = { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const occurrence = ({ from, to, kind }: { from: number; to: number; kind: UnitKind }) =>
  `${kind}:${from}:${to}`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function fixture(text: string, syntax: 'manuslip' | 'commonmark' = 'manuslip', root?: Root) {
  const document = parseMarkdown(text, syntax)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'packed-extraction',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
  const owner = new PackedSession({
    bytes: 8 * MiB,
    retained: 32 * MiB,
    staging: 8 * MiB,
    captures: 8,
    readers: 160,
  })
  const payload = packValue({ document: { root: root ?? document.root } }, 8 * MiB)
  owner.commit(owner.prepareFull(owner.beginPrepared(source), source.identity, payload))
  const capture = owner.capture()
  owner.evict()
  return {
    document,
    source,
    owner,
    capture,
    close() {
      capture.release()
      owner.dispose()
    },
  }
}
const path = ['document', 'root'] as const
function compare(text: string, syntax: 'manuslip' | 'commonmark' = 'manuslip') {
  const f = fixture(text, syntax)
  try {
    const native = extractTranslation(f.document.root, text, occurrence)
    let index = 0
    const before = f.owner.stats
    const result = finishPackedSteps(
      inspectPackedTranslationUnits(
        f.capture,
        f.source,
        path,
        limits,
        function* (unit, cost) {
          const expected = native.units[index++]
          expect(JSON.stringify(unit)).toBe(JSON.stringify(expected))
          expect(cost.retainedBytes).toBeLessThanOrEqual(limits.retained)
          expect(cost.stagingBytes).toBeLessThanOrEqual(limits.staging)
          if (unit.payload && expected) {
            const output = `Translated ${unit.payload.text}`
            expect(reconstructUnit(unit as TranslationUnit, output)).toEqual(
              reconstructUnit(expected, output),
            )
          }
          yield
        },
        occurrence,
      ),
    )
    expect(result?.units).toBe(native.units.length)
    expect(result?.payloadBytes).toBe(native.payloadBytes)
    expect(index).toBe(native.units.length)
    expect(f.owner.stats).toEqual(before)
  } finally {
    f.close()
  }
}

it('matches every CommonMark root, complete private bindings, unit paths and reconstruction', () => {
  for (const example of examples) compare(example.markdown, 'commonmark')
}, 30000)

it.each(['manuslip', 'commonmark'] as const)(
  'matches %s extension, container, HTML-group and privacy semantics',
  (syntax) => {
    compare(
      '---\ntitle: Private\n---\n\n# Hello 世界\n\n> - Hello **strong** *emphasis* ~~gone~~ and [label][r].\n> - Another `SECRET` and $x^2$.\n\n| Hello | World |\n| - | - |\n| a | b |\n\nProse <span>PRIVATE **content**</span> and https://private.invalid/a.\n\nNote[^n] and ![ALT](private.png).\n\n[r]: https://private.invalid/ "TITLE"\n\n[^n]: A footnote paragraph.\n\n```mermaid\ngraph LR; A --> B\n```\n',
      syntax,
    )
    compare(`${'word '.repeat(15000)}\n\nOnly \`protected\`.\n\n${'`p` '.repeat(300)}`, syntax)
  },
)

it('validates the entire root before exposing an earlier eligible unit', () => {
  const text = 'Hello.\n\n```js\nsecret\n```\n'
  const root = parseMarkdown(text).root
  Object.assign(root.children[1] ?? {}, { unexpected: 'malformed ineligible branch' })
  const f = fixture(text, 'manuslip', root)
  let callbacks = 0
  try {
    const before = f.owner.stats
    expect(() =>
      finishPackedSteps(
        inspectPackedTranslationUnits(f.capture, f.source, path, limits, function* () {
          callbacks++
          yield
        }),
      ),
    ).toThrow()
    expect(callbacks).toBe(0)
    expect(f.owner.stats).toEqual(before)
  } finally {
    f.close()
  }
})

it('rejects foreign source identity, duplicate occurrence IDs and insufficient workspace without leaks', () => {
  const f = fixture('First paragraph.\n\nSecond paragraph.\n')
  try {
    const before = f.owner.stats
    const inspect = function* () {
      yield
    }
    const foreign = new PackedSource(f.source.identity, f.source.text)
    expect(() =>
      finishPackedSteps(inspectPackedTranslationUnits(f.capture, foreign, path, limits, inspect)),
    ).toThrow()
    expect(() =>
      finishPackedSteps(
        inspectPackedTranslationUnits(f.capture, f.source, path, limits, inspect, () => 'same'),
      ),
    ).toThrow('translation-invalid')
    expect(() =>
      finishPackedSteps(
        inspectPackedTranslationUnits(
          f.capture,
          f.source,
          path,
          { ...limits, staging: 512 * 1024 },
          inspect,
        ),
      ),
    ).toThrow(/workspace/)
    expect(f.owner.stats).toEqual(before)
  } finally {
    f.close()
  }
})

it('releases every scope when cancelled before start, during validation or inside a suspended inspector', () => {
  for (const phase of ['before', 'validation', 'inspector'] as const) {
    const f = fixture('Hello **world** and `private`.\n\nSecond paragraph.\n')
    try {
      const before = f.owner.stats
      let entered = false
      const work = inspectPackedTranslationUnits(f.capture, f.source, path, limits, function* () {
        entered = true
        yield
        throw new Error('Cancelled inspector resumed')
      })
      if (phase === 'validation') work.next()
      if (phase === 'inspector') {
        while (!entered) expect(work.next().done).toBe(false)
        expect(f.owner.stats.readerStagingBytes).toBeGreaterThan(before.readerStagingBytes)
      }
      work.return()
      expect(work.next().done).toBe(true)
      expect(f.owner.stats).toEqual(before)
    } finally {
      f.close()
    }
  }
})

it('propagates inspector failure and revokes suspended extraction when the capture closes', () => {
  for (const closeCapture of [false, true]) {
    const f = fixture('Hello **world**.\n')
    try {
      const before = f.owner.stats
      const failure = new Error('inspector failure')
      let entered = false
      const work = inspectPackedTranslationUnits(f.capture, f.source, path, limits, function* () {
        entered = true
        yield
        throw failure
      })
      while (!entered) work.next()
      if (closeCapture) {
        f.capture.release()
        expect(work.next().done).toBe(true)
        expect(f.owner.stats.readerStagingBytes).toBe(0)
        expect(f.owner.stats).toMatchObject({
          retainedBytes: 256,
          resources: 0,
          captures: 0,
          readers: 0,
          holds: 0,
        })
      } else {
        expect(() => work.next()).toThrow(failure)
        expect(f.owner.stats).toEqual(before)
      }
    } finally {
      f.close()
    }
  }
})

it.each(['units', 'payload'] as const)(
  'preserves the logical aggregate %s limit when every inspected unit is discarded',
  (limit) => {
    const paragraph = limit === 'units' ? 'Prose.\n\n' : `Prose ${'⟪⟫ '.repeat(200)}\n\n`
    const unit = extractTranslation(parseMarkdown(paragraph).root, paragraph, occurrence).units[0]
    expect(unit?.payload).toBeTruthy()
    const bytes = Buffer.byteLength(JSON.stringify(unit?.payload))
    const allowed =
      limit === 'units' ? translationLimits.units : Math.floor(translationLimits.plan / bytes)
    const f = fixture(paragraph.repeat(allowed + 1))
    try {
      const before = f.owner.stats
      expect(() => extractTranslation(f.document.root, f.source.text, occurrence)).toThrow(
        'translation-limit',
      )
      let inspected = 0
      expect(() =>
        finishPackedSteps(
          inspectPackedTranslationUnits(
            f.capture,
            f.source,
            path,
            limits,
            function* () {
              inspected++
              yield
            },
            occurrence,
          ),
        ),
      ).toThrow('translation-limit')
      expect(inspected).toBe(allowed)
      expect(f.owner.stats).toEqual(before)
    } finally {
      f.close()
    }
  },
  30000,
)

it('extracts every unit of the complete nested corpus while whole-root native expansion exceeds the same staging cap', () => {
  const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
  const text = `# nested-containers\n\n${chunk.repeat(Math.ceil(1048576 / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`
  expect(hash(text)).toBe('93840405600f54e8014aa52af0dbb30d5e844e3fbfe9656296330807064026c3')
  const f = fixture(text)
  try {
    const before = f.owner.stats
    expect(() =>
      finishPackedSteps(
        inspectPackedNativeStream(
          f.capture,
          f.capture.reader.at(path),
          { ...limits, depth: 512 },
          function* () {
            yield
            throw new Error('Oversized native root reached inspector')
          },
        ),
      ),
    ).toThrow(/workspace/)
    expect(f.owner.stats).toEqual(before)
    const native = extractTranslation(f.document.root, text, occurrence)
    let index = 0
    const result = finishPackedSteps(
      inspectPackedTranslationUnits(
        f.capture,
        f.source,
        path,
        limits,
        function* (unit) {
          expect(hash(JSON.stringify(unit))).toBe(hash(JSON.stringify(native.units[index++])))
          yield
        },
        occurrence,
      ),
    )
    expect(result?.units).toBe(native.units.length)
    expect(index).toBe(native.units.length)
    expect(result?.payloadBytes).toBe(native.payloadBytes)
    expect(result?.retainedPeakBytes).toBeLessThan(limits.retained)
    expect(result?.stagingPeakBytes).toBeLessThan(limits.staging)
    expect(result?.largestNativeBytes).toBeLessThan(MiB)
    expect(f.owner.stats).toEqual(before)
  } finally {
    f.close()
  }
}, 30000)
