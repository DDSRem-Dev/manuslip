import { describe, expect, it } from 'vitest'
import { sourceHash } from '../../../core/src/contracts'
import { packValue } from '../../../core/src/packing'
import { inspectPackedNativeStream } from '../../../core/src/packing-native-stream'
import { PackedSession } from '../../../core/src/packing-session'
import { PackedSource } from '../../../core/src/packing-source'
import { finishPackedSteps } from '../../../core/src/packing-work'
import { parseMarkdown } from '../../../core/src/parse'
import examples from '../../../core/test/fixtures/commonmark-0.31.2/spec.json'
import { extractTranslation } from '../../../translate/src/extract'
import { buildPackedTranslationPlan } from '../../../translate/src/packed-plan'
import type { PackedTranslationProjection } from '../../../translate/src/packed-projection'
import { reconstructTranslation } from '../../../translate/src/reconstruct'
import { rendererVersion } from '../../src/index'
import { inspectPackedReading } from '../../src/packed-reading'
import { readingBlocks, renderReading } from '../../src/reading'
import { readingJsonBytes } from '../../src/reading-bytes'

const MiB = 1024 * 1024
const limits = { retained: 24 * MiB, staging: 8 * MiB, metadata: 8 * MiB, nodes: 800000, depth: 64 }
const options = { rawHtml: true, footnotesLabel: 'Notes 世界', footnoteBackLabel: 'Back 返回' }
const rootPath = ['document', 'root'] as const
const occurrence = ({ from, to, kind }: { from: number; to: number; kind: string }) =>
  `${kind}:${from}:${to}`
const normalize = (value: unknown) =>
  JSON.stringify(value).replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'UUID')

/** The independent native oracle is test-owned. Packed metadata, native context/block
 * copies, reconstruction, paired HAST construction, serialization and persistent output
 * all have session admission. This is weighted admission, not physical calibration.
 */
function check(
  text: string,
  syntax: 'commonmark' | 'manuslip',
  translationModes: readonly boolean[] = [false],
) {
  const document = parseMarkdown(text, syntax)
  const source = new PackedSource(
    {
      generation: 1,
      documentId: 'packed-reading',
      revision: 0,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion,
      options: JSON.stringify(options),
    },
    text,
  )
  const owner = new PackedSession({
    retained: 32 * MiB,
    bytes: 8 * MiB,
    staging: 8 * MiB,
    readers: 160,
    captures: 8,
  })
  const ticket = owner.prepareFull(
    owner.beginPrepared(source),
    source.identity,
    packValue({ document: { root: document.root } }, 8 * MiB),
  )
  owner.commit(ticket)
  const capture = owner.capture()
  const blocks = readingBlocks(document.root, text)
  const metadataKey = {}
  const metadata = owner.retain({
    resources: () => [{ key: metadataKey, bytes: 65536 + readingJsonBytes({ blocks }) * 2 }],
  })
  const plan = finishPackedSteps(
    buildPackedTranslationPlan(capture, source, rootPath, limits, occurrence),
  )
  if (!plan) throw new Error('Missing packed plan')
  try {
    if (text.length >= MiB) {
      const beforeCopy = owner.stats
      expect(() =>
        finishPackedSteps(
          inspectPackedNativeStream(
            capture,
            capture.reader.at(rootPath),
            { ...limits, depth: 272 },
            function* () {
              yield
              throw new Error('Unexpected complete native root')
            },
          ),
        ),
      ).toThrow('workspace limit')
      expect(owner.stats).toEqual(beforeCopy)
    }
    const native = extractTranslation(document.root, text, occurrence)
    // Exercise each translation state against the same immutable capture and plan.
    // The stats/closed-handle checks below also catch state retained between runs.
    for (const all of translationModes) {
      const values = new Map(
        native.units.map((unit, index) => [
          unit.occurrenceId,
          !all && index % 4 === 1
            ? undefined
            : !all && index % 4 === 2
              ? '⟪broken⟫'
              : unit.payload
                ? `Changed ${unit.payload.text}`
                : undefined,
        ]),
      )
      const rebuilt = reconstructTranslation(native, values)
      const before = owner.stats
      let held: PackedTranslationProjection | undefined
      finishPackedSteps(
        plan.inspectProjection(
          (unit) => values.get(unit.occurrenceId),
          limits,
          function* (projected) {
            held = projected
            expect(native.units.map((_, index) => projected.status(index))).toEqual(
              rebuilt.statuses.map((status) => status.status),
            )
            for (const layout of ['replace', 'side-by-side', 'interlinear'] as const) {
              const reading = {
                layout,
                blocks,
                units: plan.units,
                translated: new Set(
                  plan.units
                    .filter((_, index) => projected.status(index) === 'translated')
                    .map((unit) => `${unit.from}:${unit.to}`),
                ),
                sourceLanguage: 'en',
                targetLanguage: 'ar',
                labels: { original: 'Original', translation: 'Translation' },
                indexAboveBytes: 0,
              }
              const expected = renderReading(document.root, rebuilt.root, options, reading)
              yield* inspectPackedReading(
                capture,
                source,
                rootPath,
                options,
                reading,
                limits,
                projected,
                function* (actual, cost) {
                  expect(normalize(actual), `${layout}, fully translated: ${all}`).toBe(
                    normalize(expected),
                  )
                  expect(cost.retainedPeakBytes).toBeLessThanOrEqual(limits.retained)
                  expect(cost.stagingPeakBytes).toBeLessThanOrEqual(limits.staging)
                  yield
                },
              )
            }
          },
        ),
      )
      expect(owner.stats).toEqual(before)
      expect(() => held?.status(0)).toThrow('closed')
    }
  } finally {
    plan.release()
    metadata.release()
    capture.release()
    owner.dispose()
  }
}

describe.each(['commonmark', 'manuslip'] as const)(
  'reads packed blocks directly and matches whole-root translation/reading in %s',
  (syntax) => {
    it.each(examples)('CommonMark $example: $section', ({ markdown }) => {
      check(markdown, syntax)
    })
  },
)
it('keeps occurrence-specific secrets, footnotes and raw fragments across all reading layouts', () => {
  check(
    'Hello **world** `SECRET_A` [label](/private-a).\n\nHello **world** `SECRET_B` [label](/private-b).\n\n' +
      '| Head | Ref |\n| --- | --- |\n| $x$ | ![alt][r] |\n\n- [x] Task\n\nFoot[^n] and again[^n].\n\n' +
      '[^n]: Note **prose** and [^b].\n\n[^b]: Cyclic [^n] and $x$.\n\n[r]: private.png "SECRET"\n\n' +
      '<div>\n\nRaw <i>private</i>.\n\n</div>\n\n~~~mermaid\ngraph TD; A-->B\n~~~\n',
    'manuslip',
  )
})

// Each syntax builds one shared capture/plan, then compares both translation states
// across all three complete 1 MiB layouts. Keep this whole-document deadline local.
// Intel CI took 136.8s for this complete check; do not split away either translation state.
it.each(['commonmark', 'manuslip'] as const)(
  'renders partial and full translations of the complete 1 MiB nested packed document in %s without a native root copy',
  (syntax) => {
    const chunk = `${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`
    check(
      `# nested-containers\n\n${chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))}\n[r]: https://example.invalid/\n`,
      syntax,
      [false, true],
    )
  },
  180_000,
)
