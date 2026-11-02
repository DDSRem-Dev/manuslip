import type { Root } from '@manuslip/core'
import type { TranslationSettings } from '@manuslip/translate'
import type { PackedCapture } from '../../../../../../packages/core/src/packing-capture'
import type { PackedSerializedValue } from '../../../../../../packages/core/src/packing-serialize'
import type { PackedValue } from '../../../../../../packages/core/src/packing-value'
import type { PackedPath } from '../../../../../../packages/core/src/packing-view'
import { SlicedWork, type SliceRuntime } from '../semantics/sliced-work'
import { type ReadingEngine, type ReadingValue, readingLimits } from './protocol'

export type ReadingCapture =
  | { kind: 'native'; root: Root; retainedBytes: number }
  | { kind: 'packed'; capture: PackedCapture; path: PackedPath; retainedBytes: number }

/** Own a capture through sliced serialization and an independent output through worker
 * receipt/failure. Every exit releases both, including cancellation before the first step.
 */
export async function prepareReading(
  engine: ReadingEngine,
  captured: ReadingCapture,
  source: string,
  settings: TranslationSettings,
  signal: AbortSignal,
  runtime?: SliceRuntime,
): Promise<ReadingValue> {
  let output: PackedValue<PackedSerializedValue> | undefined
  try {
    if (signal.aborted) throw new Error('translation-cancelled')
    if (captured.kind === 'native')
      return await engine.request({ kind: 'prepare', root: captured.root, source, settings })
    if (captured.capture.sourceResource.text !== source)
      throw new Error('translation-capture-changed')
    const identity = captured.capture.identity
    output = await new Promise<PackedValue<PackedSerializedValue>>((resolve, reject) => {
      const iterator = captured.capture.serialize(captured.path, {
        bytes: readingLimits.message - 65536,
        workspace: 3 * 1024 * 1024,
        nodes: 800000,
        depth: 128,
      })
      let work: SlicedWork<PackedValue<PackedSerializedValue>>
      const cleanup = () => signal.removeEventListener('abort', abort)
      const abort = () => {
        work.cancel()
        cleanup()
        reject(new Error('translation-cancelled'))
      }
      work = new SlicedWork(
        iterator,
        {
          valid: () => !signal.aborted,
          complete: (value) => {
            cleanup()
            resolve(value)
          },
          finished: () => {},
          failed: (error) => {
            cleanup()
            reject(error)
          },
          measured: () => {},
        },
        runtime,
      )
      signal.addEventListener('abort', abort, { once: true })
      work.run()
    })
    if (signal.aborted) throw new Error('translation-cancelled')
    return await engine.request({
      kind: 'prepare-packed',
      payload: output.value.payload,
      identity,
      source,
      settings,
    })
  } finally {
    output?.release()
    if (captured.kind === 'packed') captured.capture.release()
  }
}
