/** Revocation must finish even when a trusted generator's finally block throws. Preserve
 * the first failure (including thrown undefined) after every remaining owner is closed.
 * A caller already unwinding a failure may preserve it after attempting every release.
 */
export function finishPackedCleanup(actions: Iterable<() => void>, preserveFailure = false): void {
  let failed = false
  let failure: unknown
  for (const action of actions) {
    try {
      action()
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
  }
  if (failed && !preserveFailure) throw failure
}
