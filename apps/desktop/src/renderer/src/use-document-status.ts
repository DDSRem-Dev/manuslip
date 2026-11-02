import { useLayoutEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { PreviewStatusPublication, StatusConsumer } from './preview/status-publication'

/** React may cache previous store snapshots after commit. Keep borrowed outline arrays
 * out of those snapshots; the outline component reads rows only during its render.
 * Reading acquires nothing. Only committed layouts advance ownership.
 */
export function useDocumentStatus<
  T extends { previewPublication: number; outline: unknown },
>(document: { store: StoreApi<T>; previewStatuses: PreviewStatusPublication }) {
  const select = useMemo(() => {
    const cache = new WeakMap<T, Omit<T, 'outline'>>()
    return (state: T) => {
      let metadata = cache.get(state)
      if (!metadata) {
        const { outline: _outline, ...value } = state
        metadata = value
        cache.set(state, metadata)
      }
      return metadata
    }
  }, [])
  const status = useStore(document.store, select)
  const current = useRef<{ document: typeof document; consumer: StatusConsumer } | null>(null)
  useLayoutEffect(() => {
    const consumer = document.previewStatuses.subscribe()
    current.current = { document, consumer }
    return () => {
      current.current = null
      consumer.release()
    }
  }, [document])
  useLayoutEffect(() => {
    if (current.current?.document === document)
      current.current.consumer.acknowledge(status.previewPublication)
  }, [document, status.previewPublication])
  return status
}
