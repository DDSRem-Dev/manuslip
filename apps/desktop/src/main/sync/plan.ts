export type SyncPlan =
  | { kind: 'equal'; hash: string }
  | { kind: 'upload'; create: boolean }
  | { kind: 'download' }
  | {
      kind: 'conflict'
      reason: 'initial' | 'diverged' | 'remote-deleted' | 'local-missing' | 'both-missing'
    }

/** Compare exact raw-byte hashes. A missing side never authorizes deleting the other. */
export function planSync(
  local: string | null,
  remote: string | null,
  baseline: string | null,
): SyncPlan {
  for (const hash of [local, remote, baseline])
    if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new Error('sync-invalid')
  if (local === null)
    return { kind: 'conflict', reason: remote === null ? 'both-missing' : 'local-missing' }
  if (local === remote) return { kind: 'equal', hash: local }
  if (remote === null)
    return baseline === null
      ? { kind: 'upload', create: true }
      : { kind: 'conflict', reason: 'remote-deleted' }
  if (baseline === null) return { kind: 'conflict', reason: 'initial' }
  if (local === baseline) return { kind: 'download' }
  if (remote === baseline) return { kind: 'upload', create: false }
  return { kind: 'conflict', reason: 'diverged' }
}
