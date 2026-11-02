/** Local DevTools/benchmark evidence only; never transmits or includes document text. */
export function semanticMetric(
  phase: string,
  start: number,
  detail?: Record<string, number | boolean>,
): void {
  try {
    const name = `manuslip:${phase}`
    if (performance.getEntriesByName(name).length >= 200) performance.clearMeasures(name)
    performance.measure(name, { start, end: performance.now(), detail })
  } catch {
    // Local diagnostics must not fail requests or accepted consumer work.
  }
}

const failureReasons = [
  'worker-error',
  'message-error',
  'worker-failure',
  'worker-create',
  'worker-listener',
  'worker-post',
  'watchdog',
  'native-response',
  'packed-result',
  'channel-post',
  'slice-schedule',
  'packed-response',
  'packed-receipt',
  'packed-cache',
] as const
export type SemanticFailureReason = (typeof failureReasons)[number]

/** Fixed reasons and scalar timing only. Diagnostics must never interrupt recovery. */
export function semanticFailureMetric(
  reason: SemanticFailureReason,
  requestAgeMs: number | null,
  workerPresent: boolean,
): void {
  try {
    const name = 'manuslip:semantic-failure'
    if (performance.getEntriesByName(name).length >= 200) performance.clearMeasures(name)
    const now = performance.now()
    performance.measure(name, {
      start: now,
      end: now,
      detail: {
        reason: failureReasons.includes(reason) ? reason : 'worker-failure',
        requestActive: requestAgeMs !== null,
        requestAgeMs,
        workerPresent,
      },
    })
  } catch {
    // A missing or failing timing API must not consume another restart allowance.
  }
}
