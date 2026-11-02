import {
  chmod,
  link,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite, readDisk } from '../../../../src/main/files/disk'
import { documentLimit } from '../../../../src/shared/file-contracts'

describe('atomic document replacement', () => {
  let directory: string
  let path: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-disk-'))
    path = join(directory, '文档.md')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
  })

  it('publishes a new file exclusively, then replaces it without temporary debris', async () => {
    const first = await atomicWrite(path, Buffer.from('first\r\n'), null)
    const result = await atomicWrite(path, Buffer.from('第二版\r\n'), first.fingerprint)
    expect(result.bytes.toString()).toBe('第二版\r\n')
    expect(result.fingerprint).not.toBe(first.fingerprint)
    expect(await readdir(directory)).toEqual(['文档.md'])
  })
  it.each(['beforeWrite', 'beforeReplace'] as const)(
    'retains the original and cleans a failed temporary write at %s',
    async (phase) => {
      await writeFile(path, 'original')
      const disk = await readDisk(path)
      await expect(
        atomicWrite(path, Buffer.from('edited'), disk.fingerprint, {
          [phase]: async () => {
            throw Object.assign(new Error('storage full'), { code: 'ENOSPC' })
          },
        }),
      ).rejects.toMatchObject({ code: 'file-storage' })
      expect(await readFile(path, 'utf8')).toBe('original')
      expect(await readdir(directory)).toEqual(['文档.md'])
    },
  )
  it('rechecks the fingerprint immediately before replacement', async () => {
    await writeFile(path, 'original')
    const disk = await readDisk(path)
    await expect(
      atomicWrite(path, Buffer.from('edited'), disk.fingerprint, {
        beforeReplace: () => writeFile(path, 'external edit'),
      }),
    ).rejects.toMatchObject({ code: 'file-changed' })
    expect(await readFile(path, 'utf8')).toBe('external edit')
  })
  it('never overwrites a destination created after the Save As dialog', async () => {
    await expect(
      atomicWrite(path, Buffer.from('draft'), null, {
        beforeReplace: () => writeFile(path, 'other writer'),
      }),
    ).rejects.toMatchObject({ code: 'file-changed' })
    expect(await readFile(path, 'utf8')).toBe('other writer')
  })
  it('retries transient replacement failures, checks for outside changes on every retry', async () => {
    await writeFile(path, 'original')
    const disk = await readDisk(path)
    let attempts = 0
    await expect(
      atomicWrite(path, Buffer.from('edited'), disk.fingerprint, {
        replace: async () => {
          attempts++
          await writeFile(path, 'changed while locked')
          throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        },
      }),
    ).rejects.toMatchObject({ code: 'file-changed' })
    expect(attempts).toBe(1)
    expect(await readFile(path, 'utf8')).toBe('changed while locked')
  })
  it('refuses replacement of hard-linked content rather than breaking its links', async () => {
    await writeFile(path, 'original')
    const alias = join(directory, 'alias.md')
    await link(path, alias)
    await expect(
      atomicWrite(path, Buffer.from('edited'), (await readDisk(path)).fingerprint),
    ).rejects.toMatchObject({ code: 'file-metadata' })
    expect(await readFile(alias, 'utf8')).toBe('original')
    expect((await stat(path)).nlink).toBe(2)
  })
  it('exhausts the bounded retry sequence without unlinking the original', async () => {
    await writeFile(path, 'original')
    const disk = await readDisk(path)
    let attempts = 0
    await expect(
      atomicWrite(path, Buffer.from('edited'), disk.fingerprint, {
        replace: async () => {
          attempts++
          throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        },
      }),
    ).rejects.toMatchObject({ code: 'file-locked' })
    expect(attempts).toBe(4)
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(await readdir(directory)).toEqual(['文档.md'])
  })
  it('succeeds after a transient replacement error', async () => {
    await writeFile(path, 'original')
    let attempts = 0
    await atomicWrite(path, Buffer.from('edited'), (await readDisk(path)).fingerprint, {
      replace: async (source, destination) => {
        if (++attempts === 1) throw Object.assign(new Error('denied'), { code: 'EACCES' })
        await rename(source, destination)
      },
    })
    expect(attempts).toBe(2)
    expect(await readFile(path, 'utf8')).toBe('edited')
  })
  it('rejects an over-cap sparse file from its size before reading its body', async () => {
    const file = await open(path, 'wx')
    try {
      await file.truncate(documentLimit + 1)
    } finally {
      await file.close()
    }
    await expect(readDisk(path)).rejects.toMatchObject({ code: 'file-large' })
  })
  it.skipIf(process.platform === 'win32')(
    'preserves restrictive POSIX permission bits',
    async () => {
      await writeFile(path, 'original')
      await chmod(path, 0o640)
      await atomicWrite(path, Buffer.from('edited'), (await readDisk(path)).fingerprint)
      expect((await stat(path)).mode & 0o777).toBe(0o640)
    },
  )
})
