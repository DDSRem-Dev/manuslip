import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecoveryRepository, recoveryLimits } from '../../../../src/main/files/recovery'
import type { FileInfo } from '../../../../src/shared/file-contracts'

describe('durable recovery snapshots', () => {
  let directory: string
  let info: FileInfo
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-recovery-'))
    info = {
      id: randomUUID(),
      name: 'world.md',
      displayPath: '/world.md',
      fingerprint: 'disk-base',
      encoding: 'utf8',
      bom: false,
      newline: 'crlf',
      unsafeDecoding: false,
    }
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
  })
  it('offers a bounded Unicode snapshot on restart and never modifies the original path', async () => {
    const original = join(directory, 'original.md')
    await writeFile(original, 'disk')
    const repository = new RecoveryRepository(directory)
    await repository.load()
    await repository.checkpoint(
      { id: info.id, text: '草稿 📝\n', revision: 7 },
      { ...info, displayPath: original },
    )
    expect(repository.list()).toEqual([])
    const restarted = new RecoveryRepository(directory)
    await restarted.load()
    expect(restarted.list()).toMatchObject([
      { id: info.id, revision: 7, bytes: Buffer.byteLength('草稿 📝\n'), displayPath: original },
    ])
    expect(await restarted.restore(info.id)).toBe('草稿 📝\n')
    expect(await readFile(original, 'utf8')).toBe('disk')
  })
  it('retains the last good snapshot when a new checkpoint fails and cleans the temporary file', async () => {
    let fail = false
    const repository = new RecoveryRepository(directory, async () => {
      if (fail) throw new Error('Storage full')
    })
    await repository.load()
    await repository.checkpoint({ id: info.id, text: 'retained', revision: 1 }, info)
    fail = true
    await expect(
      repository.checkpoint({ id: info.id, text: 'failed', revision: 2 }, info),
    ).rejects.toMatchObject({ code: 'recovery-io' })
    expect(await readdir(directory)).toEqual([`${info.id}.recovery`])
    const restarted = new RecoveryRepository(directory)
    await restarted.load()
    expect(await restarted.restore(info.id)).toBe('retained')
  })
  it('ignores stale checkpoints and save acknowledgements cannot erase a newer revision', async () => {
    const repository = new RecoveryRepository(directory)
    await repository.load()
    await repository.checkpoint({ id: info.id, text: 'newest', revision: 5 }, info)
    await repository.clear(info.id, 4)
    await repository.checkpoint({ id: info.id, text: 'stale', revision: 4 }, info)
    const restarted = new RecoveryRepository(directory)
    await restarted.load()
    expect(await restarted.restore(info.id)).toBe('newest')
    await repository.clear(info.id, 5)
    await repository.checkpoint({ id: info.id, text: 'late', revision: 5 }, info)
    expect(await readdir(directory)).toEqual([])
  })
  it('retains a restored original until a new checkpoint is durable and removes it after a clean save', async () => {
    const repository = new RecoveryRepository(directory)
    await repository.load()
    await repository.checkpoint({ id: info.id, text: 'original draft', revision: 20 }, info)
    const restarted = new RecoveryRepository(directory)
    await restarted.load()
    const session = randomUUID()
    await restarted.restore(info.id)
    restarted.claim(info.id, session)
    expect(await readdir(directory)).toEqual([`${info.id}.recovery`])
    expect(restarted.list()).toEqual([])
    await restarted.checkpoint(
      { id: session, text: 'restored draft', revision: 0 },
      { ...info, id: session, displayPath: null, fingerprint: null },
    )
    expect(await readdir(directory)).toEqual([`${session}.recovery`])
    await restarted.clear(session, 0)
    expect(await readdir(directory)).toEqual([])
  })
  it('preserves damaged and future-version files without offering them as recoverable drafts', async () => {
    await writeFile(join(directory, `${info.id}.recovery`), 'invalid')
    const future = randomUUID()
    await writeFile(join(directory, `${future}.recovery`), '{"version":99}\n')
    const repository = new RecoveryRepository(directory)
    await repository.load()
    expect(repository.list()).toEqual([])
    expect((await readdir(directory)).length).toBe(2)
  })
  it('keeps recovery storage failures separate from application startup', async () => {
    const blocked = join(directory, 'not-a-directory')
    await writeFile(blocked, 'preserve')
    const repository = new RecoveryRepository(blocked)
    await expect(repository.load()).resolves.toBeUndefined()
    expect(() => repository.list()).toThrow('recovery checkpoint failed')
    await expect(
      repository.checkpoint({ id: info.id, revision: 1, text: 'draft' }, info),
    ).rejects.toMatchObject({ code: 'recovery-io' })
    expect(await readFile(blocked, 'utf8')).toBe('preserve')
  })
  it('refuses growth at the draft-count limit without evicting existing writing; restoring can replace its own slot', async () => {
    const repository = new RecoveryRepository(directory)
    await repository.load()
    for (let index = 0; index < recoveryLimits.entries; index++) {
      const id = index === 0 ? info.id : randomUUID()
      await repository.checkpoint({ id, text: `draft ${index}`, revision: 1 }, { ...info, id })
    }
    const overflow = randomUUID()
    await expect(
      repository.checkpoint(
        { id: overflow, text: 'overflow', revision: 1 },
        { ...info, id: overflow },
      ),
    ).rejects.toMatchObject({ code: 'recovery-capacity' })
    expect((await readdir(directory)).length).toBe(recoveryLimits.entries)
    const restarted = new RecoveryRepository(directory)
    await restarted.load()
    expect(restarted.list()).toHaveLength(recoveryLimits.entries)
    expect(await restarted.restore(info.id)).toBe('draft 0')
    restarted.claim(info.id, overflow)
    await restarted.checkpoint(
      { id: overflow, text: 'updated restored draft', revision: 0 },
      { ...info, id: overflow },
    )
    expect((await readdir(directory)).length).toBe(recoveryLimits.entries)
  })
  it('reloads drafts after failed startup storage becomes available in the same process', async () => {
    const path = join(directory, 'recoveries')
    await writeFile(path, 'blocked')
    const repository = new RecoveryRepository(path)
    await repository.load()
    await expect(repository.retryLoad()).rejects.toMatchObject({ code: 'recovery-io' })
    await rm(path)
    await mkdir(path)
    const writer = new RecoveryRepository(path)
    await writer.checkpoint({ id: info.id, revision: 3, text: 'Retained 界😀\r\n' }, info)
    await repository.retryLoad()
    expect(repository.list()).toMatchObject([{ id: info.id, revision: 3 }])
    expect(await repository.restore(info.id)).toBe('Retained 界😀\r\n')
    await repository.retryLoad()
    expect(repository.list()).toHaveLength(1)
  })
  it('serializes recovery retry with active checkpoints and never offers current writing as an interrupted draft', async () => {
    const path = join(directory, 'recoveries')
    await writeFile(path, 'blocked')
    const repository = new RecoveryRepository(path)
    await repository.load()
    await rm(path)
    const checkpoint = repository.checkpoint(
      { id: info.id, revision: 1, text: 'Active draft' },
      info,
    )
    await Promise.all([checkpoint, repository.retryLoad(), repository.retryLoad()])
    expect(repository.list()).toEqual([])
    const restarted = new RecoveryRepository(path)
    await restarted.load()
    expect(await restarted.restore(info.id)).toBe('Active draft')
  })
  it('does not re-offer a claimed draft after a failed scan is retried', async () => {
    const path = join(directory, 'recoveries'),
      backup = join(directory, 'retained')
    const writer = new RecoveryRepository(path)
    await writer.checkpoint({ id: info.id, revision: 1, text: 'Claimed draft' }, info)
    const repository = new RecoveryRepository(path)
    await repository.load()
    const session = randomUUID()
    repository.claim(info.id, session)
    await rename(path, backup)
    await writeFile(path, 'blocked')
    await repository.load()
    await rm(path)
    await rename(backup, path)
    await repository.retryLoad()
    expect(repository.list()).toEqual([])
    expect(await readFile(join(path, `${info.id}.recovery`), 'utf8')).toContain('Claimed draft')
    await repository.clear(session, 0)
    expect(await readdir(path)).toEqual([])
  })
})
