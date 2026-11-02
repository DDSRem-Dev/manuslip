import assert from 'node:assert/strict'
import { test } from 'vitest'
import { planSync } from '../../../../src/main/sync/plan'

const base = 'a'.repeat(64),
  local = 'b'.repeat(64),
  remote = 'c'.repeat(64)
test('establishes a baseline only for exact equal content and creates an absent first remote', () => {
  assert.deepEqual(planSync(local, local, null), { kind: 'equal', hash: local })
  assert.deepEqual(planSync(local, local, base), { kind: 'equal', hash: local })
  assert.deepEqual(planSync(local, null, null), { kind: 'upload', create: true })
  assert.deepEqual(planSync(local, remote, null), { kind: 'conflict', reason: 'initial' })
})
test('transfers one-sided changes but preserves both sides of a divergence', () => {
  assert.deepEqual(planSync(base, remote, base), { kind: 'download' })
  assert.deepEqual(planSync(local, base, base), { kind: 'upload', create: false })
  assert.deepEqual(planSync(local, remote, base), { kind: 'conflict', reason: 'diverged' })
})
test('requires explicit recovery or recreation after either connected side disappears', () => {
  for (const baseline of [base, local, remote]) {
    assert.deepEqual(planSync(local, null, baseline), {
      kind: 'conflict',
      reason: 'remote-deleted',
    })
    assert.deepEqual(planSync(null, remote, baseline), {
      kind: 'conflict',
      reason: 'local-missing',
    })
  }
  assert.deepEqual(planSync(null, null, base), { kind: 'conflict', reason: 'both-missing' })
})
test('rejects malformed persisted hashes instead of establishing an accidental baseline', () => {
  for (const hash of ['', 'abc', 'A'.repeat(64), 'a'.repeat(63)])
    assert.throws(() => planSync(local, remote, hash), /sync-invalid/)
})
