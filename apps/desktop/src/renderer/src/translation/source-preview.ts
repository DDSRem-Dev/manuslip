import { semanticLimits } from '@manuslip/core'
import { type ReadingProjection, readingProjectionBytes } from '@manuslip/renderer/reading'
import { useEffect, useRef, useState } from 'react'
import type { DocumentController } from '../document'
import { ReadingWorker } from './browser'
import { prepareReading } from './prepare'

interface SourcePreview {
  revision: number
  options: string
  projection: ReadingProjection | null
  error: boolean
}

/** Render an immutable source capture locally while no translated copy is available. */
export function useSourcePreview(
  document: DocumentController,
  enabled: boolean,
  ready: boolean,
  revision: number,
): { projection: ReadingProjection | null; error: boolean } {
  const options = JSON.stringify(document.preview.renderOptions())
  const saved = useRef<SourcePreview | null>(null)
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  useEffect(() => {
    if (!enabled) {
      saved.current = null
      setPreview(null)
      return
    }
    if (!ready || (saved.current?.revision === revision && saved.current.options === options))
      return
    const abort = new AbortController()
    let engine: ReadingWorker | undefined
    const render = async (): Promise<void> => {
      try {
        const capture = await document.preview.captureReading(revision, abort.signal)
        if (abort.signal.aborted) {
          if (capture.kind === 'packed') capture.capture.release()
          return
        }
        try {
          engine = new ReadingWorker()
        } catch (error) {
          if (capture.kind === 'packed') capture.capture.release()
          throw error
        }
        const prepared = await prepareReading(
          engine,
          capture,
          document.state.doc.toString(),
          null,
          abort.signal,
        )
        if (abort.signal.aborted) return
        if (prepared.kind !== 'prepared') throw new Error('translation-view-worker')
        const rendered = await engine.request({
          kind: 'render',
          outputs: [],
          options: JSON.parse(options),
          blocks: prepared.blocks,
        })
        if (abort.signal.aborted) return
        if (
          rendered.kind !== 'rendered' ||
          capture.retainedBytes + readingProjectionBytes(rendered.projection) >
            semanticLimits.snapshotBytes
        )
          throw new Error('translation-view-limit')
        saved.current = { revision, options, projection: rendered.projection, error: false }
        setPreview(saved.current)
      } catch {
        if (!abort.signal.aborted) {
          saved.current = { revision, options, projection: null, error: true }
          setPreview(saved.current)
        }
      } finally {
        engine?.dispose()
      }
    }
    void render()
    return () => {
      abort.abort()
      engine?.dispose()
    }
  }, [document, enabled, ready, revision, options])
  return enabled && preview?.revision === revision && preview.options === options
    ? preview
    : { projection: null, error: false }
}
