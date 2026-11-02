import { randomUUID } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'

/** Private profile metadata only; never document/recovery paths. */
export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(value), 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
